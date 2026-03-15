# R007 — Plan Review (Step 3: Testing & Verification)

## Verdict
**REVISE**

Step 3 is still too high-level for deterministic verification. In `STATUS.md`, it only lists generic checkboxes and does not define **what** targeted tests/scenarios will run, **which known defects must be re-checked**, or **what evidence is required** before closing the step.

## What I reviewed
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/PROMPT.md`
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md`
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `extensions/taskplane/persistence.ts`
- Prior reviews for open context:
  - `.reviews/R002-code-step0.md`
  - `.reviews/R004-code-step1.md`
  - `.reviews/R006-code-step2.md`

## Blocking gaps

### 1) Step 3 does not include regression checks for known open review findings
There are previously documented correctness issues in review history (notably repo filter sync behavior and `repoResults` schema validation depth). Step 3 must explicitly verify those paths, not just run the broad suite.

### 2) “Targeted tests for changed modules” is undefined
Current plan does not name concrete commands/files. For this task, targeted coverage should at minimum include persistence + repo merge behavior and any new regression tests for dashboard repo-filter behavior.

### 3) No deterministic dashboard verification matrix
`dashboard/public/app.js` and `dashboard/server.cjs` were changed, but there is no explicit manual/fixture matrix for:
- repo mode (default/v1 compatibility)
- workspace mode (2+ repos)
- repo disappearance/reappearance transition
- conversation/STATUS viewer behavior while filtering

### 4) No evidence format for Step 3 completion
The plan does not define what gets logged in `STATUS.md` (exact commands, pass/fail counts, scenario outcomes). Without this, Step 3 completion is not auditable.

## Required plan updates before execution
1. **Hydrate Step 3 in `STATUS.md`** with 3–5 concrete outcome items and acceptance criteria.
2. Add an explicit **command list** for verification, e.g.:
   - `cd extensions && npx vitest run`
   - `cd extensions && npx vitest run tests/orch-state-persistence.test.ts tests/merge-repo-scoped.test.ts`
   - any new targeted regression test command for dashboard repo-filter state sync
   - `node bin/taskplane.mjs help`
3. Add a **dashboard scenario matrix** with expected outcomes, including the hide→show repo filter transition (selection/UI consistency) and sidecar/viewer non-regression checks.
4. Add a **failure policy**: any mismatch/failure blocks Step 3 close; fix + rerun required.
5. Specify **evidence capture** in `STATUS.md` (timestamp, command, result, and key observed behavior per scenario).

## Non-blocking note
- `STATUS.md` Reviews table currently has duplicate rows/trailing separator artifacts; cleaning that up will improve traceability for final delivery.
