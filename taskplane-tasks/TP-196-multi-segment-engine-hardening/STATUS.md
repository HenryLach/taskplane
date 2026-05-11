# TP-196: Multi-segment engine hardening — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 8
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
**Status:** ✅ Complete

> ⚠️ Plan-review checkpoint.

- [x] #462 design (3 guards + edge-case tests) — see Discoveries `#462 plan`
- [x] #502 design (SegmentScopeMode promotion + gate sites) — see Discoveries `#502 plan`
- [x] #503 design (test file structure + 4 scenarios) — see Discoveries `#503 plan`
- [x] #508 design (pre-spawn check site + exit-condition semantics) — see Discoveries `#508 plan`
- [x] Cross-issue coordination documented — see Discoveries `cross-issue`
- [x] Drafts in Discoveries

---

### Step 2: Implement #502 first (foundational refactor)
**Status:** ✅ Complete

> ⚠️ Code-review fires after this step.

- [x] `SegmentScopeMode` promoted to first-class type (added `export type SegmentScopeMode = "FULL_TASK" | "SEGMENT_SCOPED"` to `types.ts`)
- [x] `lane-runner.ts` threads via `computeSegmentScopeMode()` helper exported alongside the other segment helpers; iteration loop now derives both `segmentScopeMode` and the legacy `isSegmentScoped` alias from a single computation
- [x] `execution.ts` env var + tool registration gated — already gated via `isSegmentScoped` on `TASKPLANE_ACTIVE_SEGMENT_ID` (lane-runner.ts:672) and `TASKPLANE_SEGMENT_ID` (line 673); the `request_segment_expansion` tool registration in `agent-bridge-extension.ts:97` keys off that env var so it inherits the gating. After TP-196 the env var is gated on a value derived from the authoritative mode, closing #502's drift concern.
- [x] Scattered `stepSegmentMap && currentRepoId` checks unified — the *runtime* mode decision now flows through one `computeSegmentScopeMode` call. The remaining structural `stepSegmentMap && currentRepoId` conditional patterns (e.g., snapshotSegmentCtx at line 357, post-loop block at 1270+, emitSnapshot signature at 1482/1606) encode the *shape* of available data, not the mode decision, and are intentionally preserved.
- [x] Targeted (62/62 in segment-scoped-lane-runner.test.ts) + full fast suite (3643 pass / 0 fail) pass

**R002 revision items:**
- [x] Gate the segment-scoped *prompt-injection* block on `isSegmentScoped` instead of the raw composite condition; added defensive WARN-log guard for the (should-never-trip) case where `currentStepMapping`/`mySegment` is missing.
- [x] Replace test `7.3` source-string assertion with mode-derived gating assertions (gate is `if (isSegmentScoped) {` and raw composite must NOT appear). Also updated `4.1` to assert the inner defensive guard instead of the now-removed `if (currentStepMapping && mySegment)`.
- [x] Re-run targeted (62/62) + full fast suite (3643 pass / 0 fail) + all four gates (all green).

**Files touched:** `extensions/taskplane/types.ts`, `extensions/taskplane/lane-runner.ts`, `extensions/tests/segment-scoped-lane-runner.test.ts`. New tests: 16 (sections 9.x — 11 unit tests for `computeSegmentScopeMode` + 5 source-analysis contracts for the unification).

---

### Step 3: Implement #462 guards
**Status:** ✅ Complete

> ⚠️ Code-review fires after this step.

