import { relative } from 'node:path';
import type { EntryRenderer, ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent';
import { Box, Container, Text } from '@earendil-works/pi-tui';
import { machineName } from './config.ts';
import { getSelectedSkills } from './resolve.ts';

/** One root as shown in the status card: effective policy plus live inventory. */
export interface SkillGateStatusRoot {
  path: string;
  defaultAction: 'allow' | 'block';
  exceptions: string[];
  discovered: string[];
  selected: string[];
}

/** Status card payload for one machine. */
export interface SkillGateStatus {
  machine: string;
  roots: SkillGateStatusRoot[];
}

function isSkillGateStatus(value: unknown): value is SkillGateStatus {
  return (
    !!value &&
    typeof value === 'object' &&
    'machine' in value &&
    typeof value.machine === 'string' &&
    'roots' in value &&
    Array.isArray(value.roots)
  );
}

/** Gathers the live skill-gate status for a working directory. */
export async function getSkillGateStatus({
  cwd,
  isProjectTrusted,
}: {
  cwd: string;
  isProjectTrusted: () => boolean;
}): Promise<SkillGateStatus> {
  const selectedSkills = await getSelectedSkills(cwd, isProjectTrusted());
  const machine = machineName;
  return {
    machine,
    roots: selectedSkills.roots.map((root) => ({
      path: root.path,
      defaultAction: root.defaultAction,
      exceptions: root.exceptions,
      discovered: root.discovered,
      selected: selectedSkills.skills
        .filter((skill) => !relative(root.path, skill.skillPath).startsWith('..'))
        .map((skill) => skill.name),
    })),
  };
}

function statusLines(status: SkillGateStatus, expanded: boolean, theme: Theme): string[] {
  const lines = [theme.bold(theme.fg('toolTitle', `skill-gate synchronized (${status.machine})`))];
  for (const root of status.roots) {
    lines.push('');
    lines.push(theme.fg('text', root.path));
    lines.push(
      `  ${theme.fg('muted', 'default:')} ${theme.fg(root.defaultAction === 'allow' ? 'success' : 'warning', root.defaultAction)}`,
    );
    lines.push(`  ${theme.fg('muted', 'exceptions:')} ${theme.fg('accent', root.exceptions.join(', ') || '(none)')}`);
    lines.push('');
    lines.push(`  ${theme.fg('muted', 'inventory:')} ${theme.fg('dim', String(root.discovered.length))}`);
    if (expanded) {
      lines.push('');
      lines.push(`  ${theme.fg('muted', 'discovered:')} ${theme.fg('text', root.discovered.join(', ') || '(none)')}`);
      lines.push(`  ${theme.fg('muted', 'selected:')} ${theme.fg('text', root.selected.join(', ') || '(none)')}`);
    }
  }
  return lines;
}

/** Renders a skill-gate-status entry for the session transcript. */
export const renderSkillGateStatus: EntryRenderer = (entry, options, theme) => {
  if (typeof entry.data === 'string') return new Text(entry.data);
  if (!isSkillGateStatus(entry.data)) return new Text('Invalid skill-gate status entry');
  const container = new Container();
  const box = new Box(1, 1, (text) => theme.bg('toolSuccessBg', text));
  box.addChild(new Text(statusLines(entry.data, options.expanded, theme).join('\n'), 0, 0));
  container.addChild(box);
  return container;
};

/** Appends the live skill-gate status for a command context to the transcript. */
async function appendSkillGateStatus(
  pi: ExtensionAPI,
  ctx: { cwd: string; isProjectTrusted: () => boolean },
): Promise<void> {
  pi.appendEntry('skill-gate-status', await getSkillGateStatus(ctx));
}

/** Registers the skill-gate-status entry renderer for a pi instance. */
export function initializeSkillGateStatusRenderer(pi: ExtensionAPI): typeof appendSkillGateStatus {
  pi.registerEntryRenderer('skill-gate-status', renderSkillGateStatus);
  return appendSkillGateStatus;
}
