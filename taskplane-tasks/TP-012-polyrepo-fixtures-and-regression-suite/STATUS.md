# TP-012: Polyrepo Integration Fixtures and Regression Test Suite — Status

**Current Step:** Step 3: Testing & Verification
​**Status:** 🟨 In Progress
**Last Updated:** 2026-03-16
**Review Level:** 3
**Review Counter:** 5
**Iteration:** 3
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Build polyrepo fixture workspace
**Status:** ✅ Complete

- [x] Create shared polyrepo fixture builder in `extensions/tests/fixtures/polyrepo-builder.ts`
- [x] Define canonical fixture topology: non-git workspace root, docs repo (task root), api repo, frontend repo, with `.pi/taskplane-workspace.yaml`
- [x] Define task packet matrix: 6 tasks across 3 repos with cross-repo dependency graph spanning 3 waves
- [x] Add static batch-state fixture for workspace-mode polyrepo resume (`batch-state-v2-polyrepo.json`)
- [x] Add acceptance checks: workspace root is non-git, all repos are git-initialized, routing resolves correctly, dependency graph produces expected wave shape

---

### Step 1: Add end-to-end polyrepo regression tests
**Status:** ✅ Complete

- [x] Cover /task routing, /orch-plan, /orch execution, per-repo merge outcomes, and resume
- [x] Assert collision-safe naming artifacts and repo-aware persisted state fields

---

### Step 2: Protect monorepo compatibility
**Status:** ✅ Complete

- [x] Create `monorepo-compat-regression.test.ts` with explicit monorepo-mode contract guards covering: v1→v2 persistence (no repo fields), repo-mode discovery (no routing), repo-mode naming (no repoId segments), repo-mode merge (no per-repo grouping), and repo-mode resume (mode-agnostic resume eligibility)
- [x] Verify monorepo compat tests pass alongside polyrepo tests (full suite green)
- [x] Update `docs/maintainers/testing.md` with polyrepo fixture usage, when to use polyrepo vs monorepo tests, and fixture limitations
- [x] Targeted verification: `npx vitest run tests/monorepo-compat-regression.test.ts` and full suite

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit/regression tests passing
- [ ] Targeted tests for changed modules passing
- [ ] All failures fixed
- [ ] CLI smoke checks passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 23:59 | Task started | Extension-driven execution |
| 2026-03-15 23:59 | Step 0 started | Build polyrepo fixture workspace |
| 2026-03-15 23:59 | Task started | Extension-driven execution |
| 2026-03-15 23:59 | Step 0 started | Build polyrepo fixture workspace |
| 2026-03-16 00:03 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-16 | Step 0 implemented | polyrepo-builder.ts, batch-state-v2-polyrepo.json, polyrepo-fixture.test.ts — 32/32 tests pass, all 322 suite tests pass |
| 2026-03-16 00:04 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-16 00:14 | Worker iter 1 | done in 644s, ctx: 64%, tools: 67 |
| 2026-03-16 00:16 | Worker iter 1 | done in 697s, ctx: 74%, tools: 63 |
| 2026-03-16 00:17 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-16 00:17 | Step 0 complete | Build polyrepo fixture workspace |
| 2026-03-16 00:17 | Step 1 started | Add end-to-end polyrepo regression tests |
| 2026-03-16 00:19 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-16 00:19 | Step 0 complete | Build polyrepo fixture workspace |
| 2026-03-16 00:19 | Step 1 started | Add end-to-end polyrepo regression tests |
| 2026-03-16 00:21 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-16 00:21 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-16 | Step 1 implemented | polyrepo-regression.test.ts — 47 tests, all 369 suite tests pass |
| 2026-03-16 00:29 | Worker iter 2 | done in 467s, ctx: 57%, tools: 52 |
| 2026-03-16 00:30 | Worker iter 2 | done in 543s, ctx: 62%, tools: 72 |
| 2026-03-16 00:32 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-16 00:32 | Step 1 complete | Add end-to-end polyrepo regression tests |
| 2026-03-16 00:32 | Step 2 started | Protect monorepo compatibility |
| 2026-03-16 00:34 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-16 | Step 2 implemented | monorepo-compat-regression.test.ts — 34 tests, docs/maintainers/testing.md updated, all 403 suite tests pass |
| 2026-03-16 00:34 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-16 00:34 | Step 1 complete | Add end-to-end polyrepo regression tests |
| 2026-03-16 00:34 | Step 2 started | Protect monorepo compatibility |
| 2026-03-16 00:35 | Review R005 | plan Step 2: UNKNOWN |

## Blockers

*None*

## Notes

*Reserved for execution notes*
