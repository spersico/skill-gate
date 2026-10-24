import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SkillRootPolicy } from '../src/config.ts';

const directories: string[] = [];

export async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skill-gate-'));
  directories.push(root);
  return root;
}

export async function cleanupFixtures(): Promise<void> {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
}

export async function skill(root: string, path: string, name: string): Promise<string> {
  const directory = join(root, path);
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'SKILL.md');
  await writeFile(file, `---\nname: ${name}\ndescription: ${name}\n---\n`, 'utf8');
  return file;
}

export function policy(path: string, defaultAction: 'allow' | 'block', exceptions: string[] = []): SkillRootPolicy {
  return { path, defaultAction, exceptions };
}
