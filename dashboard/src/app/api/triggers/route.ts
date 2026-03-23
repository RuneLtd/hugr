import { NextRequest, NextResponse } from 'next/server';
import { getDashboardState, saveDashboardState } from '@/lib/state';

function getTemplates() {
  try {
    const hugr = require('@runeltd/hugr');
    if (hugr.listTemplates) {
      return hugr.listTemplates();
    }
  } catch {}
  return [];
}

export async function GET() {
  const state = getDashboardState();
  const templates = getTemplates();
  return NextResponse.json({
    triggers: state.triggers ?? [],
    templates,
  });
}

export async function POST(req: NextRequest) {
  const trigger = await req.json();
  const state = getDashboardState();

  if (!state.triggers) state.triggers = [];

  const idx = state.triggers.findIndex((t: any) => t.id === trigger.id);
  if (idx >= 0) {
    state.triggers[idx] = trigger;
  } else {
    state.triggers.push(trigger);
  }

  saveDashboardState(state);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const state = getDashboardState();

  if (!state.triggers) state.triggers = [];
  state.triggers = state.triggers.filter((t: any) => t.id !== id);

  saveDashboardState(state);
  return NextResponse.json({ success: true });
}
