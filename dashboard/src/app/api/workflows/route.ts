import { NextRequest, NextResponse } from 'next/server';
import { getDashboardState, saveDashboardState } from '@/lib/state';

export async function GET() {
  const state = getDashboardState();
  return NextResponse.json({ workflows: state.pipelines });
}

export async function POST(req: NextRequest) {
  const workflow = await req.json();
  const state = getDashboardState();

  const idx = state.pipelines.findIndex((p) => p.id === workflow.id);
  if (idx >= 0) {
    state.pipelines[idx] = workflow;
  } else {
    state.pipelines.push(workflow);
  }

  saveDashboardState(state);
  return NextResponse.json({ success: true });
}
