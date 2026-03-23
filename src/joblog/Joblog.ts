
import { join } from 'node:path';
import { JsonlStorage, generateId } from './Storage';
import { JOBLOG_DIR, JOBLOG_FILES } from '../constants';
import { resolveSessionDataDir } from '../paths';
import type {
  IJoblog,
  Job,
  JobStatus,
  JobFilter,
  JobOutput,
  JobError,
  CreateJobInput,
  AgentMessage,
  DecisionEntry,
  ActivityEntry,
  JoblogEntry,
} from '../types/joblog.js';

const MAX_RETRY_ATTEMPTS = 5;

const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ['in_progress', 'failed'],
  in_progress: ['complete', 'failed', 'pending'],
  complete: [],
  failed: ['pending'],
};

export interface JoblogOptions {
  projectPath: string;
}

export class Joblog implements IJoblog {
  private readonly storage: JsonlStorage;
  private readonly projectPath: string;
  private jobs: Map<string, Job> = new Map();
  private messages: Map<string, AgentMessage> = new Map();
  private jobHistory: Map<string, JoblogEntry[]> = new Map();

  private unprocessedInbox: Map<string, Set<string>> = new Map();
  private initialized = false;

  constructor(options: JoblogOptions) {
    this.projectPath = options.projectPath;
    this.storage = new JsonlStorage({
      directory: join(resolveSessionDataDir(options.projectPath), JOBLOG_DIR),
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.storage.initialize();

    await this.compact();
    await this.rebuild();
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  async reset(): Promise<void> {

    await this.storage.initialize();

    await Promise.all([
      this.storage.delete(JOBLOG_FILES.jobs),
      this.storage.delete(JOBLOG_FILES.messages),
      this.storage.delete(JOBLOG_FILES.decisions),
      this.storage.delete(JOBLOG_FILES.activity),
    ]);

    this.jobs.clear();
    this.messages.clear();
    this.jobHistory.clear();
    this.unprocessedInbox.clear();
    this.initialized = false;
  }

  async compact(): Promise<void> {
    const [jobsBefore, msgsBefore] = await Promise.all([
      this.storage.readAll<Job>(JOBLOG_FILES.jobs),
      this.storage.readAll<AgentMessage>(JOBLOG_FILES.messages),
    ]);

    const jobsUnique = new Set(jobsBefore.map(j => j.id)).size;
    const msgsUnique = new Set(msgsBefore.map(m => m.id)).size;

    const compacted: string[] = [];

    if (jobsBefore.length > jobsUnique * 1.25) {
      const kept = await this.storage.compact<Job>(JOBLOG_FILES.jobs);
      compacted.push(`jobs ${jobsBefore.length}→${kept}`);
    }

    if (msgsBefore.length > msgsUnique * 1.25) {
      const kept = await this.storage.compact<AgentMessage>(JOBLOG_FILES.messages);
      compacted.push(`messages ${msgsBefore.length}→${kept}`);
    }

    if (compacted.length > 0) {
      console.log(`🗜️  Compacted: ${compacted.join(', ')}`);
    }
  }

  async rebuild(): Promise<void> {

    const [allJobs, allMessages, allDecisions, allActivities] = await Promise.all([
      this.storage.readAll<Job>(JOBLOG_FILES.jobs),
      this.storage.readAll<AgentMessage>(JOBLOG_FILES.messages),
      this.storage.readAll<DecisionEntry>(JOBLOG_FILES.decisions),
      this.storage.readAll<ActivityEntry>(JOBLOG_FILES.activity),
    ]);

    for (const job of allJobs) {
      job.createdAt = this.ensureDate(job.createdAt);
      if (job.startedAt) job.startedAt = this.ensureDate(job.startedAt);
      if (job.completedAt) job.completedAt = this.ensureDate(job.completedAt);
    }

    for (const msg of allMessages) {
      msg.timestamp = this.ensureDate(msg.timestamp);
      if (msg.processedAt) msg.processedAt = this.ensureDate(msg.processedAt);
    }

    for (const dec of allDecisions) {
      dec.timestamp = this.ensureDate(dec.timestamp);
    }

    for (const act of allActivities) {
      act.timestamp = this.ensureDate(act.timestamp);
    }

    this.jobs = new Map();
    for (const job of allJobs) {
      this.jobs.set(job.id, job);
    }

    this.messages = new Map();
    this.unprocessedInbox.clear();
    for (const msg of allMessages) {
      this.messages.set(msg.id, msg);

      if (!msg.processed) {
        let inbox = this.unprocessedInbox.get(msg.to);
        if (!inbox) {
          inbox = new Set();
          this.unprocessedInbox.set(msg.to, inbox);
        }
        inbox.add(msg.id);
      }
    }

    this.jobHistory.clear();

    for (const job of allJobs) {
      if (!this.jobHistory.has(job.id)) {
        this.jobHistory.set(job.id, []);
      }
      this.jobHistory.get(job.id)!.push({ type: 'job', timestamp: job.createdAt, data: job });
    }

    for (const msg of allMessages) {
      if (msg.jobId) {
        if (!this.jobHistory.has(msg.jobId)) {
          this.jobHistory.set(msg.jobId, []);
        }
        this.jobHistory.get(msg.jobId)!.push({ type: 'message', timestamp: msg.timestamp, data: msg });
      }
    }

    for (const dec of allDecisions) {
      if (!this.jobHistory.has(dec.jobId)) {
        this.jobHistory.set(dec.jobId, []);
      }
      this.jobHistory.get(dec.jobId)!.push({ type: 'decision', timestamp: dec.timestamp, data: dec });
    }

    for (const act of allActivities) {
      if (!this.jobHistory.has(act.jobId)) {
        this.jobHistory.set(act.jobId, []);
      }
      this.jobHistory.get(act.jobId)!.push({ type: 'activity', timestamp: act.timestamp, data: act });
    }

    for (const entries of this.jobHistory.values()) {
      entries.sort((a, b) => this.getDateMs(a.timestamp) - this.getDateMs(b.timestamp));
    }
  }

  private ensureDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (isNaN(parsed.getTime())) {
        throw new JoblogError(
          `Invalid date string: "${value}"`,
          'STORAGE_ERROR'
        );
      }
      return parsed;
    }
    if (value && typeof value === 'object' && '__type' in value) {
      const obj = value as { __type: string; value: string };
      if (obj.__type === 'Date') {
        const parsed = new Date(obj.value);
        if (isNaN(parsed.getTime())) {
          throw new JoblogError(
            `Invalid serialized date: "${obj.value}"`,
            'STORAGE_ERROR'
          );
        }
        return parsed;
      }
    }
    throw new JoblogError(
      `Cannot convert value to Date: ${JSON.stringify(value)}`,
      'STORAGE_ERROR'
    );
  }

  async createJob(input: CreateJobInput): Promise<Job> {
    this.ensureInitialized();

    const job: Job = {
      ...input,
      id: generateId('job'),
      status: input.status ?? 'pending',
      attempts: input.attempts ?? 0,
      createdAt: new Date(),
      dependencies: input.dependencies ?? [],
    };

    await this.storage.append(JOBLOG_FILES.jobs, job);
    this.jobs.set(job.id, job);

    if (!this.jobHistory.has(job.id)) {
      this.jobHistory.set(job.id, []);
    }
    this.jobHistory.get(job.id)!.push({ type: 'job', timestamp: job.createdAt, data: job });

    return { ...job };
  }

  async getJob(id: string): Promise<Job | null> {
    this.ensureInitialized();
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  async listJobs(filter?: JobFilter): Promise<Job[]> {
    this.ensureInitialized();

    let jobs = Array.from(this.jobs.values());

    if (filter) {
      jobs = jobs.filter((job) => {
        if (filter.status) {
          const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
          if (!statuses.includes(job.status)) return false;
        }
        if (filter.phase && job.phase !== filter.phase) return false;
        if (filter.assignedAgent && job.assignedAgent !== filter.assignedAgent) return false;
        if (filter.tags && !filter.tags.some((t) => job.tags?.includes(t))) return false;
        if (filter.parent !== undefined) {
          if (filter.parent === null && job.parent) return false;
          if (filter.parent !== null && job.parent !== filter.parent) return false;
        }
        return true;
      });
    }

    jobs.sort((a, b) => {
      const aTime = this.getDateMs(a.createdAt);
      const bTime = this.getDateMs(b.createdAt);
      return aTime - bTime;
    });

    return jobs.map((j) => ({ ...j }));
  }

  private getDateMs(date: unknown): number {
    if (date instanceof Date) return date.getTime();
    if (typeof date === 'string') return new Date(date).getTime();
    if (date && typeof date === 'object' && '__type' in date) {
      const obj = date as { __type: string; value: string };
      if (obj.__type === 'Date') return new Date(obj.value).getTime();
    }
    return 0;
  }

  async updateJob(id: string, changes: Partial<Job>): Promise<Job> {
    this.ensureInitialized();

    const job = this.jobs.get(id);
    if (!job) {
      throw new JoblogError(`Job not found: ${id}`, 'JOB_NOT_FOUND');
    }

    if (changes.status && changes.status !== job.status) {
      this.validateTransition(job.status, changes.status);
    }

    const updated: Job = {
      ...job,
      ...changes,
      id: job.id,
      createdAt: job.createdAt,
    };

    await this.storage.append(JOBLOG_FILES.jobs, updated);
    this.jobs.set(id, updated);

    if (!this.jobHistory.has(id)) {
      this.jobHistory.set(id, []);
    }

    const entryTimestamp = updated.completedAt ?? updated.startedAt ?? updated.createdAt;
    this.jobHistory.get(id)!.push({ type: 'job', timestamp: entryTimestamp, data: updated });

    return { ...updated };
  }

  async startJob(id: string, agentId: string): Promise<Job> {
    const job = await this.getJob(id);
    if (!job) {
      throw new JoblogError(`Job not found: ${id}`, 'JOB_NOT_FOUND');
    }

    if (job.status !== 'pending') {
      throw new JoblogError(`Cannot start job in status: ${job.status}`, 'INVALID_TRANSITION');
    }

    if (job.attempts >= MAX_RETRY_ATTEMPTS) {
      return this.failJob(id, {
        type: 'unknown',
        message: `Job exceeded maximum retry attempts (${MAX_RETRY_ATTEMPTS})`,
      });
    }

    return this.updateJob(id, {
      status: 'in_progress',
      assignedAgent: agentId,
      startedAt: job.startedAt ?? new Date(),
      attempts: job.attempts + 1,
    });
  }

  async completeJob(id: string, output: JobOutput): Promise<Job> {
    const job = await this.getJob(id);
    if (!job) {
      throw new JoblogError(`Job not found: ${id}`, 'JOB_NOT_FOUND');
    }

    if (job.status === 'complete') {
      throw new JoblogError(`Job already completed: ${id}`, 'INVALID_TRANSITION');
    }

    return this.updateJob(id, {
      status: 'complete',
      completedAt: new Date(),
      output,
    });
  }

  async failJob(id: string, error: Omit<JobError, 'lastAttempt'>): Promise<Job> {
    const job = await this.getJob(id);
    if (!job) {
      throw new JoblogError(`Job not found: ${id}`, 'JOB_NOT_FOUND');
    }

    if (job.status === 'failed') {
      throw new JoblogError(`Job already failed: ${id}`, 'INVALID_TRANSITION');
    }

    return this.updateJob(id, {
      status: 'failed',
      completedAt: new Date(),
      error: { ...error, lastAttempt: new Date() },
    });
  }

  async getNextJob(agentId?: string, options?: { phase?: string }): Promise<Job | null> {
    this.ensureInitialized();

    let candidates = Array.from(this.jobs.values())
      .filter((j) => j.status === 'pending');

    if (options?.phase) {
      candidates = candidates.filter((j) => j.phase === options.phase);
    }

    candidates.sort((a, b) => this.getDateMs(a.createdAt) - this.getDateMs(b.createdAt));

    if (candidates.length === 0) return null;
    return { ...candidates[0] };
  }

  async createSubtask(parentId: string, input: Omit<CreateJobInput, 'parent'>): Promise<Job> {
    const parent = await this.getJob(parentId);
    if (!parent) {
      throw new JoblogError(`Parent job not found: ${parentId}`, 'JOB_NOT_FOUND');
    }

    const subtask = await this.createJob({
      ...input,
      parent: parentId,
      phase: input.phase ?? parent.phase,
    });

    const children = [...(parent.children ?? []), subtask.id];
    await this.updateJob(parentId, { children });

    return subtask;
  }

  async getChildren(parentId: string): Promise<Job[]> {
    return this.listJobs({ parent: parentId });
  }

  async sendMessage(input: Omit<AgentMessage, 'id' | 'timestamp' | 'processed'>): Promise<AgentMessage> {
    this.ensureInitialized();

    const message: AgentMessage = {
      ...input,
      id: generateId('msg'),
      timestamp: new Date(),
      processed: false,
    };

    await this.storage.append(JOBLOG_FILES.messages, message);
    this.messages.set(message.id, message);

    let inbox = this.unprocessedInbox.get(message.to);
    if (!inbox) {
      inbox = new Set();
      this.unprocessedInbox.set(message.to, inbox);
    }
    inbox.add(message.id);

    if (message.jobId) {
      if (!this.jobHistory.has(message.jobId)) {
        this.jobHistory.set(message.jobId, []);
      }
      const entries = this.jobHistory.get(message.jobId)!;
      entries.push({ type: 'message', timestamp: message.timestamp, data: message });

      entries.sort((a, b) => this.getDateMs(a.timestamp) - this.getDateMs(b.timestamp));
    }

    return { ...message };
  }

  async getMessages(agentId: string, unprocessedOnly = true): Promise<AgentMessage[]> {
    this.ensureInitialized();

    let messages: AgentMessage[];

    if (unprocessedOnly) {

      const directIds = this.unprocessedInbox.get(agentId);
      const broadcastIds = this.unprocessedInbox.get('broadcast');
      const hasAny = (directIds && directIds.size > 0) || (broadcastIds && broadcastIds.size > 0);

      if (!hasAny) return [];

      messages = [];
      if (directIds) {
        for (const id of directIds) {
          const m = this.messages.get(id);
          if (m) messages.push(m);
        }
      }
      if (broadcastIds) {
        for (const id of broadcastIds) {
          const m = this.messages.get(id);
          if (m && !(m.processedBy?.includes(agentId))) messages.push(m);
        }
      }
    } else {

      messages = Array.from(this.messages.values())
        .filter((m) => m.to === agentId || m.to === 'broadcast');
    }

    messages.sort((a, b) => this.getDateMs(a.timestamp) - this.getDateMs(b.timestamp));

    return messages.map((m) => ({ ...m }));
  }

  async markMessageProcessed(messageId: string, agentId?: string): Promise<void> {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new JoblogError(`Message not found: ${messageId}`, 'MESSAGE_NOT_FOUND');
    }

    if (message.to === 'broadcast' && agentId) {
      const processedBy = [...(message.processedBy ?? [])];
      if (!processedBy.includes(agentId)) {
        processedBy.push(agentId);
      }

      const updated: AgentMessage = {
        ...message,
        processedBy,
      };

      await this.storage.append(JOBLOG_FILES.messages, updated);
      this.messages.set(messageId, updated);
      return;
    }

    const updated: AgentMessage = {
      ...message,
      processed: true,
      processedAt: new Date(),
    };

    await this.storage.append(JOBLOG_FILES.messages, updated);
    this.messages.set(messageId, updated);

    this.unprocessedInbox.get(message.to)?.delete(messageId);
  }

  async logDecision(input: Omit<DecisionEntry, 'id' | 'timestamp'>): Promise<void> {
    this.ensureInitialized();

    const decision: DecisionEntry = {
      ...input,
      id: generateId('dec'),
      timestamp: new Date(),
    };

    await this.storage.append(JOBLOG_FILES.decisions, decision);

    if (!this.jobHistory.has(decision.jobId)) {
      this.jobHistory.set(decision.jobId, []);
    }
    const entries = this.jobHistory.get(decision.jobId)!;
    entries.push({ type: 'decision', timestamp: decision.timestamp, data: decision });

    entries.sort((a, b) => this.getDateMs(a.timestamp) - this.getDateMs(b.timestamp));
  }

  async logActivity(input: Omit<ActivityEntry, 'id' | 'timestamp'>): Promise<void> {
    this.ensureInitialized();

    const activity: ActivityEntry = {
      ...input,
      id: generateId('act'),
      timestamp: new Date(),
    };

    await this.storage.append(JOBLOG_FILES.activity, activity);

    if (!this.jobHistory.has(activity.jobId)) {
      this.jobHistory.set(activity.jobId, []);
    }
    const entries = this.jobHistory.get(activity.jobId)!;
    entries.push({ type: 'activity', timestamp: activity.timestamp, data: activity });

    entries.sort((a, b) => this.getDateMs(a.timestamp) - this.getDateMs(b.timestamp));
  }

  async getJobHistory(jobId: string): Promise<JoblogEntry[]> {
    this.ensureInitialized();
    return this.jobHistory.get(jobId) ?? [];
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new JoblogError('Joblog not initialized. Call initialize() first.', 'NOT_INITIALIZED');
    }
  }

  private validateTransition(from: JobStatus, to: JobStatus): void {
    const valid = VALID_TRANSITIONS[from];
    if (!valid.includes(to)) {
      throw new JoblogError(`Invalid status transition: ${from} → ${to}`, 'INVALID_TRANSITION');
    }
  }

}

export class JoblogError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_INITIALIZED'
      | 'JOB_NOT_FOUND'
      | 'MESSAGE_NOT_FOUND'
      | 'INVALID_TRANSITION'
      | 'STORAGE_ERROR'
  ) {
    super(message);
    this.name = 'JoblogError';
  }
}
