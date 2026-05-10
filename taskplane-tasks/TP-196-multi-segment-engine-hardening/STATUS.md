# TP-196: Multi-segment engine hardening — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Worker expands Steps 2-5 with concrete per-file checkboxes
> after Step 1 plan-review APPROVE. Each step maps to one of the 4 absorbed
> issues (#462, #502, #503, #508).

> **⚠️ Post-TP-194 hard-gate environment.** All four code-quality gates
> (typecheck, lint, format:check, tests) are now required at PR time. The
> reviewer agent downgrades APPROVE → REVISE on any failure. Plan accordingly.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main` (fresh from v0.30.0)
- [ ] All four gates pass on baseline (typecheck 0, lint 0, format:check 0, tests 3627+)
- [ ] All four issue bodies read: #462, #502, #503, #508
- [ ] Tier 3 context files read (lane-runner.ts segment scope, execution.ts monitor + tool registration, resume.ts reconciliation, discovery.ts skip logic, segment-scoped-lane-runner test file)
- [ ] Live grep verification of `#502` condition pattern
- [ ] Decision: SegmentScopeMode promotion to first-class enum/type (recommendation in Discoveries)

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

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created (bundles #462/#502/#503/#508) |

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
