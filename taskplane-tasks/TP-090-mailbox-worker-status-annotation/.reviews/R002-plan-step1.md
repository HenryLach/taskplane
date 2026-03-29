## Plan Review: Step 1 — Steering-pending flag and STATUS.md injection

### Verdict: APPROVE

### Summary
This revised Step 1 plan addresses all blocking issues from R001 and is now implementation-ready.

### What improved vs R001
- **Path contract is explicit:** add `--steering-pending-path` and thread it from task-runner to rpc-wrapper.
- **Worker scoping is explicit:** only worker sessions receive the flag path.
- **Wire format is explicit:** JSONL records with `ts`, `content`, and `id` for deterministic parsing.
- **Loop placement is explicit:** annotation check runs after `runWorker()` and **before** the `state.phase === "error"` early return.
- **Table safety is explicit:** sanitize steering content (newline collapse + `|` escaping) before STATUS.md row injection.

### Non-blocking implementation notes
- When consuming JSONL, prefer fail-soft behavior for malformed lines (skip/log instead of crashing the loop).
- Keep append + consume semantics resilient to multiple messages in one iteration (annotate all lines, then remove flag file).

Plan is sufficiently precise to proceed with implementation.