import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/activeSession';
import { getDashboardState, saveDashboardState } from '@/lib/state';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { answers } = await req.json();

  const active = getActiveSession();
  if (!active || active.id !== id) {
    return NextResponse.json({ error: 'No active session' }, { status: 404 });
  }

  try {
    await active.manager.submitArchitectAnswers(answers);

    const state = getDashboardState();
    const acts = state.activities[id] ?? [];
    acts.push({
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'response',
      message: answers.map((a: { question: string; answer: string }) => `${a.question} → ${a.answer}`).join('; '),
      agentId: 'user',
      timestamp: new Date().toISOString(),
    });
    state.activities[id] = acts;
    saveDashboardState(state);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to submit answers' },
      { status: 500 }
    );
  }
}
