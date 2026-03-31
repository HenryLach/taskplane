# Polyrepo and Segment Compatibility

**Status:** Proposed (updated 2026-03-30 with implementation findings from TP-102)  
**Related:** [01-architecture.md](01-architecture.md), `docs/specifications/taskplane/multi-repo-task-execution.md`

## 1. Purpose

Runtime V2 must not be a single-repo-only stabilization project.

The redesign has to strengthen, not weaken, Taskplane’s path toward:

- packet-home authority
- workspace mode correctness
- segment-aware execution
- cross-repo resume parity
- dynamic segment expansion

This document explains how the headless runtime aligns with TP-082 through TP-088.

## 2. Core compatibility claim

The no-TMUX redesign is **compatible with** and in several places **better for**
packet-home and segment execution, because it removes hidden `cwd` and session
assumptions from the runtime.

## 3. Packet-home authority becomes mandatory runtime data

Runtime V2 requires every execution unit to carry explicit packet-path metadata.

### Required fields

- `promptPath`
- `statusPath`
- `donePath`
- `reviewsDir`
- `packetHomeRepoId`
- `executionRepoId`

### Rule

The lane-runner and any spawned agent-host must treat these packet paths as
**authoritative**. They may not derive packet file locations from `cwd`.

This is the architectural version of what TP-082 and TP-088 are trying to land.

## 4. Execution unit model

Runtime V2 should use a unified `ExecutionUnit` abstraction that supports both
current task-level execution and future segment-level execution.

Suggested shape:

```ts
interface ExecutionUnit {
  id: string;                 // taskId or taskId::segmentId
  taskId: string;
  segmentId?: string | null;
  executionRepoId: string;
  packetHomeRepoId: string;
  worktreePath: string;
  packet: {
    promptPath: string;
    statusPath: string;
    donePath: string;
    reviewsDir: string;
  };
}
```

### Benefit

This lets the engine and lane-runner support:

- current single-task behavior
- packet-home correctness
- future segment frontier scheduling

with one runtime contract.

## 5. Lane-runner behavior in workspace mode

A lane-runner executes in the active segment repo worktree, but packet files may
live elsewhere.

### Therefore

The lane-runner must separate:

- **execution filesystem authority** — active worktree/repo
- **packet filesystem authority** — packet home paths

This directly avoids the split-brain behavior described in the current multi-repo
spec and seen in smoke-test failures.

## 6. `.DONE` semantics in Runtime V2

`.DONE` remains the completion marker, but Runtime V2 tightens the rule:

- the only authoritative `.DONE` path is the execution unit’s explicit `donePath`
- no lane-runner, engine, or resume flow may guess `.DONE` from worktree-relative paths when explicit packet paths exist

This should be enforced everywhere:

- execution completion checks
- resume reconciliation
- artifact staging
- merge follow-up

## 7. STATUS.md semantics in Runtime V2

`STATUS.md` stays authoritative task memory.

### Required invariants

- worker reads/writes authoritative packet `statusPath`
- lane-runner snapshots derive progress from authoritative packet state
- dashboard shows packet-home-aware status in workspace mode
- artifact staging never overwrites a newer packet-home STATUS update with stale execution-local copies

## 8. Segment scheduling compatibility

Runtime V2 does not block the segment roadmap; it gives it a cleaner substrate.

## 8.1 TP-085 — segment frontier scheduler

A headless lane-runner is a better host for segment frontier execution than a
Pi extension session because:

- it can own explicit `ExecutionUnit` metadata
- it can update deterministic frontier state without extension/UI coupling
- it can persist exact segment outcomes and packet paths cleanly

## 8.2 TP-086 / TP-087 — dynamic segment expansion

The bridge + mailbox architecture gives a natural path:

- worker emits `request_segment_expansion`
- lane-runner forwards structured request to engine
- engine notifies supervisor
- supervisor decides
- engine mutates graph/frontier deterministically

This is cleaner than trying to wedge the protocol through lane TMUX sessions.

## 8.3 TP-083 — supervisor segment recovery and reordering

Supervisor recovery should target execution-unit and frontier state, not TMUX sessions.

That becomes easier when:

- lane state is explicit
- execution units are explicit
- active agent IDs are registry-backed

## 8.4 TP-084 — observability

Segment observability should attach naturally to the Runtime V2 event and snapshot model:

- active segment ID in lane snapshots
- packet-home repo badge in task/segment UI
- supervisor intervention history from normalized events

## 9. Resume and reconciliation compatibility

Resume logic should reconstruct from persisted execution-unit state, not from
terminal or transport artifacts.

### Required persisted fields for segment-aware Runtime V2

- execution unit ID (`taskId` or `taskId::segmentId`)
- packet paths
- execution repo ID
- packet home repo ID
- latest lane snapshot state
- last worker/reviewer outcome
- graph revision / frontier metadata when segment expansion is enabled

## 10. Artifact staging contract

Runtime V2 should preserve the current important rule:

- worker-generated packet artifacts are staged into the orch branch after successful execution/merge

But with a stronger constraint:

- staging always sources packet-home-authoritative files
- staging logic must be aware that packet files and source changes may originate in different repos

## 11. Multi-repo worktree model stays intact

Runtime V2 does **not** replace the worktree/orch-branch model.

It preserves:

- repo-scoped worktrees
- repo-scoped lane assignment
- repo-aware merge orchestration
- orch-managed branch lifecycle

The redesign only changes **how the runtime inside those worktrees is hosted and observed**.

## 12. Acceptance criteria for workspace mode

Runtime V2 should not be considered complete until it passes these workspace-mode
acceptance conditions:

1. single-repo behavior remains unchanged when packet paths are local
2. packet-home repo differs from execution repo and STATUS/.DONE still resolve correctly
3. resume uses authoritative packet paths in all reconciliation branches
4. dashboard shows repo ID + packet-home-aware status for active execution units
5. dynamic segment expansion protocol can be layered in without changing runtime identity or mailbox assumptions

## 13. Implementation guidance by task horizon

| Existing task | Runtime V2 interpretation |
|---|---|
| TP-082 | becomes a required base contract for lane-runner + agent-host launches |
| TP-083 | should target execution units/frontier, not TMUX/session recovery |
| TP-084 | should build on runtime registry + normalized events |
| TP-085 | fits naturally into engine + lane-runner headless scheduling |
| TP-086 | should use bridge request + supervisor decision flow |
| TP-087 | should persist graph revisions alongside runtime execution-unit state |
| TP-088 | becomes mandatory for all engine/resume paths in Runtime V2 |

## 14. Implementation notes (from TP-102)

### Cross-repo packet path status

In workspace mode when the task packet home repo differs from the execution repo,
the legacy path copies packet files into the worktree under `.taskplane-tasks/`.
`buildExecutionUnit()` wraps this faithfully — the `packet` paths point to the
execution-local copy, while `packetHomeRepoId` reflects the true home repo.

This means `packetHomeRepoId` may not match the filesystem root of
`packet.taskFolder` in cross-repo scenarios. TP-109 will tighten this so
authoritative packet-home paths are always available separately from any
execution-local copies.

## 15. Recommendation

Do **not** postpone packet-path authority until after the no-TMUX runtime lands.

Instead, treat these as coupled foundations:

- headless runtime ownership
- explicit packet-path authority

They solve the same class of bug: execution state being inferred from the wrong
hosting context.
