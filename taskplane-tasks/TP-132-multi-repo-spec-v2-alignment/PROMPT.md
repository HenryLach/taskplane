# Task: TP-132 - Multi-Repo Spec V2 Alignment

**Created:** 2026-04-03
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Documentation-only task updating the spec to match V2 reality. No code changes. Low risk.
**Score:** 1/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-132-multi-repo-spec-v2-alignment/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Update `docs/specifications/taskplane/multi-repo-task-execution.md` to reflect Runtime V2 architecture. The spec was written 2026-03-28 targeting TMUX-era patterns. The goals and data model are correct, but the implementation approach references must be updated for:

- Subprocess agent-host model (not TMUX sessions)
- `ExecutionUnit` + `PacketPaths` contracts (not env vars like `TASK_PACKET_*`)
- `lane-runner.ts` execution path (not `task-runner.ts`)
- Engine worker thread model (not main thread)
- Process registry + mailbox communication (not terminal I/O)

Also define the MVP scope clearly: sequential per-task segment execution, no dynamic expansion in first tranche. Dynamic expansion is deferred to a follow-up.

## Dependencies

- None

## Context to Read First

- `docs/specifications/taskplane/multi-repo-task-execution.md` — the spec to update
- `extensions/taskplane/types.ts` — ExecutionUnit, PacketPaths, TaskSegmentPlan, SegmentId types
- `extensions/taskplane/execution.ts` — buildExecutionUnit() function
- `extensions/taskplane/waves.ts` — buildSegmentPlanForTask(), computeWaveAssignments()

## File Scope

- `docs/specifications/taskplane/multi-repo-task-execution.md`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read the current spec completely
- [ ] Read types.ts for ExecutionUnit, PacketPaths, TaskSegmentPlan
- [ ] Read execution.ts buildExecutionUnit()

### Step 1: Update execution model references
- [ ] Replace TMUX session references with subprocess agent-host model
- [ ] Replace `TASK_PACKET_*` env var contract with `ExecutionUnit.packet` / `PacketPaths` approach
- [ ] Replace task-runner.ts references with lane-runner.ts execution path
- [ ] Update engine threading model (worker thread, not main thread)
- [ ] Update supervisor integration to reference V2 tools (orch_status, send_agent_message, etc.)

### Step 2: Add MVP scope section
- [ ] Define MVP: sequential per-task segment execution on V2 runtime
- [ ] Explicitly defer dynamic expansion to post-MVP
- [ ] Add acceptance matrix: linear DAG, fan-out, no DAG metadata, single-repo fallback
- [ ] Document what's already implemented (types, planning, discovery) vs what's needed (engine, lane-runner, resume)

### Step 3: Update implementation plan
- [ ] Replace Phase B-F with V2-native task references (TP-133 through TP-136)
- [ ] Mark Phase A (this spec) and Phase B (schema v4) as complete
- [ ] Update status from "Draft" to "V2 Aligned"

### Step 4: Documentation & Delivery
- [ ] Update STATUS.md

## Do NOT

- Change the data model (types are already correct)
- Change the acceptance criteria (still valid)
- Add code changes (spec-only task)
- Remove the dynamic expansion section (keep as deferred, not deleted)

## Git Commit Convention

- `feat(TP-132): complete Step N — ...`
