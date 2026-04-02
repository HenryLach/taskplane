# Migration and Rollout Plan

**Status:** Proposed  
**Related:** [07-task-crosswalk-and-roadmap.md](07-task-crosswalk-and-roadmap.md)

## 1. Goal

Land Runtime V2 without losing Taskplane’s strongest current properties:

- resumability
- operator clarity
- branch/worktree safety
- polyrepo correctness

This plan assumes the redesign is worth doing **properly**, not as a quick fix.

## 2. Migration principles

1. **Keep durable contracts stable**
   - `STATUS.md`, `.DONE`, `.pi/batch-state.json` remain authoritative.

2. **Migrate transport first, semantics second**
   - replace TMUX/process hosting before broad feature expansion.

3. **Preserve feature semantics where practical**
   - workers still execute tasks, reviews still happen, supervisor still steers.

4. **Allow temporary compatibility shims**
   - dashboard and tools may read both legacy and v2 artifacts during migration.

5. **Feature-flag the runtime backend during transition**
   - avoid big-bang replacement until soak-tested.

## 3. Suggested rollout phases

## Phase 0 — Assumption lab (TP-110)

### Deliverables

- standalone no-TMUX validation harness under `scripts/runtime-v2-lab/`
- durable report in `docs/specifications/framework/taskplane-runtime-v2/assumption-lab-report.md`
- explicit go/no-go notes for direct host, mailbox steering, telemetry, packet-path proof, and bridge proof

### Exit gate

Proceed into foundation extraction only after the lab confirms that direct-child
hosting and mailbox steering are viable enough to justify the refactor.

## Phase A — Foundation extraction

### Deliverables

- extract `task-executor-core` from `task-runner.ts`
- define `ExecutionUnit` and packet-path launch contracts
- define runtime registry + event schemas
- keep existing runtime path operational during extraction

### Why first

This is the minimum needed to stop future work from deepening the `/task` /
extension-host coupling.

## Phase B — Direct-child agent host

### Deliverables

- implement `agent-host.mjs`
- spawn Pi agents directly with `shell: false`
- stream normalized events directly to parent
- persist per-agent manifests/events/exit summaries
- support mailbox inbox delivery in the new host

### Exit gate

Worker and merge hosts can run without TMUX installed.

## Phase C — Lane-runner headless execution

### Deliverables

- implement `lane-runner.ts`
- move orchestrated task execution out of lane Pi extension sessions
- use `task-executor-core` inside lane-runner
- emit lane snapshots directly

### Exit gate

`/orch <PROMPT.md>` can execute a single task entirely without the legacy `/task`
critical path.

## Phase D — Mailbox and bridge completion

### Deliverables

- re-scope TP-091 replies onto registry-backed agent IDs
- land TP-092 broadcast + rate limiting on the new host
- implement bridge tools for `review_step`, supervisor replies, expansion requests
- keep TP-089/090 semantics intact

### Exit gate

Supervisor steering and agent replies work end-to-end on Runtime V2 without TMUX.

## Phase E — Dashboard migration

### Deliverables

- dashboard prefers runtime-v2 registry/snapshots/events
- land TP-093 mailbox panel on the new artifacts
- replace TMUX-centric active-agent visibility
- conversation viewer reads normalized event streams

### Exit gate

Dashboard provides full live visibility with no TMUX pane capture dependency.

## Phase F — Workspace/segment parity

### Deliverables

- thread packet-path authority through engine/resume/lane-runner
- re-scope and land TP-082/088 on the new runtime
- continue TP-085/086/087 on execution-unit contracts
- complete polyrepo acceptance coverage

### Exit gate

Workspace-mode smoke tests and segment-roadmap prerequisites pass on Runtime V2.

## Phase F.1 — Batch and merge cutover (TP-108) ✅ Implemented

### Delivered

- Runtime V2 backend selected for all repo-mode batches (not just single-task)
- Resume parity: `resumeOrchBatch` uses `selectRuntimeBackend` and threads backend through `executeWave` and `mergeWaveByRepo`
- Merge host migration: `spawnMergeAgentV2()` spawns merge agents via direct agent-host (no TMUX)
- Merge agent runs with process registry tracking, normalized events (events.jsonl), and mailbox support
- Engine and resume both thread `selectedBackend`/`resumeBackend` through all merge calls
- Abort/cleanup includes V2 merge agent kill via `killMergeAgentV2()`
- Workspace mode explicitly falls back to legacy (deferred to TP-109)

### Exit gate

- Full suite: 3362 pass, 0 failures
- CLI smoke: `taskplane help` and `taskplane doctor` pass

## Phase F.2 — Workspace packet-home and resume (TP-109) ✅ Implemented

### Delivered

- Resume .DONE check uses worktree-relative path via `resolveCanonicalTaskPaths()` in addition to original discovery path
- `selectRuntimeBackend()` returns V2 for ALL batches (workspace included)
- `buildExecutionUnit()` already resolves authoritative packet paths with workspace awareness
- Lane-runner uses `unit.packet.*` for all artifact I/O (no cwd fallback)
- No silent cwd-derived authority remains in the Runtime V2 path

### Exit gate

