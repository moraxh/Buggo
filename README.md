<div align="center">

<img src="https://raw.githubusercontent.com/moraxh/Buggo/main/media/buggo.webp" alt="Buggo" width="180" />

# Buggo

**Every bug leaves clues.**

AI-native bug investigation for developers and coding agents.

[![npm](https://img.shields.io/npm/v/%40moraxh%2Fbuggo?logo=npm)](https://www.npmjs.com/package/@moraxh/buggo)
[![npm downloads](https://img.shields.io/npm/dm/%40moraxh%2Fbuggo?logo=npm&label=downloads)](https://www.npmjs.com/package/@moraxh/buggo)
[![GitHub stars](https://img.shields.io/github/stars/moraxh/Buggo?logo=github&style=flat)](https://github.com/moraxh/Buggo/stargazers)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)
[![pnpm](https://img.shields.io/badge/package%20manager-pnpm-f69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)](.github/workflows/ci.yml)

</div>

Give Buggo a bug report and a repository. It scans the codebase, ranks the files most likely to be involved, and hands you a short, evidenced suspect list instead of a blank cursor in a 900-file repo.

<div align="center">
<img src="https://raw.githubusercontent.com/moraxh/Buggo/main/media/demo.gif" alt="buggo investigate running against a real bug, live" width="700" />
</div>

<details>
<summary>Text transcript (same run, for screen readers or if the GIF didn't load)</summary>

```
$ buggo investigate "The weekly DICIS schedule scraper is silently dropping all Salamanca campus courses" --repo /path/to/DICIS-Tracker

CASE BG-0001

The weekly DICIS schedule scraper is silently dropping all Salamanca campus courses

Scanned the scene: 83 production files.

✓ Questioning the codebase: which subsystem does this look like?
✓ Canvassing the file list for anyone who matches the description. (4/4)
✓ Zooming in on the prime suspects, function by function.

SUSPECTS

01  scrapper/src/scrapers/dicis_salamanca.py
    Primary suspect · 97%
    symbols: is_valid_room, normalize_room, should_skip_subject, format_professor, extract_days

02  scrapper/src/utils.py
    Weak lead · 3%
    symbols: clean, safe_parse_time, normalize, generate_hash, subject_id

... (3 more suspects)

✓ CASE LOCALIZED

5 files recommended for investigation.

Investigation 6 decisions · 2.0s · $0.0004
```

</details>

Real output against a real bug report, on a real repository — not a mockup.

## Quick start

`buggo` (the bare name) is already taken by an unrelated package, so Buggo is published as [`@moraxh/buggo`](https://www.npmjs.com/package/@moraxh/buggo) — the installed command is still `buggo`:

```bash
npm install -g @moraxh/buggo
buggo config set-key <your-openrouter-key>   # get one at openrouter.ai/keys
buggo investigate "checkout fails when cart is empty" --repo /path/to/your/repo
```

`buggo config set-key` persists the key at `~/.config/buggo/config.json` (mode 600), so it works regardless of which directory you run `buggo` from afterward. A `JEV_AI_KEY` environment variable works too and takes priority.

### Running from source

For contributing, or to try a change before it's released — this repo uses [pnpm](https://pnpm.io):

```bash
git clone https://github.com/moraxh/Buggo.git
cd Buggo
pnpm install
cp .env.example .env
# edit .env and set JEV_AI_KEY
```

```bash
pnpm run investigate "checkout fails when cart is empty" --repo /path/to/your/repo
```

Or build once and link it as a global `buggo` command pointing at your checkout:

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
buggo investigate "<description>" [--error <text>] [--stack <file|text>] [--test <name>] [--repo <path>]
                  [--diff <ref>] [--recent-changes <n>] [--exclude <file> ...] [--format human|json]
buggo cases [--status <status>] [--since <date>] [--search <text>] [--limit <n>]
buggo show <caseId> [--format human|json]
buggo hunt [--repo <path>] [--format human|json]
buggo init [--repo <path>]
```

Extra context that goes straight into ranking as observed evidence, not a guess:

- `--diff <ref>` — files touched by a commit or range (e.g. `HEAD~3`, `main..feature`) you already suspect.
- `--recent-changes <n>` — files touched across the last `n` commits, for "this broke recently and I don't know why yet."
- `--exclude <file>` (repeatable) — drop a file from the candidate pool before ranking, to re-run cheaper after ruling out a previous top suspect.

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
import { investigate } from '@moraxh/buggo';

const result = await investigate({
  repoRoot: '.',
  report: { description: 'checkout fails when cart is empty' },
});
```

### MCP server

One command connects Buggo to every supported agent installed locally:

```bash
buggo init
```

This does two things:

1. **Registers `buggo-mcp` with whichever of Claude Code, Cursor, Windsurf, Cline, or Zed are installed** — detected automatically, each one's own config format handled correctly (merged into existing config, never overwritten).
2. **Writes an explicit usage instruction to your project's `CLAUDE.md`/`AGENTS.md`** (whichever already exists; creates `AGENTS.md` if neither does). An agent won't reliably reach for a newly-connected MCP tool on its own — it defaults to grep/read unless told otherwise — so this is what actually gets `buggo_investigate`/`buggo_hunt` used instead of skipped.

Idempotent — safe to run again, it won't duplicate registrations or instructions that are already there.

#### Claude Code

Covered by `buggo init` above, no manual steps needed. If you'd rather register it yourself (or `buggo init` isn't detecting your install), the one-liner is:

```bash
claude mcp add buggo -- buggo-mcp
```

You still want the usage instruction in `CLAUDE.md`/`AGENTS.md` (see step 2 above) so Claude actually reaches for it instead of defaulting to grep/read.

Under the hood, `buggo-mcp` (installed alongside `buggo`) starts a stdio MCP server exposing two tools:

- `buggo_investigate`, taking `{ repository, description, errorMessage?, stackTrace?, failingTest?, hintedFiles? }` and returning the same structured result as `investigate --format json`.
- `buggo_hunt`, taking only `{ repository }` (no bug report needed) and returning the same structured result as `hunt --format json`.

Both share one cap of 20 calls per server session by default (`BUGGO_MCP_MAX_INVESTIGATIONS`).

#### Codex CLI

`buggo init` doesn't detect Codex CLI yet, so wire it up by hand: add the server to `~/.codex/config.toml`, then tell Codex to actually use it (Codex, like the other agents, defaults to grep/read unless an `AGENTS.md` says otherwise).

```toml
[mcp_servers.buggo]
command = "buggo-mcp"
args = []
```

```markdown
## Bug fixes

- When investigating a reported bug, use the `buggo` MCP tool (`buggo_investigate`) to help locate the files most likely responsible before diving into manual search. Treat its output as ranked suspects to verify, not a confirmed diagnosis.
- When exploring an unfamiliar repository with no known bug report, use `buggo_hunt` instead - it needs no bug description and returns a prioritized list of files worth a closer look.
```

If `buggo-mcp` isn't resolvable from Codex's PATH (e.g. it was installed under nvm and Codex doesn't inherit your shell's PATH), point `command` at the absolute path instead, e.g. `~/.nvm/versions/node/<version>/bin/buggo-mcp`.

## `buggo hunt` (v0, experimental)

`investigate` needs a bug report. `hunt` doesn't — it triages a repository blind, with no bug description at all, ranking files by how likely they are to hide an undiscovered bug:

```bash
buggo hunt --repo /path/to/your/repo
```

It works in two stages (module-level, then file-level within the riskiest modules), using directory structure and a git-derived risk signal — how often a file has historically needed a bug-fix commit, not just how often it changed — as real evidence, instead of guessing from file naming alone.

```
HUNT BH-0001

This is a blind structural risk estimate, not a discovered bug. ...

TOP SUSPECTS (blind risk triage, no bug report)

01  lib/router/layer.js
    risk 74% · touched in 22 of the last 500 commits, 9 of those commit messages look like bug fixes
```

**Validated before shipping, not just built:** on 100 real-world BugsJS bugs, the file that actually contained the bug fell in the riskiest 10% of the repo by this signal alone 63% of the time (vs. ~10% expected by chance). Showing the signal to Jev (instead of a naive guess from file names) raised blind file-level Top-5 triage from 10% to 60% on a 30-bug multi-project sample (p=0.0007).

**Known limitation:** this signal favors large, frequently-touched "core" files simply because they get touched often for unrelated reasons (features, refactors, docs) — in a repo shaped like "many small peripheral files around one shared core" (e.g. a linter with hundreds of individual rule files), it can under-rank a bug hiding in a rarely-touched peripheral file. Two correction attempts (normalizing by file size, requiring a minimum touch count) were tried and measured to make things worse or do nothing — this is a real, disclosed trade-off, not fixed yet.

`hunt` stops at file-level triage — a starting point for you or a coding agent to actually investigate, reproduce, and fix, the same as `investigate`'s suspects. It does not discover, reproduce, or confirm a bug on its own.

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

- `investigate` localizes bugs you already know about; `hunt`'s blind triage is v0 and has a known bias toward frequently-touched "core" files (see above) — neither discovers, reproduces, or confirms a bug on its own.
- Rankings are hypotheses, not proof. Confidence scores reflect Jev's calibration, not a correctness guarantee.
- Function-level ranking (which function inside a suspect file) is meaningfully weaker than file-level ranking.
- Buggo does not reproduce, patch, or verify fixes. That step still belongs to you or a coding agent.

In short: Buggo is a detective, not a clairvoyant.

## Security

Buggo runs entirely against your local filesystem. The only network calls are to OpenRouter's Decisions API, sending the bug report text plus AST-derived structural summaries — never full file contents, never a diff. `hunt` additionally sends each file's aggregate commit-touch and fix-commit counts (a count, not commit messages or diffs) as part of its blind risk signal.

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

Early (v0.2). The localization pipeline (`investigate`, `cases`, `show`, JSON output, MCP server) is implemented and benchmarked. `buggo hunt` (blind bug triage) is implemented and validated as v0, with a known bias disclosed above. Repair/verification is not implemented.

## License

[Apache License 2.0](LICENSE).

---

Every bug leaves clues.
