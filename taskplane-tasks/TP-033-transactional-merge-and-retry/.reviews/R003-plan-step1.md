## Plan Review: Step 1: Transaction Envelope

### Verdict: REVISE

### Summary
The Step 1 checklist is directionally aligned with TP-033, but the current plan is too high-level for a high-reversibility merge safety change. Critical outcomes for safe-stop behavior, transaction-record contract, and policy override are not yet explicit. Tightening those outcomes now will reduce the risk of corrupting merge state when rollback fails.

### Issues Found
1. **[Severity: important]** — The plan does not define the transaction contract tightly enough to satisfy 4b requirements.
   - Evidence: Step 1 planning in `taskplane-tasks/TP-033-transactional-merge-and-retry/STATUS.md:24-27` is generic, while roadmap 4b requires explicit capture of `baseHEAD`, `laneHEAD`, `mergedHEAD` and persisted txn artifacts (`docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:598-606`).
   - Current behavior only captures `preLaneHead` conditionally when baseline exists (`extensions/taskplane/merge.ts:970-979`), which is not equivalent to always capturing all required refs.
   - Suggested fix: Add explicit Step 1 outcomes for (a) when each ref is captured, (b) required JSON fields in `txn-*.json`, and (c) fallback behavior when a ref cannot be resolved.

2. **[Severity: critical]** — Safe-stop semantics are not operationally specified against current cleanup/policy paths.
   - Evidence: Roadmap requires forced `paused`, no branch deletion/worktree removal, and exact recovery commands (`docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:608-611`).
   - Current merge flow always removes merge worktree + temp branch (`extensions/taskplane/merge.ts:1377-1385`), and engine applies configurable merge-failure policy (can abort) (`extensions/taskplane/engine.ts:524-535`, `extensions/taskplane/messages.ts:333-356`).
   - Suggested fix: Add an explicit outcome for how rollback-failure is signaled so engine/resume must force `paused` regardless of `on_merge_failure`, and preserve merge worktree/branch state for recovery.

3. **[Severity: important]** — The plan is missing explicit test intent for Step 1 risk paths.
   - Evidence: Step 1 section has no validation intent in `STATUS.md:22-27`; Step 3 has broad test bullets but does not pin Step 1 edge behavior.
   - Suggested fix: Add Step 1 test intent covering (a) rollback-failure safe-stop preserves merge worktree/temp branch, (b) recovery commands are emitted and actionable, and (c) txn filename handling for both workspace repo IDs and repo-mode (`repoId` undefined).

### Missing Items
- A concrete “safe-stop trigger contract” between merge result and engine/resume policy application.
- Transaction record schema details (required fields/status transitions) and deterministic filename/repoId sanitization rules.
- Step 1-specific validation criteria for rollback-failure preservation behavior before moving to Step 2.

### Suggestions
- Add a short “Step 1 done when” block under `STATUS.md` with explicit outcomes for refs captured, txn JSON persisted, and safe-stop invariants.
- Reuse the existing policy-helper pattern (as done for cleanup gate) so engine/resume apply identical forced-pause behavior for rollback-failure cases.
