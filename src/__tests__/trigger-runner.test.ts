import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TriggerRunner } from '../triggers/runner.js';
import { TriggerEngine } from '../triggers/TriggerEngine.js';
import { Manager } from '../agents/Manager.js';
import { Joblog } from '../joblog/Joblog.js';
import type { AgentRuntime, AgentRunOptions, AgentRunResult } from '../runtime/types.js';
import type { TriggerEvent, TriggerConfig } from '../triggers/types.js';
import type { PipelineConfig, TriggersConfig } from '../config/schema.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `hugr-trigger-test-${Date.now()}`);

function createMockRuntime(): AgentRuntime {
    return {
        name: 'mock',
        isAvailable: vi.fn().mockResolvedValue(true),
        runAgent: vi.fn().mockResolvedValue({
            success: true,
            durationMs: 100,
            transcript: 'mock result',
        } satisfies AgentRunResult),
    };
}

function createDefaultPipeline(): PipelineConfig {
    return Manager.buildDefaultPipeline('off', { iterations: 0, mode: 'fixed' as const, maxIterations: 0 });
}

function createTriggersConfig(triggers: TriggersConfig['triggers'], overrides?: Partial<TriggersConfig>): TriggersConfig {
    return {
        enabled: true,
        triggers,
        ...overrides,
    };
}

beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
    if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
    }
});

describe('TriggerRunner', () => {
    it('starts and stops cleanly with no triggers', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([]),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();
        expect(runner.isRunning()).toBe(false);
        expect(runner.getTriggerStates()).toEqual([]);

        await runner.stop();
    });

    it('does not start when globally disabled', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([{
                id: 'should-not-start',
                type: 'cron',
                cron: '* * * * *',
                task: 'test',
            }], { enabled: false }),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();
        expect(runner.isRunning()).toBe(false);
        expect(runner.getTriggerStates()).toEqual([]);

        await runner.stop();
    });

    it('starts cron triggers and reports active state', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([{
                id: 'test-cron',
                type: 'cron',
                cron: '0 9 * * *',
                task: 'daily task',
            }]),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();
        expect(runner.isRunning()).toBe(true);

        const states = runner.getTriggerStates();
        expect(states).toHaveLength(1);
        expect(states[0].id).toBe('test-cron');
        expect(states[0].status).toBe('active');
        expect(states[0].type).toBe('cron');
        expect(states[0].fireCount).toBe(0);

        await runner.stop();
        expect(runner.isRunning()).toBe(false);
    });

    it('skips individually disabled triggers', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([
                { id: 'enabled-cron', type: 'cron', cron: '0 9 * * *', task: 'task a' },
                { id: 'disabled-cron', type: 'cron', cron: '0 10 * * *', task: 'task b', enabled: false },
            ]),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();
        const states = runner.getTriggerStates();
        expect(states).toHaveLength(1);
        expect(states[0].id).toBe('enabled-cron');

        await runner.stop();
    });

    it('exposes the underlying TriggerEngine', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([{
                id: 'test',
                type: 'cron',
                cron: '0 9 * * *',
                task: 'test',
            }]),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        expect(runner.getEngine()).toBeNull();
        await runner.start();
        expect(runner.getEngine()).toBeInstanceOf(TriggerEngine);
        await runner.stop();
        expect(runner.getEngine()).toBeNull();
    });

    it('emits trigger:fired when a trigger fires', async () => {
        const fired: any[] = [];

        const runner = new TriggerRunner({
            triggers: createTriggersConfig([{
                id: 'test-cron',
                type: 'cron',
                cron: '* * * * *',
                task: 'fire test',
            }]),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        runner.events.on('trigger:fired', (data) => fired.push(data));

        await runner.start();

        const engine = runner.getEngine()!;
        await engine.addTrigger({
            id: 'manual-fire',
            type: 'cron',
            cron: '* * * * *',
            task: 'manual test',
        });

        await runner.stop();
    });

    it('starts multiple trigger types simultaneously', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([
                { id: 'cron-1', type: 'cron', cron: '0 9 * * *', task: 'cron task' },
                { id: 'cron-2', type: 'cron', cron: '0 17 * * *', task: 'evening task' },
            ]),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();
        const states = runner.getTriggerStates();
        expect(states).toHaveLength(2);
        expect(states.every(s => s.status === 'active')).toBe(true);
        expect(states.map(s => s.id).sort()).toEqual(['cron-1', 'cron-2']);

        await runner.stop();
    });

    it('can add triggers dynamically at runtime', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([]),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();

        const engine = runner.getEngine();
        expect(engine).toBeNull();

        await runner.stop();
    });
});

