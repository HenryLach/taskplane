# Task: TP-195 - Code-quality: clean up the 267 typecheck errors uncovered by TP-191

**Created:** 2026-05-10
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** ~267 typecheck errors surfaced when TP-191 made `tsc --noEmit` runnable for the first time. Most are mechanical (mock objects missing required fields, schema drift between test fixtures and current `OrchestratorConfig` / `TaskRunnerConfig` shapes), but each fix needs care: a worker that takes shortcuts (`as any` casts, unsafe assertions, garbage default values) can satisfy the type checker while masking real bugs. Plan review catches the per-category strategy. Code review catches shortcuts and verifies fixes are semantically correct, not just type-satisfying.

Per-step reviews fit naturally — discovery, runtime-source fixes, test fixes, verification are independent concerns.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-195-cq-typecheck-cleanup/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Inserted packet in the code-quality-gates sequence. **Sage's post-TP-191 recommendation:** before TP-194's gate flip can fire (its CRITICAL pre-condition is `npm run typecheck` exits 0 on `main`), the 267 typecheck errors that TP-191 surfaced must be cleaned up.

Updated rollout sequence:

```
TP-191 (Prep)        → ✅ shipped — surfaced 267 typecheck errors
TP-192 (Lint cleanup) → in-flight
TP-193 (Format)       → in-flight
TP-195 (THIS TASK)    → typecheck cleanup
TP-194 (Gate flip)    → final, requires all prior merged
```

By the end of TP-195:
- `npm run typecheck` exits **0** on `main` against `extensions/tsconfig.ci.json` at current strictness (`strict: false, noImplicitAny: false`).
- All ~267 errors fixed via legitimate type-correctness changes — NOT via `as any` casts, `// @ts-expect-error` suppressions (without justification), or garbage default values.
- All existing tests still pass.
- TP-194's pre-condition check is satisfied.

**Strict mode is OUT of scope.** Achieving strict-mode-clean is a separate Tier-1.5 follow-up (the strictness ratchet, currently unassigned). TP-195 only gets typecheck-clean at CURRENT strictness.

## Dependencies

**None** — TP-191 must be merged first (this task assumes the typecheck script and tsconfig.ci.json exist), but no orchestrator-parsed dependency declared. Operator schedules sequentially per the updated spec.

