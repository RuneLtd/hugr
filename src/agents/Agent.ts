
import type { Joblog } from '../joblog/Joblog.js';
import type { LLMProvider } from '../types/llm.js';
import type { AgentMessage } from '../types/joblog.js';
import type { InterruptRequest } from '../interrupt/types.js';
import { readInterrupt, clearInterrupt } from '../interrupt/handler.js';

export interface AgentConfig {

  id: string;

  name: string;

  joblog: Joblog;

  runtime: LLMProvider;

  pollInterval?: number;

  projectPath?: string;
}

export type MessageInput = Omit<AgentMessage, 'id' | 'timestamp' | 'processed' | 'from'>;

export abstract class Agent {
  readonly id: string;
  readonly name: string;
  protected readonly joblog: Joblog;
  protected readonly runtime: LLMProvider;
  protected readonly pollInterval: number;
  protected readonly projectPath?: string;

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
  }

  async run(): Promise<void> {
    if (this.running) {
      throw new Error(`Agent ${this.id} is already running`);
    }

    this.running = true;
    this.stopRequested = false;
    this.sessionStartTime = new Date();

    try {
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

          try {
            await this.handleMessage(message);
          } catch (error) {
            await this.handleError(error, message);
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
    }
  }

  stop(): void {
    this.stopRequested = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  protected abstract handleMessage(message: AgentMessage): Promise<void>;

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
}
