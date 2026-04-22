## Plan Review: Step 4: Update docs and templates

### Verdict: REVISE

### Summary
The Step 4 plan is much stronger than the prior revision and now includes key root-level files (`CONTRIBUTING.md`, `extensions/tsconfig.json`, `docs/tutorials/install-from-source.md`). However, it still has two blocking gaps that can leave stale `task-runner.ts` references after deletion. As written, it is likely to miss at least one required cleanup outcome from the task prompt.

### Issues Found
1. **[Severity: important]** — `STATUS.md:64` currently says `templates/agents/task-worker.md` is “audit (no changes needed based on grep)`, but the template still has direct deleted-file instructions at `templates/agents/task-worker.md:363-365` (`wc -l extensions/task-runner.ts`, `grep ... extensions/task-runner.ts`, `read extensions/task-runner.ts ...`).
   - **Suggested fix:** change this checklist item to an explicit update outcome (replace those examples with a valid current file/workflow), not a presumed no-op audit.

2. **[Severity: important]** — The plan lacks an explicit final residual-reference sweep after Step 3/4 edits. New non-doc references exist outside the current checklist (for example `extensions/taskplane/config-loader.ts:1272-1274` includes a “deleted in TP-162” note, and `extensions/taskplane/path-resolver.ts:161` uses `"extensions/task-runner.ts"` as an example path). This conflicts with the prompt rule to write as if `task-runner.ts` never existed.
   - **Suggested fix:** add a concrete Step 4 outcome to run a final grep/disposition pass for `task-runner.ts` across maintained runtime/docs/templates paths (excluding historical/spec/task-artifact locations), and update/remove remaining active references.

### Missing Items
- Explicit Step 4 item to **update** (not just audit) `templates/agents/task-worker.md` where deleted-file commands still exist.
- Explicit Step 4 item for a post-edit residual reference sweep with clear exclusions (e.g., historical specs/changelog/task artifacts may remain unchanged by intent).

### Suggestions
- In Step 4 notes, explicitly document which reference classes are intentionally retained (e.g., historical changelog/specification/task snapshots) so cleanup scope is auditable.
