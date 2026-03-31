# Taskplane Runtime V2 Planning Suite

**Status:** Proposed foundational redesign  
**Created:** 2026-03-30  
**Primary driver:** `docs/specifications/taskplane/spawn-telemetry-stability.md`

This folder defines the long-term runtime architecture for making Taskplane a
**resilient, mailbox-first, dashboard-first agent orchestrator** without TMUX as
part of the correctness path.

## Why this suite exists

Taskplane's durable core is already strong:

- file-backed task memory (`PROMPT.md`, `STATUS.md`, `.DONE`)
- resumable batch state (`.pi/batch-state.json`)
- worktree isolation and orch-managed branches
- operator-first visibility and recovery intent

The instability is concentrated in the **runtime transport/control plane**:

- nested TMUX session spawning
- file-based live telemetry between directly related processes
- `/orch` bootstrapping `/task` through extension/session lifecycle hooks
- ambiguous process ownership and orphan cleanup
- worker visibility tied to terminal infrastructure instead of normalized events

## Top-level decisions

1. **Remove TMUX from the critical execution path**
   - No worker, reviewer, merger, or lane correctness may depend on TMUX.
   - TMUX becomes optional debug UX at most, and can ultimately disappear.

2. **Make the mailbox the canonical steering mechanism**
   - Operators steer only through the supervisor.
   - Supervisor steers agents through mailbox + RPC injection.
   - No direct operator typing into agent terminals.

3. **Remove `/task` from the critical path**
   - `/orch` becomes the single authoritative execution path, including single-task runs.
   - Legacy `/task` becomes a compatibility shim or is removed in a future major version.

4. **Split deterministic orchestration from agent hosting**
   - Deterministic Node processes own lifecycle, retries, cleanup, and state.
   - Pi agents become leaf processes, not orchestration hosts.

5. **Use direct process ownership for live control**
   - Parent/child telemetry should flow directly over IPC/stdio.
   - Files remain the durable audit/recovery layer, not the primary live transport.

6. **Keep existing durable contracts**
   - `STATUS.md`, `.DONE`, batch-state, worktrees, orch branches, and packet-home authority remain foundational.

## Document map

| Document | Purpose |
|---|---|
| [01-architecture.md](01-architecture.md) | Target system architecture and core invariants |
| [02-runtime-process-model.md](02-runtime-process-model.md) | Process ownership, lifecycle, IDs, and `/task` deprecation path |
| [03-bridge-and-mailbox.md](03-bridge-and-mailbox.md) | Mailbox-first steering, agent replies, and runtime bridge contracts |
| [04-observability-and-dashboard.md](04-observability-and-dashboard.md) | Visibility model without TMUX, normalized events, dashboard contracts |
| [05-polyrepo-and-segment-compatibility.md](05-polyrepo-and-segment-compatibility.md) | How the redesign fits packet-home, workspace mode, and segment execution |
| [06-migration-and-rollout.md](06-migration-and-rollout.md) | Phased migration, feature flags, validation, and soak strategy |
| [07-task-crosswalk-and-roadmap.md](07-task-crosswalk-and-roadmap.md) | Mapping to existing TP-082..TP-093 work and recommended implementation order |
| [assumption-lab-report.md](assumption-lab-report.md) | TP-110 validation results for direct host, telemetry, mailbox, and open packet-path/bridge risks |

## Scope of the redesign

### Preserved

- task packet model
- file-backed batch state
- wave/lane/worktree/orch-branch model
- supervisor concept
- mailbox concept
- dashboard as primary operator surface
- workspace/polyrepo support

### Replaced or extracted

- TMUX-backed worker/reviewer/merge spawning
- lane session as a Pi extension host
- `/orch` → `TASK_AUTOSTART` → `/task` bootstrapping as the critical path
- live telemetry by tailing sidecar files written by a sibling process
- session identity being defined by terminal infrastructure

## Relationship to current open task horizon

This suite explicitly accounts for the currently unimplemented roadmap items:

- **Mailbox follow-ons:** TP-091, TP-092, TP-093
- **Packet-home / segment / polyrepo execution:** TP-082 through TP-088

Those tasks are still strategically correct, but several need to be
**re-scoped onto the new runtime architecture** so we do not keep investing in
TMUX-bound execution assumptions.

## Success criteria for Runtime V2

Taskplane should be able to run unattended batches for days with these properties:

- worker/reviewer/merge startup is not TMUX-dependent
- steering works through supervisor + mailbox only
- dashboard shows real conversation/telemetry without pane capture
- every live process has one deterministic owner
- orphans are detectable and killable from a process registry, not guessed from TMUX state
- packet-home and segment execution remain correct in workspace mode
- resume works from persisted state, not from terminal/session assumptions
