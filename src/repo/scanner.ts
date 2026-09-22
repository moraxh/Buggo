import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { config } from '../config.js';
import { extractSymbols, type FileSymbols } from './ast.js';

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.next', 'vendor',
  '.git', '.github', 'tmp', 'examples', 'docs', '.changeset',
]);

const CODE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);

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
};

function isTestFile(relPath: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(relPath) || /\/test\//.test(relPath) || /^test\//.test(relPath);
}

function walk(dir: string, root: string, out: FileEntry[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.') continue;
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
      if (!CODE_EXTENSIONS.has(ext)) continue;
      if (/\.lock$/.test(entry) || entry === 'package-lock.json') continue;
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

  return { root, packageJson, allFiles, fileSymbols };
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
