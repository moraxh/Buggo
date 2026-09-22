/**
 * `buggo config` - manage the persisted user-level API key
 * (~/.config/buggo/config.json, written 0600). Separate from .env, which
 * remains supported for repo-local/CI use via JEV_AI_KEY.
 */
import { setApiKey, readUserConfig, getConfigPath } from '../../storage/user-config.js';

function maskKey(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

export function runConfigCommand(argv: string[]): number {
  const [subcommand, ...rest] = argv;

  switch (subcommand) {
    case 'set-key': {
      const key = rest[0];
      if (!key) {
        console.error('Usage: buggo config set-key <api-key>');
        return 2;
      }
      setApiKey(key);
      console.log(`Saved. API key stored in ${getConfigPath()} (permissions 600).`);
      return 0;
    }
    case 'show': {
      const cfg = readUserConfig();
      console.log(`Config file: ${getConfigPath()}`);
      console.log(`API key: ${cfg.jevApiKey ? maskKey(cfg.jevApiKey) : '(not set)'}`);
      if (process.env.JEV_AI_KEY) {
        console.log('Note: JEV_AI_KEY is set in the environment and takes priority over the stored key.');
      }
      return 0;
    }
    default: {
      console.error(
        ['Usage:', '  buggo config set-key <api-key>', '  buggo config show'].join('\n')
      );
      return 2;
    }
  }
}
