import { NextResponse } from 'next/server';
import { getDashboardState } from '@/lib/state';

export async function GET() {
  const state = getDashboardState();

  return NextResponse.json({
    activeSessions: state.sessions.filter((s) => s.status === 'running').length,
    totalSessions: state.sessions.length,
    registeredWorkers: 9 + state.customAgents.length,
    savedWorkflows: state.pipelines.length,
  });
}
