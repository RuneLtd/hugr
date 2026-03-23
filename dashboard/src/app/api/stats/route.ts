import { NextResponse } from 'next/server';
import { getDashboardState } from '@/lib/state';
import { ensureTriggerScheduler } from '@/lib/triggerScheduler';

const BUILT_IN_WORKER_COUNT = 9;

export async function GET() {
  const state = getDashboardState();

  const triggers = state.triggers ?? [];

  ensureTriggerScheduler().catch((err) =>
    console.warn('[Stats] Trigger scheduler init error:', err)
  );

  return NextResponse.json({
    activeSessions: state.sessions.filter((s) => s.status === 'running').length,
    totalSessions: state.sessions.length,
    registeredWorkers: BUILT_IN_WORKER_COUNT + state.customAgents.length,
    savedWorkflows: state.pipelines.length,
    activeTriggers: triggers.filter((t) => t.enabled).length,
    totalTriggers: triggers.length,
  });
}
