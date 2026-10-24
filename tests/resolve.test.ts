import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { parseSkillGateConfig, policiesForActiveRoots } from '../src/config.ts';
import { discoverCandidates, getSelectedSkills, resolveSelectedSkills } from '../src/resolve.ts';
import { discoverRoots } from '../src/sync.ts';
import { cleanupFixtures, fixtureRoot, policy, skill } from './test-helpers.ts';

afterEach(cleanupFixtures);

describe('skill-gate resolution', () => {
  it('inverts the default action for exceptions', async () => {
    const root = await fixtureRoot();
    await skill(root, 'typescript-patterns', 'typescript-patterns');
    await skill(root, 'github', 'github');
    await skill(root, 'notion-private', 'notion-private');

    const allowed = await resolveSelectedSkills([policy(root, 'allow', ['notion-*'])], {
      cwd: tmpdir(),
      isProjectTrusted: true,
    });
    assert.deepEqual(
      allowed.skills.map((candidate) => candidate.name),
      ['github', 'typescript-patterns'],
    );

    const blocked = await resolveSelectedSkills([policy(root, 'block', ['notion-private'])], {
      cwd: tmpdir(),
      isProjectTrusted: true,
    });
    assert.deepEqual(
      blocked.skills.map((candidate) => candidate.name),
      ['notion-private'],
    );
  });

  it('matches path exceptions against root-relative paths', async () => {
    const root = await fixtureRoot();
    await skill(root, 'regal/jira', 'jira');
    await skill(root, 'global/github', 'github');
    const result = await resolveSelectedSkills([policy(root, 'block', ['regal/*'])], {
      cwd: tmpdir(),
      isProjectTrusted: true,
    });
    assert.deepEqual(
      result.skills.map((candidate) => candidate.name),
      ['jira'],
    );
  });

  it('rejects duplicate selected skill names', async () => {
    const root = await fixtureRoot();
    await skill(root, 'github', 'github');
    const otherRoot = await fixtureRoot();
    await skill(otherRoot, 'other-github', 'github');
    await assert.rejects(
      () =>
        resolveSelectedSkills([policy(root, 'block', ['github']), policy(otherRoot, 'block', ['github'])], {
          cwd: tmpdir(),
          isProjectTrusted: true,
        }),
      /Duplicate selected skill name github/,
    );
  });

  it('discovers an individual SKILL.md or skill directory as a leaf', async () => {
    const root = await fixtureRoot();
    const parentSkill = await skill(root, 'parent', 'parent');
    await skill(root, 'parent/nested', 'nested');
    assert.deepEqual(
      (await discoverCandidates(join(root, 'parent'))).map((candidate) => candidate.skillPath),
      [parentSkill],
    );
    assert.deepEqual(
      (await discoverCandidates(parentSkill)).map((candidate) => candidate.relativePath),
      [''],
    );
  });

  it('discovers deeply nested skills with root-relative paths', async () => {
    const root = await fixtureRoot();
    await skill(root, 'group/sub/skill', 'nested');
    const candidates = await discoverCandidates(root);
    assert.deepEqual(
      candidates.map((candidate) => candidate.relativePath),
      ['group/sub/skill'],
    );
    assert.deepEqual(
      candidates.map((candidate) => candidate.name),
      ['nested'],
    );
  });

  it('returns no candidates for an empty root', async () => {
    const root = await fixtureRoot();
    assert.deepEqual(await discoverCandidates(root), []);
  });

  it('follows symlinked skill directories like pi does', async () => {
    const root = await fixtureRoot();
    const target = await fixtureRoot();
    await skill(target, 'linked', 'linked');
    await symlink(join(target, 'linked'), join(root, 'link'));
    assert.deepEqual(
      (await discoverCandidates(root)).map((candidate) => candidate.name),
      ['linked'],
    );
  });

  it('does not inspect configured roots inside an untrusted project', async () => {
    const root = await fixtureRoot();
    await skill(root, '.agents/skills/private', 'private');
    const rootPolicy = policy(join(root, '.agents/skills'), 'block', ['private']);
    assert.deepEqual((await resolveSelectedSkills([rootPolicy], { cwd: root, isProjectTrusted: false })).skills, []);
    assert.deepEqual(
      (await resolveSelectedSkills([rootPolicy], { cwd: root, isProjectTrusted: true })).skills.map(
        (candidate) => candidate.name,
      ),
      ['private'],
    );
  });

  it('gates unlisted roots through the effective default', async () => {
    const root = await fixtureRoot();
    await skill(root, 'github', 'github');
    const config = parseSkillGateConfig('{"defaultAction":"block","machines":{"test-machine":{"roots":{}}}}');
    const blocked = policiesForActiveRoots(config, 'test-machine', [root]);
    assert.deepEqual(blocked, [policy(root, 'block')]);
    assert.deepEqual((await resolveSelectedSkills(blocked, { cwd: tmpdir(), isProjectTrusted: true })).skills, []);
  });

  it('selects user-level skills end to end for a trusted cwd', async () => {
    const priorAgentDirectory = process.env['PI_CODING_AGENT_DIR'];
    const priorHome = process.env['HOME'];
    const root = await fixtureRoot();
    const agentDirectory = join(root, 'agent');
    process.env['PI_CODING_AGENT_DIR'] = agentDirectory;
    process.env['HOME'] = root;
    try {
      await skill(join(agentDirectory, 'skills'), 'global/github', 'github');
      await skill(join(root, '.agents', 'skills'), 'computer-use', 'computer-use');
      const selected = await getSelectedSkills(root, true);
      assert.deepEqual(
        selected.skills.map((candidate) => candidate.name),
        ['computer-use', 'github'],
      );
      assert.deepEqual(await discoverRoots(root), [join(agentDirectory, 'skills'), join(root, '.agents', 'skills')]);
    } finally {
      if (priorAgentDirectory === undefined) delete process.env['PI_CODING_AGENT_DIR'];
      else process.env['PI_CODING_AGENT_DIR'] = priorAgentDirectory;
      if (priorHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = priorHome;
    }
  });
});
