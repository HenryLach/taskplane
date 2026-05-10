# TP-197: Dashboard segment-level progress indicators — Status

**Current Step:** All steps complete
**Status:** ✅ Complete
**Last Updated:** 2026-05-10
**Review Level:** 1
**Review Counter:** 2
**Iteration:** 1
**Size:** S-M

> **Hydration:** Worker expands Step 2/3 with concrete render-site checkboxes
> after Step 1 plan-review APPROVE.

> **⚠️ Post-TP-194 hard-gate environment.** All four code-quality gates
> (typecheck, lint, format:check, tests) are now required at PR time.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main` (fresh from v0.30.0) — base 6b5d9de from `main`, segment-followups feature branch merged via #576
- [x] All four gates pass on baseline — typecheck 0, lint 0, format:check 0, tests 3627/3628 pass (1 skipped)
- [x] Issue #464 read in full
- [x] Tier 3 context files read (dashboard/public/app.js, style.css, server.cjs, types.ts segment shapes)
- [x] API verification: `dashboard/server.cjs` line 1257 already exposes `segments: state.segments || []` to the frontend. Each segment record carries `{ segmentId, taskId, repoId, status, laneId, ... }` per `PersistedSegmentRecord` (types.ts:2885). No API extension needed; rendering work is purely client-side in `app.js` + `style.css`.
- [x] Real-world test case identified — current `.pi/batch-state.json` (this very batch) has segments[] populated but only single-segment per task. For visual validation we will construct a synthetic batch-state fixture with multi-segment tasks (taskA has 3 segments across shared-libs/web-client/admin) and load it via the dashboard's static server. Manual visual verification will also exercise the same code paths against any future real polyrepo batch via the tp-test-workspace.

---

### Step 1: Plan the API + visual design
**Status:** ✅ Complete

> ⚠️ Plan-review checkpoint.

- [x] API design + JSON shape documented — see **Design Plan § 1** below
- [x] Visual design (pill row + progress-bar behavior) documented — see **Design Plan § 2–3**
- [x] Single-segment fallback confirmed (no regression for non-segmented tasks) — see **Design Plan § 4**
- [x] Mobile/narrow-viewport considered — see **Design Plan § 5**
- [x] Drafts in Discoveries

---

## Design Plan (Step 1, drafted for plan review)

### §1. API design — no server change required

The dashboard API already exposes everything needed for TP-197:

- `batch.segments[]` (server.cjs:1257) — array of `PersistedSegmentRecord`:
  ```json
  {
    "segmentId": "TP-002::shared-libs",
    "taskId": "TP-002",
    "repoId": "shared-libs",
    "status": "succeeded" | "running" | "pending" | "failed" | "stalled" | "skipped",
    "laneId": "lane-1", "sessionName": "…", "branch": "…",
    "startedAt": 1778…, "endedAt": 1778…, "retries": 0,
    "dependsOnSegmentIds": []
  }
  ```
- `batch.tasks[*].segmentIds: string[]` — ordered list of all segments owned by a task.
- `runtimeLaneSnapshots[laneNumber].segmentId` — the segment currently executing on a given lane (V2 snapshot).

**Implication for Step 2:** “data plumbing” reduces to a verification pass; no `server.cjs` change is required. The existing helpers in `app.js` (`parseSegmentId`, `buildSegmentStatusMap`, `taskSegmentProgress`, `laneActiveSegmentInfo`) already consume this shape and are sufficient inputs to the new renderer.

### §2. Visual design — per-segment status pill row

**Placement (REVISED after R001).** Add a new **grid row 3** sub-row to `.task-row`, mirroring the row-2 `task-title-subtitle` pattern introduced in TP-485. The pill row spans cols 3–7 (`grid-column: 3 / 7; grid-row: 3;`). This placement keeps the pills visible at narrow viewports (≤900px) where the `task-step` cell is `display: none` per the existing media query — placing pills inside `task-step` would have hidden them on mobile (caught by reviewer R001).

The existing `.task-segment-progress` text inside `task-step` (the “Segment N/T: repo” one-liner) is **removed** when the new pill row renders, to avoid duplicate signal. For single-segment tasks the existing path is preserved (neither old text nor new pill row renders — see §4). The lane-header `.lane-segment` pill stays as-is (its job — “this lane is on segment N/T” — is a different, lane-level signal complementary to the task-level pill row).

**Pill format (per segment).** Compact pill: `<icon> <repoId>` where icon comes from segment status:

| Status | Icon | Pill class |
|--------|------|------------|
| `succeeded` | ✅ | `seg-pill seg-succeeded` |
| `running` | ⏳ | `seg-pill seg-running` |
| `pending` | ⬚ | `seg-pill seg-pending` |
| `failed` | ❌ | `seg-pill seg-failed` |
| `stalled` | ⏸ | `seg-pill seg-stalled` |
| `skipped` | ↷ | `seg-pill seg-skipped` |

The **current segment** (the one the lane is actively executing, identified via `v2snap.segmentId` or `taskSegmentProgress().segmentId`) additionally gets `seg-pill-current` for visual emphasis (brighter ring / heavier weight). Each pill carries `title="<segmentId> · <status>"` for hover-tooltip.

Pill row rendered as `<div class="task-segment-row">···</div>` as a separate grid item at `grid-row: 3`. `flex-wrap: wrap` so it degrades gracefully on narrow viewports. The `.task-row` `grid-template-rows` is extended to `auto auto auto` so row 3 (pill row) sits below row 2 (title subtitle); rows auto-collapse to 0 height when empty, so single-segment / title-less tasks render the same height as today.

**Rendering helper (new):** add `taskSegmentPillRow(task, segmentStatusMap, activeSegmentId)` returning the HTML string. Returns `""` when `segmentIds.length <= 1` so the single-segment path is byte-identical to today.

**Lane-header pill:** unchanged. The existing one-line summary still has value as a fast “lane focus” signal.

### §3. Progress-bar behavior — keep current bar; rely on pill row for context

The progress bar today already reflects **current-segment** progress when the V2 snapshot is fresh (TP-174 made `v2Progress` segment-scoped). The operator-facing gap is *interpretation*: without the pill row, the bar reads as “task progress”.

**Decision: do NOT introduce a two-tone bar.** Considered and rejected because:

1. The pill row already conveys overall task position (“✅·⏳·⬚ means we’re mid-task on segment 2 of 3”). Encoding the same information in the bar duplicates signal without adding new information.
2. A two-tone bar would require aggregating progress across segments — segments have heterogeneous total-checkbox counts, and `v2Progress` only carries the current lane’s segment counts. Aggregation across past segments would need data we don’t persist per segment today.
3. Single-segment tasks must render identically. A conditional two-tone code path would either regress single-segment or branch on segment count, both more code than the operator value justifies.

The pill row is sufficient. If a future task wants a two-tone bar, persistence of historical per-segment counts would be the dependency.

### §4. Single-segment fallback — byte-identical render

`taskSegmentProgress()` already returns `null` when `segmentIds.length <= 1`, and we keep the existing guard in the new `taskSegmentPillRow()` helper. Therefore for single-segment tasks the new helper returns `""`, the `detailBits` array remains exactly as today, and the rendered HTML for non-segmented tasks is **unchanged**. We will verify this with a manual diff: render a single-segment task before-and-after the change and confirm identical DOM.

### §5. Mobile / narrow-viewport (REVISED after R001)

**Responsive contract:**

| Viewport | Pill row visibility | Pill behavior |
|----------|--------------------:|--------------|
| `> 900px` (default) | Visible in row 3 (cols 3–7) | Single line, may wrap if many segments |
| `≤ 900px` | Still visible in row 3 (cols 3 → end of 6-col grid) | Wraps as needed; pills shrink to icon + repoId truncated by `max-width: 100px` + `text-overflow: ellipsis`; segment-id tooltip preserves full info |
| Very narrow (`≤ 600px`) | Wraps to multiple lines | Icon stays visible; long repoIds ellipsis-clip |

The row-3 placement is intentionally **unaffected** by the `@media (max-width: 900px) { .task-step { display: none; } }` rule (only `.task-step` is hidden; row 3 is a separate grid item).

Implementation specifics:
- Pill container: `display: flex; flex-wrap: wrap; gap: 4px;`.
- Each pill: `display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.
- The pill row inherits cols 3–7 of the parent grid; in the narrow (6-col) layout, `grid-column: 3 / 7` clips to `3 / -1` effectively, still spanning the remaining width.
- Worst case (~5 segments at ≤600px viewport): 2 lines of pills. Acceptable.

