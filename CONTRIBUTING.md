# Contributing to Hugr

Thanks for your interest in contributing. Hugr is in early development, so things move fast and break often — extra hands are welcome.

## Getting started

```bash
git clone https://github.com/RuneLtd/hugr.git
cd hugr
npm install
npm run build
```

Run the dashboard separately:

```bash
cd dashboard
npm install
npm run dev
```

## Development workflow

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Run `npm run typecheck` and `npm run build` to verify nothing is broken.
4. Run `npm test -- --run` if your change touches core logic.
5. Open a pull request against `main`.

## Project structure

- `src/` — core framework (agents, pipelines, runtime, config)
- `dashboard/` — Next.js + Chakra UI management interface
- `tests/` — vitest test suite

## Guidelines

- Keep agents provider-agnostic. Use `resolveTools()` instead of hardcoding tool names.
- New runtimes should implement the `AgentRuntime` interface and register via the factory.
- Don't add comments to code (`// example`) — the codebase convention is to let the code speak for itself.
- Prefer small, focused PRs over large sweeping changes.

## Reporting issues

Use the GitHub issue templates for bug reports and feature requests. If you're unsure whether something is a bug or expected behaviour, open a discussion first.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
