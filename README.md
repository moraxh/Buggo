# Buggo

**Give your coding agent a detective.**

Buggo investigates a reported bug and narrows a repository down to the files most worth inspecting — before you or a coding agent spend expensive reasoning searching the whole codebase.

```
$ buggo investigate "Users are logged out after refreshing"

CASE BG-0001

Users are logged out after refreshing

────────────────────────────────────────

SCANNING THE SCENE

68 production files

────────────────────────────────────────

SUSPECTS

01  lib/helpers/cookies.js
    Primary suspect
    94%
    symbols: standardBrowserEnv, write, read, remove, nonStandardBrowserEnv

02  sandbox/client.js
    Weak lead
    5%
    symbols: handleSuccess, handleFailure

────────────────────────────────────────

CASE LOCALIZED

5 files recommended for investigation.

Investigation  5 decisions · 1.8s · $0.0003
```

## What Buggo does

Given a bug report (description, and optionally an error message, stack trace, or failing test) and a local repository, Buggo:

1. Scans the repository's production source files and extracts structural signal (exports, function/method names) via AST parsing — never full file contents.
2. Classifies the likely subsystem (auth, database, api, async/concurrency, ...) as context.
3. Ranks every candidate file's likelihood of containing the bug's root cause, using [Jev](https://openrouter.ai) (TypeSafe AI's "System One" model) as a cheap decision layer. Large repositories are chunked so every candidate gets a real judgment — nothing is silently dropped by an arbitrary prefilter.
4. Ranks functions within the top-ranked files.
5. Returns the top suspects with the evidence behind each one, and never claims more confidence than the model actually expressed.

## What Buggo does NOT do (yet)

- **It does not find bugs you haven't reported.** `buggo hunt` (blind autonomous bug discovery across a whole repo) is reserved for a future version and is not implemented.
- **It does not reproduce, patch, or verify fixes.** v0.1 stops at localization — a ranked list of suspects — not a confirmed root cause. A suspect is never called a "culprit" until an actual defect has been reproduced, which v0.1 does not do.
- **It is not a coding agent.** Buggo is debugging infrastructure a coding agent (or a human) uses before spending expensive reasoning across an entire repository, not a replacement for one.

## Installation

```bash
cd Buggo
npm install
cp .env.example .env
# edit .env and set JEV_AI_KEY (an OpenRouter API key, not a TypeSafe key directly)
```

## CLI

```bash
buggo investigate "<description>" [--error <text>] [--stack <file|text>] [--test <name>] [--repo <path>] [--format human|json]
buggo cases
buggo show <caseId> [--format human|json]
```

- `--repo` defaults to the current directory.
- `--stack` accepts either a literal stack trace string or a path to a file containing one.
- Every investigation is persisted locally to `.buggo/cases/<caseId>.json` — no database, no cloud state, no accounts.

## JSON interface

`--format json` is a first-class interface, not an afterthought: stdout is valid JSON and nothing else (no spinners, no color, no prose), with a stable `schemaVersion`.

```bash
buggo investigate "checkout fails when cart is empty" --repo . --format json
```

```json
{
  "schemaVersion": "1",
  "caseId": "BG-0001",
  "status": "LOCALIZED",
  "report": { "description": "...", "errorMessage": null, "stackTrace": null, "failingTest": null },
  "repository": { "root": ".", "productionFileCount": 842 },
  "suspects": [
    { "rank": 1, "path": "src/auth/session.ts", "confidence": 0.87, "symbols": ["isExpired", "refreshSession"], "evidence": [...] }
  ],
  "costs": { "jevCalls": 7, "costUsd": 0.0004 },
  "timingsMs": { "total": 1800 },
  "recommendedNextActions": ["Inspect src/auth/session.ts first (rank 1, confidence 0.87)."],
  "error": null
}
```

## Using Buggo from an AI agent

Two options:

- **Programmatic API**: `import { investigate } from 'buggo'` — `investigate(input): Promise<Case>` is the canonical entry point; everything else (CLI, MCP server) calls it.
- **MCP server**: `npm run mcp` starts a stdio MCP server exposing a single tool, `buggo_investigate`, that takes `{ repository, description, errorMessage?, stackTrace?, failingTest? }` and returns the same structured result as `--format json`.

## Architecture

```
            BUGGO ENGINE (core/investigate.ts)
                      │
         ┌────────────┴────────────┐
         │                         │
   Human CLI                  Agent surfaces
   (detective rendering)      (--format json, MCP)
         │                         │
         └────────────┬────────────┘
                       │
                  same Case
```

- `core/` — domain model (`Case`, `BugReport`, `Suspect`, `Evidence`, ...) and the `investigate()` entry point. No terminal rendering, no JSON-shaping logic.
- `providers/jev/` — `DecisionEngine` abstraction over the Jev API, so the pipeline isn't hard-coupled to one provider/model/endpoint.
- `investigation/`, `repo/`, `jev/` — the validated V3 localization pipeline (chunked file ranking, AST-based symbol extraction, subsystem classification), ported unmodified from the research prototype.
- `interfaces/cli/`, `interfaces/json/`, `interfaces/mcp/` — presentation only, built on top of the same `Case`.
- `storage/` — local case persistence (`.buggo/cases/`).

## Privacy / local repository behavior

Buggo runs entirely against your local filesystem. The only network calls it makes are to OpenRouter's Decisions API, sending the bug report text plus AST-derived structural summaries (file names, exported symbol names, function names) — never full file contents, never the repository's git history or diffs.

## Jev / provider requirements

An OpenRouter API key (`JEV_AI_KEY` in `.env`) is required. Each investigation costs a small fraction of a cent (typically under $0.001 for a small-to-medium repository).

## Limitations

- v0.1 only localizes bugs you already know about (a report you provide) — it does not discover unknown bugs.
- Confidence scores come directly from Jev's `choice` primitive; they reflect the model's calibration, not a guarantee of correctness. A suspect remains a suspect until you or a coding agent confirms it.
- Very large repositories (1000+ candidate files) require more Jev calls (chunking); cost stays low, but latency scales with candidate count.

## Research

Buggo's localization pipeline is the direct output of a multi-phase research benchmark validating whether Jev can act as a cheap search-space-narrowing layer for debugging. Independent, non-overlapping-sample validation (Phase 3B, 100 fresh BugsJS bugs):

```
File Top-1: 80% [71-87%, 95% CI]
File Top-3: 90%
File Top-5: 91%
```

These numbers measure **file localization given a known bug report** — they do not measure autonomous bug discovery. Full methodology and all phase reports: see `../results/` and `../CLAUDE.md` in the parent repository.
