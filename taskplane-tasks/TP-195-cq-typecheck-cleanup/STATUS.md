# TP-195: Code-quality typecheck cleanup — Status

**Current Step:** Step 1: Plan the cleanup strategy
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
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
**Status:** ✅ Complete

- [x] On `main` (lane worktree, fresh from TP-191 merge) — verified with `git log --oneline -5` (HEAD = 19954aee, TP-193 merged via PR #572)
- [x] TP-191 confirmed merged (`npm run typecheck` script exists in `package.json`, `extensions/tsconfig.ci.json` exists)
- [x] TP-191 STATUS.md Discoveries read for the typecheck error inventory baseline
- [x] Live `npm run typecheck` error count captured: **264 errors** (vs sage's ~267 estimate; close enough)
- [x] Live category breakdown captured (see Discoveries → 'Live error inventory')
- [x] Baseline test count recorded: 3625 tests, **3624 passing / 1 skipped / 0 failed** (matches TP-191 baseline)
- [x] Decision recorded: **runtime source first** (~68 errors across 8 files), then tests (~196 errors). Source-first lets type signatures settle before fixing test mocks against them.

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
| Live error count: 264 (vs sage's ~267 estimate) | Authoritative target for this task | Step 0 |
| Runtime-source errors: 68 across 8 files | Tackle first (Step 3) | execution.ts(20), engine.ts(11), resume.ts(8), persistence.ts(8), extension.ts(8), config-loader.ts(5), settings-tui.ts(4), merge.ts(4) |
| Test-side errors: 196 across ~38 files | Tackle second (Step 4) | top: workspace-config.integration.test.ts(26), resume-bug-fixes.test.ts(26), non-blocking-engine.test.ts(18), orch-state-persistence.test.ts(10), auto-integration.integration.test.ts(10) |
| Test baseline: 3624 / 1 skipped / 0 failed | Target to preserve | `npm run test:fast` |

### Live error inventory (Step 0 baseline)

Total: **264 errors** in 45 files (8 source + 37 test files).

**Top categories:**

| Category | Count | Meaning |
|---|---|---|
| TS2339 | 63 | Property does not exist on type — investigate per-occurrence (real bug or missing type field) |
| TS2741 | 52 | Property X missing in type — mock object incomplete vs schema |
| TS2345 | 30 | Argument not assignable — caller's shape wrong |
| TS2554 | 23 | Wrong number of arguments — API signature drift |
| TS2367 | 21 | Comparison appears unintentional — often catches real bugs |
| TS2322 | 19 | Type assignment mismatch |
| TS2739 | 12 | Type missing properties from another type |
| TS2769 | 7 | No overload matches call |
| TS2353 | 7 | Object literal may only specify known properties |
| TS2352 | 7 | Conversion of type may be a mistake (between/cast) |
| TS2559 | 4 | Type has no properties in common |
| TS2347 | 4 | Untyped function calls may not accept type arguments |
| TS2578 | 3 | Unused @ts-expect-error directive |
| TS2304 | 3 | Cannot find name |
| TS2871 | 2 | Expression is always nullish |
| TS2694 | 2 | Namespace has no exported member |
| TS2305 / TS2552 / TS2551 / TS2355 / TS2561 | 1 each | Various |

**Per-file breakdown (top runtime-source files — Step 3 targets):**

| File | Count |
|---|---|
| extensions/taskplane/execution.ts | 20 |
| extensions/taskplane/engine.ts | 11 |
| extensions/taskplane/resume.ts | 8 |
| extensions/taskplane/persistence.ts | 8 |
| extensions/taskplane/extension.ts | 8 |
| extensions/taskplane/config-loader.ts | 5 |
| extensions/taskplane/settings-tui.ts | 4 |
| extensions/taskplane/merge.ts | 4 |

**Per-file breakdown (top test files — Step 4 targets):**

| File | Count |
|---|---|
| extensions/tests/workspace-config.integration.test.ts | 26 |
| extensions/tests/resume-bug-fixes.test.ts | 26 |
| extensions/tests/non-blocking-engine.test.ts | 18 |
| extensions/tests/orch-state-persistence.test.ts | 10 |
| extensions/tests/auto-integration.integration.test.ts | 10 |
| extensions/tests/supervisor-recovery-flows.test.ts | 8 |
| extensions/tests/supervisor-onboarding.test.ts | 8 |
| extensions/tests/retry-matrix.test.ts | 8 |
| extensions/tests/partial-progress.integration.test.ts | 8 |
| extensions/tests/orch-supervisor-tools.test.ts | 7 |
| extensions/tests/monorepo-compat-regression.test.ts | 6 |
| extensions/tests/path-resolver-pi-scope.test.ts | 5 |
| extensions/tests/discovery-routing.test.ts | 5 |
| ... 24 more files | 1–4 each |


---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 17:56 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 17:56 | Step 0 started | Preflight |
| 2026-05-10 | Step 0 complete | 264 errors in 45 files; baseline tests 3624/1/0 |

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
