interface ActiveSessionHandle {
  manager: {
    stop: () => void;
    getSession: () => {
      status: string;
      currentPhase: string;
      currentIteration: number;
      stepResults?: Array<{ agentName: string; summary: string }>;
    } | null;
    events: {
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      emit: (event: string, ...args: unknown[]) => void;
    };
    startSession: (config: unknown) => Promise<string>;
    run: () => Promise<void>;
    submitArchitectAnswers: (answers: Array<{ question: string; answer: string; skipped: boolean }>) => Promise<void>;
  };
  agents: Array<{ stop: () => void; run: () => Promise<void> }>;
  id: string;
}

const g = globalThis as unknown as { __hugrActiveSession?: ActiveSessionHandle | null };

export function getActiveSession(): ActiveSessionHandle | null {
  return g.__hugrActiveSession ?? null;
}

export function setActiveSession(session: ActiveSessionHandle): void {
  g.__hugrActiveSession = session;
}

export function clearActiveSession(): void {
  g.__hugrActiveSession = null;
}
