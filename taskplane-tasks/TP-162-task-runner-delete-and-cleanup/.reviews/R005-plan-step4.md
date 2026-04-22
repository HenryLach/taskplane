## Plan Review: Step 4: Update docs and templates

### Verdict: REVISE

### Summary
The Step 4 checklist covers the explicitly listed files from PROMPT.md, but it is not yet outcome-complete for the task goal of cleaning up **all** references after deleting `task-runner.ts`. The current “Any additional files from Step 0 grep” catch-all is too narrow because the Step 0 grep scope itself excludes some root-level docs/config files that still contain hard references.

### Issues Found
1. **[Severity: important]** — `STATUS.md:56-65` relies on “Any additional files from Step 0 grep,” but the Step 0 grep command in `PROMPT.md:69` only searches `extensions/ docs/ templates/ AGENTS.md bin/ package.json`. That misses root docs like `CONTRIBUTING.md`, which still contains active load instructions for `extensions/task-runner.ts` (`CONTRIBUTING.md:51-61`, plus structure references at `:114` and `:166`). If Step 4 proceeds as currently scoped, stale user-facing guidance will remain.
   - **Suggested fix:** Add an explicit Step 4 outcome to run a repo-root documentation/reference audit (at minimum include `CONTRIBUTING.md` and other root markdown) and update/remove references to loading `task-runner.ts`.

### Missing Items
- Explicit Step 4 item for root developer docs outside `docs/` (notably `CONTRIBUTING.md`).
- Explicit Step 4 item for non-doc leftover references discovered by grep that point to the deleted file (e.g., `extensions/tsconfig.json:15` still includes `"task-runner.ts"`).

### Suggestions
- Replace the placeholder “Hydrate later” line with a concrete, enumerated list of additional files discovered in preflight so execution doesn’t rely on memory.
