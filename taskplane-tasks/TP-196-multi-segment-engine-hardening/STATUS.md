# TP-196: Multi-segment engine hardening — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** M

> **Hydration:** Worker expands Steps 2-5 with concrete per-file checkboxes
> after Step 1 plan-review APPROVE. Each step maps to one of the 4 absorbed
> issues (#462, #502, #503, #508).

> **⚠️ Post-TP-194 hard-gate environment.** All four code-quality gates
> (typecheck, lint, format:check, tests) are now required at PR time. The
> reviewer agent downgrades APPROVE → REVISE on any failure. Plan accordingly.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main` (fresh from v0.30.0) — branch `task/henrylach-lane-1-20260510T193434` based on post-v0.30.0 main (`6b5d9de6`)
- [x] All four gates pass on baseline (typecheck 0, lint 0, format:check 0, tests 3627 pass / 1 skip / 3628 total)
- [x] All four issue bodies read: #462, #502, #503, #508
- [x] Tier 3 context files read (lane-runner.ts segment scope, execution.ts monitor + tool registration, resume.ts reconciliation, discovery.ts skip logic, segment-scoped-lane-runner test file, types.ts segment types)
- [x] Live grep verification of `#502` condition pattern — `stepSegmentMap && currentRepoId` confirmed live at lane-runner.ts:398 and used inside the iteration loop; `isSegmentScoped` is computed at lane-runner.ts:458 and consumed at 483/499/642/672-673. The `TASKPLANE_ACTIVE_SEGMENT_ID` env var (line 672) and segment system-prompt overlay (line 642) are ALREADY gated on `isSegmentScoped`. The `request_segment_expansion` tool registration in `agent-bridge-extension.ts:97` keys off the env var (so indirectly gated, but not on the authoritative flag).
- [x] Decision: promote `SegmentScopeMode` to a first-class `'FULL_TASK' \| 'SEGMENT_SCOPED'` string-literal union exported from `types.ts`, plus a single computation helper `computeSegmentScopeMode(...)`. This keeps changes minimal vs. a TypeScript enum, plays well with JSON state serialization if ever needed, and lets call-sites compare `mode === "SEGMENT_SCOPED"` rather than tracking a boolean. (Recommendation logged in Discoveries.)

---

### Step 1: Plan all four fixes
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint.

- [ ] #462 design (3 guards + edge-case tests)
- [ ] #502 design (SegmentScopeMode promotion + gate sites)
- [ ] #503 design (test file structure + 4 scenarios)
- [ ] #508 design (pre-spawn check site + exit-condition semantics)
- [ ] Cross-issue coordination documented
- [ ] Drafts in Discoveries

---

### Step 2: Implement #502 first (foundational refactor)
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] `SegmentScopeMode` promoted to first-class type
- [ ] `lane-runner.ts` threads via lane config
- [ ] `execution.ts` env var + tool registration gated
- [ ] Scattered `stepSegmentMap && currentRepoId` checks unified
- [ ] Targeted + full fast suite pass

---

### Step 3: Implement #462 guards
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] Monitor guard in `resolveTaskMonitorState`
- [ ] Resume guard in `collectDoneTaskIdsForResume`
- [ ] Discovery safeguard
- [ ] 3-4 behavioral tests for edge cases
- [ ] Full fast suite passes

---

### Step 4: Implement #508 early-exit optimization
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] Pre-spawn segment-completion check
- [ ] Exit-condition wiring
- [ ] Behavioral test asserting wasted iteration skipped
- [ ] Full fast suite passes

---

### Step 5: Implement #503 prompt-injection regression tests
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] FULL_TASK assertions
- [ ] SEGMENT_SCOPED assertions
- [ ] Polyrepo single-segment regression
- [ ] Legacy/partial-marker fallback case
- [ ] Tests pass in isolation + full suite

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed. ALL FOUR GATES green.

- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npm run format:check` exit 0
- [ ] `npm run test:fast` passes (target: 3627+ + new tests; record final count)
- [ ] Full integration suite passes
- [ ] CLI smoke clean

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG entry under [Unreleased] → Fixed (or Internal)
- [ ] Discoveries logged: per-issue final fix summary
- [ ] Issue-close comment drafts for #462, #502, #503, #508 in Discoveries
- [ ] All commits include `TP-196` prefix

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Baseline gates green pre-implementation: typecheck 0, lint 0 (280 warnings/671 infos but exit 0), format:check 0, fast suite 3627 pass / 1 skip / 0 fail. | Note | baseline (post-v0.30.0) |
| `SegmentScopeMode` decision: implement as `export type SegmentScopeMode = "FULL_TASK" \| "SEGMENT_SCOPED"` in `types.ts` + a `computeSegmentScopeMode(stepSegmentMap, repoStepNumbers, currentRepoId, remainingSteps)` helper exported from `lane-runner.ts`. String-literal union (not enum) keeps the runtime cost zero and works cleanly with JSON serialization. The helper centralizes the 5-condition expression that currently lives inline at lane-runner.ts:458–465. | Step 2 plan | types.ts + lane-runner.ts |
| Pre-existing gating: `isSegmentScoped` already gates the env var `TASKPLANE_ACTIVE_SEGMENT_ID` (lane-runner.ts:672) AND segment-system-prompt overlay (line 642). The remaining drift risk #502 calls out is the scattered `stepSegmentMap && currentRepoId` conditional pattern (lines 398, 412, 517, 671, 1225, 1249, 1279) which can drift if updated unevenly. Replacing the bool-prone pattern with a single `mode === "SEGMENT_SCOPED"` reference satisfies #502 without changing runtime behavior. | Step 2 plan | lane-runner.ts |
| #508 latent-fix observation: the existing `if (remainingSteps.length === 0) break` at lane-runner.ts:419 already prevents iter-2 spawn when all segment checkboxes are complete (since TP-174 commit `3ef96db8` made `remainingSteps` use `isSegmentComplete`). However there is no regression test asserting "zero iterations spawned when all segment checkboxes are pre-complete", so the property is undefended. TP-196 will add an explicit early-exit check just before the `spawnAgent` call AND a behavioral test that asserts the spawn is skipped. | Step 4 plan | lane-runner.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created (bundles #462/#502/#503/#508) |
| 2026-05-10 23:34 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 23:34 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

**Why bundle 4 issues into one task:**

All 4 touch overlapping files (`lane-runner.ts`, `execution.ts`, `resume.ts`, `discovery.ts`, `segment-scoped-lane-runner.test.ts`). The segment-engine mental model is consistent across all of them — `.DONE` authority guards (#462), scope-mode unification (#502), regression tests for scope mode (#503), and early-exit optimization (#508). Bundling lets the worker reuse the context once and ship a coherent hardening pass.

If plan-review reveals a clear architectural split during Step 1, splitting is allowed but should be explicit (and the spec should document why).

**Sequencing within the task:**

#502 is implemented FIRST because it promotes `SegmentScopeMode` to a first-class type that #462 and #508 can also reference. Implementing it first avoids retrofitting the others. #503 (tests for #502) is the last implementation step — gives the most stable surface to write assertions against.

**Hard-gate compliance:**

Post-TP-194, the reviewer agent downgrades APPROVE → REVISE on any failing `typecheck` / `lint` / `format:check`. This is the first task to run entirely under hard gates; the worker should expect that gate failures will be surfaced in code reviews and cannot be ignored. Plan accordingly: don't break gates anywhere mid-step.
