<div align="center">

# Buggo

**Every bug leaves clues.**

AI-native bug investigation for developers and coding agents.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/package%20manager-pnpm-f69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)](.github/workflows/ci.yml)

</div>

Give Buggo a bug report and a repository. It scans the codebase, ranks the files most likely to be involved, and hands you a short, evidenced suspect list instead of a blank cursor in a 900-file repo.

```
$ buggo investigate "MCP server does not enforce the investigation cap correctly"

CASE BG-0003

MCP server does not enforce the investigation cap correctly

Scanned the scene: 31 production files.

✓ Questioning the codebase: which subsystem does this look like?
✓ Canvassing the file list for anyone who matches the description.
✓ Zooming in on the prime suspects, function by function.

SUSPECTS

01  src/interfaces/mcp/server.ts
    Primary suspect · 96%
    symbols: resolveMaxInvestigations, createBuggoMcpServer, runBuggoMcpServer

02  src/core/investigate.ts
    Weak lead · 3%
    symbols: investigate, classifyFailureStage, toSuspects

... (3 more suspects)

✓ CASE LOCALIZED

5 files recommended for investigation.

Investigation 3 decisions · 1.3s · $0.0002
```

This is real output from running `buggo investigate` against this repository (trimmed to the top 2 suspects here), not a mockup.

## Quick start

Buggo isn't on the npm registry yet (`buggo` is already taken by an unrelated package) — run it from source with [pnpm](https://pnpm.io):

```bash
git clone https://github.com/moraxh/Buggo.git
cd Buggo
pnpm install
cp .env.example .env
# edit .env and set JEV_AI_KEY — an OpenRouter API key, get one at openrouter.ai/keys
```

```bash
pnpm run investigate "checkout fails when cart is empty" --repo /path/to/your/repo
```

Or build once and use `buggo` as a normal command:

```bash
pnpm run build
npm link   # registers dist/cli/buggo.js as a global `buggo` command
buggo investigate "checkout fails when cart is empty"
```

## What just happened?

Buggo opened a case, scanned the repository's production source files, and ranked the ones most likely to contain the reported behavior, using structural signal (exported symbols, function names, file paths) rather than reading full file contents.

It did not prove that `server.ts` committed the crime. It has questions.

```
localization ≠ confirmed root cause
```

A suspect stays a suspect until you, or a coding agent, actually reproduces the bug in that file. Buggo narrows the search — it doesn't close the case for you.

## Why Buggo?

Coding agents are good at reasoning once they know where to look. Finding that "where" in a large, unfamiliar repository burns context, tool calls, and time before any real debugging starts.

