import { getDashboardState, saveDashboardState, getDataPaths, type TriggerRecord } from './state';
import { loadHugr } from './hugrLoader';

const g = globalThis as unknown as {
  __hugrTriggerEngine?: unknown;
  __hugrTriggerRunning?: boolean;
  __hugrTriggerInitPromise?: Promise<void>;
};

interface TriggerActivity {
  id: string;
  triggerId: string;
  triggerName: string;
  type: 'trigger_fired' | 'trigger_session_started' | 'trigger_session_completed' | 'trigger_session_failed' | 'trigger_error';
  message: string;
  timestamp: string;
  sessionId?: string;
}

function logTriggerActivity(activity: TriggerActivity) {
  const state = getDashboardState();
  if (!state.activities['__triggers']) state.activities['__triggers'] = [];
  state.activities['__triggers'].push({
    id: activity.id,
    type: activity.type,
    message: activity.message,
    agentId: activity.triggerId,
    timestamp: activity.timestamp,
    details: activity.sessionId,
  });
  if (state.activities['__triggers'].length > 200) {
    state.activities['__triggers'] = state.activities['__triggers'].slice(-100);
  }
  saveDashboardState(state);
}

async function createRuntime(): Promise<unknown> {
  const hugr = await loadHugr();
  const { ClaudeCodeRuntime } = hugr;

  let cliPath = 'claude';
  try {
    const { execSync } = await import('child_process');
    cliPath = execSync('which claude 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim() || 'claude';
  } catch {}

  return new ClaudeCodeRuntime({
    cliPath,
    queryTimeout: 300_000,
    executeTimeout: 1_800_000,
    maxRetries: 2,
  });
}

function dashboardTriggersToEngineFormat(triggers: TriggerRecord[]): Record<string, unknown>[] {
  return triggers
    .filter((t) => t.enabled)
    .map((t) => {
      const config: Record<string, unknown> = {
        id: t.id,
        type: t.type,
        enabled: t.enabled,
        task: t.task || 'Triggered task',
        projectPath: t.projectPath,
        autonomy: t.autonomy || 'auto',
        maxConcurrent: t.maxConcurrent || 1,
        cooldown: t.cooldown || 0,
      };

      if (t.type === 'cron' && t.cron) config.cron = t.cron;
      if (t.type === 'webhook' && t.webhook) config.webhook = t.webhook;
      if (t.type === 'poll' && t.poll) config.poll = t.poll;
      if (t.type === 'watch' && t.watch) config.watch = t.watch;

      if (t.workflowId || t.workflowSteps) {
        const state = getDashboardState();
        const wf = state.pipelines.find((p) => p.id === t.workflowId);
        const steps = t.workflowSteps || wf?.steps;
        if (steps) {
          config.metadata = {
            pipeline: {
              name: wf?.name || t.name,
              steps: steps.map((s) => {
                const step: Record<string, unknown> = {
                  agentId: s.agentId,
                  enabled: s.enabled !== false,
                  mode: s.mode,
                  iterations: s.iterations,
                  loopUntilDone: s.loopUntilDone,
                };
                if (!['architect', 'coder', 'raven', 'reviewer'].includes(s.agentId)) {
                  const worker = state.customAgents.find((a) => a.id === s.agentId);
                  if (worker) {
                    step.agentConfig = {
                      name: worker.name,
                      instructions: worker.systemPrompt || '',
                      toolAccess: 'full',
                      allowedTools: worker.tools,
                      selfReview: worker.selfReview,
                    };
                  }
                }
                return step;
              }),
            },
          };
        }
      }

      return config;
    });
}

export async function ensureTriggerScheduler(): Promise<void> {
  if (g.__hugrTriggerInitPromise) return g.__hugrTriggerInitPromise;

  g.__hugrTriggerInitPromise = doInit();
  return g.__hugrTriggerInitPromise;
}

async function doInit(): Promise<void> {
  if (g.__hugrTriggerRunning) return;

  const state = getDashboardState();
  const triggers = state.triggers ?? [];
  const enabled = triggers.filter((t) => t.enabled);

  if (enabled.length === 0) {
    console.log('[TriggerScheduler] No enabled triggers, skipping init');
    return;
  }

  const hugr = await loadHugr();
  if (!hugr || Object.keys(hugr).length === 0) {
    console.warn('[TriggerScheduler] hugr not found');
    return;
  }
  const TriggerRunner = hugr.TriggerRunner;
  const Manager = hugr.Manager;

  if (!TriggerRunner || !Manager) {
    console.warn('[TriggerScheduler] TriggerRunner or Manager not found in hugr exports');
    console.warn('[TriggerScheduler] Available keys:', Object.keys(hugr).join(', '));
    return;
  }

  let runtime: unknown;
  try {
    runtime = await createRuntime();
    const available = await (runtime as any).isAvailable();
    if (!available) {
      console.warn('[TriggerScheduler] Claude CLI not available, cannot start triggers');
      return;
    }
  } catch {
    console.warn('[TriggerScheduler] Failed to create runtime');
    return;
  }

  const defaultPipeline = Manager.buildDefaultPipeline('thorough', { iterations: 1, mode: 'fixed', maxIterations: 3 });

  const triggerConfigs = dashboardTriggersToEngineFormat(triggers);

  const runner = new TriggerRunner({
    triggers: {
      enabled: true,
      triggers: triggerConfigs,
    },
    runtime,
    defaultProjectPath: process.env.HOME || '/tmp',
    defaultPipeline,
    pollInterval: 100,
    log: (msg: string) => console.log(`[TriggerScheduler] ${msg}`),
  });

  runner.events.on('trigger:fired', (data: any) => {
    const triggerName = triggers.find((t) => t.id === data.triggerId)?.name || data.triggerId;
    console.log(`[TriggerScheduler] Trigger fired: ${triggerName}`);
    logTriggerActivity({
      id: `tact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      triggerId: data.triggerId,
      triggerName,
      type: 'trigger_fired',
      message: `Trigger "${triggerName}" fired`,
      timestamp: new Date().toISOString(),
      sessionId: data.sessionId,
    });
  });

  runner.events.on('session:completed', (data: any) => {
    console.log(`[TriggerScheduler] Trigger session completed: ${data.sessionId}`);
    logTriggerActivity({
      id: `tact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      triggerId: '',
      triggerName: '',
      type: 'trigger_session_completed',
      message: `Trigger session completed`,
      timestamp: new Date().toISOString(),
      sessionId: data.sessionId,
    });
  });

  runner.events.on('session:failed', (data: any) => {
    console.log(`[TriggerScheduler] Trigger session failed: ${data.error}`);
    logTriggerActivity({
      id: `tact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      triggerId: '',
      triggerName: '',
      type: 'trigger_session_failed',
      message: `Trigger session failed: ${data.error}`,
      timestamp: new Date().toISOString(),
    });
  });

  runner.events.on('trigger:error', (data: any) => {
    console.log(`[TriggerScheduler] Trigger error: ${data.triggerId} — ${data.error}`);
    logTriggerActivity({
      id: `tact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      triggerId: data.triggerId,
      triggerName: triggers.find((t) => t.id === data.triggerId)?.name || data.triggerId,
      type: 'trigger_error',
      message: `Trigger error: ${data.error}`,
      timestamp: new Date().toISOString(),
    });
  });

  try {
    await runner.start();
    g.__hugrTriggerEngine = runner;
    g.__hugrTriggerRunning = true;
    console.log(`[TriggerScheduler] Started with ${enabled.length} trigger(s)`);
  } catch (err) {
    console.error('[TriggerScheduler] Failed to start:', err);
    g.__hugrTriggerInitPromise = undefined;
  }
}

export async function reloadTriggers(): Promise<void> {
  if (g.__hugrTriggerEngine) {
    try {
      await (g.__hugrTriggerEngine as any).stop();
    } catch {}
    g.__hugrTriggerEngine = undefined;
    g.__hugrTriggerRunning = false;
  }
  g.__hugrTriggerInitPromise = undefined;
  await ensureTriggerScheduler();
}

export function getTriggerRunner(): unknown {
  return g.__hugrTriggerEngine ?? null;
}
