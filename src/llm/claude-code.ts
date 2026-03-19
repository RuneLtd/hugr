
import { spawn, execSync } from 'node:child_process';
import { access, writeFile, mkdir, readdir, constants as fsConstants } from 'node:fs/promises';
import { join, basename, extname, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type {
    Query as SDKQuery,
    SDKMessage,
    SDKAssistantMessage,
    SDKUserMessage,
    SDKResultMessage,
    SDKSystemMessage,
    SDKPartialAssistantMessage,
    CanUseTool,
    PermissionMode,
} from '@anthropic-ai/claude-agent-sdk';

import { TIMEOUTS, SESSION_LIMIT_PATTERNS, detectSessionLimit } from '../constants.js';
import { resolveSessionDataDir } from '../paths.js';
import type { LLMProvider, CompletionOptions, CompletionResult } from '../types/llm.js';

export type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';

export interface ClaudeCodeConfig {
    cliPath?: string;
    queryTimeout?: number;
    executeTimeout?: number;
    maxRetries?: number;

    model?: string;

    timeout?: number;
}

export interface QueryResult {
    text: string;
    durationMs: number;
}

export interface FileChange {
    path: string;
    action: 'created' | 'modified' | 'deleted';
}

export interface ExecuteResult {
    success: boolean;
    durationMs: number;
    filesChanged: string[];

    fileChanges: FileChange[];
    transcript?: string;
    error?: string;

    costUsd?: number;

    tokenUsage?: { input_tokens: number; output_tokens: number };

    numTurns?: number;

    sessionId?: string;

    sessionLimited?: boolean;

    resetTime?: string;
}

export interface StreamActivity {
    type: 'thinking' | 'text' | 'tool_start' | 'tool_end' | 'tool_progress' | 'tool_summary' | 'error' | 'result';
    content: string;
    toolName?: string;
    timestamp: Date;

    displayInput?: string;

    elapsedSeconds?: number;

    stat?: string;

    tokenUsage?: { input: number; output: number };
}

export interface ExecuteOptions {
    workdir: string;
    task: string;
    context?: string;
    timeout?: number;
    autoAccept?: boolean;

    sessionProjectPath?: string;

    onActivity?: (activity: StreamActivity) => void;

    agentTeams?: boolean;

    skipGitTracking?: boolean;

    skillContent?: string;

    allowedTools?: string[];

    maxTurns?: number;

    canUseTool?: CanUseTool;

    resume?: string;

    onSessionInit?: (sessionId: string) => void;

    images?: Array<{
        id: string;
        name: string;
        mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
        base64: string;
    }>;

    filePaths?: string[];
}

export interface LimitCheckResult {
    available: boolean;
    limited: boolean;
    resetTime?: string;
    error?: string;
}

function resolveSDKCliPath(): string {
    try {

        const require = createRequire(import.meta.url);
        const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk');
        const sdkDir = dirname(sdkEntry);
        let cliPath = join(sdkDir, 'cli.js');

        if (cliPath.includes('app.asar') && !cliPath.includes('app.asar.unpacked')) {
            cliPath = cliPath.replace('app.asar', 'app.asar.unpacked');
        }

        return cliPath;
    } catch {

        return '';
    }
}

function buildAllowedTools(options: ExecuteOptions): string[] {

    if (options.allowedTools) {
        return [...options.allowedTools];
    }

    const tools = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'];

    if (options.agentTeams) {
        tools.push('Task');
    }

    if (options.canUseTool) {
        tools.push('AskUserQuestion');
    }

    tools.push('WebSearch', 'WebFetch', 'TodoWrite');

    return tools;
}

function getKnownCLIPaths(): string[] {
    const home = homedir();

    if (process.platform === 'win32') {
        return [

            join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
            join(home, 'AppData', 'Roaming', 'npm', 'claude'),

            join(home, '.local', 'bin', 'claude.exe'),
            join(home, '.local', 'bin', 'claude'),

            'C:\\Program Files\\nodejs\\claude.cmd',

            join(home, '.local', 'share', 'pnpm', 'claude.cmd'),
            join(home, '.local', 'share', 'pnpm', 'claude'),
        ];
    }

    return [

        join(home, '.local', 'bin', 'claude'),

        '/opt/homebrew/bin/claude',

        '/usr/local/bin/claude',

        join(home, '.npm-global', 'bin', 'claude'),

        join(home, '.yarn', 'bin', 'claude'),

        join(home, '.local', 'share', 'pnpm', 'claude'),

        '/snap/bin/claude',

        '/usr/bin/claude',
    ];
}

async function getNvmCLIPaths(): Promise<string[]> {
    if (process.platform === 'win32') {

        const nvmDir = join(process.env.NVM_HOME || join(homedir(), 'AppData', 'Roaming', 'nvm'));
        try {
            const versions = await readdir(nvmDir);
            const paths: string[] = [];
            for (const v of versions) {
                if (v.startsWith('v') || /^\d/.test(v)) {
                    paths.push(join(nvmDir, v, 'claude.cmd'));
                    paths.push(join(nvmDir, v, 'claude'));
                }
            }
            return paths;
        } catch {
            return [];
        }
    }

    const nvmDir = join(homedir(), '.nvm', 'versions', 'node');
    try {
        const versions = await readdir(nvmDir);
        return versions.map(v => join(nvmDir, v, 'bin', 'claude'));
    } catch {
        return [];
    }
}

function resolveFromLoginShell(): string | null {
    if (process.platform === 'win32') {

        try {
            const result = execSync('where claude', {
                timeout: 3000,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim().split('\n')[0];
            if (result && !result.includes('not found')) return result;
        } catch {

        }
        return null;
    }

    const shells = ['/bin/zsh', '/bin/bash'];
    for (const sh of shells) {
        try {
            const result = execSync(`${sh} -l -c "which claude"`, {
                timeout: 3000,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (result && !result.includes('not found')) return result;
        } catch {

        }
    }
    return null;
}

async function resolveClaudeCLI(): Promise<string | null> {

    const accessMode = process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK;

    for (const p of getKnownCLIPaths()) {
        try {
            await access(p, accessMode);
            return p;
        } catch {  }
    }

    for (const p of await getNvmCLIPaths()) {
        try {
            await access(p, accessMode);
            return p;
        } catch {  }
    }

    return resolveFromLoginShell();
}

export class ClaudeCodeProvider implements LLMProvider {
    public readonly name = 'claude-code';

    private cliPath: string;
    private readonly queryTimeout: number;
    private readonly executeTimeout: number;
    private readonly maxRetries: number;
    private readonly model?: string;

    private stderrBuffer = '';

    private cliResolved = false;

    constructor(config: ClaudeCodeConfig = {}) {
        this.cliPath = config.cliPath ?? 'claude';
        this.cliResolved = !!config.cliPath;
        this.queryTimeout = config.queryTimeout ?? config.timeout ?? TIMEOUTS.query;
        this.executeTimeout = config.executeTimeout ?? TIMEOUTS.execute;
        this.maxRetries = config.maxRetries ?? 2;
        this.model = config.model;
    }

    private async ensureCLIResolved(): Promise<void> {
        if (this.cliResolved) return;
        this.cliResolved = true;

        try {
            const result = await this.runCommand([this.cliPath, '--version'], { timeout: 5000 });
            if (result.exitCode === 0) return;
        } catch {  }

        const resolved = await resolveClaudeCLI();
        if (resolved) {
            console.log(`[claude-code] Resolved CLI at: ${resolved}`);
            this.cliPath = resolved;
        }
    }

    async isAvailable(): Promise<boolean> {
        try {
            await this.ensureCLIResolved();
            const result = await this.runCommand([this.cliPath, '--version'], {
                timeout: 5000,
            });
            return result.exitCode === 0;
        } catch {
            return false;
        }
    }

    async checkLimits(): Promise<LimitCheckResult> {
        try {
            await this.ensureCLIResolved();
            const result = await this.runCommand(
                [this.cliPath, '--print', '-p', 'hi'],
                { timeout: 15000 }
            );

            const output = result.stdout + result.stderr;
            const lower = output.toLowerCase();

            const isLimited = SESSION_LIMIT_PATTERNS.some(pattern => lower.includes(pattern));

            if (isLimited) {

                const resetMatch = output.match(/resets?\s+(\d{1,2}(?::\d{2})?(?:am|pm)?(?:\s*\([^)]+\))?)/i);
                const resetTime = resetMatch ? resetMatch[1] : undefined;

                return {
                    available: true,
                    limited: true,
                    resetTime,
                    error: output.trim().slice(0, 200),
                };
            }

            if (result.exitCode !== 0 && isLimited) {
                return {
                    available: true,
                    limited: true,
                    error: output.trim().slice(0, 200),
                };
            }

            return {
                available: true,
                limited: false,
            };

        } catch (error) {

            return {
                available: false,
                limited: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    async query(prompt: string, options?: { timeout?: number }): Promise<QueryResult> {
        await this.ensureCLIResolved();
        const startTime = Date.now();
        const timeout = options?.timeout ?? this.queryTimeout;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const cmd = [this.cliPath, '--print'];
                if (this.model) {
                    cmd.push('--model', this.model);
                }
                cmd.push('-p', prompt);
                const result = await this.runCommand(
                    cmd,
                    { timeout }
                );

                if (result.exitCode !== 0) {
                    throw new Error(`Claude exited with code ${result.exitCode}: ${result.stderr}`);
                }

                return {
                    text: result.stdout.trim(),
                    durationMs: Date.now() - startTime,
                };
            } catch (error) {
                if (attempt === this.maxRetries) throw error;
                await this.sleep(Math.pow(2, attempt) * 1000);
            }
        }

        throw new Error('Query failed after retries');
    }

    async complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult> {
        const fullPrompt = options?.systemPrompt
            ? `${options.systemPrompt}\n\n${prompt}`
            : prompt;
        const result = await this.query(fullPrompt, { timeout: options?.timeout });
        return {
            text: result.text,
            model: 'claude-code',
            durationMs: result.durationMs,
        };
    }

    async execute(options: ExecuteOptions): Promise<ExecuteResult> {
        const startTime = Date.now();
        const baseTimeout = options.timeout ?? this.executeTimeout;
        const timeout = options.agentTeams ? Math.round(baseTimeout * 1.5) : baseTimeout;

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`🚀 Starting SDK session${options.agentTeams ? ' (agent teams enabled)' : ''}`);
        console.log(`   Workdir: ${options.workdir}`);
        console.log(`   Timeout: ${Math.round(timeout / 1000)}s${options.agentTeams ? ' (1.5x for agent teams)' : ''}`);
        console.log(`   Auto-accept: ${options.autoAccept ?? false}`);
        console.log(`${'─'.repeat(60)}`);

        const dataDir = resolveSessionDataDir(options.sessionProjectPath || options.workdir);
        const promptPath = join(dataDir, 'current-task.md');
        await mkdir(dataDir, { recursive: true });
        const fullPrompt = this.buildTaskPrompt(options);
        await writeFile(promptPath, fullPrompt, 'utf-8');
        console.log(`📝 Task prompt written to ${promptPath}`);

        let snapshotHash = '';
        if (!options.skipGitTracking) {
            try {
                await this.ensureGitRepo(options.workdir);
                snapshotHash = await this.createGitSnapshot(options.workdir);
                console.log(`📂 Git snapshot created for change tracking`);
            } catch (err) {
                console.warn(`⚠️ Git snapshot failed, change tracking disabled:`, err);
            }
        }

        const skillContent = options.skillContent;
        const systemPrompt = skillContent
            ? { type: 'preset' as const, preset: 'claude_code' as const, append: skillContent }
            : { type: 'preset' as const, preset: 'claude_code' as const };

        const permissionMode: PermissionMode = (options.autoAccept ?? true)
            ? 'bypassPermissions'
            : 'default';

        this.stderrBuffer = '';

        const abortController = new AbortController();

        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        const wrappedCanUseTool: CanUseTool | undefined = options.canUseTool
            ? async (toolName, input, ctx) => {

                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = undefined;
                }
                const elapsedBeforePause = Date.now() - startTime;

                try {
                    return await options.canUseTool!(toolName, input, ctx);
                } finally {

                    const remaining = timeout - elapsedBeforePause;
                    if (remaining > 0) {
                        timeoutHandle = setTimeout(async () => {
                            console.log(`\n⚠️  Timeout reached (${timeout}ms), interrupting SDK session...`);
                            try {
                                await queryInstance.interrupt();
                            } catch {
                                abortController.abort();
                            }
                        }, remaining);
                    }
                }
            }
            : undefined;

        const toolList = buildAllowedTools(options);

        const hasImages = options.images && options.images.length > 0;
        const sdkPrompt: string | AsyncIterable<SDKUserMessage> = hasImages
            ? (async function* () {
                const contentBlocks: Array<
                    | { type: 'text'; text: string }
                    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
                > = [];

                for (const img of options.images!) {
                    contentBlocks.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: img.mediaType,
                            data: img.base64,
                        },
                    });
                }

                contentBlocks.push({ type: 'text', text: fullPrompt });

                yield {
                    type: 'user' as const,
                    message: {
                        role: 'user' as const,
                        content: contentBlocks,
                    },
                    parent_tool_use_id: null,
                    session_id: '',
                } as SDKUserMessage;
            })()
            : fullPrompt;

        const sdkCliPath = resolveSDKCliPath();

        const queryInstance = sdkQuery({
            prompt: sdkPrompt,
            options: {
                ...(sdkCliPath ? { pathToClaudeCodeExecutable: sdkCliPath } : {}),
                cwd: options.workdir,
                permissionMode,
                allowDangerouslySkipPermissions: options.autoAccept ?? true,
                systemPrompt,
                settingSources: ['project'],
                tools: toolList,
                allowedTools: toolList,
                maxTurns: options.maxTurns,
                canUseTool: wrappedCanUseTool,
                includePartialMessages: !!options.onActivity,
                abortController,
                ...(this.model ? { model: this.model } : {}),
                ...(options.resume ? { resume: options.resume } : {}),
                env: {
                    ...process.env,

                    CLAUDE_BASH_NO_LOGIN: '1',

                    CI: 'true',
                    TERM: 'dumb',
                    NONINTERACTIVE: '1',
                    PYTHONUNBUFFERED: '1',
                    ...(options.agentTeams ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } : {}),
                },
                stderr: (data: string) => {
                    this.stderrBuffer += data;

                    const isGitNoise = data.includes('fatal: not a git repository')
                        || data.includes('fatal: Needed a single revision')
                        || data.includes('fatal: bad default revision');
                    if (!isGitNoise) {
                        console.debug('[claude-code stderr]', data.trim());
                    }
                },
            },
        });

        console.log(`\n⚡ SDK query started (permissionMode: ${permissionMode})`);
        console.log(`${'─'.repeat(60)}\n`);

        if (timeout) {
            timeoutHandle = setTimeout(async () => {
                console.log(`\n⚠️  Timeout reached (${timeout}ms), interrupting SDK session...`);
                try {
                    await queryInstance.interrupt();
                } catch {

                    abortController.abort();
                }
            }, timeout);
        }

        try {

            const {
                transcript, result, sessionId,
                sessionLimited: sdkSessionLimited,
                resetTime: sdkResetTime,
            } = await this.processSDKMessages(queryInstance, options);

            if (timeoutHandle) clearTimeout(timeoutHandle);

            console.log(`\n${'─'.repeat(60)}`);
            console.log(`✅ SDK session ended`);

            let filesChanged: FileChange[] = [];
            if (snapshotHash) {
                filesChanged = await this.getGitChanges(options.workdir, snapshotHash);
                await this.cleanupGitSnapshot(options.workdir, snapshotHash);
            }

            console.log(`📊 Files changed: ${filesChanged.length}`);
            if (filesChanged.length > 0) {
                filesChanged.slice(0, 15).forEach(f => console.log(`   ${f.action}: ${f.path}`));
                if (filesChanged.length > 15) {
                    console.log(`   ... and ${filesChanged.length - 15} more`);
                }
            }

            const duration = Date.now() - startTime;
            const isSuccess = result?.subtype === 'success';

            const costUsd = result?.total_cost_usd;
            const tokenUsage = result?.usage
                ? { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens }
                : undefined;
            const numTurns = result?.num_turns;

            console.log(`⏱️  Duration: ${(duration / 1000).toFixed(1)}s`);
            if (costUsd !== undefined) console.log(`💰 Cost: $${costUsd.toFixed(4)}`);
            if (numTurns !== undefined) console.log(`🔄 Turns: ${numTurns}`);
            console.log(`${'─'.repeat(60)}\n`);

            let error: string | undefined;
            if (!isSuccess && result) {
                if ('errors' in result && result.errors) {
                    error = result.errors.join(', ');
                } else {
                    error = `Session ended with subtype: ${result.subtype}`;
                }
            }

            let sessionLimited = sdkSessionLimited;
            let resetTime = sdkResetTime;
            if (!sessionLimited && transcript) {
                const transcriptCheck = detectSessionLimit(transcript);
                if (transcriptCheck.isLimited) {
                    sessionLimited = true;
                    resetTime = resetTime ?? transcriptCheck.resetTime;
                }
            }

            return {
                success: isSuccess,
                durationMs: duration,
                filesChanged: filesChanged.map(f => f.path),
                fileChanges: filesChanged,
                transcript,
                error,
                costUsd,
                tokenUsage,
                numTurns,
                sessionId,
                sessionLimited,
                resetTime,
            };
        } catch (error) {

            if (timeoutHandle) clearTimeout(timeoutHandle);

            if (snapshotHash) {
                await this.cleanupGitSnapshot(options.workdir, snapshotHash).catch(() => {});
            }

            try { queryInstance.close(); } catch {  }

            const duration = Date.now() - startTime;
            const isAbort = error instanceof Error && error.name === 'AbortError';

            console.log(`\n${'─'.repeat(60)}`);
            console.log(`❌ SDK session ${isAbort ? 'ABORTED' : 'FAILED'} after ${(duration / 1000).toFixed(1)}s`);
            console.log(`   Error: ${error instanceof Error ? error.message : error}`);
            console.log(`${'─'.repeat(60)}\n`);

            return {
                success: false,
                durationMs: duration,
                filesChanged: [],
                fileChanges: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async processSDKMessages(
        queryInstance: SDKQuery,
        options: ExecuteOptions,
    ): Promise<{
        transcript: string;
        result?: SDKResultMessage;
        sessionId?: string;
        sessionLimited?: boolean;
        resetTime?: string;
    }> {
        let transcript = '';
        let result: SDKResultMessage | undefined;
        let sessionId: string | undefined;
        let sessionLimited = false;
        let resetTime: string | undefined;
        let lastMessageTime = Date.now();

        const streamState = {
            currentToolName: '',
            setCurrentToolName: (name: string) => { streamState.currentToolName = name; },
        };

        const STUCK_WARN_MS = 3 * 60 * 1000;
        const STUCK_INTERRUPT_MS = 5 * 60 * 1000;
        const STUCK_ABORT_MS = 6 * 60 * 1000;
        let stuckInterrupted = false;
        const stuckCheck = setInterval(async () => {
            const silentTime = Date.now() - lastMessageTime;
            if (silentTime > STUCK_ABORT_MS && stuckInterrupted) {

                console.log(`\n🛑 SDK session unresponsive after interrupt — force aborting`);
                options.onActivity?.({
                    type: 'error',
                    content: `Session unresponsive for ${Math.round(silentTime / 60000)} minutes — aborting`,
                    timestamp: new Date(),
                });
                try { queryInstance.close(); } catch {  }
            } else if (silentTime > STUCK_INTERRUPT_MS && !stuckInterrupted) {

                stuckInterrupted = true;
                console.log(`\n⚠️  SDK session stuck — no messages for ${Math.round(silentTime / 60000)} minutes. Interrupting...`);
                options.onActivity?.({
                    type: 'error',
                    content: `Session appears stuck (${Math.round(silentTime / 60000)}min silence) — interrupting`,
                    timestamp: new Date(),
                });
                try {
                    await queryInstance.interrupt();
                } catch {
                    console.log(`   Interrupt failed, will force-abort on next check`);
                }
            } else if (silentTime > STUCK_WARN_MS) {
                console.log(`\n⚠️  SDK session quiet — no messages for ${Math.round(silentTime / 60000)} minutes`);
                options.onActivity?.({
                    type: 'thinking',
                    content: `Waiting for response (${Math.round(silentTime / 60000)}min)...`,
                    timestamp: new Date(),
                });
            }
        }, 30_000);

        try {
            for await (const message of queryInstance) {
                lastMessageTime = Date.now();

                switch (message.type) {
                    case 'system': {
                        const sysMsg = message as SDKSystemMessage;
                        if (sysMsg.subtype === 'init') {
                            sessionId = sysMsg.session_id;
                            console.log(`   SDK session initialized: ${sessionId}`);
                            console.log(`   Model: ${sysMsg.model}`);
                            console.log(`   Tools: ${sysMsg.tools.join(', ')}`);

                            options.onSessionInit?.(sessionId);
                        } else if (sysMsg.subtype === 'compact_boundary') {
                            console.log(`   [compact] Context compacted`);
                        } else if (sysMsg.subtype === 'status') {

                            console.debug(`   [status] ${(sysMsg as any).status ?? 'unknown'}`);
                        }

                        break;
                    }

                    case 'assistant': {
                        const asstMsg = message as SDKAssistantMessage;

                        if (asstMsg.error) {
                            console.warn(`   [assistant error] ${asstMsg.error}`);
                            options.onActivity?.({
                                type: 'error',
                                content: `API error: ${asstMsg.error}`,
                                timestamp: new Date(),
                            });

                            if (asstMsg.error === 'rate_limit' || asstMsg.error === 'billing_error') {
                                sessionLimited = true;
                                console.warn(`   ⚠️  Session limit detected from SDK: ${asstMsg.error}`);
                            }
                        }

                        const content = asstMsg.message?.content;
                        if (content && Array.isArray(content)) {
                            for (const block of content) {
                                if ('text' in block && block.type === 'text') {
                                    transcript += block.text + '\n';
                                    options.onActivity?.({
                                        type: 'text',
                                        content: block.text,
                                        timestamp: new Date(),
                                    });
                                } else if (block.type === 'tool_use' && 'name' in block) {

                                    const toolInput = (block as any).input;
                                    let displayInput: string | undefined;
                                    if (toolInput) {

                                        displayInput = toolInput.file_path
                                            || toolInput.command
                                            || toolInput.pattern
                                            || toolInput.query
                                            || toolInput.url
                                            || toolInput.path
                                            || undefined;
                                    }
                                    options.onActivity?.({
                                        type: 'tool_start',
                                        content: `Using ${block.name}`,
                                        toolName: block.name,
                                        displayInput,
                                        timestamp: new Date(),
                                    });
                                } else if (block.type === 'thinking' && 'thinking' in block) {
                                    options.onActivity?.({
                                        type: 'thinking',
                                        content: (block as any).thinking || '',
                                        timestamp: new Date(),
                                    });
                                }
                            }
                        }
                        break;
                    }

                    case 'user': {
                        const userMsg = message as SDKUserMessage;

                        const content = userMsg.message?.content;
                        if (content && Array.isArray(content)) {
                            for (const block of content as any[]) {
                                if (block.type === 'tool_result') {
                                    const resultContent = typeof block.content === 'string'
                                        ? block.content.substring(0, 500)
                                        : 'Tool completed';
                                    options.onActivity?.({
                                        type: 'tool_end',
                                        content: resultContent,
                                        toolName: block.tool_use_id,
                                        timestamp: new Date(),
                                    });
                                }
                            }
                        }
                        break;
                    }

                    case 'result': {
                        result = message as SDKResultMessage;
                        transcript += `\n[Result: ${result.subtype}]\n`;

                        if (result.subtype === 'success' && 'result' in result) {
                            transcript += result.result;

                            const resultTokenUsage = result.usage
                                ? { input: result.usage.input_tokens, output: result.usage.output_tokens }
                                : undefined;
                            options.onActivity?.({
                                type: 'result',
                                content: result.result || 'Completed',
                                timestamp: new Date(),
                                tokenUsage: resultTokenUsage,
                            });
                        } else {
                            const errors = 'errors' in result ? result.errors : [];
                            const errorText = errors?.join(', ') || result.subtype;
                            options.onActivity?.({
                                type: 'error',
                                content: `Error: ${errorText}`,
                                timestamp: new Date(),
                            });

                            if (result.subtype === 'error_max_budget_usd') {
                                sessionLimited = true;
                                console.warn(`   ⚠️  Budget limit reached (SDK subtype: error_max_budget_usd)`);
                            }

                            if (errors && errors.length > 0) {
                                const errorJoined = errors.join(' ');
                                if (errorJoined.includes('rate_limit') || errorJoined.includes('overloaded')) {
                                    sessionLimited = true;
                                    console.warn(`   ⚠️  Session limit detected from SDK error text`);
                                }

                                const resetMatch = errorJoined.match(/resets?\s+(\d{1,2}(?:am|pm)(?:\s*\([^)]+\))?)/i);
                                if (resetMatch) {
                                    resetTime = resetMatch[1];
                                }
                            }
                        }
                        break;
                    }

                    case 'stream_event': {

                        this.handlePartialMessage(
                            message as SDKPartialAssistantMessage,
                            options,
                            streamState,
                        );
                        break;
                    }

                    case 'auth_status': {
                        const authMsg = message as any;
                        if (authMsg.error) {
                            console.warn(`   [auth] Error: ${authMsg.error}`);
                        } else if (authMsg.isAuthenticating) {
                            console.log(`   [auth] Authenticating...`);
                        }
                        break;
                    }

                    case 'tool_progress': {

                        const progressMsg = message as any;
                        options.onActivity?.({
                            type: 'tool_progress',
                            content: progressMsg.content || '',
                            toolName: progressMsg.tool_name || streamState.currentToolName,
                            elapsedSeconds: progressMsg.elapsed_seconds,
                            timestamp: new Date(),
                        });
                        break;
                    }

                    case 'tool_use_summary': {

                        const summaryMsg = message as any;
                        options.onActivity?.({
                            type: 'tool_summary',
                            content: summaryMsg.content || '',
                            toolName: summaryMsg.tool_name || '',
                            stat: summaryMsg.stat || summaryMsg.content || '',
                            timestamp: new Date(),
                        });
                        break;
                    }

                    default:

                        console.debug(`   [sdk] Unknown message type: ${(message as any).type}`);
                        break;
                }
            }
        } finally {
            clearInterval(stuckCheck);
        }

        return { transcript, result, sessionId, sessionLimited, resetTime };
    }

    private handlePartialMessage(
        message: SDKPartialAssistantMessage,
        options: ExecuteOptions,
        state: {
            currentToolName: string;
            setCurrentToolName: (name: string) => void;
        },
    ): void {
        if (!options.onActivity) return;

        const event = message.event as any;
        if (!event?.type) return;

        switch (event.type) {
            case 'content_block_start':
                if (event.content_block?.type === 'tool_use') {
                    const toolName = event.content_block.name;
                    state.setCurrentToolName(toolName);
                    options.onActivity({
                        type: 'tool_start',
                        content: `Starting: ${toolName}`,
                        toolName,
                        timestamp: new Date(),
                    });
                }
                break;

            case 'content_block_delta':

                if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
                    options.onActivity({
                        type: 'thinking',
                        content: event.delta.thinking,
                        timestamp: new Date(),
                    });
                }

                break;

            case 'content_block_stop':
                if (state.currentToolName) {
                    options.onActivity({
                        type: 'tool_end',
                        content: `Completed: ${state.currentToolName}`,
                        toolName: state.currentToolName,
                        timestamp: new Date(),
                    });
                    state.setCurrentToolName('');
                }
                break;

        }
    }

    private buildTaskPrompt(options: ExecuteOptions): string {
        const parts: string[] = [];

        if (options.context) {
            parts.push(options.context);
        }

        parts.push(`## Task\n${options.task}`);

        if (options.images && options.images.length > 0) {
            const imageNames = options.images.map(img => img.name).join(', ');
            const count = options.images.length;
            parts.push(
                `## Attached Images\n` +
                `The user has attached ${count} image${count > 1 ? 's' : ''} (${imageNames}) as visual reference for this task. ` +
                `These images are included above as image content blocks. ` +
                `You MUST carefully examine and reference these images when completing the task — ` +
                `they contain important visual context such as UI designs, screenshots, layouts, or other references ` +
                `that should directly inform your implementation.`
            );
        }

        if (options.filePaths && options.filePaths.length > 0) {
            const fileList = options.filePaths.map(fp => `- ${fp}`).join('\n');
            const count = options.filePaths.length;
            parts.push(
                `## Attached Files\n` +
                `The user has attached ${count} file${count > 1 ? 's' : ''} for this task. ` +
                `These files have been saved to the project directory and can be read using the Read tool:\n${fileList}\n` +
                `You MUST read and use these files as context for completing the task.`
            );
        }

        return parts.join('\n\n');
    }

    private static readonly IGNORED_FILES = new Set([
        'pnpm-lock.yaml',
        'package-lock.json',
        'yarn.lock',
        'bun.lockb',
        'Gemfile.lock',
        'poetry.lock',
        'Pipfile.lock',
        'composer.lock',
        'Cargo.lock',
        'go.sum',
        'flake.lock',
        'next-env.d.ts',
        '.DS_Store',
        'Thumbs.db',
    ]);

    private static readonly IGNORED_EXTENSIONS = new Set([
        '.tsbuildinfo',
        '.pyc',
        '.pyo',
    ]);

    private isIgnoredFile(filePath: string): boolean {
        const name = basename(filePath);
        if (ClaudeCodeProvider.IGNORED_FILES.has(name)) return true;
        const ext = extname(filePath);
        if (ClaudeCodeProvider.IGNORED_EXTENSIONS.has(ext)) return true;
        return false;
    }

    private async ensureGitRepo(workdir: string): Promise<void> {
        try {
            await access(join(workdir, '.git'));
        } catch {
            await this.runCommand(['git', 'init'], { cwd: workdir, timeout: 5000 });
            console.log(`📂 Initialized git repo in workdir`);
        }
    }

    private async createGitSnapshot(workdir: string): Promise<string> {
        await this.runCommand(['git', 'add', '-A'], { cwd: workdir, timeout: 30000 });
        await this.runCommand(
            ['git', 'commit', '--allow-empty', '-m', '__hugr_snapshot__', '--no-verify'],
            { cwd: workdir, timeout: 10000 }
        );
        const result = await this.runCommand(
            ['git', 'rev-parse', 'HEAD'],
            { cwd: workdir, timeout: 5000 }
        );
        return result.stdout.trim();
    }

    private async getGitChanges(workdir: string, snapshotHash: string): Promise<FileChange[]> {
        const changes: FileChange[] = [];
        const seen = new Set<string>();

        const headResult = await this.runCommand(
            ['git', 'rev-parse', 'HEAD'],
            { cwd: workdir, timeout: 5000 }
        );
        const currentHead = headResult.stdout.trim();

        if (currentHead !== snapshotHash) {
            const diffResult = await this.runCommand(
                ['git', 'diff', '--name-status', snapshotHash, 'HEAD'],
                { cwd: workdir, timeout: 10000 }
            );
            this.parseGitDiffOutput(diffResult.stdout, changes, seen);
        }

        const statusResult = await this.runCommand(
            ['git', 'status', '--porcelain'],
            { cwd: workdir, timeout: 10000 }
        );
        this.parseGitStatusOutput(statusResult.stdout, changes, seen);

        return changes;
    }

    private parseGitDiffOutput(
        output: string, changes: FileChange[], seen: Set<string>
    ): void {
        for (const line of output.split('\n')) {
            if (!line.trim()) continue;
            const parts = line.split('\t');
            const status = parts[0];
            const filePath = parts.slice(1).join('\t');
            if (!filePath || this.isIgnoredFile(filePath) || seen.has(filePath)) continue;
            seen.add(filePath);

            if (status.startsWith('D')) changes.push({ path: filePath, action: 'deleted' });
            else if (status.startsWith('A')) changes.push({ path: filePath, action: 'created' });
            else changes.push({ path: filePath, action: 'modified' });
        }
    }

    private parseGitStatusOutput(
        output: string, changes: FileChange[], seen: Set<string>
    ): void {
        for (const line of output.split('\n')) {
            if (!line.trim()) continue;
            const status = line.substring(0, 2);
            const filePath = line.substring(3).trim();
            if (!filePath || this.isIgnoredFile(filePath) || seen.has(filePath)) continue;
            seen.add(filePath);

            if (status.includes('D')) changes.push({ path: filePath, action: 'deleted' });
            else if (status === '??' || status.includes('A')) changes.push({ path: filePath, action: 'created' });
            else changes.push({ path: filePath, action: 'modified' });
        }
    }

    private async cleanupGitSnapshot(workdir: string, snapshotHash: string): Promise<void> {
        try {
            const headResult = await this.runCommand(
                ['git', 'rev-parse', 'HEAD'],
                { cwd: workdir, timeout: 5000 }
            );
            if (headResult.stdout.trim() !== snapshotHash) {
                return;
            }

            const parentResult = await this.runCommand(
                ['git', 'rev-parse', '--verify', `${snapshotHash}~1`],
                { cwd: workdir, timeout: 5000 }
            );

            if (parentResult.exitCode === 0) {
                await this.runCommand(
                    ['git', 'reset', parentResult.stdout.trim()],
                    { cwd: workdir, timeout: 5000 }
                );
            } else {
                await this.runCommand(
                    ['git', 'update-ref', '-d', 'HEAD'],
                    { cwd: workdir, timeout: 5000 }
                );
                await this.runCommand(
                    ['git', 'rm', '-r', '--cached', '.'],
                    { cwd: workdir, timeout: 10000 }
                ).catch(() => {});
            }
        } catch (err) {
            console.warn('[cleanupGitSnapshot] Cleanup failed:', err);
        }
    }

    private runCommand(
        command: string[],
        options: {
            timeout?: number;
            cwd?: string;
            onOutput?: (chunk: string) => void;

            env?: Record<string, string>;
        } = {}
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const [cmd, ...args] = command;

            const isWin = process.platform === 'win32';
            const spawnCmd = isWin ? `"${cmd}"` : cmd;

            const child = spawn(spawnCmd, args, {
                cwd: options.cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    CI: 'true',
                    TERM: 'dumb',
                    NONINTERACTIVE: '1',
                    PYTHONUNBUFFERED: '1',
                    NODE_OPTIONS: '--no-warnings',
                    ...options.env,
                },
                shell: isWin,
            });

            let stdout = '';
            let stderr = '';
            let lastOutputTime = Date.now();

            const stuckCheckInterval = setInterval(() => {
                const silentTime = Date.now() - lastOutputTime;
                if (silentTime > 300_000) {
                    console.log(`\n⚠️  No output for ${Math.round(silentTime / 60000)} minutes...`);
                }
            }, 30_000);

            const timeoutId = options.timeout
                ? setTimeout(() => {
                    clearInterval(stuckCheckInterval);
                    console.log(`\n⚠️  Timeout reached (${options.timeout}ms), killing process...`);
                    child.kill('SIGTERM');
                    setTimeout(() => {
                        if (!child.killed) {
                            child.kill('SIGKILL');
                        }
                    }, 5000);
                    reject(new Error(`Command timed out after ${options.timeout}ms`));
                }, options.timeout)
                : undefined;

            child.stdout?.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                lastOutputTime = Date.now();
                options.onOutput?.(chunk);
            });

            child.stderr?.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                lastOutputTime = Date.now();

                const isGitNoise = chunk.includes('fatal: not a git repository')
                    || chunk.includes('fatal: Needed a single revision')
                    || chunk.includes('fatal: bad default revision');
                if (!isGitNoise) {
                    console.error(`[stderr] ${chunk.trim()}`);
                }
            });

            child.on('close', (code) => {
                clearInterval(stuckCheckInterval);
                if (timeoutId) clearTimeout(timeoutId);
                resolve({ exitCode: code ?? 1, stdout, stderr });
            });

            child.on('error', (error) => {
                clearInterval(stuckCheckInterval);
                if (timeoutId) clearTimeout(timeoutId);
                reject(error);
            });
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

}
