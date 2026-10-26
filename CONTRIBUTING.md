# Contributing to skill-gate

## Layout

- `src/config.ts` — config parsing, defaults, load/save
- `src/resolve.ts` — on-disk discovery (symlinks followed, like pi) and policy selection
- `src/sync.ts` — root discovery and `syncSkillGate`
- `src/status.ts` — status payload and transcript rendering
- `src/index.ts` — extension wiring (`resources_discover`, `/sync-gates`, `/skill-gate-status`)
- `tests/` — per-module tests plus shared fixtures

## Develop

```bash
pnpm install --frozen-lockfile
pnpm types:check
pnpm test
pnpm lint:all
```
