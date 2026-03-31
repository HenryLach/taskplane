# Runtime V2 Assumption Lab

Standalone validation harness for the highest-risk Runtime V2 architectural assumptions.

## Purpose

Validate, outside the current TMUX- and `/task`-based production path, that:

- direct child spawning of Pi agents is viable on Windows
- a direct host can capture RPC events and authoritative `contextUsage`
- mailbox steering works without TMUX
- explicit packet paths work when `cwd != packet home`
- remaining open assumptions are clearly documented before the refactor proceeds

## Run

```bash
node scripts/runtime-v2-lab/run-lab.mjs
```

## Output

- Summary JSON: `scripts/runtime-v2-lab/out/latest-summary.json`
- Human report: `docs/specifications/framework/taskplane-runtime-v2/assumption-lab-report.md`

## Notes

- The lab assumes **session-attached but resumable** as the Runtime V2 baseline.
- The harness intentionally avoids TMUX and the current `/task` production path.
- Results are designed to inform the Runtime V2 build order (`TP-102+`).
