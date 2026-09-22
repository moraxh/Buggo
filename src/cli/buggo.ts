#!/usr/bin/env node
import { runInvestigateCommand } from '../interfaces/cli/investigate-command.js';
import { runCasesCommand, runShowCommand } from '../interfaces/cli/cases-command.js';
import { runConfigCommand } from '../interfaces/cli/config-command.js';
import { runInitCommand } from '../interfaces/cli/init-command.js';

const [, , command, ...rest] = process.argv;

switch (command) {
  case 'investigate': {
    const code = await runInvestigateCommand(rest);
    process.exit(code);
    break;
  }
  case 'cases': {
    process.exit(runCasesCommand(rest));
    break;
  }
  case 'show': {
    process.exit(runShowCommand(rest));
    break;
  }
  case 'config': {
    process.exit(runConfigCommand(rest));
    break;
  }
  case 'init': {
    process.exit(runInitCommand(rest));
    break;
  }
  case 'hunt': {
    console.error('`buggo hunt` is not available yet.');
    process.exit(1);
    break;
  }
  default: {
    console.error(
      [
        'Usage:',
        '  buggo investigate "<description>" [--error <text>] [--stack <file|text>] [--test <name>] [--repo <path>]',
        '                    [--diff <ref>] [--recent-changes <n>] [--exclude <file> ...] [--format human|json]',
        '  buggo cases [--status <status>] [--since <date>] [--search <text>] [--limit <n>]',
        '  buggo show <caseId> [--format human|json]',
        '  buggo config set-key <api-key>',
        '  buggo config show',
        '  buggo init [--repo <path>]',
      ].join('\n')
    );
    process.exit(2);
  }
}
