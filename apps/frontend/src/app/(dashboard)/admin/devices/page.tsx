'use client';

import React, { useRef, useState } from 'react';
import { Table, Typography, Card, Button, Space, Tag, Tooltip, Input, Alert, message } from 'antd';
import type { InputRef, TableColumnType } from 'antd';
import type { FilterDropdownProps } from 'antd/es/table/interface';
import {
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  WifiOutlined,
  DisconnectOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { useLocale } from '@/contexts/LocaleContext';
import type { SensorOverviewDto } from '@butterfly/shared-types';

const { Text, Title } = Typography;

function DeviceList() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const searchInput = useRef<InputRef>(null);

  // ── Inline edit state ──────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // ── Data fetching ──────────────────────────────────────────────────────────
  const {
    data: sensors,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admin-sensors'],
    queryFn: async () => {
      const res = await api.get<SensorOverviewDto[]>('/admin/sensors');
      return res.data;
    },
  });

  // ── Save display name ──────────────────────────────────────────────────────
  const { mutate: saveDisplayName, isPending: isSaving } = useMutation({
    mutationFn: async ({
      sensorSn,
      displayName,
    }: {
      sensorSn: string;
      displayName: string | null;
    }) => {
      await api.patch(`/admin/sensors/${sensorSn}`, { displayName });
    },
    onSuccess: (_, { sensorSn, displayName }) => {
      queryClient.setQueryData<SensorOverviewDto[]>(['admin-sensors'], (old) =>
        old?.map((s) => (s.sensorSn === sensorSn ? { ...s, displayName } : s)),
      );
      setEditingId(null);
      setEditingValue('');
      message.success(t('devices.saveSuccess'));
    },
    onError: () => {
      message.error(t('devices.saveFailed'));
    },
  });

  const startEdit = (record: SensorOverviewDto) => {
    setEditingId(record.id);
    setEditingValue(record.displayName ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue('');
  };

  const handleSave = (sensorSn: string) => {
    const trimmed = editingValue.trim();
    saveDisplayName({ sensorSn, displayName: trimmed || null });
  };

  // ── Column search helpers ──────────────────────────────────────────────────
  const handleSearch = (
    selectedKeys: string[],
    confirm: FilterDropdownProps['confirm'],
    _dataIndex: string,
  ) => {
    confirm();
  };

  const handleReset = (clearFilters: () => void, confirm: FilterDropdownProps['confirm']) => {
    clearFilters();
    confirm();
  };

  const getColumnSearchProps = (
    dataIndex: keyof SensorOverviewDto,
    placeholder: string,
  ): Pick<
    TableColumnType<SensorOverviewDto>,
    'filterDropdown' | 'filterIcon' | 'onFilter' | 'onFilterDropdownOpenChange'
  > => ({
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
      <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
        <Input
          ref={searchInput}
          placeholder={`${t('devices.searchPrefix')}${placeholder}`}
          value={selectedKeys[0] as string}
          onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => handleSearch(selectedKeys as string[], confirm, dataIndex)}
          style={{ marginBottom: 8, display: 'block' }}
        />
        <Space>
          <Button
            type="primary"
            onClick={() => handleSearch(selectedKeys as string[], confirm, dataIndex)}
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
    onFilter: (value, record) => {
      const val = record[dataIndex];
      return val ? String(val).toLowerCase().includes(String(value).toLowerCase()) : false;
    },
    onFilterDropdownOpenChange: (visible) => {
      if (visible) setTimeout(() => searchInput.current?.select(), 100);
    },
  });

  // ── CSV export ─────────────────────────────────────────────────────────────
  const exportCsv = () => {
    const rows = sensors ?? [];
    const csvHeaders = [
      'IMEI',
      t('devices.displayName'),
      t('devices.lastReport'),
      t('devices.onlineStatus'),
      t('devices.regStatus'),
      t('devices.regTime'),
    ];
    const lines = rows.map((r) =>
      [
        r.sensorSn,
        r.displayName ?? '',
        r.lastReportTime ? dayjs(r.lastReportTime).format('YYYY-MM-DD HH:mm:ss') : '',
        r.isActive ? 'Active' : 'Inactive',
        r.status,
        dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss'),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csvContent = [csvHeaders.join(','), ...lines].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devices_${dayjs().format('YYYY-MM-DD')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Table columns ──────────────────────────────────────────────────────────
  const columns: TableColumnType<SensorOverviewDto>[] = [
    {
      title: t('devices.sensorSn'),
      dataIndex: 'sensorSn',
      key: 'sensorSn',
      width: 180,
      sorter: (a, b) => a.sensorSn.localeCompare(b.sensorSn),
      ...getColumnSearchProps('sensorSn', 'IMEI'),
      render: (v: string) => (
        <Text code style={{ fontSize: 12, color: '#79c0ff' }}>
          {v}
        </Text>
      ),
    },
    {
      title: t('devices.displayName'),
      dataIndex: 'displayName',
      key: 'displayName',
      width: 220,
      ...getColumnSearchProps('displayName', t('devices.displayName')),
      render: (v: string | null, record: SensorOverviewDto) => {
        if (editingId === record.id) {
          return (
            <Space size={4}>
              <Input
                size="small"
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onPressEnter={() => handleSave(record.sensorSn)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelEdit();
                }}
                style={{ width: 130 }}
                maxLength={128}
                placeholder={t('devices.namePlaceholder')}
              />
              <Tooltip title={t('devices.saveTooltip')}>
                <Button
                  type="text"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={() => handleSave(record.sensorSn)}
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
          );
        }
        return (
          <Space size={4} className="device-name-cell">
            <Text
              style={{
                color: v ? 'var(--brand-text)' : '#484f58',
                fontSize: 13,
                fontStyle: v ? 'normal' : 'italic',
              }}
            >
              {v ?? t('devices.unnamed')}
            </Text>
            <Tooltip title={t('devices.editName')}>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => startEdit(record)}
                style={{ color: '#484f58', padding: '0 4px' }}
                className="edit-icon"
              />
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: t('devices.lastReport'),
      dataIndex: 'lastReportTime',
      key: 'lastReportTime',
      width: 160,
      sorter: (a, b) => {
        if (!a.lastReportTime && !b.lastReportTime) return 0;
        if (!a.lastReportTime) return 1;
        if (!b.lastReportTime) return -1;
        return new Date(a.lastReportTime).getTime() - new Date(b.lastReportTime).getTime();
      },
      defaultSortOrder: 'descend',
      render: (v: string | null) =>
        v ? (
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
            {dayjs(v).format('YYYY-MM-DD HH:mm:ss')}
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
      filters: [
        { text: 'Active', value: true },
        { text: 'Inactive', value: false },
      ],
      defaultFilteredValue: [true],
      onFilter: (value, record) => record.isActive === value,
      render: (v: boolean) =>
        v ? (
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
      filters: [
        { text: 'active', value: 'active' },
        { text: 'inactive', value: 'inactive' },
      ],
      onFilter: (value, record) => record.status === value,
      render: (v: string) => (
        <Tag color={v === 'active' ? 'blue' : 'default'} style={{ fontSize: 11 }}>
          {v}
        </Tag>
      ),
    },
    {
      title: t('devices.regTime'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      render: (v: string) => (
        <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
            {dayjs(v).format('YYYY-MM-DD')}
          </Text>
        </Tooltip>
      ),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Alert
        message={t('devices.loadFailed')}
        description={t('common.checkPermission')}
        type="error"
        showIcon
      />
    );
  }

  const total = sensors?.length ?? 0;
  const activeCount = sensors?.filter((s) => s.isActive).length ?? 0;

  return (
    <>
      <style>{`
        .device-name-cell .edit-icon { opacity: 0; transition: opacity 0.15s; }
        .ant-table-row:hover .device-name-cell .edit-icon { opacity: 1; }
      `}</style>

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
            {t('devices.title')}
          </Title>
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 13 }}>
            {t('devices.subtitle', { total, active: activeCount })}
          </Text>
        </div>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => refetch()}
            loading={isLoading}
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            {t('common.refresh')}
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!sensors?.length}>
            {t('devices.exportCsv')}
          </Button>
        </Space>
      </div>

      <Card
        style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table<SensorOverviewDto>
          dataSource={sensors ?? []}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          size="small"
          scroll={{ x: 960, y: 'calc(100vh - 280px)' }}
          pagination={{
            defaultPageSize: 100,
            pageSizeOptions: [50, 100, 200],
            showSizeChanger: true,
            showTotal: (t2, range) =>
              `${range[0]}-${range[1]} / ${t('common.total', { count: t2 })}`,
          }}
          locale={{ emptyText: t('devices.empty') }}
        />
      </Card>
    </>
  );
}

export default function DevicesPage() {
  return (
    <AuthGuard requireAdmin>
      <DeviceList />
    </AuthGuard>
  );
}
