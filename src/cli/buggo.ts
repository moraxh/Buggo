#!/usr/bin/env node
import { runInvestigateCommand } from '../interfaces/cli/investigate-command.js';
import { runCasesCommand, runShowCommand } from '../interfaces/cli/cases-command.js';

const [, , command, ...rest] = process.argv;

switch (command) {
  case 'investigate': {
    const code = await runInvestigateCommand(rest);
    process.exit(code);
    break;
  }
  case 'cases': {
    process.exit(runCasesCommand());
    break;
  }
  case 'show': {
    process.exit(runShowCommand(rest));
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
        '  buggo investigate "<description>" [--error <text>] [--stack <file|text>] [--test <name>] [--repo <path>] [--format human|json]',
        '  buggo cases',
        '  buggo show <caseId> [--format human|json]',
      ].join('\n')
    );
    process.exit(2);
  }
}
