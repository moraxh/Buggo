import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { config } from '../config.js';
import { extractSymbols, type FileSymbols } from './ast.js';
import { getGitRecency, type GitRecency } from './git-signal.js';

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.next', 'vendor',
  '.git', '.github', 'tmp', 'examples', 'docs', '.changeset',
  '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache', 'site-packages',
]);

// Frontend framework components (.astro/.vue/.svelte) embed a real JS/TS
// script block (frontmatter fence, <script>, or <script setup>) that
// ast.ts's extractSymbols knows how to isolate and parse - they get real
// symbols, not just a filename, same as .js/.ts.
const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.py',
  '.astro', '.vue', '.svelte', '.mdx',
]);

// Config/infra files (build tooling, CI, deploy manifests) and frontend
// markup/style files (no executable symbols, but a UI bug report often
// points straight at one of these): no real AST, but ast.ts's
// isConfigFile/extractConfigSymbols still extracts a lightweight summary
// (top-level keys, selectors, tags) for the extraction side. Kept narrow on
// purpose - ordinary data/fixture files would flood the candidate list
// otherwise.
const CONFIG_EXTENSIONS = new Set([
  '.yaml', '.yml', '.toml',
  '.css', '.scss', '.less', '.html', '.json',
]);
const CONFIG_FILENAMES = new Set([
  'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.dockerignore', '.npmrc', '.nvmrc',
]);

function isConfigCandidate(entryName: string, ext: string): boolean {
  if (CONFIG_EXTENSIONS.has(ext)) return true;
  const lower = entryName.toLowerCase();
  if (CONFIG_FILENAMES.has(lower)) return true;
  return lower.startsWith('dockerfile.');
}

export type FileEntry = {
  relPath: string;
  size: number;
  isTest: boolean;
};

export type RepoScan = {
  root: string;
  packageJson: any | null;
  allFiles: FileEntry[];
  fileSymbols: Map<string, FileSymbols>;
  /** relPath -> days since last git commit touching it; empty map when the repo isn't git or git isn't available. */
  gitRecency: GitRecency;
};

function isTestFile(relPath: string): boolean {
  return (
    /\.(test|spec)\.[jt]sx?$/.test(relPath) ||
    /(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(relPath) ||
    /\/test\//.test(relPath) ||
    /^test\//.test(relPath) ||
    /(^|\/)tests\//.test(relPath)
  );
}

function walk(dir: string, root: string, out: FileEntry[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const isDotfile = entry.startsWith('.') && entry !== '.';
    if (isDotfile && !CONFIG_FILENAMES.has(entry.toLowerCase())) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (IGNORE_DIRS.has(entry)) continue;
      walk(full, root, out);
    } else if (stat.isFile()) {
      const ext = extname(entry);
      const isCode = CODE_EXTENSIONS.has(ext);
      const isConfig = isConfigCandidate(entry, ext);
      if (!isCode && !isConfig) continue;
      if (/\.lock$/.test(entry) || entry === 'package-lock.json' || entry === 'pnpm-lock.yaml') continue;
      const relPath = relative(root, full);
      out.push({ relPath, size: stat.size, isTest: isTestFile(relPath) });
    }
  }
}

export function scanRepo(root: string): RepoScan {
  const allFiles: FileEntry[] = [];
  walk(root, root, allFiles);

  let packageJson: any | null = null;
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      packageJson = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      packageJson = null;
    }
  }

  const fileSymbols = new Map<string, FileSymbols>();
  for (const f of allFiles) {
    if (f.isTest) continue; // symbols only needed for production candidates
    const full = join(root, f.relPath);
    let content: string;
    try {
      content = readFileSync(full, 'utf-8');
    } catch {
      continue;
    }
    if (content.length > 200_000) continue; // skip pathologically large generated files
    const symbols = extractSymbols(content, f.relPath);
    if (symbols) fileSymbols.set(f.relPath, symbols);
  }

  const gitRecency = getGitRecency(root);

  return { root, packageJson, allFiles, fileSymbols, gitRecency };
}

/** Build a compact, size-bounded structural summary of the repo for Jev's state. */
export function buildStructuralSummary(scan: RepoScan): string {
  const lines: string[] = [];

  if (scan.packageJson) {
    lines.push(`package: ${scan.packageJson.name || 'unknown'}`);
    if (scan.packageJson.description) lines.push(`description: ${scan.packageJson.description}`);
    const deps = Object.keys(scan.packageJson.dependencies || {});
    if (deps.length) lines.push(`dependencies: ${deps.slice(0, 20).join(', ')}`);
  }

  const prodFiles = scan.allFiles.filter((f) => !f.isTest);
  lines.push('');
  lines.push(`Directory structure (${prodFiles.length} production source files):`);
  for (const f of prodFiles.slice(0, config.maxCandidateFiles * 3)) {
    lines.push(`  ${f.relPath}`);
  }

  let summary = lines.join('\n');
  if (summary.length > config.maxTotalStructuralChars) {
    summary = summary.slice(0, config.maxTotalStructuralChars) + '\n... (truncated)';
  }
  return summary;
}

export function listCandidateFiles(scan: RepoScan): string[] {
  return scan.allFiles.filter((f) => !f.isTest).map((f) => f.relPath);
}