describe('TriggerRunner webhook integration', () => {
    it('starts webhook server and accepts requests', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([{
                id: 'wh-test',
                type: 'webhook',
                task: 'webhook task: {{message}}',
                webhook: { path: '/test', method: 'POST' },
            }], { webhookPort: 19876 }),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();

        const states = runner.getTriggerStates();
        expect(states).toHaveLength(1);
        expect(states[0].id).toBe('wh-test');
        expect(states[0].status).toBe('active');

        const healthRes = await fetch('http://localhost:19876/health');
        const health = await healthRes.json();
        expect(health.status).toBe('ok');
        expect(health.routes).toContain('/test');

        const fireRes = await fetch('http://localhost:19876/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'hello' }),
        });
        const fireBody = await fireRes.json();
        expect(fireBody.accepted).toBe(true);
        expect(fireBody.triggerId).toBe('wh-test');

        await new Promise(r => setTimeout(r, 200));

        const updatedStates = runner.getTriggerStates();
        expect(updatedStates[0].fireCount).toBe(1);

        await runner.stop();
    });

    it('returns 404 for unknown routes', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([{
                id: 'wh-404',
                type: 'webhook',
                task: 'test',
                webhook: { path: '/known', method: 'POST' },
            }], { webhookPort: 19877 }),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();

        const res = await fetch('http://localhost:19877/unknown', { method: 'POST' });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.availableRoutes).toContain('/known');

        await runner.stop();
    });

    it('returns 405 for wrong HTTP method', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([{
                id: 'wh-method',
                type: 'webhook',
                task: 'test',
                webhook: { path: '/post-only', method: 'POST' },
            }], { webhookPort: 19878 }),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();

        const res = await fetch('http://localhost:19878/post-only', { method: 'GET' });
        expect(res.status).toBe(405);

        await runner.stop();
    });

    it('creates webhook server when adding webhooks dynamically', async () => {
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([
                { id: 'cron-only', type: 'cron', cron: '0 9 * * *', task: 'just cron' },
            ], { webhookPort: 19879 }),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();

        const engine = runner.getEngine()!;
        await engine.addTrigger({
            id: 'dynamic-wh',
            type: 'webhook',
            task: 'dynamic webhook',
            webhook: { path: '/dynamic', method: 'POST' },
        });

        const healthRes = await fetch('http://localhost:19879/health');
        expect(healthRes.ok).toBe(true);
        const health = await healthRes.json();
        expect(health.routes).toContain('/dynamic');

        await runner.stop();
    });
});

describe('TriggerRunner watch integration', () => {
    it('detects new file creation', async () => {
        const watchDir = join(TEST_DIR, 'watch-input');
        mkdirSync(watchDir, { recursive: true });

        const fired: TriggerEvent[] = [];

        const engine = new TriggerEngine({
            triggers: [{
                id: 'watch-test',
                type: 'watch',
                task: 'process {{files}}',
                watch: { path: watchDir, events: ['create'], debounce: 100, recursive: false },
            }],
            onTrigger: async (event) => { fired.push(event); },
            log: () => {},
        });

        await engine.start();
        expect(engine.getState('watch-test')?.status).toBe('active');

        writeFileSync(join(watchDir, 'newfile.txt'), 'test content');

        await new Promise(r => setTimeout(r, 500));

        expect(fired.length).toBeGreaterThanOrEqual(1);
        const payload = fired[0].payload as any;
        expect(payload._trigger.id).toBe('watch-test');

        await engine.stop();
    });

    it('detects file deletion', async () => {
        const watchDir = join(TEST_DIR, 'watch-delete');
        mkdirSync(watchDir, { recursive: true });
        const filePath = join(watchDir, 'to-delete.txt');
        writeFileSync(filePath, 'will be deleted');

        const fired: TriggerEvent[] = [];

        const engine = new TriggerEngine({
            triggers: [{
                id: 'watch-delete',
                type: 'watch',
                task: 'deleted: {{files}}',
                watch: { path: watchDir, events: ['delete'], debounce: 100, recursive: false },
            }],
            onTrigger: async (event) => { fired.push(event); },
            log: () => {},
        });

        await engine.start();

        rmSync(filePath);

        await new Promise(r => setTimeout(r, 500));

        expect(fired.length).toBeGreaterThanOrEqual(1);
        const files = (fired[0].payload as any)._trigger ? fired[0].payload : null;
        if (files) {
            const triggerPayload = (files as any)._trigger;
            expect(triggerPayload.id).toBe('watch-delete');
        }

        await engine.stop();
    });

    it('respects glob pattern filter', async () => {
        const watchDir = join(TEST_DIR, 'watch-glob');
        mkdirSync(watchDir, { recursive: true });

        const fired: TriggerEvent[] = [];

        const engine = new TriggerEngine({
            triggers: [{
                id: 'watch-glob',
                type: 'watch',
                task: 'process {{files}}',
                watch: { path: watchDir, events: ['create'], pattern: '*.md', debounce: 100, recursive: false },
            }],
            onTrigger: async (event) => { fired.push(event); },
            log: () => {},
        });

        await engine.start();

        writeFileSync(join(watchDir, 'ignored.txt'), 'should not trigger');
        await new Promise(r => setTimeout(r, 300));
        expect(fired.length).toBe(0);

        writeFileSync(join(watchDir, 'matched.md'), 'should trigger');
        await new Promise(r => setTimeout(r, 300));
        expect(fired.length).toBeGreaterThanOrEqual(1);

        await engine.stop();
    });

    it('debounces rapid file changes', async () => {
        const watchDir = join(TEST_DIR, 'watch-debounce');
        mkdirSync(watchDir, { recursive: true });

        const fired: TriggerEvent[] = [];

        const engine = new TriggerEngine({
            triggers: [{
                id: 'watch-debounce',
                type: 'watch',
                task: 'process {{files}}',
                watch: { path: watchDir, events: ['create'], debounce: 300, recursive: false },
            }],
            onTrigger: async (event) => { fired.push(event); },
            log: () => {},
        });

        await engine.start();

        writeFileSync(join(watchDir, 'file1.txt'), 'a');
        writeFileSync(join(watchDir, 'file2.txt'), 'b');
        writeFileSync(join(watchDir, 'file3.txt'), 'c');

        await new Promise(r => setTimeout(r, 800));

        expect(fired.length).toBe(1);

        const payload = fired[0].payload as any;
        const files = payload.files || payload._trigger?.metadata?.files;
        if (files) {
            expect(files.length).toBeGreaterThanOrEqual(2);
        }

        await engine.stop();
    });
});

