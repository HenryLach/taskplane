# Task: TP-068 - Fix Persistent Reviewer Reliability

**Created:** 2026-03-25
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Fixes a critical reliability issue affecting all task batches. Changes reviewer template prompting, adds early-exit detection in review_step handler, and adds model fallback + graceful skip paths. Touches task-runner.ts and templates.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-068-persistent-reviewer-reliability/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

The persistent reviewer (TP-057) fails silently because certain models (observed: `openai/gpt-5.3-codex`) call `wait_for_review` via `bash` instead of as a registered extension tool. The bash command doesn't exist, returns immediately, and the reviewer exits cleanly without processing any review. This cascading failure causes:
1. Persistent reviewer dies after ~12 seconds with 0 reviews processed
2. Fallback fresh-spawn reviewer produces non-standard verdict (UNKNOWN)
3. Worker continues without proper review feedback
4. Worker burns context and fails to complete

**Root cause (from TP-067 telemetry):**
```
Reviewer exit: exitCode 0, 1 tool call, 12 seconds
Last tool: "bash: wait_for_review"  ← bash, not the registered tool!
```

Implement three layers of defense:
1. Better prompting so the reviewer uses the registered tool correctly
2. Early-exit detection when the reviewer exits too quickly
3. Model fallback and graceful skip when reviews can't complete

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `templates/agents/task-reviewer.md` — current persistent mode instructions (search for "wait_for_review")
- `extensions/task-runner.ts` — search for `spawnPersistentReviewer` (~line 2292) and `isPersistentReviewerAlive` for the review_step handler
- `extensions/reviewer-extension.ts` — the `wait_for_review` tool registration

## Environment

- **Workspace:** `extensions/`, `templates/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `templates/agents/task-reviewer.md`
- `templates/agents/local/task-reviewer.md`
- `extensions/task-runner.ts`
- `extensions/reviewer-extension.ts`
- `extensions/tests/persistent-reviewer-context.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read the persistent mode section in `templates/agents/task-reviewer.md` — find the `wait_for_review` instructions
- [ ] Read `spawnPersistentReviewer()` in task-runner.ts — understand the spawn and signal flow
- [ ] Read `reviewer-extension.ts` — understand how `wait_for_review` is registered as a tool

### Step 1: Fix Reviewer Template Prompting

Update `templates/agents/task-reviewer.md` persistent mode instructions to be unambiguous about tool usage:

**Current (ambiguous):**
```
1. Call `wait_for_review()` to receive your first review request
```

**Fixed (explicit):**
```
1. Use the `wait_for_review` tool to receive your first review request.
   IMPORTANT: `wait_for_review` is a REGISTERED EXTENSION TOOL — call it
   the same way you call `read`, `write`, `edit`, or `grep`. Do NOT run it
   via `bash`, `shell`, or any other command-line tool. It is NOT a shell
   command.
```

Apply this clarification to every mention of `wait_for_review` in the template (initial call, subsequent calls, the summary section).

Also update the initial prompt in `spawnPersistentReviewer()` in task-runner.ts (search for `"You are a persistent reviewer"` — the inline prompt that tells the reviewer to call wait_for_review). Same clarification.

**Artifacts:**
- `templates/agents/task-reviewer.md` (modified)
- `templates/agents/local/task-reviewer.md` (modified — update comments)
- `extensions/task-runner.ts` (modified — initial prompt)

### Step 2: Add Early-Exit Detection

In the `review_step` handler in task-runner.ts, after spawning the persistent reviewer and writing the signal file, add detection for reviewer early exit:

**Pattern:** If the reviewer session exits within 30 seconds of spawn AND no verdict file was written, the reviewer likely failed to use the `wait_for_review` tool. This is a tool compatibility failure, not a normal review completion.

```typescript
// After signaling the reviewer and before polling for verdict:
// Check if reviewer exited suspiciously quickly
const spawnTime = Date.now();
// ... poll for verdict ...
// If reviewer exits within 30 seconds with no verdict:
if (reviewerExitedQuickly && !verdictExists) {
    // Tool compatibility failure — try fallback
    throw new Error("Persistent reviewer exited immediately — wait_for_review tool may not be supported by this model");
}
```

The existing fallback path (catch block in review_step) already handles this — it kills the persistent session and spawns a fresh reviewer. So this detection just needs to trigger the fallback faster rather than waiting for the 30-minute verdict poll timeout.

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 3: Add Graceful Skip on Double Failure

When BOTH the persistent reviewer AND the fallback fresh-spawn fail, the current behavior returns `UNAVAILABLE` which the worker ignores and continues. Improve this:

1. **Log clearly:** "⚠️ Reviews skipped for Step N — reviewer model could not process review request. Both persistent and fallback modes failed."
2. **Notify operator:** Write to STATUS.md execution log so the operator sees which steps had no review
3. **Don't block:** The task continues — reviews are quality assurance, not a blocking gate

Also: when the fallback reviewer produces a verdict that can't be parsed (the UNKNOWN issue), the `extractVerdict` function should be more tolerant. Check if the review file contains phrases like "Changes requested", "Needs revision", "Please revise" and map them to `REVISE`. This handles models that don't use the exact `### Verdict: REVISE` format.

**Artifacts:**
- `extensions/task-runner.ts` (modified — extractVerdict tolerance, skip logging)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Update `extensions/tests/persistent-reviewer-context.test.ts`:
  - Early-exit detection: reviewer exits in < 30s → triggers fallback
  - Verdict extraction tolerance: "Changes requested" maps to REVISE
  - Graceful skip logging: double failure produces clear operator notification
  - Template content: wait_for_review instructions explicitly say "registered tool, not bash"
- [ ] Run targeted tests: `cd extensions && npx vitest run tests/persistent-reviewer-context.test.ts`
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 5: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None beyond template changes

**Check If Affected:**
- `docs/explanation/review-loop.md` — may mention persistent reviewer behavior

## Completion Criteria

- [ ] Reviewer template unambiguously instructs tool usage (not bash)
- [ ] Early-exit detection triggers fallback within 30 seconds
- [ ] extractVerdict tolerates non-standard verdict formats
- [ ] Double failure produces clear operator notification and continues
- [ ] Shutdown signal written on all exit paths (fix orphan from #225)
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `fix(TP-068): complete Step N — description`

## Do NOT

- Remove the persistent reviewer feature — fix it, don't disable it
- Change the `wait_for_review` tool's behavior in reviewer-extension.ts
- Make reviews a blocking gate — they remain advisory
- Change the review level system (0-3)

---

## Amendments
