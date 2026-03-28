# TP-079: Workspace Packet-Home Contract and Mode Enforcement — Status

**Current Step:** Step 1: Add packet-home routing contract
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-28
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 4
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read current workspace config validation and mode-detection flow
- [x] Confirm existing behavior for non-git cwd + missing workspace config
- [x] Identify all call-sites that rely on `routing.tasksRoot` and `routing.defaultRepo`

---

### Step 1: Add packet-home routing contract
**Status:** 🟡 In Progress

- [ ] Add `workspace.routing.taskPacketRepo` to canonical schema/types
  - [ ] Update `extensions/taskplane/types.ts` (`WorkspaceRoutingConfig`, error-code union/docs)
  - [ ] Update `extensions/taskplane/workspace.ts` routing parse/build types
- [ ] Validate `taskPacketRepo` references an existing repo ID
  - [ ] Add deterministic validation branch in `loadWorkspaceConfig()`
  - [ ] Emit actionable `WorkspaceConfigError` with available repo IDs
- [ ] Enforce invariant: `routing.tasksRoot` resolves inside `repos[taskPacketRepo].path`
  - [ ] Reuse canonicalized path containment checks for cross-platform correctness
  - [ ] Add explicit error code/message for packet-home containment failure
- [ ] Enforce invariant: every configured task-area path resolves inside `tasksRoot`
  - [ ] Implement cross-config validation in `buildExecutionContext()` (after task-runner config load)
  - [ ] Keep workspace-YAML-only validation separate from task-runner-aware validation
- [ ] Provide actionable validation errors for invariant violations
  - [ ] Add stable error messages with offending path, expected root, and remediation hint

**Implementation note:** use existing `extensions/taskplane/workspace.ts` (no new `workspace-config.ts` split in this task).
**Compatibility policy:** if `routing.task_packet_repo` is missing in legacy workspace YAML, deterministically default to `routing.default_repo` and emit a compatibility warning.

---

### Step 2: Enforce deterministic mode selection
**Status:** 🟡 In Progress

- [ ] Ensure workspace config presence always forces workspace mode (no repo-mode fallback)
  - [ ] Keep workspace-config parse failures fatal in `buildExecutionContext()`
  - [ ] Ensure no downstream fallback path silently builds repo-mode context
- [ ] Ensure non-git cwd + no workspace config is a hard setup error with clear guidance
  - [ ] Add explicit startup validation in repo-mode branch of `buildExecutionContext()`
  - [ ] Emit actionable setup guidance (run from git repo or add workspace config)
- [ ] Verify startup errors are surfaced consistently through extension command guard paths
  - [ ] Store startup error message once during `session_start`
  - [ ] Reuse shared startup error message in `requireExecCtx()` and tool helper guards

---

### Step 3: Config loading + compatibility
**Status:** ⬜ Not Started

- [ ] Thread new field through JSON loader defaults and legacy YAML mapping
- [ ] Preserve backward compatibility messaging for older workspace configs (missing field)
- [ ] Add migration-safe defaults only where deterministic behavior remains valid

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust unit tests for `taskPacketRepo` validation and path invariants
- [ ] Add/adjust tests for deterministic mode selection and hard-fail cases
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec/status notes if behavior or naming changed during implementation
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | plan | Step 1 | APPROVE | .reviews/R002-plan-step1.md |
| R003 | code | Step 1 | APPROVE | .reviews/R003-code-step1.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-28 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-28 04:31 | Task started | Extension-driven execution |
| 2026-03-28 04:31 | Step 0 started | Preflight |
| 2026-03-28 04:31 | Task started | Extension-driven execution |
| 2026-03-28 04:31 | Step 0 started | Preflight |
| 2026-03-28 04:31 | Worker iter 2 | done in 26s, ctx: 12%, tools: 12 |
| 2026-03-28 04:31 | Step 0 complete | Preflight |
| 2026-03-28 04:31 | Iteration 1 summary | +3 checkboxes, completed: Step 0 |
| 2026-03-28 04:32 | Worker iter 1 | done in 42s, ctx: 8%, tools: 9 |
| 2026-03-28 04:32 | Step 0 complete | Preflight |
| 2026-03-28 04:32 | Iteration 1 summary | +3 checkboxes, completed: Step 0 |
| 2026-03-28 04:32 | Worker iter 3 | done in 26s, ctx: 16%, tools: 14 |
| 2026-03-28 04:32 | No progress | Iteration 2: 0 new checkboxes (1/3 stall limit) |
| 2026-03-28 04:32 | Worker iter 2 | done in 14s, ctx: 11%, tools: 8 |
| 2026-03-28 04:32 | No progress | Iteration 2: 0 new checkboxes (1/3 stall limit) |
| 2026-03-28 04:32 | Worker iter 4 | done in 30s, ctx: 17%, tools: 13 |
| 2026-03-28 04:32 | No progress | Iteration 3: 0 new checkboxes (2/3 stall limit) |
| 2026-03-28 04:32 | Worker iter 3 | done in 27s, ctx: 14%, tools: 12 |
| 2026-03-28 04:32 | No progress | Iteration 3: 0 new checkboxes (2/3 stall limit) |
| 2026-03-28 04:33 | Worker iter 4 | done in 27s, ctx: 11%, tools: 6 |
| 2026-03-28 04:33 | No progress | Iteration 4: 0 new checkboxes (3/3 stall limit) |
| 2026-03-28 04:33 | Task blocked | No progress after 3 iterations |
| 2026-03-28 04:33 | Worker iter 5 | done in 30s, ctx: 15%, tools: 12 |
| 2026-03-28 04:33 | No progress | Iteration 4: 0 new checkboxes (3/3 stall limit) |
| 2026-03-28 04:33 | Task blocked | No progress after 3 iterations |
| 2026-03-28 04:35 | Reviewer R001 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer session died while waiting for verdict |
| 2026-03-28 04:39 | Review R001 | plan Step 1: REVISE (fallback) |
| 2026-03-28 04:40 | Reviewer R002 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 04:42 | Review R002 | plan Step 1: APPROVE (fallback) |
| 2026-03-28 04:46 | Reviewer R003 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 04:49 | Review R003 | code Step 1: APPROVE (fallback) |
| 2026-03-28 04:50 | Reviewer R004 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 04:50 | Reviewer R004 | reviewer respawn limit exceeded — review skipped |
| 2026-03-28 04:53 | Reviewer R005 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 04:53 | Reviewer R005 | reviewer respawn limit exceeded — review skipped |
| 2026-03-28 04:56 | Reviewer R006 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 04:56 | Reviewer R006 | reviewer respawn limit exceeded — review skipped |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
