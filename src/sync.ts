import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  effectiveDefaultAction,
  loadSkillGateConfig,
  machineName,
  rootsForMachine,
  saveSkillGateConfig,
  type SkillGateConfig,
  type SkillRootPolicy,
} from './config.ts';

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Roots in scope for cwd: user-level dirs plus ancestor project .agents/skills, mirroring pi. */
export async function discoverRoots(cwd: string): Promise<string[]> {
  const agentDirectory = process.env['PI_CODING_AGENT_DIR'] ?? join(homedir(), '.pi', 'agent');
  // Mirrors Pi's native exploration: user-level skills from the agent directory
  // and from ~/.agents/skills, plus ancestor project .agents/skills directories.
  const roots = [join(agentDirectory, 'skills'), join(homedir(), '.agents', 'skills')];
  let directory = resolve(cwd);
  while (true) {
    const skills = join(directory, '.agents', 'skills');
    if (await isDirectory(skills)) roots.push(skills);
    if ((await isDirectory(join(directory, '.git'))) || dirname(directory) === directory) break;
    directory = dirname(directory);
  }
  return (
    await Promise.all(
      roots
        .filter((root, index) => roots.indexOf(root) === index)
        .map(async (root) => ({ root, exists: await isDirectory(root) })),
    )
  )
    .filter(({ exists }) => exists)
    .map(({ root }) => root);
}

/** Ensures every discovered root has a config entry (prefilled from the effective default) and saves. */
export async function syncSkillGate(
  configPath: string,
  cwd: string,
): Promise<{ config: SkillGateConfig; machine: string }> {
  const config = await loadSkillGateConfig(configPath);
  const existing = new Map(rootsForMachine(config, machineName).map((root) => [root.path, root]));
  const fallback = effectiveDefaultAction(config, machineName);
  const roots: Record<string, Omit<SkillRootPolicy, 'path'>> = {};

  for (const root of await discoverRoots(cwd)) {
    const prior = existing.get(root);
    roots[root] = {
      defaultAction: prior?.defaultAction ?? fallback,
      exceptions: prior?.exceptions ?? [],
    };
  }

  const machineDefault = config.machines[machineName]?.defaultAction;
  const next: SkillGateConfig = {
    ...config,
    machines: {
      ...config.machines,
      [machineName]: {
        ...(machineDefault === undefined ? {} : { defaultAction: machineDefault }),
        roots,
      },
    },
  };
  await saveSkillGateConfig(configPath, next);
  return { config: next, machine: machineName };
}
