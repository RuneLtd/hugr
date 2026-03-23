<div align="center">

<img src="assets/hugr.png" alt="Hugr" width="200" />

# Hugr

### Agent Workflow Framework

Define agent pipelines for any task. Wire in any LLM provider. Chain autonomous agents together into workflows that get things done.

**One install. One config. Your agents are live.**

[Quick Start](#quick-start) · [Dashboard](#dashboard) · [Pipelines](#pipelines) · [Workers](#workers) · [Providers](#providers) · [GitHub](https://github.com/RuneLtd/hugr)

![language](https://img.shields.io/badge/language-TypeScript-3178c6)
![license](https://img.shields.io/badge/license-MIT-blue)
![version](https://img.shields.io/badge/version-0.1.0-green)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

---

> **v0.1.0 — March 2026**
>
> Hugr is functional but still pre-1.0. Expect rough edges and breaking changes between minor versions. Pin to a specific version for production use until v1.0. [Report issues here.](https://github.com/RuneLtd/hugr/issues)

---

</div>

## What is Hugr?

Hugr is a **provider-agnostic agent workflow framework** built in TypeScript. You define a pipeline of workers — each with a role, instructions, tools, and constraints — and Hugr runs them in sequence, passing context between steps and tracking every job, message, and decision in a structured JSONL log.

A pipeline can be anything: a research chain that gathers sources, fact-checks them, and writes a summary. A content workflow that outlines, drafts, and edits. A data pipeline that extracts, transforms, and validates. A multi-step automation that classifies input, routes it, processes it, and verifies the result. A coding workflow that plans, implements, and reviews. You define the workers and the order — Hugr handles orchestration, message passing, retries, interrupts, and logging.

Hugr ships with a **dashboard UI** for building workflows visually, managing workers, configuring providers, and monitoring sessions in real time — no code required.

## Install

```bash
npm install @runeltd/hugr
```

Requires Node.js 18+.

## Dashboard

Hugr includes a web-based dashboard for managing everything visually:

```bash
npx hugr-dashboard
```

The dashboard gives you:

**Overview** — active sessions, total sessions, registered workers, saved workflows at a glance.

**Workflows** — build pipelines visually from templates or from scratch. Drag and drop workers, configure iterations, enable/disable steps. Templates ship across six categories: Development, Content, Research, Operations, Data, and General.

**Sessions** — pick a workflow, describe a task, and run it. Watch live activity as workers hand off to each other. Respond to clarification questions in real time. Stop sessions mid-run.

**Workers** — browse the built-in library and preset workers, or create your own with a custom name, description, system prompt, and tool selection.

**Settings** — configure API keys for all supported providers (OpenAI, Anthropic, Gemini, Mistral, xAI, Groq, AWS Bedrock), manage your data storage path, check runtime status, and set your theme.

## Quick Start

The fastest way to get going is the [dashboard](#dashboard). For programmatic use:

```typescript
import {
  Manager,
  Joblog,
  JsonlStorage,
  ClaudeCodeProvider,
  loadConfig,
} from '@runeltd/hugr';

const projectPath = process.cwd();
const config = await loadConfig({ projectPath, preset: 'balanced' });

const storage = new JsonlStorage('/tmp/hugr-demo');
const joblog = new Joblog({ storage });

const llm = new ClaudeCodeProvider({
  projectPath,
  timeout: config.provider.timeout,
  maxRetries: config.provider.maxRetries,
});

const manager = new Manager({ joblog, llm, config, projectPath });

manager.on('activity', ({ type, message, agentName }) => {
  console.log(`[${agentName ?? type}] ${message}`);
});

await manager.runSession({
  task: 'Research the top 5 competitors and summarise their pricing models',
  sessionId: 'demo-001',
});
```

## Pipelines

A pipeline is an ordered list of steps. Each step runs a worker. You define what each worker does, what tools it has access to, and how many iterations it runs.

### Workflow templates

The dashboard ships with templates across six categories:

| Category | Templates |
|----------|-----------|
| Development | Standard Development, Quick Code, Deep Review |
| Content | Content Pipeline |
| Research | Research & Summarise |
| Operations | Classify & Route, Multi-Step Automation |
| Data | Data Processing |
| General | Quality Review, Plan Only |

### Custom pipelines

Define a pipeline in `config.yaml`:

```yaml
pipeline:
  id: research-pipeline
  name: Research & Summarise
  steps:
    - agentId: researcher
      enabled: true
      agentConfig:
        name: Researcher
        instructions: "Search the web and gather sources on the given topic. Output a structured list of findings with citations."
        toolAccess: read-only
    - agentId: fact-checker
      enabled: true
      agentConfig:
        name: Fact Checker
        instructions: "Cross-reference the researcher's findings against original sources. Flag anything unsupported or contradictory."
        toolAccess: read-only
    - agentId: writer
      enabled: true
      agentConfig:
        name: Writer
        instructions: "Produce a polished summary from the validated findings. Cite all sources."
        toolAccess: full
```

Or build them visually in the dashboard — drag workers into order, set iterations, toggle steps on and off.

## Workers

Workers are the agents that execute each step in a pipeline.

### Defining workers

The simplest way is through the dashboard — create a worker with a name, description, system prompt, and tool selection. Or define them inline in a pipeline config:

```yaml
- agentId: my-worker
  enabled: true
  agentConfig:
    name: My Worker
    instructions: "What this worker should do."
    toolAccess: full          # 'full' | 'read-only' | 'read-write-no-bash'
    model: sonnet             # 'sonnet' | 'opus'
    selfReview: false
    canLoop: false
    maxLoops: 3
```

Or extend the `Agent` base class programmatically:

```typescript
import { Agent } from '@runeltd/hugr';

class MyWorker extends Agent {
  async handleMessage(message) {
    const result = await this.runtime.runAgent({
      workdir: '/my/project',
      task: message.payload.prompt,
      allowedTools: this.resolveTools('full', ['Read', 'Write', 'Bash']),
    });
    await this.sendResult(message.jobId, { output: result.transcript });
  }
}
```

### Built-in workers

Hugr ships with eleven workers — six in the core library and five presets.

**Library workers:**
Architect (task analysis and planning), Coder (task execution with self-review), Raven (iterative refinement with structured feedback), Reviewer (standalone final review), CustomAgent (fully configurable via instructions), and SkillCreator (generates reusable skill files).

**Preset workers:**
Planner (decomposes objectives into step-by-step plans), Executor (general-purpose task execution), Validator (checks output against configurable rules), Router (routes tasks to the right worker via rules or LLM judgment), and Aggregator (collects results from multiple workers with collect/merge/vote/summarize strategies).

## Providers

Hugr uses a provider-agnostic runtime interface. Any LLM that implements `AgentRuntime` can power your workers.

**Built-in:** Claude Code (via `@anthropic-ai/claude-agent-sdk`)

**Tool registries** ship for Claude Code, OpenAI, Gemini, Anthropic API, Mistral, xAI, Groq, and AWS Bedrock. Each registry maps generic access levels (`full`, `read-only`, etc.) to provider-specific tool names, so your workers run across providers without changing config.

Configure provider API keys in the dashboard under Settings, or register a custom provider in code:

```typescript
import { registerRuntime } from '@runeltd/hugr';

registerRuntime('my-provider', (options) => {
  return new MyCustomRuntime(options);
});
```

## How It Works

The **Manager** receives a task and walks through the pipeline steps. Each step dispatches work to a worker via the **Joblog** — a structured message bus backed by append-only JSONL files. Workers communicate through typed messages (`task_assignment`, `task_result`, `clarification_request`, etc.).

Every job, message, decision, and activity is logged to JSONL with timestamps, worker IDs, and structured payloads — giving you a full audit trail of what each worker did and why.

For workflows that involve file changes, the Manager can optionally run work in **git worktrees** (`full` worktree isolation, `lightweight` branch isolation, or `none`) and merge changes back when the pipeline completes.

## Events

The Manager emits typed events for real-time progress tracking:

```typescript
manager.on('activity', ({ type, message, agentName, agentId }) => {});
manager.on('session:completed', ({ sessionId, durationMs, iterations }) => {});
manager.on('session:failed', ({ sessionId, error }) => {});
manager.on('job:status-changed', ({ jobId, status }) => {});
manager.on('iteration:completed', ({ iteration }) => {});
```

## Skills

Workers can be augmented with skill files — markdown documents injected into their system prompts:

```typescript
import { Architect } from '@runeltd/hugr';

const architect = new Architect({
  joblog,
  runtime,
  skills: ['my-custom-skill'],
});
```

Default skills are loaded from `.claude/skills/hugr-{workerName}.md` in your project or home directory.

## License

MIT
