# Task: TP-186 - Fix worker death-spiral via explicit step-completion protocol

**Created:** 2026-05-06
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Single-file template change with one optional engine guard, but the change governs the order-of-operations contract for **every** worker at Review Level ≥ 1. Behavioral risk is high (subtly wrong wording could cause workers to skip reviews entirely or never mark steps complete), so plan + code review are both essential. Test review is nice-to-have but not blocking — the existing test infrastructure for prompt patterns is well-established.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-186-worker-step-completion-protocol/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix the **worker death-spiral** bug ([#537](https://github.com/HenryLach/taskplane/issues/537), behavioral pattern documented in [#542](https://github.com/HenryLach/taskplane/issues/542), partially diagnosed in earlier issue [#510](https://github.com/HenryLach/taskplane/issues/510)).

**The bug:** the worker prompt has an implicit (not enforced) ordering assumption around when to mark a step complete in `STATUS.md` versus when to call `review_step` for code review. When a worker:
1. marks a step `[x] complete` in STATUS,
2. commits the step,
3. THEN calls `review_step(step=N, type='code')`,
4. and the reviewer returns `REVISE`,

…the worker enters an unresolvable contradiction (STATUS says done, reviewer says not). It cannot self-recover because the prompt has no recovery recipe for "I marked this done but reviewer wants a revision". The worker spins through 3 no-progress iterations until the orch's safety mechanism kills the lane. **Entire batch is a write-off** — recovery requires manual git surgery (~15 min per occurrence).

This was observed in production batch `20260506T105850` against the user's `emailgistics-astro` project. The same anti-pattern recurred in the successful retry batch (`20260506T131717` Step 3) and only didn't trigger the death-spiral because the in-flight review happened to return `APPROVE`. **It's structural, not random.**

**The fix:** make the order-of-operations contract explicit in `templates/agents/task-worker.md`, and add a recovery recipe for the "marked complete then REVISE arrived" case. Optionally add an engine-side guard in `review_step` that refuses to run on a step already marked Complete (with a clear error message instructing the worker to follow the recovery recipe).

**Why this matters:** until this fix ships, **Review Level ≥ 2 is unsafe in production**. The bug is recurring and operator-visible (45-minute batch dies with no progress). It's the highest-priority correctness fix on the queue.

## Dependencies

- **None** (TP-184 already shipped — bridge tools fix is a prerequisite for `review_step` to fire at all, which is itself a prerequisite for this bug to be observable; both already merged).

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `templates/agents/task-worker.md` — base worker prompt. Find the section describing review handling (search for `review_step`, `APPROVE`, `REVISE`). The new ordering rule and recovery recipe go near there. Note existing "MUST NOT" rules (e.g., "Workers MUST NOT add, remove, or renumber steps during execution") as the structural model for the new rule.
- `extensions/taskplane/agent-bridge-extension.ts` lines ~599+ for the `review_step` tool registration. If implementing Option B (engine-side guard), the guard goes here — read STATUS.md from the worker's task folder, check for `[x]` on the target step's checkboxes / `Status: ✅ Complete` heading, and return a refusal verdict if so.
- Issue #537 body — concrete reproduction, evidence from production batch, two fix options A and B.
- Issue #542 body — the underlying behavioral pattern (recurring even in successful runs).
- Issue #510 body — earlier partial diagnosis ("Lane-runner should enforce STATUS.md checkpoint discipline at step boundaries"). Contains useful framing; should be **closed as superseded** by this task when the fix merges.
- `templates/agents/task-reviewer.md` — read to understand reviewer's verdict format (APPROVE / REVISE / RETHINK) and the REVISE feedback structure. The recovery recipe must compose with this.

## Environment

- **Workspace:** `templates/agents/` + `extensions/taskplane/` + `extensions/tests/`
- **Services required:** None

## File Scope

- `templates/agents/task-worker.md` — **PRIMARY**. Add explicit Order of Operations section + Recovery Recipe for "marked complete then REVISE arrived" + Forbidden behaviors callout. Insert near the existing review-handling content. Match the style/tone/structure of the existing "Workers MUST NOT add, remove, or renumber steps" callout.
- `extensions/taskplane/agent-bridge-extension.ts` — **OPTIONAL** (Option B from #537). If implementing the tool-side guard: in the `review_step` handler, before spawning the reviewer, read `<task-folder>/STATUS.md`. If the target step's heading shows `**Status:** ✅ Complete` OR all checkboxes within that step's section show `[x]`, return a refusal that instructs the worker to follow the recovery recipe (revert STATUS, commit, re-call). Do NOT add a guard for the `plan` review type — only `code` and `test` types should be guarded (plan reviews fire BEFORE implementation).
- `extensions/tests/worker-step-completion-protocol.test.ts` (NEW) — covers:
  1. The base prompt now contains the explicit Order of Operations rule
  2. The base prompt contains the Recovery Recipe with the keyword "revert"
  3. The base prompt's Forbidden callout names the specific anti-pattern
  4. (If Option B implemented) The `review_step` guard returns a refusal when STATUS shows the step complete
  5. (If Option B implemented) The `review_step` guard does NOT block the `plan` review type
- `CHANGELOG.md` — Unreleased / Fixed entry crediting issue #537 and noting the structural protocol fix.

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it.

### Step 0: Preflight

- [ ] On `main`, working tree clean (lane worktree)
- [ ] Baseline test pass: `cd extensions && npm run test:fast` — record count (post-v0.28.5: should be 3452 or higher)
- [ ] Read all Tier 3 context files
- [ ] Read issue #537, #542, #510 bodies in full — understand the recurring pattern, not just the symptom
- [ ] Decide whether to implement Option A only, or Option A + Option B. **Default decision: A + B.** Document the decision and rationale in STATUS.md Discoveries before proceeding.

### Step 1: Plan the prompt edits and decide on Option B scope

> ⚠️ Plan-review checkpoint. The reviewer should evaluate the wording of the new
> Order of Operations rule and Recovery Recipe BEFORE implementation. Wording
> drift here causes silent worker behavioral regressions across all future runs.

- [ ] Draft the new Order of Operations section (numbered list of 5–6 steps from "Implement" to "Move to step N+1") matching the rubric in #537 Option A
- [ ] Draft the Recovery Recipe for "marked complete then REVISE arrived" — must specify: (a) revert STATUS (un-check, set Status back to In Progress), (b) commit the revert with `chore(<TASK-ID>): revert premature step-N completion`, (c) handle REVISE through the normal recipe (read review file, fix, commit fix, re-call review_step)
- [ ] Draft the Forbidden callout — match the style of existing "Workers MUST NOT" rules
- [ ] If implementing Option B: design the guard's STATUS.md inspection logic, the refusal message text, and confirm it matches the Recovery Recipe wording (so workers see consistent guidance from both prompt and tool)
- [ ] Write the full draft into `STATUS.md` (or a separate scratch file in the worktree) for plan review

**Artifacts:**
- (no source changes yet — drafts only, for plan review)

### Step 2: Apply the prompt edits to `templates/agents/task-worker.md`

> ⚠️ Per the new Order of Operations rule itself: do NOT mark this step
> `Complete` until the code review at Step 5 has returned APPROVE.

- [ ] Insert the Order of Operations section
- [ ] Insert the Recovery Recipe section
- [ ] Insert the Forbidden callout
- [ ] Verify no other section in the prompt contradicts the new rules (search for "mark complete", "STATUS.md", "review_step" across the file)

**Artifacts:**
- `templates/agents/task-worker.md` (modified — primary deliverable)

### Step 3: (Optional) Implement Option B engine-side guard

If the Step 0 decision was A-only, skip this step.

- [ ] Add the STATUS.md inspection helper (probably a small utility — read file, find target step's heading, scan its checkboxes + Status line)
- [ ] Wire the helper into the `review_step` tool handler in `agent-bridge-extension.ts`
- [ ] Apply ONLY to `code` and `test` review types (do NOT block `plan` reviews — those fire pre-implementation, when STATUS is correctly empty)
- [ ] Refusal message text must match the Recovery Recipe wording from Step 2 verbatim — operators reading both should see the same instructions

**Artifacts:**
- `extensions/taskplane/agent-bridge-extension.ts` (modified — add guard in review_step handler)

### Step 4: Add tests

- [ ] Create `extensions/tests/worker-step-completion-protocol.test.ts`
- [ ] Source-pattern tests against `templates/agents/task-worker.md`:
  - Order of Operations section is present (e.g., contains "Order of operations" heading and the keyword "MUST")
  - Recovery Recipe is present (contains "revert" and the specific commit-message pattern)
  - Forbidden callout names the specific anti-pattern
- [ ] (If Option B implemented) Tests against the guard:
  - Guard returns refusal when STATUS shows target step Complete
  - Guard does NOT block the plan review type
  - Guard's refusal message matches the Recovery Recipe text
- [ ] Run targeted: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/worker-step-completion-protocol.test.ts`

**Artifacts:**
- `extensions/tests/worker-step-completion-protocol.test.ts` (new)

### Step 5: Testing & Verification

> ZERO test failures allowed. Full quality gate.

- [ ] Run FULL fast suite: `cd extensions && npm run test:fast` — pass count = baseline + N (N = number of new tests)
- [ ] Run integration suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts tests/*.integration.test.ts`
- [ ] CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor`
- [ ] **Code review checkpoint**: at this step, call `review_step(step=5, type='code', baseline=<sha-before-step-2>)`. Per the new Order of Operations rule, do NOT mark Step 2 (or this step) complete in STATUS until APPROVE.

### Step 6: Documentation & Delivery

- [ ] Update `CHANGELOG.md` Unreleased / Fixed entry: "Worker death-spiral when code review returns REVISE on a step already marked Complete in STATUS (TP-186, #537, #542). Adds explicit Order of Operations rule and Recovery Recipe to the base worker prompt; [if Option B] adds engine-side `review_step` guard refusing to run on already-completed steps."
- [ ] Add a comment to issue #510 noting it's superseded by this fix (don't close yet — the supervisor can confirm at integration time)
- [ ] Discoveries logged in STATUS.md (especially: did the prompt edit cause any unexpected interactions with the existing review-handling text? did the Option B guard catch any test fixtures that were modeling the anti-pattern?)

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — Unreleased / Fixed entry as described in Step 6
- `templates/agents/task-worker.md` — primary deliverable (the Order of Operations + Recovery Recipe content IS the documentation)

**Check If Affected:**
- `templates/agents/task-reviewer.md` — verify the reviewer's REVISE-handling guidance still composes correctly with the new worker recovery recipe (specifically: the reviewer should keep returning REVISE on subsequent calls if the issues aren't actually addressed, NOT skip review just because the worker reverted)
- `docs/explanation/architecture.md` — if it documents the review flow, update to reflect the explicit ordering. Likely no change needed.
- `skills/create-taskplane-task/SKILL.md` — references review levels; verify nothing contradicts the new ordering. Likely no change needed.

## Completion Criteria

- [ ] `templates/agents/task-worker.md` contains the explicit Order of Operations rule with the 5-or-6 step sequence
- [ ] `templates/agents/task-worker.md` contains the Recovery Recipe for "marked complete then REVISE arrived"
- [ ] `templates/agents/task-worker.md` contains the Forbidden callout naming the anti-pattern explicitly
- [ ] (If Option B) `review_step` tool handler refuses to run on already-complete steps with a message matching the Recovery Recipe
- [ ] (If Option B) Plan reviews are NOT blocked by the new guard
- [ ] New tests cover all the above behaviors
- [ ] Full test suite passing
- [ ] CHANGELOG entry added crediting #537 and #542

## Git Commit Convention

- **Step completion:** `fix(TP-186): complete Step N — description`
- **Tests:** `test(TP-186): add worker step-completion protocol tests`
- **Docs:** `docs(TP-186): CHANGELOG entry for #537 + #542 death-spiral fix`
- **Hydration:** `hydrate: TP-186 expand Step N checkboxes`

## Do NOT

- **Do not** silently change the existing review-handling guidance in `templates/agents/task-worker.md` while adding the new content — additions should be explicit and the existing text should be preserved or carefully merged
- **Do not** add the Option B guard to the `plan` review type. Plan reviews fire BEFORE implementation; STATUS being incomplete is correct at that point
- **Do not** widen scope to address other issues from the same dump (#538, #539, #540, #541, #543) — those are TP-187 and TP-188 separately
- **Do not** modify the worker prompt's hydration rules or step-discovery rules — those are unrelated to this fix
- **Do not** close issues #537 / #542 / #510 from within this task — leave that to the supervisor at integration time
- **Do not** push directly to `main` — branch + PR per AGENTS.md branching policy

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
