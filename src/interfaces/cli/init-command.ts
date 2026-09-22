/**
 * `buggo init` - lowers the adoption cost for Claude Code, and any other
 * agent reading the CLAUDE.md/AGENTS.md conventions, to actually use
 * buggo_investigate instead of defaulting to manual grep/read. A tool's
 * MCP description alone rarely wins that competition reliably; an explicit
 * project instruction does. This writes that instruction once, idempotently,
 * to whichever of CLAUDE.md/AGENTS.md already exist in the repo - or
 * creates AGENTS.md (the tool-agnostic convention) if neither does.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerWithInstalledAgents, agentDisplayName } from './agent-detection.js';

const MARKER = '<!-- buggo:mcp-instructions -->';

const INSTRUCTION_BLOCK = `${MARKER}
## Bug investigation

Before manually grepping or reading through files to locate a reported bug, use the \`buggo_investigate\` MCP tool (if available) to get a ranked list of likely suspect files first. It's fast (a few seconds) and cheap (a fraction of a cent), and often narrows a large or unfamiliar repository down to a handful of files worth reading closely - exploring from there is more focused than starting cold.
${MARKER}
`;

const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;

export type InitFileResult =
  | { file: string; action: 'created' }
  | { file: string; action: 'appended' }
  | { file: string; action: 'already-present' };

function writeInstructionsTo(path: string): InitFileResult {
  const file = path;

  if (!existsSync(path)) {
    writeFileSync(path, INSTRUCTION_BLOCK);
    return { file, action: 'created' };
  }

  const current = readFileSync(path, 'utf-8');
  if (current.includes(MARKER)) {
    return { file, action: 'already-present' };
  }

  const separator = current.endsWith('\n') ? '\n' : '\n\n';
  appendFileSync(path, separator + INSTRUCTION_BLOCK);
  return { file, action: 'appended' };
}

/**
 * Writes buggo usage instructions to every agent-instructions file that
 * already exists in repoRoot (CLAUDE.md and/or AGENTS.md). If neither
 * exists yet, creates AGENTS.md - the tool-agnostic convention, a
 * reasonable default when the project hasn't committed to one tool's
 * naming. Idempotent per file: running it twice never duplicates a block.
 */
export function writeInitInstructions(repoRoot: string): InitFileResult[] {
  const existing = AGENT_FILES.filter((name) => existsSync(join(repoRoot, name)));
  const targets = existing.length > 0 ? existing : ['AGENTS.md'];
  return targets.map((name) => writeInstructionsTo(join(repoRoot, name)));
}

const MCP_ADD_COMMAND = 'claude mcp add buggo --scope user -- buggo-mcp';

export function runInitCommand(argv: string[]): number {
  const repoIdx = argv.indexOf('--repo');
  const repoRoot = repoIdx >= 0 ? argv[repoIdx + 1] : process.cwd();
  if (repoIdx >= 0 && repoRoot === undefined) {
    console.error('--repo requires a value');
    return 2;
  }

  const results = writeInitInstructions(repoRoot);

  for (const result of results) {
    switch (result.action) {
      case 'created':
        console.log(`Created ${result.file} with buggo usage instructions.`);
        break;
      case 'appended':
        console.log(`Added buggo usage instructions to ${result.file}.`);
        break;
      case 'already-present':
        console.log(`${result.file} already has buggo usage instructions - nothing to do.`);
        break;
    }
  }

  console.log('');
  console.log('Checking for locally installed agents...');
  const agentResults = registerWithInstalledAgents();
  const detected = agentResults.filter((r) => r.status !== 'not-installed');

  if (detected.length === 0) {
    console.log('No supported agent (Claude Code, Cursor, Windsurf, Cline, Zed) detected locally.');
    console.log('If you use one not listed here, or detection missed it, register buggo-mcp manually, e.g.:');
    console.log(`  ${MCP_ADD_COMMAND}`);
  } else {
    for (const r of detected) {
      const name = agentDisplayName(r.agent);
      switch (r.status) {
        case 'registered':
          console.log(`  ✓ ${name}: registered buggo-mcp`);
          break;
        case 'already-registered':
          console.log(`  ✓ ${name}: already registered`);
          break;
        case 'failed':
          console.log(`  ✕ ${name}: detected, but registration failed (${r.error})`);
          break;
      }
    }
  }

  return 0;
}
