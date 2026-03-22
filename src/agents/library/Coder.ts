
import { Agent } from '../Agent.js';
import type { Joblog } from '../../joblog/Joblog.js';
import type { AgentMessage, JobOutput } from '../../types/joblog.js';
import type { LLMProvider, StreamActivity } from '../../types/llm.js';
import type { AgentRuntime } from '../../runtime/types.js';
import { AGENT_OUTPUT_FILES } from '../../constants.js';
import { resolveSessionDataDir } from '../../paths.js';
import type { InterruptRequest } from '../../interrupt/types.js';
import { commitAll } from '../../git/index.js';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { loadAgentSkills, loadDefaultSkill } from '../../utils/skills.js';

export interface HookState {
  jobId: string;
  task: string;
  projectPath: string;
  startedAt: string;

  sdkSessionId?: string;
}

export type CoderActivity = {
  type: 'thinking' | 'tool_use' | 'writing' | 'reviewing' | 'complete' | 'error' | 'agent_summary';
  message: string;
  tool?: string;
  file?: string;
  agentId: string;
  jobId?: string;

  details?: string;

  tokenUsage?: { input: number; output: number };
};

export interface CoderConfig {
  joblog: Joblog;
  runtime: AgentRuntime | LLMProvider;
  pollInterval?: number;

  projectPath?: string;

  autoAccept?: boolean;

  onActivity?: (activity: CoderActivity) => void;

  selfReview?: boolean;

  agentTeams?: boolean;

  skipGitTracking?: boolean;

  skills?: string[];

  skillPrefix?: string;
}

export class Coder extends Agent {
  private readonly autoAccept: boolean;
  private readonly onActivity?: (activity: CoderActivity) => void;
  private readonly selfReview: boolean;
  private readonly agentTeams: boolean;
  private readonly skipGitTracking: boolean;
  private readonly skills: string[];

  constructor(config: CoderConfig) {
    super({
      id: 'coder',
      name: 'Coder',
      joblog: config.joblog,
      runtime: config.runtime as AgentRuntime,
      pollInterval: config.pollInterval,
      projectPath: config.projectPath,
      skillPrefix: config.skillPrefix,
    });

    this.autoAccept = config.autoAccept ?? true;
    this.onActivity = config.onActivity;
    this.selfReview = config.selfReview ?? true;
    this.agentTeams = config.agentTeams ?? false;
    this.skipGitTracking = config.skipGitTracking ?? false;
    this.skills = config.skills ?? [];
  }

  private getHookFilename(): string {
    return AGENT_OUTPUT_FILES.currentHook;
  }

  private async writeHook(projectPath: string, hook: HookState): Promise<void> {
    const sessionDir = resolveSessionDataDir(projectPath);
    await mkdir(sessionDir, { recursive: true });
    const hookPath = join(sessionDir, this.getHookFilename());
    await writeFile(hookPath, JSON.stringify(hook, null, 2), 'utf-8');
    console.log(`   🪝 Hook written`);
  }

  private async readHook(projectPath: string): Promise<HookState | null> {
    const hookPath = join(resolveSessionDataDir(projectPath), this.getHookFilename());
    try {
      const content = await readFile(hookPath, 'utf-8');
      try {
        const hook = JSON.parse(content);

        if (!hook.jobId || !hook.task || !hook.projectPath) {
          console.warn('   ⚠️ Hook file missing required fields, deleting');
          await this.clearHook(projectPath);
          return null;
        }
        return hook as HookState;
      } catch {
        console.warn('   ⚠️ Corrupt hook file, deleting');
        await this.clearHook(projectPath);
        return null;
      }
    } catch {
      return null;
    }
  }

  private async clearHook(projectPath: string): Promise<void> {
    const hookPath = join(resolveSessionDataDir(projectPath), this.getHookFilename());
    try {
      await unlink(hookPath);
      console.log(`   🪝 Hook cleared`);
    } catch {

    }
  }

  async run(): Promise<void> {
    if (this.projectPath) {
      try {
        const recovered = await this.checkHookRecovery(this.projectPath);
        if (recovered) {
          console.log('   ✅ Hook recovery completed, continuing normal operation');
        }
      } catch (error) {
        console.warn('   ⚠️ Hook recovery check failed:', error);
      }
    }

    return super.run();
  }

