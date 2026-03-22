import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getDashboardState } from '@/lib/state';
import { PROVIDER_TOOLS, type ToolDefinition } from '@/lib/providerTools';

export async function GET() {
  const state = getDashboardState();
  const tools: ToolDefinition[] = [];
  const seen = new Set<string>();

  let claudeCodeAvailable = false;
  try {
    execSync('which claude 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
    claudeCodeAvailable = true;
  } catch {}

  if (claudeCodeAvailable) {
    for (const tool of PROVIDER_TOOLS['claude-code']) {
      if (!seen.has(tool.id)) {
        seen.add(tool.id);
        tools.push(tool);
      }
    }
  }

  for (const [providerId, config] of Object.entries(state.providerKeys ?? {})) {
    if (!config?.key) continue;
    const providerTools = PROVIDER_TOOLS[providerId];
    if (!providerTools) continue;
    for (const tool of providerTools) {
      if (!seen.has(tool.id)) {
        seen.add(tool.id);
        tools.push(tool);
      }
    }
  }

  return NextResponse.json({ tools });
}
