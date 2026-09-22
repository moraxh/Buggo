/**
 * Shared Ink building blocks for the detective-themed views (investigate's
 * live run, `buggo show`'s replay of a finished case, `buggo cases`' case
 * list). Presentation only - detective terminology only where it maps to
 * real pipeline state.
 */
import { Box, Text } from 'ink';
import type { Case, CaseStatus, Suspect } from '../../core/types.js';

export function suspectLabel(confidence: number, rank: number): string {
  if (rank === 1 && confidence >= 0.5) return 'Primary suspect';
  if (confidence >= 0.1) return 'Person of interest';
  return 'Weak lead';
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 0.5) return 'red';
  if (confidence >= 0.1) return 'yellow';
  return 'gray';
}

/** Color for a case's overall status, used consistently across the case list and single-case views. */
export function statusColor(status: CaseStatus): string {
  switch (status) {
    case 'LOCALIZED':
      return 'green';
    case 'PARTIAL':
      return 'yellow';
    case 'FAILED':
      return 'red';
    default:
      return 'gray';
  }
}

export function SuspectRow({ s }: { s: Suspect }) {
  const symbolEvidence = s.evidence.find((e) => e.kind === 'symbol_match');
  const symbols = symbolEvidence && symbolEvidence.kind === 'symbol_match' ? symbolEvidence.symbols.slice(0, 5) : [];
  const pathMatch = s.evidence.find((e) => e.kind === 'path_match');
  const color = confidenceColor(s.confidence);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color} bold>
          {String(s.rank).padStart(2, '0')}
        </Text>
        <Text>  </Text>
        <Text bold underline>
          {s.path}
        </Text>
      </Box>
      <Box marginLeft={4}>
        <Text color={color}>{suspectLabel(s.confidence, s.rank)}</Text>
        <Text dimColor> · </Text>
        <Text bold>{(s.confidence * 100).toFixed(0)}%</Text>
      </Box>
      {pathMatch && pathMatch.kind === 'path_match' && (
        <Box marginLeft={4}>
          <Text color="cyan">⚑ {pathMatch.detail}</Text>
        </Box>
      )}
      {symbols.length > 0 && (
        <Box marginLeft={4}>
          <Text dimColor>symbols: {symbols.join(', ')}</Text>
        </Box>
      )}
    </Box>
  );
}

/** Full result block: suspects deck + closing line. Used both right after a live investigation and when replaying a saved case (`buggo show`). */
export function FinalResult({ kase }: { kase: Case }) {
  if (kase.status === 'FAILED') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red" bold>
          ✕ INVESTIGATION INTERRUPTED
        </Text>
        <Box marginTop={1}>
          <Text>{kase.error?.message ?? 'Unknown failure.'}</Text>
        </Box>
      </Box>
    );
  }

  const suspects = kase.localization?.suspects ?? [];
  if (suspects.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>
          CASE INCONCLUSIVE
        </Text>
        <Box marginTop={1}>
          <Text>Buggo could not identify a sufficiently strong suspect.</Text>
        </Box>
      </Box>
    );
  }

  const title = kase.status === 'PARTIAL' ? 'CASE PARTIALLY LOCALIZED' : 'CASE LOCALIZED';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        SUSPECTS
      </Text>
      <Box marginTop={1} flexDirection="column">
        {suspects.map((s) => (
          <SuspectRow key={s.path} s={s} />
        ))}
      </Box>
      <Text bold color="green">
        ✓ {title}
      </Text>
      <Box marginTop={1}>
        <Text>{suspects.length} files recommended for investigation.</Text>
      </Box>
      {kase.status === 'PARTIAL' && kase.error && (
        <Box marginTop={1}>
          <Text dimColor>{kase.error.message}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          Investigation {kase.costs.jevCalls} decisions · {(kase.timingsMs.total / 1000).toFixed(1)}s · $
          {kase.costs.costUsd.toFixed(4)}
        </Text>
      </Box>
    </Box>
  );
}

export function CaseHeader({ caseId, description }: { caseId: string; description: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>CASE {caseId}</Text>
      <Box marginTop={1}>
        <Text>{description}</Text>
      </Box>
    </Box>
  );
}
