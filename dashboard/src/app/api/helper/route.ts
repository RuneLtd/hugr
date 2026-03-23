import { NextResponse } from 'next/server';
import { getDashboardState, getDataPaths } from '@/lib/state';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync, readFileSync, symlinkSync } from 'fs';
import { loadHugr } from '@/lib/hugrLoader';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface HelperSessionData {
  sessionId: string | null;
  messages: ChatMessage[];
}

const g = globalThis as unknown as { __hugrHelperSessionId?: string | null };

function getHelperFile(): string {
  const { dashboardDir } = getDataPaths();
  return join(dashboardDir, 'helper-chat.json');
}

function loadHelperData(): HelperSessionData {
  try {
    const file = getHelperFile();
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, 'utf-8'));
    }
  } catch {}
  return { sessionId: null, messages: [] };
}

function saveHelperData(data: HelperSessionData): void {
  try {
    const { dashboardDir } = getDataPaths();
    mkdirSync(dashboardDir, { recursive: true });
    writeFileSync(getHelperFile(), JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

function buildSkillContent(): string {
  const state = getDashboardState();
  const { stateFile } = getDataPaths();

  const existingWorkflows = state.pipelines.map(p => `  - "${p.name}" (${p.steps.length} steps: ${p.steps.map(s => s.agentId).join(' → ')})`).join('\n') || '  (none yet)';
  const existingTriggers = state.triggers.map(t => `  - "${t.name}" [${t.type}] ${t.enabled ? 'active' : 'paused'}`).join('\n') || '  (none yet)';
  const existingWorkers = state.customAgents.map(a => `  - "${a.name}": ${a.description}`).join('\n') || '  (none yet)';

  return `You are the Hugr Helper — an assistant built into the Hugr dashboard that helps users create and manage workflows, triggers, and custom workers.

IMPORTANT RULES:
- You can ONLY read and modify the dashboard state file at: ${stateFile}
- NEVER touch source code, project files, or anything outside the dashboard state
- NEVER use Bash to run commands
- You work by reading the current state, understanding what the user wants, then writing updated state back
- Always be conversational and helpful — ask clarifying questions when the user's request is ambiguous
- When you create something, confirm what you created with a clear summary
- Use simple language, not technical jargon

STATE FILE FORMAT:
The state file is JSON with this structure:
{
  "pipelines": [...],      // Saved workflows
  "triggers": [...],       // Configured triggers
  "customAgents": [...],   // Custom workers
  "sessions": [...],       // Past session records (read-only, don't modify)
  "activities": {...},     // Activity logs (read-only, don't modify)
  "providerKeys": {...}    // API keys (NEVER read or modify these)
}

WORKFLOW (pipeline) STRUCTURE:
{
  "id": "workflow-{timestamp}",
  "name": "My Workflow",
  "description": "What this workflow does",
  "steps": [
    { "agentId": "architect", "enabled": true, "iterations": 1 },
    { "agentId": "coder", "enabled": true, "iterations": 1 },
    { "agentId": "reviewer", "enabled": true, "iterations": 1 }
  ]
}
Available agentIds: "architect", "coder", "raven", "reviewer", "planner", "executor", "validator", "router", "aggregator"
- architect: Plans the approach before coding
- coder: Writes and modifies code/files
- raven: Runs tests, builds, and verification
- reviewer: Reviews output for quality
- The most common workflows are: coder-only (quick tasks), architect → coder (planned tasks), architect → coder → reviewer (quality tasks), architect → coder → raven → reviewer (full pipeline)

TRIGGER STRUCTURE:
{
  "id": "trigger-{timestamp}",
  "name": "My Trigger",
  "type": "cron" | "webhook" | "poll" | "watch",
  "enabled": true,
  "task": "What the agents should do when triggered",
  "workflowId": "optional-workflow-id",
  "workflowSteps": [...],  // Copy of workflow steps if workflowId is set
  "projectPath": "/path/to/project",
  "autonomy": "auto",
  "maxConcurrent": 1,
  "cooldown": 0,
  // Type-specific config (include only the one matching "type"):
  "cron": "0 9 * * 1-5",
  "webhook": { "path": "/my-hook", "method": "POST", "secret": "" },
  "poll": { "url": "https://...", "interval": 300, "dedup": false },
  "watch": { "path": "/folder", "pattern": "**/*", "events": ["create", "modify"], "debounce": 1000 }
}
Cron tips: "0 9 * * 1-5" = weekdays 9am, "0 8 * * 1" = Monday 8am, "0 2 * * *" = daily 2am, "0 17 * * 5" = Friday 5pm

CUSTOM WORKER (agent) STRUCTURE:
{
  "id": "agent-{timestamp}",
  "name": "My Worker",
  "type": "custom",
  "description": "What this worker does",
  "systemPrompt": "Detailed instructions for the worker",
  "tools": ["Read", "Write", "Edit", "Bash"],
  "skills": [],
  "selfReview": false,
  "skipGitTracking": true,
  "createdAt": "ISO timestamp"
}

CURRENT DASHBOARD STATE:
Workflows:
${existingWorkflows}

Triggers:
${existingTriggers}

Custom Workers:
${existingWorkers}

WORKFLOW:
1. Read the state file to see what currently exists
2. Ask the user clarifying questions if their request is vague
3. When ready, read the state file, add/modify the relevant array entry, and write it back
4. After saving, summarize what you created/changed
5. The dashboard UI will pick up changes automatically on next page load

NEVER modify "sessions", "activities", or "providerKeys" — those are managed by the system.
Always generate unique IDs using the format "{type}-{timestamp}" (e.g. "trigger-1711234567890").
When creating a trigger with a workflow, copy the workflow steps into "workflowSteps" on the trigger.`;
}

export async function POST(request: Request) {
  try {
    const { message } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const hugr = await loadHugr();
    if (!hugr || !hugr.ClaudeCodeRuntime) {
      return NextResponse.json({ error: 'hugr is not installed or not built' }, { status: 500 });
    }

    const { ClaudeCodeRuntime } = hugr;

    let cliPath = 'claude';
    try {
      const { execSync } = await import('child_process');
      cliPath = execSync('which claude 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim() || 'claude';
    } catch {}

    const runtime = new ClaudeCodeRuntime({
      cliPath,
      queryTimeout: 120_000,
      executeTimeout: 120_000,
      maxRetries: 1,
    });

    const { stateFile, dashboardDir } = getDataPaths();
    const helperData = loadHelperData();
    const skillContent = buildSkillContent();

    const helperWorkdir = join(dashboardDir, 'helper-workdir');
    mkdirSync(helperWorkdir, { recursive: true });

    const stateSymlink = join(helperWorkdir, 'state.json');
    if (!existsSync(stateSymlink)) {
      try {
        symlinkSync(stateFile, stateSymlink);
      } catch {}
    }

    const runtimeOptions: Record<string, unknown> = {
      autoAccept: true,
      skipGitTracking: true,
      skillContent,
      canUseTool: (toolName: string, input: Record<string, unknown>) => {
        if (toolName === 'Bash') {
          return { behavior: 'deny' };
        }

        if (['Read', 'Write', 'Edit'].includes(toolName)) {
          const filePath = (input.file_path ?? input.path ?? '') as string;
          if (filePath && !filePath.includes('state.json') && !filePath.includes(helperWorkdir)) {
            return { behavior: 'deny' };
          }
        }

        return { behavior: 'allow' };
      },
    };

    const sessionId = g.__hugrHelperSessionId ?? helperData.sessionId;
    if (sessionId) {
      runtimeOptions.resume = sessionId;
    }

    let capturedSessionId: string | null = null;
    runtimeOptions.onSessionInit = (id: string) => {
      capturedSessionId = id;
    };

    const result = await runtime.runAgent({
      workdir: helperWorkdir,
      task: message,
      allowedTools: ['Read', 'Write', 'Edit'],
      maxTurns: 15,
      timeout: 120_000,
      runtimeOptions,
    });

    if (capturedSessionId) {
      g.__hugrHelperSessionId = capturedSessionId;
      helperData.sessionId = capturedSessionId;
    }

    let responseText = result.error ?? 'No response';
    if (result.transcript) {
      const resultMarker = result.transcript.lastIndexOf('[Result: success]');
      if (resultMarker >= 0) {
        responseText = result.transcript.slice(resultMarker + '[Result: success]'.length).trim();
      } else {
        const lastResultMarker = result.transcript.lastIndexOf('[Result:');
        if (lastResultMarker >= 0) {
          const afterMarker = result.transcript.indexOf(']', lastResultMarker);
          responseText = result.transcript.slice(afterMarker >= 0 ? afterMarker + 1 : lastResultMarker).trim();
        } else {
          const lines = result.transcript.trim().split('\n');
          const lastTextStart = lines.length > 20 ? lines.length - 20 : 0;
          responseText = lines.slice(lastTextStart).join('\n').trim();
        }
      }
    }
    if (!responseText) responseText = 'Done — check the dashboard for changes.';

    helperData.messages.push(
      { role: 'user', content: message, timestamp: new Date().toISOString() },
      { role: 'assistant', content: responseText, timestamp: new Date().toISOString() },
    );

    saveHelperData(helperData);

    return NextResponse.json({
      response: responseText,
      sessionId: helperData.sessionId,
      success: result.success,
    });

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}

export async function DELETE() {
  g.__hugrHelperSessionId = null;
  saveHelperData({ sessionId: null, messages: [] });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const data = loadHelperData();
  return NextResponse.json({
    messages: data.messages,
    sessionId: data.sessionId,
  });
}
