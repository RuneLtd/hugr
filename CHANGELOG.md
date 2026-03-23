# Changelog

## 0.1.2

**Added**
- TriggerRunner — high-level orchestrator that wires trigger events to full Manager sessions with pipeline and agent setup
- `Manager.loadPersistedState(projectPath)` — static method for restoring the latest session state from disk
- Global `enabled` flag on TriggerEngineConfig to disable all triggers at once
- `pipelineFromTemplate()` — creates a PipelineConfig from a trigger template's embedded pipeline definition
- Trigger config merging in the YAML config loader
- `resolvePath` shared utility extracted from TriggerEngine and WebhookTrigger
- HelperChat component and `/api/helper` route for in-dashboard AI assistance
- Cron schedule helpers — `scheduleToCron`, `cronToSchedule`, `describeSchedule` with frequency presets (daily, weekdays, weekends, specific days, monthly, hourly)
- `hugrLoader` module for lazy-loading `@runeltd/hugr` in the dashboard
- `triggerScheduler` module for managing trigger engine lifecycle from the dashboard
- Trigger status API endpoint (`/api/triggers/status`)
- Skill file picker on the worker editor with browse-for-file support
- TriggerRunner integration tests

**Improved**
- Triggers page redesigned with schedule builder, template picker, and workflow assignment
- Dashboard overview expanded with activity feed and trigger stats
- Poll trigger now batches all items into a single event instead of firing per-item
- Watch trigger detects file deletes by checking stat on rename events
- Webhook server now auto-creates on first webhook trigger registration instead of requiring pre-init
- Trigger templates now embed pipeline metadata for automatic workflow creation
- Session polling reduced from 1s to 2s and skips when the browser tab is hidden
- Workflow editor and shared components updated for consistency
- Root job is now started before completion to prevent invalid state transitions

**Fixed**
- Webhook server not initializing when the first webhook trigger was registered (inverted condition)
- Silent catch blocks in dashboard replaced with `console.warn` for debuggability
- React list key warnings in session history and workflow editor
- Agent config shape mismatch in session API (`description`/`systemPrompt`/`tools` → `instructions`/`toolAccess`/`allowedTools`)
- Duplicate "verified" preset redundancy removed

## 0.1.1

Initial release — March 2026

**Added**
- Agent base class with polling message loop, interrupt handling, retry logic with exponential backoff, and timeout support
- Manager orchestrator for multi-agent pipelines with session lifecycle, event emitting, and workspace isolation
- Library agents — Architect, Coder, Raven (iterative refinement), Reviewer, SkillCreator, CustomAgent
- Preset agents — Planner, Executor, Validator, Router, Aggregator
- Custom agent support with user-defined system prompts, tool access levels, model selection, and skill injection
- Agent registry — AgentRegistry with AgentHandler dispatch/result pattern, fan-out support, and loop-to-step pipeline control
- Agent factory for creating functional agents with message handlers and lifecycle hooks
- Pipeline system with ordered steps, iteration counts, loop-until-done, manual pause, and per-step enable/disable
- Pipeline presets — fast, balanced, thorough
- YAML config loader with schema validation and preset merging
- Joblog message bus backed by append-only JSONL files — messages, jobs, decisions, and activity logs
- Inbox management per agent with structured message types (task_assignment, clarification, task_result, health_ping, agent_summary)
- JSONL storage layer with read, write, compact, delete, and ID generation
- AgentRuntime interface — provider-agnostic runtime with execute, complete, stream, and listModels
- Claude Code runtime provider via `@anthropic-ai/claude-agent-sdk`
- Runtime factory with registerRuntime/createRuntime pattern for pluggable providers
- ToolRegistry and ToolResolver — generic tool resolution mapped to provider-specific tool names by access level (full, read-only, read-write-no-bash)
- Provider tool mappings for OpenAI, Anthropic, Gemini, Mistral, xAI (Grok), Groq, and AWS Bedrock
- LLM provider factory with lazy-loaded built-in providers and extensible registration
- Plugin system — HugrPlugin interface with setup hooks for registering custom agents, tools, and presets via PluginContext
- Skill loader — loads markdown skill files from filesystem and injects them into agent system prompts
- Git operations — branching, worktrees, merging, conflict tracking, commit-all, list hugr branches
- VCS provider interface with GitVCSProvider (full/lightweight isolation) and NoopVCSProvider
- File-based interrupt system — stop, redirect, modify agent execution mid-run
- Trigger engine with four trigger types — cron, webhook, poll, and file watch
- Cron triggers with 5-field expressions, ranges, steps, lists, and human-readable descriptions
- Webhook triggers with path routing, secret validation, method filtering, and payload transforms
- Poll triggers with HTTP polling, jq filtering, and deduplication
- Watch triggers with filesystem monitoring, glob patterns, event filtering, and debounce
- 20+ pre-built trigger templates across content, research, monitoring, devops, data, and communication categories
- Session limit detection with reset time tracking and auto-pause
- Activity mapper — translates runtime activity into categorised dashboard events (reading, writing, running, tool_use)
- Typed event emitter for agent activity, clarification, and trigger-fired events
- Local storage provider with path resolution for sessions and worktrees
- Path resolution utilities — project-hashed session directories under `~/.hugr/sessions/`

**Added (Dashboard)**
- Next.js 14 + Chakra UI dashboard with dark/light theme support
- Overview page — stats cards (active sessions, total sessions, workers, workflows), recent sessions list, quick actions
- Workflows page — create, edit, delete workflows with drag-and-drop step reordering and visual pipeline preview
- 20+ workflow templates across Development, Content & Writing, Research & Analysis, Data & ETL, and Operations categories
- Sessions page — workflow selection, project path picker, task input, start/stop controls, live activity feed with 2s polling
- Clarification response handling in session runner
- Session history page — expandable session records with step results, agent summaries, duration, and workflow visualization
- Workers page — list built-in workers (library and preset categories), create/edit/delete custom workers
- Worker configuration — name, description, system prompt, multi-select tools grouped by provider, skill file picker, self-review toggle, git tracking toggle
- Triggers page — create/edit triggers from templates, cron/webhook/poll/watch configuration forms, enable/disable toggles, status indicators
- Settings page — theme selection (system/light/dark), data path configuration, runtime status check, API key management for 7 providers
- Sidebar navigation — Overview, Workflows, Sessions, History, Workers, Triggers, Settings
- Shell layout, Card, PageHeader, StatusBadge, WorkerBadge, WorkflowVisual, ActivityFeed, ColorModeScript components
- Dashboard stats API, sessions API (create/list/stop/respond), workflows API, workers API, triggers API, tools API, settings APIs (runtime, providers, data-path)
- Native OS folder picker and file picker API endpoints (macOS, Windows, Linux)
- Dashboard state persistence and active session tracking

**Added (Build & Tooling)**
- tsup build with ESM and CJS dual output
- vitest test suite — trigger cron tests, joblog tests, interrupt config tests
- `hugr-dashboard` CLI bin entry point
- GitHub Actions CI — typecheck, build (Node 18/20/22), test
- GitHub issue templates — bug report and feature request forms
- Pull request template with checklist
- CONTRIBUTING.md with setup instructions and project guidelines
