import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeInitInstructions } from '../src/interfaces/cli/init-command.js';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'buggo-init-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('writeInitInstructions creates AGENTS.md when neither CLAUDE.md nor AGENTS.md exists', () => {
  withTempDir((dir) => {
    const results = writeInitInstructions(dir);
    assert.equal(results.length, 1);
    assert.equal(results[0].action, 'created');
    assert.ok(existsSync(join(dir, 'AGENTS.md')));
    assert.ok(!existsSync(join(dir, 'CLAUDE.md')), 'must not create CLAUDE.md when nothing asked for it');
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    assert.match(content, /buggo_investigate/);
  });
});

test('writeInitInstructions appends to an existing CLAUDE.md without discarding its content', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# My project\n\nSome existing instructions.\n');
    const results = writeInitInstructions(dir);
    assert.equal(results.length, 1);
    assert.equal(results[0].file, join(dir, 'CLAUDE.md'));
    assert.equal(results[0].action, 'appended');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
    assert.match(content, /Some existing instructions/);
    assert.match(content, /buggo_investigate/);
  });
});

test('writeInitInstructions updates both CLAUDE.md and AGENTS.md when both already exist', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Claude instructions\n');
    writeFileSync(join(dir, 'AGENTS.md'), '# Agent instructions\n');
    const results = writeInitInstructions(dir);
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.action).sort(),
      ['appended', 'appended']
    );
    assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8'), /buggo_investigate/);
    assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf-8'), /buggo_investigate/);
  });
});

test('writeInitInstructions is idempotent - running it twice does not duplicate the block', () => {
  withTempDir((dir) => {
    writeInitInstructions(dir);
    const firstContent = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');

    const second = writeInitInstructions(dir);
    assert.equal(second[0].action, 'already-present');
    const secondContent = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    assert.equal(firstContent, secondContent);

    const occurrences = (secondContent.match(/buggo_investigate/g) ?? []).length;
    assert.equal(occurrences, 1);
  });
});
