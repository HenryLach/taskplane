## Plan Review: Step 4: Expand audit script scope

### Verdict: REVISE

### Summary
The Step 4 checklist captures the high-level intent (expand the audit and adjust the guard test), but it currently misses a key blocking outcome: ensuring strict functional detection still works once JS/CJS package files are included. As written, the plan can be completed while still missing real functional TMUX execution patterns in the newly scanned areas.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly include updating strict functional-pattern detection for non-TS package files. In the current audit implementation, `FUNCTIONAL_PATTERNS` in `scripts/tmux-reference-audit.mjs:43-56` misses command-string `execFileSync(...)` usage such as `dashboard/server.cjs:196` (`execFileSync('tmux list-sessions ...', { shell: true })`). If Step 4 only broadens scan paths, the guard can still incorrectly report zero functional usage. **Suggested fix:** add an explicit Step 4 outcome to expand strict detection coverage for exec/spawn patterns used in `.mjs/.cjs/.js` files (including shell-command string forms), then update guard assertions accordingly.

### Missing Items
- Explicit outcome that strict-mode detection semantics are validated against the expanded package scope (not just file discovery/scope metadata changes).

### Suggestions
- In the guard test (`extensions/tests/tmux-reference-guard.test.ts:62-63,89`), update assertions to reflect multi-root scope and keep deterministic ordering checks so scope expansion remains stable across platforms.
- Log post-change residual TMUX counts by directory (extensions/bin/templates/dashboard) in `STATUS.md` for traceability into Step 5.
