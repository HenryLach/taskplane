# Task: TP-069 - Extract Shared Verdict Helper

**Created:** 2026-03-25
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Pure refactor — extract duplicated code into a shared helper. No behavior change, no new patterns.
**Score:** 1/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-069-verdict-extraction-cleanup/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

The `review_step` tool handler in `task-runner.ts` has two nearly identical verdict extraction code paths (~60 lines each): one for the persistent reviewer path and one for the fallback fresh-spawn path. Both do: `extractVerdict()`, REVISE summary regex, `logReview()`, `logExecution()`, `updateStatusField()`, and result text construction. Extract into a shared helper. (#194)

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — search for `extractVerdict` to find both code paths (~2 locations in the review_step handler)

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`

## Steps

### Step 0: Preflight

- [ ] Search for `extractVerdict` in task-runner.ts — locate both verdict extraction blocks
- [ ] Confirm they are structurally identical (same logic, different variable sources)

### Step 1: Extract Shared Helper

Create a helper function inside the review_step handler scope (or at module level):

```typescript
function processReviewVerdict(
  reviewContent: string,
  outputPath: string,
  num: string,
  reviewType: string,
  stepNum: number,
  statusPath: string,
  suffix?: string,  // e.g., "(fallback)" for logging
): { verdict: string; resultText: string }
```

Replace both extraction blocks with calls to this helper.

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 2: Testing & Verification

> ZERO test failures allowed.

- [ ] Run targeted tests: `cd extensions && npx vitest run --changed`
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 3: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Completion Criteria

- [ ] Single shared helper replaces both verdict extraction blocks
- [ ] No behavior change — identical outputs for all verdict types
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `refactor(TP-069): complete Step N — description`

## Do NOT

- Change verdict extraction logic or add new verdict types
- Change the review_step tool signature
- Modify the persistent reviewer or fallback spawn logic

---

## Amendments
