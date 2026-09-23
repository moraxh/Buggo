/**
 * `buggo hunt` entry point: blind risk triage, no bug report needed.
 * Mirrors investigate-command.ts's shape (parse args, call the core API,
 * print JSON or a human view) but for a genuinely different pipeline.
 */
import { hunt } from '../../core/hunt.js';
import { parseFormatFlag, ArgsError } from './args.js';

function parseRepoRoot(argv: string[]): string {
  const idx = argv.indexOf('--repo');
  if (idx < 0) return process.cwd();
  const value = argv[idx + 1];
  if (value === undefined) throw new ArgsError('--repo requires a value');
  return value;
}

function printHuman(result: Awaited<ReturnType<typeof hunt>>): void {
  console.log(`\nHUNT ${result.huntId}`);
  console.log(`\n${result.disclaimer}\n`);

  if (result.status === 'FAILED') {
    console.log(`FAILED: ${result.error?.message ?? 'unknown error'}`);
    return;
  }

  console.log(`Scanned ${result.repository.productionFileCount} production files.\n`);
  console.log('TOP SUSPECTS (blind risk triage, no bug report)\n');
  for (const s of result.suspects) {
    const pct = (s.probability * 100).toFixed(0);
    console.log(`${String(s.rank).padStart(2, '0')}  ${s.path}`);
    console.log(`    risk ${pct}%${s.riskSignal ? ` · ${s.riskSignal}` : ' · no git history signal'}`);
  }
  console.log(`\nTriage: ${result.costs.jevCalls} decisions · $${result.costs.costUsd.toFixed(4)}`);
}

export async function runHuntCommand(argv: string[]): Promise<number> {
  let repoRoot: string;
  let format: 'human' | 'json';
  try {
    repoRoot = parseRepoRoot(argv);
    format = parseFormatFlag(argv);
  } catch (err) {
    if (err instanceof ArgsError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  const result = await hunt({ repoRoot });

  if (format === 'json') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printHuman(result);
  }
  return result.status === 'FAILED' ? 1 : 0;
}
