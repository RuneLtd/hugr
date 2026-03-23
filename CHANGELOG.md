# Changelog

## 0.1.0

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
