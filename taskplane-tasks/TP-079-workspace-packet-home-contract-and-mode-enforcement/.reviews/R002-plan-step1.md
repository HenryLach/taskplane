# R002 — Plan Review (Step 1: Add packet-home routing contract)

## Verdict
**APPROVED** — the Step 1 plan is now implementation-ready and addresses the prior blockers.

## What improved (and now aligns)

1. **Plan hydration is sufficient**
   - `STATUS.md` now has concrete Step 1 sub-steps with file targets and validation placement (`STATUS.md:25-41`).

2. **File-contract drift is explicitly resolved**
   - You documented that this task will use existing `extensions/taskplane/workspace.ts` rather than introducing `workspace-config.ts` (`STATUS.md:40`).

3. **Cross-config invariant placement is correct**
   - Putting task-area containment validation in `buildExecutionContext()` after loading task-runner config (`STATUS.md:35-36`) is the right call, because `loadWorkspaceConfig()` only has workspace YAML data (`workspace.ts:454-531`) and task-area paths are discovered relative to workspace root later (`extension.ts:1630-1633`, `discovery.ts:512-516`).

4. **Type and error-surface intent is explicit**
   - You now call out `WorkspaceRoutingConfig` and `WorkspaceConfigError` updates (`STATUS.md:26,30,33,38`), which matches current type locations (`types.ts:2863-2888`, `types.ts:2970-2982`).

5. **Spec invariants are directly represented**
   - The plan now maps to required invariants from spec (`multi-repo-task-execution.md:110-111`).

---

## Non-blocking implementation guardrails

- **Use the same path base as discovery** for area checks: resolve task-area paths from `workspaceRoot` (not pointer config root), to match runtime behavior (`extension.ts:1630-1633`).
- **Keep error codes stable and machine-branchable** by adding explicit new `WorkspaceConfigErrorCode` entries (not just free-form messages).
- **Compatibility fallback** (`task_packet_repo` missing → `default_repo`) is acceptable as planned, but warning text should include clear migration guidance and be deterministic.

---

## Final assessment
Step 1 planning is now unblocked. Proceed to implementation.