# TP-128: Full Package TMUX Extrication — Status

**Current Step:** Step 6: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-03
**Review Level:** 2
**Review Counter:** 15
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Count TMUX refs in task-runner.ts, CLI, templates, supervisor
- [x] Log inventory

### Step 1: Remove TMUX from task-runner.ts
**Status:** ✅ Complete
- [x] Remove spawnAgentTmux
- [x] Remove spawn_mode: "tmux" branch
- [x] Remove TMUX session helpers
- [x] Keep subprocess path working
- [x] Update tests
- [x] R002: Migrate persistent-worker-context test expectations to subprocess-only behavior
- [x] R002: Reconcile mailbox steering tests with subprocess task-runner behavior
- [x] R003: Remove accidental `.tmp-fulltest.log` artifact and prevent re-commit

### Step 2: Remove TMUX from CLI
**Status:** ✅ Complete
- [x] Remove doctor TMUX checks
- [x] Remove install-tmux guidance
- [x] Remove install-tmux command implementation and dispatch path
- [x] Update help text
- [x] Validate CLI surface for removed install-tmux command

### Step 3: De-TMUX supervisor templates and primer
**Status:** ✅ Complete
- [x] Clean templates/agents/supervisor.md
- [x] Clean supervisor-primer.md
- [x] Remove TMUX references from supervisor.ts runtime prompt text

### Step 4: Expand audit script scope
**Status:** ✅ Complete
- [x] Update audit to scan full package
- [x] Expand strict functional detection for JS/CJS/MJS exec+shell tmux patterns
- [x] Update guard test for expanded scope and deterministic ordering

### Step 5: Tests and verification
**Status:** ✅ Complete
- [x] Run full suite
- [x] Fix failures
- [x] Run expanded audit

### Step 6: Documentation & Delivery
**Status:** 🟨 In Progress
- [x] Update STATUS.md
- [x] Log final count

---

## TMUX Inventory (Step 0)

- `extensions/task-runner.ts`: **124** matches
- `bin/taskplane.mjs`: **51** matches
- `templates/agents/supervisor.md`: **4** matches
- `templates/config/task-runner.yaml`: **3** matches
- `extensions/taskplane/supervisor-primer.md`: **23** matches
- `extensions/taskplane/supervisor.ts`: **7** matches

## Completion Summary

- Removed `install-tmux` command surface and TMUX doctor guidance from `bin/taskplane.mjs`.
- Removed TMUX guidance language from supervisor template sources (`templates/agents/supervisor.md`, `extensions/taskplane/supervisor.ts`, `extensions/taskplane/supervisor-primer.md`).
- Expanded `scripts/tmux-reference-audit.mjs` to recursively scan `extensions/`, `bin/`, `templates/`, and `dashboard/` with deterministic output ordering.
- Expanded strict functional detection for JS/CJS/MJS shell-command payload forms and updated guard coverage in `extensions/tests/tmux-reference-guard.test.ts`.
- Removed remaining functional TMUX command execution from `dashboard/server.cjs` (`getTmuxSessions`, `captureTmuxPane`) while preserving API shape.
- Verification complete: full Node test suite passed (`3119` tests, `0` failures).

## Final TMUX Reference Count (Expanded Audit)

- `functionalUsage.count`: **0**
- `extensions/*`: **291** references
- `bin/*`: **3** references
- `templates/*`: **4** references
- `dashboard/*`: **60** references
- **Total references:** **358**

## Notes

- R002 Suggestion: Prefer behavioral subprocess tests over source-string checks when replacing removed TMUX assertions.
- R002 Suggestion: Document steering contract shifts in mailbox/task-runner test comments where behavior changed.
- R003 Suggestion: Clean up remaining unused TMUX-era imports/helpers in task-runner.ts as follow-up hardening.
- R003 Suggestion: Add at least one behavioral subprocess test to complement source-string checks.
- R005 Suggestion: Run targeted grep/audit on `bin/taskplane.mjs` after command removal to confirm no functional TMUX command paths remain.
- R005 Suggestion: Add a brief migration note in final delivery notes for removed `install-tmux` CLI command.
- R008 Suggestion: After Step 3 edits, run focused grep on supervisor template/primer/source files and log any residual TMUX references.
- R011 Suggestion: In guard tests, assert expanded multi-root scope and deterministic ordering across platforms.
- R011 Suggestion: Log post-change TMUX residual counts by directory (extensions/bin/templates/dashboard) in STATUS for traceability.

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-03 04:02 | Task started | Runtime V2 lane-runner execution |
| 2026-04-03 04:02 | Step 0 started | Preflight |
| 2026-04-03 04:10 | TMUX inventory captured | Counted refs in task-runner, CLI, templates, and supervisor files |
|-----------|--------|---------|
| 2026-04-03 04:03 | Review R001 | plan Step 1: APPROVE |
| 2026-04-03 04:19 | Review R002 | code Step 1: REVISE |
| 2026-04-03 04:26 | Review R003 | code Step 1: REVISE |
| 2026-04-03 04:31 | Review R004 | code Step 1: APPROVE |
| 2026-04-03 04:32 | Worker iter 1 | killed (wall-clock timeout) in 1800s, tools: 127 |
| 2026-04-03 04:33 | Review R005 | plan Step 2: REVISE |
| 2026-04-03 04:34 | Review R006 | plan Step 2: APPROVE |
| 2026-04-03 04:37 | Task started | Runtime V2 lane-runner execution |
| 2026-04-03 04:41 | Review R007 | code Step 2: APPROVE |
| 2026-04-03 04:42 | Review R008 | plan Step 3: REVISE |
| 2026-04-03 04:42 | Review R009 | plan Step 3: APPROVE |
| 2026-04-03 04:45 | Review R010 | code Step 3: APPROVE |
| 2026-04-03 04:47 | Review R011 | plan Step 4: REVISE |
| 2026-04-03 04:48 | Review R012 | plan Step 4: APPROVE |
| 2026-04-03 04:53 | Review R013 | code Step 4: APPROVE |
| 2026-04-03 04:54 | Review R014 | plan Step 5: APPROVE |
| 2026-04-03 04:59 | Review R015 | code Step 5: APPROVE |
| 2026-04-03 14:23 | Task started | Runtime V2 lane-runner execution |
| 2026-04-03 14:23 | Task complete | .DONE created |
