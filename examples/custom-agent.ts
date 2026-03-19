import {
  Manager,
  Joblog,
  JsonlStorage,
  ClaudeCodeProvider,
  loadConfig,
  type PipelineConfig,
} from 'hugr';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const projectPath = process.cwd();

const config = await loadConfig({ projectPath });

const pipeline: PipelineConfig = {
  id: 'security-review',
  name: 'Code + Security Review',
  steps: [
    { agentId: 'architect', mode: 'quick', enabled: true },
    { agentId: 'coder', enabled: true },
    {
      agentId: 'security-scanner',
      enabled: true,
      agentConfig: {
        name: 'Security Scanner',
        instructions: [
          'Review all code changes for security vulnerabilities.',
          'Focus on: SQL injection, XSS, authentication bypass, data exposure.',
          'Provide a structured report with severity ratings.',
          'If no issues found, confirm the code is clean.',
        ].join('\n'),
        toolAccess: 'read-only',
        model: 'opus',
        selfReview: true,
        role: 'reviewer',
      },
    },
  ],
};

config.pipeline = pipeline;

const storageDir = mkdtempSync(join(tmpdir(), 'hugr-'));
const storage = new JsonlStorage(storageDir);
const joblog = new Joblog({ storage });

const llm = new ClaudeCodeProvider({
  projectPath,
  timeout: config.provider.timeout,
  maxRetries: config.provider.maxRetries,
});

const manager = new Manager({
  joblog,
  llm,
  config,
  projectPath,
});

manager.on('activity', ({ type, message, agentName }) => {
  console.log(`[${agentName ?? type}] ${message}`);
});

await manager.runSession({
  task: process.argv[2] ?? 'Add a new API endpoint for user profiles',
  sessionId: `security-${Date.now()}`,
});