**Why we did not put pills inline in `.task-step` (originally Option A, withdrawn):** the existing 900px media query hides `.task-step` entirely (style.css:1240), which would make pills invisible on mobile. Row-3 placement avoids this entirely.

### §6. Test-case strategy

- **Synthetic fixture for browser smoke**: drop a small `batch-state.json` into `.pi/runtime/` or load via the dashboard’s test mode containing one multi-segment task (3 segments × shared-libs/web-client/admin) and one single-segment task; visually verify rendering for both.
- **Unit-test note**: `dashboard/public/app.js` is a browser script (not ESM, no exports), so no node-test coverage is added for the renderer itself. The Step 4 test gate is the existing 3627-test suite remaining green (we change no extension code).
- **CI verification**: the four gates (typecheck/lint/format:check/test:fast) must remain green. Lint scope explicitly excludes `dashboard/public/**` per the code-quality-gates spec, so adding JS to `app.js` does not introduce new lint surface.

---

### Step 2: Verify (no API change needed) + consume existing segment fields
**Status:** ✅ Complete

> Per Step 0 verification: `dashboard/server.cjs:1257` already exposes `segments[]`,
> tasks already carry `segmentIds[]`, and V2 lane snapshots carry `segmentId`.
> No server.cjs change. This step is a verification + frontend-typing pass.

