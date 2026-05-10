# TP-195: Code-quality typecheck cleanup — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Steps 3 and 4 expand at runtime with one item per affected file
> based on the live `npm run typecheck` inventory captured in Step 0.
>
> **⚠️ Order of Operations rule (live in worker prompt):** do NOT mark a step
> `Complete` until that step's code review has returned APPROVE. This task
> is Review Level 2 — per-step plan + code reviews fire automatically.
>
> **Review structure:** per-step reviews. Expected: ~5 plan + ~5 code = ~10
> reviews total.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main` (lane worktree, fresh from TP-191 merge)
- [ ] TP-191 confirmed merged (`npm run typecheck` script exists, `extensions/tsconfig.ci.json` exists)
- [ ] TP-191 STATUS.md Discoveries read for the typecheck error inventory baseline
- [ ] Live `npm run typecheck` error count captured (target: ~267)
- [ ] Live category breakdown captured (top 10)
- [ ] Baseline test count recorded (target: 3624 passing post-TP-190)
- [ ] Decision recorded: order of attack (recommendation: source first, then tests)

---

### Step 1: Plan the cleanup strategy per error category
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint.

- [ ] Per-category fix approach documented in Discoveries
- [ ] Real-bug-vs-drift categorization complete
- [ ] Anti-shortcut policy reaffirmed in Discoveries (no `as any`, no unjustified `@ts-expect-error`, no garbage defaults)
- [ ] Decision on shared mock-helper: introduce or not?

---

### Step 2: Apply mechanical auto-fixes (if any safe ones exist)
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] Definite IDE-suggestable fixes applied via search-and-replace
- [ ] No assertions / casts / defaults applied here (deferred to per-error judgment in Steps 3/4)
- [ ] Typecheck error count after this step recorded
- [ ] Targeted tests pass

---

### Step 3: Fix runtime-source errors (~69 errors)
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

> ⚠️ Hydrate: expand checkboxes with one item per affected source file.

- [ ] Each source-side error fixed via correct type changes
- [ ] After each module: targeted tests pass
- [ ] Full fast suite passes
- [ ] Typecheck error count drops by ~69

---

### Step 4: Fix test-side errors (~198 errors)
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

> ⚠️ Hydrate: expand checkboxes with one item per affected test file.

- [ ] Mock-object drift fixes with semantically correct values
- [ ] Shared helper introduced (if Step 1 decision was yes)
- [ ] After each test file: that file passes in isolation
- [ ] Full fast suite passes
- [ ] Typecheck error count drops to 0

---

### Step 5: Verify pi-shim adequacy
**Status:** ⬜ Not Started

- [ ] `npm run typecheck` exits 0
- [ ] Pi-shim extensions (if any) documented in Discoveries

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passes (3624+ passing / 1 skipped / 0 failed — match TP-191 baseline)
- [ ] FULL integration suite passes
- [ ] `npm run typecheck` exits 0 (the gate this task delivers)
- [ ] `npm run lint` exit code unchanged from TP-191 baseline
- [ ] `npm run format:check` exit code unchanged
- [ ] CLI smoke clean

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG entry under [Unreleased] → Internal added
- [ ] Discoveries logged below (per-category breakdown, real bugs uncovered, pi-shim extensions)
- [ ] All commits include `TP-195` prefix; grouped by module/category

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None unless Step 0's TP-191 pre-condition check fails*

---

## Notes

**Sage's split (post-TP-191 review):**
- ~198 errors in tests (mostly `extensions/tests/workspace-config.integration.test.ts` and `worktree-lifecycle.integration.test.ts`)
- ~69 errors in runtime source

The above counts are sage's estimate based on a sample run; the live count in Step 0 may diverge slightly. Use the live count as the authoritative target.

**Top error categories (from sage's run on TP-191's merge commit):**

| Category | Count | Typical fix |
|---|---|---|
| TS2339 | 63 | Investigate per-occurrence — could be real bug or missing type field |
| TS2741 | 52 | Add missing field to mock object with correct schema-defined value |
| TS2345 | 30 | Fix the caller's argument shape, not the callee's signature |
| TS2554 | 23 | Update call site to match the API signature |
| TS2367 | 21 | Investigate carefully — often catches real bugs |
| TS2322 | 19 | Type narrowing or interface refinement |

**Anti-shortcut policy (CRITICAL):**

The whole point of typecheck-as-a-gate is catching real bugs. A worker that uses `as any` or `// @ts-expect-error` shortcuts to make the type checker happy is defeating the purpose. The plan reviewer and code reviewer must both verify that NO such shortcuts appear in the diff. If a fix legitimately needs a `@ts-expect-error`, the comment MUST justify it (e.g., naming the underlying TypeScript issue or pi-package shim limitation).

**Strict mode is OUT of scope.** This task delivers typecheck-clean at CURRENT strictness only (`strict: false, noImplicitAny: false`). Strictness ratchet is a separate post-TP-194 follow-up that can decide later whether to do all-at-once strict or per-flag ratchet.
