## Code Review: Step 1: Cluster A — Defensive tests + helper hardening

### Verdict: REVISE

### Summary
Most of Step 1 is now in good shape: the R002 follow-ups are present (including `type='test'` runtime refusal coverage), and the targeted Cluster A test set passes cleanly. However, `isStepMarkedComplete` still has a fence-closing bug that can falsely treat content inside a fenced block as outside the fence, reintroducing the same kind of false-positive refusal this hardening is meant to prevent. No project-configured typecheck/lint/format-check commands were discoverable (`.pi/taskplane-config.json` / legacy task-runner config absent; root `package.json` has no relevant scripts), so quality checks were skipped.

### Issues Found
1. **[extensions/taskplane/agent-bridge-extension.ts:183-206] [important]** — Fence detection closes on any line that *starts* with backticks/tildes, even when trailing non-whitespace text is present. Example: inside an open ```` fence, a line like ````javascript is treated as a closing fence, so a later `**Status:** ✅ Complete` in the same code block is incorrectly matched as real step status. This can still trigger false REFUSED responses. **Fix:** distinguish opener vs closer rules: allow opener with optional info string, but when `fenceOpener !== null`, only close on a matching delimiter line with optional whitespace only (same char, length >= opener length, no extra text). Add a regression case for this scenario.

### Pattern Violations
- None beyond the fence-closing logic bug above.

### Test Gaps
- Missing regression test for a would-be closer line containing trailing text (e.g., ````javascript / ~~~foo) inside an open fence; this currently passes through as a false close.

### Suggestions
- Keep the new mixed-delimiter and `type='test'` runtime checks — those were good additions and materially improved coverage.
