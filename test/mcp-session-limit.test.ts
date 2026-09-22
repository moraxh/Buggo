import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBuggoMcpServer } from '../src/interfaces/mcp/server.js';

/**
 * Verifies the per-session investigation cap (BUGGO_MCP_MAX_INVESTIGATIONS)
 * without spending real Jev calls: an empty repository fails fast inside
 * investigate() (see investigate-failure.test.ts), so each tool call still
 * counts against the limit even though it never reaches the network.
 */
test('buggo_investigate rejects calls past the configured per-session limit', async () => {
  process.env.BUGGO_MCP_MAX_INVESTIGATIONS = '2';
  try {
    const server = createBuggoMcpServer();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const emptyRepo = mkdtempSync(join(tmpdir(), 'buggo-mcp-limit-repo-'));
    try {
      const args = { repository: emptyRepo, description: 'anything' };

      const first = (await client.callTool({ name: 'buggo_investigate', arguments: args })) as any;
      assert.equal(first.isError, true, 'empty repo investigation fails (no candidates), but still counts');

      const second = (await client.callTool({ name: 'buggo_investigate', arguments: args })) as any;
      assert.equal(second.isError, true);

      const third = (await client.callTool({ name: 'buggo_investigate', arguments: args })) as any;
      assert.equal(third.isError, true);
      const thirdText = JSON.parse(third.content[0].text);
      assert.match(thirdText.error, /Session investigation limit reached/);
    } finally {
      rmSync(emptyRepo, { recursive: true, force: true });
    }
  } finally {
    delete process.env.BUGGO_MCP_MAX_INVESTIGATIONS;
  }
});
