# TP-197: Dashboard segment-level progress indicators — Status

**Current Step:** Step 1: Plan the API + visual design
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 1
**Review Counter:** 0
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
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint.

- [ ] API design + JSON shape documented
- [ ] Visual design (pill row + progress-bar behavior) documented
- [ ] Single-segment fallback confirmed (no regression for non-segmented tasks)
- [ ] Mobile/narrow-viewport considered
- [ ] Drafts in Discoveries

---

### Step 2: Implement the data plumbing
**Status:** ⬜ Not Started

- [ ] `dashboard/server.cjs` API extended (if needed)
- [ ] Frontend types added for new API shape
- [ ] API response verified on real running batch

---

### Step 3: Implement the visual rendering
**Status:** ⬜ Not Started

- [ ] Segment indicator pill row
- [ ] CSS styling for ✅ / ⏳ / ⬚ states
- [ ] Progress-bar segment-aware logic
- [ ] Single-segment fallback visual regression-checked
- [ ] Browser-side smoke on real batch

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed. ALL FOUR GATES green.

- [ ] `npm run typecheck` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npm run format:check` exit 0
- [ ] `npm run test:fast` passes (3627+ baseline)
- [ ] Full integration suite passes
- [ ] Manual visual verification on multi-segment batch

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG entry under [Unreleased] → Enhanced
- [ ] Discoveries logged
- [ ] Issue-close comment draft for #464
- [ ] All commits include `TP-197` prefix

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| **API already complete** — `dashboard/server.cjs` (line 1257) exposes `segments: state.segments \|\| []` with full `PersistedSegmentRecord` shape (`{segmentId, taskId, repoId, status, laneId, sessionName, worktreePath, branch, startedAt, endedAt, retries, dependsOnSegmentIds, exitDiagnostic?}`). Tasks already carry `segmentIds: string[]`. No server-side work required — Step 2 "data plumbing" reduces to a no-op aside from validating existing shape. | Frontend-only change; Step 2 noted as verification | `dashboard/server.cjs:1257`, `extensions/taskplane/types.ts:2885` |
| **Existing partial rendering** — `parseSegmentId`, `segmentProgressText`, `buildSegmentStatusMap`, `taskSegmentProgress`, `laneActiveSegmentInfo` already exist (app.js lines 323–405). Lane header shows a single “Segment N/T: repo” pill (`.lane-segment`, line 758); task row shows the same per-task (`.task-segment-progress`, line 864). **Missing: per-segment status indicators** — today’s render shows only the *current* segment, not the row of ✅/⏳/⬚ status across ALL segments. | This is the visibility gap TP-197 closes | `dashboard/public/app.js:323-405,758,864` |
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

---

## Blockers

*None*

---

## Notes

**Why this is separate from TP-196:**

TP-196 handles segment-engine hardening (`.DONE` authority, scope-mode unification, regression tests, early-exit optimization) — all in `extensions/taskplane/` files. TP-197 is purely a dashboard UX concern in `dashboard/public/` files. Different file domain, different test approach (TP-196 is unit/integration-test-driven; TP-197 is manual-visual-verification-driven). Bundling would dilute both.

**Manual verification expected:**

Unlike most tasks, the success criterion for TP-197 is partially visual — does the indicator look right? does the progress bar make sense? This means the worker should expect to load the dashboard against a real batch and manually inspect, then the operator does a final visual check before merge. There's no automated way to test "the UI looks correct."

**dashboard/public/ stays out of Biome lint scope:**

Per the code-quality-gates spec (section 3, non-goals), `dashboard/public/` is intentionally vanilla JS, out of lint scope. This task touches those files but does NOT add them to lint scope. The `.biome.json` exclusion for `dashboard/public/**` stays in place. A separate future task could opt-in to dashboard linting if/when there's demand.
