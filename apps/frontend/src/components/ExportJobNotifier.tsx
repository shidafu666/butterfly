'use client';

import { useEffect, useMemo, useRef } from 'react';
import { notification } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/LocaleContext';
import type { ExportJobDto, SensorDto } from '@butterfly/shared-types';

const NOTIFY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Renders global export-job notifications that are visible on any page.
 * - Polls /exports every 5 s while any job is pending/processing.
 * - When a job finishes (completed/failed) within the last 5 minutes it fires
 *   a toast; clicking the toast navigates to /exports.
 * - Mount this once in the dashboard layout so refs survive page navigation.
 */
export function ExportJobNotifier() {
  const [notifApi, contextHolder] = notification.useNotification();
  const { t } = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Poll export jobs ─────────────────────────────────────────────────────
  const { data: jobs = [] } = useQuery({
    queryKey: ['exports'],
    queryFn: async () => {
      const res = await api.get<ExportJobDto[]>('/exports');
      return res.data;
    },
    // Refresh every 5 s when there are active jobs; stop otherwise.
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      return data.some((j) => j.status === 'pending' || j.status === 'processing')
        ? 5000
        : false;
    },
  });

  // ── Sensor display name lookup (shared cache with other pages) ───────────
  const { data: sensors = [] } = useQuery({
    queryKey: ['sensors'],
    queryFn: async () => {
      const res = await api.get<SensorDto[]>('/sensors');
      return res.data;
    },
  });

  const sensorDisplayMap = useMemo(() => {
    const m: Record<string, string> = {};
    sensors.forEach((s) => { m[s.sensorSn] = s.displayName ?? ''; });
    return m;
  }, [sensors]);

  // ── Fire completion notifications ─────────────────────────────────────────
  const notifiedJobIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (jobs.length === 0) return;
    const now = Date.now();

    jobs.forEach((j) => {
      if (notifiedJobIdsRef.current.has(j.id)) return;
      if (j.status !== 'completed' && j.status !== 'failed') return;
      if (!j.completedAt) return;
      if (now - new Date(j.completedAt).getTime() > NOTIFY_WINDOW_MS) return;

      notifiedJobIdsRef.current.add(j.id);

      const sensorLabel = sensorDisplayMap[j.sensorSn]
        ? `${j.sensorSn}（${sensorDisplayMap[j.sensorSn]}）`
        : j.sensorSn;

      const onClick = () => {
        router.push('/exports');
        // Ensure the exports table reflects the latest state when navigating.
        queryClient.invalidateQueries({ queryKey: ['exports'] });
      };

      if (j.status === 'completed') {
        notifApi.success({
          message: t('exports.jobCompleted'),
          description: sensorLabel,
          duration: 10,
          style: { cursor: 'pointer' },
          onClick,
        });
      } else {
        notifApi.error({
          message: t('exports.jobFailed'),
          description: sensorLabel,
          duration: 10,
          style: { cursor: 'pointer' },
          onClick,
        });
      }
    });
  }, [jobs, sensorDisplayMap, notifApi, t, router, queryClient]);

  return <>{contextHolder}</>;
}
