'use client';

import { useEffect, useMemo, useRef } from 'react';
import { notification } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/LocaleContext';
import type { ExportJobDto, SensorDto } from '@butterfly/shared-types';

const NOTIFY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_KEY = 'butterfly_notified_exports';

function readNotifiedIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeNotifiedIds(ids: Set<string>) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage errors
  }
}

/**
 * Global export-job completion notifier. Mount once in the dashboard layout
 * so it survives page navigation and refs are never reset mid-session.
 *
 * Two failure modes addressed:
 * 1. Polling start: the ['exports'] cache may hold stale data (no active jobs)
 *    when a new job is created. The current-data page invalidates ['exports']
 *    on creation, which triggers an immediate refetch → sees pending job →
 *    refetchInterval kicks in at 5 s.
 * 2. Duplicates on refresh: notified job IDs are persisted in sessionStorage
 *    so a hard page reload won't re-fire toasts for recently-completed jobs.
 */
export function ExportJobNotifier() {
  const [notifApi, contextHolder] = notification.useNotification();
  const { t } = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Poll export jobs ──────────────────────────────────────────────────────
  const { data: jobs = [] } = useQuery({
    queryKey: ['exports'],
    queryFn: async () => {
      const res = await api.get<ExportJobDto[]>('/exports');
      return res.data;
    },
    // Automatically polls every 5 s while any job is active.
    // Re-evaluated after every successful fetch.
    refetchInterval: (query) => {
      const data = (query.state.data as ExportJobDto[] | undefined) ?? [];
      return data.some((j) => j.status === 'pending' || j.status === 'processing')
        ? 1000
        : false;
    },
  });

  // ── Sensor display name lookup (shared cache) ─────────────────────────────
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

  // ── Notified-IDs set, seeded from sessionStorage on first mount ───────────
  // Initialiser runs once; subsequent renders reuse the same ref object.
  const notifiedJobIdsRef = useRef<Set<string>>(readNotifiedIds());

  // ── Fire completion notifications ─────────────────────────────────────────
  useEffect(() => {
    if (jobs.length === 0) return;
    const now = Date.now();
    let changed = false;

    jobs.forEach((j) => {
      if (notifiedJobIdsRef.current.has(j.id)) return;
      if (j.status !== 'completed' && j.status !== 'failed') return;
      if (!j.completedAt) return;
      if (now - new Date(j.completedAt).getTime() > NOTIFY_WINDOW_MS) return;

      notifiedJobIdsRef.current.add(j.id);
      changed = true;

      const sensorLabel = sensorDisplayMap[j.sensorSn]
        ? `${j.sensorSn}（${sensorDisplayMap[j.sensorSn]}）`
        : j.sensorSn;

      const onClick = () => {
        router.push('/exports');
        queryClient.invalidateQueries({ queryKey: ['exports'] });
      };

      if (j.status === 'completed') {
        notifApi.success({
          message: t('exports.jobCompleted'),
          description: sensorLabel,
          duration: 5,
          style: { cursor: 'pointer' },
          onClick,
        });
      } else {
        notifApi.error({
          message: t('exports.jobFailed'),
          description: sensorLabel,
          duration: 5,
          style: { cursor: 'pointer' },
          onClick,
        });
      }
    });

    // Persist the updated set so page refreshes don't re-fire old toasts.
    if (changed) writeNotifiedIds(notifiedJobIdsRef.current);
  }, [jobs, sensorDisplayMap, notifApi, t, router, queryClient]);

  return <>{contextHolder}</>;
}
