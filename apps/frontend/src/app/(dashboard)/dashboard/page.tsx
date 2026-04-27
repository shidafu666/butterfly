'use client';

import React from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Typography, Space, Skeleton } from 'antd';
import {
  ApiOutlined,
  AppstoreOutlined,
  FileOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/LocaleContext';
import type { SensorDto, ExportJobDto } from '@butterfly/shared-types';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  pending: 'gold',
  processing: 'blue',
  completed: 'green',
  failed: 'red',
};

function StatCard({
  title,
  value,
  icon,
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card
      style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
      bodyStyle={{ padding: '20px 24px' }}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} />
      ) : (
        <Space>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: 'rgba(22, 119, 255, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              color: '#1677ff',
            }}
          >
            {icon}
          </div>
          <Statistic
            title={
              <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>{title}</Text>
            }
            value={value}
            valueStyle={{ color: 'var(--brand-text)', fontSize: 24, fontWeight: 600 }}
          />
        </Space>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { t } = useLocale();

  const { data: sensors, isLoading: sensorsLoading } = useQuery({
    queryKey: ['sensors'],
    queryFn: async () => {
      const res = await api.get<SensorDto[]>('/sensors');
      return res.data;
    },
  });

  const { data: exports, isLoading: exportsLoading } = useQuery({
    queryKey: ['exports', 'recent'],
    queryFn: async () => {
      const res = await api.get<ExportJobDto[]>('/exports', { params: { limit: 5 } });
      return res.data;
    },
  });

  // Count total devices by summing across sensors
  const { data: deviceCounts } = useQuery({
    queryKey: ['device-counts', sensors?.map((s) => s.sensorSn)],
    queryFn: async () => {
      if (!sensors) return 0;
      const counts = await Promise.all(
        sensors.map(async (s) => {
          const res = await api.get(`/sensors/${s.sensorSn}/devices`);
          return (res.data as unknown[]).length;
        }),
      );
      return counts.reduce((a, b) => a + b, 0);
    },
    enabled: !!sensors && sensors.length > 0,
  });

  const exportColumns = [
    {
      title: t('common.sensor'),
      dataIndex: 'sensorSn',
      key: 'sensorSn',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: t('common.device'),
      dataIndex: 'deviceId',
      key: 'deviceId',
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: t('common.format'),
      dataIndex: 'format',
      key: 'format',
      render: (v: string) => <Tag>{v.toUpperCase()}</Tag>,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] || 'default'}>
          {t(`status.${v}` as Parameters<typeof t>[0]) || v}
        </Tag>
      ),
    },
    {
      title: t('common.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => (
        <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
          {dayjs(v).fromNow()}
        </Text>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ color: 'var(--brand-text)', margin: 0 }}>
          {t('dashboard.title')}
        </Title>
        <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 13 }}>
          {t('dashboard.subtitle')}
        </Text>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title={t('dashboard.sensors')}
            value={sensors?.length ?? 0}
            icon={<ApiOutlined />}
            loading={sensorsLoading}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title={t('dashboard.devices')}
            value={deviceCounts ?? 0}
            icon={<AppstoreOutlined />}
            loading={sensorsLoading}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title={t('dashboard.exports')}
            value={exports?.length ?? 0}
            icon={<FileOutlined />}
            loading={exportsLoading}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title={t('dashboard.onlineSensors')}
            value={sensors?.filter((s) => s.isActive).length ?? 0}
            icon={<ClockCircleOutlined />}
            loading={sensorsLoading}
          />
        </Col>
      </Row>

      <Card
        title={
          <Space>
            <Text style={{ color: 'var(--brand-text)' }}>{t('dashboard.recentExports')}</Text>
            <Text style={{ color: '#484f58', fontSize: 12, fontWeight: 'normal' }}>
              {t('dashboard.retentionNote')}
            </Text>
          </Space>
        }
        style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          dataSource={exports ?? []}
          columns={exportColumns}
          rowKey="id"
          loading={exportsLoading}
          pagination={false}
          locale={{ emptyText: t('exports.empty') }}
          style={{ background: 'transparent' }}
        />
      </Card>
    </div>
  );
}
