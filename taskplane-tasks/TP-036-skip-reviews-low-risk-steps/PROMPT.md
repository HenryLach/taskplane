# Task: TP-036 — Skip Reviews for Low-Risk Steps

**Created:** 2026-03-20
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Targeted change to review gating logic. Low blast radius (single function), existing patterns to follow.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-036-skip-reviews-low-risk-steps/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Modify the task-runner's review gating logic to skip plan reviews and code
reviews for Step 0 (Preflight) and the final step (Documentation & Delivery),
regardless of the configured review level. These steps don't benefit from
cross-model review — Step 0 is just reading files, and the final step is docs
and `.DONE` creation. Analysis of TP-030 showed that reviews R001, R002, R009,
R010 (for these steps) all returned low-value REVISE verdicts that added
overhead without catching real issues.

This saves 4 review agent invocations per task (~8-12 minutes per M-sized task
at current review durations).

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — review gating logic (search for `reviewLevel`, `planReview`, `codeReview`)

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`
- `extensions/tests/task-runner-review-skip.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read review gating logic in task-runner.ts — find where plan review and code review decisions are made
- [ ] Identify how step index and total steps are available at review decision points

### Step 1: Implement Review Skip Logic

- [ ] Add skip condition: if step index is 0 (Preflight) OR step index is the last step, skip plan review and code review regardless of review level
- [ ] Detect last step by comparing current step index to total parsed steps count
- [ ] Log when reviews are skipped: "Skipping plan/code review for Step 0 (Preflight)" / "Skipping review for final step (Documentation & Delivery)"
- [ ] Preserve existing review level behavior for all middle steps (no change)

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 2: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: review level 2, Step 0 — no plan or code review spawned
- [ ] Test: review level 2, final step — no plan or code review spawned
- [ ] Test: review level 2, middle step — plan and code review still spawn
- [ ] Test: review level 0 — no reviews anywhere (unchanged behavior)
- [ ] Test: single-step task (Step 0 is also final step) — no reviews
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 3: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal optimization, not user-facing behavior change)

**Check If Affected:**
- `docs/explanation/execution-model.md` — if review level documentation mentions per-step behavior
- `docs/explanation/review-loop.md` — if it describes step-level review decisions

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Step 0 and final step skip reviews at all review levels
- [ ] Middle steps unaffected
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-036): complete Step N — description`
- **Bug fixes:** `fix(TP-036): description`
- **Tests:** `test(TP-036): description`
- **Hydration:** `hydrate: TP-036 expand Step N checkboxes`

## Do NOT

- Change review level semantics for middle steps
- Remove the review level configuration entirely
- Modify reviewer or worker agent prompts (already done separately)
- Add configuration for which steps to skip (hardcode Step 0 and final step — keep it simple)

---

## Amendments (Added During Execution)
