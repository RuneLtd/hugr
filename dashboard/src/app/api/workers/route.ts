import { NextRequest, NextResponse } from 'next/server';
import { getDashboardState, saveDashboardState } from '@/lib/state';

export async function GET() {
  const state = getDashboardState();
  return NextResponse.json({ workers: state.customAgents ?? [] });
}

export async function POST(req: NextRequest) {
  const worker = await req.json();
  const state = getDashboardState();

  const idx = state.customAgents.findIndex((a) => a.id === worker.id);
  if (idx >= 0) {
    state.customAgents[idx] = worker;
  } else {
    state.customAgents.push(worker);
  }

  saveDashboardState(state);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const state = getDashboardState();
  state.customAgents = state.customAgents.filter((a) => a.id !== id);
  saveDashboardState(state);
  return NextResponse.json({ success: true });
}
