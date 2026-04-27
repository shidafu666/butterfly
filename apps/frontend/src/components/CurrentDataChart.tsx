'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { EChartsOption } from 'echarts';
import { useLocale } from '@/contexts/LocaleContext';
import { useTheme } from '@/contexts/ThemeContext';
import type { RawDataPoint, AggregatedDataPoint } from '@butterfly/shared-types';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface Props {
  resolution: string;
  points: (RawDataPoint | AggregatedDataPoint)[];
  sensorSn: string;
  deviceId: string;
}

function isAggregated(p: RawDataPoint | AggregatedDataPoint): p is AggregatedDataPoint {
  return 'avgCurrent' in p;
}

function formatValue(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(3)} A`;
}

function formatTimestamp(v: string): string {
  const d = new Date(v);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}`;
}

const GRID = { left: 60, right: 24, top: 40, bottom: 64 };

// Theme-specific color palettes for ECharts (must be actual color strings, not CSS vars)
function makeChartColors(isDark: boolean) {
  return {
    axisLabel: { color: isDark ? '#8b949e' : '#57606a', fontSize: 11 },
    splitLine: { lineStyle: { color: isDark ? '#30363d' : '#d0d7de', type: 'dashed' as const } },
    axisLine: { lineStyle: { color: isDark ? '#30363d' : '#d0d7de' } },
    axisTick: { lineStyle: { color: isDark ? '#30363d' : '#d0d7de' } },
    legendText: isDark ? '#8b949e' : '#57606a',
    tooltipBg: isDark ? '#1c2128' : '#ffffff',
    tooltipBorder: isDark ? '#30363d' : '#d0d7de',
    tooltipText: isDark ? '#c9d1d9' : '#24292f',
    chartBg: isDark ? '#161b22' : '#ffffff',
    zoomBg: isDark ? '#1c2128' : '#f0f2f4',
    zoomBorder: isDark ? '#30363d' : '#d0d7de',
    zoomText: isDark ? '#8b949e' : '#57606a',
    noDataText: isDark ? '#8b949e' : '#57606a',
  };
}

