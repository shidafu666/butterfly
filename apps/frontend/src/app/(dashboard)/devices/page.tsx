'use client';

import React, { useState } from 'react';
import { Alert, Button, Card, Input, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { TableColumnType, TablePaginationConfig } from 'antd';
import type { SorterResult } from 'antd/es/table/interface';
import {
  DisconnectOutlined,
  DownloadOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
  SearchOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { useLocale } from '@/contexts/LocaleContext';
import type { SensorOverviewDto, SensorOverviewPageDto } from '@butterfly/shared-types';

const { Text, Title } = Typography;

type TableQuery = {
  page: number;
  pageSize: number;
  sensorSn?: string;
  displayName?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
};

function MyDevices() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [tableQuery, setTableQuery] = useState<TableQuery>({
    page: 1,
    pageSize: 100,
    sortBy: 'lastReportTime',
    sortOrder: 'desc',
  });
  const [sensorSn, setSensorSn] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const {
    data: sensorPage,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['my-sensors', tableQuery],
    queryFn: async () =>
      (await api.get<SensorOverviewPageDto>('/sensors/overview', { params: tableQuery })).data,
  });

  const search = () =>
    setTableQuery((query) => ({
      ...query,
      page: 1,
      sensorSn: sensorSn.trim() || undefined,
      displayName: displayName.trim() || undefined,
    }));

  const { mutate: saveDisplayName, isPending: isSaving } = useMutation({
    mutationFn: async ({ sensorSn: sn, value }: { sensorSn: string; value: string | null }) => {
      await api.patch(`/sensors/${sn}`, { displayName: value });
    },
    onSuccess: (_, { sensorSn: sn, value }) => {
      queryClient.setQueryData<SensorOverviewPageDto>(['my-sensors', tableQuery], (current) =>
        current
          ? {
              ...current,
              items: current.items.map((sensor) =>
                sensor.sensorSn === sn ? { ...sensor, displayName: value } : sensor,
              ),
            }
          : current,
      );
      setEditingId(null);
      setEditingValue('');
      message.success(t('devices.saveSuccess'));
    },
    onError: () => message.error(t('devices.saveFailed')),
  });

  const startEdit = (sensor: SensorOverviewDto) => {
    setEditingId(sensor.id);
    setEditingValue(sensor.displayName ?? '');
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue('');
  };
  const handleSave = (sn: string) =>
    saveDisplayName({ sensorSn: sn, value: editingValue.trim() || null });

  const exportCsv = async () => {
    try {
      const rows: SensorOverviewDto[] = [];
      let page = 1;
      let total = 0;
      do {
        const response = await api.get<SensorOverviewPageDto>('/sensors/overview', {
          params: { ...tableQuery, page, pageSize: 200 },
        });
        rows.push(...response.data.items);
        total = response.data.total;
        page += 1;
      } while (rows.length < total);

      const headers = [
        'IMEI',
        t('devices.displayName'),
        t('devices.lastReport'),
        t('devices.onlineStatus'),
        t('devices.regStatus'),
        t('devices.regTime'),
      ];
      const lines = rows.map((row) =>
        [
          row.sensorSn,
          row.displayName ?? '',
          row.lastReportTime ? dayjs(row.lastReportTime).format('YYYY-MM-DD HH:mm:ss') : '',
          row.isActive ? 'Active' : 'Inactive',
          row.status,
          dayjs(row.createdAt).format('YYYY-MM-DD HH:mm:ss'),
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(','),
      );
      const url = URL.createObjectURL(
        new Blob(['\ufeff' + [headers.join(','), ...lines].join('\n')], {
          type: 'text/csv;charset=utf-8;',
        }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `devices_${dayjs().format('YYYY-MM-DD')}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error(t('devices.loadFailed'));
    }
  };

  const columns: TableColumnType<SensorOverviewDto>[] = [
    {
      title: t('devices.sensorSn'),
      dataIndex: 'sensorSn',
      key: 'sensorSn',
      width: 180,
      sorter: true,
      render: (value: string) => (
        <Text code style={{ fontSize: 12, color: '#79c0ff' }}>
          {value}
        </Text>
      ),
    },
    {
      title: t('devices.displayName'),
      dataIndex: 'displayName',
      key: 'displayName',
      width: 220,
      sorter: true,
      render: (value: string | null, sensor: SensorOverviewDto) =>
        editingId === sensor.id ? (
          <Space size={4}>
            <Input
              size="small"
              autoFocus
              value={editingValue}
              onChange={(event) => setEditingValue(event.target.value)}
              onPressEnter={() => handleSave(sensor.sensorSn)}
              onKeyDown={(event) => event.key === 'Escape' && cancelEdit()}
              style={{ width: 130 }}
              maxLength={128}
              placeholder={t('devices.namePlaceholder')}
            />
            <Tooltip title={t('devices.saveTooltip')}>
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined />}
                onClick={() => handleSave(sensor.sensorSn)}
                loading={isSaving}
                style={{ color: '#3fb950', padding: '0 4px' }}
              />
            </Tooltip>
            <Tooltip title={t('devices.cancelTooltip')}>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={cancelEdit}
                disabled={isSaving}
                style={{ color: '#f85149', padding: '0 4px' }}
              />
            </Tooltip>
          </Space>
        ) : (
          <Space size={4} className="device-name-cell">
            <Text
              style={{
                color: value ? 'var(--brand-text)' : '#484f58',
                fontSize: 13,
                fontStyle: value ? 'normal' : 'italic',
              }}
            >
              {value ?? t('devices.unnamed')}
            </Text>
            <Tooltip title={t('devices.editName')}>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => startEdit(sensor)}
                style={{ color: '#484f58', padding: '0 4px' }}
                className="edit-icon"
              />
            </Tooltip>
          </Space>
        ),
    },
    {
      title: t('devices.lastReport'),
      dataIndex: 'lastReportTime',
      key: 'lastReportTime',
      width: 160,
      sorter: true,
      defaultSortOrder: 'descend',
      render: (value: string | null) =>
        value ? (
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
            {dayjs(value).format('YYYY-MM-DD HH:mm:ss')}
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('devices.neverReported')}
          </Text>
        ),
    },
    {
      title: t('devices.onlineStatus'),
      dataIndex: 'isActive',
      key: 'isActive',
      width: 110,
      render: (value: boolean) =>
        value ? (
          <Space size={4}>
            <WifiOutlined style={{ color: '#3fb950', fontSize: 13 }} />
            <Text style={{ color: '#3fb950', fontSize: 13 }}>Active</Text>
          </Space>
        ) : (
          <Space size={4}>
            <DisconnectOutlined style={{ color: '#484f58', fontSize: 13 }} />
            <Text style={{ color: '#484f58', fontSize: 13 }}>Inactive</Text>
          </Space>
        ),
    },
    {
      title: t('devices.regStatus'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      sorter: true,
      render: (value: string) => (
        <Tag color={value === 'active' ? 'blue' : 'default'} style={{ fontSize: 11 }}>
          {value}
        </Tag>
      ),
    },
    {
      title: t('devices.regTime'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      sorter: true,
      render: (value: string) => (
        <Tooltip title={dayjs(value).format('YYYY-MM-DD HH:mm:ss')}>
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
            {dayjs(value).format('YYYY-MM-DD')}
          </Text>
        </Tooltip>
      ),
    },
  ];

  if (error)
    return (
      <Alert
        message={t('devices.loadFailed')}
        description={t('common.checkPermission')}
        type="error"
        showIcon
      />
    );
  const total = sensorPage?.total ?? 0;
  const activeCount = sensorPage?.activeCount ?? 0;
  const handleTableChange = (
    pagination: TablePaginationConfig,
    _: unknown,
    sorter: SorterResult<SensorOverviewDto> | SorterResult<SensorOverviewDto>[],
  ) => {
    const selectedSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    setTableQuery((query) => ({
      ...query,
      page: pagination.current ?? 1,
      pageSize: pagination.pageSize ?? 100,
      sortBy: typeof selectedSorter?.field === 'string' ? selectedSorter.field : 'lastReportTime',
      sortOrder: selectedSorter?.order === 'ascend' ? 'asc' : 'desc',
    }));
  };

  return (
    <>
      <style>{`.device-name-cell .edit-icon { opacity: 0; transition: opacity 0.15s; } .ant-table-row:hover .device-name-cell .edit-icon { opacity: 1; }`}</style>
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
        }}
      >
        <div>
          <Title level={4} style={{ color: 'var(--brand-text)', margin: 0 }}>
            {t('devices.myTitle')}
          </Title>
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 13 }}>
            {t('devices.subtitle', { total, active: activeCount })}
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>
            {t('common.refresh')}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={exportCsv}
            disabled={!sensorPage?.items.length}
          >
            {t('devices.exportCsv')}
          </Button>
        </Space>
      </div>
      <Card
        style={{
          marginBottom: 16,
          background: 'var(--brand-surface)',
          border: '1px solid var(--brand-border)',
        }}
        bodyStyle={{ padding: 16 }}
      >
        <Space wrap>
          <Input
            placeholder={`${t('devices.searchPrefix')}IMEI`}
            value={sensorSn}
            onChange={(event) => setSensorSn(event.target.value)}
            onPressEnter={search}
            style={{ width: 220 }}
          />
          <Input
            placeholder={`${t('devices.searchPrefix')}${t('devices.displayName')}`}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onPressEnter={search}
            style={{ width: 220 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={search}>
            {t('common.search')}
          </Button>
        </Space>
      </Card>
      <Card
        style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table<SensorOverviewDto>
          dataSource={sensorPage?.items ?? []}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          size="small"
          scroll={{ x: 960, y: 'calc(100vh - 345px)' }}
          pagination={{
            current: tableQuery.page,
            pageSize: tableQuery.pageSize,
            total,
            pageSizeOptions: [50, 100, 200],
            showSizeChanger: true,
            showTotal: (count, range) =>
              `${range[0]}-${range[1]} / ${t('common.total', { count })}`,
          }}
          onChange={handleTableChange}
          locale={{ emptyText: t('devices.empty') }}
        />
      </Card>
    </>
  );
}

export default function MyDevicesPage() {
  return (
    <AuthGuard>
      <MyDevices />
    </AuthGuard>
  );
}
