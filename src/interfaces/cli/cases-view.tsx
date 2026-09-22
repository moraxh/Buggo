/**
 * `buggo cases` human rendering - the case list ("open case files"), one
 * line per case, colored by status. Static (reads persisted cases, nothing
 * live to animate).
 */
import { render, Box, Text } from 'ink';
import type { CaseSummary } from '../../storage/case-store.js';
import { statusColor } from './detective-ui.js';

function CaseRow({ c }: { c: CaseSummary }) {
  const color = statusColor(c.status);
  return (
    <Box>
      <Box width={9} flexShrink={0}>
        <Text bold color="cyan">
          {c.caseId}
        </Text>
      </Box>
      <Box width={11} flexShrink={0}>
        <Text color={color} bold>
          {c.status}
        </Text>
      </Box>
      <Box flexShrink={1}>
        <Text wrap="truncate-end">{c.description.slice(0, 60)}</Text>
      </Box>
      {c.topSuspect && (
        <Box flexShrink={0} marginLeft={1}>
          <Text dimColor>→ {c.topSuspect}</Text>
        </Box>
      )}
    </Box>
  );
}

function CasesApp({ cases, note }: { cases: CaseSummary[]; note: string | null }) {
  if (cases.length === 0) {
    return (
      <Box>
        <Text dimColor>{note}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>OPEN CASE FILES</Text>
      <Box marginTop={1} flexDirection="column">
        {cases.map((c) => (
          <CaseRow key={c.caseId} c={c} />
        ))}
      </Box>
      {note && (
        <Box marginTop={1}>
          <Text dimColor>{note}</Text>
        </Box>
      )}
    </Box>
  );
}

/** `note` is either the empty-state message or the "(showing N most recent)" footer - same text runCasesCommand already computed, just rendered here instead of console.log'd. */
export function renderCasesView(cases: CaseSummary[], note: string | null): void {
  const { unmount } = render(<CasesApp cases={cases} note={note} />);
  unmount();
}
