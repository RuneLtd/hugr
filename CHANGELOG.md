# Changelog

## 0.1.0

Initial public release.

- Agent base class with message-driven event loop and interrupt handling
- Manager orchestrator for multi-agent pipelines with git worktree isolation
- Built-in agents: Architect, Coder, Raven (reviewer/refiner), Reviewer, CustomAgent, SkillCreator
- Pipeline presets: fast, balanced, thorough
- YAML config loader with validation and preset merging
- Joblog system for structured message passing between agents
- Git operations: branching, worktrees, merging
- Claude Code provider (via `@anthropic-ai/claude-agent-sdk`)
- Skill loading from filesystem
- Session limit detection and auto-pause
