import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { machineName } from '../src/config.ts';

const directories: string[] = [];
const extensionPath = join(import.meta.dirname, '../src/index.ts');

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createSkill(root: string, directory: string, name: string): Promise<void> {
  const path = join(root, directory);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n`, 'utf8');
}

test('RPC catalog includes only skills selected by the actual skill-gate extension', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'skill-gate-rpc-'));
  directories.push(temp);
  const agentDirectory = join(temp, 'agent');
  const skills = join(agentDirectory, 'skills');
  await createSkill(skills, 'included', 'included');
  await createSkill(skills, 'excluded', 'excluded');
  const configPath = join(temp, 'skill-gate.json');
  await writeFile(
    configPath,
    JSON.stringify({
      machines: {
        [machineName]: {
          roots: { [skills]: { defaultAction: 'allow', exceptions: ['excluded'] } },
        },
      },
    }),
    'utf8',
  );

  const child = spawn('pi', ['--mode', 'rpc', '--no-session', '--no-skills', '--approve', '-e', extensionPath], {
    cwd: temp,
    env: { ...process.env, PI_SKILL_GATE_CONFIG: configPath, PI_CODING_AGENT_DIR: agentDirectory },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  try {
    const catalog = await new Promise<{ commands: Array<{ name: string }> }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for RPC catalog: ${stderr}`)), 10_000);
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line) {
            const message = JSON.parse(line) as {
              type?: string;
              command?: string;
              success?: boolean;
              data?: { commands?: Array<{ name: string }> };
            };
            if (message.type === 'response' && message.command === 'get_commands') {
              clearTimeout(timeout);
              if (!message.success || !message.data?.commands) reject(new Error(`RPC catalog failed: ${line}`));
              else resolve({ commands: message.data.commands });
            }
          }
          newline = buffer.indexOf('\n');
        }
      });
      child.once('error', reject);
      child.stdin.write('{"type":"get_commands"}\n');
    });
    const names = catalog.commands.map((command) => command.name);
    assert.ok(names.includes('skill:included'));
    assert.ok(!names.includes('skill:excluded'));
  } finally {
    child.kill();
  }
});
