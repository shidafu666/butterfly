'use client';

import React, { useRef, useState } from 'react';
import {
  Table,
  Typography,
  Card,
  Button,
  Space,
  Tag,
  Tooltip,
  Input,
  Alert,
  message,
} from 'antd';
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
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { api } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import type { SensorOverviewDto } from '@butterfly/shared-types';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text, Title } = Typography;

function DeviceList() {
  const queryClient = useQueryClient();
  const searchInput = useRef<InputRef>(null);
  const [searchText, setSearchText] = useState('');
  const [searchedColumn, setSearchedColumn] = useState('');

  // ── Inline edit state ──────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: sensors, isLoading, error, refetch } = useQuery({
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
      message.success('名称已保存');
    },
    onError: () => {
      message.error('保存失败，请重试');
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
    dataIndex: string,
  ) => {
    confirm();
    setSearchText(selectedKeys[0]);
    setSearchedColumn(dataIndex);
  };

  const handleReset = (
    clearFilters: () => void,
    confirm: FilterDropdownProps['confirm'],
  ) => {
    clearFilters();
    setSearchText('');
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
          placeholder={`搜索 ${placeholder}`}
          value={selectedKeys[0] as string}
          onChange={(e) =>
            setSelectedKeys(e.target.value ? [e.target.value] : [])
          }
          onPressEnter={() =>
            handleSearch(selectedKeys as string[], confirm, dataIndex)
          }
          style={{ marginBottom: 8, display: 'block' }}
        />
        <Space>
          <Button
            type="primary"
            onClick={() =>
              handleSearch(selectedKeys as string[], confirm, dataIndex)
            }
            icon={<SearchOutlined />}
            size="small"
          >
            搜索
          </Button>
          <Button
            onClick={() => clearFilters && handleReset(clearFilters, confirm)}
            size="small"
          >
            重置
          </Button>
        </Space>
      </div>
    ),
    filterIcon: (filtered: boolean) => (
      <SearchOutlined style={{ color: filtered ? '#1677ff' : '#8b949e' }} />
    ),
    onFilter: (value, record) => {
      const val = record[dataIndex];
      return val
        ? String(val).toLowerCase().includes(String(value).toLowerCase())
        : false;
    },
    onFilterDropdownOpenChange: (visible) => {
      if (visible) setTimeout(() => searchInput.current?.select(), 100);
    },
  });

  // ── CSV export ─────────────────────────────────────────────────────────────
  const exportCsv = () => {
    const rows = sensors ?? [];
    const header = ['SN', '显示名称', '最近上报时间', '在线状态', '注册状态', '注册时间'];
    const lines = rows.map((r) =>
      [
        r.sensorSn,
        r.displayName ?? '',
        r.lastReportTime
          ? dayjs(r.lastReportTime).format('YYYY-MM-DD HH:mm:ss')
          : '',
        r.isActive ? 'Active' : 'Inactive',
        r.status,
        dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss'),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csvContent = [header.join(','), ...lines].join('\n');
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
      title: '传感器 SN',
      dataIndex: 'sensorSn',
      key: 'sensorSn',
      width: 180,
      sorter: (a, b) => a.sensorSn.localeCompare(b.sensorSn),
      ...getColumnSearchProps('sensorSn', 'SN'),
      render: (v: string) => (
        <Text code style={{ fontSize: 12, color: '#79c0ff' }}>
          {v}
        </Text>
      ),
    },
    {
      title: '显示名称',
      dataIndex: 'displayName',
      key: 'displayName',
      width: 220,
      ...getColumnSearchProps('displayName', '名称'),
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
                placeholder="输入名称"
              />
              <Tooltip title="保存 (Enter)">
                <Button
                  type="text"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={() => handleSave(record.sensorSn)}
                  loading={isSaving}
                  style={{ color: '#3fb950', padding: '0 4px' }}
                />
              </Tooltip>
              <Tooltip title="取消 (Esc)">
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
                color: v ? '#c9d1d9' : '#484f58',
                fontSize: 13,
                fontStyle: v ? 'normal' : 'italic',
              }}
            >
              {v ?? '未命名'}
            </Text>
            <Tooltip title="编辑名称">
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
      title: '最近上报时间',
      dataIndex: 'lastReportTime',
      key: 'lastReportTime',
      width: 160,
      sorter: (a, b) => {
        if (!a.lastReportTime && !b.lastReportTime) return 0;
        if (!a.lastReportTime) return 1;
        if (!b.lastReportTime) return -1;
        return (
          new Date(a.lastReportTime).getTime() -
          new Date(b.lastReportTime).getTime()
        );
      },
      defaultSortOrder: 'descend',
      render: (v: string | null) =>
        v ? (
          <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
            <Text style={{ color: '#8b949e', fontSize: 12 }}>
              {dayjs(v).fromNow()}
            </Text>
          </Tooltip>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            从未上报
          </Text>
        ),
    },
    {
      title: '在线状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 110,
      filters: [
        { text: 'Active', value: true },
        { text: 'Inactive', value: false },
      ],
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
      title: '注册状态',
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
      title: '注册时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      sorter: (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      render: (v: string) => (
        <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
          <Text style={{ color: '#8b949e', fontSize: 12 }}>
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
        message="加载设备清单失败"
        description="请检查权限后重试。"
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
          <Title level={4} style={{ color: '#c9d1d9', margin: 0 }}>
            设备清单
          </Title>
          <Text style={{ color: '#8b949e', fontSize: 13 }}>
            共 {total} 个传感器 · {activeCount} 个在线
          </Text>
        </div>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => refetch()}
            loading={isLoading}
            style={{ color: '#8b949e' }}
          >
            刷新
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={exportCsv}
            disabled={!sensors?.length}
          >
            导出 CSV
          </Button>
        </Space>
      </div>

      <Card
        style={{ background: '#161b22', border: '1px solid #30363d' }}
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
            showTotal: (t, range) => `${range[0]}-${range[1]} / 共 ${t} 条`,
          }}
          locale={{ emptyText: '暂无设备' }}
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
