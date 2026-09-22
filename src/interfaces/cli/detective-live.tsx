/**
 * Live Ink rendering for `buggo investigate` (human format only - JSON
 * output never goes through this, see investigate-command.ts). Renders the
 * investigation as it happens: a running log of beats ("Canvassing the
 * scene...", "Questioning witness: subsystem...") followed by the same
 * final suspects deck detective-render.ts describes in plain text, styled
 * with color/weight instead of raw ANSI codes.
 *
 * Detective terminology only where it maps to real pipeline state - same
 * rule detective-render.ts follows. This file owns *how* it looks; what
 * counts as a beat and what the final Case contains still comes entirely
 * from core/investigate.ts.
 */
import { render, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { investigate } from '../../core/investigate.js';
import type { Case, Suspect } from '../../core/types.js';
import type { InvestigateInput } from '../../core/investigate.js';

/**
 * One beat per distinct phase label, not per call. Large repos trigger
 * chunked file ranking (investigation/files-chunked.ts), which fires
 * several parallel 'phaseB_rank_files' calls sharing that same label - if
 * each got its own line, a big repo would show N identical "Canvassing the
 * file list..." rows with spinners instead of one line with real progress.
 * order tracks first-seen order for stable, chronological display.
 */
type Beat = { label: string; order: number; total: number; completed: number; failed: number };

/** Maps a DecisionEngine phase label to an in-character line. Unknown labels (a future phase) fall back to the raw label rather than a silently wrong guess. */
function beatTextFor(label: string): string {
  if (label === 'phaseA_subsystem') return 'Questioning the codebase: which subsystem does this look like?';
  if (label === 'phaseC_rank_functions') return 'Zooming in on the prime suspects, function by function.';
  if (label === 'phaseB_rank_files') return 'Canvassing the file list for anyone who matches the description.';
  return `Following up: ${label}`;
}

function suspectLabel(confidence: number, rank: number): string {
  if (rank === 1 && confidence >= 0.5) return 'Primary suspect';
  if (confidence >= 0.1) return 'Person of interest';
  return 'Weak lead';
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.5) return 'red';
  if (confidence >= 0.1) return 'yellow';
  return 'gray';
}

function SuspectRow({ s }: { s: Suspect }) {
  const symbolEvidence = s.evidence.find((e) => e.kind === 'symbol_match');
  const symbols = symbolEvidence && symbolEvidence.kind === 'symbol_match' ? symbolEvidence.symbols.slice(0, 5) : [];
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
      {symbols.length > 0 && (
        <Box marginLeft={4}>
          <Text dimColor>symbols: {symbols.join(', ')}</Text>
        </Box>
      )}
    </Box>
  );
}

function FinalResult({ kase }: { kase: Case }) {
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

function DetectiveApp({
  input,
  onDone,
}: {
  input: InvestigateInput;
  onDone: (kase: Case) => void;
}) {
  const [beats, setBeats] = useState<Map<string, Beat>>(new Map());
  const [kase, setKase] = useState<Case | null>(null);
  const [productionFileCount, setProductionFileCount] = useState<number | null>(null);

  useEffect(() => {
    let nextOrder = 0;

    investigate({
      ...input,
      onProgress: {
        onPhaseStart: (label) => {
          setBeats((prev) => {
            const next = new Map(prev);
            const existing = next.get(label);
            if (existing) {
              next.set(label, { ...existing, total: existing.total + 1 });
            } else {
              next.set(label, { label, order: nextOrder++, total: 1, completed: 0, failed: 0 });
            }
            return next;
          });
        },
        onPhaseEnd: (label, ok) => {
          setBeats((prev) => {
            const existing = prev.get(label);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(label, {
              ...existing,
              completed: existing.completed + (ok ? 1 : 0),
              failed: existing.failed + (ok ? 0 : 1),
            });
            return next;
          });
        },
      },
    }).then((result) => {
      setProductionFileCount(result.repository.productionFileCount);
      setKase(result);
      onDone(result);
    });
    // input is captured once at mount - investigate() runs exactly once per CLI invocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold>CASE {kase?.caseId ?? '…'}</Text>
      <Box marginTop={1} marginBottom={1}>
        <Text>{input.report.description}</Text>
      </Box>

      {productionFileCount !== null && (
        <Box marginBottom={1}>
          <Text dimColor>
            Scanned the scene: {productionFileCount} production files.
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        {[...beats.values()]
          .sort((a, b) => a.order - b.order)
          .map((b) => {
            const done = b.completed + b.failed;
            const stillRunning = done < b.total;
            const status = stillRunning ? 'running' : b.failed > 0 ? 'failed' : 'done';
            return (
              <Box key={b.label}>
                {status === 'running' ? (
                  <Text color="cyan">
                    <Spinner type="dots" />
                  </Text>
                ) : (
                  <Text color={status === 'failed' ? 'red' : 'green'}>{status === 'failed' ? '✕' : '✓'}</Text>
                )}
                <Text>
                  {' '}
                  {beatTextFor(b.label)}
                  {b.total > 1 ? ` (${done}/${b.total})` : ''}
                </Text>
              </Box>
            );
          })}
      </Box>

      {kase && <FinalResult kase={kase} />}
    </Box>
  );
}

/** Runs the investigation with a live Ink view and resolves to the finished Case, same contract callers of investigate() already expect. */
export function runInvestigateLive(input: InvestigateInput): Promise<Case> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <DetectiveApp
        input={input}
        onDone={(kase) => {
          // Let Ink flush the final frame before unmounting.
          setTimeout(() => {
            unmount();
            resolve(kase);
          }, 0);
        }}
      />
    );
  });
}
