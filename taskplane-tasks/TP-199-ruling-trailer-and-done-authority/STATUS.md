# TP-199: Ruling commit trailer validation and unified `.DONE` authority (#627 Stage 2b) — Status

**Current Step:** Step 4: Testing & Verification
**Status:** 🟡 In Progress
**Last Updated:** 2026-09-08
**Review Level:** 3
**Review Counter:** 4
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] TP-198 artifacts present (`ratification.ts` exports confirmed) — `validateRatification`, `isRatificationStale`, `readRatifications`, `parseRatificationLink` all exported
- [x] Full-suite baseline recorded (pass/fail counts, lint warning count)

**Baseline (Step 0):** 4092 tests, 4090 pass, 1 fail (`tests/project-config-loader.test.ts:1619` — pre-existing, unrelated to TP-199, repo-mode pointer test). Lint: 283 warnings, 675 infos.

---

### Step 1: `completion-authority.ts` — one predicate
**Status:** ✅ Complete

**Design (plan):**
- New module `completion-authority.ts`. To make the consolidation a literal
  no-behaviour-change move, I relocate `BlockingReviewGate`, `RatificationGateCtx`,
  `evaluateRatificationBlock`, and `findBlockingReviewGates` FROM `lane-runner.ts`
  INTO `completion-authority.ts` (re-imported by lane-runner). `formatBlockingGates`
  and `parseGateStepNumber` stay in lane-runner (pure formatting).
- `authorizeCompletion(ctx)` composes: `evaluateCompletionAuthority` (holds, never
  skipped) → when `isFinalSegment`, `findBlockingReviewGates(reviewsDir, ratifyCtx)`
  which itself does REVISE/RETHINK gates + linked-APPROVE ratification validity.
  Returns ALL blockers.
- `CompletionBlocker = { kind: "hold"|"review-gate"|"ratification"; ref; reason;
  gate?: BlockingReviewGate }`. The optional `gate` carries the raw record so the
  finalize path can keep `formatBlockingGates` output + `isInvalidRatification`
  detection byte-for-byte (behaviour-preservation). `CompletionDecision =
  {allowed:true} | {allowed:false; blockers}`.
- ctx extends the PROMPT baseline with optional `workingTreeDrift` (defaults to a
  clean probe) so the live finalize gate keeps its R004/R005 drift check while
  resume can omit it. Rationale logged here for the reviewer.
- Lane-runner refactor is scoped to THE FINALIZE PATH only: the post-loop held
  check (was `completionAuthority()`) and the finalize gate (was
  `findBlockingReviewGates(reviewsDir, finalizeRatifyCtx)`). In-loop step-marking/
  deferral uses of `completionAuthority()`/`findBlockingReviewGates` are left
  untouched (not the finalize decision; preserving behaviour). Alert kinds
  (`unresolved-verdict`/`invalid-ratification`) and `review_gate_refusal`
  classification unchanged.

- [x] `authorizeCompletion(ctx)` composing holds → review gates → ratification, reporting all blockers; non-final segments skip review/ratification only
- [x] Lane-runner finalize path consolidated onto it (alert kinds and classification unchanged) — moved `findBlockingReviewGates`/`evaluateRatificationBlock`/types into the new module; finalize gate + post-loop held check now call `authorizeCompletion`; in-loop step-marking uses left as-is
- [x] `tests/completion-authority.test.ts` scenarios (allowed / each blocker alone / all together / non-final segment) — 7 tests
- [x] Targeted tests pass (incl. held-state-runner, review-remediation-spawn, ratification-finalize) — 51/51

---

### Step 2: Resume `.DONE` acceptance uses the same predicate
**Status:** ✅ Complete

- [x] `collectDoneTaskIdsForResume` refuses `.DONE` when `authorizeCompletion` is not allowed (logged; reconciled as if absent) — reviewsDir resolved like donePath, headRevision/isAncestor from final-segment worktree when present, isFinalSegment true (frontier complete), holds from persistedState.holds
- [x] Behavioural tests: REVISE → not collected; unlinked APPROVE → collected; linked APPROVE w/o record → not collected — in completion-authority.test.ts
- [x] Targeted tests pass (incl. held-state-recovery, resume-bug-fixes, done-authority-multi-segment) — 78/78

---

### Step 3: `Taskplane-Ruling:` trailer validation
**Status:** ✅ Complete

**Module name:** `extensions/taskplane/ruling-trailer.ts` (separate module for clarity).

- [x] `parseRulingCitations` (trailer ids + prose claims) — in `ruling-trailer.ts`
- [x] `validateRulingCitations` → flags unknown-ruling / wrong-unit / prose-claim (id valid only if a hold binding this unit carries `ruling.id === id`)
- [x] Lane-runner post-iteration commit scan (after post-exit `drainAndSurfaceOutbox()`, `iterationStartSha..HEAD` via `git log --format=%H%x00%B%x00`) → STATUS log + `ruling_citation_flagged` audit entry (classification `diagnostic`) + one alert per iteration; no status/hold/stall effect
- [x] `templates/agents/task-worker.md` trailer contract
- [x] `tests/ruling-trailer.test.ts` parser/validator + behavioural (a)–(c) with a real git worktree — 12 tests
- [x] Targeted tests pass — ruling-trailer + held-state-runner 26/26
- [x] R002 fix: remove stale `latestReviewFilesPerGate` import from lane-runner.ts (lint warning back to baseline)
- [x] R002 fix: run Biome format on resume.ts / ruling-trailer.ts / ruling-trailer.test.ts (`format:check` exits 0)
- [x] R003 fix: resume passes the same fail-closed `workingTreeDrift` probe as the live finalize gate when the lane worktree exists (parity); runtime task artifacts stay exempt. New regression test `tests/resume-completion-drift.test.ts` (clean→collected, source drift→refused, runtime-only drift→collected)

---

### Step 4: Testing & Verification
**Status:** ✅ Complete

- [x] FULL test suite passing (vs Step 0 baseline) — 4117 tests, 4115 pass, 1 fail. The single failure (`project-config-loader.test.ts` → `6.3: repo mode — pointer is not consulted`) is the PRE-EXISTING baseline failure (present at Step 0, unrelated to TP-199, confirmed failing in isolation on this file). Net-new tests: +25 (completion-authority 10, ruling-trailer 12, resume-completion-drift 3). Two source-drift tests updated to the consolidated shape (issue-629 "share one scanner", review-boundary "#626 minimal").
- [x] typecheck 0 errors
- [x] lint at or below baseline — 283 warnings (== baseline)
- [x] format:check clean
- [x] CLI help + doctor — `help` exits 0. `doctor` exits 1 ONLY because this dev worktree has no `.pi/` project scaffolding (missing `taskplane-config.json` + `.pi/agents/*`); environmental, not a code regression (identical on baseline). All package/tooling checks in doctor pass.

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Primer: `Ruling citation flagged` alert guidance
- [ ] Spec status (Stage 2b)
- [ ] CHANGELOG `[Unreleased]` entry
- [ ] Discoveries logged

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
| 2026-09-08 | Task staged | PROMPT.md and STATUS.md created |
| 2026-09-08 01:17 | Task started | Runtime V2 lane-runner execution |
| 2026-09-08 01:17 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
| 2026-09-08 01:24 | Review R001 | plan Step 1: APPROVE |
| 2026-09-08 01:42 | Review R002 | code Step 3: REVISE |
| 2026-09-08 01:45 | Review R003 | code Step 3: REVISE |
| 2026-09-08 01:51 | Review R004 | code Step 3: APPROVE |
