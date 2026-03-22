import { NextRequest, NextResponse } from 'next/server';
import { getDashboardState, saveDashboardState } from '@/lib/state';
import { getActiveSession, clearActiveSession } from '@/lib/activeSession';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const state = getDashboardState();
  const session = state.sessions.find((s) => s.id === id);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const active = getActiveSession();
  if (active && active.id === id) {
    active.manager.stop();
    active.agents.forEach((a) => a.stop());
    clearActiveSession();
  }

  session.status = 'stopped';
  session.completedAt = new Date().toISOString();
  saveDashboardState(state);

  return NextResponse.json({ success: true });
}
