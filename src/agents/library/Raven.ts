
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { loadDefaultSkill } from '../../utils/skills.js';

import type { Joblog } from '../../joblog/Joblog.js';
import type { AgentMessage } from '../../types/joblog.js';
import type { LLMProvider, StreamActivity } from '../../types/llm.js';
import { detectSessionLimit, AGENT_OUTPUT_FILES } from '../../constants.js';
import { resolveSessionDataDir } from '../../paths.js';

export interface RavenConfig {
	joblog: Joblog;
	provider: LLMProvider;
	pollInterval?: number;
	projectPath?: string;
	onActivity?: (activity: RavenActivity) => void;

	agentTeams?: boolean;

	skipGitTracking?: boolean;
}

export type RavenActivity = {
	type: 'thinking' | 'reading' | 'analyzing' | 'complete' | 'agent_summary';
	message: string;
	file?: string;
	agentId: string;
	jobId?: string;

	details?: string;

	tokenUsage?: { input: number; output: number };
};

export interface RavenRequestPayload {
	projectPath: string;
	worktreePath: string;

	sessionProjectPath?: string;

	originalPrompt: string;

	currentPrompt: string;
	iteration: number;
	previousSummaries: string[];
}

export interface RavenResultPayload {
	done: boolean;
	assessment: string;
	improvements: string[];
	nextPrompt?: string;
	summary: string;
}

export class Raven {
	private readonly joblog: Joblog;
	private readonly provider: LLMProvider;
	private readonly pollInterval: number;
	private readonly projectPath?: string;
	private readonly onActivity?: (activity: RavenActivity) => void;
	private readonly agentTeams: boolean;
	private readonly skipGitTracking: boolean;

	private running = false;
	private stopRequested = false;

	constructor(config: RavenConfig) {
		this.joblog = config.joblog;
		this.provider = config.provider;
		this.pollInterval = config.pollInterval ?? 500;
		this.projectPath = config.projectPath;
		this.onActivity = config.onActivity;
		this.agentTeams = config.agentTeams ?? false;
		this.skipGitTracking = config.skipGitTracking ?? false;
	}