  protected async handleInterrupt(interrupt: InterruptRequest): Promise<void> {
    console.log(`   ⚡ [${this.id}] Handling interrupt: ${interrupt.type} — ${interrupt.reason}`);

    switch (interrupt.type) {
      case 'stop': {

        if (this.projectPath) {
          const hook = await this.readHook(this.projectPath);
          if (hook) {
            await this.clearHook(this.projectPath);

            await this.sendResult(hook.jobId, {
              success: false,
              error: `Task interrupted by user: ${interrupt.reason}`,
              interrupted: true,
              interruptType: 'stop',
            });
          }
        }
        this.stop();
        break;
      }

      case 'redirect': {

        if (this.projectPath) {
          const hook = await this.readHook(this.projectPath);
          if (hook) {
            await this.clearHook(this.projectPath);
            await this.sendResult(hook.jobId, {
              success: false,
              error: `Task redirected by user: ${interrupt.reason}`,
              interrupted: true,
              interruptType: 'redirect',
              newTask: interrupt.payload?.newTask,
            });
          }
        }
        break;
      }

      case 'modify': {

        if (this.projectPath) {
          const hook = await this.readHook(this.projectPath);
          if (hook && interrupt.payload?.modifications) {
            hook.task += '\n\n## User Modifications\n' +
              interrupt.payload.modifications.map(m => `- ${m}`).join('\n');
            await this.writeHook(this.projectPath, hook);
            await this.sendResult(hook.jobId, {
              success: false,
              error: `Task modified by user: ${interrupt.reason}`,
              interrupted: true,
              interruptType: 'modify',
              modifications: interrupt.payload.modifications,
            });
          }
        }
        break;
      }
    }
  }

