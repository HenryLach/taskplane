# Task: TP-110 - Runtime V2 Assumption Lab

**Created:** 2026-03-30
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Focused validation harness and report work outside the main runtime path. Moderate blast radius because it may add scripts and docs, but it is intentionally isolated from production behavior.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-110-runtime-v2-assumption-lab/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Validate the highest-risk Runtime V2 architectural assumptions outside the current TMUX- and `/task`-based production path before the main refactor begins. Build a small standalone lab harness, run the most important direct-spawn / RPC / mailbox / packet-path experiments, and record the results in a durable project file that future sessions can review.

## Dependencies

- **Task:** TP-100 (Runtime V2 planning suite and roadmap exist)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/01-architecture.md` — target Runtime V2 assumptions to validate
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md` — direct-host and registry assumptions
- `docs/specifications/framework/taskplane-runtime-v2/03-bridge-and-mailbox.md` — mailbox and bridge assumptions
- `docs/specifications/taskplane/spawn-telemetry-stability.md` — incident history motivating the lab
- `bin/rpc-wrapper.mjs` — current RPC transport reference

## Environment

- **Workspace:** `scripts/`, `docs/specifications/framework/taskplane-runtime-v2/`, `taskplane-tasks/`
- **Services required:** Local `pi` CLI must be available on PATH


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `scripts/runtime-v2-lab/*`
- `docs/specifications/framework/taskplane-runtime-v2/assumption-lab-report.md`
- `taskplane-tasks/TP-110-runtime-v2-assumption-lab/*`

## Steps

### Step 0: Preflight

- [ ] Confirm the local environment can invoke `pi` directly
- [ ] Define the minimum viable assumption matrix and success criteria before writing the harness

### Step 1: Build the Lab Harness

- [ ] Create standalone scripts under `scripts/runtime-v2-lab/` for direct child spawn, RPC event capture, and mailbox injection experiments
- [ ] Keep the harness independent from TMUX and the current `/task` production path
- [ ] Make the harness cheap to run repeatedly with tiny prompts and bounded iterations

### Step 2: Run Core Assumption Experiments

- [ ] Run direct-spawn reliability experiments (sequential and limited parallel)
- [ ] Run direct-host RPC event/usage capture experiments
- [ ] Run mailbox steering experiments without TMUX
- [ ] Run at least one explicit packet-path / `cwd != packet home` experiment
- [ ] If feasible within the harness, run one minimal bridge-style request/response experiment

### Step 3: Analyze and Document Results

- [ ] Write a durable report summarizing environment, experiment design, results, and interpretation
- [ ] Record which Runtime V2 assumptions are validated, partially validated, or still open
- [ ] Record recommended adjustments to the implementation roadmap before TP-102+ proceeds

### Step 4: Verification & Delivery

- [ ] Re-run the harness after any fixes to confirm the final conclusions
- [ ] Ensure the report references concrete script paths and captured evidence
- [ ] Log discoveries in STATUS.md and mark the task complete

## Documentation Requirements

**Must Update:**
- `docs/specifications/framework/taskplane-runtime-v2/assumption-lab-report.md`

**Check If Affected:**
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`
- `docs/specifications/framework/taskplane-runtime-v2/07-task-crosswalk-and-roadmap.md`

## Completion Criteria

- [ ] A standalone Runtime V2 assumption harness exists in the repo
- [ ] The highest-risk architectural assumptions have been tested with concrete evidence
- [ ] A durable report exists that future sessions can review before refactor work continues

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-110): complete Step N — description`
- **Bug fixes:** `fix(TP-110): description`
- **Tests:** `test(TP-110): description`
- **Hydration:** `hydrate: TP-110 expand Step N checkboxes`

## Do NOT

- Depend on TMUX for any experiment in this task
- Rewrite production orchestrator code before the assumptions are validated
- Leave the conclusions only in conversation; they must be captured in a project file

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
