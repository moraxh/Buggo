/**
 * Persisted user-level config (~/.config/buggo/config.json), separate from
 * .env - lets a globally-installed `buggo` find an API key without a repo
 * checkout. File is written with 0600 so the key isn't world-readable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type UserConfig = {
  jevApiKey?: string;
};

function configDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'buggo')
    : join(homedir(), '.config', 'buggo');
}

function configPath(): string {
  return join(configDir(), 'config.json');
}

export function readUserConfig(): UserConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

export function writeUserConfig(next: UserConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const path = configPath();
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function setApiKey(key: string): void {
  const current = readUserConfig();
  writeUserConfig({ ...current, jevApiKey: key });
}

export function getConfigPath(): string {
  return configPath();
}