  private handleStreamActivity(jobId: string, activity: StreamActivity): void {
    if (!this.onActivity) return;

    switch (activity.type) {
      case 'tool_start': {

        if (!activity.displayInput) break;

        const toolName = activity.toolName?.toLowerCase() ?? '';
        let activityType: CoderActivity['type'] = 'tool_use';

        if (toolName.includes('read') || toolName.includes('glob') || toolName.includes('grep')) {
          activityType = 'tool_use';
        } else if (toolName.includes('write') || toolName.includes('edit')) {
          activityType = 'writing';
        }

        const details = JSON.stringify({
          toolName: activity.toolName,
          displayInput: activity.displayInput,
        });

        this.onActivity({
          type: activityType,
          message: `${activity.toolName} ${activity.displayInput}`,
          tool: activity.toolName,
          agentId: this.id,
          jobId,
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
          type: 'tool_use',
          message: activity.content || `${activity.toolName} (${activity.elapsedSeconds}s)`,
          tool: activity.toolName,
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
          type: 'tool_use',
          message: activity.stat || activity.content,
          tool: activity.toolName,
          agentId: this.id,
          jobId,
          details,
        });
        break;
      }

      case 'text': {

        if (activity.content.length > 10) {
          this.onActivity({
            type: 'thinking',
            message: activity.content,
            agentId: this.id,
            jobId,
          });
        }
        break;
      }

      case 'thinking': {

        this.onActivity({
          type: 'thinking',
          message: activity.content,
          agentId: this.id,
          jobId,
        });
        break;
      }

      case 'error': {
        this.onActivity({
          type: 'error',
          message: `Error: ${activity.content}`,
          agentId: this.id,
          jobId,
        });
        break;
      }

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
          message: 'Completed',
          agentId: this.id,
          jobId,
          tokenUsage: activity.tokenUsage,
        });
        break;
      }
    }
  }


  protected async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case 'task_assignment':
        await this.handleTaskAssignment(message);
        break;

      case 'health_ping':
        await this.send({
          type: 'health_pong',
          to: message.from,
          payload: { status: 'active', currentTask: message.jobId },
        });
        break;

      default:
        console.warn(`Coder received unexpected message type: ${message.type}`);
    }
  }

  private async checkHookRecovery(projectPath: string): Promise<boolean> {
    const hook = await this.readHook(projectPath);

    if (!hook) return false;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🪝 CRASH RECOVERY: Found hooked task`);
    console.log(`   Job: ${hook.jobId}`);
    console.log(`   Task: ${hook.task.slice(0, 80)}...`);
    console.log(`   Started: ${hook.startedAt}`);
    console.log(`   SDK Session: ${hook.sdkSessionId ?? 'none (will start fresh)'}`);
    console.log(`${'═'.repeat(60)}\n`);

    await this.send({
      type: 'task_result',
      to: 'manager',
      jobId: hook.jobId,
      payload: {
        success: false,
        error: 'Crash recovery: re-executing hooked task',
        crashRecovery: true,
      },
    });

    const syntheticMessage: AgentMessage = {
      id: `recovery-${Date.now()}` as AgentMessage['id'],
      type: 'task_assignment',
      from: 'manager',
      to: this.id,
      jobId: hook.jobId,
      payload: {
        task: hook.task,
        projectPath: hook.projectPath,
      },
      timestamp: new Date(),
      processed: false,
    };

    await this.handleTaskAssignment(syntheticMessage);

    return true;
  }

  private async handleTaskAssignment(message: AgentMessage): Promise<void> {
    const payload = message.payload as {
      task: string;
      projectPath: string;
      iteration?: number;
      originalPrompt?: string;

      resumeProviderSession?: string;

      images?: Array<{ id: string; name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; base64: string }>;
      filePaths?: string[];
    };

    if (!message.jobId) {
      throw new Error('Task assignment without jobId');
    }

    const jobId = message.jobId;
    const iteration = payload.iteration ?? 0;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🤖 CODER STARTING (Iteration ${iteration})`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`   Job ID: ${jobId}`);
    console.log(`   Project: ${payload.projectPath}`);
    console.log(`   Task (${payload.task.length} chars): ${payload.task.slice(0, 250)}${payload.task.length > 250 ? '...' : ''}`);
    console.log(`   Original prompt: ${payload.originalPrompt ? `${payload.originalPrompt.slice(0, 100)}...` : 'not provided'}`);
    console.log(`   Auto-accept: ${this.autoAccept}`);
    console.log(`   Self-review: ${this.selfReview}`);
    console.log(`   Resume provider session: ${payload.resumeProviderSession || 'none'}`);
    console.log(`   Images: ${payload.images?.length || 0}`);

    await this.logActivity(jobId, 'llm_call', {
      action: 'execute',
      description: payload.task,
    });

    try {

      let context = 'Read the codebase to understand existing patterns before making changes.\n\nIMPORTANT: Do not ask clarifying questions. Make reasonable assumptions and proceed with the implementation. If the task is ambiguous, choose the most likely interpretation and execute it.';

      console.log(`\n   Built context (${context.length} chars): ${context.slice(0, 150)}`);

      let skillContent: string | undefined;
      if (this.skills.length > 0) {
        skillContent = await loadAgentSkills('coder', payload.projectPath, this.skills, this.skillPrefix);
      } else {
        skillContent = await loadDefaultSkill('coder', payload.projectPath, this.skillPrefix);
        if (!skillContent) {
          skillContent = await loadDefaultSkill('styling', payload.projectPath, this.skillPrefix);
        }
      }
      console.log(`   Skill loaded: ${!!skillContent} (${(skillContent || '').length} chars)`);
      console.log(`   📤 CODER PROMPT TO CLAUDE CODE (${payload.task.length} chars):`);
      console.log(`   ${payload.task.slice(0, 400)}${payload.task.length > 400 ? '...' : ''}`);
      console.log(`   Launching Claude Code session...`);

      const taskPrompt = payload.task;

      const sessionPath = this.projectPath || payload.projectPath;

      const existingHook = await this.readHook(sessionPath);
      const resumeSessionId = payload.resumeProviderSession || existingHook?.sdkSessionId;

      await this.writeHook(sessionPath, {
        jobId,
        task: payload.task,
        projectPath: payload.projectPath,
        startedAt: new Date().toISOString(),
        sdkSessionId: resumeSessionId,
      });

      if (resumeSessionId) {
        console.log(`   🔄 Resuming SDK session: ${resumeSessionId}`);
      }

      this.onActivity?.({
        type: 'thinking',
        message: `Starting: ${payload.task.slice(0, 60)}...`,
        agentId: this.id,
        jobId,
      });

      const result = await (this.runtime as any).execute({
        workdir: payload.projectPath,
        sessionProjectPath: sessionPath,
        task: taskPrompt,
        context,
        autoAccept: this.autoAccept,
        agentTeams: this.agentTeams,
        skillContent,
        skipGitTracking: this.skipGitTracking,
        resume: resumeSessionId,
        images: payload.images,
        filePaths: payload.filePaths,
        onSessionInit: (sdkSessionId: string) => {

          this.writeHook(sessionPath, {
            jobId,
            task: payload.task,
            projectPath: payload.projectPath,
            startedAt: new Date().toISOString(),
            sdkSessionId,
          }).catch(err => console.warn('   ⚠️ Failed to update hook with SDK session ID:', err));
        },
        onActivity: this.onActivity ? (streamActivity: StreamActivity) => {
          this.handleStreamActivity(jobId, streamActivity);
        } : undefined,
      });

      console.log(`\n${'─'.repeat(60)}`);
      console.log(`🤖 CODER IMPLEMENTATION COMPLETE`);
      console.log(`   Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
      console.log(`   Success: ${result.success}`);
      console.log(`   Files changed: ${result.filesChanged.length}`);
      if (result.filesChanged.length > 0) {
        result.filesChanged.slice(0, 5).forEach((f: string) => console.log(`     - ${f}`));
        if (result.filesChanged.length > 5) {
          console.log(`     ... and ${result.filesChanged.length - 5} more`);
        }
      }
      if (result.error) {
        console.log(`   Error: ${result.error.slice(0, 100)}...`);
      }

      if (result.success) {

        const implementationSessionId = result.sessionId;

        if (!this.selfReview) {
          console.log(`   ⏭️ Self-review disabled — skipping`);
        } else if (implementationSessionId) {
          console.log(`\n${'─'.repeat(60)}`);
          console.log(`🔍 CODER SELF-REVIEW STARTING (resuming session ${implementationSessionId})`);
          console.log(`${'─'.repeat(60)}`);

          this.onActivity?.({
            type: 'reviewing',
            message: 'Reviewing implementation for errors...',
            agentId: this.id,
            jobId,
          });

          const reviewResult = await (this.runtime as any).execute({
            workdir: payload.projectPath,
            sessionProjectPath: sessionPath,
            task: `Review the code you just wrote. Look for:
1. Missing functionality — did you implement everything that was asked for?
2. Broken imports, type errors, or syntax issues
3. Runtime errors — would this actually work if someone ran it right now?
4. Missing error handling or edge cases that would cause crashes

Run any available build, lint, or test commands to verify.
Fix anything you find. Be surgical — don't refactor or restructure working code, just fix what's broken.

If everything looks good and runs without errors, you're done.`,
            context,
            autoAccept: this.autoAccept,
            agentTeams: this.agentTeams,
            skillContent,
            skipGitTracking: true,
            resume: implementationSessionId,
            onActivity: this.onActivity ? (streamActivity: StreamActivity) => {
              this.handleStreamActivity(jobId, streamActivity);
            } : undefined,
          });

          console.log(`\n${'─'.repeat(60)}`);
          console.log(`🔍 CODER SELF-REVIEW COMPLETE`);
          console.log(`   Duration: ${(reviewResult.durationMs / 1000).toFixed(1)}s`);
          console.log(`   Success: ${reviewResult.success}`);
          if (reviewResult.filesChanged.length > 0) {
            console.log(`   Files fixed: ${reviewResult.filesChanged.length}`);
            reviewResult.filesChanged.slice(0, 5).forEach((f: string) => console.log(`     - ${f}`));
          }
          console.log(`${'─'.repeat(60)}`);

          if (!reviewResult.success) {
            console.warn(`   ⚠️ Self-review session failed, continuing with implementation result`);

            if (reviewResult.sessionLimited) {
              await this.sendResult(jobId, {
                success: false,
                error: `Session limit reached during self-review${reviewResult.resetTime ? ` - resets ${reviewResult.resetTime}` : ''}`,
                sessionLimited: true,
                resetTime: reviewResult.resetTime,
              });
              return;
            }
          }
        } else {
          console.warn(`   ⚠️ No session ID from implementation — skipping self-review`);
        }

        await this.clearHook(sessionPath);

        const ACTION_MAP: Record<string, string> = { created: 'create', modified: 'modify', deleted: 'delete' };
        const jobOutput: JobOutput = {
          files: result.fileChanges.map((change: { path: string; action: string }) => ({
            path: change.path,
            action: ACTION_MAP[change.action] ?? 'modify',
            summary: `${change.action.charAt(0).toUpperCase() + change.action.slice(1)} during implementation`,
          })),
          summary: `Completed: ${payload.task}`,
        };

        await this.logActivity(jobId, 'file_write', {
          filesChanged: result.filesChanged,
        });

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`✅ CODER SUCCESS`);
        console.log(`   📤 RESULT PAYLOAD:`);
        console.log(`   Files: ${jobOutput.files.length}`);
        jobOutput.files.slice(0, 10).forEach(f => console.log(`     ${f.action}: ${f.path}`));
        if (jobOutput.files.length > 10) console.log(`     ... and ${jobOutput.files.length - 10} more`);
        console.log(`   Summary: ${jobOutput.summary.slice(0, 150)}`);
        console.log(`   providerSessionId: ${result.sessionId || 'none'}`);
        console.log(`${'═'.repeat(60)}\n`);

        await this.sendResult(jobId, {
          success: true,
          output: jobOutput,
          providerSessionId: result.sessionId,
        });
      } else {

        if (result.sessionLimited) {
          console.log(`\n${'═'.repeat(60)}`);
          console.log(`⚠️  SESSION LIMIT DETECTED`);
          if (result.resetTime) {
            console.log(`   Resets: ${result.resetTime}`);
          }
          console.log(`${'═'.repeat(60)}\n`);

          await this.sendResult(jobId, {
            success: false,
            error: `Session limit reached${result.resetTime ? ` - resets ${result.resetTime}` : ''}`,
            sessionLimited: true,
            resetTime: result.resetTime,
          });
          return;
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`❌ CODER FAILED`);
        console.log(`${'═'.repeat(60)}\n`);

        await this.sendResult(jobId, {
          success: false,
          error: result.error ?? 'Session failed without error message',
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`❌ CODER EXCEPTION`);
      console.log(`   Error: ${errorMessage}`);
      console.log(`${'═'.repeat(60)}\n`);

      await this.sendResult(jobId, {
        success: false,
        error: `Implementation failed: ${errorMessage}`,
      });
    }
  }

}
