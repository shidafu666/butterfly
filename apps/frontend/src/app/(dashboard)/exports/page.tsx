'use client';

import React, { useEffect, useRef } from 'react';
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
} from 'antd';
import { DownloadOutlined, ReloadOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { api } from '@/lib/api';
import type { ExportJobDto } from '@butterfly/shared-types';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text, Title } = Typography;

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

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExportsPage() {
  const [notifApi, contextHolder] = notification.useNotification();
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: jobs = [], isLoading, refetch } = useQuery({
    queryKey: ['exports'],
    queryFn: async () => {
      const res = await api.get<ExportJobDto[]>('/exports');
      return res.data;
    },
    refetchInterval: false,
  });

  // Auto-refresh if any job is pending/processing
  const hasActiveJobs = jobs.some(
    (j) => j.status === 'pending' || j.status === 'processing'
  );

  useEffect(() => {
    if (hasActiveJobs) {
      intervalRef.current = setInterval(() => {
        refetch();
      }, 5000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hasActiveJobs, refetch]);

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
        (headers['content-disposition']
          ?.split('filename=')[1]
          ?.replace(/"/g, '') ?? `export-${jobId}.csv`);
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
      notifApi.error({ message: '下载失败，请稍后重试。' });
    },
  });

  const columns = [
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
      render: (v: string | null) =>
        v ? <Text code>{v}</Text> : <Text type="secondary">全部</Text>,
    },
    {
      title: '时间范围',
      key: 'timeRange',
      render: (_: unknown, record: ExportJobDto) => (
        <Text style={{ color: '#8b949e', fontSize: 12 }}>
          {dayjs(record.startTime).format('MM/DD HH:mm')}
          {' — '}
          {dayjs(record.endTime).format('MM/DD HH:mm')}
        </Text>
      ),
    },
    {
      title: '分辨率',
      dataIndex: 'resolution',
      key: 'resolution',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '格式',
      dataIndex: 'format',
      key: 'format',
      render: (v: string) => <Tag color="cyan">{v.toUpperCase()}</Tag>,
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
      title: '行数',
      dataIndex: 'rowCount',
      key: 'rowCount',
      render: (v: number | null) =>
        v != null ? v.toLocaleString() : <Text type="secondary">—</Text>,
    },
    {
      title: '文件大小',
      dataIndex: 'fileSize',
      key: 'fileSize',
      render: (v: number | null) => formatFileSize(v),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => (
        <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
          <Text style={{ color: '#8b949e', fontSize: 12 }}>{dayjs(v).fromNow()}</Text>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: ExportJobDto) => (
        <Space>
          <Tooltip
            title={record.status !== 'completed' ? '任务未完成，无法下载' : '下载文件'}
          >
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              disabled={record.status !== 'completed'}
              loading={downloadMutation.isPending && downloadMutation.variables === record.id}
              onClick={() => downloadMutation.mutate(record.id)}
            >
              下载
            </Button>
          </Tooltip>
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
          <Title level={4} style={{ color: '#c9d1d9', margin: 0 }}>
            导出任务
          </Title>
          <Text style={{ color: '#8b949e', fontSize: 13 }}>
            查看和下载数据导出任务
            {hasActiveJobs && (
              <Tag color="blue" style={{ marginLeft: 8 }}>
                5 秒自动刷新
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
          刷新
        </Button>
      </div>

      <Alert
        icon={<ClockCircleOutlined />}
        type="info"
        showIcon
        style={{ marginBottom: 16, background: '#0d2137', border: '1px solid #1d4b6e' }}
        message={
          <Text style={{ color: '#79c0ff', fontSize: 13 }}>
            导出任务自动清理提示
          </Text>
        }
        description={
          <Text style={{ color: '#8b949e', fontSize: 12 }}>
            系统每小时自动清理 <strong style={{ color: '#c9d1d9' }}>24 小时</strong>前创建的导出任务及对应文件。
            如需重新获取数据，请在「电流数据」页面重新创建导出任务。
          </Text>
        }
      />

      <Card
        style={{ background: '#161b22', border: '1px solid #30363d' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          dataSource={jobs}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{
            pageSize: 20,
            showTotal: (total) => `共 ${total} 条`,
            showSizeChanger: false,
          }}
          locale={{ emptyText: '暂无导出任务' }}
          scroll={{ x: 900 }}
          expandable={{
            expandedRowRender: (record: ExportJobDto) =>
              record.errorMessage ? (
                <div style={{ padding: '8px 16px' }}>
                  <Text type="danger">错误信息：{record.errorMessage}</Text>
                </div>
              ) : null,
            rowExpandable: (record: ExportJobDto) => !!record.errorMessage,
          }}
        />
      </Card>
    </div>
  );
}
