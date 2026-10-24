import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

const agentDirectory = process.env['PI_CODING_AGENT_DIR'] ?? join(homedir(), '.pi', 'agent');

/** Location of skill-gate.json; overridable via PI_SKILL_GATE_CONFIG. */
export const configPath = process.env['PI_SKILL_GATE_CONFIG'] ?? join(agentDirectory, 'extensions', 'skill-gate.json');

type DefaultAction = 'allow' | 'block';

/** Policy for one skill root: the default action plus glob exceptions. */
export interface SkillRootPolicy {
  path: string;
  defaultAction: DefaultAction;
  exceptions: string[];
}

interface MachineSkillGateConfig {
  defaultAction?: DefaultAction;
  roots: Record<string, Omit<SkillRootPolicy, 'path'>>;
}

/** Persisted skill-gate configuration: optional global default plus per-machine roots. */
export interface SkillGateConfig {
  defaultAction?: DefaultAction;
  machines: Record<string, MachineSkillGateConfig>;
  legacyRoots?: SkillRootPolicy[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value;
}

function defaultAction(value: unknown, field: string): DefaultAction {
  if (value !== 'allow' && value !== 'block') throw new Error(`${field}.defaultAction must be allow or block`);
  return value;
}

function optionalDefaultAction(value: unknown, field: string): DefaultAction | undefined {
  if (value === undefined) return undefined;
  return defaultAction(value, field);
}

function parsePolicy(path: string, value: unknown, field: string): Omit<SkillRootPolicy, 'path'> {
  if (!path.startsWith('/')) throw new Error(`${field} key must be an absolute path`);
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  const action = defaultAction(value['defaultAction'], field);
  const exceptions =
    value['exceptions'] === undefined
      ? action === 'allow'
        ? stringList(value['block'], `${field}.block`)
        : stringList(value['allow'], `${field}.allow`)
      : stringList(value['exceptions'], `${field}.exceptions`);
  return { defaultAction: action, exceptions };
}

function parseLegacyRoots(value: unknown): SkillRootPolicy[] {
  if (!Array.isArray(value)) throw new Error('skill-gate configuration requires a machines object');
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry['path'] !== 'string' || !entry['path'].startsWith('/')) {
      throw new Error(`roots[${index}] requires an absolute path`);
    }
    if (entry['mode'] !== 'allowlist' && entry['mode'] !== 'blocklist') {
      throw new Error(`roots[${index}].mode must be allowlist or blocklist`);
    }
    return {
      path: entry['path'],
      defaultAction: entry['mode'] === 'allowlist' ? 'block' : 'allow',
      exceptions: stringList(
        entry['mode'] === 'allowlist' ? entry['allow'] : entry['block'],
        `roots[${index}].exceptions`,
      ),
    };
  });
}

/** Parses and validates raw skill-gate.json text; unknown fields are ignored. */
export function parseSkillGateConfig(raw: string): SkillGateConfig {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`Invalid skill-gate JSON: ${message}`);
  }
  if (!isRecord(value)) throw new Error('skill-gate configuration must be an object');
  if (value['machines'] === undefined && value['roots'] !== undefined) {
    return { machines: {}, legacyRoots: parseLegacyRoots(value['roots']) };
  }
  if (!isRecord(value['machines'])) throw new Error('skill-gate configuration requires a machines object');

  const globalDefault = optionalDefaultAction(value['defaultAction'], 'skill-gate');
  const machines: Record<string, MachineSkillGateConfig> = {};
  for (const [machine, machineValue] of Object.entries(value['machines'])) {
    if (!isRecord(machineValue) || !isRecord(machineValue['roots'])) {
      throw new Error(`machines.${machine}.roots must be an object`);
    }
    const machineDefault = optionalDefaultAction(machineValue['defaultAction'], `machines.${machine}`);
    const roots: MachineSkillGateConfig['roots'] = {};
    for (const [path, root] of Object.entries(machineValue['roots'])) {
      roots[path] = parsePolicy(path, root, `machines.${machine}.roots.${path}`);
    }
    machines[machine] = machineDefault === undefined ? { roots } : { defaultAction: machineDefault, roots };
  }
  return globalDefault === undefined ? { machines } : { defaultAction: globalDefault, machines };
}

/** Normalized hostname identifying this machine's config entry. */
export const machineName = hostname()
  .toLowerCase()
  .replace(/\.local$/, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

/** Explicit root policies configured for a machine; legacy configs fall back to legacyRoots. */
export function rootsForMachine(config: SkillGateConfig, machine: string): SkillRootPolicy[] {
  const roots = config.machines[machine]?.roots;
  if (!roots) return config.legacyRoots ?? [];
  return Object.entries(roots).map(([path, policy]) => ({ path, ...policy }));
}

/** Effective default for a machine: machine default, then global default, then 'allow'. */
export function effectiveDefaultAction(config: SkillGateConfig, machine: string): DefaultAction {
  return config.machines[machine]?.defaultAction ?? config.defaultAction ?? 'allow';
}

/** Explicit policies for active roots, falling back to the effective default for unlisted ones. */
export function policiesForActiveRoots(
  config: SkillGateConfig,
  machine: string,
  activeRoots: string[],
): SkillRootPolicy[] {
  const explicit = new Map(rootsForMachine(config, machine).map((root) => [root.path, root]));
  const fallback = effectiveDefaultAction(config, machine);
  return activeRoots.map((path) => explicit.get(path) ?? { path, defaultAction: fallback, exceptions: [] });
}

/** Loads the config file; a missing file means an empty configuration. */
export async function loadSkillGateConfig(path: string): Promise<SkillGateConfig> {
  try {
    return parseSkillGateConfig(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { machines: {} };
    throw error;
  }
}

/** Persists the config file, creating parent directories as needed. */
export async function saveSkillGateConfig(path: string, config: SkillGateConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
