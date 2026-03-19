# Hugr

Multi-agent orchestration framework for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Define agent pipelines, compose built-in and custom agents, and run iterative coding sessions with automatic git worktree isolation.

## Install

```bash
npm install hugr
```

Requires Node.js 18+ and a working [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installation.

## Quick Start

### Minimal two-agent pipeline

```typescript
import {
  Manager,
  Joblog,
  JsonlStorage,
  ClaudeCodeProvider,
  loadConfig,
} from 'hugr';

const projectPath = process.cwd();
const config = await loadConfig({ projectPath, preset: 'fast' });

// Set up the joblog (message bus between agents)
const storage = new JsonlStorage('/tmp/hugr-demo');
const joblog = new Joblog({ storage });

// Create a Claude Code LLM provider
const llm = new ClaudeCodeProvider({
  projectPath,
  timeout: config.provider.timeout,
  maxRetries: config.provider.maxRetries,
});

// Create the manager and run a session
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
  task: 'Add input validation to the signup form',
  sessionId: 'demo-001',
});
```

### Using presets

Hugr ships with three built-in presets that configure the agent pipeline:

| Preset | Pipeline | Use case |
|--------|----------|----------|
| `fast` | Architect (quick) → Coder | Prototyping, small changes |
| `balanced` | Architect → Coder → Raven ×1 | Daily work |
| `thorough` | Architect → Coder → Raven ×3 | High-stakes changes |

```typescript
const config = await loadConfig({ preset: 'thorough' });
```

### Custom pipelines

Define your own agent pipeline in a `config.yaml` at your project root:

```yaml
preset: balanced

pipeline:
  id: my-pipeline
  name: Custom Flow
  steps:
    - agentId: architect
      mode: thorough
      enabled: true
    - agentId: coder
      enabled: true
    - agentId: raven
      iterations: 2
      maxIterations: 5
      enabled: true
```

### Custom agents

Add your own agents to any pipeline step:

```yaml
pipeline:
  id: with-security
  name: Security-Aware Pipeline
  steps:
    - agentId: architect
      mode: thorough
      enabled: true
    - agentId: coder
      enabled: true
    - agentId: security-scan
      enabled: true
      agentConfig:
        name: Security Scanner
        instructions: "Review the code changes for security vulnerabilities. Focus on injection, auth, and data exposure."
        toolAccess: read-only
        model: opus
        selfReview: true
    - agentId: raven
      iterations: 1
      enabled: true
```

## Built-in Agents

- **Architect** — analyses the task and produces an implementation plan
- **Coder** — implements the plan using Claude Code
- **Raven** — reviews the implementation and sends feedback for refinement loops
- **Reviewer** — standalone code review agent
- **CustomAgent** — define any agent via config (instructions, tool access, model)
- **SkillCreator** — generates reusable skill files

## How It Works

1. The **Manager** receives a task and walks through the configured pipeline steps
2. Each step dispatches work to an agent via the **Joblog** (a structured message bus backed by JSONL)
3. Agents run in **git worktrees** so the main branch stays clean
4. After all steps complete, the Manager merges the worktree back to the base branch

## API

### `loadConfig(options?)`

Loads and validates configuration from `config.yaml` with preset/CLI overrides.

### `Manager`

Orchestrates a session. Key methods:

- `runSession({ task, sessionId })` — run the full pipeline
- `on('activity', callback)` — subscribe to progress events
- `on('session:completed', callback)` — session finished

### `Agent`

Abstract base class. Subclass it to create custom agents programmatically:

```typescript
import { Agent } from 'hugr';

class MyAgent extends Agent {
  async handleMessage(message) {
    const result = await this.llm.query(message.payload.prompt);
    await this.sendResult(message.jobId, { output: result });
  }
}
```

### `Joblog`

Message bus between agents. Backed by `JsonlStorage` for persistence.

### `ClaudeCodeProvider`

LLM provider wrapping the Claude Agent SDK. Handles queries, streaming, tool permissions, and session limit detection.

## License

MIT
