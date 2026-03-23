
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Agent } from '../Agent.js';
import type { Joblog } from '../../joblog/Joblog.js';
import type { AgentMessage } from '../../types/joblog.js';
import type { AgentRuntime, AgentActivity } from '../../runtime/types.js';
import { loadAgentSkills } from '../../utils/skills.js';
import type { ToolResolver } from '../../tools/types.js';

export interface ReviewerConfig {
	joblog: Joblog;
	runtime: AgentRuntime;
	pollInterval?: number;
	projectPath?: string;
	onActivity?: (activity: ReviewerActivity) => void;

	agentTeams?: boolean;

	skipGitTracking?: boolean;

	skills?: string[];

	skillPrefix?: string;

	toolResolver?: ToolResolver;
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

export class Reviewer extends Agent {
	private readonly onActivity?: (activity: ReviewerActivity) => void;
	private readonly agentTeams: boolean;
	private readonly skipGitTracking: boolean;
	private readonly skills: string[];

	constructor(config: ReviewerConfig) {
		super({
			id: 'reviewer',
			name: 'Reviewer',
			joblog: config.joblog,
			runtime: config.runtime,
			pollInterval: config.pollInterval ?? 500,
			projectPath: config.projectPath,
			skillPrefix: config.skillPrefix,
			toolResolver: config.toolResolver,
		});
		this.onActivity = config.onActivity;
		this.agentTeams = config.agentTeams ?? false;
		this.skipGitTracking = config.skipGitTracking ?? false;
		this.skills = config.skills ?? [];
	}

	protected async handleMessage(message: AgentMessage): Promise<void> {
		switch (message.type) {
			case 'reviewer_request':
				await this.handleReviewerRequest(message);
				break;

			case 'health_ping':
				await this.send({
					type: 'health_pong',
					to: message.from,
					jobId: message.jobId,
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

		const reviewerSkill = await loadAgentSkills('reviewer', payload.projectPath, this.skills.length > 0 ? this.skills : undefined, this.skillPrefix);

		if (!reviewerSkill) {
			console.log(`   ⚠️  No reviewer skill found, using default behavior`);
		}

		const sessionPath = payload.sessionProjectPath || payload.projectPath;

		const prompt = this.buildReviewerPrompt(payload);

		console.log(`\n   Launching Claude Code session for code review...`);

		const result = await this.runtime.runAgent({
			workdir: payload.projectPath,
			task: prompt,
			allowedTools: this.resolveTools('read-only', ['Read', 'Glob', 'Grep', 'Bash']),
			runtimeOptions: {
				sessionProjectPath: sessionPath,
				autoAccept: true,
				agentTeams: this.agentTeams,
				skipGitTracking: this.skipGitTracking,
				skillContent: reviewerSkill,
			},
			onActivity: this.onActivity
				? (streamActivity: AgentActivity) => {
						this.handleStreamActivity(jobId, streamActivity);
					}
				: undefined,
		});

		console.log(`\n${'─'.repeat(60)}`);
		console.log(`📋 REVIEWER SESSION COMPLETE`);
		console.log(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
		console.log(`   Success: ${result.success}`);

		if (!result.success) {
			if (result.rateLimited) {
				await this.send({
					type: 'task_result',
					to: 'manager',
					jobId,
					payload: {
						success: false,
						sessionLimited: true,
						resetTime: result.rateLimitInfo?.retryAfter,
						error: 'Session limit reached during code review',
					},
				});
				return;
			}

			console.warn(`   ⚠️  Reviewer session failed (non-session-limit), attempting to extract summary anyway`);
		}

		const transcript = result.transcript ?? '';
		const summary = this.extractSummary(transcript, result.success);

		console.log(`\n   📋 REVIEWER SUMMARY: ${summary.slice(0, 100)}...`);
		console.log(`\n${'═'.repeat(60)}`);
		console.log(`📋 REVIEWER COMPLETE`);
		console.log(`${'═'.repeat(60)}\n`);

		await this.sendReviewerResult(jobId, { summary }, (result.runtimeMetadata?.sessionId as string | undefined));
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

	private handleStreamActivity(jobId: string, activity: AgentActivity): void {
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
					agentId: this.id,
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
					agentId: this.id,
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
					agentId: this.id,
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
						agentId: this.id,
						jobId,
					});
				}
				break;

			case 'thinking':
				this.onActivity({
					type: 'thinking',
					message: activity.content,
					agentId: this.id,
					jobId,
				});
				break;

			case 'error':
				this.onActivity({
					type: 'thinking',
					message: `Error: ${activity.content}`,
					agentId: this.id,
					jobId,
				});
				break;

			case 'result': {
				if (activity.content && activity.content !== 'Completed' && activity.content.length > 10) {
					this.onActivity({
						type: 'agent_summary',
						message: activity.content,
						agentId: this.id,
						jobId,
					});
				}
				this.onActivity({
					type: 'complete',
					message: 'Code review complete',
					agentId: this.id,
					jobId,
					tokenUsage: activity.tokenUsage,
				});
				break;
			}
		}
	}

	private async sendReviewerResult(jobId: string, result: ReviewerResultPayload, providerSessionId?: string): Promise<void> {
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
