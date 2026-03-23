
import type { TriggerConfig, TriggerState, TriggerHandler, TriggerCallback, TriggerEvent } from './types.js';

interface CronField {
    values: Set<number>;
    any: boolean;
}

interface ParsedCron {
    minute: CronField;
    hour: CronField;
    dayOfMonth: CronField;
    month: CronField;
    dayOfWeek: CronField;
}

function parseField(field: string, min: number, max: number): CronField {
    if (field === '*') {
        return { values: new Set(), any: true };
    }

    const values = new Set<number>();

    for (const part of field.split(',')) {
        if (part.includes('/')) {
            const [range, stepStr] = part.split('/');
            const step = parseInt(stepStr, 10);
            let start = min;
            let end = max;

            if (range !== '*') {
                if (range.includes('-')) {
                    [start, end] = range.split('-').map(Number);
                } else {
                    start = parseInt(range, 10);
                }
            }

            for (let i = start; i <= end; i += step) {
                values.add(i);
            }
        } else if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) {
                values.add(i);
            }
        } else {
            values.add(parseInt(part, 10));
        }
    }

    return { values, any: false };
}

export function parseCron(expression: string): ParsedCron {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`Invalid cron expression "${expression}": expected 5 fields, got ${parts.length}`);
    }

    return {
        minute: parseField(parts[0], 0, 59),
        hour: parseField(parts[1], 0, 23),
        dayOfMonth: parseField(parts[2], 1, 31),
        month: parseField(parts[3], 1, 12),
        dayOfWeek: parseField(parts[4], 0, 6),
    };
}

export function matchesCron(parsed: ParsedCron, date: Date): boolean {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1;
    const dayOfWeek = date.getDay();

    return (
        (parsed.minute.any || parsed.minute.values.has(minute)) &&
        (parsed.hour.any || parsed.hour.values.has(hour)) &&
        (parsed.dayOfMonth.any || parsed.dayOfMonth.values.has(dayOfMonth)) &&
        (parsed.month.any || parsed.month.values.has(month)) &&
        (parsed.dayOfWeek.any || parsed.dayOfWeek.values.has(dayOfWeek))
    );
}

export function nextCronMatch(parsed: ParsedCron, after: Date): Date {
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    for (let i = 0; i < 525960; i++) {
        if (matchesCron(parsed, candidate)) {
            return candidate;
        }
        candidate.setMinutes(candidate.getMinutes() + 1);
    }

    throw new Error('No cron match found within 1 year');
}

export function describeCron(expression: string): string {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return expression;

    const [min, hour, dom, month, dow] = parts;

    if (min === '*' && hour === '*') return 'Every minute';
    if (hour === '*' && min.startsWith('*/')) return `Every ${min.split('/')[1]} minutes`;

    const timeStr = (h: string, m: string) => {
        const hh = parseInt(h, 10);
        const mm = parseInt(m, 10);
        const period = hh >= 12 ? 'PM' : 'AM';
        const displayH = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
        return `${displayH}:${mm.toString().padStart(2, '0')} ${period}`;
    };

    if (dom === '*' && month === '*' && dow === '*') {
        return `Daily at ${timeStr(hour, min)}`;
    }

    if (dom === '*' && month === '*' && dow === '1-5') {
        return `Weekdays at ${timeStr(hour, min)}`;
    }

    if (dom === '*' && month === '*' && dow === '0,6') {
        return `Weekends at ${timeStr(hour, min)}`;
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (dom === '*' && month === '*' && /^\d$/.test(dow)) {
        return `Every ${dayNames[parseInt(dow, 10)]} at ${timeStr(hour, min)}`;
    }

    if (dom === '1' && month === '*' && dow === '*') {
        return `First of every month at ${timeStr(hour, min)}`;
    }

    return expression;
}

export class CronTrigger implements TriggerHandler {
    private timer: ReturnType<typeof setInterval> | null = null;
    private parsed: ParsedCron;
    private state: TriggerState;
    private lastMinute = -1;
    private readonly config: TriggerConfig;
    private readonly callback: TriggerCallback;
    private readonly log: (msg: string) => void;

    constructor(config: TriggerConfig, callback: TriggerCallback, log?: (msg: string) => void) {
        if (!config.cron) {
            throw new Error(`Cron trigger "${config.id}" requires a cron expression`);
        }
        this.config = config;
        this.parsed = parseCron(config.cron);
        this.callback = callback;
        this.log = log ?? console.log;
        this.state = {
            id: config.id,
            type: 'cron',
            status: 'idle',
            fireCount: 0,
            activeSessions: 0,
        };
    }

    async start(): Promise<void> {
        if (this.timer) return;
        this.state.status = 'active';
        this.lastMinute = -1;

        this.timer = setInterval(() => this.tick(), 15_000);
        this.log(`  Cron trigger "${this.config.id}" started: ${describeCron(this.config.cron!)}`);
    }

    async stop(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.state.status = 'idle';
    }

    getState(): TriggerState {
        return { ...this.state };
    }

    private async tick(): Promise<void> {
        const now = new Date();
        const currentMinute = now.getHours() * 60 + now.getMinutes();

        if (currentMinute === this.lastMinute) return;
        this.lastMinute = currentMinute;

        if (!matchesCron(this.parsed, now)) return;

        if (this.config.cooldown && this.state.lastFired) {
            const elapsed = (now.getTime() - this.state.lastFired.getTime()) / 1000;
            if (elapsed < this.config.cooldown) return;
        }

        if (this.config.maxConcurrent && this.state.activeSessions >= this.config.maxConcurrent) {
            return;
        }

        const event: TriggerEvent = {
            triggerId: this.config.id,
            triggerType: 'cron',
            timestamp: now,
            payload: {
                cron: this.config.cron,
                scheduledTime: now.toISOString(),
                description: describeCron(this.config.cron!),
            },
            source: 'cron',
        };

        this.state.status = 'firing';
        this.state.lastFired = now;
        this.state.fireCount++;
        this.state.activeSessions++;

        try {
            await this.callback(event);
        } catch (err) {
            this.state.status = 'error';
            this.state.lastError = err instanceof Error ? err.message : String(err);
            this.log(`  Cron trigger "${this.config.id}" error: ${this.state.lastError}`);
        } finally {
            this.state.activeSessions = Math.max(0, this.state.activeSessions - 1);
            if (this.state.status === 'firing') {
                this.state.status = 'active';
            }
        }
    }
}
