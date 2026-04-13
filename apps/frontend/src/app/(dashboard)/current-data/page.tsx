'use client';

import React, { useState, useCallback } from 'react';
import {
  Row,
  Col,
  Card,
  Select,
  Button,
  DatePicker,
  Statistic,
  Table,
  Tag,
  Typography,
  Space,
  Modal,
  Form,
  notification,
  Tooltip,
  Alert,
} from 'antd';
import {
  SearchOutlined,
  ExportOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { api } from '@/lib/api';
import { CurrentDataChart } from '@/components/CurrentDataChart';
import type {
  SensorDto,
  DeviceDto,
  CurrentDataResponse,
  CurrentDataSummary,
  RawDataPoint,
  AggregatedDataPoint,
  CreateExportRequest,
  ExportJobDto,
} from '@butterfly/shared-types';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;
const { Option } = Select;

type Resolution = 'auto' | 'raw' | '1m' | '1h';

interface QueryState {
  sensorSn: string;
  deviceId?: string;
  startTime: string;
  endTime: string;
  resolution: Resolution;
}

export default function CurrentDataPage() {
  const [notifApi, contextHolder] = notification.useNotification();

  const [selectedSensor, setSelectedSensor] = useState<string>('');
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [resolution, setResolution] = useState<Resolution>('auto');
  const [queryState, setQueryState] = useState<QueryState | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'log'>('csv');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 50;

  // Sensors
  const { data: sensors = [], isLoading: sensorsLoading } = useQuery({
    queryKey: ['sensors'],
    queryFn: async () => {
      const res = await api.get<SensorDto[]>('/sensors');
      return res.data;
    },
  });

  // Devices (reload when sensor changes)
  const { data: devices = [], isLoading: devicesLoading } = useQuery({
    queryKey: ['devices', selectedSensor],
    queryFn: async () => {
      if (!selectedSensor) return [];
      const res = await api.get<DeviceDto[]>(`/sensors/${selectedSensor}/devices`);
      return res.data;
    },
    enabled: !!selectedSensor,
  });

  // Current data
  const {
    data: currentData,
    isLoading: dataLoading,
    error: dataError,
    refetch,
  } = useQuery({
    queryKey: ['current-data', queryState],
    queryFn: async () => {
      if (!queryState) return null;
      const res = await api.get<CurrentDataResponse>('/current-data', {
        params: {
          sensorSn: queryState.sensorSn,
          ...(queryState.deviceId ? { deviceId: queryState.deviceId } : {}),
          startTime: queryState.startTime,
          endTime: queryState.endTime,
          resolution: queryState.resolution,
        },
      });
      return res.data;
    },
    enabled: !!queryState,
  });

  // Summary
  const { data: summary } = useQuery({
    queryKey: ['current-data-summary', queryState],
    queryFn: async () => {
      if (!queryState) return null;
      const res = await api.get<CurrentDataSummary>('/current-data/summary', {
        params: {
          sensorSn: queryState.sensorSn,
          ...(queryState.deviceId ? { deviceId: queryState.deviceId } : {}),
          startTime: queryState.startTime,
          endTime: queryState.endTime,
          resolution: queryState.resolution,
        },
      });
      return res.data;
    },
    enabled: !!queryState,
  });

  const handleQuery = useCallback(() => {
    if (!selectedSensor || !timeRange) return;
    setCurrentPage(1);
    setQueryState({
      sensorSn: selectedSensor,
      deviceId: selectedDevice || undefined,
      startTime: timeRange[0].toISOString(),
      endTime: timeRange[1].toISOString(),
      resolution,
    });
  }, [selectedSensor, selectedDevice, timeRange, resolution]);

  // Export mutation
  const exportMutation = useMutation({
    mutationFn: async (req: CreateExportRequest) => {
      const res = await api.post<ExportJobDto>('/exports', req);
      return res.data;
    },
    onSuccess: () => {
      notifApi.success({
        message: '导出任务已创建',
        description: '任务将在后台处理，完成后可在"导出任务"页面下载。',
      });
      setExportModalOpen(false);
    },
    onError: () => {
      notifApi.error({ message: '创建导出任务失败' });
    },
  });

  // The resolved resolution from the last query response (always 'raw' | '1m' | '1h')
  const resolvedResolution = (currentData?.resolution ?? 'raw') as 'raw' | '1m' | '1h';

  const handleExport = () => {
    if (!queryState) return;
    exportMutation.mutate({
      sensorSn: queryState.sensorSn,
      deviceId: queryState.deviceId,
      startTime: queryState.startTime,
      endTime: queryState.endTime,
      resolution: resolvedResolution,
      format: exportFormat,
    });
  };

  const points = currentData?.points ?? [];
  const isAgg = points.length > 0 && 'avgCurrent' in points[0];

  const tableColumns = isAgg
    ? [
        {
          title: '时间',
          dataIndex: 'timestamp',
          key: 'timestamp',
          render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
          width: 180,
        },
        {
          title: '平均电流 (A)',
          dataIndex: 'avgCurrent',
          key: 'avgCurrent',
          render: (v: number) => v?.toFixed(4),
        },
        {
          title: '最小电流 (A)',
          dataIndex: 'minCurrent',
          key: 'minCurrent',
          render: (v: number) => v?.toFixed(4),
        },
        {
          title: '最大电流 (A)',
          dataIndex: 'maxCurrent',
          key: 'maxCurrent',
          render: (v: number) => v?.toFixed(4),
        },
        {
          title: '样本数',
          dataIndex: 'sampleCount',
          key: 'sampleCount',
        },
      ]
    : [
        {
          title: '时间',
          dataIndex: 'timestamp',
          key: 'timestamp',
          render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss.SSS'),
          width: 220,
        },
        {
          title: '电流值 (A)',
          dataIndex: 'currentValue',
          key: 'currentValue',
          render: (v: number) => v?.toFixed(4),
        },
      ];

  const pagedPoints = points.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      {contextHolder}
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ color: '#c9d1d9', margin: 0 }}>
          电流数据查询
        </Title>
        <Text style={{ color: '#8b949e', fontSize: 13 }}>
          查询并可视化传感器电流历史数据
        </Text>
      </div>

      {/* Filter bar */}
      <Card
        style={{ background: '#161b22', border: '1px solid #30363d', marginBottom: 16 }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={12} md={6}>
            <Select
              placeholder="选择传感器"
              style={{ width: '100%' }}
              value={selectedSensor || undefined}
              loading={sensorsLoading}
              onChange={(v) => {
                setSelectedSensor(v);
                setSelectedDevice('');
              }}
              allowClear
            >
              {sensors.map((s) => (
                <Option key={s.sensorSn} value={s.sensorSn}>
                  {s.displayName || s.sensorSn}
                </Option>
              ))}
            </Select>
          </Col>

          <Col xs={24} sm={12} md={5}>
            <Select
              placeholder="选择设备（可选）"
              style={{ width: '100%' }}
              value={selectedDevice || undefined}
              loading={devicesLoading}
              onChange={(v) => setSelectedDevice(v || '')}
              disabled={!selectedSensor}
              allowClear
            >
              {devices.map((d) => (
                <Option key={d.deviceId} value={d.deviceId}>
                  {d.displayName || d.deviceId}
                </Option>
              ))}
            </Select>
          </Col>

          <Col xs={24} sm={14} md={7}>
            <RangePicker
              showTime
              style={{ width: '100%' }}
              value={timeRange}
              onChange={(v) => setTimeRange(v as [Dayjs, Dayjs] | null)}
              presets={[
                { label: '最近 1 小时', value: [dayjs().subtract(1, 'hour'), dayjs()] },
                { label: '最近 6 小时', value: [dayjs().subtract(6, 'hour'), dayjs()] },
                { label: '最近 24 小时', value: [dayjs().subtract(24, 'hour'), dayjs()] },
                { label: '最近 7 天', value: [dayjs().subtract(7, 'day'), dayjs()] },
              ]}
            />
          </Col>

          <Col xs={24} sm={10} md={3}>
            <Select
              style={{ width: '100%' }}
              value={resolution}
              onChange={(v) => setResolution(v as Resolution)}
            >
              <Option value="auto">自动</Option>
              <Option value="raw">原始</Option>
              <Option value="1m">1 分钟</Option>
              <Option value="1h">1 小时</Option>
            </Select>
          </Col>

          <Col xs={24} sm={24} md={3}>
            <Space>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={handleQuery}
                loading={dataLoading}
                disabled={!selectedSensor || !timeRange}
              >
                查询
              </Button>
              {queryState && (
                <Tooltip title="刷新">
                  <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
                </Tooltip>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      {dataError && (
        <Alert
          message="查询失败"
          description="数据加载出错，请检查参数后重试。"
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Summary stats */}
      {summary && (
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {[
            { title: '最小值', value: summary.min != null ? `${summary.min.toFixed(4)} A` : '—' },
            { title: '最大值', value: summary.max != null ? `${summary.max.toFixed(4)} A` : '—' },
            { title: '平均值', value: summary.avg != null ? `${summary.avg.toFixed(4)} A` : '—' },
            { title: '数据点数', value: summary.count.toLocaleString() },
          ].map((item) => (
            <Col xs={12} sm={6} key={item.title}>
              <Card
                style={{ background: '#161b22', border: '1px solid #30363d' }}
                bodyStyle={{ padding: '14px 18px' }}
              >
                <Statistic
                  title={<Text style={{ color: '#8b949e', fontSize: 12 }}>{item.title}</Text>}
                  value={item.value}
                  valueStyle={{ color: '#c9d1d9', fontSize: 18, fontWeight: 600 }}
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* Chart */}
      {currentData && (
        <>
          <Card
            style={{ background: '#161b22', border: '1px solid #30363d', marginBottom: 16 }}
            bodyStyle={{ padding: 16 }}
            title={
              <Space>
                <Text style={{ color: '#c9d1d9' }}>
                  {selectedSensor}
                  {selectedDevice ? ` / ${selectedDevice}` : ''}
                </Text>
                <Tag>{currentData.resolution}</Tag>
                <Text style={{ color: '#8b949e', fontSize: 12 }}>
                  共 {points.length} 个数据点
                </Text>
              </Space>
            }
            extra={
              <Button
                icon={<ExportOutlined />}
                size="small"
                onClick={() => setExportModalOpen(true)}
                disabled={!queryState}
              >
                导出
              </Button>
            }
          >
            <CurrentDataChart
              resolution={currentData.resolution}
              points={points as (RawDataPoint | AggregatedDataPoint)[]}
              sensorSn={currentData.sensorSn}
              deviceId={currentData.deviceId ?? ''}
            />
          </Card>

          {/* Data Table */}
          <Card
            title={<Text style={{ color: '#c9d1d9' }}>数据明细</Text>}
            style={{ background: '#161b22', border: '1px solid #30363d' }}
            bodyStyle={{ padding: 0 }}
          >
            <Table
              dataSource={pagedPoints as (RawDataPoint | AggregatedDataPoint)[]}
              columns={tableColumns as Parameters<typeof Table>[0]['columns']}
              rowKey="timestamp"
              size="small"
              pagination={{
                current: currentPage,
                pageSize: PAGE_SIZE,
                total: points.length,
                onChange: (p) => setCurrentPage(p),
                showSizeChanger: false,
                showTotal: (total) => `共 ${total} 条`,
              }}
              locale={{ emptyText: '无数据' }}
            />
          </Card>
        </>
      )}

      {/* Export Modal */}
      <Modal
        title="创建导出任务"
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={handleExport}
        confirmLoading={exportMutation.isPending}
        okText="创建"
        cancelText="取消"
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="导出格式">
            <Select value={exportFormat} onChange={(v) => setExportFormat(v)}>
              <Option value="csv">CSV</Option>
              <Option value="log">LOG</Option>
            </Select>
          </Form.Item>
          {queryState && (
            <>
              <Form.Item label="传感器">
                <Text code>{queryState.sensorSn}</Text>
              </Form.Item>
              <Form.Item label="时间范围">
                <Text style={{ color: '#8b949e', fontSize: 12 }}>
                  {dayjs(queryState.startTime).format('YYYY-MM-DD HH:mm')} —{' '}
                  {dayjs(queryState.endTime).format('YYYY-MM-DD HH:mm')}
                </Text>
              </Form.Item>
              <Form.Item label="分辨率">
                <Tag>{resolvedResolution}</Tag>
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
