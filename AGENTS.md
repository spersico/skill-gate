# skill-gate — agent guide

Per-machine skill gating for Pi. When Pi starts with normal skill discovery
disabled (`pi --no-skills`), this extension supplies the skill list from a
declarative per-machine policy. Skills on disk are evaluated live on every
startup/reload; no inventory is stored.

## Layout

See [CONTRIBUTING.md](CONTRIBUTING.md) for the module map. Entry point:
`src/index.ts` (`resources_discover`, `/sync-gates`, `/skill-gate-status`).

## Commands

Run from the repo root:

```bash
pnpm install --frozen-lockfile
pnpm types:check
pnpm test
pnpm lint:all
```

No build step: Pi loads TypeScript directly via `jiti`.

## Conventions

- Strict TypeScript, `nodenext` module resolution, `.ts` extension imports.
- Tests run under `node --experimental-strip-types --test`; prefer testing
  public entrypoints (`getSelectedSkills`, `syncSkillGate`, config
  parse/load) over internals. Shared fixtures live in
  `tests/test-helpers.ts`.
- Smallest surgical change that solves the problem; sparse comments
  (non-obvious rationale only); validate and parse input at trust
  boundaries (config file parsing in `src/config.ts`).
- Keep `oxfmt` and `oxlint --deny-warnings` clean.

## Behaviors to preserve

- Effective default: machine `defaultAction` → global `defaultAction` →
  `allow` (`effectiveDefaultAction`). Roots on disk but not listed in config
  fall back to it with no exceptions (`policiesForActiveRoots`).
- Within a root, `exceptions` invert the default; patterns without `/` match
  the skill frontmatter name, patterns with `/` match the path relative to
  the root.
- Project roots inside the working directory are withheld until Pi trusts
  the project; duplicate selected skill names across roots throw.
- The gate only affects Pi's normal skill discovery. Skills contributed by
  other extensions via `resources_discover`, and explicit `--skill` paths,
  remain additive.
- Config lives at `<agent-dir>/extensions/skill-gate.json`
  (`PI_SKILL_GATE_CONFIG` overrides). Machine keys are normalized hostnames:
  lowercase, `.local` removed, non-alphanumeric runs become `-`.

## References

- [README.md](README.md) — install, config format, env overrides.
- [CONTRIBUTING.md](CONTRIBUTING.md) — layout, dev commands.
- [skill-gate.example.json](skill-gate.example.json) — portable starting config.
- After `pnpm install`, Pi docs in
  `node_modules/@earendil-works/pi-coding-agent/docs/`:
  `packages.md`, `extensions.md`, `skills.md`, `cli.md`.
- `package.json` `pi.extensions` manifest declares the loaded entry point.

## Remotes

Santiago's Forgejo is the primary remote; GitHub mirrors `main`. Do not push directly
to GitHub, and do not commit or push without explicit confirmation.
