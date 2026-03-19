# Task: TP-034 — Quality Gate Structured Review

**Created:** 2026-03-19
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds post-completion quality verification to task-runner. Changes `.DONE` authority when enabled. Must be opt-in and backward compatible.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-034-quality-gate-structured-review/
├── PROMPT.md ├── STATUS.md ├── .reviews/ └── .DONE
```

## Mission

Add an opt-in quality gate to the task-runner that runs a cross-model structured
review after all steps complete but before `.DONE` creation. The review agent
produces a JSON verdict (PASS/NEEDS_FIXES) with severity-classified findings.
When enabled, `.DONE` is only created after PASS verdict. When disabled (default),
behavior is unchanged.

## Dependencies

- **Task:** TP-025 (TaskExitDiagnostic types for review outcome recording)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 5 sections 5a, 5d, 5e
- `extensions/task-runner.ts` — Task completion flow (where `.DONE` is created)
- `extensions/taskplane/config-schema.ts` — Configuration structure

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/quality-gate.ts` (new)
- `extensions/tests/quality-gate.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read task completion flow in task-runner.ts (where .DONE is created)
- [ ] Read current review agent spawning pattern
- [ ] Read roadmap Phase 5 sections 5a, 5d, 5e

### Step 1: Define Quality Gate Configuration & Verdict Schema

- [ ] Add `quality_gate` config section: `enabled` (default false), `review_model`, `max_review_cycles` (default 2), `max_fix_cycles` (default 1), `pass_threshold` (no_critical | no_important | all_clear)
- [ ] Define `ReviewVerdict` interface: verdict, confidence, summary, findings[], statusReconciliation[]
- [ ] Define `ReviewFinding` interface: severity (critical | important | suggestion), category, description, file, remediation
- [ ] Create `extensions/taskplane/quality-gate.ts` module

**Artifacts:**
- `extensions/taskplane/quality-gate.ts` (new)
- `extensions/taskplane/config-schema.ts` (modified)

### Step 2: Implement Structured Review

- [ ] After all steps complete (before .DONE creation), if quality gate enabled, spawn review agent
- [ ] Build review evidence package: PROMPT.md, STATUS.md, git diff, file change list
- [ ] Review agent prompt instructs structured JSON verdict output to `REVIEW_VERDICT.json`
- [ ] Parse verdict file; handle missing/malformed verdict as PASS (fail-open)
- [ ] Apply verdict rules: any critical → NEEDS_FIXES; 3+ important → NEEDS_FIXES; only suggestions → PASS; status_mismatch → NEEDS_FIXES
- [ ] On PASS: proceed to .DONE creation
- [ ] On NEEDS_FIXES: enter remediation (Step 3)

**Artifacts:**
- `extensions/task-runner.ts` (modified)
- `extensions/taskplane/quality-gate.ts` (modified)

### Step 3: Remediation Cycle

- [ ] Write `REVIEW_FEEDBACK.md` to task folder with critical and important findings
- [ ] Spawn fix agent in same worktree with remediation instructions
- [ ] After fix agent exits, re-run structured review (Step 2)
- [ ] After max cycles (default 2 reviews total): mark task failed with review findings
- [ ] `.DONE` only created after PASS verdict — never delete/recreate

**Artifacts:**
- `extensions/task-runner.ts` (modified)
- `extensions/taskplane/quality-gate.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: quality gate disabled (default) → .DONE created normally
- [ ] Test: quality gate enabled, PASS verdict → .DONE created
- [ ] Test: NEEDS_FIXES verdict triggers remediation
- [ ] Test: max cycles exhausted → task marked failed
- [ ] Test: malformed verdict treated as PASS (fail-open)
- [ ] Test: verdict rules (critical, 3+ important, status_mismatch)
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Document quality gate config in `docs/reference/configuration/task-runner.yaml.md`
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/configuration/task-runner.yaml.md` — quality gate config

**Check If Affected:**
- `docs/explanation/execution-model.md` — if .DONE authority changes
- `docs/reference/status-format.md` — if REVIEW_VERDICT.json mentioned

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Quality gate opt-in, backward compatible
- [ ] .DONE only created after PASS when enabled
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-034): complete Step N — description`
- **Bug fixes:** `fix(TP-034): description`
- **Tests:** `test(TP-034): description`
- **Hydration:** `hydrate: TP-034 expand Step N checkboxes`

## Do NOT

- Enable quality gate by default
- Delete `.DONE` during remediation (it was never created — gate runs before creation)
- Change behavior when quality gate is disabled
- Block on suggestion-level findings

---

## Amendments (Added During Execution)
