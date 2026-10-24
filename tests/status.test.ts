import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CustomEntry, EntryRenderOptions, Theme } from '@earendil-works/pi-coding-agent';
import { Container, Text } from '@earendil-works/pi-tui';
import { renderSkillGateStatus, type SkillGateStatus } from '../src/status.ts';

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as unknown as Theme;

function render(data: unknown, expanded = false) {
  return renderSkillGateStatus(
    { data } as unknown as CustomEntry,
    { expanded } as unknown as EntryRenderOptions,
    theme,
  );
}

function status(): SkillGateStatus {
  return {
    machine: 'test-machine',
    roots: [
      {
        path: '/skills',
        defaultAction: 'allow',
        exceptions: ['private'],
        discovered: ['github', 'private'],
        selected: ['github'],
      },
    ],
  };
}

describe('skill-gate status', () => {
  it('renders string entries as plain text', () => {
    const rendered = render('already text');
    assert.ok(rendered instanceof Text);
  });

  it('rejects entries that are not skill-gate statuses', () => {
    const rendered = render({ machine: 'test-machine' });
    assert.ok(rendered instanceof Text);
  });

  it('renders a status entry in a decorated container', () => {
    assert.ok(render('plain', false) instanceof Text);
    assert.ok(render(status(), false) instanceof Container);
    assert.ok(render(status(), true) instanceof Container);
  });
});
