/**
 * `buggo show <caseId>` human rendering - replays a finished, already-
 * persisted Case. Nothing here is live (the investigation already
 * happened), so it reuses the same CaseHeader/FinalResult building blocks
 * detective-live.tsx uses for its final frame, without any of the
 * beat/spinner machinery that only makes sense while a case is running.
 */
import { render, Box } from 'ink';
import type { Case } from '../../core/types.js';
import { CaseHeader, FinalResult } from './detective-ui.js';

function ShowApp({ kase }: { kase: Case }) {
  return (
    <Box flexDirection="column">
      <CaseHeader caseId={kase.caseId} description={kase.report.description} />
      <FinalResult kase={kase} />
    </Box>
  );
}

/** Renders once and unmounts immediately - a static replay, not a live view. */
export function renderShowView(kase: Case): void {
  const { unmount } = render(<ShowApp kase={kase} />);
  unmount();
}
