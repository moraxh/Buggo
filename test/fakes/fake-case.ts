import type { Case } from '../../src/core/types.js';

export function makeFakeCase(overrides: Partial<Case> = {}): Case {
  return {
    schemaVersion: '1',
    caseId: 'BG-0001',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    status: 'LOCALIZED',
    report: { description: 'Something is broken' },
    repository: { root: '/tmp/fake-repo', productionFileCount: 12 },
    localization: {
      suspects: [
        {
          rank: 1,
          path: 'src/broken.js',
          confidence: 0.8,
          symbols: ['doThing'],
          evidence: [
            { kind: 'symbol_match', symbols: ['doThing'] },
            { kind: 'model_decision', detail: 'Jev file-ranking choice, probability 0.800' },
          ],
          stage: 'file',
        },
      ],
      usedChunking: false,
      chunkCount: 1,
    },
    decisions: [{ label: 'phaseB_rank_files', timestamp: new Date().toISOString(), latencyMs: 100, cached: false }],
    costs: { jevCalls: 1, costUsd: 0.0001 },
    timingsMs: { total: 500 },
    error: null,
    ...overrides,
  };
}
