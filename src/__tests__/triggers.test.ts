import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseCron, matchesCron, nextCronMatch, describeCron } from '../triggers/cron.js';
import { interpolateTemplate } from '../triggers/TriggerEngine.js';
import { TriggerEngine } from '../triggers/TriggerEngine.js';
import { getTemplate, listTemplates, listTemplatesByCategory, getCategories, createTriggerFromTemplate } from '../triggers/templates.js';
import type { TriggerConfig, TriggerEvent } from '../triggers/types.js';

describe('Cron Parser', () => {
    it('parses every minute', () => {
        const parsed = parseCron('* * * * *');
        expect(parsed.minute.any).toBe(true);
        expect(parsed.hour.any).toBe(true);
    });

    it('parses specific time', () => {
        const parsed = parseCron('30 9 * * *');
        expect(parsed.minute.values.has(30)).toBe(true);
        expect(parsed.hour.values.has(9)).toBe(true);
        expect(parsed.dayOfMonth.any).toBe(true);
    });

    it('parses ranges', () => {
        const parsed = parseCron('0 9 * * 1-5');
        expect(parsed.dayOfWeek.values.has(1)).toBe(true);
        expect(parsed.dayOfWeek.values.has(5)).toBe(true);
        expect(parsed.dayOfWeek.values.has(0)).toBe(false);
        expect(parsed.dayOfWeek.values.has(6)).toBe(false);
    });

    it('parses steps', () => {
        const parsed = parseCron('*/15 * * * *');
        expect(parsed.minute.values.has(0)).toBe(true);
        expect(parsed.minute.values.has(15)).toBe(true);
        expect(parsed.minute.values.has(30)).toBe(true);
        expect(parsed.minute.values.has(45)).toBe(true);
        expect(parsed.minute.values.has(10)).toBe(false);
    });

    it('parses comma-separated lists', () => {
        const parsed = parseCron('0 9,12,18 * * *');
        expect(parsed.hour.values.has(9)).toBe(true);
        expect(parsed.hour.values.has(12)).toBe(true);
        expect(parsed.hour.values.has(18)).toBe(true);
        expect(parsed.hour.values.has(15)).toBe(false);
    });

    it('rejects invalid expressions', () => {
        expect(() => parseCron('* * *')).toThrow('expected 5 fields');
        expect(() => parseCron('* * * * * *')).toThrow('expected 5 fields');
    });
});

describe('Cron Matching', () => {
    it('matches every minute', () => {
        const parsed = parseCron('* * * * *');
        expect(matchesCron(parsed, new Date(2026, 2, 23, 10, 30))).toBe(true);
    });

    it('matches specific time', () => {
        const parsed = parseCron('30 9 * * *');
        expect(matchesCron(parsed, new Date(2026, 2, 23, 9, 30))).toBe(true);
        expect(matchesCron(parsed, new Date(2026, 2, 23, 9, 31))).toBe(false);
        expect(matchesCron(parsed, new Date(2026, 2, 23, 10, 30))).toBe(false);
    });

    it('matches weekdays only', () => {
        const parsed = parseCron('0 9 * * 1-5');
        expect(matchesCron(parsed, new Date(2026, 2, 23, 9, 0))).toBe(true); // Monday
        expect(matchesCron(parsed, new Date(2026, 2, 22, 9, 0))).toBe(false); // Sunday
    });

    it('matches first of month', () => {
        const parsed = parseCron('0 0 1 * *');
        expect(matchesCron(parsed, new Date(2026, 3, 1, 0, 0))).toBe(true);
        expect(matchesCron(parsed, new Date(2026, 3, 2, 0, 0))).toBe(false);
    });
});

describe('Next Cron Match', () => {
    it('finds next match for daily cron', () => {
        const parsed = parseCron('0 9 * * *');
        const after = new Date(2026, 2, 23, 10, 0);
        const next = nextCronMatch(parsed, after);
        expect(next.getHours()).toBe(9);
        expect(next.getMinutes()).toBe(0);
        expect(next.getDate()).toBe(24);
    });

    it('finds match later same day', () => {
        const parsed = parseCron('30 14 * * *');
        const after = new Date(2026, 2, 23, 10, 0);
        const next = nextCronMatch(parsed, after);
        expect(next.getHours()).toBe(14);
        expect(next.getMinutes()).toBe(30);
        expect(next.getDate()).toBe(23);
    });
});

describe('Cron Description', () => {
    it('describes daily cron', () => {
        expect(describeCron('0 9 * * *')).toBe('Daily at 9:00 AM');
    });

    it('describes weekday cron', () => {
        expect(describeCron('0 9 * * 1-5')).toBe('Weekdays at 9:00 AM');
    });

    it('describes PM time', () => {
        expect(describeCron('30 14 * * *')).toBe('Daily at 2:30 PM');
    });

    it('describes every N minutes', () => {
        expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    });

    it('describes first of month', () => {
        expect(describeCron('0 0 1 * *')).toBe('First of every month at 12:00 AM');
    });
});

