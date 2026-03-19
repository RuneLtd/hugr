import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Joblog, JsonlStorage, generateId } from '../joblog/Storage';
import { Joblog as JoblogClass } from '../joblog/Joblog';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import type { Job, AgentMessage, JobStatus } from '../types/joblog';

let testDir: string;
let testPath: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'joblog-test-'));
  testPath = join(testDir, 'session-data');
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe('generateId', () => {
  it('generates unique IDs with correct prefix', () => {
    const id1 = generateId('job');
    const id2 = generateId('job');
    const id3 = generateId('msg');

    expect(id1).toMatch(/^job-/);
    expect(id2).toMatch(/^job-/);
    expect(id3).toMatch(/^msg-/);
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
  });
});

describe('JsonlStorage - Basic Operations', () => {
  let storage: JsonlStorage;

  beforeEach(async () => {
    const storageDir = join(testDir, 'storage');
    storage = new JsonlStorage({ directory: storageDir });
    await storage.initialize();
  });

  it('should append and readAll', async () => {
    const entries = [
      { id: '1', value: 'first' },
      { id: '2', value: 'second' },
      { id: '3', value: 'third' },
    ];

    for (const entry of entries) {
      await storage.append('test.jsonl', entry);
    }

    const read = await storage.readAll('test.jsonl');
    expect(read).toHaveLength(3);
    expect(read[0]).toEqual(entries[0]);
    expect(read[1]).toEqual(entries[1]);
    expect(read[2]).toEqual(entries[2]);
  });

  it('should handle appendBatch', async () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, value: `entry-${i}` }));

    await storage.appendBatch('batch.jsonl', entries);

    const read = await storage.readAll('batch.jsonl');
    expect(read).toHaveLength(100);
    expect(read[0]).toEqual(entries[0]);
    expect(read[99]).toEqual(entries[99]);
  });

  it('should return empty array for non-existent file', async () => {
    const read = await storage.readAll('nonexistent.jsonl');
    expect(read).toEqual([]);
  });

  it('should handle corrupted JSON lines gracefully', async () => {
    const fs = await import('node:fs/promises');
    const filePath = storage.getPath('corrupt.jsonl');
    await fs.writeFile(filePath, '{"id": "1", "value": "good"}\n{"id": "2" invalid json\n{"id": "3", "value": "good"}\n');

    const read = await storage.readAll('corrupt.jsonl');
    expect(read).toHaveLength(2);
    expect(read[0]).toEqual({ id: '1', value: 'good' });
    expect(read[1]).toEqual({ id: '3', value: 'good' });
  });

  it('should preserve Date objects through JSON serialization', async () => {
    const now = new Date();
    const entry = { id: '1', timestamp: now, data: 'test' };

    await storage.append('dates.jsonl', entry);
    const read = await storage.readAll('dates.jsonl');

    expect(typeof read[0].timestamp).toBe('string');
  });

  it('should compact with dedup', async () => {
    const entries = [
      { id: 'dup-1', value: 'first' },
      { id: 'dup-1', value: 'updated' },
      { id: 'dup-1', value: 'final' },
      { id: 'unique-1', value: 'only' },
    ];

    for (const entry of entries) {
      await storage.append('dedup.jsonl', entry);
    }

    const kept = await storage.compact('dedup.jsonl');
    expect(kept).toBe(2);

    const compacted = await storage.readAll('dedup.jsonl');
    expect(compacted).toHaveLength(2);

    const dupEntry = compacted.find((e: any) => e.id === 'dup-1');
    expect(dupEntry).toEqual({ id: 'dup-1', value: 'final' });
  });

  it('should stream entries', async () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({ id: `${i}`, value: `entry-${i}` }));
    await storage.appendBatch('stream.jsonl', entries);

    const streamed = [];
    for await (const entry of storage.stream('stream.jsonl')) {
      streamed.push(entry);
    }

    expect(streamed).toHaveLength(50);
    expect(streamed[0]).toEqual(entries[0]);
    expect(streamed[49]).toEqual(entries[49]);
  });

  it('should delete file', async () => {
    await storage.append('delete.jsonl', { id: '1' });
    expect(storage.exists('delete.jsonl')).resolves.toBe(true);

    await storage.delete('delete.jsonl');
    expect(storage.exists('delete.jsonl')).resolves.toBe(false);
  });

  it('should not throw when deleting non-existent file', async () => {
    await expect(storage.delete('nonexistent.jsonl')).resolves.not.toThrow();
  });
});

