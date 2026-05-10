# Task: TP-197 - Dashboard segment-level progress indicators for multi-segment tasks

**Created:** 2026-05-10
**Size:** S-M

## Review Level: 1 (Plan Only)

**Assessment:** UX improvement, scoped to dashboard rendering. No engine changes. The data is already available (lane snapshots include `segmentId`; the segment frontier is tracked in batch state). Worker needs to (1) surface segment metadata via the dashboard server API and (2) render it in the dashboard UI. Plan review evaluates the API + visual design; code review is skipped because dashboard JS work has been Level 1 historically and the test gate is the test suite + manual operator inspection during a polyrepo run.

**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-197-dashboard-segment-progress/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Close [#464](https://github.com/HenryLach/taskplane/issues/464) — Dashboard: segment-level progress indicators for multi-segment tasks.

The dashboard correctly avoids prematurely marking multi-segment lanes as complete (per TP-145's `.DONE` suppression for non-final segments), but the side effect is that **operators have no way to tell what's happening during the suppression window**. A lane sits "running" with no segment-level signal, no completion-of-current-segment indicator, no clear "we're on segment 1 of 3" framing. In wave 2+ batches where all tasks are mid-segment, the entire wave appears stuck.

By the end of TP-197:
- Each lane row in the dashboard shows segment context when applicable (e.g., `segment 2/3 · shared-libs`)
- Segment completion status is visually distinct (✅ for done segments, ⏳ for in-progress, ⬚ for pending)
- The progress bar reflects the **current segment's** checkpoint progress, not just the overall task progress
- Non-final segment completion produces a visual indicator even though `.DONE` is suppressed
- Single-segment / single-repo tasks render identically to today (no regression for the common case)

## Dependencies

**None** — all referenced predecessor work is merged. Informational cross-references:

- TP-145 (already shipped): `.DONE` suppression for non-final segments. The visual gap this task fills is the SIDE EFFECT of that correctness fix.
- TP-081 / TP-133 / TP-134 / TP-135 (multi-repo task execution, shipped): provides the segment frontier + lane snapshot segmentId data that this task surfaces.
- TP-485 (task title in dashboard, shipped v0.28.7): the row-layout precedent for adding new visual content to a lane row.
- TP-485 follow-up (widened task-title row, shipped v0.28.8): the grid-layout precedent for spanning new content across columns 3-6.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- Issue body: `gh issue view 464`
- `dashboard/public/app.js` — lane-row rendering; this is the file where the new indicators live
- `dashboard/public/style.css` — lane-row layout; check existing grid for cols 3-6 (per TP-485 follow-up) and how segment indicators fit
- `dashboard/server.cjs` — API endpoint that serves batch state to the dashboard frontend; may need to surface segment data more explicitly
- `extensions/taskplane/types.ts` — `RuntimeLaneSnapshot` shape (has `segmentId` already), `PersistedSegmentRecord` shape
- `extensions/taskplane/persistence.ts` — batch state shape (where `segments[]` lives), so worker knows what data is canonically available
- `docs/specifications/taskplane/multi-repo-task-execution.md` section "Lane snapshots" — confirms what segment metadata is on disk

## Environment

- **Workspace:** `dashboard/` (rendering) + `extensions/taskplane/` (data shape, if API extension needed)
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts.

- `dashboard/public/app.js` — segment-indicator rendering
- `dashboard/public/style.css` — segment-indicator styling
- `dashboard/server.cjs` — segment data on the API response, if not already present (verify in Step 0)
- `extensions/tests/<name>.test.ts` — optional: dashboard server unit test if the API shape changes
- `CHANGELOG.md` — `[Unreleased]` entry under `Enhanced`

## Steps

> **Hydration:** Worker expands Step 2 with concrete render-site checkboxes after Step 1 plan-review.

### Step 0: Preflight

- [ ] On `main` (lane worktree, fresh from v0.30.0)
- [ ] All four gates pass on baseline (typecheck 0, lint 0, format:check 0, tests 3627+)
- [ ] Issue #464 read in full
- [ ] Tier 3 context files read
- [ ] Verify on the API side: does `dashboard/server.cjs` already surface segment data to the frontend, or does the worker need to extend the API endpoint?
- [ ] Identify a real-world test case: a recent multi-segment batch in `.pi/runtime/<batchId>/` whose data we can inspect to validate the rendering

### Step 1: Plan the API + visual design

> ⚠️ Plan-review checkpoint. Reviewer evaluates UX + API shape.

- [ ] API design: what segment metadata does the dashboard server expose? (current segment ID + status, segment frontier completion state, repoId per segment). Document the exact JSON shape.
- [ ] Visual design: how should segment context appear in a lane row? Recommendation: a horizontal pill row under the task title (e.g., `✅ shared-libs · ⏳ web-client · ⬚ administration`) with the current segment highlighted. Consider compact vs. expanded variants.
- [ ] Progress-bar behavior: how does it reflect segment-level progress vs. task-level? Options: (a) show segment progress when segmented, task progress otherwise; (b) two-tone bar (filled portion = done segments; ghost portion = current segment progress).
- [ ] Single-segment fallback: confirm rendering is IDENTICAL to today for non-segmented tasks (no regression).
- [ ] Mobile/narrow-viewport: dashboard's current responsive behavior — confirm the new indicators degrade gracefully.
- [ ] Drafts in Discoveries.

### Step 2: Implement the data plumbing

> Plan-reviewer must have APPROVED Step 1 before proceeding.

- [ ] Extend `dashboard/server.cjs` API response with segment data (only if needed per Step 0 verification)
- [ ] Add typed shape to `dashboard/public/app.js` (or inline types) for the new API field
- [ ] Verify the API response on a real running batch (use the test case identified in Step 0)

### Step 3: Implement the visual rendering

- [ ] Segment indicator pill row in lane rows (per plan)
- [ ] CSS styling for ✅ / ⏳ / ⬚ states (per plan)
- [ ] Progress-bar segment-aware logic (per plan)
- [ ] Single-segment fallback: visual regression test on a non-segmented batch (manual operator check; no automation possible for visual UX)
- [ ] Browser-side smoke: load a recent multi-segment batch's data into the dashboard and confirm rendering

### Step 4: Testing & Verification

> ZERO test failures allowed. ALL FOUR GATES must remain green.

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run format:check` exits 0
- [ ] `npm run test:fast` passes (target: 3627+ baseline)
- [ ] Full integration suite passes
- [ ] Manual visual verification: load a multi-segment batch (e.g., the polyrepo test workspace's most recent run) and confirm:
  - Indicators render
  - Current segment is visually distinct
  - Completed segments show ✅
  - Pending segments show ⬚
  - Progress bar reflects current segment's progress
  - Single-segment task in the same batch renders identically to current behavior

### Step 5: Documentation & Delivery

- [ ] CHANGELOG entry under `[Unreleased]` → `Enhanced`:
  - Title: `**Dashboard segment-level progress indicators (TP-197, #464)**`
  - Body: 1-2 paragraph summary covering: (1) the visibility gap during `.DONE` suppression, (2) the indicator design (per-segment pills + segment-aware progress bar), (3) backwards-compatibility (single-segment tasks unchanged)
- [ ] Discoveries logged: API shape used, design choices, any visual regressions found+fixed
- [ ] Issue-close comment drafted for #464 in Discoveries (for operator to post after PR merges)
- [ ] All commits include `TP-197` prefix

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — Enhanced entry per Step 5

**Check If Affected:**
- `docs/user-guide/dashboard.md` (if exists) — document the new segment indicators

## Completion Criteria

- [ ] #464's acceptance criteria met (visible segment context + completion status + segment-aware progress bar)
- [ ] All four CI gates pass
- [ ] Plan review APPROVE'd (Level 1)
- [ ] Manual visual verification confirms rendering
- [ ] CHANGELOG entry added
- [ ] Issue-close comment draft ready

## Git Commit Convention

Commits at **step boundaries**, all with `TP-197` prefix:

- **Step completion:** `feat(TP-197): complete Step N — description`
- **API extension:** `feat(TP-197): expose segment metadata via dashboard server`
- **UI changes:** `feat(TP-197): render segment indicators in lane rows`

## Do NOT

- **Don't change `.DONE` suppression behavior** — that's TP-145 and is correct as-is. This task adds visibility ON TOP of suppression, not in lieu of.
- **Don't address segment-engine hardening** (#462, #502, #503, #508) — that's TP-196's scope.
- **Don't break the post-TP-194 hard gates** — typecheck/lint/format:check are now required.
- **Don't add `dashboard/public/`** to the Biome lint scope — it's intentionally out of scope per the code-quality-gates spec. This task touches the same files but keeps the lint exclusion intact.
- **Don't expand scope** beyond #464's stated UX gap. If exploring reveals additional dashboard gaps, document in Discoveries and propose separate tasks.
- **Don't load docs not listed in "Context to Read First."**
- **Don't commit without the `TP-197` prefix.**

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
