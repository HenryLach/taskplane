# Task: TP-134 - Segment-Aware Lane Execution

**Created:** 2026-04-03
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Lane-runner must handle segment context: different cwd per segment, packet paths in different repo, segmentId in snapshots. Moderate blast radius.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-134-segment-aware-lane-execution/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Make `lane-runner.ts` segment-aware so it can execute tasks where the working directory (segment repo worktree) differs from the packet home repo (where STATUS.md, PROMPT.md, and .DONE live). Currently the lane-runner assumes packet files are in the same directory as the worker cwd. In workspace mode with segments, the worker runs in repo A's worktree but reads/writes STATUS.md in repo B's worktree.

### What already exists

- `ExecutionUnit` carries `packet` (PacketPaths) with resolved paths for PROMPT.md, STATUS.md, .DONE, .reviews/
- `executeTaskV2()` receives an `ExecutionUnit` and uses `unit.packet.statusPath`, `unit.packet.promptPath`, etc.
- `emitSnapshot()` currently hardcodes `segmentId: null`
- `LaneRunnerConfig` has `worktreePath` (execution cwd)

### What's missing

- Lane-runner doesn't propagate `segmentId` to snapshots
- Worker cwd is set to `worktreePath` — for segments, this should be the segment repo's worktree
- Packet paths (STATUS.md, PROMPT.md) may be in a different repo's worktree
- Reviewer state file path assumes packet files are local to cwd

## Dependencies

- **Task:** TP-133 (engine segment frontier)

## Context to Read First

- `extensions/taskplane/lane-runner.ts` — executeTaskV2(), emitSnapshot()
- `extensions/taskplane/execution.ts` — buildExecutionUnit(), executeLaneV2()
- `extensions/taskplane/types.ts` — ExecutionUnit, PacketPaths, LaneRunnerConfig

## File Scope

- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/execution.ts`
- `extensions/tests/lane-runner-v2.test.ts`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Trace how ExecutionUnit flows from engine → execution → lane-runner
- [ ] Identify all places lane-runner derives paths from worktreePath vs packet paths

### Step 1: Propagate segmentId
- [ ] Pass `unit.segmentId` through to `emitSnapshot()` (remove hardcoded null)
- [ ] Include segmentId in lane snapshots for dashboard visibility
- [ ] Include segmentId in telemetry/outcome reporting

### Step 2: Separate execution cwd from packet paths
- [ ] Worker cwd uses segment repo worktree (ExecutionUnit.worktreePath)
- [ ] STATUS.md/PROMPT.md reads use ExecutionUnit.packet paths (may be in different repo worktree)
- [ ] .DONE creation uses ExecutionUnit.packet.donePath
- [ ] .reviews/ uses ExecutionUnit.packet.reviewsDir
- [ ] Reviewer state file (.reviewer-state.json) uses packet task folder

### Step 3: Worker prompt context
- [ ] Worker prompt includes both execution repo context and packet home context
- [ ] Worker knows which repo it's executing in and where packet files are
- [ ] If segment DAG info is available, include it in worker prompt

### Step 4: Tests
- [ ] Test: repo-singleton execution unchanged (no regression)
- [ ] Test: segment execution uses correct cwd (segment repo worktree)
- [ ] Test: segment execution reads/writes packet files in packet home repo
- [ ] Test: snapshots include segmentId
- [ ] Run full suite, fix failures

### Step 5: Documentation & Delivery
- [ ] Update STATUS.md

## Do NOT

- Modify engine.ts (TP-133 handles engine changes)
- Implement dynamic expansion
- Break single-repo execution behavior

## Git Commit Convention

- `feat(TP-134): complete Step N — ...`
