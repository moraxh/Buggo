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
import { hunt } from '../../core/hunt.js';
import { toAgentResult } from '../json/format.js';

/**
 * Any stdio-connected process can invoke buggo_investigate, and each
 * investigation spends real money on Jev calls. There's no credential
 * exchange over stdio MCP (the transport assumes a locally-trusted
 * process), so the practical guardrail is a hard cap on how many
 * investigations one server process will run - protects against a
 * misbehaving or looping MCP client, not against a malicious one.
 * Configurable via BUGGO_MCP_MAX_INVESTIGATIONS; 0 or unset means "use the
 * default", a negative value is invalid and falls back to the default too.
 */
const DEFAULT_MAX_INVESTIGATIONS_PER_SESSION = 20;

function resolveMaxInvestigations(): number {
  const raw = process.env.BUGGO_MCP_MAX_INVESTIGATIONS;
  if (!raw) return DEFAULT_MAX_INVESTIGATIONS_PER_SESSION;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_INVESTIGATIONS_PER_SESSION;
  return parsed;
}

export function createBuggoMcpServer(): McpServer {
  const server = new McpServer({ name: 'buggo', version: '0.1.0' });
  const maxInvestigations = resolveMaxInvestigations();
  let investigationCount = 0;

  server.registerTool(
    'buggo_investigate',
    {
      title: 'Investigate a bug',
      description:
        'Use this BEFORE manually grepping/reading files to find where a reported bug lives in a repository. ' +
        'Given a bug report and a local repository path, returns the files most likely responsible for the bug ' +
        '(suspects, ranked by confidence, with evidence: matched symbols, stack trace hits, git recency). ' +
        'Cheap (a fraction of a cent) and fast (a few seconds) - cheaper than several rounds of exploratory ' +
        'grep/read on an unfamiliar or large repository. Does not modify the repository or attempt a fix; it ' +
        'only narrows down where to look next. ' +
        `Limited to ${maxInvestigations} investigations per server session.`,
      inputSchema: {
        repository: z.string().describe('Absolute path to the local repository to investigate.'),
        description: z.string().describe('Description of the observed bug.'),
        errorMessage: z.string().optional().describe('Error message observed, if any.'),
        stackTrace: z.string().optional().describe('Stack trace observed, if any.'),
        failingTest: z.string().optional().describe('Name or path of a failing test, if any.'),
        hintedFiles: z
          .array(z.string())
          .optional()
          .describe('Repo-relative paths already suspected (e.g. from a diff you have already looked at), used as extra ranking evidence.'),
      },
    },
    async ({ repository, description, errorMessage, stackTrace, failingTest, hintedFiles }) => {
      if (investigationCount >= maxInvestigations) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: `Session investigation limit reached (${maxInvestigations}). ` +
                    'Restart the buggo MCP server to reset it, or raise the limit via BUGGO_MCP_MAX_INVESTIGATIONS.',
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
      investigationCount++;

      const kase = await investigate({
        repoRoot: repository,
        report: { description, errorMessage, stackTrace, failingTest, hintedFiles },
      });
      const result = toAgentResult(kase);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
        isError: kase.status === 'FAILED',
      };
    }
  );

  server.registerTool(
    'buggo_hunt',
    {
      title: 'Blind bug triage (no bug report needed)',
      description:
        'Use this to find where to look for BUGS YOU DO NOT YET KNOW ABOUT in an unfamiliar or large repository - ' +
        'unlike buggo_investigate, this needs no bug description at all. Given only a repository path, returns a ' +
        'prioritized list of files most likely to hide an undiscovered bug, ranked using directory structure and ' +
        'a git-derived risk signal (how often a file has historically needed bug-fix commits). This is a blind ' +
        'structural risk estimate, not a discovered bug - nothing returned has been reproduced. Treat the results ' +
        'as starting points worth a closer look, then investigate/reproduce them yourself before concluding ' +
        'anything is actually broken. Known bias: favors large, frequently-touched "core" files over rarely-' +
        'touched peripheral ones. Cheap (a fraction of a cent) and fast (a few seconds). ' +
        `Limited to ${maxInvestigations} calls per server session (shared with buggo_investigate).`,
      inputSchema: {
        repository: z.string().describe('Absolute path to the local repository to triage.'),
      },
    },
    async ({ repository }) => {
      if (investigationCount >= maxInvestigations) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: `Session investigation limit reached (${maxInvestigations}). ` +
                    'Restart the buggo MCP server to reset it, or raise the limit via BUGGO_MCP_MAX_INVESTIGATIONS.',
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
      investigationCount++;

      const result = await hunt({ repoRoot: repository });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
        isError: result.status === 'FAILED',
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
