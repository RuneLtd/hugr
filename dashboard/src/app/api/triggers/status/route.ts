import { NextResponse } from 'next/server';
import { getDashboardState } from '@/lib/state';
import { getTriggerRunner } from '@/lib/triggerScheduler';

export async function GET() {
  const runner = getTriggerRunner() as any;
  const state = getDashboardState();
  const triggerActivities = state.activities['__triggers'] ?? [];

  if (!runner) {
    return NextResponse.json({
      running: false,
      triggers: [],
      recentActivity: triggerActivities.slice(-20).reverse(),
    });
  }

  let triggerStates: any[] = [];
  try {
    triggerStates = runner.getTriggerStates?.() ?? [];
  } catch {}

  let activeSessions: any[] = [];
  try {
    activeSessions = (runner.getActiveSessions?.() ?? []).map((s: any) => ({
      triggerId: s.triggerId,
      sessionId: s.sessionId,
      status: s.status,
      startedAt: s.startedAt?.toISOString(),
    }));
  } catch {}

  return NextResponse.json({
    running: runner.isRunning?.() ?? false,
    triggers: triggerStates,
    activeSessions,
    recentActivity: triggerActivities.slice(-20).reverse(),
  });
}
