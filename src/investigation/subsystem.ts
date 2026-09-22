import type { ChoiceAnswer } from '../jev/client.js';
import type { DecisionEngine } from '../providers/jev/decision-engine.js';
import type { BugRecord } from './bug-record.js';

const SUBSYSTEMS: Record<string, string> = {
  authentication: 'Login, sessions, tokens, permissions',
  database: 'Data storage, queries, ORM/models',
  api: 'HTTP request/response handling, routing, adapters, client libraries making network calls',
  frontend: 'UI rendering, components, DOM',
  state_management: 'Application state, stores, reducers',
  networking: 'Low-level networking, sockets, protocols',
  filesystem: 'Reading/writing files, paths',
  configuration: 'Config parsing, environment/options handling',
  build: 'Build tooling, bundlers, compilation',
  cli_parsing: 'Command-line argument/flag/subcommand parsing and help output',
  validation_parsing: 'Input validation, schema parsing, data format parsing (e.g. dates, regexes, structured data)',
  async_concurrency: 'Promise/task scheduling, queues, concurrency limits, rate limiting, race conditions',
  caching: 'Caching layers, memoization, cache invalidation',
  serialization: 'Encoding/decoding, serialization/deserialization formats',
  tests: 'Test code itself',
  other: 'Does not fit any of the above',
};

export type SubsystemResult = {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export async function classifySubsystem(
  engine: DecisionEngine,
  bug: BugRecord,
  structuralSummary: string
): Promise<SubsystemResult> {
  const state = {
    bug_description: bug.bug_description,
    error_message: bug.error_message,
    stack_trace: bug.stack_trace,
    repository_structure: structuralSummary,
  };

  const res = await engine.ask('phaseA_subsystem', {
    state,
    questions: {
      subsystem: {
        type: 'choice',
        instructions:
          'Given this bug report and repository structure, which subsystem is most likely responsible for the bug?',
        criteria: SUBSYSTEMS,
      },
    },
  });

  const answer = res.answers.subsystem as ChoiceAnswer;
  return {
    choice: answer.choice,
    probabilities: answer.probabilities,
    confidence: answer.confidence,
  };
}
