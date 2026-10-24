import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import {
  configPath,
  loadSkillGateConfig,
  machineName,
  policiesForActiveRoots,
  type SkillRootPolicy,
} from './config.ts';
import { discoverRoots } from './sync.ts';

/** One skill found on disk. */
export interface SkillCandidate {
  name: string;
  skillPath: string;
  relativePath: string;
}

/** A root policy annotated with its live on-disk inventory. */
export interface SelectedSkillRoot extends SkillRootPolicy {
  discovered: string[];
}

/** Selection result: per-root live inventories plus the gated skills. */
export interface SelectedSkills {
  roots: SelectedSkillRoot[];
  skills: SkillCandidate[];
}

function globMatches(pattern: string, value: string): boolean {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${expression}$`).test(value);
}

function matchesPattern(pattern: string, candidate: SkillCandidate): boolean {
  return globMatches(pattern, pattern.includes('/') ? candidate.relativePath : candidate.name);
}

function selectedByPolicy(policy: SkillRootPolicy, candidate: SkillCandidate): boolean {
  const isException = policy.exceptions.some((pattern) => matchesPattern(pattern, candidate));
  return isException ? policy.defaultAction === 'block' : policy.defaultAction === 'allow';
}

function isInside(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith('..'));
}

async function parseSkillName(skillPath: string): Promise<string> {
  const content = await readFile(skillPath, 'utf8');
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const frontmatterContents = frontmatter?.[1];
  const name = frontmatterContents?.match(/^name:\s*([^\s#]+)\s*(?:#.*)?$/m)?.[1];
  if (!name) throw new Error(`Skill ${skillPath} has no frontmatter name`);
  return name;
}

async function getEntryType(
  directory: string,
  entry: Dirent<string>,
): Promise<{ type: 'file' | 'directory' | 'other'; path: string }> {
  const path = resolve(directory, entry.name);
  if (entry.isFile()) return { type: 'file', path };
  if (entry.isDirectory()) return { type: 'directory', path };
  if (entry.isSymbolicLink()) {
    try {
      const info = await stat(path);
      const type = info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other';
      return { type, path };
    } catch (error) {
      console.warn(`Skill-Gate: Broken symlink: ${path}`, error);
      return { type: 'other', path };
    }
  }

  return { type: 'other', path };
}

/** Recursively collects SKILL.md paths under a directory, following symlinks like pi does. */
export async function scanSkillFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name !== 'SKILL.md') continue;
    const { type, path } = await getEntryType(directory, entry);
    if (type === 'file') return [path];
  }
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      // Mirror pi: never descend into dotfiles or dependency directories.
      if (entry.name === 'SKILL.md' || entry.name.startsWith('.') || entry.name === 'node_modules') return [];
      const { type, path } = await getEntryType(directory, entry);
      if (type !== 'directory') return [];
      return scanSkillFiles(path);
    }),
  );
  return nested.flat();
}

/** Discovers skill candidates under a root file or directory. */
export async function discoverCandidates(root: string): Promise<SkillCandidate[]> {
  const absoluteRoot = resolve(root);
  const rootInfo = await stat(absoluteRoot);
  const pathRoot = rootInfo.isFile() ? dirname(absoluteRoot) : absoluteRoot;
  const skillFiles: string[] = [];

  if (rootInfo.isFile()) {
    if (basename(absoluteRoot) !== 'SKILL.md') throw new Error(`Skill root file must be SKILL.md: ${root}`);
    skillFiles.push(absoluteRoot);
  } else if (rootInfo.isDirectory()) {
    skillFiles.push(...(await scanSkillFiles(absoluteRoot)));
  } else {
    throw new Error(`Skill root is neither a file nor directory: ${root}`);
  }

  return Promise.all(
    skillFiles.sort().map(async (skillPath) => ({
      name: await parseSkillName(skillPath),
      skillPath,
      relativePath: relative(pathRoot, dirname(skillPath)).split(sep).join('/'),
    })),
  );
}

/** Applies root policies to live candidates; duplicate selected names are an error. */
export async function resolveSelectedSkills(
  roots: SkillRootPolicy[],
  options: { cwd: string; isProjectTrusted: boolean },
): Promise<SelectedSkills> {
  const perRoot = await Promise.all(
    roots.map(async (policy) => {
      if (isInside(options.cwd, policy.path) && !options.isProjectTrusted)
        return {
          policy,
          discovered: [] as string[],
          selected: [] as SkillCandidate[],
        };
      const candidates = await discoverCandidates(policy.path);
      return {
        policy,
        discovered: candidates.map((candidate) => candidate.name).sort(),
        selected: candidates.filter((candidate) => selectedByPolicy(policy, candidate)),
      };
    }),
  );
  const selected = perRoot.flatMap((entry) => entry.selected);

  const names = new Map<string, string>();
  for (const candidate of selected) {
    const prior = names.get(candidate.name);
    if (prior) throw new Error(`Duplicate selected skill name ${candidate.name}: ${prior} and ${candidate.skillPath}`);
    names.set(candidate.name, candidate.skillPath);
  }
  return {
    roots: perRoot.map(({ policy, discovered }) => ({ ...policy, discovered })),
    skills: selected.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

/** Discovers active roots for cwd and returns the gated selection for this machine. */
export async function getSelectedSkills(cwd: string, isProjectTrusted: boolean): Promise<SelectedSkills> {
  const activeRoots = await discoverRoots(cwd);
  const config = await loadSkillGateConfig(configPath);
  const roots = policiesForActiveRoots(config, machineName, activeRoots);
  return await resolveSelectedSkills(roots, { cwd, isProjectTrusted });
}
