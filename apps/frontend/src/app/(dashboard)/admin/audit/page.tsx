'use client';

import React, { useState } from 'react';
import {
  Table,
  Typography,
  Space,
  Card,
  Select,
  DatePicker,
  Button,
  Row,
  Col,
  Tag,
  Tooltip,
  Alert,
} from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import type { AuditLogDto } from '@butterfly/shared-types';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

const COMMON_ACTIONS: { value: string; label: string }[] = [
  { value: 'LOGIN',                    label: 'LOGIN — 用户登录' },
  { value: 'CREATE_USER',              label: 'CREATE_USER — 创建用户' },
  { value: 'ASSIGN_ROLE',              label: 'ASSIGN_ROLE — 分配角色' },
  { value: 'REMOVE_ROLE',              label: 'REMOVE_ROLE — 移除角色' },
  { value: 'ASSIGN_SENSOR_PERMISSION', label: 'ASSIGN_SENSOR_PERMISSION — 授权传感器' },
  { value: 'REVOKE_SENSOR_PERMISSION', label: 'REVOKE_SENSOR_PERMISSION — 撤销传感器权限' },
  { value: 'CREATE_EXPORT',            label: 'CREATE_EXPORT — 创建导出任务' },
  { value: 'DOWNLOAD_EXPORT',          label: 'DOWNLOAD_EXPORT — 下载导出文件' },
  { value: 'QUERY_CURRENT_DATA',       label: 'QUERY_CURRENT_DATA — 查询电流数据' },
];

const ACTION_COLOR: Record<string, string> = {
  LOGIN:                    'green',
  CREATE_USER:              'blue',
  ASSIGN_ROLE:              'orange',
  REMOVE_ROLE:              'volcano',
  ASSIGN_SENSOR_PERMISSION: 'gold',
  REVOKE_SENSOR_PERMISSION: 'magenta',
  CREATE_EXPORT:            'cyan',
  DOWNLOAD_EXPORT:          'geekblue',
  QUERY_CURRENT_DATA:       'purple',
};

interface AuditFilter {
  action?: string;
  startTime?: string;
  endTime?: string;
  page: number;
  limit: number;
}

function AuditTable() {
  const [filter, setFilter] = useState<AuditFilter>({ page: 1, limit: 50 });
  const [actionFilter, setActionFilter] = useState<string>('');
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [appliedFilter, setAppliedFilter] = useState<AuditFilter>({ page: 1, limit: 50 });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit-logs', appliedFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        page: appliedFilter.page,
        limit: appliedFilter.limit,
      };
      if (appliedFilter.action) params.action = appliedFilter.action;
      if (appliedFilter.startTime) params.startTime = appliedFilter.startTime;
      if (appliedFilter.endTime) params.endTime = appliedFilter.endTime;
      const res = await api.get<{ items: AuditLogDto[]; total: number; page: number; limit: number }>(
        '/admin/audit-logs',
        { params }
      );
      return { items: res.data.items ?? [], total: res.data.total ?? 0 };
    },
  });

  const handleSearch = () => {
    const newFilter: AuditFilter = {
      page: 1,
      limit: 50,
      action: actionFilter || undefined,
      startTime: timeRange ? timeRange[0].toISOString() : undefined,
      endTime: timeRange ? timeRange[1].toISOString() : undefined,
    };
    setFilter(newFilter);
    setAppliedFilter(newFilter);
  };

  const handleReset = () => {
    setActionFilter('');
    setTimeRange(null);
    const reset: AuditFilter = { page: 1, limit: 50 };
    setFilter(reset);
    setAppliedFilter(reset);
  };

  const logs = data?.items ?? [];
  const total = data?.total ?? 0;

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (v: string) => (
        <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
          <Text style={{ color: '#8b949e', fontSize: 12 }}>
            {dayjs(v).format('MM-DD HH:mm:ss')}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '用户',
      dataIndex: 'userEmail',
      key: 'userEmail',
      render: (v: string | null) =>
        v ? <Text style={{ fontSize: 13 }}>{v}</Text> : <Text type="secondary">系统</Text>,
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      render: (v: string) => (
        <Tag color={ACTION_COLOR[v] || 'default'} style={{ fontFamily: 'monospace' }}>
          {v}
        </Tag>
      ),
    },
    {
      title: '资源类型',
      dataIndex: 'resourceType',
      key: 'resourceType',
      render: (v: string | null) =>
        v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: '资源 ID',
      dataIndex: 'resourceId',
      key: 'resourceId',
      render: (v: string | null) =>
        v ? (
          <Text code style={{ fontSize: 11 }}>
            {v.length > 16 ? `${v.slice(0, 8)}...` : v}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '元数据',
      dataIndex: 'metadata',
      key: 'metadata',
      render: (v: Record<string, unknown> | null) =>
        v ? (
          <Tooltip
            title={
              <pre style={{ fontSize: 11, maxWidth: 300, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(v, null, 2)}
              </pre>
            }
          >
            <Text style={{ color: '#8b949e', fontSize: 12, cursor: 'help' }}>
              {Object.keys(v).join(', ')}
            </Text>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  if (error) {
    return (
      <Alert
        message="加载审计日志失败"
        description="请检查权限后重试。"
        type="error"
        showIcon
      />
    );
  }

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ color: '#c9d1d9', margin: 0 }}>
          审计日志
        </Title>
        <Text style={{ color: '#8b949e', fontSize: 13 }}>
          查看系统操作记录和安全事件
        </Text>
      </div>

      {/* Filter bar */}
      <Card
        style={{ background: '#161b22', border: '1px solid #30363d', marginBottom: 16 }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={8} md={6}>
            <Select
              placeholder="操作类型"
              style={{ width: '100%' }}
              value={actionFilter || undefined}
              onChange={(v) => setActionFilter(v || '')}
              allowClear
            >
              {COMMON_ACTIONS.map((a) => (
                <Option key={a.value} value={a.value}>
                  {a.label}
                </Option>
              ))}
            </Select>
          </Col>

          <Col xs={24} sm={12} md={9}>
            <RangePicker
              showTime
              style={{ width: '100%' }}
              value={timeRange}
              onChange={(v) => setTimeRange(v as [Dayjs, Dayjs] | null)}
              presets={[
                { label: '今天', value: [dayjs().startOf('day'), dayjs()] },
                { label: '最近 7 天', value: [dayjs().subtract(7, 'day'), dayjs()] },
                { label: '最近 30 天', value: [dayjs().subtract(30, 'day'), dayjs()] },
              ]}
            />
          </Col>

          <Col xs={24} sm={4} md={4}>
            <Space>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={handleSearch}
              >
                查询
              </Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>
                重置
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card
        style={{ background: '#161b22', border: '1px solid #30363d' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          dataSource={logs}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{
            current: appliedFilter.page,
            pageSize: appliedFilter.limit,
            total,
            showTotal: (t) => `共 ${t} 条记录`,
            onChange: (page) => {
              const newFilter = { ...filter, page };
              setFilter(newFilter);
              setAppliedFilter(newFilter);
            },
            showSizeChanger: false,
          }}
          locale={{ emptyText: '暂无审计日志' }}
          scroll={{ x: 800 }}
        />
      </Card>
    </>
  );
}

export default function AuditPage() {
  return (
    <AuthGuard requireAuditor>
      <AuditTable />
    </AuthGuard>
  );
}
