# Task: TP-073 - Worker Incomplete Exit Nudge

**Created:** 2026-03-26
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Targeted change in the task-runner's iteration loop. When a worker exits without completing all steps, the next iteration gets a specific prompt telling it exactly which steps remain. Low blast radius — changes the prompt construction for subsequent iterations only.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-073-worker-incomplete-exit-nudge/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

When a worker exits cleanly but steps remain incomplete, the next iteration receives the same generic prompt as the first iteration. The worker re-reads STATUS.md and figures out where to resume — but this wastes context re-discovering what it already did, and the model may repeat the same premature exit pattern.

Add a "nudge" to the worker prompt on subsequent iterations that explicitly tells the worker:
1. Which steps are already complete (don't re-read them)
2. Which steps remain incomplete (focus here)
3. That it exited prematurely last time and must not do so again
4. That its final action must be a tool call (STATUS.md update), not a text response

This complements the worker template fix (PR #243) by providing iteration-specific context that makes the worker more efficient and less likely to repeat mistakes.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — search for `runWorker` and the iteration loop (~line 2620+). Find where the worker prompt is constructed for each iteration. Look for `remainingSteps` and how the prompt is built.

## Environment

- **Workspace:** `extensions/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/task-runner.ts`

## Steps

### Step 0: Preflight

- [ ] Read the iteration loop in task-runner.ts — search for `runWorker` (~line 2620+)
- [ ] Find where the worker prompt is constructed — what does the worker receive on iteration 1 vs iteration 2+?
- [ ] Read `parseStatusMd()` — understand how step completion status is determined

### Step 1: Add Nudge Prompt for Subsequent Iterations

When `iter > 0` (not the first iteration) and there are incomplete steps:

1. Parse STATUS.md to get step completion status
2. Build a nudge prefix that's prepended to the worker prompt:

```
IMPORTANT: You exited on your previous iteration without completing all steps.
Do NOT repeat this — you must complete all remaining steps before stopping.

Completed steps (do not redo): Step 0, Step 1, Step 2, Step 3
Remaining steps (focus here): Step 4: Testing & Verification, Step 5: Documentation & Delivery

Your final action MUST be a tool call (update STATUS.md). Do NOT produce a
text-only response — that will terminate your session prematurely.
```

3. Prepend this to the existing worker prompt so the worker sees it immediately

**Where to add this:**
In the iteration loop, after `parseStatusMd()` determines remaining steps and before `runWorker()` is called. The prompt construction likely already lists remaining steps — augment it with the nudge when `iter > 0`.

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 2: Testing & Verification

> **SKIP automated test runs for this task.** The test infrastructure is being
> migrated to node:test in parallel (TP-074/TP-075). Running vitest now may
> produce false failures. Tests will be validated manually after integration.

- [ ] Build passes: `node bin/taskplane.mjs help`
- [ ] Verify the nudge prompt is constructed correctly by reading the source

### Step 3: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Completion Criteria

- [ ] Iteration 2+ workers receive explicit nudge about incomplete steps
- [ ] Nudge lists completed and remaining steps by name
- [ ] Nudge warns against text-only responses
- [ ] First iteration (iter 0) is unchanged
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-073): complete Step N — description`

## Do NOT

- Change the first iteration's prompt
- Change how steps are parsed or how completion is determined
- Change the iteration loop's control flow (max iterations, no-progress detection)
- Add new config options

---

## Amendments