Informational cross-references for context:
- TP-191 (must be merged first): introduces the typecheck script + tsconfig.ci.json + pi-shims that produce the 267-error baseline.
- TP-192 (independent): lint cleanup — operator's choice whether to merge before or after TP-195.
- TP-193 (independent): formatter adoption — operator's choice; the format pass should not affect typecheck error count, but it WILL touch every file so do it before TP-195 if you want a clean diff for the type fixes.
- TP-194 (must follow TP-195): gate flip; depends on typecheck exiting 0 on main.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/code-quality-gates.md` — operative spec, particularly section 9.1 (TS strictness — to confirm what TP-195 is NOT doing).
- `taskplane-tasks/TP-191-cq-prep-scripts-shims-tooling/STATUS.md` — TP-191's Discoveries (per-category typecheck error counts, files affected). **Required as the inventory baseline.**
- `extensions/types/pi-shims.d.ts` — the pi-package shims TP-191 created. Sage confirmed these are NOT the source of the 267 errors. If a fix in this task naturally requires extending the shim (e.g., a new pi import), do it; otherwise leave alone.
- The specific files Biome/tsc reports errors in (the inventory will name them; load on demand). Sage's split: ~198 errors in tests (mostly `extensions/tests/workspace-config.integration.test.ts` and `worktree-lifecycle.integration.test.ts`), ~69 in runtime source.

## Environment

- **Workspace:** `extensions/` (tests + source)
- **Services required:** None

## File Scope

> File scope here is dynamic — driven by TP-191's inventory and refined in
> Step 1's planning. Worker hydrates Steps 3 and 4 with concrete file lists
> after running `npm run typecheck` at task start.

- `extensions/tests/**/*.ts` (subset to be determined — most fixes here per sage's split)
- `extensions/taskplane/**/*.ts` (subset — runtime source fixes)
- `extensions/types/pi-shims.d.ts` (extended only if necessary)
- `CHANGELOG.md` — `[Unreleased]` entry under `Internal`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Steps 3
> and 4 expand at runtime with one item per affected file or per error category.

### Step 0: Preflight

- [ ] On `main` (lane worktree, fresh from TP-191 merge — verify with `git log --oneline -5`)
- [ ] TP-191 confirmed merged (verify `npm run typecheck` script exists and `extensions/tsconfig.ci.json` exists)
- [ ] Read TP-191 STATUS.md Discoveries for the typecheck error inventory baseline
- [ ] Re-run `npm run typecheck 2>&1 | grep -cE "error TS"` to capture the live error count for this task; record in Discoveries
- [ ] Re-run with category breakdown: `npm run typecheck 2>&1 | grep -E "error TS" | sed 's/.*error \(TS[0-9]*\).*/\1/' | sort | uniq -c | sort -rn` — record top 10 categories in Discoveries
- [ ] Baseline test count recorded (target: 3624 passing post-TP-190; this task should preserve the baseline)
- [ ] Decision recorded: order of attack (Step 3 vs Step 4 first). **Recommendation:** runtime source FIRST (~69 errors), then tests (~198 errors). Source changes can cascade into tests; doing source first lets test fixes settle the final type signatures.

### Step 1: Plan the cleanup strategy per error category

> ⚠️ Plan-review checkpoint. Reviewer evaluates strategy choices.

- [ ] For each error category (TS2339, TS2741, TS2345, TS2554, TS2367, TS2322, TS2305, TS2552, TS2769, ...), document the fix approach in Discoveries
- [ ] Identify which categories indicate **real bugs** vs **type drift**:
  - `TS2741` ("Property X is missing in type") usually means a mock object is incomplete vs schema — schema drift, not a bug. Add the missing field with the correct value (read the schema definition; don't guess).
  - `TS2339` ("Property does not exist") may indicate a real bug (the source assumes a field that doesn't exist in the type) OR a missing field in the type. Investigate per-occurrence.
  - `TS2345` ("Argument not assignable") usually means a mock or call-site is using the wrong shape. Fix the caller, NOT the callee's signature.
  - `TS2554` ("Wrong number of arguments") usually means an API signature changed. Fix the call site to match.
  - `TS2367` ("Comparison appears unintentional, different types") often catches real bugs (e.g., comparing `string` to `number`). Investigate carefully.
- [ ] For each category, document the **anti-shortcut policy**: NO `as any`, NO `// @ts-expect-error` suppressions without an explicit justification comment, NO garbage default values that aren't semantically correct, NO `Object.assign({}, ..., { ... } as Type)` casts.
- [ ] Decide: is there a shared helper (e.g., a `makeOrchestratorConfig()` factory in tests) that would dedupe the mock-object-missing-fields fixes? If yes, introducing the helper is the right move. Plan the helper's location and shape.

### Step 2: Apply mechanical auto-fixes (if any safe ones exist)

> ⚠️ Code-review fires after this step.

- [ ] Identify any errors where TypeScript itself suggests a definite fix (e.g., a missing import the IDE would auto-add). Apply via search-and-replace where unambiguous.
- [ ] DO NOT auto-fix anything that involves type assertions, casts, or default values — those need per-error judgment.
- [ ] Run `npm run typecheck` after each batch — record the new error count.
- [ ] Run targeted tests for any modified files: `cd extensions && node --experimental-strip-types --no-warnings --import ./tests/loader.mjs --test tests/<related-file>.test.ts`

### Step 3: Fix runtime-source errors (~69 errors)

> ⚠️ Code-review fires after this step.

> ⚠️ Hydrate: expand checkboxes with one item per affected source file
> based on Step 0/1's inventory. Group fixes by source-module for
> reviewer clarity (e.g., all engine.ts fixes in one commit, all
> persistence.ts fixes in another).

- [ ] Each source-side error fixed via correct type changes (NOT shortcuts)
- [ ] After each module's fixes: run targeted tests for that module + the integration tests that exercise it
- [ ] After ALL source fixes: full fast suite passes
- [ ] Typecheck error count drops by ~69; record new count in Discoveries

### Step 4: Fix test-side errors (~198 errors)

> ⚠️ Code-review fires after this step.

