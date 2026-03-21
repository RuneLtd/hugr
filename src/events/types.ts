import type { IsolatedWorkspace } from '../vcs/types.js';

export interface HugrEvents {
    'session:started': (data: { sessionId: string; task: string }) => void;
    'session:completed': (data: {
        sessionId: string;
        status: string;
        durationMs: number;
        iterations: number;
        providerState?: Record<string, unknown>;
    }) => void;
    'session:failed': (data: { sessionId: string; error: string }) => void;
    'session:limited': (data: { sessionId: string; resetTime?: string }) => void;
    'session:resumed': (data: { sessionId: string }) => void;

    'step:started': (data: { stepIndex: number; agentId: string; phaseLabel: string }) => void;
    'step:completed': (data: { stepIndex: number; agentId: string; summary: string }) => void;
    'step:failed': (data: { stepIndex: number; agentId: string; error: string }) => void;

    'iteration:started': (data: { iteration: number; workspacePath: string }) => void;
    'iteration:completed': (data: {
        iteration: number;
        workspacePath: string;
        ref: string;
        providerState?: Record<string, unknown>;
    }) => void;

    'agent:activity': (data: AgentActivityEvent) => void;
    'agent:clarification': (data: ClarificationEvent) => void;

    'job:status-changed': (data: {
        jobId: string;
        oldStatus: string;
        newStatus: string;
        agentId?: string;
        agentName?: string;
    }) => void;
}

export interface AgentActivityEvent {
    agentId: string;
    agentName?: string;
    phaseLabel?: string;
    type: string;
    message: string;
    details?: string;
    jobId?: string;
    iteration?: number;
    tokenUsage?: { input: number; output: number };
}

export interface ClarificationEvent {
    agentId: string;
    jobId: string;
    questions: Array<{
        question: string;
        reason: string;
        options: string[];
        defaultAnswer: string;
    }>;
}
