# Task: TP-192 - Code-quality: clean up existing Biome lint errors in main

**Created:** 2026-05-10
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Mechanical cleanup. The errors are surface-level (unused vars, implicit any in `let` declarations, regex control characters, redeclared identifiers, unsafe `return` in `finally`) — Biome diagnostics carry exact file/line locations and most have safe auto-fixes. Plan review confirms the strategy (mechanical fixes vs hand-edits, per-error category) before commit. Code review skipped: changes are surface-level and the test suite is the actual correctness gate.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-192-cq-lint-cleanup/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Second of four sequenced task packets implementing the code-quality-gates spec ([`docs/specifications/taskplane/code-quality-gates.md`](../../docs/specifications/taskplane/code-quality-gates.md), section 6.2). Fix the existing Biome lint errors in `main` so TP-194 can promote lint to a gate without breaking the build.

The TP-191 inventory (recorded in TP-191's STATUS.md Discoveries) is the authoritative starting list. Per the recent CI run logs, the expected error categories are:

- `noUnsafeFinally` — Unsafe usage of `return` in a `finally` block
- `noImplicitAnyLet` × 5 — variables implicitly have the `any` type
- `noControlCharactersInRegex` — control character in regex
- `noRedeclare` × 2 — `AllocateLanesResult` and `resolveRepoRoot` redeclared in the same scope

If TP-191's actual inventory diverges from this expectation, the plan in Step 1 must adjust scope accordingly.

By the end of TP-192:
- `npm run lint` exits 0 on `main`.
- All fixes are surface-level — NO behavior changes, NO refactors beyond what each error specifically requires.
- All existing tests still pass.
- Each fix is committed with the TP-192 prefix and a description that names the rule fixed.

## Dependencies

**None** — TP-191 must be merged first (the lint scripts and Biome config exist after TP-191), but this task does not declare a runtime dependency parsed by the orchestrator. Operator schedules sequentially.

Informational cross-references for context:
- TP-191 (must be merged before TP-192 runs): introduces `npm run lint` and the Biome config that produces the inventory this task fixes.
- TP-193 (follows TP-192): formatter adoption — depends on a clean lint baseline so the format-only diff doesn't tangle with lint cleanup.
- TP-194 (follows TP-193): the actual gate flip — depends on lint being green on `main`.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/code-quality-gates.md` section 6.2 — operative for this task.
- `taskplane-tasks/TP-191-cq-prep-scripts-shims-tooling/STATUS.md` — the lint error inventory captured during TP-191's Step 4. **Required.**
- The specific files Biome reports errors in (the inventory will name them; load on demand).

## Environment

- **Workspace:** `extensions/` mostly (where the lint errors live)
- **Services required:** None

## File Scope

> File scope here is dynamic — driven by TP-191's inventory. Expected
> ~5-10 files in `extensions/taskplane/`. Worker should hydrate Step 2
> with the actual files after reading the inventory in Step 0.

- `extensions/taskplane/*.ts` (subset to be determined by inventory)
- `CHANGELOG.md` — `[Unreleased]` entry under `Internal`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] On `main` (lane worktree, fresh from TP-191 merge)
- [ ] TP-191 confirmed merged (verify `npm run lint` script exists and Biome is pinned in `devDependencies`)
- [ ] Read TP-191's STATUS.md Discoveries to capture the actual lint inventory (count, categories, files)
- [ ] Baseline test count recorded (target: 3624 passing post-TP-190; TP-191 didn't change tests)
- [ ] `npm run lint` re-run locally to confirm inventory; record final count + per-rule breakdown in Discoveries

### Step 1: Plan the cleanup strategy per error category

> ⚠️ Plan-review checkpoint. Reviewer evaluates strategy choices.

- [ ] Categorize each error: **auto-fixable** (run `biome check --write` or `--apply`), **mechanical-but-manual** (e.g., add explicit type annotation for `noImplicitAnyLet`, escape control character for `noControlCharactersInRegex`), or **needs-thought** (e.g., `noRedeclare` may indicate a real architectural issue worth a follow-up note)
- [ ] For each category, document the fix approach in Discoveries
- [ ] Hydrate Step 2's checkboxes with one item per affected file
- [ ] Decision: any errors that should be **suppressed** (not fixed) via Biome `overrides` — e.g., a generated file or a test mock where the rule doesn't apply? Default: NO suppression. Only suppress if the spec or operator explicitly approves.

### Step 2: Apply fixes by category

> ⚠️ Code-review fires after this step (the only code review for this task — Review Level 1 means plan + this single code review at the end).

- [ ] **Auto-fixable group**: run `npx biome check --write <file>...` for the safe rules. Verify the diff is mechanical; commit with `chore(TP-192): apply Biome auto-fixes for <rule names>`
- [ ] **Mechanical-but-manual group**: hand-edit each error. Common patterns:
  - `noImplicitAnyLet`: add explicit type annotation (`let x: SomeType = ...` or `let x: unknown = ...` for cases where the type genuinely isn't known)
  - `noControlCharactersInRegex`: escape the control character explicitly via Unicode (`\u0000`-style) or use a character class
  - `noRedeclare`: rename one of the conflicting declarations (the shadowed one) — record which one was renamed in Discoveries so future `grep` works
  - `noUnsafeFinally`: refactor the `finally` block so the `return` happens via the surrounding try/catch's normal flow instead of inside the finally
- [ ] **Run targeted tests** for each modified file: `cd extensions && node --experimental-strip-types --no-warnings --import ./tests/loader.mjs --test tests/<related-file>.test.ts`
- [ ] After all fixes: `npm run lint` exits 0
- [ ] Full fast suite passes

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] FULL fast suite passes: `cd extensions && npm run test:fast` (target: 3624+ passing / 1 skipped / 0 failed)
- [ ] FULL integration suite passes
- [ ] `npm run lint` exits 0 (the gate this task delivers)
- [ ] `npm run typecheck` count is unchanged or smaller (no regressions; some `noImplicitAnyLet` fixes may incidentally reduce typecheck errors — record the new baseline)
- [ ] `npm run format:check` exit status unchanged (formatter still disabled)
- [ ] CLI smoke clean: `node bin/taskplane.mjs help`, `node bin/taskplane.mjs doctor`

### Step 4: Documentation & Delivery

- [ ] CHANGELOG entry under `[Unreleased]` → `Internal`:
  - Title: `**Code-quality lint cleanup (TP-192)**`
  - Body: 1-paragraph summary listing the rule categories fixed and the file count
- [ ] Discoveries logged in STATUS.md (final per-rule breakdown, any noteworthy hand-edits)
- [ ] All commits include `TP-192` prefix; commits grouped by rule category for reviewer clarity

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — Internal entry per Step 4

**Check If Affected:**
- (None expected — this is a mechanical cleanup; no design or contract changes)

## Completion Criteria

- [ ] `npm run lint` exits 0
- [ ] All tests passing (3624+)
- [ ] Per-step plan review + final code review APPROVE'd
- [ ] CHANGELOG entry added
- [ ] No suppressions added without explicit operator approval

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `chore(TP-192): description (Biome <rule-name>)`
- **Auto-fix bulk commit:** `chore(TP-192): apply Biome auto-fixes for <rule names>`
- **Hand-edit commit:** `fix(TP-192): <file> — <rule-name> <brief-description>`

## Do NOT

- **Don't expand scope.** This task fixes the inventory captured in TP-191. New errors discovered mid-cleanup (e.g., from a fresh Biome run) get triaged: if they're trivially in scope, fix them; if they require design decisions, document in Discoveries and STOP. Add tech debt to CONTEXT.md instead of expanding.
- **Don't suppress errors via `// biome-ignore`** unless the spec or operator explicitly approves. Default: fix the error properly.
- **Don't do refactors beyond what each rule requires.** `noRedeclare` may indicate a code-smell, but renaming the shadowed declaration is the cleanup; restructuring the module is out of scope.
- **Don't run `biome format`** — formatter adoption is TP-193's scope.
- **Don't change `continue-on-error: true` in CI** — gate flip is TP-194's scope.
- **Don't load docs not listed in "Context to Read First."**
- **Don't commit without the `TP-192` prefix.**

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
