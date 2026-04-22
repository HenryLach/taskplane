## Code Review: Step 3: Wire extensions into all three spawn points

### Verdict: REVISE

### Summary
The Step 3 wiring is largely in place: worker, reviewer, and merge spawn paths now include extension forwarding and exclusion threading. However, there is a blocking syntax error in `merge.ts` that prevents the module from loading at runtime. This must be fixed before the step can be considered correct.

### Issues Found
1. **[extensions/taskplane/merge.ts:721,759] [critical]** — `mergeStateRoot` is declared twice in the same function scope (`const mergeStateRoot = stateRoot ?? repoRoot;`), which throws `SyntaxError: Identifier 'mergeStateRoot' has already been declared` when loading the module. This blocks orchestrator runtime startup/import paths. **Fix:** keep a single declaration (reuse the first one for telemetry/snapshot writes) or rename one variable and adjust references consistently.

### Pattern Violations
- None beyond the blocking redeclaration above.

### Test Gaps
- No automated coverage yet in this step for merge/reviewer extension forwarding regressions (expected in Step 5).

### Suggestions
- In `agent-bridge-extension.ts`, validate that `TASKPLANE_REVIEWER_EXCLUDE_EXTENSIONS` parses to a string array before calling `filterExcludedExtensions` (malformed-but-valid JSON like objects/strings can currently bypass assumptions).
