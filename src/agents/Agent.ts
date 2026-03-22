
import type { Joblog } from '../joblog/Joblog.js';
import type { AgentRuntime } from '../runtime/types.js';
import type { AgentMessage } from '../types/joblog.js';
import type { InterruptRequest } from '../interrupt/types.js';
import { readInterrupt, clearInterrupt } from '../interrupt/handler.js';

export interface AgentConfig {

  id: string;

  name: string;

  joblog: Joblog;

  runtime: AgentRuntime;

  pollInterval?: number;

  projectPath?: string;

  retries?: number;

  timeoutMs?: number;

  skillPrefix?: string;
}

export type MessageInput = Omit<AgentMessage, 'id' | 'timestamp' | 'processed' | 'from'>;

export abstract class Agent {
  readonly id: string;
  readonly name: string;
  protected readonly joblog: Joblog;
  protected readonly runtime: AgentRuntime;
  protected readonly pollInterval: number;
  protected readonly projectPath?: string;
  protected readonly retries: number;
  protected readonly timeoutMs?: number;
  protected readonly skillPrefix?: string;

  protected running = false;
  protected stopRequested = false;
  protected sessionStartTime: Date = new Date();

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.joblog = config.joblog;
    this.runtime = config.runtime;
    this.pollInterval = config.pollInterval ?? 1000;
    this.projectPath = config.projectPath;
    this.retries = config.retries ?? 0;
    this.timeoutMs = config.timeoutMs;
    this.skillPrefix = config.skillPrefix;
  }

  async run(): Promise<void> {
    if (this.running) {
      throw new Error(`Agent ${this.id} is already running`);
    }

    this.running = true;
    this.stopRequested = false;
    this.sessionStartTime = new Date();

    try {
      await this.onStart();

      while (!this.stopRequested) {

        if (this.projectPath) {
          const interrupt = await readInterrupt(this.projectPath, this.sessionStartTime);
          if (interrupt) {
            console.log(`   ⚡ [${this.id}] Interrupt received: ${interrupt.type}`);
            await this.handleInterrupt(interrupt);
            await clearInterrupt(this.projectPath);
            if (interrupt.type === 'stop') {
              this.stopRequested = true;
              break;
            }
          }
        }

        const messages = await this.joblog.getMessages(this.id);

        if (messages.length === 0) {
          await this.sleep(this.pollInterval);
          continue;
        }

        for (const message of messages) {
          if (this.stopRequested) break;

          let lastError: unknown;
          const attempts = 1 + this.retries;

          for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
              if (this.timeoutMs) {
                await Promise.race([
                  this.handleMessage(message),
                  this.createTimeout(this.timeoutMs),
                ]);
              } else {
                await this.handleMessage(message);
              }
              lastError = undefined;
              break;
            } catch (error) {
              lastError = error;
              if (attempt < attempts) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
                await this.sleep(delay);
              }
            }
          }

          if (lastError) {
            await this.onError(lastError, message);
          }

          await this.joblog.markMessageProcessed(message.id);

          if (this.projectPath) {
            const interrupt = await readInterrupt(this.projectPath, this.sessionStartTime);
            if (interrupt) {
              console.log(`   ⚡ [${this.id}] Interrupt received: ${interrupt.type}`);
              await this.handleInterrupt(interrupt);
              await clearInterrupt(this.projectPath);
              if (interrupt.type === 'stop') {
                this.stopRequested = true;
                break;
              }
            }
          }
        }
      }
    } finally {
      this.running = false;
      await this.onStop();
    }
  }

  stop(): void {
    this.stopRequested = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  protected abstract handleMessage(message: AgentMessage): Promise<void>;

  protected async onStart(): Promise<void> {}

  protected async onStop(): Promise<void> {}

  protected async onError(error: unknown, message: AgentMessage): Promise<void> {
    await this.handleError(error, message);
  }

  protected async send(message: MessageInput): Promise<AgentMessage> {
    return this.joblog.sendMessage({
      ...message,
      from: this.id,
    });
  }

  protected async sendResult(
    jobId: string,
    payload: unknown,
    to: string = 'manager'
  ): Promise<AgentMessage> {
    return this.send({
      type: 'task_result',
      to,
      jobId,
      payload,
    });
  }

  protected async requestClarification(
    jobId: string,
    question: string,
    options?: string[]
  ): Promise<AgentMessage> {
    return this.send({
      type: 'clarification_request',
      to: 'manager',
      jobId,
      payload: { question, options },
    });
  }

  protected async handleInterrupt(interrupt: InterruptRequest): Promise<void> {
    switch (interrupt.type) {
      case 'stop':
        console.log(`   ⚡ [${this.id}] Stopping due to interrupt: ${interrupt.reason}`);
        this.stop();
        break;
      case 'redirect':
      case 'modify':
        console.warn(`   ⚡ [${this.id}] Interrupt type '${interrupt.type}' not supported by base agent`);
        break;
    }
  }

  protected async handleError(error: unknown, message: AgentMessage): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await this.joblog.logActivity({
      jobId: message.jobId ?? 'unknown',
      agentId: this.id,
      type: 'error',
      data: {
        messageId: message.id,
        messageType: message.type,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    if (message.jobId) {
      await this.send({
        type: 'task_result',
        to: 'manager',
        jobId: message.jobId,
        payload: {
          success: false,
          error: errorMessage,
        },
      });
    }
  }

  protected async logDecision(
    jobId: string,
    decision: {
      type: 'design' | 'implementation' | 'error-recovery' | 'skip' | 'assumption';
      question: string;
      chosen: string;
      reasoning: string;
      alternatives: string[];
      confidence: number;
    }
  ): Promise<void> {
    await this.joblog.logDecision({
      jobId,
      agentId: this.id,
      ...decision,
    });
  }

  protected async logActivity(
    jobId: string,
    type: 'file_read' | 'file_write' | 'tool_call' | 'llm_call' | 'error',
    data: unknown
  ): Promise<void> {
    await this.joblog.logActivity({
      jobId,
      agentId: this.id,
      type,
      data,
    });
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Agent ${this.id} timed out after ${ms}ms`)), ms)
    );
  }
}