	async run(): Promise<void> {
		if (this.running) {
			throw new Error('Raven is already running');
		}

		this.running = true;
		this.stopRequested = false;

		try {
			while (!this.stopRequested) {
				const messages = await this.joblog.getMessages('raven');

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
							`Error handling Raven message: ${error instanceof Error ? error.message : String(error)}`,
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
			case 'raven_request':
				await this.handleRavenRequest(message);
				break;

			case 'health_ping':
				await this.send({
					type: 'health_pong',
					to: message.from,
					payload: { status: 'active', currentTask: message.jobId },
				});
				break;

			default:
				console.warn(`Raven received unexpected message type: ${message.type}`);
		}
	}

	private async handleRavenRequest(message: AgentMessage): Promise<void> {
		const payload = message.payload as RavenRequestPayload;

		if (!message.jobId) {
			throw new Error('raven_request without jobId');
		}

		const jobId = message.jobId;

		console.log(`\n${'═'.repeat(60)}`);
		console.log(`🐦 RAVEN STARTING`);
		console.log(`${'═'.repeat(60)}`);
		console.log(`   Job ID: ${jobId}`);
		console.log(`   Iteration: ${payload.iteration}`);
		console.log(`   Project: ${payload.projectPath}`);
		console.log(`   Session project: ${payload.sessionProjectPath || 'same as project'}`);
		console.log(`   Original prompt (${payload.originalPrompt.length} chars): ${payload.originalPrompt.slice(0, 150)}${payload.originalPrompt.length > 150 ? '...' : ''}`);
		console.log(`   Current prompt (${payload.currentPrompt.length} chars): ${payload.currentPrompt.slice(0, 200)}${payload.currentPrompt.length > 200 ? '...' : ''}`);
		console.log(`   Previous summaries (${payload.previousSummaries.length}):`);
		payload.previousSummaries.forEach((s, i) => console.log(`     ${i}: ${s.slice(0, 100)}...`));

		try {
			await this.runRavenSession(jobId, payload);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.log(`\n${'═'.repeat(60)}`);
			console.error(`❌ RAVEN FAILED`);
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

	private async runRavenSession(jobId: string, payload: RavenRequestPayload): Promise<void> {

		const ravenSkill = await loadDefaultSkill('raven', payload.projectPath);

		if (!ravenSkill) {
			console.log(`   ⚠️  No raven skill found, using default behavior`);
		}

		const sessionPath = payload.sessionProjectPath || payload.projectPath;

		const prompt = this.buildRavenPrompt(payload);

		console.log(`\n   📤 RAVEN PROMPT TO CLAUDE CODE (${prompt.length} chars):`);
		console.log(`   ${prompt.slice(0, 400)}${prompt.length > 400 ? '...' : ''}`);
		console.log(`   Skill loaded: ${!!ravenSkill} (${(ravenSkill || '').length} chars)`);
		console.log(`\n   Launching Claude Code session for code review...`);

		const result = await this.provider.execute({
			workdir: payload.projectPath,
			sessionProjectPath: sessionPath,
			task: prompt,
			autoAccept: true,
			agentTeams: this.agentTeams,
			skipGitTracking: this.skipGitTracking,
			timeout: 0,
			allowedTools: ['Read', 'Write', 'Glob', 'Grep', 'Bash'],
			skillContent: ravenSkill,
			onActivity: this.onActivity
				? (streamActivity: StreamActivity) => {
						this.handleStreamActivity(jobId, streamActivity);
					}
				: undefined,
		});

		console.log(`\n${'─'.repeat(60)}`);
		console.log(`🐦 RAVEN SESSION COMPLETE`);
		console.log(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
		console.log(`   Success: ${result.success}`);

		if (!result.success) {
			const limitCheck = detectSessionLimit(result.transcript ?? '');
			if (limitCheck.isLimited) {
				console.log(`   ⚠️  SESSION LIMIT DETECTED IN RAVEN`);
				await this.send({
					type: 'task_result',
					to: 'manager',
					jobId,
					payload: {
						success: false,
						sessionLimited: true,
						resetTime: limitCheck.resetTime,
						error: `Session limit reached during Raven review (iteration ${payload.iteration})`,
					},
				});
				return;
			}
		}

		let ravenResult: RavenResultPayload;
		const sessionDir = resolveSessionDataDir(sessionPath);
		const reviewFilePath = join(sessionDir, AGENT_OUTPUT_FILES.ravenReview);

		try {
			const fileContent = await readFile(reviewFilePath, 'utf-8');
			ravenResult = JSON.parse(fileContent) as RavenResultPayload;
			console.log(`   ✔ Read Raven review from ${AGENT_OUTPUT_FILES.ravenReview}`);

			try {
				await unlink(reviewFilePath);
			} catch {

			}
		} catch (fileError) {
			console.warn(
				`   ⚠️  Could not read Raven review file: ${fileError instanceof Error ? fileError.message : fileError}`,
			);

			try {
				const transcript = result.transcript ?? '';
				const jsonMatch = transcript.match(/\{[\s\S]*"done"[\s\S]*\}/);
				if (jsonMatch) {
					ravenResult = JSON.parse(jsonMatch[0]) as RavenResultPayload;
					console.log(`   ⚠️  Fell back to transcript parsing`);
				} else {
					throw new Error('No JSON output found in file or transcript');
				}
			} catch (e) {
				console.warn(
					`   ⚠️  Could not parse Raven result from transcript either: ${e instanceof Error ? e.message : e}`,
				);

				ravenResult = {
					done: true,
					assessment: 'Raven evaluation completed but could not parse structured output',
					improvements: [],
					summary: `Iteration ${payload.iteration}: evaluation complete`,
				};
			}
		}

		ravenResult = this.validateRavenResult(ravenResult);

		console.log(`\n   📋 RAVEN ASSESSMENT:`);
		console.log(`   ├─ Done: ${ravenResult.done}`);
		console.log(`   ├─ Assessment: ${ravenResult.assessment.slice(0, 100)}...`);
		console.log(`   ├─ Improvements: ${ravenResult.improvements.length}`);
		if (ravenResult.improvements.length > 0) {
			for (let i = 0; i < Math.min(ravenResult.improvements.length, 5); i++) {
				console.log(`   │  ${i + 1}. ${ravenResult.improvements[i].slice(0, 60)}...`);
			}
			if (ravenResult.improvements.length > 5) {
				console.log(`   │  ... and ${ravenResult.improvements.length - 5} more`);
			}
		}
		console.log(`   └─ Summary: ${ravenResult.summary.slice(0, 60)}...`);
		if (ravenResult.nextPrompt) {
			console.log(`   📝 nextPrompt (${ravenResult.nextPrompt.length} chars): ${ravenResult.nextPrompt.slice(0, 200)}${ravenResult.nextPrompt.length > 200 ? '...' : ''}`);
		}

		console.log(`\n${'═'.repeat(60)}`);
		console.log(`🐦 RAVEN COMPLETE (done=${ravenResult.done})`);
		console.log(`${'═'.repeat(60)}\n`);

		await this.sendResult(jobId, ravenResult, result.sessionId);
	}

	private buildRavenPrompt(payload: RavenRequestPayload): string {
		const previousContext =
			payload.previousSummaries.length > 0
				? `## Previous Iterations\n${payload.previousSummaries.map((s, i) => `Iteration ${i + 1}: ${s}`).join('\n\n')}\n\n`
				: '';

		const sessionPath = payload.sessionProjectPath || payload.projectPath;
		const sessionDir = resolveSessionDataDir(sessionPath);
		const reviewFilePath = join(sessionDir, AGENT_OUTPUT_FILES.ravenReview);

		const originalSection = payload.iteration > 0
			? `## Original User Request\n${payload.originalPrompt}\n\n`
			: '';

		return `${originalSection}## What Was Done This Iteration
${payload.currentPrompt}

## Context
Iteration: ${payload.iteration}
${previousContext}
## Output Path

Write your review as JSON using the Write tool to this exact path:
${reviewFilePath}

Required JSON shape:
{
  "done": boolean,
  "assessment": "What you found in the implementation",
  "improvements": ["specific improvement 1", "specific improvement 2", "...as many as needed — don't limit yourself"],
  "nextPrompt": "ONLY if done is false. Concrete, actionable prompt for the Coder.",
  "summary": "One sentence summary"
}`;
	}

	private validateRavenResult(result: unknown): RavenResultPayload {
		const obj = result as Record<string, unknown>;

		const done = typeof obj.done === 'boolean' ? obj.done : false;
		const assessment =
			typeof obj.assessment === 'string' ? obj.assessment : 'No assessment provided';
		const summary = typeof obj.summary === 'string' ? obj.summary : 'Raven review complete';

		let improvements: string[] = [];
		if (Array.isArray(obj.improvements)) {
			improvements = obj.improvements
				.map(i => (typeof i === 'string' ? i : JSON.stringify(i)))
				.filter(Boolean);
		}

		let nextPrompt: string | undefined;
		if (!done) {
			if (typeof obj.nextPrompt === 'string' && obj.nextPrompt.trim().length > 0) {
				nextPrompt = obj.nextPrompt;
			} else if (improvements.length > 0) {

				nextPrompt = `Address these improvements:\n${improvements.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}`;
			} else {

				nextPrompt =
					'Continue implementing based on original requirements. Focus on completeness and edge cases.';
			}
		}

		return {
			done,
			assessment,
			improvements,
			nextPrompt,
			summary,
		};
	}

	private handleStreamActivity(jobId: string, activity: StreamActivity): void {
		if (!this.onActivity) return;

		switch (activity.type) {
			case 'tool_start': {

				if (!activity.displayInput) break;

				const toolName = activity.toolName?.toLowerCase() ?? '';
				let activityType: RavenActivity['type'] = 'reading';

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
					agentId: 'raven',
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
					agentId: 'raven',
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
					agentId: 'raven',
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
						agentId: 'raven',
						jobId,
					});
				}
				break;

			case 'thinking':

				this.onActivity({
					type: 'thinking',
					message: activity.content,
					agentId: 'raven',
					jobId,
				});
				break;

			case 'error':
				this.onActivity({
					type: 'thinking',
					message: `Error: ${activity.content}`,
					agentId: 'raven',
					jobId,
				});
				break;

			case 'result': {

				if (activity.content && activity.content !== 'Completed' && activity.content.length > 10) {
					this.onActivity({
						type: 'agent_summary',
						message: activity.content,
						agentId: 'raven',
						jobId,
					});
				}
				this.onActivity({
					type: 'complete',
					message: 'Review complete',
					agentId: 'raven',
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
			from: 'raven',
			to: message.to,
			jobId: message.jobId,
			payload: message.payload,
		});
	}

	private async sendResult(jobId: string, result: RavenResultPayload, ccSessionId?: string): Promise<void> {
		await this.send({
			type: 'task_result',
			to: 'manager',
			jobId,
			payload: {
				success: true,
				done: result.done,
				summary: result.summary,
				nextPrompt: result.nextPrompt,
				output: {
					files: [],
					summary: result.summary,
				},
				ccSessionId,
			},
		});
	}
}
