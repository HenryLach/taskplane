## Plan Review: Step 1: Remove TMUX helper functions from execution.ts

### Verdict: APPROVE

### Summary
The Step 1 plan is outcome-oriented and should achieve the stated goal of removing TMUX helper functions from `extensions/taskplane/execution.ts`. It also correctly calls out cleanup of dependent imports/call paths rather than only deleting function bodies. Given the broader task structure, this is sufficient to proceed.

### Issues Found
1. **[Severity: minor]** — The plan implies fallback-branch cleanup, but there are also direct TMUX helper callsites in `execution.ts` (e.g., abort-signal session kill and poll liveness paths) that should be explicitly replaced with V2 equivalents rather than dropped. Suggested fix: explicitly include “replace direct helper usages in `execution.ts` with V2-only logic (`killV2LaneAgents`, snapshot/registry liveness)”.

### Missing Items
- None blocking for Step 1.

### Suggestions
- Explicitly name `runTmuxCommandAsync()` in the removal list (currently covered by “other TMUX-only helper functions”) to reduce chance of leftover functional TMUX code.
- After Step 1 edits, run a focused grep on `execution.ts` to confirm no functional `tmux` calls remain before moving to Step 2.
