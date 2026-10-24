# Skill gate

`skill-gate` selects a machine-specific set of skills when Pi starts with normal skill discovery disabled. Skills on disk are evaluated live against the policy; no inventory is stored.

## Install

Use it as a Pi package (submodule or plain checkout) and register it:

```json
{
  "packages": ["./packages/skill-gate"]
}
```

`skill-gate.example.json` in this repo is a portable starting config with no credentials.

## Start Pi

```bash
pi --no-skills
```

The extension reads `~/.pi/agent/extensions/skill-gate.json`. `PI_SKILL_GATE_CONFIG` overrides that location.

## Scope

The gate controls only Pi's normal skill discovery. It does not intercept skills contributed by another extension through `resources_discover`, or explicit `--skill` paths; those remain additive.

## First setup and synchronization

Run `/sync-gates` from the project you want to use. It creates the configuration if it does not exist, discovers Pi's global skills directory, your user-level `~/.agents/skills` directory, and project `.agents/skills` directories, records the current machine, reloads Pi, and displays the resulting status.

Run `/sync-gates` again after adding or removing skill roots. Skills on disk are evaluated live against the policy; no inventory is stored.

Use `/skill-gate-status` to inspect the current machine's policies and selected skills without changing the configuration.

## Configuration

```jsonc
{
  // Optional global default. Omit for "allow".
  "defaultAction": "block",
  "machines": {
    // Lowercase hostname, ".local" removed, non-alphanumeric runs become "-".
    "my-work-macbook": {
      // Optional per-machine default. Omit to inherit the global default.
      "defaultAction": "allow",
      // Absolute-path keys, one entry per skill root.
      "roots": {
        "/Volumes/code/monorepo/.agents/skills": {
          // "allow" or "block". Required on every root entry.
          "defaultAction": "block",
          // Glob patterns inverting the default. Optional, defaults to [].
          "exceptions": ["auth-impact", "typescript-patterns"],
        },
      },
    },
  },
}
```

- `defaultAction` is either `allow` or `block`. It can be set globally (top level), per machine (`machines.<host>.defaultAction`), and per root. A root found on disk but not listed in the config falls back to the machine default, then the global default, then `allow`. `/sync-gates` prefills new root entries from that same fallback and preserves existing entries and machine defaults.
- `exceptions` invert `defaultAction`: with `block`, matching skills load; with `allow`, matching skills do not load.
- Exceptions use glob patterns. Patterns without `/` match a skill's frontmatter name; patterns containing `/` match its path relative to that root.
- `*` matches within one path segment; `**` can span path segments.
- Symlinked skill directories are followed, like pi's native discovery.
- Project roots are skipped until Pi trusts the current project. Global and user-level roots remain available.

Environment overrides:

- `PI_SKILL_GATE_CONFIG` — config file location (default: `<agent-dir>/extensions/skill-gate.json`).
- `PI_CODING_AGENT_DIR` — agent directory used for default config and global skills discovery.

## Layout

- `src/config.ts` — config parsing, defaults, load/save
- `src/resolve.ts` — on-disk discovery (symlinks followed, like pi) and policy selection
- `src/sync.ts` — root discovery and `syncSkillGate`
- `src/status.ts` — status payload and transcript rendering
- `src/index.ts` — extension wiring (`resources_discover`, `/sync-gates`, `/skill-gate-status`)
- `tests/` — per-module tests plus shared fixtures

## Develop

```bash
pnpm --dir packages/skill-gate types:check
pnpm --dir packages/skill-gate test
pnpm --dir packages/skill-gate lint:all
```
