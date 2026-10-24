import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { machineName } from '../src/config.ts';
import { discoverRoots, syncSkillGate } from '../src/sync.ts';
import { cleanupFixtures, fixtureRoot, skill } from './test-helpers.ts';

afterEach(cleanupFixtures);

function sandboxEnv(agentDirectory: string, home: string) {
  const priorAgentDirectory = process.env['PI_CODING_AGENT_DIR'];
  const priorHome = process.env['HOME'];
  process.env['PI_CODING_AGENT_DIR'] = agentDirectory;
  process.env['HOME'] = home;
  return () => {
    if (priorAgentDirectory === undefined) delete process.env['PI_CODING_AGENT_DIR'];
    else process.env['PI_CODING_AGENT_DIR'] = priorAgentDirectory;
    if (priorHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = priorHome;
  };
}

test('sync creates a machine-scoped config from global and project roots', async () => {
  const root = await fixtureRoot();
  const agentDirectory = join(root, 'agent');
  const project = join(root, 'project');
  const configPath = join(root, 'extensions', 'skill-gate.json');
  await skill(join(agentDirectory, 'skills'), 'global/github', 'github');
  await skill(join(project, '.agents', 'skills'), 'ticket-plan', 'ticket-plan');

  const restoreEnv = sandboxEnv(agentDirectory, root);
  try {
    assert.deepEqual(await discoverRoots(root), [join(agentDirectory, 'skills')]);
    const synced = await syncSkillGate(configPath, project);
    assert.deepEqual(synced.config.machines[machineName], {
      roots: {
        [join(agentDirectory, 'skills')]: { defaultAction: 'allow', exceptions: [] },
        [join(project, '.agents', 'skills')]: { defaultAction: 'allow', exceptions: [] },
      },
    });
    const resynced = await syncSkillGate(configPath, project);
    assert.deepEqual(resynced.config.machines[machineName], synced.config.machines[machineName]);
    assert.equal(resynced.config.defaultAction, undefined);
  } finally {
    restoreEnv();
  }
});

test('sync prefills new roots from the effective default and preserves machine defaults', async () => {
  const root = await fixtureRoot();
  const agentDirectory = join(root, 'agent');
  const project = join(root, 'project');
  const configPath = join(root, 'extensions', 'skill-gate.json');
  await skill(join(agentDirectory, 'skills'), 'global/github', 'github');
  await skill(join(project, '.agents', 'skills'), 'ticket-plan', 'ticket-plan');
  await mkdir(join(root, 'extensions'), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      defaultAction: 'block',
      machines: { [machineName]: { defaultAction: 'block', roots: {} } },
    }),
    'utf8',
  );

  const restoreEnv = sandboxEnv(agentDirectory, root);
  try {
    const synced = await syncSkillGate(configPath, project);
    assert.equal(synced.config.defaultAction, 'block');
    assert.deepEqual(synced.config.machines[machineName], {
      defaultAction: 'block',
      roots: {
        [join(agentDirectory, 'skills')]: { defaultAction: 'block', exceptions: [] },
        [join(project, '.agents', 'skills')]: { defaultAction: 'block', exceptions: [] },
      },
    });
  } finally {
    restoreEnv();
  }
});

test('sync preserves prior exceptions on known roots', async () => {
  const root = await fixtureRoot();
  const agentDirectory = join(root, 'agent');
  const configPath = join(root, 'extensions', 'skill-gate.json');
  const skillsRoot = join(agentDirectory, 'skills');
  await skill(skillsRoot, 'github', 'github');
  await skill(skillsRoot, 'private', 'private');
  await mkdir(join(root, 'extensions'), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      machines: { [machineName]: { roots: { [skillsRoot]: { defaultAction: 'allow', exceptions: ['private'] } } } },
    }),
    'utf8',
  );

  const restoreEnv = sandboxEnv(agentDirectory, root);
  try {
    const synced = await syncSkillGate(configPath, root);
    assert.deepEqual(synced.config.machines[machineName], {
      roots: {
        [skillsRoot]: { defaultAction: 'allow', exceptions: ['private'] },
      },
    });
  } finally {
    restoreEnv();
  }
});

test('sync drops roots that no longer exist on disk', async () => {
  const root = await fixtureRoot();
  const agentDirectory = join(root, 'agent');
  const project = join(root, 'project');
  const configPath = join(root, 'extensions', 'skill-gate.json');
  await skill(join(agentDirectory, 'skills'), 'global/github', 'github');
  await skill(join(project, '.agents', 'skills'), 'ticket-plan', 'ticket-plan');

  const restoreEnv = sandboxEnv(agentDirectory, root);
  try {
    await syncSkillGate(configPath, project);
    const roots = (await syncSkillGate(configPath, project)).config.machines[machineName]?.roots ?? {};
    assert.deepEqual(Object.keys(roots).sort(), [join(agentDirectory, 'skills'), join(project, '.agents', 'skills')]);
    await rm(join(project, '.agents', 'skills'), { recursive: true, force: true });
    const resynced = await syncSkillGate(configPath, project);
    assert.deepEqual(Object.keys(resynced.config.machines[machineName]?.roots ?? {}), [join(agentDirectory, 'skills')]);
  } finally {
    restoreEnv();
  }
});

test('sync discovers the user-level ~/.agents/skills directory like pi does', async () => {
  const root = await fixtureRoot();
  const agentDirectory = join(root, 'agent');
  const configPath = join(root, 'extensions', 'skill-gate.json');
  await skill(join(agentDirectory, 'skills'), 'global/github', 'github');
  await skill(join(root, '.agents', 'skills'), 'computer-use', 'computer-use');

  const restoreEnv = sandboxEnv(agentDirectory, root);
  try {
    assert.deepEqual(await discoverRoots(root), [join(agentDirectory, 'skills'), join(root, '.agents', 'skills')]);
    const synced = await syncSkillGate(configPath, root);
    assert.deepEqual(synced.config.machines[machineName], {
      roots: {
        [join(agentDirectory, 'skills')]: { defaultAction: 'allow', exceptions: [] },
        [join(root, '.agents', 'skills')]: { defaultAction: 'allow', exceptions: [] },
      },
    });
  } finally {
    restoreEnv();
  }
});
