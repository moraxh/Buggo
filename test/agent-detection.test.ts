import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerWithInstalledAgents } from '../src/interfaces/cli/agent-detection.js';

function withFakeHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), 'buggo-agent-detect-home-'));
  try {
    return fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('registerWithInstalledAgents reports not-installed for every directory-based agent when nothing is present', () => {
  withFakeHome((home) => {
    const results = registerWithInstalledAgents(home);
    // claude-code detection also depends on `which claude` in PATH, which
    // is independent of the fake home directory - only assert on the
    // agents whose detection is fully controlled by `home`.
    const dirBased = results.filter((r) => r.agent !== 'claude-code');
    for (const r of dirBased) {
      assert.equal(r.status, 'not-installed', `${r.agent} should be not-installed under an empty fake home`);
    }
  });
});

test('registerWithInstalledAgents registers Cursor when ~/.cursor exists, merging into an empty config', () => {
  withFakeHome((home) => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    const results = registerWithInstalledAgents(home);
    const cursor = results.find((r) => r.agent === 'cursor')!;
    assert.equal(cursor.status, 'registered');

    const config = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf-8'));
    assert.equal(config.mcpServers.buggo.command, 'buggo-mcp');
  });
});

test('registerWithInstalledAgents preserves an existing Cursor mcp.json entry and only adds buggo', () => {
  withFakeHome((home) => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { 'other-tool': { command: 'other-mcp', args: [], env: {} } } })
    );
    registerWithInstalledAgents(home);

    const config = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf-8'));
    assert.ok(config.mcpServers['other-tool'], 'pre-existing entry must survive the merge');
    assert.ok(config.mcpServers.buggo, 'buggo entry must be added');
  });
});

test('registerWithInstalledAgents reports already-registered on a second run, without duplicating', () => {
  withFakeHome((home) => {
    mkdirSync(join(home, '.cursor'), { recursive: true });

    const first = registerWithInstalledAgents(home).find((r) => r.agent === 'cursor')!;
    assert.equal(first.status, 'registered');

    const second = registerWithInstalledAgents(home).find((r) => r.agent === 'cursor')!;
    assert.equal(second.status, 'already-registered');
  });
});

test('registerWithInstalledAgents writes Zed config with the required source:"custom" field', () => {
  withFakeHome((home) => {
    mkdirSync(join(home, '.config', 'zed'), { recursive: true });
    const results = registerWithInstalledAgents(home);
    const zed = results.find((r) => r.agent === 'zed')!;
    assert.equal(zed.status, 'registered');

    const config = JSON.parse(readFileSync(join(home, '.config', 'zed', 'settings.json'), 'utf-8'));
    assert.equal(config.context_servers.buggo.source, 'custom');
    assert.equal(config.context_servers.buggo.command, 'buggo-mcp');
  });
});

test('registerWithInstalledAgents writes Cline config with disabled/autoApprove fields', () => {
  withFakeHome((home) => {
    mkdirSync(join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev'), { recursive: true });
    const results = registerWithInstalledAgents(home);
    const cline = results.find((r) => r.agent === 'cline')!;
    assert.equal(cline.status, 'registered');

    const config = JSON.parse(
      readFileSync(
        join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
        'utf-8'
      )
    );
    assert.equal(config.mcpServers.buggo.disabled, false);
    assert.deepEqual(config.mcpServers.buggo.autoApprove, []);
  });
});

test('registerWithInstalledAgents detects Windsurf via ~/.codeium/windsurf', () => {
  withFakeHome((home) => {
    mkdirSync(join(home, '.codeium', 'windsurf'), { recursive: true });
    const results = registerWithInstalledAgents(home);
    const windsurf = results.find((r) => r.agent === 'windsurf')!;
    assert.equal(windsurf.status, 'registered');

    const config = JSON.parse(readFileSync(join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'utf-8'));
    assert.equal(config.mcpServers.buggo.command, 'buggo-mcp');
  });
});
