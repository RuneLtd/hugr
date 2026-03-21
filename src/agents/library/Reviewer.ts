
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Joblog } from '../../joblog/Joblog.js';
import type { AgentMessage } from '../../types/joblog.js';
import type { LLMProvider, StreamActivity } from '../../types/llm.js';
import { loadAgentSkills } from '../../utils/skills.js';

export interface ReviewerConfig {
	joblog: Joblog;
	runtime: LLMProvider;
	pollInterval?: number;
	projectPath?: string;
	onActivity?: (activity: ReviewerActivity) => void;

	agentTeams?: boolean;

	skipGitTracking?: boolean;

	skills?: string[];
}

export type ReviewerActivity = {
	type: 'thinking' | 'reading' | 'analyzing' | 'complete' | 'agent_summary';
	message: string;
	file?: string;
	agentId: string;
	jobId?: string;

	details?: string;

	tokenUsage?: { input: number; output: number };
};

export interface ReviewerRequestPayload {
	projectPath: string;

	sessionProjectPath?: string;

	originalPrompt: string;
}

export interface ReviewerResultPayload {

	summary: string;
}

const REVIEWER_TIMEOUT = 0;

export class Reviewer {
	private readonly joblog: Joblog;
	private readonly runtime: LLMProvider;
	private readonly pollInterval: number;
	private readonly projectPath?: string;
	private readonly onActivity?: (activity: ReviewerActivity) => void;
	private readonly agentTeams: boolean;
	private readonly skipGitTracking: boolean;
	private readonly skills: string[];

	private running = false;
	private stopRequested = false;

	constructor(config: ReviewerConfig) {
		this.joblog = config.joblog;
		this.runtime = config.runtime;
		this.pollInterval = config.pollInterval ?? 500;
		this.projectPath = config.projectPath;
		this.onActivity = config.onActivity;
		this.agentTeams = config.agentTeams ?? false;
		this.skipGitTracking = config.skipGitTracking ?? false;
		this.skills = config.skills ?? [];
	}

	async run(): Promise<void> {
		if (this.running) {
			throw new Error('Reviewer is already running');
		}

		this.running = true;
		this.stopRequested = false;

		try {
			while (!this.stopRequested) {
				const messages = await this.joblog.getMessages('reviewer');

				if (messages.length === 0) {
					await this.sleep(this.pollInterval);
					continue;
				}

				for (const message of messages) {
					if (this.stopRequested) break;

					try {
						await this.handleMessage(message);
					} catch (error) {
						console.error(
							`Error handling Reviewer message: ${error instanceof Error ? error.message : String(error)}`,
						);
					}

					await this.joblog.markMessageProcessed(message.id);
				}
			}
		} finally {
			this.running = false;
		}
	}

	stop(): void {
		this.stopRequested = true;
	}

	private async sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private async handleMessage(message: AgentMessage): Promise<void> {
		switch (message.type) {
			case 'reviewer_request':
				await this.handleReviewerRequest(message);
				break;

			case 'health_ping':
				await this.send({
					type: 'health_pong',
					to: message.from,
					payload: { status: 'active', currentTask: message.jobId },
				});
				break;

			default:
				console.warn(`Reviewer received unexpected message type: ${message.type}`);
		}
	}

	private async handleReviewerRequest(message: AgentMessage): Promise<void> {
		const payload = message.payload as ReviewerRequestPayload;

		if (!message.jobId) {
			throw new Error('reviewer_request without jobId');
		}

		const jobId = message.jobId;

		console.log(`\n${'═'.repeat(60)}`);
		console.log(`📋 REVIEWER STARTING`);
		console.log(`${'═'.repeat(60)}`);
		console.log(`   Job ID: ${jobId}`);
		console.log(`   Project: ${payload.projectPath}`);
		console.log(`   Prompt: ${payload.originalPrompt.slice(0, 80)}${payload.originalPrompt.length > 80 ? '...' : ''}`);

		try {
			await this.runReviewerSession(jobId, payload);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.log(`\n${'═'.repeat(60)}`);
			console.error(`❌ REVIEWER FAILED`);
			console.error(`   Error: ${errorMessage}`);
			console.log(`${'═'.repeat(60)}\n`);

			await this.send({
				type: 'task_result',
				to: 'manager',
				jobId,
				payload: {
					success: false,
					error: errorMessage,
				},
			});
		}
	}

