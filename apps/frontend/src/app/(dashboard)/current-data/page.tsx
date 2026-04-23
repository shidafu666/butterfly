'use client';

import React, { useState, useCallback, useEffect } from 'react';
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
  App,
  Tooltip,
  Alert,
} from 'antd';
import {
  SearchOutlined,
  ExportOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { AxiosError } from 'axios';
import { api } from '@/lib/api';
import { CurrentDataChart } from '@/components/CurrentDataChart';
import { useLocale } from '@/contexts/LocaleContext';
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

type Resolution = 'auto' | 'raw' | '1m' | '1h' | '1d';

interface QueryState {
  sensorSn: string;
  deviceId?: string;
  startTime: string;
  endTime: string;
  resolution: Resolution;
}

const MAX_EXPORT_RANGE_MS = 14 * 24 * 60 * 60 * 1000;

function extractApiErrorMessage(error: unknown): string | undefined {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;
  const message = axiosError.response?.data?.message;

  if (Array.isArray(message)) {
    return message[0];
  }

  return typeof message === 'string' ? message : undefined;
}

export default function CurrentDataPage() {
  const { notification: notifApi } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const [selectedSensor, setSelectedSensor] = useState<string>('');
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [resolution, setResolution] = useState<Resolution>('auto');
  const [queryState, setQueryState] = useState<QueryState | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'log'>('csv');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

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

  // Auto-select the first device when the device list loads for a new sensor.
  useEffect(() => {
    if (devices.length > 0) {
      setSelectedDevice(devices[0].deviceId);
    }
  }, [devices]);

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
        message: t('currentData.exportCreated'),
        description: t('currentData.exportCreatedDesc'),
      });
      setExportModalOpen(false);
      // Kick the global notifier into polling mode immediately.
      queryClient.invalidateQueries({ queryKey: ['exports'] });
    },
    onError: (error) => {
      notifApi.error({
        message: t('currentData.exportFailed'),
        description: extractApiErrorMessage(error) ?? t('currentData.exportFailedDesc'),
      });
    },
  });

  // The resolved resolution from the last query response (always 'raw' | '1m' | '1h' | '1d')
  const resolvedResolution = (currentData?.resolution ?? 'raw') as 'raw' | '1m' | '1h' | '1d';

  const resolutionLabel: Record<string, string> = {
    auto: t('currentData.resAuto'),
    raw:  t('currentData.resRaw'),
    '1m': t('currentData.res1m'),
    '1h': t('currentData.res1h'),
    '1d': t('currentData.res1d'),
  };

  const handleExport = () => {
    if (!queryState) return;

    const start = dayjs(queryState.startTime);
    const end = dayjs(queryState.endTime);
    if (end.diff(start) > MAX_EXPORT_RANGE_MS) {
      notifApi.error({
        message: t('currentData.exportFailed'),
        description: t('currentData.exportRangeExceeded'),
      });
      return;
    }

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
          title: t('common.time'),
          dataIndex: 'timestamp',
          key: 'timestamp',
          render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
          width: 180,
        },
        {
          title: t('currentData.avgCurrent'),
          dataIndex: 'avgCurrent',
          key: 'avgCurrent',
          render: (v: number) => v?.toFixed(4),
        },
        {
          title: t('currentData.minCurrent'),
          dataIndex: 'minCurrent',
          key: 'minCurrent',
          render: (v: number) => v?.toFixed(4),
        },
        {
          title: t('currentData.maxCurrent'),
          dataIndex: 'maxCurrent',
          key: 'maxCurrent',
          render: (v: number) => v?.toFixed(4),
        },
        {
          title: t('currentData.sampleCount'),
          dataIndex: 'sampleCount',
          key: 'sampleCount',
        },
      ]
    : [
        {
          title: t('common.time'),
          dataIndex: 'timestamp',
          key: 'timestamp',
          render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss.SSS'),
          width: 220,
        },
        {
          title: t('currentData.currentValue'),
          dataIndex: 'currentValue',
          key: 'currentValue',
          render: (v: number) => v?.toFixed(4),
        },
      ];

  const pagedPoints = points.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ color: 'var(--brand-text)', margin: 0 }}>
          {t('currentData.title')}
        </Title>
        <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 13 }}>
          {t('currentData.subtitle')}
        </Text>
      </div>

      {/* Filter bar */}
      <Card
        style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)', marginBottom: 16 }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Row gutter={[12, 16]} align="top">
          <Col xs={24} sm={12} md={6}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>{t('currentData.sensorLabel')}</Text>
              <Select
                placeholder={t('currentData.selectSensor')}
                style={{ width: '100%' }}
                value={selectedSensor || undefined}
                loading={sensorsLoading}
                onChange={(v) => {
                  setSelectedSensor(v);
                  setSelectedDevice('');
                }}
                allowClear
                showSearch
                filterOption={(input, option) =>
                  String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
              >
                {sensors.map((s) => (
                  <Option key={s.sensorSn} value={s.sensorSn}>
                    <span style={{ fontFamily: 'monospace' }}>{s.sensorSn}</span>
                    {s.displayName && (
                      <span style={{ color: 'var(--brand-text-secondary)', marginLeft: 8, fontSize: 12 }}>
                        {s.displayName}
                      </span>
                    )}
                  </Option>
                ))}
              </Select>
            </Space>
          </Col>

          <Col xs={24} sm={12} md={3}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>{t('currentData.deviceLabel')}</Text>
              <Select
                placeholder={t('currentData.selectDevice')}
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
            </Space>
          </Col>

          <Col xs={24} sm={14} md={9}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>{t('currentData.timeRangeLabel')}</Text>
              <RangePicker
                showTime
                style={{ width: '100%' }}
                value={timeRange}
                onChange={(v) => setTimeRange(v as [Dayjs, Dayjs] | null)}
                presets={[
                  { label: t('time.last1h'), value: [dayjs().subtract(1, 'hour'), dayjs()] },
                  { label: t('time.last6h'), value: [dayjs().subtract(6, 'hour'), dayjs()] },
                  { label: t('time.last24h'), value: [dayjs().subtract(24, 'hour'), dayjs()] },
                  { label: t('time.last7d'), value: [dayjs().subtract(7, 'day'), dayjs()] },
                ]}
              />
            </Space>
          </Col>

          <Col xs={24} sm={10} md={3}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>{t('currentData.resolutionLabel')}</Text>
              <Select
                style={{ width: '100%' }}
                value={resolution}
                onChange={(v) => setResolution(v as Resolution)}
              >
                <Option value="auto">{t('currentData.resAuto')}</Option>
                <Option value="raw">{t('currentData.resRaw')}</Option>
                <Option value="1m">{t('currentData.res1m')}</Option>
                <Option value="1h">{t('currentData.res1h')}</Option>
                <Option value="1d">{t('currentData.res1d')}</Option>
              </Select>
            </Space>
          </Col>

          <Col xs={24} sm={24} md={3}>
            <Space direction="vertical" size={2}>
              <Text style={{ color: 'transparent', fontSize: 12, userSelect: 'none' }}>{'.'}</Text>
              <Space>
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={handleQuery}
                  loading={dataLoading}
                  disabled={!selectedSensor || !timeRange}
                >
                  {t('common.query')}
                </Button>
                {queryState && (
                  <Tooltip title={t('common.refresh')}>
                    <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
                  </Tooltip>
                )}
              </Space>
            </Space>
          </Col>
        </Row>
      </Card>

      {dataError && (
        <Alert
          message={t('currentData.queryFailed')}
          description={t('currentData.queryFailedDesc')}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Summary stats */}
      {summary && (
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {[
            { title: t('currentData.min'), value: summary.min != null ? `${summary.min.toFixed(4)} A` : '—' },
            { title: t('currentData.max'), value: summary.max != null ? `${summary.max.toFixed(4)} A` : '—' },
            { title: t('currentData.avg'), value: summary.avg != null ? `${summary.avg.toFixed(4)} A` : '—' },
            { title: t('currentData.count'), value: summary.count.toLocaleString() },
          ].map((item) => (
            <Col xs={12} sm={6} key={item.title}>
              <Card
                style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
                bodyStyle={{ padding: '14px 18px' }}
              >
                <Statistic
                  title={<Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>{item.title}</Text>}
                  value={item.value}
                  valueStyle={{ color: 'var(--brand-text)', fontSize: 18, fontWeight: 600 }}
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
            style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)', marginBottom: 16 }}
            bodyStyle={{ padding: '12px 16px 16px' }}
            title={
              <Space>
                <Text style={{ color: 'var(--brand-text)' }}>
                  {selectedSensor}
                  {selectedDevice ? ` / ${selectedDevice}` : ''}
                </Text>
                <Tag>{resolutionLabel[currentData.resolution] ?? currentData.resolution}</Tag>
                <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
                  {t('currentData.pointCount', { count: points.length })}
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
                {t('common.export')}
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
            title={<Text style={{ color: 'var(--brand-text)' }}>{t('currentData.dataDetail')}</Text>}
            style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
            bodyStyle={{ padding: 0 }}
          >
            <Table
              dataSource={pagedPoints as (RawDataPoint | AggregatedDataPoint)[]}
              columns={tableColumns as Parameters<typeof Table>[0]['columns']}
              rowKey="timestamp"
              size="small"
              pagination={{
                current: currentPage,
                pageSize,
                total: points.length,
                onChange: (p) => setCurrentPage(p),
                onShowSizeChange: (_, size) => { setPageSize(size); setCurrentPage(1); },
                showSizeChanger: true,
                pageSizeOptions: [20, 50, 100],
                showTotal: (total) => t('common.total', { count: total }),
              }}
              locale={{ emptyText: t('currentData.noData') }}
            />
          </Card>
        </>
      )}

      {/* Export Modal */}
      <Modal
        title={t('currentData.createExport')}
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={handleExport}
        confirmLoading={exportMutation.isPending}
        okText={t('common.create')}
        cancelText={t('common.cancel')}
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label={t('currentData.exportFormat')}>
            <Select value={exportFormat} onChange={(v) => setExportFormat(v)}>
              <Option value="csv">CSV</Option>
              <Option value="log">LOG</Option>
            </Select>
          </Form.Item>
          {queryState && (
            <>
              <Form.Item label={t('common.sensor')}>
                <Text code>{queryState.sensorSn}</Text>
              </Form.Item>
              <Form.Item label={t('common.timeRange')}>
                <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
                  {dayjs(queryState.startTime).format('YYYY-MM-DD HH:mm')} —{' '}
                  {dayjs(queryState.endTime).format('YYYY-MM-DD HH:mm')}
                </Text>
              </Form.Item>
              <Form.Item label={t('common.resolution')}>
                <Tag>{resolutionLabel[resolvedResolution] ?? resolvedResolution}</Tag>
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
