import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { configPath } from './config.ts';
import { getSelectedSkills } from './resolve.ts';
import { initializeSkillGateStatusRenderer } from './status.ts';
import { syncSkillGate } from './sync.ts';

/** Skill-gate extension: gates pi's normal skill discovery behind per-machine policies. */
export default function index(pi: ExtensionAPI) {
  const renderStatus = initializeSkillGateStatusRenderer(pi);

  pi.registerCommand('skill-gate-status', {
    description: 'Show skill-gate policies and selected skills',
    handler: async (_args, ctx) => {
      await renderStatus(pi, ctx);
    },
  });

  pi.on('resources_discover', async (event, ctx) => {
    const selected = await getSelectedSkills(event.cwd, ctx.isProjectTrusted());
    return { skillPaths: selected.skills.map((skill) => skill.skillPath) };
  });

  pi.registerCommand('sync-gates', {
    description: 'Discover skill roots, synchronize the machine configuration, show status, and reload skills',
    handler: async (_args, ctx) => {
      await syncSkillGate(configPath, ctx.cwd);
      await renderStatus(pi, ctx);
      await ctx.reload();
    },
  });
}
