import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRepo, listCandidateFiles } from '../src/repo/scanner.js';
import { extractSymbols } from '../src/repo/ast.js';

function withTempRepo(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'buggo-config-scan-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const full = join(root, relPath);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('scanRepo includes YAML/TOML/Dockerfile config files as candidates', () => {
  withTempRepo(
    {
      'pnpm-workspace.yaml': 'onlyBuiltDependencies:\n  - sharp\n',
      'docker-compose.yaml': 'services:\n  web:\n    image: node\n',
      'pyproject.toml': '[tool.poetry]\nname = "x"\n',
      Dockerfile: 'FROM node:22\nRUN npm install\n',
      'src/index.js': 'export function main() {}\n',
    },
    (root) => {
      const scan = scanRepo(root);
      const candidates = listCandidateFiles(scan);
      assert.ok(candidates.includes('pnpm-workspace.yaml'));
      assert.ok(candidates.includes('docker-compose.yaml'));
      assert.ok(candidates.includes('pyproject.toml'));
      assert.ok(candidates.includes('Dockerfile'));
      assert.ok(candidates.includes('src/index.js'));
    }
  );
});

test('scanRepo excludes generated lockfiles even though they end in .yaml/.json', () => {
  withTempRepo(
    {
      'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
      'package-lock.json': '{}',
      'src/index.js': 'export function main() {}\n',
    },
    (root) => {
      const scan = scanRepo(root);
      const candidates = listCandidateFiles(scan);
      assert.ok(!candidates.includes('pnpm-lock.yaml'));
      assert.ok(!candidates.includes('package-lock.json'));
    }
  );
});

test('scanRepo does not pick up ordinary dotfiles (e.g. .env) it has no reason to index', () => {
  withTempRepo(
    {
      '.env': 'SECRET=1\n',
      '.npmrc': 'engine-strict=true\n',
      'src/index.js': 'export function main() {}\n',
    },
    (root) => {
      const scan = scanRepo(root);
      const candidates = listCandidateFiles(scan);
      assert.ok(!candidates.includes('.env'), '.env must never become a candidate');
      assert.ok(candidates.includes('.npmrc'), '.npmrc is an explicitly allow-listed config file');
    }
  );
});

test('extractSymbols (YAML): top-level keys are reported as exports', () => {
  const code = `
onlyBuiltDependencies:
  - sharp
minimumReleaseAge: 1440
overrides:
  sharp: 0.34.4
`;
  const sym = extractSymbols(code, 'pnpm-workspace.yaml')!;
  assert.ok(sym.exports.includes('onlyBuiltDependencies'));
  assert.ok(sym.exports.includes('minimumReleaseAge'));
  assert.ok(sym.exports.includes('overrides'));
  // nested keys (indented) are not top-level and must not leak in
  assert.ok(!sym.exports.includes('sharp'));
});

test('extractSymbols (TOML): sections and top-level keys are reported as exports', () => {
  const code = `
[tool.poetry]
name = "x"

[build-system]
requires = ["poetry-core"]
`;
  const sym = extractSymbols(code, 'pyproject.toml')!;
  assert.ok(sym.exports.includes('tool.poetry'));
  assert.ok(sym.exports.includes('build-system'));
});

test('extractSymbols (Dockerfile): instructions are reported as exports', () => {
  const code = `
FROM node:22
RUN npm install
COPY . .
CMD ["node", "index.js"]
`;
  const sym = extractSymbols(code, 'Dockerfile')!;
  assert.ok(sym.exports.includes('FROM'));
  assert.ok(sym.exports.includes('RUN'));
  assert.ok(sym.exports.includes('COPY'));
  assert.ok(sym.exports.includes('CMD'));
});
