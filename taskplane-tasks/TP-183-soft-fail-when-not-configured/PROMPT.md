# Task: TP-183 - Soft-fail orchestrator startup when Taskplane is not configured

**Created:** 2026-05-03
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Changes the startup contract for every pi user who has the taskplane extension loaded but uses pi from directories that don't have taskplane configured. The current behavior — hard-block startup with a verbose red wall of text — is in production and any softening must be careful not to mask genuine misconfiguration in workspaces that ARE meant to be taskplane-configured. Plan review needed to lock the heuristic for "intentional non-configuration" vs "broken configuration"; code review needed because the failure path touches the orchestrator's init contract.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-183-soft-fail-when-not-configured/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Address external bug report [#523](https://github.com/HenryLach/taskplane/issues/523) by `@mwickens`.

When `pi` starts in a directory where Taskplane has not been configured, the user is hit with a hard-blocking red error:

```
❌ Orchestrator startup blocked [WORKSPACE_SETUP_REQUIRED]
No workspace config found at .pi/taskplane-workspace.yaml, and current directory
is not a git repository: <cwd>. Run Taskplane from a git repository, or create
.pi/taskplane-workspace.yaml (taskplane init) to use workspace mode.
Orchestrator commands are disabled until this setup issue is resolved.
```

For users who only want Taskplane in *some* projects, this is the wrong UX. The error should be reserved for cases where Taskplane *was* configured but is misconfigured — not for cases where the user is simply running pi somewhere unrelated.

The fix: when `WORKSPACE_SETUP_REQUIRED` fires (the soft case — no workspace config AND no git repo, i.e. the user clearly didn't intend to use Taskplane here), suppress the red error notification by default, set a quieter status line indicator, and gate the loud version behind a config flag for users who *do* want hard-fail behavior.

`WORKSPACE_CONFIG_INVALID` and other hard-error codes (where a config exists but is malformed) MUST continue to surface loudly — those are real misconfigurations.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/extension.ts` (lines ~4830-4870) — the `try { buildExecutionContext(...) } catch (WorkspaceConfigError)` block where the red notification is raised. This is the only file with the user-facing message.
- `extensions/taskplane/workspace.ts` (lines ~640-680) — `buildExecutionContext` and the `WORKSPACE_SETUP_REQUIRED` throw site. Useful for understanding when this code path fires (no workspace config + cwd not a git repo).
- `extensions/taskplane/types.ts` (lines ~3320-3500) — `WorkspaceConfigError` codes enum. Confirms which codes are "user clearly didn't configure" vs "user configured incorrectly".
- `extensions/tests/workspace-config.integration.test.ts` (around line 530) — existing test asserts the throw. Sibling tests in this file are the model for the new tests.
- `docs/reference/configuration/taskplane-settings.md` — settings reference; new config flag (if added) goes here.

## Environment

- **Workspace:** `extensions/taskplane/` + `extensions/tests/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts` — soft-fail branch in the `WorkspaceConfigError` catch
- `extensions/taskplane/types.ts` — possible `OrchestratorConfig` field for opt-in strict mode (e.g. `requireWorkspaceSetup?: boolean`)
- `extensions/taskplane/config-loader.ts` — load/default the new field if added
- `extensions/tests/workspace-config.integration.test.ts` — adapt the existing assertion (or split: one test for hard-fail with strict flag, one for soft-fail without)
- `extensions/tests/orchestrator-startup-uxv2.test.ts` (NEW) — covers the soft-fail UX path: no notify, quiet status line, orchestrator commands gracefully disabled
- `docs/reference/configuration/taskplane-settings.md` — document the new config flag (if added)
- `docs/explanation/architecture.md` — minor note if the startup contract is mentioned

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it.

### Step 0: Preflight

- [ ] On `main`, working tree clean (excluding known TP-114 unpushed commits)
- [ ] Baseline test pass: `cd extensions && npm run test:fast` — record count
- [ ] Read the four Tier 3 source files listed above and confirm understanding before editing
- [ ] Reproduce the bug locally: launch pi in a non-git directory with the taskplane extension loaded; confirm the red `WORKSPACE_SETUP_REQUIRED` block appears

### Step 1: Decide and document the soft-fail policy

This step produces a written policy decision (in `STATUS.md` Discoveries) before any code changes. Plan-review checkpoint.

- [ ] Decide: should the soft-fail be **always-on** (no config flag, just always quiet for `WORKSPACE_SETUP_REQUIRED`), or **opt-in to loud** (new config flag `taskRunner.requireWorkspaceSetup: false` by default)?
   - Recommended default: always-on soft-fail for `WORKSPACE_SETUP_REQUIRED`, no config flag. The error code's *meaning* is "user didn't configure Taskplane here" — there's no scenario where a user wants the red wall of text in that case. The flag would just be ceremony. If the maintainer disagrees, document the alternative in Discoveries and switch.
- [ ] Decide: what does the quiet path show?
   - Recommended: no `notify(..., "error")` call at all; `setStatus("task-orchestrator", "🔀 Orchestrator · disabled (no taskplane config in this workspace)")`. Orchestrator commands stay disabled (existing behavior preserved). User sees nothing alarming.
- [ ] Decide: do `WORKSPACE_CONFIG_INVALID` and other error codes still surface loudly? **Yes — only `WORKSPACE_SETUP_REQUIRED` becomes quiet.** Document this explicitly.
- [ ] Write the policy decision into STATUS.md Discoveries with one paragraph of rationale before proceeding to Step 2

**Artifacts:**
- (no code changes — decision logged in STATUS.md)

### Step 2: Implement the soft-fail branch

- [ ] In `extensions/taskplane/extension.ts` around line 4842, change the existing `setupError` branch:
   - Remove the `ctx.ui.notify(execCtxInitError, "error")` call **for the `WORKSPACE_SETUP_REQUIRED` case only**
   - Replace the loud status line with a quiet variant: `"🔀 Orchestrator · disabled (no taskplane config in workspace)"` (or similar — keep it short, no error icon)
   - Preserve the existing `execCtxInitError` string assignment (so the verbose explanation is still available via debug surfaces; just don't display it as a red notify)
   - Leave the non-setupError branch (for `WORKSPACE_CONFIG_INVALID` etc.) **untouched** — those keep their loud notify
- [ ] Confirm orchestrator commands remain gracefully disabled (`execCtx === null` causes them to short-circuit elsewhere). If the existing logic relies on `execCtxInitError` being non-empty, preserve it.

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified — single branch in the catch block)

### Step 3: Add tests for the new behavior

- [ ] Create `extensions/tests/orchestrator-startup-uxv2.test.ts` with at least three scenarios:
   1. `WORKSPACE_SETUP_REQUIRED` → no `notify` of severity `"error"` is invoked, status line is the quiet variant, orchestrator commands are disabled
   2. `WORKSPACE_CONFIG_INVALID` → loud `notify` of severity `"error"` IS invoked, status line is the loud variant (regression guard for the un-relaxed path)
   3. Successful config load → no notify, status line shows ready state (sanity baseline)
- [ ] Use the existing `workspace-config.integration.test.ts` patterns for test scaffolding (mock `ctx.ui.notify` and `ctx.ui.setStatus`, drive the orchestrator init path)
- [ ] Verify the existing `workspace-config.integration.test.ts` `WORKSPACE_SETUP_REQUIRED` test still passes — the *throw* behavior of `buildExecutionContext` is unchanged; only the *display* in `extension.ts` changes
- [ ] Run targeted tests: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/orchestrator-startup-uxv2.test.ts tests/workspace-config.integration.test.ts`

**Artifacts:**
- `extensions/tests/orchestrator-startup-uxv2.test.ts` (new)

### Step 4: Testing & Verification

> ZERO test failures allowed. Full quality gate.

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts tests/*.integration.test.ts`
- [ ] Confirm pass count is `baseline + 3` (the three new scenarios)
- [ ] Manual smoke: launch pi in a non-git directory; confirm no red error appears, status line shows the quiet variant, orchestrator commands either stay hidden or short-circuit gracefully when invoked
- [ ] Manual smoke: launch pi in a directory with a *broken* taskplane config (e.g. malformed YAML); confirm the loud red error STILL appears (regression guard)

### Step 5: Documentation & Delivery

- [ ] Update `CHANGELOG.md` — add an Unreleased / Fixed entry: "Pi no longer hard-blocks startup with a red error when run in directories that aren't configured for Taskplane. Configuration errors in workspaces that ARE set up still surface loudly. Thanks to @mwickens (#523)."
- [ ] If the policy decision in Step 1 chose "opt-in to loud" with a config flag, document the flag in `docs/reference/configuration/taskplane-settings.md`
- [ ] Comment on issue #523 (after merge) summarizing the fix and the version it ships in
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — Unreleased / Fixed entry as described in Step 5

**Check If Affected:**
- `docs/reference/configuration/taskplane-settings.md` — only if a config flag is added in Step 1
- `docs/explanation/architecture.md` — if it describes the startup contract; minor note if so

## Completion Criteria

- [ ] Pi launched in a non-taskplane directory shows no red error and displays a quiet status indicator
- [ ] Pi launched in a directory with a malformed taskplane config still shows the loud error (regression guard)
- [ ] New tests cover both paths
- [ ] Full test suite passing
- [ ] CHANGELOG updated with attribution to @mwickens
- [ ] Issue #523 commented and closed when the fix ships

## Git Commit Convention

Commits happen at **step boundaries**. All commits MUST include the task ID:

- **Step completion:** `fix(TP-183): complete Step N — description`
- **Tests:** `test(TP-183): add orchestrator startup UX tests`
- **Docs:** `docs(TP-183): add CHANGELOG entry for #523`
- **Hydration:** `hydrate: TP-183 expand Step N checkboxes`

## Do NOT

- Change the throw behavior of `buildExecutionContext` in `workspace.ts` — it correctly raises `WORKSPACE_SETUP_REQUIRED` and many tests depend on that. Only change the *display* of the error in `extension.ts`.
- Suppress `WORKSPACE_CONFIG_INVALID` or any other error code. The relaxation is for `WORKSPACE_SETUP_REQUIRED` ONLY.
- Remove the `execCtxInitError` string entirely — keep it populated so the message is available to anything that reads it (logs, diagnostics).
- Modify or weaken the existing `workspace-config.integration.test.ts` assertion that `WORKSPACE_SETUP_REQUIRED` is thrown — that test verifies the throw, not the display.
- Add new top-level config keys without documenting them in `taskplane-settings.md`.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
