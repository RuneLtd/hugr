import { NextRequest, NextResponse } from 'next/server';
import { getDashboardState, saveDashboardState } from '@/lib/state';
import { getActiveSession, setActiveSession, clearActiveSession } from '@/lib/activeSession';
import { WORKFLOW_TEMPLATES } from '@/lib/templates';

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20');
  const state = getDashboardState();
  const sessions = state.sessions.slice(-limit).reverse();
  return NextResponse.json({ sessions });
}

export async function POST(req: NextRequest) {
  const { task, projectPath, pipelineId } = await req.json();
  const state = getDashboardState();

  let pipeline = state.pipelines.find((p) => p.id === pipelineId);
  if (!pipeline) {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === pipelineId);
    if (template) {
      pipeline = { id: template.id, name: template.name, steps: template.steps };
    }
  }
  if (!pipeline) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }

  if (getActiveSession()) {
    return NextResponse.json({ error: 'A session is already running' }, { status: 409 });
  }

  let hugr: Record<string, unknown>;
  try {
    hugr = await import('@runeltd/hugr' as string);
  } catch {
    return NextResponse.json({ error: 'hugr is not installed. Run: npm link @runeltd/hugr' }, { status: 500 });
  }

  const { ClaudeCodeRuntime, Manager, Joblog, Architect, Coder, Raven, Reviewer, CustomAgent } = hugr as Record<string, any>;

  let cliPath = 'claude';
  try {
    const { execSync } = await import('child_process');
    cliPath = execSync('which claude 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim() || 'claude';
  } catch {}

  const runtime = new ClaudeCodeRuntime({
    cliPath,
    queryTimeout: 300_000,
    executeTimeout: 1_800_000,
    maxRetries: 2,
  });

  try {
    const available = await runtime.isAvailable();
    if (!available) {
      return NextResponse.json({ error: 'Claude CLI not available' }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ error: 'Claude CLI not available' }, { status: 500 });
  }

  const sessionId = `session-${Date.now()}`;

  const joblog = new Joblog({ projectPath });
  await joblog.initialize();

  const pipelineConfig = {
    id: pipeline.id,
    name: pipeline.name,
    steps: pipeline.steps.map((s) => ({
      agentId: s.agentId,
      enabled: s.enabled,
      mode: s.mode,
      iterations: s.iterations,
      loopUntilDone: s.loopUntilDone,
    })),
  };

  const manager = new Manager({
    joblog,
    runtime,
    pipelineConfig,
    pollInterval: 100,
  });

  const sessionRecord = {
    id: sessionId,
    task,
    projectPath,
    status: 'running' as const,
    pipeline: { name: pipeline.name, steps: pipeline.steps },
    startedAt: new Date().toISOString(),
    currentPhase: 'starting',
    currentIteration: 0,
  };

  state.sessions.push(sessionRecord);
  state.activities[sessionId] = [];
  saveDashboardState(state);

  const onActivity = (activity: { type: string; message: string; agentId?: string; agentName?: string }) => {
    manager.events?.emit?.('activity', activity);
  };

  const agents: Array<{ stop: () => void; run: () => Promise<void> }> = [];
  const pollInterval = 100;

  const findStep = (id: string) => pipeline!.steps.find((s) => s.agentId === id && s.enabled !== false);

  if (findStep('architect')) {
    agents.push(new Architect({ joblog, runtime, pollInterval, onActivity }));
  }
  const coderStep = findStep('coder');
  if (coderStep) {
    const coderWorker = state.customAgents.find((a) => a.id === 'coder');
    agents.push(new Coder({
      joblog, runtime, pollInterval, projectPath, autoAccept: true, onActivity,
      skipGitTracking: coderStep.skipGitTracking ?? true,
      selfReview: (coderWorker as any)?.selfReview ?? false,
    }));
  }
  if (findStep('raven')) {
    agents.push(new Raven({ joblog, runtime, pollInterval, projectPath, onActivity }));
  }
  if (findStep('reviewer')) {
    agents.push(new Reviewer({ joblog, runtime, pollInterval, projectPath, onActivity }));
  }

  const customSteps = pipeline.steps.filter(
    (s) => s.enabled !== false && !['architect', 'coder', 'raven', 'reviewer'].includes(s.agentId)
  );
  for (const step of customSteps) {
    const customWorker = state.customAgents.find((a) => a.id === step.agentId);
    if (customWorker) {
      agents.push(new CustomAgent({
        id: step.agentId,
        agentConfig: {
          name: customWorker.name,
          description: customWorker.description,
          systemPrompt: customWorker.systemPrompt,
          tools: customWorker.tools,
        },
        joblog,
        runtime,
        pollInterval,
        projectPath,
        onActivity,
      }));
    }
  }

  setActiveSession({ manager, agents, id: sessionId });

  manager.events.on('activity', (activity: { type: string; message: string; agentId?: string; details?: string }) => {
    const fresh = getDashboardState();
    if (!fresh.activities[sessionId]) fresh.activities[sessionId] = [];
    fresh.activities[sessionId].push({
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: activity.type,
      message: activity.message,
      agentId: activity.agentId ?? '',
      timestamp: new Date().toISOString(),
      details: activity.details,
    });

    const session = fresh.sessions.find((s) => s.id === sessionId);
    if (session) {
      const mgrSession = manager.getSession();
      if (mgrSession) {
        session.status = mgrSession.status;
        session.currentPhase = mgrSession.currentPhase;
        session.currentIteration = mgrSession.currentIteration;
        session.stepResults = mgrSession.stepResults;
      }
    }
    saveDashboardState(fresh);
  });

  manager.events.on('session:completed', () => {
    const fresh = getDashboardState();
    const session = fresh.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.status = 'completed';
      session.completedAt = new Date().toISOString();
      const mgrSession = manager.getSession();
      if (mgrSession) {
        session.currentPhase = 'complete';
        session.currentIteration = mgrSession.currentIteration;
        session.stepResults = mgrSession.stepResults;
      }
    }
    saveDashboardState(fresh);
    clearActiveSession();
  });

  manager.events.on('session:failed', ({ error }: { error: string }) => {
    const fresh = getDashboardState();
    const session = fresh.sessions.find((s) => s.id === sessionId);
    if (session) {
      session.status = 'failed';
      session.completedAt = new Date().toISOString();
    }
    if (!fresh.activities[sessionId]) fresh.activities[sessionId] = [];
    fresh.activities[sessionId].push({
      id: `act-${Date.now()}`,
      type: 'error',
      message: error,
      agentId: '',
      timestamp: new Date().toISOString(),
    });
    saveDashboardState(fresh);
    clearActiveSession();
  });

  (async () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};

    try {
      await manager.startSession({
        task,
        projectPath,
        autonomy: 'full',
        isolationMode: 'none',
      });

      const loops = [
        manager.run().catch((err: Error) => console.error('Manager error:', err)),
        ...agents.map((a) => a.run().catch((err: Error) => console.error('Agent error:', err))),
      ];

      await Promise.all(loops);
    } catch (err) {
      console.error('Session execution error:', err);
      const fresh = getDashboardState();
      const session = fresh.sessions.find((s) => s.id === sessionId);
      if (session) {
        session.status = 'failed';
        session.completedAt = new Date().toISOString();
      }
      saveDashboardState(fresh);
      clearActiveSession();
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }
  })();

  return NextResponse.json({ session: sessionRecord });
}
