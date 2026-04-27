'use client';

import React, { useMemo, useRef } from 'react';
import {
  Table,
  Tag,
  Button,
  Typography,
  Space,
  Tooltip,
  notification,
  Card,
  Alert,
  Input,
  Popconfirm,
} from 'antd';
import type { InputRef, TableColumnType } from 'antd';
import type { FilterDropdownProps } from 'antd/es/table/interface';
import {
  DownloadOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/LocaleContext';
import type { ExportJobDto, SensorDto } from '@butterfly/shared-types';

dayjs.extend(relativeTime);

const { Text, Title } = Typography;

const STATUS_COLOR: Record<string, string> = {
  pending: 'gold',
  processing: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'default',
};

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExportsPage() {
  const [notifApi, contextHolder] = notification.useNotification();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const searchInput = useRef<InputRef>(null);

  // ExportJobNotifier (mounted in layout) already handles polling via the
  // shared ['exports'] query key. This page only needs to subscribe to that
  // same cache and trigger a manual refetch when the user clicks the button.
  const {
    data: jobs = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['exports'],
    queryFn: async () => {
      const res = await api.get<ExportJobDto[]>('/exports');
      return res.data;
    },
    refetchInterval: false,
  });

  const cancelMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await api.delete<ExportJobDto>(`/exports/${jobId}`);
      return res.data;
    },
    onSuccess: () => {
      notifApi.success({ message: t('exports.cancelSuccess') });
      queryClient.invalidateQueries({ queryKey: ['exports'] });
    },
    onError: () => {
      notifApi.error({ message: t('exports.cancelFailed') });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await api.get(`/exports/${jobId}/download`, {
        responseType: 'blob',
      });
      return { data: res.data as Blob, headers: res.headers };
    },
    onSuccess: ({ data, headers }, jobId) => {
      const job = jobs.find((j) => j.id === jobId);
      const fileName =
        job?.fileName ||
        (headers['content-disposition']?.split('filename=')[1]?.replace(/"/g, '') ??
          `export-${jobId}.csv`);
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onError: () => {
      notifApi.error({ message: t('exports.downloadFailed') });
    },
  });

  // ── Sensor display name lookup ─────────────────────────────────────────────
  const { data: sensors = [] } = useQuery({
    queryKey: ['sensors'],
    queryFn: async () => {
      const res = await api.get<SensorDto[]>('/sensors');
      return res.data;
    },
  });

  const sensorDisplayMap = useMemo(() => {
    const m: Record<string, string> = {};
    sensors.forEach((s) => {
      m[s.sensorSn] = s.displayName ?? '';
    });
    return m;
  }, [sensors]);

  // ── Column search helpers ───────────────────────────────────────────────────
  const handleSearch = (confirm: FilterDropdownProps['confirm']) => confirm();

  const handleReset = (clearFilters: () => void, confirm: FilterDropdownProps['confirm']) => {
    clearFilters();
    confirm();
  };

  function makeSearchProps(
    filterFn: (value: string, record: ExportJobDto) => boolean,
    placeholder: string,
  ): Pick<
    TableColumnType<ExportJobDto>,
    'filterDropdown' | 'filterIcon' | 'onFilter' | 'onFilterDropdownOpenChange'
  > {
    return {
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
        <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
          <Input
            ref={searchInput}
            placeholder={placeholder}
            value={selectedKeys[0] as string}
            onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
            onPressEnter={() => handleSearch(confirm)}
            style={{ marginBottom: 8, display: 'block' }}
          />
          <Space>
            <Button
              type="primary"
              onClick={() => handleSearch(confirm)}
              icon={<SearchOutlined />}
              size="small"
            >
              {t('common.search')}
            </Button>
            <Button onClick={() => clearFilters && handleReset(clearFilters, confirm)} size="small">
              {t('common.reset')}
            </Button>
          </Space>
        </div>
      ),
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? '#1677ff' : 'var(--brand-text-secondary)' }} />
      ),
      onFilter: (value, record) => filterFn(String(value), record),
      onFilterDropdownOpenChange: (visible) => {
        if (visible) setTimeout(() => searchInput.current?.select(), 100);
      },
    };
  }

  const columns: TableColumnType<ExportJobDto>[] = [
    {
      title: t('common.sensor'),
      dataIndex: 'sensorSn',
      key: 'sensorSn',
      render: (v: string) => <Text code>{v}</Text>,
      ...makeSearchProps((value, record) => {
        const sn = record.sensorSn.toLowerCase();
        return sn.includes(value.toLowerCase());
      }, t('common.sensor')),
    },
    {
      title: t('exports.sensorName'),
      dataIndex: 'sensorSn',
      key: 'sensorName',
      render: (v: string) => {
        const name = sensorDisplayMap[v];
        return name ? <Text>{name}</Text> : <Text type="secondary">—</Text>;
      },
      ...makeSearchProps((value, record) => {
        const name = sensorDisplayMap[record.sensorSn] ?? '';
        return name.toLowerCase().includes(value.toLowerCase());
      }, t('exports.sensorName')),
    },
    {
      title: t('common.timeRange'),
      key: 'timeRange',
      render: (_: unknown, record: ExportJobDto) => (
        <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
          {dayjs(record.startTime).format('MM/DD HH:mm')}
          {' — '}
          {dayjs(record.endTime).format('MM/DD HH:mm')}
        </Text>
      ),
    },
    {
      title: t('common.resolution'),
      dataIndex: 'resolution',
      key: 'resolution',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: t('common.format'),
      dataIndex: 'format',
      key: 'format',
      render: (v: string) => <Tag color="cyan">{v.toUpperCase()}</Tag>,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      filters: (['pending', 'processing', 'completed', 'failed'] as const).map((s) => ({
        text: t(`status.${s}` as Parameters<typeof t>[0]) || s,
        value: s,
      })),
      onFilter: (value, record) => record.status === value,
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] || 'default'}>
          {t(`status.${v}` as Parameters<typeof t>[0]) || v}
        </Tag>
      ),
    },
    {
      title: t('exports.rowCount'),
      dataIndex: 'rowCount',
      key: 'rowCount',
      render: (v: number | null) =>
        v != null ? v.toLocaleString() : <Text type="secondary">—</Text>,
    },
    {
      title: t('exports.fileSize'),
      dataIndex: 'fileSize',
      key: 'fileSize',
      render: (v: number | null) => formatFileSize(v),
    },
    {
      title: t('common.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend',
      render: (v: string) => (
        <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
            {dayjs(v).fromNow()}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_: unknown, record: ExportJobDto) => (
        <Space>
          <Tooltip
            title={
              record.status !== 'completed'
                ? t('exports.downloadDisabled')
                : t('exports.downloadFile')
            }
          >
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              disabled={record.status !== 'completed'}
              loading={downloadMutation.isPending && downloadMutation.variables === record.id}
              onClick={() => downloadMutation.mutate(record.id)}
            >
              {t('exports.download')}
            </Button>
          </Tooltip>
          {(record.status === 'pending' || record.status === 'processing') && (
            <Popconfirm
              title={t('exports.cancelConfirm')}
              onConfirm={() => cancelMutation.mutate(record.id)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
            >
              <Button
                type="link"
                size="small"
                danger
                icon={<StopOutlined />}
                loading={cancelMutation.isPending && cancelMutation.variables === record.id}
              >
                {t('exports.cancel')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {contextHolder}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={4} style={{ color: 'var(--brand-text)', margin: 0 }}>
            {t('exports.title')}
          </Title>
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 13 }}>
            {t('exports.subtitle')}
            {jobs.some((j) => j.status === 'pending' || j.status === 'processing') && (
              <Tag color="blue" style={{ marginLeft: 8 }}>
                {t('exports.autoRefresh')}
              </Tag>
            )}
          </Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['exports'] });
          }}
        >
          {t('common.refresh')}
        </Button>
      </div>

      <Alert
        icon={<ClockCircleOutlined />}
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={<span style={{ fontSize: 13 }}>{t('exports.cleanupTitle')}</span>}
        description={
          <span style={{ fontSize: 12 }}>
            {t('exports.cleanupDescPre')}
            <strong>{t('exports.cleanupDescHighlight')}</strong>
            {t('exports.cleanupDescPost')}
          </span>
        }
      />

      <Card
        style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          dataSource={jobs}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{
            pageSize: 20,
            showTotal: (total) => t('common.total', { count: total }),
            showSizeChanger: false,
          }}
          locale={{ emptyText: t('exports.empty') }}
          scroll={{ x: 900 }}
          expandable={{
            expandedRowRender: (record: ExportJobDto) =>
              record.errorMessage ? (
                <div style={{ padding: '8px 16px' }}>
                  <Text type="danger">
                    {t('exports.errorPrefix')}
                    {record.errorMessage}
                  </Text>
                </div>
              ) : null,
            rowExpandable: (record: ExportJobDto) => !!record.errorMessage,
          }}
        />
      </Card>
    </div>
  );
}