Buggo is meant to run first and cheap: turn a bug report into a short, ranked list of files worth investigating, so the expensive reasoning (yours or an agent's) gets spent in the right place.

## For humans and agents

```bash
buggo investigate "<description>" [--error <text>] [--stack <file|text>] [--test <name>] [--repo <path>] [--format human|json]
buggo cases [--status <status>] [--since <date>] [--search <text>] [--limit <n>]
buggo show <caseId> [--format human|json]
```

`--format json` is a first-class interface, not an afterthought: stdout is valid JSON and nothing else (no spinners, no color), with a stable `schemaVersion`.

```json
{
  "schemaVersion": "1",
  "caseId": "BG-0003",
  "status": "LOCALIZED",
  "suspects": [
    { "rank": 1, "path": "src/interfaces/mcp/server.ts", "confidence": 0.96, "symbols": ["resolveMaxInvestigations", "createBuggoMcpServer"] }
  ],
  "costs": { "jevCalls": 3, "costUsd": 0.0002 },
  "recommendedNextActions": ["Inspect src/interfaces/mcp/server.ts first (rank 1, confidence 0.96)."]
}
```

Humans get suspects. Agents get JSON. Everybody reads fewer files.

For programmatic use inside a larger tool, `investigate()` is the same entry point both the CLI and the MCP server call:

```ts
import { investigate } from 'buggo';

const result = await investigate({
  repoRoot: '.',
  report: { description: 'checkout fails when cart is empty' },
});
```

### MCP server

`pnpm run mcp` starts a stdio MCP server exposing one tool, `buggo_investigate`, taking `{ repository, description, errorMessage?, stackTrace?, failingTest? }` and returning the same structured result as `--format json`. Capped at 20 investigations per server session by default (`BUGGO_MCP_MAX_INVESTIGATIONS`).

## How it works

```
bug report
    ↓
repository scan (AST-derived symbols, never full file contents)
    ↓
subsystem classification
    ↓
chunked file ranking
    ↓
function ranking within top files
    ↓
ranked suspects + evidence
```

Ranking is done by [Jev](https://openrouter.ai) (TypeSafe AI's "System One" model, reached through OpenRouter's Decisions API) — a cheap decision layer, not a chat model, asked to pick or score candidates rather than generate prose.

### Chunking

Large repositories don't get a heuristic pre-filter that quietly drops most of the codebase before judgment happens. Every candidate file is placed into a deterministic chunk and actually evaluated; a finalist round re-ranks the survivors.

Throwing away the culprit before the investigation begins is generally considered poor detective work.

## Does this actually work?

We wondered too. Buggo's file-ranking pipeline was benchmarked against 100 real-world BugsJS bugs, none of which were used while building the pipeline:

| Metric | Result |
|---|---|
| File Top-1 | 80% [71–87%, 95% CI] |
| File Top-3 | 90% |
| File Top-5 | 91% |
| File Top-10 | 96% |

Given a known bug report, can Buggo rank the file containing the eventual fix highly? That's what this measures. It does **not** measure autonomous discovery of unknown bugs, root-cause proof, or repair — Buggo doesn't do any of those yet.

One surprisingly strong clue: file paths alone (no AST symbols, no subsystem classification) reached 76% Top-1 on the same 100 bugs. The structural evidence Buggo adds on top gives a real but modest improvement, concentrated in small-to-medium repositories with several similarly plausible files.

## Limitations

- Buggo localizes bugs you already know about. It does not discover unknown bugs autonomously — `buggo hunt` is planned, not implemented.
- Rankings are hypotheses, not proof. Confidence scores reflect Jev's calibration, not a correctness guarantee.
- Function-level ranking (which function inside a suspect file) is meaningfully weaker than file-level ranking.
- Buggo does not reproduce, patch, or verify fixes. That step still belongs to you or a coding agent.

In short: Buggo is a detective, not a clairvoyant.

## Security

Buggo runs entirely against your local filesystem. The only network calls are to OpenRouter's Decisions API, sending the bug report text plus AST-derived structural summaries — never full file contents, never git history or diffs.

Dependencies are hardened via `pnpm-workspace.yaml`:

- **`minimumReleaseAge: 1440`** — refuses packages published in the last 24 hours, closing the window used by compromised-package attacks.
- **`onlyBuiltDependencies`** — only an explicit allowlist (the `tree-sitter*` native addons) may run install scripts; everything else has them silently skipped.
- **Exact versions, no ranges** — every dependency is pinned; `pnpm update` is always explicit.
- **`pnpm-lock.yaml` is committed**, CI installs with `--frozen-lockfile`, and `pnpm audit --audit-level=high` runs on every push.

## Configuration

- `JEV_AI_KEY` (`.env` or environment) — an OpenRouter API key. Required.
- `buggo config set-key <key>` / `buggo config show` — persist a key at `~/.config/buggo/config.json` (mode 600) instead of using `.env`.
- `BUGGO_MCP_MAX_INVESTIGATIONS` — cap on investigations per MCP server session (default 20).

Each investigation typically costs under $0.001 in Jev calls.

## Development

```bash
pnpm install
pnpm run build       # tsc
pnpm run typecheck   # tsc --noEmit
pnpm test            # node --test
```

## Project status

Early (v0.1). The localization pipeline (`investigate`, `cases`, `show`, JSON output, MCP server) is implemented and benchmarked. `buggo hunt` (blind bug discovery) and repair/verification are not.

## License

[Apache License 2.0](LICENSE).

---

Every bug leaves clues.
