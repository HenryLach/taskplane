## Code Review: Step 1: Define TaskExitDiagnostic Type & Classification Logic

### Verdict: REVISE

### Summary
The new diagnostics module is a strong start: it introduces the requested exit classification union, structured `TaskExitDiagnostic`, and explicit precedence in `classifyExit()`. However, the current barrel export wiring introduces a conflicting `TokenCounts` public symbol that can break downstream imports from `extensions/taskplane/index.ts`. Please resolve the exported type collision before proceeding.

### Issues Found
1. **[extensions/taskplane/index.ts:8-25, extensions/taskplane/diagnostics.ts:66-75, extensions/taskplane/types.ts:1643-1649] [important]** — `TokenCounts` is now exported from both `types.ts` and `diagnostics.ts` via `export *` in the barrel. These two `TokenCounts` shapes are different (`types.ts` includes `costUsd`; `diagnostics.ts` does not), creating an ambiguous/conflicting re-export and a brittle public API. Fix by making one canonical type name (or aliasing one explicitly), then ensure `index.ts` exports an unambiguous symbol set.
2. **[extensions/taskplane/diagnostics.ts:104-127] [minor]** — `ExitSummary` JSDoc says fields are “nullable/optional,” but several fields are required and non-nullable in the type (`toolCalls`, `retries`, `compactions`, `durationSec`). Either adjust the wording or make the type optional where partial-write tolerance is required.

### Pattern Violations
- Public barrel export (`index.ts`) currently violates a stable-contract expectation by introducing conflicting type names from multiple modules.

### Test Gaps
- No tests were added yet for `classifyExit()` precedence and all 9 classifications. Step 3 is planned for this, but this step still leaves classification behavior unverified.

### Suggestions
- Add an explicit precedence-collision test set in Step 3 (e.g., `.DONE + failed retry`, `timerKilled + non-zero exit`, `userKilled + non-zero exit`) so ordering stays intentional.
- Consider exporting `EXIT_CLASSIFICATIONS` as the single runtime validation source used by parser/normalizer code in later steps.