describe('Joblog - Initialization', () => {
  it('should create and initialize joblog', async () => {
    const joblog = new JoblogClass({ projectPath: testPath });

    expect(joblog).toBeDefined();
    await expect(joblog.initialize()).resolves.not.toThrow();
    await expect(joblog.close()).resolves.not.toThrow();
  });

  it('should create joblog directory on initialize', async () => {
    const joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();

    const { resolveSessionDataDir } = await import('../paths');
    const sessionDir = resolveSessionDataDir(testPath);
    const joblogDir = join(sessionDir, 'joblog');
    expect(existsSync(joblogDir)).toBe(true);
  });

  it('should not throw on double initialize', async () => {
    const joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();
    await expect(joblog.initialize()).resolves.not.toThrow();
  });
});

describe('Joblog - Job Lifecycle', () => {
  let joblog: JoblogClass;

  beforeEach(async () => {
    joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();
  });

  it('should create job with correct defaults', async () => {
    const job = await joblog.createJob({
      description: 'Test job',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: ['done'],
      maxAttempts: 3,
    });

    expect(job.id).toMatch(/^job-/);
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(0);
    expect(job.description).toBe('Test job');
    expect(job.createdAt).toBeInstanceOf(Date);
    expect(job.dependencies).toEqual([]);
  });

  it('should complete job lifecycle: pending → in_progress → complete', async () => {
    const created = await joblog.createJob({
      description: 'Lifecycle test',
      complexity: 'medium',
      phase: 'test',
      acceptanceCriteria: ['pass'],
      maxAttempts: 3,
    });

    expect(created.status).toBe('pending');

    const started = await joblog.startJob(created.id, 'agent-1');
    expect(started.status).toBe('in_progress');
    expect(started.assignedAgent).toBe('agent-1');
    expect(started.startedAt).toBeInstanceOf(Date);
    expect(started.attempts).toBe(1);

    const completed = await joblog.completeJob(created.id, {
      files: [],
      summary: 'Done',
    });
    expect(completed.status).toBe('complete');
    expect(completed.completedAt).toBeInstanceOf(Date);
  });

  it('should fail job and allow retry', async () => {
    const created = await joblog.createJob({
      description: 'Retry test',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: ['retry'],
      maxAttempts: 3,
    });

    const started1 = await joblog.startJob(created.id, 'agent-1');
    expect(started1.attempts).toBe(1);

    const failed = await joblog.failJob(created.id, {
      type: 'unknown',
      message: 'First attempt failed',
    });
    expect(failed.status).toBe('failed');
    expect(failed.error?.message).toBe('First attempt failed');

    const reFailed = await joblog.updateJob(created.id, { status: 'pending' });
    const started2 = await joblog.startJob(reFailed.id, 'agent-2');
    expect(started2.attempts).toBe(2);
  });

  it('should reject invalid status transitions', async () => {
    const job = await joblog.createJob({
      description: 'Transition test',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: ['test'],
      maxAttempts: 3,
    });

    await joblog.startJob(job.id, 'agent-1');
    const completed = await joblog.completeJob(job.id, {
      files: [],
      summary: 'Done',
    });

    await expect(joblog.startJob(completed.id, 'agent-1')).rejects.toThrow('Cannot start job in status: complete');
  });

  it('should enforce MAX_RETRY_ATTEMPTS', async () => {
    const job = await joblog.createJob({
      description: 'Max retry test',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: ['test'],
      maxAttempts: 10,
      attempts: 3,
    });

    let current = job;
    for (let i = 0; i < 2; i++) {
      const started = await joblog.startJob(current.id, 'agent-1');
      expect(started.status).toBe('in_progress');
      current = await joblog.updateJob(current.id, { status: 'pending' });
    }

    expect(current.attempts).toBe(5);

    const result = await joblog.startJob(current.id, 'agent-1');
    expect(result.status).toBe('failed');
  });

  it('should get job by id', async () => {
    const created = await joblog.createJob({
      description: 'Get test',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: ['get'],
      maxAttempts: 3,
    });

    const retrieved = await joblog.getJob(created.id);
    expect(retrieved).toEqual(created);

    const notFound = await joblog.getJob('nonexistent-id');
    expect(notFound).toBe(null);
  });

  it('should list jobs with filters', async () => {
    const job1 = await joblog.createJob({
      description: 'Job 1',
      complexity: 'simple',
      phase: 'phase-a',
      acceptanceCriteria: ['test'],
      maxAttempts: 3,
      tags: ['tag1', 'tag2'],
    });

    const job2 = await joblog.createJob({
      description: 'Job 2',
      complexity: 'complex',
      phase: 'phase-b',
      acceptanceCriteria: ['test'],
      maxAttempts: 3,
      tags: ['tag3'],
    });

    const all = await joblog.listJobs();
    expect(all).toHaveLength(2);

    const phaseA = await joblog.listJobs({ phase: 'phase-a' });
    expect(phaseA).toHaveLength(1);
    expect(phaseA[0].id).toBe(job1.id);

    const withTag1 = await joblog.listJobs({ tags: ['tag1'] });
    expect(withTag1).toHaveLength(1);
    expect(withTag1[0].id).toBe(job1.id);

    await joblog.startJob(job1.id, 'agent-1');
    const inProgress = await joblog.listJobs({ status: 'in_progress' });
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0].id).toBe(job1.id);
  });
});

