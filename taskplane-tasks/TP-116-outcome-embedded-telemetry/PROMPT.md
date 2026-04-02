---
id: TP-116
name: Outcome-Embedded Telemetry
type: refactor
size: M
priority: P2
dependencies: []
---

# TP-116: Outcome-Embedded Telemetry

## Objective
Eliminate fragile string-key matching in the batch history writer by embedding telemetry directly into `LaneTaskOutcome`. The lane-runner already has authoritative telemetry from `AgentHostResult` — it should attach it to the outcome at emission time, not require the engine to reconstruct it later via lane snapshot lookups.

## Background
The batch history writer in `engine.ts` reads V2 lane snapshots and tries to match them to task outcomes via lane number parsing from sessionName strings. This has caused multiple bugs:
- `batchState.lanes` undefined → TypeError (v0.23.10)
- sessionName suffix mismatch `-worker` vs no suffix (v0.23.9)
- Key format mismatch `lane-N` vs `orch-X-lane-N` (v0.23.11)

Sage consultation recommended: add `laneNumber` and `telemetry` to `LaneTaskOutcome`, consume directly in batch history, remove string-key join entirely.

## Steps

### Step 0: Preflight
- [ ] Read this PROMPT.md and confirm understanding
- [ ] Read current `LaneTaskOutcome` type in `extensions/taskplane/types.ts`
- [ ] Read batch history writer in `extensions/taskplane/engine.ts` (search "Save batch history")
- [ ] Read lane-runner `makeResult` in `extensions/taskplane/lane-runner.ts`

### Step 1: Extend LaneTaskOutcome Type
- [ ] Add `laneNumber: number` to `LaneTaskOutcome` in `types.ts`
- [ ] Add `telemetry?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; toolCalls: number; durationMs: number }` to `LaneTaskOutcome`
- [ ] Both fields optional for backward compatibility with existing persisted state

### Step 2: Populate in Lane-Runner
- [ ] In `lane-runner.ts` `makeResult()`, populate `outcome.laneNumber` from `config.laneNumber`
- [ ] Populate `outcome.telemetry` from `finalTelemetry` (the `AgentHostResult` or `lastTelemetry`)
- [ ] For skipped tasks (no agent ran), leave `telemetry` undefined

### Step 3: Populate in executeLaneV2
- [ ] In `execution.ts` `executeLaneV2()`, ensure outcomes from `executeTaskV2` carry through laneNumber and telemetry
- [ ] For skipped outcomes (pause/failure skip), set `laneNumber` but leave `telemetry` undefined

### Step 4: Simplify Batch History Writer
- [ ] In `engine.ts` batch history section, read telemetry directly from `to.telemetry` when available
- [ ] Fall back to lane snapshot lookup only when `to.telemetry` is undefined (legacy batches)
- [ ] Remove the `batchState.lanes.find()` dependency entirely for the V2 path
- [ ] Keep the legacy `lane-state-*.json` fallback for pre-V2 batch history

### Step 5: Tests
- [ ] Add unit test: `LaneTaskOutcome` with telemetry → batch history has correct tokens
- [ ] Add unit test: `LaneTaskOutcome` without telemetry → falls back to lane snapshot
- [ ] Add unit test: skipped task → zero tokens (no crash)
- [ ] Verify all existing tests pass (3408+)

### Step 6: Documentation & Delivery
- [ ] Update STATUS.md with completion summary
- [ ] Log any discoveries

## Acceptance Criteria
- Batch history tokens come from outcome.telemetry (no lane snapshot lookup for V2)
- Legacy batches still work via snapshot/sidecar fallback
- No string key matching for V2 telemetry
- All tests pass

## References
- Sage consultation: "Move telemetry into LaneTaskOutcome at emission time"
- `extensions/taskplane/types.ts` — LaneTaskOutcome type
- `extensions/taskplane/engine.ts` — batch history writer
- `extensions/taskplane/lane-runner.ts` — makeResult / executeTaskV2
- `extensions/taskplane/execution.ts` — executeLaneV2
