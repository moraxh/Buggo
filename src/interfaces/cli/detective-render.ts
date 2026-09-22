/**
 * Human CLI rendering. Pure presentation over the domain Case - no
 * localization logic lives here, and nothing here is read back by the
 * agent/JSON interface. Detective terminology is used only where it maps
 * to real state (spec section 16): a suspect is never called a "culprit"
 * here, because v0.1 never confirms a reproduced defect.
 */
import type { Case, Suspect } from '../../core/types.js';

const DIVIDER = '─'.repeat(40);
const supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

function dim(s: string): string {
  return supportsColor ? `\x1b[2m${s}\x1b[0m` : s;
}
function bold(s: string): string {
  return supportsColor ? `\x1b[1m${s}\x1b[0m` : s;
}

function suspectLabel(confidence: number, rank: number): string {
  if (rank === 1 && confidence >= 0.5) return 'Primary suspect';
  if (confidence >= 0.1) return 'Person of interest';
  return 'Weak lead';
}

function renderSuspect(s: Suspect): string[] {
  const lines: string[] = [];
  const num = String(s.rank).padStart(2, '0');
  lines.push(`${num}  ${bold(s.path)}`);
  lines.push(`    ${suspectLabel(s.confidence, s.rank)}`);
  lines.push(`    ${(s.confidence * 100).toFixed(0)}%`);
  const symbolEvidence = s.evidence.find((e) => e.kind === 'symbol_match');
  if (symbolEvidence && symbolEvidence.kind === 'symbol_match' && symbolEvidence.symbols.length) {
    lines.push(dim(`    symbols: ${symbolEvidence.symbols.slice(0, 5).join(', ')}`));
  }
  return lines;
}

export function renderCaseHeader(caseId: string, description: string): string {
  return [`CASE ${caseId}`, '', description].join('\n');
}

export function renderScanning(productionFileCount: number): string {
  return [DIVIDER, '', 'SCANNING THE SCENE', '', `${productionFileCount} production files`, ''].join('\n');
}

export function renderCaseResult(kase: Case): string {
  const out: string[] = [];
  out.push(renderCaseHeader(kase.caseId, kase.report.description));
  out.push('');

  if (kase.status === 'FAILED') {
    out.push(DIVIDER);
    out.push('');
    out.push('INVESTIGATION INTERRUPTED');
    out.push('');
    out.push(kase.error?.message ?? 'Unknown failure.');
    return out.join('\n');
  }

  out.push(renderScanning(kase.repository.productionFileCount));

  const suspects = kase.localization?.suspects ?? [];
  if (suspects.length === 0) {
    out.push(DIVIDER);
    out.push('');
    out.push('CASE INCONCLUSIVE');
    out.push('');
    out.push('Buggo could not identify a sufficiently strong suspect.');
    return out.join('\n');
  }

  out.push(DIVIDER);
  out.push('');
  out.push('SUSPECTS');
  out.push('');
  for (const s of suspects) {
    out.push(...renderSuspect(s));
    out.push('');
  }

  out.push(DIVIDER);
  out.push('');
  out.push(kase.status === 'PARTIAL' ? 'CASE PARTIALLY LOCALIZED' : 'CASE LOCALIZED');
  out.push('');
  out.push(`${suspects.length} files recommended for investigation.`);
  if (kase.status === 'PARTIAL' && kase.error) {
    out.push('');
    out.push(dim(kase.error.message));
  }
  out.push('');
  out.push(
    dim(
      `Investigation  ${kase.costs.jevCalls} decisions · ${(kase.timingsMs.total / 1000).toFixed(1)}s · $${kase.costs.costUsd.toFixed(4)}`
    )
  );

  return out.join('\n');
}
