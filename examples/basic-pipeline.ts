import {
  Manager,
  Joblog,
  JsonlStorage,
  ClaudeCodeProvider,
  loadConfig,
} from 'hugr';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const projectPath = process.cwd();

const config = await loadConfig({
  projectPath,
  preset: 'fast',
});

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

manager.on('session:completed', ({ sessionId, durationMs, iterations }) => {
  console.log(`Session ${sessionId} completed in ${Math.round(durationMs / 1000)}s (${iterations} iterations)`);
});

await manager.runSession({
  task: process.argv[2] ?? 'Add input validation to the signup form',
  sessionId: `demo-${Date.now()}`,
});