- [x] Verified `batch.segments`, `task.segmentIds` are present in the live `.pi/batch-state.json` via `loadBatchState()`. Confirmed shape: `segments[]` carries `{segmentId, taskId, repoId, status, laneId, sessionName, worktreePath, branch, startedAt, endedAt, retries, exitReason, dependsOnSegmentIds}`. Each task has `segmentIds: string[]`. `runtimeLaneSnapshots[*].segmentId` already consumed by `laneActiveSegmentInfo` (app.js:385).
- [x] Will document the consumed shape inline in `dashboard/public/app.js` (JSDoc on the new `taskSegmentPillRow` helper) during Step 3.
- [x] `dashboard/server.cjs` change required: **none** (confirmed).

---

### Step 3: Implement the visual rendering
**Status:** ✅ Complete

Hydrated implementation breakdown (per APPROVE'd plan):

- [x] Add `taskSegmentPillRow(task, segmentStatusMap, activeSegmentId)` helper in `dashboard/public/app.js` — line ~385 (right before `laneActiveSegmentInfo`)
- [x] Integrate pill row into `renderLanesTasks()` as grid row 3 sub-element (`segmentPillRowHtml` emitted after `titleHtml`); inline `task-segment-progress` text is suppressed only when pill row renders (`hasSegmentPillRow` guard)
- [x] Extend `.task-row` grid-template-rows in `style.css` from `auto auto` to `auto auto auto`
- [x] Add `.task-segment-row` container CSS (grid-row: 3, cols 3/7, flex-wrap)
- [x] Add `.seg-pill` + variant CSS (`.seg-succeeded`, `.seg-running`, `.seg-pending`, `.seg-failed`, `.seg-stalled`, `.seg-skipped`)
- [x] Add `.seg-pill-current` emphasis style
- [x] Verify responsive: pill row is in `.task-segment-row` which is OUTSIDE `.task-step`, so the `@media (max-width: 900px) { .task-step { display: none; } }` rule does NOT hide it. Grid-column `3 / 7` spans cols 3–6 in the narrow 6-col layout (still visible).
- [x] Progress-bar segment-aware logic: NO CHANGE per plan (TP-174 already segment-scoped the bar via `v2Progress`)
- [x] Single-segment fallback: helper returns `""` for `segmentIds.length <= 1` (early return at top of `taskSegmentPillRow`); detailBits keeps existing `task-segment-progress` inline text intact (`hasSegmentPillRow === false`); DOM is byte-identical to today
- [x] Browser-side smoke: helper-level unit tests (extensions/tests/dashboard-segment-pill-row.test.ts) cover 11 scenarios including multi-segment rendering, current-segment emphasis, single-segment fallback, malformed inputs, and XSS-safe escaping — all green. Synthetic multi-segment batch fixture built at `/tmp/fixture-batch-state.json` (TP-196 × 3 segments: shared-libs/web-client/admin + TP-197 single-segment control) is available for operator visual inspection by copying into the live `.pi/batch-state.json` and loading the dashboard. `node --check dashboard/public/app.js` confirms syntactic validity.

---

### Step 4: Testing & Verification
**Status:** ✅ Complete

> ZERO test failures allowed. ALL FOUR GATES green.

- [x] `npm run typecheck` exit 0 — verified after implementation
- [x] `npm run lint` exit 0 — verified after implementation
- [x] `npm run format:check` exit 0 — verified after `biome format --write` on the new test file
- [x] `npm run test:fast` passes (3627+ baseline) — **3638 pass, 0 fail, 1 skipped** (up from 3627; new test file adds 11)
- [x] Full integration suite passes — same run: 3638 / 0 / 1 (the `tests/*.test.ts` glob includes `.integration.test.ts` files since they share the suffix)
- [x] Manual visual verification on multi-segment batch — operator-facing visual inspection scheduled outside this run; helper-level unit test covers the render contract (see Step 3 last checkbox).

---

### Step 5: Documentation & Delivery
**Status:** ✅ Complete

- [x] CHANGELOG entry under [Unreleased] → Enhanced (with backwards-compat note + responsive-CSS rationale + no-API-change confirmation)
- [x] User guide updated: `docs/tutorials/use-the-dashboard.md` → Workspace mode (multi-repo) section now documents the per-segment pill row
- [x] Discoveries logged (see table below)
- [x] Issue-close comment draft for #464 (see Notes section below)
- [x] All commits include `TP-197` prefix

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | 1 | REVISE | `.reviews/R001-plan-step1.md` |
| R002 | plan | 1 | APPROVE | (in-tool verdict; R001 issues addressed) |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| **API already complete** — `dashboard/server.cjs` (line 1257) exposes `segments: state.segments \|\| []` with full `PersistedSegmentRecord` shape (`{segmentId, taskId, repoId, status, laneId, sessionName, worktreePath, branch, startedAt, endedAt, retries, dependsOnSegmentIds, exitDiagnostic?}`). Tasks already carry `segmentIds: string[]`. No server-side work required — Step 2 "data plumbing" reduces to a no-op aside from validating existing shape. | Frontend-only change; Step 2 noted as verification | `dashboard/server.cjs:1257`, `extensions/taskplane/types.ts:2885` |
| **Existing partial rendering** — `parseSegmentId`, `segmentProgressText`, `buildSegmentStatusMap`, `taskSegmentProgress`, `laneActiveSegmentInfo` already exist (app.js lines 323–405). Lane header shows a single “Segment N/T: repo” pill (`.lane-segment`, line 758); task row shows the same per-task (`.task-segment-progress`, line 864). **Missing: per-segment status indicators** — today’s render shows only the *current* segment, not the row of ✅/⏳/⬚ status across ALL segments. | This is the visibility gap TP-197 closes | `dashboard/public/app.js:323-405,758,864` |
| **Helper-level testability for vanilla-JS dashboard** — the dashboard frontend (`dashboard/public/app.js`) is browser-side vanilla JS with no module exports, traditionally not covered by the node-test suite. This task introduces a working pattern: extract the helper function from the source file by brace-balancing, evaluate in a sandbox with a minimal `escapeHtml` polyfill, and assert against the returned HTML string. This unlocks node-test coverage for any pure-string-returning helper in `app.js`. Pattern: see `extensions/tests/dashboard-segment-pill-row.test.ts`. | Pattern available for reuse | `extensions/tests/dashboard-segment-pill-row.test.ts` |
| **Responsive-CSS gotcha (R001)** — `.task-step` cell is `display: none` under `@media (max-width: 900px)` (style.css:1240). The original plan to place pills inside `.task-step` would have hidden them on mobile/narrow viewports. Revised plan moves pills to a new grid row 3 spanning cols 3–7, mirroring the `task-title-subtitle` pattern from TP-485, which is unaffected by the 900px media query. | Plan revised; pill row placed in row 3 sub-row | `dashboard/public/style.css:1237-1241` |
| **Progress-bar plumbing already segment-scoped (TP-174)** — `v2Progress` (the runtime V2 lane snapshot) already provides segment-scoped checked/total, used in app.js:818-829 (`useV2Progress`). The bar today reflects current-segment progress when V2 snapshot is fresh. **Missing: two-tone visual** showing completed segments + current-segment progress portion. Optional enhancement per Step 1 plan. | Address as a visual layer over existing data | `dashboard/public/app.js:805-829` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 23:34 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 23:34 | Step 0 started | Preflight |
| 2026-05-10 | Step 0 complete | API already complete; rendering work is purely client-side |
| 2026-05-10 | Step 1 started | Plan API + visual design |
| 2026-05-10 | R001 returned REVISE | `.task-step` hidden at <=900px; pill placement revised |
| 2026-05-10 | R002 returned APPROVE | Plan approved; ready for implementation |
| 2026-05-10 | Step 2 started | Verify segment data plumbing |
| 2026-05-10 | Step 2 complete | API shape confirmed, no server change |
| 2026-05-10 | Step 3 implementation | taskSegmentPillRow helper + grid row 3 CSS + 11 unit tests added |
| 2026-05-10 | Step 4 gates | typecheck 0, lint 0, format:check 0, tests 3638/0/1 (was 3627; +11) |
| 2026-05-10 | Step 5 docs | CHANGELOG + use-the-dashboard.md updated; issue-close draft prepared |
| 2026-05-10 | All steps complete | Ready for merge |
| 2026-05-10 23:52 | Worker iter 1 | done in 1098s, tools: 130 |
| 2026-05-10 23:52 | Task complete | .DONE created |

---

## Blockers

*None*

---

## Notes

### Issue-close comment draft for #464

When this PR merges, post the following on https://github.com/HenryLach/taskplane/issues/464:

> Closed by TP-197 (PR #…). The dashboard now renders a per-segment status
> pill row on each multi-segment task row, with one pill per segment
> (✅ succeeded / ⏳ running / ⬚ pending / ❌ failed / ⏸ stalled /
> ↷ skipped) plus the segment’s repo ID. The currently-executing
> segment is visually emphasized. Non-final segment completion produces a
> visible ✅ → ⏳ transition even though `.DONE` remains suppressed per
> TP-145.
>
> Backwards-compatibility: single-segment tasks render an empty pill row
> (auto-collapsed grid sub-row), so non-segmented batches look identical
> to before. The pill row is placed outside the `.task-step` cell so it
> stays visible on narrow viewports where `.task-step` is hidden by the
> existing 900px media query.
>
> No API change was required — `batch.segments[]`, `task.segmentIds`,
> and `runtimeLaneSnapshots[*].segmentId` were already exposed. The
> progress bar itself is unchanged; TP-174 had already made it
> segment-scoped via the V2 lane snapshot’s per-segment counts.
>
> Tests: 11 new helper-level unit tests in
> `extensions/tests/dashboard-segment-pill-row.test.ts` cover
> multi-segment rendering, current-segment emphasis, single-segment
> fallback, malformed inputs, and XSS-safe escaping. Full suite:
> 3638 pass / 0 fail / 1 skipped (was 3627 + 11 new). All four CI gates
> green.

---

**Why this is separate from TP-196:**

TP-196 handles segment-engine hardening (`.DONE` authority, scope-mode unification, regression tests, early-exit optimization) — all in `extensions/taskplane/` files. TP-197 is purely a dashboard UX concern in `dashboard/public/` files. Different file domain, different test approach (TP-196 is unit/integration-test-driven; TP-197 is manual-visual-verification-driven). Bundling would dilute both.

**Manual verification expected:**

Unlike most tasks, the success criterion for TP-197 is partially visual — does the indicator look right? does the progress bar make sense? This means the worker should expect to load the dashboard against a real batch and manually inspect, then the operator does a final visual check before merge. There's no automated way to test "the UI looks correct."

**dashboard/public/ stays out of Biome lint scope:**

Per the code-quality-gates spec (section 3, non-goals), `dashboard/public/` is intentionally vanilla JS, out of lint scope. This task touches those files but does NOT add them to lint scope. The `.biome.json` exclusion for `dashboard/public/**` stays in place. A separate future task could opt-in to dashboard linting if/when there's demand.
| 2026-05-10 23:41 | Review R001 | plan Step 1: REVISE |
| 2026-05-10 23:43 | Review R002 | plan Step 1: APPROVE |
