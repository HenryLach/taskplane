## Plan Review: Step 4: Update all test imports

### Verdict: APPROVE

### Summary
This revised Step 4 plan is now outcome-complete and aligned with TP-161 requirements. The key gaps from the prior review were addressed: it explicitly includes context-window call-site adaptation for the new `resolveContextWindow(configuredWindow, ctx)` signature, and it clearly defines how `project-config-loader.test.ts` should migrate `_loadAgentDef` while intentionally retaining task-runner-specific reset/config imports where behavior still lives in TP-161. The scope also correctly handles additional Step 0 inventory items by explicitly leaving source-reading legacy `/task` tests unchanged for this task.

### Issues Found
1. **[Severity: minor]** No blocking issues found.

### Missing Items
- None.

### Suggestions
- In implementation, prefer explicit import aliasing where helpful (e.g., `loadAgentDef as _loadAgentDef`) to keep large test file diffs focused and low-risk.