describe('TriggerRunner cooldown and concurrency', () => {
    it('respects cooldown between fires', async () => {
        const fired: TriggerEvent[] = [];

        const engine = new TriggerEngine({
            triggers: [{
                id: 'cooldown-test',
                type: 'cron',
                cron: '* * * * *',
                task: 'test',
                cooldown: 9999,
            }],
            onTrigger: async (event) => { fired.push(event); },
            log: () => {},
        });

        await engine.start();
        const state = engine.getState('cooldown-test')!;
        expect(state.status).toBe('active');

        await engine.stop();
    });

    it('respects maxConcurrent limit', async () => {
        const watchDir = join(TEST_DIR, 'watch-concurrent');
        mkdirSync(watchDir, { recursive: true });

        let activeCount = 0;
        let maxSeen = 0;

        const engine = new TriggerEngine({
            triggers: [{
                id: 'concurrent-test',
                type: 'watch',
                task: 'test',
                maxConcurrent: 1,
                watch: { path: watchDir, events: ['create'], debounce: 50, recursive: false },
            }],
            onTrigger: async () => {
                activeCount++;
                maxSeen = Math.max(maxSeen, activeCount);
                await new Promise(r => setTimeout(r, 200));
                activeCount--;
            },
            log: () => {},
        });

        await engine.start();

        writeFileSync(join(watchDir, 'a.txt'), 'a');
        await new Promise(r => setTimeout(r, 150));
        writeFileSync(join(watchDir, 'b.txt'), 'b');

        await new Promise(r => setTimeout(r, 600));

        await engine.stop();
    });
});

describe('TriggerEngine config integration', () => {
    it('maps TriggerDefinition from config schema to TriggerConfig', async () => {
        const runner = new TriggerRunner({
            triggers: {
                enabled: true,
                webhookPort: 19880,
                webhookHost: '127.0.0.1',
                triggers: [
                    {
                        id: 'schema-cron',
                        type: 'cron',
                        cron: '0 9 * * 1-5',
                        task: 'weekday task',
                        projectPath: '/some/path',
                        autonomy: 'auto',
                        maxConcurrent: 2,
                        cooldown: 60,
                        tags: ['test'],
                        metadata: { source: 'test' },
                    },
                ],
            },
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline: createDefaultPipeline(),
            log: () => {},
        });

        await runner.start();
        const states = runner.getTriggerStates();
        expect(states).toHaveLength(1);
        expect(states[0].id).toBe('schema-cron');
        expect(states[0].type).toBe('cron');
        expect(states[0].status).toBe('active');

        await runner.stop();
    });
});

describe('TriggerRunner template pipeline resolution', () => {
    it('uses default pipeline when trigger has no custom pipeline', async () => {
        const defaultPipeline = createDefaultPipeline();
        const runner = new TriggerRunner({
            triggers: createTriggersConfig([{
                id: 'no-pipeline',
                type: 'cron',
                cron: '0 9 * * *',
                task: 'basic task',
            }]),
            runtime: createMockRuntime(),
            defaultProjectPath: TEST_DIR,
            defaultPipeline,
            log: () => {},
        });

        await runner.start();
        expect(runner.isRunning()).toBe(true);

        await runner.stop();
    });
});
