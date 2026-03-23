import { Agent, type AgentConfig } from '../Agent.js';
import type { AgentMessage } from '../../types/joblog.js';
import type { ToolResolver } from '../../tools/types.js';

export type AggregationStrategy = 'collect' | 'merge' | 'summarize' | 'vote';

export interface AggregatorConfig extends Omit<AgentConfig, 'id' | 'name'> {
    id?: string;
    name?: string;
    expectedResults: number;
    strategy?: AggregationStrategy;
    systemPrompt?: string;
    onPartialResult?: (result: unknown, index: number, total: number) => void;
    toolResolver?: ToolResolver;
}

export class Aggregator extends Agent {
    private readonly expectedResults: number;
    private readonly strategy: AggregationStrategy;
    private readonly systemPrompt?: string;
    private readonly onPartialResult?: (result: unknown, index: number, total: number) => void;
    private collectedResults: Array<{ from: string; payload: unknown }> = [];

    constructor(config: AggregatorConfig) {
        super({
            ...config,
            id: config.id ?? 'aggregator',
            name: config.name ?? 'Aggregator',
        });
        this.expectedResults = config.expectedResults;
        this.strategy = config.strategy ?? 'collect';
        this.systemPrompt = config.systemPrompt;
        this.onPartialResult = config.onPartialResult;
    }

    protected async onStart(): Promise<void> {
        this.collectedResults = [];
    }

    protected async handleMessage(message: AgentMessage): Promise<void> {
        if (!message.jobId) {
            throw new Error('Aggregator received message without jobId');
        }

        if (message.type === 'task_result') {
            this.collectedResults.push({
                from: message.from,
                payload: message.payload,
            });

            if (this.onPartialResult) {
                this.onPartialResult(
                    message.payload,
                    this.collectedResults.length,
                    this.expectedResults,
                );
            }

            if (this.collectedResults.length >= this.expectedResults) {
                const aggregated = await this.aggregate();
                await this.sendResult(message.jobId, {
                    success: true,
                    aggregated,
                    sourceCount: this.collectedResults.length,
                });
                this.collectedResults = [];
            }
            return;
        }

        await this.send({
            type: 'task_result',
            to: message.from,
            jobId: message.jobId,
            payload: { error: 'Aggregator only accepts task_result messages' },
        });
    }

    private async aggregate(): Promise<unknown> {
        switch (this.strategy) {
            case 'collect':
                return this.collectedResults.map(r => r.payload);

            case 'merge': {
                const merged: Record<string, unknown> = {};
                for (const r of this.collectedResults) {
                    if (typeof r.payload === 'object' && r.payload !== null) {
                        Object.assign(merged, r.payload);
                    }
                }
                return merged;
            }

            case 'vote': {
                const votes = new Map<string, number>();
                for (const r of this.collectedResults) {
                    const key = JSON.stringify((r.payload as any)?.result ?? r.payload);
                    votes.set(key, (votes.get(key) ?? 0) + 1);
                }
                let maxVotes = 0;
                let winner = '';
                for (const [key, count] of votes) {
                    if (count > maxVotes) {
                        maxVotes = count;
                        winner = key;
                    }
                }
                return { winner: JSON.parse(winner), votes: maxVotes, total: this.collectedResults.length };
            }

            case 'summarize': {
                const prompt = this.buildSummarizePrompt();
                const result = await this.runtime.runAgent({
                    workdir: this.projectPath ?? process.cwd(),
                    task: prompt,
                });
                return {
                    summary: result.transcript,
                    sources: this.collectedResults.map(r => r.from),
                };
            }

            default:
                return this.collectedResults.map(r => r.payload);
        }
    }

    private buildSummarizePrompt(): string {
        const parts: string[] = [];
        if (this.systemPrompt) {
            parts.push(this.systemPrompt);
        } else {
            parts.push('Summarize the following results from multiple agents into a cohesive output.');
        }
        for (let i = 0; i < this.collectedResults.length; i++) {
            const r = this.collectedResults[i];
            parts.push(`Result from ${r.from}:\n${JSON.stringify(r.payload, null, 2)}`);
        }
        return parts.join('\n\n');
    }
}
