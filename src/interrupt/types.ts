
export type InterruptType = 'stop' | 'redirect' | 'modify';

export interface InterruptRequest {

  type: InterruptType;

  reason: string;

  timestamp: string;

  sessionId?: string;

  payload?: {

    newTask?: string;

    modifications?: string[];
  };
}

export interface InterruptResult {

  handled: boolean;

  type: InterruptType;

  action: string;

  jobId?: string;
}
