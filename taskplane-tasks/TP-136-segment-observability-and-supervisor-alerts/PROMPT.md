# Task: TP-136 - Segment Observability and Supervisor Alerts

**Created:** 2026-04-03
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Adds segment context to existing observability surfaces (dashboard, supervisor alerts, orch-status). Uses data already produced by TP-133/134/135. Low risk.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-136-segment-observability-and-supervisor-alerts/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Surface segment-level information in operator-facing tools: dashboard, supervisor alerts, and orch-status output. The data is produced by TP-133 (engine), TP-134 (lane-runner snapshots), and TP-135 (persistence). This task wires it to the user.

### What's needed

1. **Dashboard**: Show active segment per lane, segment status per task, packet home repo
2. **Supervisor alerts**: Include segment context (segmentId, repoId, frontier snapshot) in failure alerts
3. **orch-status**: Show segment progress when running multi-segment tasks
4. **Batch summary**: Include segment-level outcomes in completion summary

## Dependencies

- **Task:** TP-134 (segment-aware lane execution — provides segmentId in snapshots)
- **Task:** TP-135 (segment persistence — provides persisted segment state)

## Context to Read First

- `dashboard/server.cjs` — how dashboard reads lane snapshots and batch state
- `dashboard/public/app.js` — how tasks/lanes are rendered
- `extensions/taskplane/formatting.ts` — orch-status text formatting
- `extensions/taskplane/supervisor.ts` — supervisor alert payloads

## File Scope

- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `dashboard/public/style.css`
- `extensions/taskplane/formatting.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/supervisor-primer.md`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Check what segmentId and segment data is available in lane snapshots
- [ ] Check what segment data is available in batch state

### Step 1: Dashboard segment visibility
- [ ] Show active segment (repoId) per lane in lane header
- [ ] Show segment progress per task (e.g., "Segment 2/3: api-service")
- [ ] Show packet home repo in task details
- [ ] Handle repo-singleton tasks gracefully (no segment clutter)

### Step 2: Supervisor segment alerts
- [ ] Add segmentId and repoId to failure alert payloads
- [ ] Add segment frontier snapshot to alert context
- [ ] Update supervisor primer with segment recovery guidance

### Step 3: Status and summary
- [ ] orch-status output includes active segment per lane
- [ ] Batch summary includes segment-level outcomes for multi-segment tasks
- [ ] read_agent_status shows segment info when available

### Step 4: Tests and verification
- [ ] Test: dashboard renders segment info when available
- [ ] Test: supervisor alert includes segment context
- [ ] Test: repo-singleton display is clean (no segment noise)
- [ ] Run full suite, fix failures

### Step 5: Documentation & Delivery
- [ ] Update STATUS.md

## Do NOT

- Implement dynamic expansion UI (deferred)
- Modify engine or lane-runner execution logic
- Add segment-level controls (reorder, skip individual segments) — that's a follow-up

## Git Commit Convention

- `feat(TP-136): complete Step N — ...`