describe('Joblog - Message Flow', () => {
  let joblog: JoblogClass;

  beforeEach(async () => {
    joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();
  });

  it('should send and retrieve messages', async () => {
    const msg = await joblog.sendMessage({
      type: 'task_assignment',
      from: 'manager',
      to: 'coder',
      payload: { task: 'implement feature' },
    });

    expect(msg.id).toMatch(/^msg-/);
    expect(msg.timestamp).toBeInstanceOf(Date);
    expect(msg.processed).toBe(false);

    const messages = await joblog.getMessages('coder', true);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(msg.id);
  });

  it('should mark message as processed', async () => {
    const msg = await joblog.sendMessage({
      type: 'task_assignment',
      from: 'manager',
      to: 'coder',
      payload: { task: 'implement' },
    });

    expect(msg.processed).toBe(false);

    await joblog.markMessageProcessed(msg.id);

    const messages = await joblog.getMessages('coder', true);
    expect(messages).toHaveLength(0);

    const allMessages = await joblog.getMessages('coder', false);
    expect(allMessages).toHaveLength(1);
    expect(allMessages[0].processed).toBe(true);
  });

  it('should handle broadcast messages', async () => {
    const msg = await joblog.sendMessage({
      type: 'health_ping',
      from: 'manager',
      to: 'broadcast',
      payload: {},
    });

    const coderMsgs = await joblog.getMessages('coder', true);
    expect(coderMsgs).toHaveLength(1);

    const architectMsgs = await joblog.getMessages('architect', true);
    expect(architectMsgs).toHaveLength(1);

    const reviewerMsgs = await joblog.getMessages('reviewer', true);
    expect(reviewerMsgs).toHaveLength(1);
  });

  it('should not return processed messages in unprocessedOnly mode', async () => {
    await joblog.sendMessage({
      type: 'task_assignment',
      from: 'manager',
      to: 'coder',
      payload: {},
    });

    await joblog.sendMessage({
      type: 'task_result',
      from: 'manager',
      to: 'coder',
      payload: {},
    });

    let msgs = await joblog.getMessages('coder', true);
    expect(msgs).toHaveLength(2);

    await joblog.markMessageProcessed(msgs[0].id);

    msgs = await joblog.getMessages('coder', true);
    expect(msgs).toHaveLength(1);
  });

  it('should error on marking non-existent message processed', async () => {
    await expect(joblog.markMessageProcessed('nonexistent')).rejects.toThrow('Message not found');
  });

  it('should associate messages with jobs', async () => {
    const job = await joblog.createJob({
      description: 'Test',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const msg = await joblog.sendMessage({
      type: 'task_assignment',
      from: 'manager',
      to: 'coder',
      jobId: job.id,
      payload: {},
    });

    const history = await joblog.getJobHistory(job.id);
    expect(history).toContainEqual(
      expect.objectContaining({
        type: 'message',
        data: expect.objectContaining({ id: msg.id }),
      })
    );
  });
});

describe('Joblog - Race Condition in Compact', () => {
  it('should handle compact with concurrent writes safely', async () => {
    const storage = new JsonlStorage({ directory: join(testDir, 'race-storage') });
    await storage.initialize();

    const initialEntries = Array.from({ length: 100 }, (_, i) => ({
      id: `dup-${i % 10}`,
      value: `initial-${i}`,
      version: 0,
    }));

    await storage.appendBatch('race.jsonl', initialEntries);

    const compactPromise = storage.compact('race.jsonl');

    const writes = Array.from({ length: 20 }, (_, i) =>
      storage.append('race.jsonl', {
        id: `new-${i}`,
        value: `concurrent-${i}`,
        version: 1,
      })
    );

    await Promise.all(writes);
    await compactPromise;

    const final = await storage.readAll('race.jsonl');
    expect(final.length).toBeGreaterThan(0);

    const uniqueIds = new Set(final.map((e: any) => e.id));
    expect(uniqueIds.size).toBeGreaterThan(10);
  });
});

describe('Joblog - Unprocessed Inbox Cache Sync', () => {
  let joblog: JoblogClass;

  beforeEach(async () => {
    joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();
  });

  it('should keep unprocessedInbox in sync when messages are processed', async () => {
    const msg1 = await joblog.sendMessage({
      type: 'task_assignment',
      from: 'manager',
      to: 'coder',
      payload: {},
    });

    const msg2 = await joblog.sendMessage({
      type: 'task_result',
      from: 'manager',
      to: 'coder',
      payload: {},
    });

    let unprocessed = await joblog.getMessages('coder', true);
    expect(unprocessed).toHaveLength(2);

    await joblog.markMessageProcessed(msg1.id);

    unprocessed = await joblog.getMessages('coder', true);
    expect(unprocessed).toHaveLength(1);
    expect(unprocessed[0].id).toBe(msg2.id);

    await joblog.markMessageProcessed(msg2.id);

    unprocessed = await joblog.getMessages('coder', true);
    expect(unprocessed).toHaveLength(0);
  });

  it('should maintain separate inboxes per agent', async () => {
    const msg1 = await joblog.sendMessage({
      type: 'task_assignment',
      from: 'manager',
      to: 'coder',
      payload: {},
    });

    const msg2 = await joblog.sendMessage({
      type: 'health_ping',
      from: 'manager',
      to: 'architect',
      payload: {},
    });

    const coderMsgs = await joblog.getMessages('coder', true);
    expect(coderMsgs).toHaveLength(1);
    expect(coderMsgs[0].id).toBe(msg1.id);

    const architectMsgs = await joblog.getMessages('architect', true);
    expect(architectMsgs).toHaveLength(1);
    expect(architectMsgs[0].id).toBe(msg2.id);

    await joblog.markMessageProcessed(msg1.id);

    const coderMsgsAfter = await joblog.getMessages('coder', true);
    expect(coderMsgsAfter).toHaveLength(0);

    const architectMsgsAfter = await joblog.getMessages('architect', true);
    expect(architectMsgsAfter).toHaveLength(1);
  });
});

describe('Joblog - Duplicate Entries on Rebuild', () => {
  it('should keep latest version of duplicated entries', async () => {
    const storage = new JsonlStorage({ directory: join(testDir, 'dup-storage') });
    await storage.initialize();

    await storage.append('entries.jsonl', { id: 'dup-1', value: 'first' });
    await storage.append('entries.jsonl', { id: 'dup-1', value: 'second' });
    await storage.append('entries.jsonl', { id: 'dup-1', value: 'third' });

    const latest = await storage.readLatest('entries.jsonl');
    expect(latest.size).toBe(1);
    expect(latest.get('dup-1')).toEqual({ id: 'dup-1', value: 'third' });
  });
});

describe('Joblog - Empty and Corrupted Data Handling', () => {
  it('should handle empty files', async () => {
    const storage = new JsonlStorage({ directory: join(testDir, 'empty-storage') });
    await storage.initialize();

    const filePath = storage.getPath('empty.jsonl');
    const fs = await import('node:fs/promises');
    await fs.writeFile(filePath, '');

    const entries = await storage.readAll('empty.jsonl');
    expect(entries).toEqual([]);
  });

  it('should handle file with only whitespace', async () => {
    const storage = new JsonlStorage({ directory: join(testDir, 'whitespace-storage') });
    await storage.initialize();

    const filePath = storage.getPath('whitespace.jsonl');
    const fs = await import('node:fs/promises');
    await fs.writeFile(filePath, '\n\n  \n\t\n');

    const entries = await storage.readAll('whitespace.jsonl');
    expect(entries).toEqual([]);
  });

  it('should handle file with all corrupted lines', async () => {
    const storage = new JsonlStorage({ directory: join(testDir, 'corrupted-storage') });
    await storage.initialize();

    const filePath = storage.getPath('corrupt.jsonl');
    const fs = await import('node:fs/promises');
    await fs.writeFile(filePath, 'not json\n{invalid\n{broken": data\n');

    const entries = await storage.readAll('corrupt.jsonl');
    expect(entries).toEqual([]);
  });
});

describe('Joblog - getNextJob', () => {
  let joblog: JoblogClass;

  beforeEach(async () => {
    joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();
  });

  it('should return pending jobs in creation order', async () => {
    const job1 = await joblog.createJob({
      description: 'First',
      complexity: 'simple',
      phase: 'phase-a',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const job2 = await joblog.createJob({
      description: 'Second',
      complexity: 'simple',
      phase: 'phase-a',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const next = await joblog.getNextJob();
    expect(next?.id).toBe(job1.id);
  });

  it('should skip non-pending jobs', async () => {
    const job1 = await joblog.createJob({
      description: 'First',
      complexity: 'simple',
      phase: 'phase-a',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const job2 = await joblog.createJob({
      description: 'Second',
      complexity: 'simple',
      phase: 'phase-a',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    await joblog.startJob(job1.id, 'agent-1');

    const next = await joblog.getNextJob();
    expect(next?.id).toBe(job2.id);
  });

  it('should filter by phase', async () => {
    const job1 = await joblog.createJob({
      description: 'Phase A',
      complexity: 'simple',
      phase: 'phase-a',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const job2 = await joblog.createJob({
      description: 'Phase B',
      complexity: 'simple',
      phase: 'phase-b',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const nextA = await joblog.getNextJob(undefined, { phase: 'phase-a' });
    expect(nextA?.id).toBe(job1.id);

    const nextB = await joblog.getNextJob(undefined, { phase: 'phase-b' });
    expect(nextB?.id).toBe(job2.id);

    const nextC = await joblog.getNextJob(undefined, { phase: 'phase-c' });
    expect(nextC).toBe(null);
  });

  it('should return null when no pending jobs exist', async () => {
    const next = await joblog.getNextJob();
    expect(next).toBe(null);

    const job = await joblog.createJob({
      description: 'Only',
      complexity: 'simple',
      phase: 'phase-a',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const started = await joblog.startJob(job.id, 'agent-1');
    await joblog.completeJob(started.id, { files: [], summary: 'Done' });

    const nextAfter = await joblog.getNextJob();
    expect(nextAfter).toBe(null);
  });
});

describe('Joblog - stream() method', () => {
  it('should stream entries without loading all into memory', async () => {
    const storage = new JsonlStorage({ directory: join(testDir, 'stream-storage') });
    await storage.initialize();

    const entries = Array.from({ length: 1000 }, (_, i) => ({
      id: `${i}`,
      value: `entry-${i}`,
    }));

    await storage.appendBatch('large.jsonl', entries);

    let count = 0;
    for await (const entry of storage.stream('large.jsonl')) {
      count++;
      expect(entry.id).toBeDefined();
      expect(entry.value).toBeDefined();
    }

    expect(count).toBe(1000);
  });

  it('should handle streaming non-existent file', async () => {
    const storage = new JsonlStorage({ directory: join(testDir, 'stream-missing') });
    await storage.initialize();

    let count = 0;
    for await (const entry of storage.stream('nonexistent.jsonl')) {
      count++;
    }

    expect(count).toBe(0);
  });
});

describe('Joblog - Memory Growth with Unprocessed Inbox', () => {
  it('should not accumulate old processed messages in unprocessedInbox', async () => {
    const joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();

    for (let i = 0; i < 100; i++) {
      const msg = await joblog.sendMessage({
        type: 'task_assignment',
        from: 'manager',
        to: 'coder',
        payload: { task: i },
      });

      await joblog.markMessageProcessed(msg.id);
    }

    const unprocessed = await joblog.getMessages('coder', true);
    expect(unprocessed).toHaveLength(0);

    const all = await joblog.getMessages('coder', false);
    expect(all).toHaveLength(100);

    for (const msg of all) {
      expect(msg.processed).toBe(true);
    }
  });
});

describe('Joblog - Complete Rebuild Flow', () => {
  it('should correctly rebuild state from storage', async () => {
    const joblog1 = new JoblogClass({ projectPath: testPath });
    await joblog1.initialize();

    const job1 = await joblog1.createJob({
      description: 'Rebuild test 1',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const job2 = await joblog1.createJob({
      description: 'Rebuild test 2',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const msg = await joblog1.sendMessage({
      type: 'task_assignment',
      from: 'manager',
      to: 'coder',
      jobId: job1.id,
      payload: {},
    });

    await joblog1.close();

    const joblog2 = new JoblogClass({ projectPath: testPath });
    await joblog2.initialize();

    const jobs = await joblog2.listJobs();
    expect(jobs).toHaveLength(2);

    const retrieved = await joblog2.getJob(job1.id);
    expect(retrieved?.description).toBe('Rebuild test 1');

    const messages = await joblog2.getMessages('coder', true);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(msg.id);

    const history = await joblog2.getJobHistory(job1.id);
    expect(history.length).toBeGreaterThan(0);
  });
});

describe('Joblog - Subtasks and Job Hierarchy', () => {
  let joblog: JoblogClass;

  beforeEach(async () => {
    joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();
  });

  it('should create subtasks', async () => {
    const parent = await joblog.createJob({
      description: 'Parent task',
      complexity: 'complex',
      phase: 'phase-a',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const subtask = await joblog.createSubtask(parent.id, {
      description: 'Subtask 1',
      complexity: 'simple',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    expect(subtask.parent).toBe(parent.id);

    const updated = await joblog.getJob(parent.id);
    expect(updated?.children).toContain(subtask.id);
  });

  it('should get children of parent job', async () => {
    const parent = await joblog.createJob({
      description: 'Parent',
      complexity: 'complex',
      phase: 'phase-a',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const sub1 = await joblog.createSubtask(parent.id, {
      description: 'Sub 1',
      complexity: 'simple',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const sub2 = await joblog.createSubtask(parent.id, {
      description: 'Sub 2',
      complexity: 'simple',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const children = await joblog.getChildren(parent.id);
    expect(children).toHaveLength(2);
    expect(children.map(c => c.id)).toContain(sub1.id);
    expect(children.map(c => c.id)).toContain(sub2.id);
  });
});

describe('Joblog - Decision and Activity Logging', () => {
  let joblog: JoblogClass;

  beforeEach(async () => {
    joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();
  });

  it('should log decisions', async () => {
    const job = await joblog.createJob({
      description: 'Decision test',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    await joblog.logDecision({
      jobId: job.id,
      agentId: 'architect',
      type: 'design',
      question: 'Use REST or GraphQL?',
      chosen: 'GraphQL',
      reasoning: 'More flexible for clients',
      alternatives: ['REST'],
      confidence: 0.9,
    });

    const history = await joblog.getJobHistory(job.id);
    const decision = history.find(e => e.type === 'decision');
    expect(decision).toBeDefined();
    expect((decision?.data as any).chosen).toBe('GraphQL');
  });

  it('should log activities', async () => {
    const job = await joblog.createJob({
      description: 'Activity test',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    await joblog.logActivity({
      jobId: job.id,
      agentId: 'coder',
      type: 'file_write',
      data: { path: 'src/index.ts', lines: 50 },
    });

    const history = await joblog.getJobHistory(job.id);
    const activity = history.find(e => e.type === 'activity');
    expect(activity).toBeDefined();
    expect((activity?.data as any).type).toBe('file_write');
  });
});

describe('Joblog - Reset', () => {
  it('should clear all data on reset', async () => {
    const joblog = new JoblogClass({ projectPath: testPath });
    await joblog.initialize();

    const job = await joblog.createJob({
      description: 'Before reset',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: [],
      maxAttempts: 3,
    });

    const msg = await joblog.sendMessage({
      type: 'task_assignment',
      from: 'manager',
      to: 'coder',
      payload: {},
    });

    await joblog.reset();
    await joblog.initialize();

    const jobs = await joblog.listJobs();
    expect(jobs).toHaveLength(0);

    const messages = await joblog.getMessages('coder', false);
    expect(messages).toHaveLength(0);
  });
});

describe('Joblog - Not Initialized Error', () => {
  it('should throw when using uninitialized joblog', async () => {
    const joblog = new JoblogClass({ projectPath: testPath });

    await expect(joblog.createJob({
      description: 'Test',
      complexity: 'simple',
      phase: 'test',
      acceptanceCriteria: [],
      maxAttempts: 3,
    })).rejects.toThrow('not initialized');
  });
});
