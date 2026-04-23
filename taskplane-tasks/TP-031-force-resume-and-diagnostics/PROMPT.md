# Task: TP-031 — Force-Resume Policy & Diagnostic Reports

**Created:** 2026-03-19
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Changes resume semantics and adds diagnostic output. Requires careful phase-transition logic. Addresses incident #7 (terminal state trap).
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-031-force-resume-and-diagnostics/
├── PROMPT.md ├── STATUS.md ├── .reviews/ └── .DONE
```

## Mission

Implement `/orch-resume --force` with pre-resume diagnostics and force-intent
recording. Change merge failure default phase from `failed` to `paused`. Add
structured diagnostic reports (JSONL event log + human-readable summary) emitted
on batch completion/failure.

## Dependencies

- **Task:** TP-030 (v3 state schema with resilience fields must exist)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 3 sections 3b, 3c
- `extensions/taskplane/resume.ts` — Current resume logic
- `extensions/taskplane/extension.ts` — Command handlers for /orch-resume
- `extensions/taskplane/types.ts` — Phase types and transitions

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/resume.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/force-resume.test.ts` (new)
- `extensions/tests/diagnostic-reports.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read current resume eligibility logic in resume.ts
- [ ] Read `/orch-resume` command handler in extension.ts
- [ ] Read phase transition logic in engine.ts
- [ ] Read roadmap Phase 3 sections 3b, 3c

### Step 1: Implement Force-Resume Policy

- [ ] Add `--force` flag parsing to `/orch-resume` command handler
- [ ] Run pre-resume diagnostics: worktree health, branch consistency, state coherence
- [ ] Record `resilience.resumeForced = true` in state
- [ ] Reset to `paused` phase only after diagnostics pass
- [ ] Implement resume eligibility matrix: `paused`/`executing`/`merging` = normal resume; `stopped`/`failed` = --force only; `completed` = reject

**Artifacts:**
- `extensions/taskplane/resume.ts` (modified)
- `extensions/taskplane/extension.ts` (modified)

### Step 2: Default Merge Failure to Paused

- [ ] Change merge failure phase transition from `failed` to `paused`
- [ ] Reserve `failed` for unrecoverable invariant violations after retry exhaustion
- [ ] Ensure existing resume path handles `paused` from merge failure correctly

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)

### Step 3: Diagnostic Reports

- [ ] On batch completion/failure, generate JSONL event log: `.pi/diagnostics/{opId}-{batchId}-events.jsonl`
- [ ] Generate human-readable summary: `.pi/diagnostics/{opId}-{batchId}-report.md`
- [ ] Include per-task exit diagnostics, costs, timing, retry history from v3 state
- [ ] In workspace mode, include per-repo breakdown in report
- [ ] Create `.pi/diagnostics/` directory if needed

**Artifacts:**
- `extensions/taskplane/persistence.ts` (modified — add diagnostic report generation)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: --force resume from `failed` phase succeeds with diagnostics
- [ ] Test: normal resume from `failed` phase rejected without --force
- [ ] Test: `paused`/`executing`/`merging` resume without --force
- [ ] Test: `completed` phase rejects all resume attempts
- [ ] Test: merge failure defaults to `paused` not `failed`
- [ ] Test: diagnostic JSONL emitted with correct event schema
- [ ] Test: diagnostic report includes per-task classification and cost
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update `docs/reference/commands.md` — document `--force` flag on `/orch-resume`
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/commands.md` — `/orch-resume --force` documentation

**Check If Affected:**
- `README.md` — command table if --force is user-facing

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] `--force` resume works from `failed`/`stopped` phases
- [ ] Merge failure enters `paused` not `failed`
- [ ] Diagnostic reports generated on batch end
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-031): complete Step N — description`
- **Bug fixes:** `fix(TP-031): description`
- **Tests:** `test(TP-031): description`
- **Hydration:** `hydrate: TP-031 expand Step N checkboxes`

## Do NOT

- Allow --force resume from `completed` phase
- Auto-delete diagnostic reports
- Change command names or add new commands

---

## Amendments (Added During Execution)
