## Plan Review: Step 1: Fix integratedAt lifecycle (#499)

### Verdict: APPROVE

### Summary
The Step 1 plan is appropriately scoped and aligned with the task outcomes: it covers writing integration metadata, updating batch history, handling workspace-root state, and running targeted integration tests. The sequence also matches the runtime behavior in `extension.ts`, where cleanup currently happens after integration and is the right place to attach lifecycle updates. I don't see any blocking gaps that would prevent this step from succeeding.

### Issues Found
1. **[Severity: minor]** — If the implementation persists `phase = "integrated"`, note that current phase validation only allows `idle|launching|planning|executing|merging|paused|stopped|completed|failed` (`extensions/taskplane/types.ts` and `extensions/taskplane/persistence.ts`). This is manageable, but the implementation should explicitly decide whether to extend phase compatibility or avoid persisting an invalid phase on disk.

### Missing Items
- None that block Step 1 outcomes.

### Suggestions
- In workspace mode, ensure the integration metadata update is performed exactly once at the workspace state root before per-repo cleanup loops.
- Add at least one targeted test for the “cleanup warning” path (e.g., state deletion failure) so integration metadata handling remains safe under partial cleanup failure.
