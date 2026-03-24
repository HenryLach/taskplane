# Task: TP-052 - UX: Integrate Visibility, Branch Protection, and Post-Batch Prompt

**Created:** 2026-03-24
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Three UX improvements touching the extension command surface, supervisor messages, and branch protection detection. Moderate blast radius across post-batch user flows. Branch protection detection introduces a new pattern (GitHub API query).
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-052-ux-integrate-visibility-and-prompt/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Fix three UX issues that confuse operators after batch completion:

1. **Issue #99 — /orch-integrate not obvious:** After a batch completes, there's
   no clear guidance that the operator needs to run `/orch-integrate` to bring
   changes into their branch. New users don't know this step exists.

2. **Issue #100 — branch protection detection:** When main has branch protection
   enabled, `/orch-integrate` (direct merge) fails. The system should detect
   protection and guide users to `--pr` mode instead of letting them hit an error.

3. **Issue #88 — no input prompt after batch:** After batch completion, the
   terminal looks frozen with no visible input prompt. The supervisor returns to
   conversational mode but the user doesn't see a clear prompt to type.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/extension.ts` — batch completion handler, `/orch-integrate` command, supervisor activation/deactivation
- `extensions/taskplane/supervisor.ts` — `transitionToRoutingMode()`, batch completion messages, routing prompt
- `extensions/taskplane/messages.ts` — `ORCH_MESSAGES` constants for user-facing text

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/messages.ts`
- `extensions/tests/*` (new or modified tests)

## Steps

### Step 0: Preflight

- [ ] Read the batch completion flow in `extension.ts` to understand what happens when a batch finishes
- [ ] Read `transitionToRoutingMode()` in `supervisor.ts` to understand post-batch supervisor behavior
- [ ] Read `/orch-integrate` command handler to understand current merge flow
- [ ] Read `ORCH_MESSAGES` in `messages.ts` for existing message patterns
- [ ] Check if `gh api` is available for branch protection detection

### Step 1: Make /orch-integrate obvious after batch completion

After a batch completes (all tasks succeeded or partial success):
1. Display a clear, prominent message explaining that work is on the orch branch
2. Show the exact command to run: `/orch-integrate` or `/orch-integrate --pr`
3. Include this in both the supervisor's batch summary and the engine's completion message
4. The message should appear even if the supervisor is not active (direct engine output)

Example message:
```
✅ Batch complete — 3/3 tasks succeeded.

Your changes are on branch orch/henrylach-20260324T002248.
To bring them into your working branch:

  /orch-integrate        — merge directly
  /orch-integrate --pr   — create a pull request

```

**Artifacts:**
- `extensions/taskplane/extension.ts` and/or `extensions/taskplane/messages.ts` (modified)
- `extensions/taskplane/supervisor.ts` (modified — routing mode transition message)

### Step 2: Detect branch protection and guide to --pr

When `/orch-integrate` is invoked (without `--pr`):
1. Before attempting the merge, check if the target branch has protection rules
2. Use `gh api repos/{owner}/{repo}/branches/{branch}/protection` to detect protection
   - If `gh` is not available, skip detection (graceful degradation)
   - If protection is detected, warn the user and suggest `--pr` instead
3. If the merge fails due to protection, catch the error and provide a clear
   message: "Branch {branch} is protected. Use `/orch-integrate --pr` instead."

**Important:** Don't block on detection — if `gh` is unavailable or the API call
fails, proceed with the merge attempt and handle failure gracefully.

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified — integrate command handler)

### Step 3: Fix post-batch input prompt visibility

After batch completion, ensure the user sees a clear prompt in the terminal:
1. When supervisor transitions to routing mode, send a visible message that
   invites interaction (not just a system notification)
2. Ensure the pi input prompt is visible (not hidden behind batch output)
3. The supervisor's conversational greeting should clearly signal "I'm ready for input"

This may be partially a pi framework issue (the input field rendering), but we
can mitigate by sending a clear follow-up message that forces the TUI to redraw.

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified — routing transition message)
- `extensions/taskplane/extension.ts` (modified — batch completion handler)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Run tests: `cd extensions && npx vitest run`
- [ ] Add tests for: integrate message appears after batch completion
- [ ] Add tests for: branch protection detection (gh available vs unavailable)
- [ ] Add tests for: integrate command shows protection warning

### Step 5: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:** None

**Check If Affected:**
- `docs/reference/commands.md` — if /orch-integrate behavior changes
- `docs/how-to/troubleshoot-common-issues.md` — add branch protection guidance

## Completion Criteria

- [ ] Clear integrate guidance displayed after batch completion
- [ ] Branch protection detected before merge attempt (when gh available)
- [ ] Graceful error message when merge fails due to protection
- [ ] Visible prompt/greeting after batch completion
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-052): complete Step N — description`
- **Bug fixes:** `fix(TP-052): description`
- **Tests:** `test(TP-052): description`

## Do NOT

- Make `gh` CLI a hard requirement — gracefully degrade when unavailable
- Change the /orch-integrate merge logic itself (only add pre-checks and messages)
- Modify batch execution or wave logic
- Change supervisor activation/deactivation lifecycle

---

## Amendments (Added During Execution)