> ⚠️ Hydrate: expand checkboxes with one item per affected test file
> based on Step 0/1's inventory. Major suspects per sage:
> `extensions/tests/workspace-config.integration.test.ts` and
> `extensions/tests/worktree-lifecycle.integration.test.ts`.

- [ ] Mock-object drift fixes — for each `OrchestratorConfig` / `TaskRunnerConfig` mock, add the missing required fields with **semantically correct** values (read the schema; don't fill with garbage)
- [ ] If a shared helper makes sense (per Step 1 decision), introduce it
- [ ] After each test file's fixes: run that test file in isolation
- [ ] After all test fixes: full fast suite passes
- [ ] Typecheck error count drops to **0**

### Step 5: Verify pi-shim adequacy

- [ ] Run `npm run typecheck` and confirm 0 errors
- [ ] Re-confirm pi-shim adequacy: any new pi imports added during runtime-source fixes that need shim extensions?
- [ ] If shim extended: document in Discoveries

### Step 6: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] FULL fast suite passes: `cd extensions && npm run test:fast` (target: 3624+ passing / 1 skipped / 0 failed — must match TP-191's baseline; any regression is a bug introduced by this task)
- [ ] FULL integration suite passes
- [ ] `npm run typecheck` exits 0 (the gate this task delivers)
- [ ] `npm run lint` exit code unchanged from TP-191 baseline (no new lint errors introduced by the type fixes)
- [ ] `npm run format:check` exit code unchanged (still 0; formatter still disabled)
- [ ] CLI smoke clean: `node bin/taskplane.mjs help`, `node bin/taskplane.mjs doctor`

### Step 7: Documentation & Delivery

- [ ] CHANGELOG entry under `[Unreleased]` → `Internal`:
  - Title: `**Code-quality typecheck cleanup (TP-195)**`
  - Body: 1-2 paragraph summary covering: error count fixed (267 → 0), top categories addressed, the no-shortcuts policy enforced, that strict-mode is still NOT enabled (separate follow-up), and that this satisfies TP-194's pre-condition
- [ ] Discoveries logged in STATUS.md (final per-category breakdown, any noteworthy real bugs uncovered, any pi-shim extensions made)
- [ ] All commits include `TP-195` prefix; commits grouped by module/category for reviewer clarity

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — Internal entry per Step 7

**Check If Affected:**
- `extensions/types/pi-shims.d.ts` — extend only if naturally required by source-side fixes (don't preemptively expand)

## Completion Criteria

- [ ] `npm run typecheck` exits 0
- [ ] All tests passing (3624+)
- [ ] No `as any`, `@ts-expect-error`, or garbage-default shortcuts (verified via grep in plan review and code review)
- [ ] Per-step plan + code reviews APPROVE'd
- [ ] CHANGELOG entry added

## Git Commit Convention

Commits happen at **step boundaries** AND at **module/category boundaries** within Steps 3 and 4. All commits for this task MUST include the task ID for traceability:

- **Step completion:** `chore(TP-195): complete Step N — description`
- **Per-module fix:** `fix(TP-195): typecheck errors in <module> (<category counts>)`
- **Helper introduction:** `refactor(TP-195): introduce <helper-name> for mock-object-fixture dedup`

## Do NOT

- **Don't take shortcuts.** No `as any`, no `// @ts-expect-error` without an explicit justification comment naming the underlying TypeScript issue, no garbage default values to shut up the type checker.
- **Don't enable strict mode.** TP-195 fixes typecheck at CURRENT strictness (`strict: false, noImplicitAny: false`). Strict-mode work is a separate post-TP-194 follow-up.
- **Don't change behavior.** This task is type-correctness only. If a fix would change runtime behavior (e.g., changing a default value, adjusting an API signature in a way that affects callers), STOP and document in Discoveries — escalate to the operator.
- **Don't expand pi-shims preemptively.** Only extend `pi-shims.d.ts` if a fix in source legitimately requires a new pi import that isn't already shimmed. Don't try to anticipate strict-mode needs.
- **Don't run `biome format`** — formatter adoption is TP-193's scope.
- **Don't change `continue-on-error: true` in CI** — gate flip is TP-194's scope.
- **Don't load docs not listed in "Context to Read First."**
- **Don't commit without the `TP-195` prefix.**

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
