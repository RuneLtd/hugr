import { NextRequest, NextResponse } from 'next/server';
import { getDashboardState, saveDashboardState } from '@/lib/state';
import { ensureTriggerScheduler, reloadTriggers } from '@/lib/triggerScheduler';
import { loadHugr } from '@/lib/hugrLoader';

async function getTemplates() {
  const hugr = await loadHugr();
  if (hugr?.listTemplates) return hugr.listTemplates();
  return [];
}

export async function GET() {
  const state = getDashboardState();
  const templates = await getTemplates();

  ensureTriggerScheduler().catch((err) =>
    console.warn('[Triggers] Scheduler init error:', err)
  );

  return NextResponse.json({
    triggers: state.triggers ?? [],
    templates,
    workflows: state.pipelines ?? [],
  });
}

export async function POST(req: NextRequest) {
  const trigger = await req.json();
  const state = getDashboardState();

  if (!state.triggers) state.triggers = [];

  const idx = state.triggers.findIndex((t) => t.id === trigger.id);
  if (idx >= 0) {
    state.triggers[idx] = trigger;
  } else {
    state.triggers.push(trigger);
  }

  saveDashboardState(state);

  reloadTriggers().catch((err) =>
    console.warn('[Triggers] Reload error:', err)
  );

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const state = getDashboardState();

  if (!state.triggers) state.triggers = [];
  state.triggers = state.triggers.filter((t) => t.id !== id);

  saveDashboardState(state);

  reloadTriggers().catch((err) =>
    console.warn('[Triggers] Reload error:', err)
  );

  return NextResponse.json({ success: true });
}
