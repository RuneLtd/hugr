'use client';

import { useState, useCallback } from 'react';
import { usePolling } from './usePolling';

interface DashboardStats {
  activeSessions: number;
  totalSessions: number;
  registeredWorkers: number;
  savedWorkflows: number;
}

const DEFAULT_STATS: DashboardStats = {
  activeSessions: 0,
  totalSessions: 0,
  registeredWorkers: 0,
  savedWorkflows: 0,
};

export function useDashboardStats(pollInterval = 5000) {
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  usePolling(fetchStats, { interval: pollInterval });

  return { stats, loading };
}
