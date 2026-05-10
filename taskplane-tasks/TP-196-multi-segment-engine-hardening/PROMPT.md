# Task: TP-196 - Multi-segment engine hardening: `.DONE` authority + scope-mode unification + early-exit optimization + test hardening

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Bundles 4 segment-engine follow-up issues (#462, #502, #503, #508) into one task. All four touch overlapping files (`lane-runner.ts`, `execution.ts`, `resume.ts`, `discovery.ts`) and share a conceptual theme: hardening multi-segment execution against edge cases and drift. Plan review evaluates the unification design (single authoritative `SegmentScopeMode` flag, defense-in-depth `.DONE` guards). Code review evaluates the per-fix correctness and test adequacy. Per-step reviews fit naturally — each issue's work is independent enough that a step boundary maps to an issue.

**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-196-multi-segment-engine-hardening/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Close out four segment-engine polish/hardening issues that survived the closure of #51 (multi-repo task execution) because they're defense-in-depth, not core feature work:

- **#462** — Harden `.DONE` authority for multi-segment tasks (monitor, resume, discovery guards)
- **#502** — Segment scope mode should be a single enum gating all segment signals
- **#503** — Add regression tests for SegmentScopeMode prompt injection
- **#508** — Lane-runner should check segment completion before spawning next iteration

These four are conceptually cohesive and overlap heavily in file scope. Bundling lets the worker reuse the segment-engine context once and ship a single coherent hardening pass.

By the end of TP-196:
- `.DONE` cannot prematurely terminate a multi-segment task in monitor/resume/discovery edge cases (#462)
- `SegmentScopeMode` is the single authoritative flag — env vars, tool registration, and execution branches all gate on it (#502)
- Regression tests verify both `FULL_TASK` and `SEGMENT_SCOPED` prompt content + the polyrepo single-segment case + the legacy/partial-marker fallback (#503)
- Lane-runner skips wasted iteration when all segment checkboxes are already complete (#508)
- All existing tests still pass; new behavioral tests cover the four fixes

## Dependencies

**None** — all referenced predecessor work is merged. The following are informational cross-references:

- TP-081 / TP-133 / TP-134 / TP-135 (multi-repo task execution Phase B-E, shipped): the foundational segment infrastructure these guards harden.
- TP-145 (already shipped): the four-layer `.DONE` defense that #462 builds atop.
- TP-501 (already shipped, predecessor for #502/#503): the SegmentScopeMode prompt-injection fix that #502 unifies and #503 regression-tests.
- TP-194 (gates flip, shipped v0.30.0): means `typecheck` / `lint` / `format:check` are now hard gates — any new code in this task must keep them green.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — operative spec for the segment subsystem (the broader context for all 4 issues)
- Each issue's body, fetched via `gh issue view <num>`:
  - `gh issue view 462`
  - `gh issue view 502`
  - `gh issue view 503`
  - `gh issue view 508`
- `extensions/taskplane/lane-runner.ts` — segment-scope-mode computation; iteration loop (pre-spawn check site for #508)
- `extensions/taskplane/execution.ts` — `resolveTaskMonitorState` (monitor guard for #462); segment env var + tool registration (#502)
- `extensions/taskplane/resume.ts` — `collectDoneTaskIdsForResume` / reconciliation (resume guard for #462)
- `extensions/taskplane/discovery.ts` — `.DONE` skip logic in segmented contexts (discovery safeguard for #462)
- `extensions/tests/segment-scoped-lane-runner.test.ts` — existing segment scope test file (add #503 assertions here)
- `extensions/tests/lane-runner-v2.test.ts` — update existing segment contracts if changed by #502 work

## Environment

- **Workspace:** `extensions/` (engine + tests)
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts. Worker hydrates Step 2-5
> with the specific files touched per issue based on the plan in Step 1.

- `extensions/taskplane/lane-runner.ts` (segment-scope computation, iteration loop)
- `extensions/taskplane/execution.ts` (monitor guard, env var, tool registration)
- `extensions/taskplane/resume.ts` (resume guard)
- `extensions/taskplane/discovery.ts` (discovery safeguard)
- `extensions/taskplane/types.ts` (if `SegmentScopeMode` enum needs to be promoted to a first-class type — likely)
- `extensions/tests/segment-scoped-lane-runner.test.ts` (#503 assertions)
- `extensions/tests/lane-runner-v2.test.ts` (segment contract updates)
- New test files as needed (e.g., `extensions/tests/done-authority-multi-segment.test.ts` for #462 edge cases)
- `CHANGELOG.md` — `[Unreleased]` entry under `Fixed` (or `Internal` if framed as hardening)

## Steps

> **Hydration:** STATUS.md tracks outcomes per-issue. Worker expands Steps 2-5
> with concrete checkboxes after Step 1 plan-review APPROVE.

### Step 0: Preflight

- [ ] On `main` (lane worktree, fresh from v0.30.0 release)
- [ ] All four gates pass on baseline: `npm run typecheck` exit 0, `npm run lint` exit 0, `npm run format:check` exit 0, `npm run test:fast` 3627+
- [ ] All four issue bodies read: #462, #502, #503, #508
- [ ] Tier 3 context files read
- [ ] Live grep verification: confirm `stepSegmentMap && currentRepoId && repoStepNumbers` is still the condition pattern referenced in #502 (or document the post-TP-194 equivalent)
- [ ] Decision: introduce a `SegmentScopeMode` enum/type in `types.ts` (vs. inline string union)? Recommendation in Discoveries.

### Step 1: Plan all four fixes

> ⚠️ Plan-review checkpoint. Reviewer evaluates architectural cohesion across the 4 issues.

- [ ] #462 design: monitor guard (suppress `.DONE` as success signal for known non-final active segments), resume guard (don't accept `.DONE` for incomplete frontier), discovery safeguard (sanity check or doctor warning). Document each guard's exact check + the "fail-loud vs auto-recover" stance per guard.
- [ ] #502 design: `SegmentScopeMode` promotion to a first-class type; gate env var, tool registration, and execution branches on it. List every site that currently checks `stepSegmentMap && currentRepoId` and the unified-condition replacement.
- [ ] #503 design: test file structure (extend existing `segment-scoped-lane-runner.test.ts` vs new dedicated file). Per-case checklist matches the 4 scenarios in the issue body.
- [ ] #508 design: pre-spawn segment-completion check site in `lane-runner.ts` iteration loop. Document exit-condition semantics (skip to segment-completion handling vs. break to next-task).
- [ ] Cross-issue coordination: any interaction between #462's monitor guard and #508's pre-spawn check? Document.
- [ ] Drafts in Discoveries.

### Step 2: Implement #502 first (foundational refactor)

> ⚠️ Code-review fires after this step.

> Rationale: promoting `SegmentScopeMode` to a first-class type creates the
> authoritative flag that #462 and #508 can also reference. Doing this first
> avoids retrofitting after the other work lands.

- [ ] `SegmentScopeMode` promoted (likely as enum in `types.ts`)
- [ ] `lane-runner.ts` computes it once + threads via lane config
- [ ] `execution.ts` `TASKPLANE_ACTIVE_SEGMENT_ID` env var gated on it
- [ ] `execution.ts` `request_segment_expansion` tool registration gated on it
- [ ] Scattered `stepSegmentMap && currentRepoId` checks replaced with single-flag reference
- [ ] Targeted tests pass; full fast suite passes

### Step 3: Implement #462 guards

> ⚠️ Code-review fires after this step.

- [ ] Monitor guard in `resolveTaskMonitorState` (`execution.ts`)
- [ ] Resume guard in `collectDoneTaskIdsForResume` (`resume.ts`)
- [ ] Discovery safeguard in `discovery.ts` (sanity check or doctor warning per plan decision)
- [ ] 3-4 behavioral tests covering: non-final unlink failure, transient `.DONE` monitor race, resume with `.DONE` + incomplete frontier
- [ ] Full fast suite passes

### Step 4: Implement #508 early-exit optimization

> ⚠️ Code-review fires after this step.

- [ ] Pre-spawn segment-completion check in `lane-runner.ts` iteration loop
- [ ] Exit-condition wiring per plan decision (skip to segment-completion handling)
- [ ] Behavioral test asserting wasted iteration is skipped when all segment checkboxes are pre-complete
- [ ] Full fast suite passes

### Step 5: Implement #503 prompt-injection regression tests

> ⚠️ Code-review fires after this step.

- [ ] `FULL_TASK` prompt assertions: includes `SegmentScopeMode: FULL_TASK`, NOT `Active segment ID`, NOT segment-scoped checkbox block
- [ ] `SEGMENT_SCOPED` prompt assertions: includes `SegmentScopeMode: SEGMENT_SCOPED`, `Active segment ID`, segment-scoped checkbox block, "Other segments in this step (NOT yours)"
- [ ] Polyrepo single-segment regression: worker proceeds beyond Step 0 (does not exit after one step)
- [ ] Legacy/partial-marker case: fallback behavior does not silently one-step scope
- [ ] Tests pass in isolation + full fast suite

### Step 6: Testing & Verification

> ZERO test failures allowed. ALL FOUR GATES must remain green (post-TP-194: typecheck, lint, format:check, tests).

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run format:check` exits 0
- [ ] `npm run test:fast` passes (target: 3627+ baseline + new tests from this task; record final count)
- [ ] Full integration suite passes
- [ ] CLI smoke clean

### Step 7: Documentation & Delivery

- [ ] CHANGELOG entry under `[Unreleased]` → `Fixed` (or `Internal` if framed as hardening):
  - Title: `**Multi-segment engine hardening (TP-196, #462 + #502 + #503 + #508)**`
  - Body: 2-3 paragraph summary covering: (1) `.DONE` authority guards, (2) SegmentScopeMode unification + regression tests, (3) wasted-iteration elimination, (4) validation (tests + gates green)
- [ ] Discoveries logged: per-issue final fix summary; any latent bugs uncovered during hardening
- [ ] Step boundaries committed with `feat(TP-196): ...` / `fix(TP-196): ...` / `test(TP-196): ...` prefixes
- [ ] Issue-close comments drafted in Discoveries for #462, #502, #503, #508 — to be posted by operator after PR merges

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — Fixed/Internal entry per Step 7

**Check If Affected:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — if any of these fixes change a contract documented there, update; otherwise leave alone

## Completion Criteria

- [ ] All four issues' acceptance criteria met (per their issue bodies)
- [ ] All four CI gates pass (`typecheck`, `lint`, `format:check`, `test:fast`)
- [ ] Per-step plan + code reviews APPROVE'd
- [ ] CHANGELOG entry added
- [ ] Issue-close comment drafts ready for operator

## Git Commit Convention

Commits happen at **step boundaries** AND at issue boundaries within combined steps. All commits MUST include the task ID:

- **Step completion:** `chore(TP-196): complete Step N — description`
- **Per-issue fix:** `fix(TP-196, #<issue>): description`
- **Test addition:** `test(TP-196, #<issue>): description`

## Do NOT

- **Don't split into separate PRs unless plan-review reveals a clear architectural split.** The 4 issues are bundled deliberately because they share files and the segment-engine mental model.
- **Don't break the post-TP-194 hard gates.** Any change must keep `typecheck` / `lint` / `format:check` all exit 0. The reviewer agent now downgrades APPROVE → REVISE on any failing gate, so plan accordingly.
- **Don't change behavior beyond what each issue specifies.** Hardening = guards + drift prevention + tests, not new feature work.
- **Don't address the dashboard segment-progress visibility issue (#464)** — that's TP-197's scope, separate file domain (`dashboard/public/`).
- **Don't load docs not listed in "Context to Read First."**
- **Don't commit without the `TP-196` prefix.**

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