- Full suite: 3366 pass, 0 failures
- CLI smoke passes

## Phase F.3 — Resume and monitor de-TMUX (TP-112) ✅ Implemented

### Delivered

- Resume session liveness: V2 uses process registry (`readRegistrySnapshot` + `isProcessAlive`) instead of `tmuxHasSession`
- Resume reconnect: V2 uses `executeLaneV2` instead of `pollUntilTaskComplete` (TMUX session polling)
- Resume re-execute: V2 uses `executeLaneV2` instead of `spawnLaneSession` + `pollUntilTaskComplete`
- Monitor liveness: `resolveTaskMonitorState` accepts `runtimeBackend`; V2 lanes treated as always-alive (module calls, not TMUX sessions)
- `monitorLanes` and `executeWave` thread backend through to monitor
- Legacy TMUX paths preserved for `backend === "legacy"` only

### Exit gate

- Full suite: 3383 pass, 0 failures

## Phase F.4 — Abort/resume fallback cleanup (TP-119) ✅ Implemented

### Delivered

- Removed Runtime V2 abort-path TMUX fallbacks in `abort.ts`, `execution.ts`, and merge cleanup paths.
- Removed Runtime V2 resume-path TMUX reconnect/liveness fallbacks; reconnect now rehydrates via `executeLaneV2` only.
- Removed dead synchronous TMUX helper usage from runtime control paths (`tmuxHasSession`, `tmuxKillSession`, `tmuxAsync`) and migrated lingering cleanup to process-registry-backed V2 handles.
- Added regression coverage for final cleanup behavior to ensure lingering lane/merge agents are terminated via Runtime V2 process handles (no TMUX fallback branch).

### Exit gate

- Full suite: 3403 pass, 0 failures
- Runtime V2 abort/resume/cleanup control paths no longer depend on TMUX fallback branches

## Phase G — Default switch and cleanup

### Deliverables

- make Runtime V2 the default backend
- deprecate and then remove TMUX runtime dependency
- convert `/task` into shim or remove in next major
- retire legacy telemetry/session discovery code paths

### Exit gate

No production path requires TMUX. Legacy code is no longer authoritative.

## 4. Feature flag strategy

Introduce a project/runtime config gate such as:

```json
{
  "orchestrator": {
    "runtimeBackend": "legacy-tmux" | "process-v2"
  }
}
```

### Rules

- new projects may eventually default to `process-v2`
- migration period supports both
- dashboard server can detect both artifact families
- legacy backend is removable only after soak and workspace parity

## 5. Validation strategy

## 5.1 Unit and integration tests

Required new coverage areas:

- process registry lifecycle
- direct-child agent hosting
- mailbox delivery without TMUX
- bridge request/response contracts
- packet-path authority in lane-runner and resume
- dashboard reading normalized runtime artifacts

## 5.2 End-to-end batch tests

Required scenarios:

1. single-task `/orch <PROMPT.md>` run, repo mode
2. multi-task batch with worker review cycles
3. merge failure and recovery path
4. supervisor steering while worker is live
5. worker crash + restart + telemetry continuity
6. mailbox reply/escalation round trip
7. workspace-mode packet-home != execution repo
8. forced interruption + resume

## 5.3 Soak tests

Because the product target is multi-day unattended operation, Runtime V2 needs
intentional soak criteria.

### Minimum soak suite

- 6-hour continuous batch on Windows
- 6-hour continuous batch on macOS/Linux
- repeated worker spawn/kill/retry loops
- repeated steering messages under load
- repeated dashboard polling + SSE subscribers

### Stretch soak suite

- 24-hour unattended batch with mixed review, retries, and supervisor interventions

## 6. Operational migration

## 6.1 CLI/docs changes

When Runtime V2 becomes default:

- `taskplane doctor` stops treating TMUX as a required runtime dependency
- `taskplane install-tmux` becomes optional/deprecated, then removable
- README and install docs should describe dashboard + supervisor as the operator path
- `/orch-sessions` may be aliased to process-registry-backed agent listings or renamed later

## 6.2 Supervisor/tool changes

Update tools to use registry-backed agent IDs:

- `send_agent_message`
- `read_agent_status`
- `list_active_agents`
- future `read_agent_replies`

## 6.3 Dashboard changes

The dashboard server should tolerate both artifact layouts during migration.

## 7. Kill-switch posture

Even during Runtime V2 rollout, retain a clean rollback path:

- runtime backend feature flag
- clear operator messaging on which backend is active
- separate artifact roots where necessary to avoid ambiguity

## 8. What not to do

1. **Do not** keep layering fixes onto nested TMUX worker hosting while the redesign is underway.
2. **Do not** implement new mailbox/dashboard features against TMUX-only liveness assumptions.
3. **Do not** ship packet-path/segment features that still infer authority from `cwd`.
4. **Do not** switch defaults before Windows soak stability is demonstrated.

## 9. Definition of success

Runtime V2 rollout is complete when:

- TMUX is not required for correctness
- single-task and batch execution both use the same headless runtime core
- dashboard visibility and steering are fully mailbox/event based
- workspace/packet-home correctness holds under resume
- soak tests demonstrate reliable unattended execution on Windows
