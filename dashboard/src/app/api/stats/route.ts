import { NextResponse } from 'next/server';
import { getDashboardState } from '@/lib/state';

const BUILT_IN_WORKER_COUNT = 9;

export async function GET() {
  const state = getDashboardState();

  return NextResponse.json({
    activeSessions: state.sessions.filter((s) => s.status === 'running').length,
    totalSessions: state.sessions.length,
    registeredWorkers: BUILT_IN_WORKER_COUNT + state.customAgents.length,
    savedWorkflows: state.pipelines.length,
  });
}
