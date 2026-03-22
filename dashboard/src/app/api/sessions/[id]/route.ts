import { NextRequest, NextResponse } from 'next/server';
import { getDashboardState } from '@/lib/state';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const state = getDashboardState();
  const session = state.sessions.find((s) => s.id === id);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const activities = state.activities[id] ?? [];

  return NextResponse.json({ session, activities });
}
