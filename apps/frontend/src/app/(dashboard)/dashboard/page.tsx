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
import 'dayjs/locale/zh-cn';
import { api } from '@/lib/api';
import type { SensorDto, ExportJobDto } from '@butterfly/shared-types';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  pending: 'gold',
  processing: 'blue',
  completed: 'green',
  failed: 'red',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
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
      style={{ background: '#161b22', border: '1px solid #30363d' }}
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
            title={<Text style={{ color: '#8b949e', fontSize: 12 }}>{title}</Text>}
            value={value}
            valueStyle={{ color: '#c9d1d9', fontSize: 24, fontWeight: 600 }}
          />
        </Space>
      )}
    </Card>
  );
}

export default function DashboardPage() {
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
        })
      );
      return counts.reduce((a, b) => a + b, 0);
    },
    enabled: !!sensors && sensors.length > 0,
  });

  const exportColumns = [
    {
      title: '传感器',
      dataIndex: 'sensorSn',
      key: 'sensorSn',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: '设备',
      dataIndex: 'deviceId',
      key: 'deviceId',
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: '格式',
      dataIndex: 'format',
      key: 'format',
      render: (v: string) => <Tag>{v.toUpperCase()}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] || 'default'}>{STATUS_LABEL[v] || v}</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => (
        <Text style={{ color: '#8b949e', fontSize: 12 }}>
          {dayjs(v).fromNow()}
        </Text>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ color: '#c9d1d9', margin: 0 }}>
          系统概览
        </Title>
        <Text style={{ color: '#8b949e', fontSize: 13 }}>
          实时监控平台运行状态
        </Text>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="传感器总数"
            value={sensors?.length ?? 0}
            icon={<ApiOutlined />}
            loading={sensorsLoading}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="设备总数"
            value={deviceCounts ?? 0}
            icon={<AppstoreOutlined />}
            loading={sensorsLoading}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="导出任务数"
            value={exports?.length ?? 0}
            icon={<FileOutlined />}
            loading={exportsLoading}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="活跃传感器"
            value={sensors?.filter((s) => s.status === 'active').length ?? 0}
            icon={<ClockCircleOutlined />}
            loading={sensorsLoading}
          />
        </Col>
      </Row>

      <Card
        title={
          <Space>
            <Text style={{ color: '#c9d1d9' }}>最近导出任务</Text>
            <Text style={{ color: '#484f58', fontSize: 12, fontWeight: 'normal' }}>
              · 仅保留 24 小时内
            </Text>
          </Space>
        }
        style={{ background: '#161b22', border: '1px solid #30363d' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          dataSource={exports ?? []}
          columns={exportColumns}
          rowKey="id"
          loading={exportsLoading}
          pagination={false}
          locale={{ emptyText: '暂无导出任务' }}
          style={{ background: 'transparent' }}
        />
      </Card>
    </div>
  );
}
