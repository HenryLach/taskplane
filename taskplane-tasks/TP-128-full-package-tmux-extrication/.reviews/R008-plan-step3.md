## Plan Review: Step 3: De-TMUX supervisor templates and primer

### Verdict: REVISE

### Summary
The plan is close, and it correctly targets the two supervisor prompt documents plus `supervisor.ts`. However, the current Step 3 checklist in `STATUS.md` only says to “Check supervisor.ts,” which is weaker than the required outcome and risks leaving known TMUX references in shipped runtime prompt content. Since Step 0 inventory already found TMUX matches in `supervisor.ts`, this needs to be an explicit removal outcome.

### Issues Found
1. **[Severity: important]** — `STATUS.md:42` says “Check supervisor.ts” instead of committing to removal, but TMUX references are known to exist in that file (`extensions/taskplane/supervisor.ts:107,112,119,2056,2087,2092,2099`). As written, the step can be marked done without actually de-TMUXing runtime fallback/classification text. **Fix:** update the Step 3 plan item to explicitly remove TMUX references from `supervisor.ts` (not just inspect it).

### Missing Items
- Explicit Step 3 outcome that `supervisor.ts` TMUX guidance is rewritten to subprocess/tool-driven equivalents wherever the supervisor prompt text is generated.

### Suggestions
- After implementation, run a focused grep over the three Step 3 targets (`templates/agents/supervisor.md`, `extensions/taskplane/supervisor-primer.md`, `extensions/taskplane/supervisor.ts`) and log residual TMUX references in `STATUS.md` notes for traceability.
