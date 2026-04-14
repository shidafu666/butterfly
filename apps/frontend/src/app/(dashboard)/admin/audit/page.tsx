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
import { useLocale } from '@/contexts/LocaleContext';
import type { AuditLogDto } from '@butterfly/shared-types';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

const ACTION_VALUES = [
  'LOGIN',
  'CREATE_USER',
  'ASSIGN_ROLE',
  'REMOVE_ROLE',
  'ASSIGN_SENSOR_PERMISSION',
  'REVOKE_SENSOR_PERMISSION',
  'CREATE_EXPORT',
  'DOWNLOAD_EXPORT',
  'QUERY_CURRENT_DATA',
  'UPDATE_SENSOR',
  'UPDATE_USER',
  'DELETE_USER',
] as const;

const ACTION_KEY_MAP: Record<string, string> = {
  LOGIN:                    'audit.actions.login',
  CREATE_USER:              'audit.actions.createUser',
  ASSIGN_ROLE:              'audit.actions.assignRole',
  REMOVE_ROLE:              'audit.actions.removeRole',
  ASSIGN_SENSOR_PERMISSION: 'audit.actions.assignSensorPerm',
  REVOKE_SENSOR_PERMISSION: 'audit.actions.revokeSensorPerm',
  CREATE_EXPORT:            'audit.actions.createExport',
  DOWNLOAD_EXPORT:          'audit.actions.downloadExport',
  QUERY_CURRENT_DATA:       'audit.actions.queryCurrentData',
  UPDATE_SENSOR:            'audit.actions.updateSensor',
  UPDATE_USER:              'audit.actions.updateUser',
  DELETE_USER:              'audit.actions.deleteUser',
};

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
  UPDATE_SENSOR:            'lime',
  UPDATE_USER:              'geekblue',
  DELETE_USER:              'red',
};

interface AuditFilter {
  action?: string;
  startTime?: string;
  endTime?: string;
  page: number;
  limit: number;
}

function AuditTable() {
  const { t } = useLocale();
  const [filter, setFilter] = useState<AuditFilter>({ page: 1, limit: 50 });
  const [actionFilter, setActionFilter] = useState<string>('');
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [appliedFilter, setAppliedFilter] = useState<AuditFilter>({ page: 1, limit: 50 });

  const COMMON_ACTIONS = ACTION_VALUES.map((value) => ({
    value,
    label: `${value} — ${t(ACTION_KEY_MAP[value] as Parameters<typeof t>[0])}`,
  }));

  const { data, isLoading, error } = useQuery({
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
      title: t('common.time'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (v: string) => (
        <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
            {dayjs(v).format('MM-DD HH:mm:ss')}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: t('common.user'),
      dataIndex: 'userEmail',
      key: 'userEmail',
      render: (v: string | null) =>
        v ? <Text style={{ fontSize: 13 }}>{v}</Text> : <Text type="secondary">{t('audit.system')}</Text>,
    },
    {
      title: t('common.action'),
      dataIndex: 'action',
      key: 'action',
      render: (v: string) => (
        <Tag color={ACTION_COLOR[v] || 'default'} style={{ fontFamily: 'monospace' }}>
          {v}
        </Tag>
      ),
    },
    {
      title: t('audit.resourceType'),
      dataIndex: 'resourceType',
      key: 'resourceType',
      render: (v: string | null) =>
        v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: t('audit.resourceId'),
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
      title: t('audit.metadata'),
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
            <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12, cursor: 'help' }}>
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
        message={t('audit.loadFailed')}
        description={t('common.checkPermission')}
        type="error"
        showIcon
      />
    );
  }

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ color: 'var(--brand-text)', margin: 0 }}>
          {t('audit.title')}
        </Title>
        <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 13 }}>
          {t('audit.subtitle')}
        </Text>
      </div>

      {/* Filter bar */}
      <Card
        style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)', marginBottom: 16 }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={8} md={6}>
            <Select
              placeholder={t('audit.actionType')}
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
                { label: t('time.today'), value: [dayjs().startOf('day'), dayjs()] },
                { label: t('time.last7d'), value: [dayjs().subtract(7, 'day'), dayjs()] },
                { label: t('time.last30d'), value: [dayjs().subtract(30, 'day'), dayjs()] },
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
                {t('common.query')}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>
                {t('common.reset')}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card
        style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
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
            showTotal: (tot) => t('audit.total', { count: tot }),
            onChange: (page) => {
              const newFilter = { ...filter, page };
              setFilter(newFilter);
              setAppliedFilter(newFilter);
            },
            showSizeChanger: false,
          }}
          locale={{ emptyText: t('audit.empty') }}
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