export function CurrentDataChart({ resolution, points, sensorSn, deviceId }: Props) {
  const { t } = useLocale();
  const { themeMode } = useTheme();
  const isDark = themeMode === 'dark';

  const option: EChartsOption = useMemo(() => {
    const c = makeChartColors(isDark);

    const AXIS_LABEL_STYLE = c.axisLabel;
    const SPLIT_LINE_STYLE = c.splitLine;
    const TOOLTIP_STYLE = {
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText },
    };
    const DATA_ZOOM_SLIDER = {
      type: 'slider' as const,
      bottom: 8,
      height: 18,
      borderColor: c.zoomBorder,
      backgroundColor: c.zoomBg,
      dataBackground: {
        lineStyle: { color: '#1677ff' },
        areaStyle: { color: '#1677ff22' },
      },
      fillerColor: 'rgba(22,119,255,0.1)',
      handleStyle: { color: '#1677ff' },
      textStyle: { color: c.zoomText, fontSize: 10 },
    };

    if (points.length === 0) {
      return {
        backgroundColor: c.chartBg,
        title: {
          text: t('chart.noData'),
          left: 'center',
          top: 'center',
          textStyle: { color: c.noDataText, fontSize: 14 },
        },
      };
    }

    const useRaw = resolution === 'raw' || !isAggregated(points[0]);

    if (useRaw) {
      const rawPoints = points as RawDataPoint[];
      const times = rawPoints.map((p) => formatTimestamp(p.timestamp));
      const values = rawPoints.map((p) => p.currentValue);
      const label = `${sensorSn}${deviceId ? ' / ' + deviceId : ''}`;

      return {
        backgroundColor: c.chartBg,
        tooltip: {
          trigger: 'axis',
          ...TOOLTIP_STYLE,
          formatter: (params: unknown) => {
            const arr = params as Array<{ axisValue: string; data: number }>;
            if (!arr.length) return '';
            return `${arr[0].axisValue}<br/><b>${formatValue(arr[0].data)}</b>`;
          },
        },
        grid: GRID,
        xAxis: {
          type: 'category',
          data: times,
          axisLabel: { ...AXIS_LABEL_STYLE, rotate: 30 },
          ...c.axisLine,
          axisTick: c.axisTick,
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value',
          name: t('chart.currentUnit'),
          nameTextStyle: { ...AXIS_LABEL_STYLE },
          axisLabel: {
            ...AXIS_LABEL_STYLE,
            formatter: (v: number) => `${v.toFixed(2)}A`,
          },
          axisLine: { show: false },
          ...SPLIT_LINE_STYLE,
        },
        dataZoom: [DATA_ZOOM_SLIDER, { type: 'inside' }],
        series: [
          {
            name: label,
            type: 'line',
            data: values,
            symbol: 'none',
            lineStyle: { color: '#1677ff', width: 1.5 },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(22,119,255,0.25)' },
                  { offset: 1, color: 'rgba(22,119,255,0.02)' },
                ],
              },
            },
          },
        ],
      };
    }

    // Aggregated mode
    const aggPoints = points as AggregatedDataPoint[];
    const times = aggPoints.map((p) => formatTimestamp(p.timestamp));
    const avgData = aggPoints.map((p) => p.avgCurrent);
    const minData = aggPoints.map((p) => p.minCurrent);
    const maxData = aggPoints.map((p) => p.maxCurrent);
    const avgLabel = t('chart.avg');

    return {
      backgroundColor: c.chartBg,
      tooltip: {
        trigger: 'axis',
        ...TOOLTIP_STYLE,
        formatter: (params: unknown) => {
          const arr = params as Array<{ seriesName: string; data: number; axisValue: string }>;
          if (!arr.length) return '';
          let html = `<div style="font-size:12px;margin-bottom:4px">${arr[0].axisValue}</div>`;
          const avg = arr.find((p) => p.seriesName === avgLabel);
          const min = arr.find((p) => p.seriesName === 'Min');
          const max = arr.find((p) => p.seriesName === 'Max');
          if (avg) html += `<div>${t('chart.avgLabel')}: <b>${formatValue(avg.data)}</b></div>`;
          if (min) html += `<div>${t('chart.minLabel')}: <b>${formatValue(min.data)}</b></div>`;
          if (max) html += `<div>${t('chart.maxLabel')}: <b>${formatValue(max.data)}</b></div>`;
          return html;
        },
      },
      legend: {
        data: [avgLabel, 'Min', 'Max'],
        textStyle: { color: c.legendText },
        top: 8,
        right: 24,
      },
      grid: { ...GRID, top: 48 },
      xAxis: {
        type: 'category',
        data: times,
        axisLabel: { ...AXIS_LABEL_STYLE, rotate: 30 },
        ...c.axisLine,
        axisTick: c.axisTick,
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: t('chart.currentUnit'),
        nameTextStyle: { ...AXIS_LABEL_STYLE },
        axisLabel: {
          ...AXIS_LABEL_STYLE,
          formatter: (v: number) => `${v.toFixed(2)}A`,
        },
        axisLine: { show: false },
        ...SPLIT_LINE_STYLE,
      },
      dataZoom: [DATA_ZOOM_SLIDER, { type: 'inside' }],
      series: [
        {
          name: avgLabel,
          type: 'line',
          data: avgData,
          symbol: 'none',
          lineStyle: { color: '#1677ff', width: 2 },
          itemStyle: { color: '#1677ff' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(22,119,255,0.2)' },
                { offset: 1, color: 'rgba(22,119,255,0.02)' },
              ],
            },
          },
          z: 2,
        },
        {
          name: 'Min',
          type: 'line',
          data: minData,
          symbol: 'none',
          lineStyle: { color: '#3fb950', width: 1, type: 'dashed' },
          itemStyle: { color: '#3fb950' },
          z: 1,
        },
        {
          name: 'Max',
          type: 'line',
          data: maxData,
          symbol: 'none',
          lineStyle: { color: '#f85149', width: 1, type: 'dashed' },
          itemStyle: { color: '#f85149' },
          z: 1,
        },
      ],
    };
  }, [points, resolution, sensorSn, deviceId, t, isDark]);

  return (
    <div style={{ height: 360, width: '100%', overflow: 'hidden' }}>
      <ReactECharts
        option={option}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
      />
    </div>
  );
}
