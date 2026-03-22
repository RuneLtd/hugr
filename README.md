<div align="center">

<img src="assets/hugr.png" alt="Hugr" width="200" />

# Hugr

---

### Multi-Agent Orchestration Framework

Define agent pipelines, compose built-in and custom agents, and run iterative coding sessions with automatic git worktree isolation. Built on [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

**One install. One command. Your agents are live.**

[Documentation](#api) · [Quick Start](#quick-start) · [GitHub](https://github.com/RuneLtd/hugr)

![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![license](https://img.shields.io/badge/license-MIT-blue)
![version](https://img.shields.io/badge/version-0.1.0-green)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![agents](https://img.shields.io/badge/built--in_agents-6-yellow)

---

> **v0.1.0 — Initial Release (March 2026)**
>
> Hugr is functional but still pre-1.0. You may encounter rough edges or breaking changes between minor versions. Pin to a specific version for production use until v1.0. [Report issues here.](https://github.com/RuneLtd/hugr/issues)

---

</div>

## What is Hugr?

---

Hugr is a **multi-agent orchestration framework** for Claude Code — not a chatbot wrapper, not a prompt chain, not a single-agent loop. It is a full pipeline system for autonomous coding agents, built from scratch in TypeScript.

Traditional agent setups wait for you to type something. Hugr runs **structured agent pipelines for you** — an Architect plans, a Coder implements, a Raven reviews, and the cycle repeats until the work is done. All in git worktrees so your main branch stays clean.

The entire framework installs as a **single npm package**. One install, one command, your agents are live.

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

const storage = new JsonlStorage('/tmp/hugr-demo');
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

---

- **Architect** — analyses the task and produces an implementation plan
- **Coder** — implements the plan using Claude Code
- **Raven** — reviews the implementation and sends feedback for refinement loops
- **Reviewer** — standalone code review agent
- **CustomAgent** — define any agent via config (instructions, tool access, model)
- **SkillCreator** — generates reusable skill files

## How It Works

---

1. The **Manager** receives a task and walks through the configured pipeline steps
2. Each step dispatches work to an agent via the **Joblog** (a structured message bus backed by JSONL)
3. Agents run in **git worktrees** so the main branch stays clean
4. After all steps complete, the Manager merges the worktree back to the base branch

## API

---

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
