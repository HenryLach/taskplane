# R005 — Plan Review (Step 2: Preserve existing UX guarantees)

## Verdict
**REVISE**

Step 2 is not yet hydrated enough for deterministic execution/review. In `STATUS.md`, Step 2 still has only two high-level checkboxes and no concrete acceptance criteria, no regression matrix, and no explicit handling for known UX edge cases introduced by Step 1.

## What I reviewed
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/PROMPT.md`
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md`
- `dashboard/public/app.js`
- `dashboard/public/index.html`
- `dashboard/public/style.css`
- `dashboard/server.cjs`

## Blocking gaps

### 1) Step 2 has no concrete UX invariants to verify
Current Step 2 plan does not define what “unchanged by default” means in observable terms.

Please add explicit pass/fail invariants tied to current code paths, e.g.:
- Repo filter hidden when `batch.mode !== "workspace"` or `<2` distinct repos.
- No repo badges in lane/task rows in monorepo/repo-mode views.
- Merge panel remains single-row behavior when `repoResults` absent or `<2`.

### 2) No deterministic verification matrix for monorepo safety
Given the new gating/filter logic (`buildRepoSet`, `updateRepoFilter`, filtered renders in `renderLanesTasks`/`renderMergeAgents`), Step 2 needs a scenario matrix (fixture-driven/manual) covering:
- v1/repo-mode state (no `mode`, no repo fields)
- workspace mode with exactly one repo
- workspace mode with 2+ repos, then “All repos” selected (must match pre-filter totals)
- transition 2+ repos → <2 repos → 2+ repos (selection/reset behavior)

### 3) Sidecar/viewer regression checks are not specified
Step 2 explicitly calls out conversation/sidecar stability, but plan lacks checks for:
- `viewConversation()` and `viewStatusMd()` behavior while repo filter changes
- viewer polling continuity and auto-scroll/tracking behavior
- no unintended coupling between filtered lane visibility and active viewer state

## Required plan updates before implementation
1. Hydrate Step 2 in `STATUS.md` with 3–5 concrete, outcome-level items and explicit acceptance criteria.
2. Add a regression verification matrix (scenario, action, expected result) for monorepo/default UX.
3. Add explicit sidecar/viewer regression checks and expected behavior when selected repo hides the currently viewed lane/task.
4. Record how evidence will be captured in STATUS (what was run/observed for each scenario).

## Non-blocking note
There is still UX risk around repo filter state sync (`dashboard/public/app.js`, `updateRepoFilter`) when repo visibility toggles off/on. Even if handled as code in Step 2, the plan should explicitly include this transition in the Step 2 matrix.
