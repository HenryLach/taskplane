# TP-197: Dashboard segment-level progress indicators — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-10
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** S-M

> **Hydration:** Worker expands Step 2/3 with concrete render-site checkboxes
> after Step 1 plan-review APPROVE.

> **⚠️ Post-TP-194 hard-gate environment.** All four code-quality gates
> (typecheck, lint, format:check, tests) are now required at PR time.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main` (fresh from v0.30.0)
- [ ] All four gates pass on baseline
- [ ] Issue #464 read in full
- [ ] Tier 3 context files read (dashboard/public/app.js, style.css, server.cjs, types.ts segment shapes)
- [ ] API verification: does `dashboard/server.cjs` already surface segment data, or does the worker need to extend it?
- [ ] Real-world test case identified (recent multi-segment batch in `.pi/runtime/<batchId>/`)

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

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |

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