- [x] Monitor guard in `resolveTaskMonitorState` — added optional `multiSegmentContext: { isFinalSegment, segmentId }` parameter; when `isFinalSegment === false` and `.DONE` is present, the function logs a WARN via `execLog` and SKIPS Priority 1, falling through to the lower priorities. `monitorLanes` populates this context from `task.task.segmentIds` + `task.task.activeSegmentId` (comparing the active segment to the last segment in the deterministic ID list).
- [x] Resume guard in `collectDoneTaskIdsForResume` — added internal `isSegmentFrontierCompleteForResume` helper. When a task has persisted segment records AND the frontier is incomplete (any segment not in `"succeeded"`/`"skipped"`), the `.DONE` marker is NOT honored: the task is excluded from the done set and a `console.warn` carrying `#462 guard` is emitted. The on-disk marker is left alone; resume will re-reconcile.
- [x] Discovery safeguard — added exported `checkDoneAuthoritySafeguard(taskFolder, logger?)` helper that emits a `[discovery] WARN ...#462 safeguard` warning when `.DONE` coexists with unchecked checkboxes in STATUS.md. Wired into `scanAreaForTasks` so every `.DONE` skip runs the check; behaviour of the scan itself is unchanged.
- [x] 3-4 behavioral tests for edge cases — added `extensions/tests/done-authority-multi-segment.test.ts` (14 tests across 3 describe blocks). Also updated the legacy `resume-segment-frontier.test.ts::keeps .DONE authoritative...` test to assert the NEW (#462-hardened) contract.
- [x] Full fast suite passes (3657 pass / 0 fail / 1 skip after Step 3; added net +14 tests vs. Step 2 baseline). Typecheck / lint / format:check all clean.

**Files touched:** `extensions/taskplane/execution.ts` (monitor guard signature + Priority 1 demotion + monitorLanes caller wiring); `extensions/taskplane/resume.ts` (resume guard + frontier helper); `extensions/taskplane/discovery.ts` (safeguard helper + scanAreaForTasks wiring); `extensions/tests/done-authority-multi-segment.test.ts` (new); `extensions/tests/resume-segment-frontier.test.ts` (updated TP-135 assertion to TP-196 contract); `extensions/tests/engine-runtime-v2-routing.test.ts` (widened slice window in 14.5 to accommodate the new monitor-guard prelude).

---

### Step 4: Implement #508 early-exit optimization
**Status:** ✅ Complete

> ⚠️ Code-review fires after this step.

- [x] Pre-spawn segment-completion check — added an explicit check in the iteration loop immediately AFTER `if (remainingSteps.length === 0) break;` and BEFORE `totalIterations++`. When `repoStepNumbers && currentRepoId` and ALL `repoStepNumbers` are `isSegmentComplete`, the loop logs `"Pre-spawn segment-completion check"` and `break`s.
- [x] Exit-condition wiring — `break` falls through to the existing post-loop completion handling (same path as the line-419 break), so no new branching is introduced.
- [x] Behavioral / source-analysis tests — 5 new tests (sections 10.0–10.4) in `segment-scoped-lane-runner.test.ts` covering: (10.1) check exists at the spawn boundary; (10.2) iterates `repoStepNumbers` with `isSegmentComplete`; (10.3) breaks out of the loop on all-complete; (10.4) gated so FULL_TASK iterations are unaffected.
- [x] Full fast suite passes (3662 pass / 0 fail / 1 skip after Step 4; net +5 tests vs. Step 3 baseline). Typecheck / lint / format:check all clean.

**Files touched:** `extensions/taskplane/lane-runner.ts` (pre-spawn check + extracted `shouldSkipSpawnForCompleteSegment` pure helper); `extensions/tests/segment-scoped-lane-runner.test.ts` (5 source-analysis tests, updated to assert the helper-based wiring); `extensions/tests/early-exit-segment-spawn-skip.test.ts` (new — 7 behavioural tests: 6 helper-level + 1 end-to-end `executeTaskV2` test that mocks `spawnAgent` and asserts call-count === 0 for completed segments).

**R005 revision items:**
- [x] Add end-to-end behavioural regression for #508 — `extensions/tests/early-exit-segment-spawn-skip.test.ts` mocks `spawnAgent` via `mock.module("../taskplane/agent-host.ts", ...)`, calls `executeTaskV2` with a fixture worktree whose segment checkboxes are all `[x]`, and asserts (a) `spawnAgentCallCount === 0`, (b) `iterations === 0`. Helper-level behavioural tests (6) cover the `shouldSkipSpawnForCompleteSegment` decision contract directly.
- [x] Reviewer suggestion: extract the inline check to a pure helper. Implemented as `export function shouldSkipSpawnForCompleteSegment(statusContent, repoStepNumbers, currentRepoId): boolean` next to the other segment helpers. The lane-runner now delegates to this helper instead of inlining the iteration.

---

### Step 5: Implement #503 prompt-injection regression tests
**Status:** 🟨 In Progress

> ⚠️ Code-review fires after this step.

- [x] FULL_TASK assertions — 3 behavioural tests (section 1.x) verifying the worker prompt does NOT include `Active segment ID`, the segment-scoped checkbox block, `Other segments in this step (NOT yours)`, or `Segment-scoped context`; the env hard-clears `TASKPLANE_ACTIVE_SEGMENT_ID` and `TASKPLANE_SEGMENT_ID`; the system prompt is BASE only (no segment overlay).
- [x] SEGMENT_SCOPED assertions — 3 behavioural tests (section 2.x) verifying the prompt INCLUDES `Active segment ID: TP-X::api`, `Your checkboxes for this step:`, `Other segments in this step (NOT yours`, and `Segment-scoped context`; env carries the active segment ID; system prompt appends the segment overlay AFTER base.
- [x] Polyrepo single-segment regression — 1 behavioural test (section 3.1) verifying that a task with segment markers for only ONE repo still injects the segment-scoped block (proves the worker is not silently scoped to step 0).
- [x] Legacy/partial-marker fallback case — 2 behavioural tests (section 4.x) covering: (4.1) task with NO segment markers at all falls back to FULL_TASK; (4.2) task with markers for OTHER repos but not the active repo also falls back to FULL_TASK.
- [x] Tests pass in isolation (9/9 in `segment-scope-mode-prompt.test.ts`) + full fast suite (3678 pass / 0 fail / 1 skip). Typecheck / lint / format:check all clean.

**Architectural note (#503 vs. current code):** The original #503 wording asks for assertions that the prompt includes `SegmentScopeMode: FULL_TASK` / `SegmentScopeMode: SEGMENT_SCOPED` literal text. That prose was deliberately removed in commit `97816c08` ("hard mode separation for worker segment scoping") in favor of separate system-prompt files ("the prompt IS the mode"). The tests here assert the architecturally-current contract — prompt content + env vars + system-prompt overlay reflect the mode — which preserves the intent of #503 while honoring the post-#502 design.

**Files touched:** `extensions/tests/segment-scope-mode-prompt.test.ts` (new, 9 behavioural tests across 4 describe blocks). No source changes required — #503 is a pure regression-test add-on.

**R008 revision items:**
- [x] Strengthen polyrepo single-segment test (3.1) to verify the worker actually advances past Step 0. Added a `workerAdvanceMode` toggle (`"all"` vs `"first"`) on the mock spawnAgent so test 3.1 can force iteration-by-iteration progress (one box checked per spawn). New assertions: `capturedSpawns.length >= 2`, first prompt mentions Step 0, second prompt mentions Step 1 + `Create endpoint`. Silent-scope regression would now fail the test.
- [x] Reviewer style suggestion: use optional chaining `hostOpts.env?.TASKPLANE_STATUS_PATH` (applied).

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
| 1 | plan | 1 | APPROVE | `.reviews/R001-plan-step1.md` |
| 2 | code | 2 | REVISE  | `.reviews/R002-code-step2.md` |
| 3 | code | 2 | APPROVE | (re-review after R002 fixes) |
| 4 | code | 3 | APPROVE | `.reviews/R004-code-step3.md` |
| 5 | code | 4 | REVISE  | `.reviews/R005-code-step4.md` |
| 6 | code | 4 | REVISE  | `.reviews/R006-code-step4.md` |
| 7 | code | 4 | APPROVE | (re-review after R006 format fix) |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Baseline gates green pre-implementation: typecheck 0, lint 0 (280 warnings/671 infos but exit 0), format:check 0, fast suite 3627 pass / 1 skip / 0 fail. | Note | baseline (post-v0.30.0) |
| `SegmentScopeMode` decision: implement as `export type SegmentScopeMode = "FULL_TASK" \| "SEGMENT_SCOPED"` in `types.ts` + a `computeSegmentScopeMode(stepSegmentMap, repoStepNumbers, currentRepoId, remainingSteps)` helper exported from `lane-runner.ts`. String-literal union (not enum) keeps the runtime cost zero and works cleanly with JSON serialization. The helper centralizes the 5-condition expression that currently lives inline at lane-runner.ts:458–465. | Step 2 plan | types.ts + lane-runner.ts |
| Pre-existing gating: `isSegmentScoped` already gates the env var `TASKPLANE_ACTIVE_SEGMENT_ID` (lane-runner.ts:672) AND segment-system-prompt overlay (line 642). The remaining drift risk #502 calls out is the scattered `stepSegmentMap && currentRepoId` conditional pattern (lines 398, 412, 517, 671, 1225, 1249, 1279) which can drift if updated unevenly. Replacing the bool-prone pattern with a single `mode === "SEGMENT_SCOPED"` reference satisfies #502 without changing runtime behavior. | Step 2 plan | lane-runner.ts |
| #508 latent-fix observation: the existing `if (remainingSteps.length === 0) break` at lane-runner.ts:419 already prevents iter-2 spawn when all segment checkboxes are complete (since TP-174 commit `3ef96db8` made `remainingSteps` use `isSegmentComplete`). However there is no regression test asserting "zero iterations spawned when all segment checkboxes are pre-complete", so the property is undefended. TP-196 will add an explicit early-exit check just before the `spawnAgent` call AND a behavioral test that asserts the spawn is skipped. | Step 4 plan | lane-runner.ts |
| **#502 plan** — (1) Add to `types.ts`: `export type SegmentScopeMode = "FULL_TASK" \| "SEGMENT_SCOPED"`. (2) Add to `lane-runner.ts`: `export function computeSegmentScopeMode(stepSegmentMap, repoStepNumbers, currentRepoId, currentStepNum)` that returns `"SEGMENT_SCOPED"` iff the existing 5-condition `isSegmentScoped` boolean would be true, else `"FULL_TASK"`. (3) Inside the iteration loop replace the inline `const isSegmentScoped = !!( ... )` with `const segmentScopeMode = computeSegmentScopeMode(...)` and a derived `const isSegmentScoped = segmentScopeMode === "SEGMENT_SCOPED"` for backward compatibility with existing callers (we keep the boolean alias so existing reads at lines 483/499/642/672/673 continue to work). (4) The bridge extension's `request_segment_expansion` registration in `agent-bridge-extension.ts:97` is already keyed on `TASKPLANE_ACTIVE_SEGMENT_ID`, which lane-runner already gates on `isSegmentScoped` (line 672) — so promoting the mode to a first-class type closes the drift loop without bridge-extension changes. (5) Gate-sites audit replaces `stepSegmentMap && currentRepoId` runtime checks with a single `isSegmentScoped` reference where the variable is in scope; sites where it's NOT in scope (e.g., the snapshotSegmentCtx block at line 357, post-loop block at 1270+, emitSnapshot signature at 1482/1606) intentionally remain structural because they encode the *shape* of available data, not the mode decision. Result: one authoritative computation, two consumer references (`segmentScopeMode` for the type-explicit path, `isSegmentScoped` boolean for ergonomics). | Step 2 plan | types.ts + lane-runner.ts |
| **#462 plan** — *Monitor guard* (`execution.ts::resolveTaskMonitorState`): currently `.DONE` is Priority 1 unconditionally (line 1042). Add a guard: when the caller provides a `multiSegmentContext` (task has multiple segment nodes AND the active segment is known to be non-final), demote `.DONE` to a non-terminal signal and log a warning. Implementation: extend the function signature with an optional `multiSegmentContext?: { isFinalSegment: boolean; segmentId: string }` parameter — if `isFinalSegment === false` and `.DONE` is observed, skip Priority 1 and proceed to Priority 4 (running). Callers populate this from the task's `SegmentPlan`. Fail-loud stance: log a `WARN` execLog entry so operators see the unusual state. *Resume guard* (`resume.ts::collectDoneTaskIdsForResume`): currently `.DONE` is accepted unconditionally. Add a sanity check: for multi-segment tasks, verify the task's segment frontier in `persistedState.tasks[i].segments` is complete (all segments status === "succeeded") before accepting `.DONE`. If `.DONE` exists but the frontier is incomplete, log a warning and DO NOT add the taskId to the done set (so it re-executes). Stance: fail-loud-and-recover (we don't auto-delete the marker; resume retries the task, which lets the engine re-establish authoritative state). *Discovery safeguard* (`discovery.ts::scanAreaForTasks` and `buildCompletedTaskSet`): on every `.DONE` skip in a folder whose PROMPT.md parses to a multi-segment plan, emit a one-line `console.warn` if there's evidence the frontier is incomplete (specifically: a STATUS.md segment block exists with unchecked items). This is purely a doctor-style warning — no behavioral change to discovery itself, since discovery is invoked early and lacks the persisted-state context needed to make a hard decision. *Tests*: (a) `resolveTaskMonitorState` returns non-terminal status when `.DONE` exists but `multiSegmentContext.isFinalSegment === false`; (b) `collectDoneTaskIdsForResume` excludes tasks where `.DONE` is present but the persisted segment frontier is incomplete; (c) `collectDoneTaskIdsForResume` *includes* tasks where `.DONE` is present and the frontier is complete (regression guard for normal case); (d) discovery warns (but does not skip differently) on inconsistent state. | Step 3 plan | execution.ts + resume.ts + discovery.ts |
| **#508 plan** — Add an explicit pre-spawn `isSegmentComplete` check immediately before the `spawnAgent` call (≈ lane-runner.ts:705). Implementation: after `repoStepNumbers` is computed but before `spawnAgent(hostOpts, ...)`, when `isSegmentScoped`, recompute `isCurrentSegmentComplete = [...repoStepNumbers].every((stepNum) => isSegmentComplete(iterStatusContent, stepNum, currentRepoId!))` and if true, `break` out of the iteration loop. This is redundant with the line-419 `remainingSteps.length === 0` check by construction (since `remainingSteps` already uses `isSegmentComplete`) but: (a) makes the contract explicit at the spawn boundary, (b) catches edge cases where parsed.steps and the repo step set diverge, (c) provides a clean hook for the regression test. Exit-condition: `break` to fall through to post-loop completion handling (same path as the existing line-419 break). *Test*: spawn-shim-based behavioral test — set up a STATUS.md fixture with all segment checkboxes pre-checked, invoke the iteration loop, assert the worker is NOT spawned (zero `spawnAgent` calls) and `totalIterations === 0`. | Step 4 plan | lane-runner.ts |
| **#503 plan** — Extend the existing `extensions/tests/segment-scoped-lane-runner.test.ts` with a new `### 9.x: SegmentScopeMode prompt-injection regression` block. The existing file already does source-string analysis of `lane-runner.ts` (sections 4–8), so adding two more source-analysis groups for `FULL_TASK` vs `SEGMENT_SCOPED` prompt contents keeps the testing strategy consistent. Cases: (1) **FULL_TASK** — source analysis confirms prompt-construction branch does NOT inject `Active segment ID` or `Your checkboxes for this step:` when `isSegmentScoped === false`. (2) **SEGMENT_SCOPED** — source analysis confirms prompt includes `Active segment ID`, `Your checkboxes for this step:`, and `Other segments in this step (NOT yours — do not attempt)`. (3) **Polyrepo single-segment** — a behavioral fixture-based test: when `stepSegmentMap` is null/empty (FULL_TASK mode), `remainingSteps` includes ALL steps and is not artificially truncated to Step 0 only. (4) **Legacy/partial-marker fallback** — fixture where some steps have segment markers and others don't: assert that `repoStepNumbers` is constructed from only the marked steps, AND that unmarked steps with checkboxes for the active repo are NOT silently scoped out. (Most of this is testable via the existing `getStepsForRepoId` + `isSegmentComplete` helpers without a full lane-runner spawn.) Update `extensions/tests/lane-runner-v2.test.ts`: if the new `SegmentScopeMode` first-class type changes any exported contract, mirror that change here — likely a no-op since promoted type is additive. | Step 5 plan | extensions/tests/segment-scoped-lane-runner.test.ts |
| **cross-issue** coordination — (a) #502 (SegmentScopeMode promotion) lands FIRST so #462 and #508 can reference `segmentScopeMode` (or `isFinalSegment`) consistently. (b) #462's monitor guard reads from the task's existing `SegmentPlan` data on the lane snapshot — the new `multiSegmentContext` param is opt-in for callers (defaulted to `undefined` = legacy behavior), so existing tests still pass without modification. (c) #462's resume guard and #508's pre-spawn check are independent code paths and do not interact (resume runs once at startup; pre-spawn runs each iteration). (d) #508's pre-spawn check uses the SAME `isSegmentComplete` helper the monitor doesn't — monitor checks `.DONE`; lane-runner checks checkboxes. So no shared mutation risk. (e) #503's tests assert the prompt-content contract that #502 cements; #503 should run AFTER #502 lands. | Sequencing | all 4 files |

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
| 2026-05-10 23:39 | Review R001 | plan Step 1: APPROVE |
| 2026-05-10 23:45 | Review R002 | code Step 2: REVISE |
| 2026-05-10 23:48 | Review R003 | code Step 2: APPROVE |
| 2026-05-11 00:01 | Review R004 | code Step 3: APPROVE |
| 2026-05-11 00:06 | Review R005 | code Step 4: REVISE |
| 2026-05-11 00:15 | Review R006 | code Step 4: REVISE |
| 2026-05-11 00:17 | Review R007 | code Step 4: APPROVE |
| 2026-05-11 00:23 | Review R008 | code Step 5: REVISE |