	private async runReviewerSession(jobId: string, payload: ReviewerRequestPayload): Promise<void> {

		console.log(`   🎯 Skills configured: ${this.skills.length > 0 ? this.skills.join(', ') : 'none (using default)'}`);

		const reviewerSkill = await loadAgentSkills('reviewer', payload.projectPath, this.skills.length > 0 ? this.skills : undefined);

		if (!reviewerSkill) {
			console.log(`   ⚠️  No reviewer skill found, using default behavior`);
		}

		const sessionPath = payload.sessionProjectPath || payload.projectPath;

		const prompt = this.buildReviewerPrompt(payload);

		console.log(`\n   Launching Claude Code session for code review...`);

		const result = await (this.runtime as any).execute({
			workdir: payload.projectPath,
			sessionProjectPath: sessionPath,
			task: prompt,
			autoAccept: true,
			agentTeams: this.agentTeams,
			skipGitTracking: this.skipGitTracking,
			timeout: REVIEWER_TIMEOUT,
			allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
			skillContent: reviewerSkill,
			onActivity: this.onActivity
				? (streamActivity: StreamActivity) => {
						this.handleStreamActivity(jobId, streamActivity);
					}
				: undefined,
		});

		console.log(`\n${'─'.repeat(60)}`);
		console.log(`📋 REVIEWER SESSION COMPLETE`);
		console.log(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
		console.log(`   Success: ${result.success}`);

		if (!result.success) {
				if (result.sessionLimited) {
				await this.send({
					type: 'task_result',
					to: 'manager',
					jobId,
					payload: {
						success: false,
						sessionLimited: true,
						resetTime: result.resetTime,
						error: 'Session limit reached during code review',
					},
				});
				return;
			}
		}

		const transcript = result.transcript ?? '';
		const summary = this.extractSummary(transcript, result.success);

		console.log(`\n   📋 REVIEWER SUMMARY: ${summary.slice(0, 100)}...`);
		console.log(`\n${'═'.repeat(60)}`);
		console.log(`📋 REVIEWER COMPLETE`);
		console.log(`${'═'.repeat(60)}\n`);

		await this.sendResult(jobId, { summary }, result.sessionId);
	}

	private buildReviewerPrompt(payload: ReviewerRequestPayload): string {
		return `## User's Task / Context
${payload.originalPrompt}

## Instructions

Read through the project codebase and report your findings. Analyze the code and tell me what you find — errors, issues, and suggestions — organized clearly.`;
	}

	private extractSummary(transcript: string, success: boolean): string {
		if (!success || !transcript) {
			return 'Review completed but no findings were produced.';
		}

		const maxLen = 4000;
		if (transcript.length <= maxLen) {
			return transcript;
		}

		return '...' + transcript.slice(-maxLen);
	}

	private handleStreamActivity(jobId: string, activity: StreamActivity): void {
		if (!this.onActivity) return;

		switch (activity.type) {
			case 'tool_start': {
				if (!activity.displayInput) break;

				const toolName = activity.toolName?.toLowerCase() ?? '';
				let activityType: ReviewerActivity['type'] = 'reading';

				if (toolName.includes('read') || toolName.includes('glob') || toolName.includes('grep')) {
					activityType = 'reading';
				} else if (toolName.includes('bash')) {
					activityType = 'analyzing';
				}

				const details = JSON.stringify({
					toolName: activity.toolName,
					displayInput: activity.displayInput,
				});

				this.onActivity({
					type: activityType,
					message: `${activity.toolName} ${activity.displayInput}`,
					agentId: 'reviewer',
					jobId,
					file: undefined,
					details,
				});
				break;
			}

			case 'tool_progress': {
				const details = JSON.stringify({
					toolName: activity.toolName,
					elapsedSeconds: activity.elapsedSeconds,
				});
				this.onActivity({
					type: 'reading',
					message: activity.content || `${activity.toolName} (${activity.elapsedSeconds}s)`,
					agentId: 'reviewer',
					jobId,
					details,
				});
				break;
			}

			case 'tool_summary': {
				const details = JSON.stringify({
					toolName: activity.toolName,
					stat: activity.stat,
				});
				this.onActivity({
					type: 'reading',
					message: activity.stat || activity.content,
					agentId: 'reviewer',
					jobId,
					details,
				});
				break;
			}

			case 'text':
				if (activity.content.length > 10) {
					this.onActivity({
						type: 'thinking',
						message: activity.content,
						agentId: 'reviewer',
						jobId,
					});
				}
				break;

			case 'thinking':
				this.onActivity({
					type: 'thinking',
					message: activity.content,
					agentId: 'reviewer',
					jobId,
				});
				break;

			case 'error':
				this.onActivity({
					type: 'thinking',
					message: `Error: ${activity.content}`,
					agentId: 'reviewer',
					jobId,
				});
				break;

			case 'result': {
				if (activity.content && activity.content !== 'Completed' && activity.content.length > 10) {
					this.onActivity({
						type: 'agent_summary',
						message: activity.content,
						agentId: 'reviewer',
						jobId,
					});
				}
				this.onActivity({
					type: 'complete',
					message: 'Code review complete',
					agentId: 'reviewer',
					jobId,
					tokenUsage: activity.tokenUsage,
				});
				break;
			}
		}
	}

	private async send(message: Omit<AgentMessage, 'id' | 'timestamp' | 'processed' | 'from'>): Promise<void> {
		await this.joblog.sendMessage({
			type: message.type as AgentMessage['type'],
			from: 'reviewer',
			to: message.to,
			jobId: message.jobId,
			payload: message.payload,
		});
	}

	private async sendResult(jobId: string, result: ReviewerResultPayload, providerSessionId?: string): Promise<void> {
		await this.send({
			type: 'task_result',
			to: 'manager',
			jobId,
			payload: {
				success: true,
				summary: result.summary,
				output: {
					files: [],
					summary: result.summary,
				},
				providerSessionId,
			},
		});
	}
}