describe('Template Interpolation', () => {
    it('interpolates simple variables', () => {
        const result = interpolateTemplate('Hello {{name}}!', { name: 'World' });
        expect(result).toBe('Hello World!');
    });

    it('interpolates nested paths', () => {
        const result = interpolateTemplate('PR: {{pull_request.title}}', {
            pull_request: { title: 'Fix bug' },
        });
        expect(result).toBe('PR: Fix bug');
    });

    it('preserves unresolved placeholders', () => {
        const result = interpolateTemplate('Value: {{missing}}', {});
        expect(result).toBe('Value: {{missing}}');
    });

    it('handles multiple interpolations', () => {
        const result = interpolateTemplate('{{a}} and {{b}}', { a: 'foo', b: 'bar' });
        expect(result).toBe('foo and bar');
    });

    it('stringifies objects', () => {
        const result = interpolateTemplate('Data: {{obj}}', { obj: { x: 1 } });
        expect(result).toBe('Data: {"x":1}');
    });
});

describe('Trigger Templates', () => {
    it('lists all templates', () => {
        const all = listTemplates();
        expect(all.length).toBeGreaterThan(0);
        for (const t of all) {
            expect(t.id).toBeTruthy();
            expect(t.name).toBeTruthy();
            expect(t.description).toBeTruthy();
            expect(t.category).toBeTruthy();
            expect(t.trigger.type).toBeTruthy();
            expect(t.trigger.task).toBeTruthy();
        }
    });

    it('gets template by id', () => {
        const t = getTemplate('social-media-content');
        expect(t).toBeDefined();
        expect(t!.trigger.type).toBe('webhook');
        expect(t!.category).toBe('content');
    });

    it('returns undefined for unknown template', () => {
        expect(getTemplate('nonexistent')).toBeUndefined();
    });

    it('filters by category', () => {
        const monitoring = listTemplatesByCategory('monitoring');
        expect(monitoring.length).toBeGreaterThan(0);
        for (const t of monitoring) {
            expect(t.category).toBe('monitoring');
        }
    });

    it('lists all categories', () => {
        const cats = getCategories();
        expect(cats).toContain('content');
        expect(cats).toContain('research');
        expect(cats).toContain('monitoring');
        expect(cats).toContain('devops');
        expect(cats).toContain('data');
        expect(cats).toContain('communication');
    });

    it('creates trigger from template with overrides', () => {
        const trigger = createTriggerFromTemplate('daily-digest', {
            id: 'my-digest',
            cron: '0 7 * * *',
        });
        expect(trigger).toBeDefined();
        expect(trigger!.id).toBe('my-digest');
        expect(trigger!.cron).toBe('0 7 * * *');
        expect(trigger!.type).toBe('cron');
    });

    it('every template has a valid trigger type', () => {
        const validTypes = ['cron', 'webhook', 'poll', 'watch'];
        for (const t of listTemplates()) {
            expect(validTypes).toContain(t.trigger.type);
        }
    });

    it('cron templates have valid cron expressions', () => {
        for (const t of listTemplates()) {
            if (t.trigger.type === 'cron' && t.trigger.cron) {
                expect(() => parseCron(t.trigger.cron!)).not.toThrow();
            }
        }
    });

    it('webhook templates have paths', () => {
        for (const t of listTemplates()) {
            if (t.trigger.type === 'webhook') {
                expect(t.trigger.webhook?.path).toBeTruthy();
            }
        }
    });

    it('poll templates have URLs and intervals', () => {
        for (const t of listTemplates()) {
            if (t.trigger.type === 'poll') {
                expect(t.trigger.poll?.url).toBeTruthy();
                expect(t.trigger.poll?.interval).toBeGreaterThan(0);
            }
        }
    });
});

describe('TriggerEngine', () => {
    it('starts and stops without errors', async () => {
        const events: TriggerEvent[] = [];
        const engine = new TriggerEngine({
            triggers: [],
            onTrigger: async (event) => { events.push(event); },
            log: () => {},
        });

        await engine.start();
        expect(engine.isRunning()).toBe(true);

        await engine.stop();
        expect(engine.isRunning()).toBe(false);
    });

    it('tracks trigger states', async () => {
        const engine = new TriggerEngine({
            triggers: [
                {
                    id: 'test-cron',
                    type: 'cron',
                    cron: '0 9 * * *',
                    task: 'Test task',
                },
            ],
            onTrigger: async () => {},
            log: () => {},
        });

        await engine.start();

        const states = engine.getStates();
        expect(states).toHaveLength(1);
        expect(states[0].id).toBe('test-cron');
        expect(states[0].status).toBe('active');
        expect(states[0].type).toBe('cron');

        await engine.stop();
    });

    it('can add and remove triggers dynamically', async () => {
        const engine = new TriggerEngine({
            triggers: [],
            onTrigger: async () => {},
            log: () => {},
        });

        await engine.start();
        expect(engine.getTriggerIds()).toHaveLength(0);

        await engine.addTrigger({
            id: 'dynamic-cron',
            type: 'cron',
            cron: '*/5 * * * *',
            task: 'Dynamic task',
        });

        expect(engine.getTriggerIds()).toHaveLength(1);
        expect(engine.getState('dynamic-cron')?.status).toBe('active');

        await engine.removeTrigger('dynamic-cron');
        expect(engine.getTriggerIds()).toHaveLength(0);

        await engine.stop();
    });

    it('skips disabled triggers', async () => {
        const engine = new TriggerEngine({
            triggers: [
                {
                    id: 'disabled-cron',
                    type: 'cron',
                    cron: '0 9 * * *',
                    task: 'Should not start',
                    enabled: false,
                },
            ],
            onTrigger: async () => {},
            log: () => {},
        });

        await engine.start();
        expect(engine.getTriggerIds()).toHaveLength(0);
        await engine.stop();
    });
});
