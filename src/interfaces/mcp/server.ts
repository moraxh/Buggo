/**
 * Minimal MCP server exposing buggo_investigate as a tool. Per spec section
 * 20, the architecture was kept ready for this from Milestone 2: this file
 * is a thin adapter, not a second implementation of the investigation
 * logic. It calls the same investigate() the CLI calls and returns the same
 * AgentResult shape the JSON interface produces - one engine, both surfaces.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { investigate } from '../../core/investigate.js';
import { toAgentResult } from '../json/format.js';

export function createBuggoMcpServer(): McpServer {
  const server = new McpServer({ name: 'buggo', version: '0.1.0' });

  server.registerTool(
    'buggo_investigate',
    {
      title: 'Investigate a bug',
      description:
        'Given a bug report and a local repository path, returns the files most likely responsible for the bug ' +
        '(suspects, ranked by confidence, with evidence). Does not modify the repository or attempt a fix.',
      inputSchema: {
        repository: z.string().describe('Absolute path to the local repository to investigate.'),
        description: z.string().describe('Description of the observed bug.'),
        errorMessage: z.string().optional().describe('Error message observed, if any.'),
        stackTrace: z.string().optional().describe('Stack trace observed, if any.'),
        failingTest: z.string().optional().describe('Name or path of a failing test, if any.'),
      },
    },
    async ({ repository, description, errorMessage, stackTrace, failingTest }) => {
      const kase = await investigate({
        repoRoot: repository,
        report: { description, errorMessage, stackTrace, failingTest },
      });
      const result = toAgentResult(kase);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
        isError: kase.status === 'FAILED',
      };
    }
  );

  return server;
}

export async function runBuggoMcpServer(): Promise<void> {
  const server = createBuggoMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
