import { NextRequest, NextResponse } from 'next/server';
import { getDashboardState, saveDashboardState } from '@/lib/state';

export async function GET() {
  const state = getDashboardState();
  const providers: Record<string, { enabled: boolean; hasKey: boolean }> = {};

  for (const [id, config] of Object.entries(state.providerKeys ?? {})) {
    providers[id] = {
      enabled: true,
      hasKey: !!config?.key,
    };
  }

  return NextResponse.json({ providers });
}

export async function POST(req: NextRequest) {
  const { providerId, apiKey } = await req.json();
  const state = getDashboardState();

  if (!state.providerKeys) state.providerKeys = {};
  state.providerKeys[providerId] = { key: apiKey, updatedAt: new Date().toISOString() };

  saveDashboardState(state);
  return NextResponse.json({ success: true });
}
