/**
 * Detects locally installed AI coding agents and registers buggo-mcp with
 * whichever are found, so `buggo init` can wire up MCP connectivity
 * automatically instead of just printing one hardcoded Claude Code command.
 *
 * Detection is directory-existence based, not PATH-binary based, for the
 * GUI editors (Cursor/Windsurf/Cline/Zed) - they're usually launched from a
 * desktop icon, and their CLI shims are opt-in ("install shell command"),
 * so a missing PATH entry doesn't mean the tool isn't installed. Claude
 * Code is the exception: it's used from a terminal, so PATH is reliable
 * there.
 *
 * Every registration is additive: existing entries in Cursor/Windsurf/
 * Cline/Zed's config JSON are read and merged, never overwritten. Claude
 * Code registration goes through its own `claude mcp add` CLI rather than
 * writing ~/.claude.json directly, since that file's shape isn't something
 * this project owns or should assume future-proof to hand-edit.
 *
 * homeDir is a parameter (defaulting to node:os's homedir()), not read
 * internally, specifically so tests can point every check at an isolated
 * fake home - node:os caches homedir()'s result at module-load time, so
 * overriding $HOME after the fact doesn't work.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

export type AgentId = 'claude-code' | 'cursor' | 'windsurf' | 'cline' | 'zed';

export type AgentRegistrationResult =
  | { agent: AgentId; status: 'registered' }
  | { agent: AgentId; status: 'already-registered' }
  | { agent: AgentId; status: 'not-installed' }
  | { agent: AgentId; status: 'failed'; error: string };

const MCP_SERVER_ENTRY = { command: 'buggo-mcp', args: [] as string[], env: {} as Record<string, string> };

function isCommandAvailable(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJsonMerging(path: string, mergeKey: string, entryKey: string, entry: object): 'registered' | 'already-registered' {
  const doc = existsSync(path) ? readJson(path) : {};
  doc[mergeKey] ??= {};
  if (doc[mergeKey][entryKey] !== undefined) {
    return 'already-registered';
  }
  doc[mergeKey][entryKey] = entry;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  return 'registered';
}

function registerClaudeCode(home: string): AgentRegistrationResult {
  if (!isCommandAvailable('claude')) return { agent: 'claude-code', status: 'not-installed' };

  const claudeConfigPath = join(home, '.claude.json');
  const existing = existsSync(claudeConfigPath) ? readJson(claudeConfigPath) : {};
  if (existing.mcpServers?.buggo !== undefined) {
    return { agent: 'claude-code', status: 'already-registered' };
  }

  try {
    execFileSync('claude', ['mcp', 'add', 'buggo', '--scope', 'user', '--', 'buggo-mcp'], { stdio: 'ignore' });
    return { agent: 'claude-code', status: 'registered' };
  } catch (err) {
    return { agent: 'claude-code', status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

function registerCursor(home: string): AgentRegistrationResult {
  const dir = join(home, '.cursor');
  if (!existsSync(dir)) return { agent: 'cursor', status: 'not-installed' };
  try {
    const status = writeJsonMerging(join(dir, 'mcp.json'), 'mcpServers', 'buggo', MCP_SERVER_ENTRY);
    return { agent: 'cursor', status };
  } catch (err) {
    return { agent: 'cursor', status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

function registerWindsurf(home: string): AgentRegistrationResult {
  const dir = join(home, '.codeium', 'windsurf');
  if (!existsSync(dir)) return { agent: 'windsurf', status: 'not-installed' };
  try {
    const status = writeJsonMerging(join(dir, 'mcp_config.json'), 'mcpServers', 'buggo', MCP_SERVER_ENTRY);
    return { agent: 'windsurf', status };
  } catch (err) {
    return { agent: 'windsurf', status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Cline is a VS Code extension - its config lives under whichever host
 * editor(s) have it installed (VS Code, Cursor, Windsurf all use the same
 * extension globalStorage layout). Detection checks for the extension's
 * own globalStorage folder, not its settings/ subfolder - that subfolder
 * is only created the first time the user opens Cline's MCP settings
 * panel, so requiring it would false-negative on a real Cline install that
 * simply hasn't touched MCP settings yet.
 */
function clineExtensionDirs(home: string): string[] {
  const editors = ['Code', 'Cursor', 'Windsurf'];
  return editors.map((editor) => join(home, '.config', editor, 'User', 'globalStorage', 'saoudrizwan.claude-dev'));
}

function registerCline(home: string): AgentRegistrationResult {
  const extensionDir = clineExtensionDirs(home).find((d) => existsSync(d));
  if (!extensionDir) return { agent: 'cline', status: 'not-installed' };
  const existingPath = join(extensionDir, 'settings', 'cline_mcp_settings.json');

  try {
    const status = writeJsonMerging(existingPath, 'mcpServers', 'buggo', {
      ...MCP_SERVER_ENTRY,
      disabled: false,
      autoApprove: [],
    });
    return { agent: 'cline', status };
  } catch (err) {
    return { agent: 'cline', status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

function registerZed(home: string): AgentRegistrationResult {
  const dir = join(home, '.config', 'zed');
  const installed = isCommandAvailable('zed') || existsSync(dir);
  if (!installed) return { agent: 'zed', status: 'not-installed' };

  try {
    const status = writeJsonMerging(join(dir, 'settings.json'), 'context_servers', 'buggo', {
      source: 'custom',
      ...MCP_SERVER_ENTRY,
    });
    return { agent: 'zed', status };
  } catch (err) {
    return { agent: 'zed', status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Detects and registers buggo-mcp with every locally installed, supported agent. Each registration is independent - one failing doesn't stop the others. */
export function registerWithInstalledAgents(home: string = homedir()): AgentRegistrationResult[] {
  return [
    registerClaudeCode(home),
    registerCursor(home),
    registerWindsurf(home),
    registerCline(home),
    registerZed(home),
  ];
}

export function agentDisplayName(agent: AgentId): string {
  switch (agent) {
    case 'claude-code':
      return 'Claude Code';
    case 'cursor':
      return 'Cursor';
    case 'windsurf':
      return 'Windsurf';
    case 'cline':
      return 'Cline';
    case 'zed':
      return 'Zed';
  }
}
