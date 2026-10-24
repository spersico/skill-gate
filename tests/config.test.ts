import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  effectiveDefaultAction,
  loadSkillGateConfig,
  parseSkillGateConfig,
  policiesForActiveRoots,
  rootsForMachine,
  saveSkillGateConfig,
} from '../src/config.ts';
import { cleanupFixtures, policy } from './test-helpers.ts';

afterEach(cleanupFixtures);

describe('skill-gate configuration', () => {
  it('parses machine-scoped root objects', () => {
    const config = parseSkillGateConfig(
      '{"machines":{"test-machine":{"roots":{"/skills":{"defaultAction":"allow","exceptions":["github"]}}}}}',
    );
    assert.deepEqual(rootsForMachine(config, 'test-machine'), [policy('/skills', 'allow', ['github'])]);
    assert.throws(() => parseSkillGateConfig('{'), /Invalid skill-gate JSON/);
    assert.throws(
      () =>
        parseSkillGateConfig('{"machines":{"test":{"roots":{"relative":{"defaultAction":"allow","exceptions":[]}}}}}'),
      /absolute path/,
    );
  });

  it('parses global and machine defaults with root > machine > global precedence', () => {
    const config = parseSkillGateConfig(
      '{"defaultAction":"block","machines":{' +
        '"explicit":{"defaultAction":"allow","roots":{"/a":{"defaultAction":"block","exceptions":[]}}},' +
        '"implicit":{"roots":{}}}}',
    );
    assert.equal(effectiveDefaultAction(config, 'explicit'), 'allow');
    assert.equal(effectiveDefaultAction(config, 'implicit'), 'block');
    assert.equal(effectiveDefaultAction(config, 'unknown'), 'block');
    assert.deepEqual(policiesForActiveRoots(config, 'explicit', ['/a', '/b']), [
      policy('/a', 'block'),
      policy('/b', 'allow'),
    ]);
    assert.deepEqual(policiesForActiveRoots(config, 'implicit', ['/b']), [policy('/b', 'block')]);
    assert.throws(
      () => parseSkillGateConfig('{"defaultAction":"sometimes","machines":{}}'),
      /defaultAction must be allow or block/,
    );
  });

  it('falls back to allow when no default is configured', () => {
    const config = parseSkillGateConfig('{"machines":{"test":{"roots":{}}}}');
    assert.equal(effectiveDefaultAction(config, 'test'), 'allow');
    assert.deepEqual(policiesForActiveRoots(config, 'test', ['/skills']), [policy('/skills', 'allow')]);
  });

  it('parses legacy roots configs', () => {
    const config = parseSkillGateConfig(
      '{"roots":[' +
        '{"path":"/a","mode":"allowlist","allow":["x"]},' +
        '{"path":"/b","mode":"blocklist","block":["y"]}]}',
    );
    assert.deepEqual(rootsForMachine(config, 'any-machine'), [
      { path: '/a', defaultAction: 'block', exceptions: ['x'] },
      { path: '/b', defaultAction: 'allow', exceptions: ['y'] },
    ]);
    assert.throws(
      () => parseSkillGateConfig('{"roots":[{"path":"/a","mode":"sometimes"}]}'),
      /must be allowlist or blocklist/,
    );
  });

  it('supports legacy block/allow aliases for exceptions', () => {
    const config = parseSkillGateConfig(
      '{"machines":{"test":{"roots":{' +
        '"/a":{"defaultAction":"allow","block":["x"]},' +
        '"/b":{"defaultAction":"block","allow":["y"]}}}}}',
    );
    assert.deepEqual(rootsForMachine(config, 'test'), [policy('/a', 'allow', ['x']), policy('/b', 'block', ['y'])]);
    assert.throws(
      () =>
        parseSkillGateConfig('{"machines":{"test":{"roots":{"/a":{"defaultAction":"allow","exceptions":"nope"}}}}}'),
      /must be an array of non-empty strings/,
    );
  });

  it('round-trips through save and load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-gate-config-'));
    try {
      const path = join(dir, 'extensions', 'skill-gate.json');
      const config = parseSkillGateConfig(
        '{"defaultAction":"block","machines":{"test-machine":{"defaultAction":"allow","roots":{"/skills":{"defaultAction":"block","exceptions":["github"]}}}}}',
      );
      await saveSkillGateConfig(path, config);
      assert.deepEqual(await loadSkillGateConfig(path), config);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads a missing file as an empty configuration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-gate-config-'));
    try {
      assert.deepEqual(await loadSkillGateConfig(join(dir, 'skill-gate.json')), { machines: {} });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
