# Task: TP-164 - Live merge agent telemetry in dashboard (#465)

**Created:** 2026-04-11
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Touches three separate layers (engine, dashboard server, dashboard client) and introduces a new file format. Plan review essential to confirm the snapshot approach before writing code. Code review to verify the telemetry data flows end-to-end correctly.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-164-merge-agent-live-dashboard-telemetry/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix issue #465: the MERGE AGENTS pane in the dashboard shows nothing during the merge phase and only populates after completion. This is because Runtime V2 merge agents emit telemetry to `events.jsonl` but have no equivalent of the `lane-N.json` snapshot file that workers use for live dashboard updates.

The fix follows the exact same pattern as worker lane snapshots:

1. **Add a merge snapshot path** (`merge-N.json` alongside `lane-N.json`)
2. **Write merge snapshots from `spawnMergeAgentV2`** via an `onTelemetry` callback — same pattern as `emitSnapshot` in `lane-runner.ts`
3. **Load merge snapshots in the dashboard server** — same pattern as `loadRuntimeLaneSnapshots`
4. **Expose active merge sessions to the client** — populate `sessions` from the registry instead of always returning `[]`

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/types.ts` — `RuntimeLaneSnapshot`, `RuntimeAgentTelemetrySnapshot`, `runtimeLaneSnapshotPath` (lines ~3884-3950, ~4074)
- `extensions/taskplane/process-registry.ts` — `writeLaneSnapshot`, `readLaneSnapshot` (lines ~334-365)
- `extensions/taskplane/lane-runner.ts` — `emitSnapshot` function (lines ~743-805) — the pattern to replicate
- `extensions/taskplane/merge.ts` — `spawnMergeAgentV2` (lines ~528-638) — where to add the telemetry callback
- `dashboard/server.cjs` — `getActiveSessions` (line ~196), `loadRuntimeLaneSnapshots` (line ~389), `buildDashboardState` (line ~1032), `synthesizeLaneStateFromSnapshot` — the patterns to follow
- `dashboard/public/app.js` — merge pane rendering, `mergeSessions` usage (lines ~905, ~922, ~976, ~989, ~1029)

## Environment

- **Workspace:** `extensions/taskplane/` and `dashboard/`
- **Services required:** None

## File Scope

- `extensions/taskplane/types.ts` — add `RuntimeMergeSnapshot` interface and `runtimeMergeSnapshotPath()` function
- `extensions/taskplane/process-registry.ts` — add `writeMergeSnapshot()` and `readMergeSnapshot()`
- `extensions/taskplane/merge.ts` — pass `onTelemetry` callback to `spawnAgent` in `spawnMergeAgentV2`, write snapshot on each telemetry update
- `dashboard/server.cjs` — add `loadRuntimeMergeSnapshots()`, update `getActiveSessions()` to derive merger session names from registry, add merge snapshots to `buildDashboardState` response
- `dashboard/public/app.js` — use merge snapshot telemetry in the merge pane (if needed — the merge pane may already work once `mergeSessions` is populated and `telemetry[session]` is available)

## Steps

### Step 0: Preflight

- [ ] Read `runtimeLaneSnapshotPath` and `writeLaneSnapshot` in `types.ts` / `process-registry.ts`
- [ ] Read `emitSnapshot` in `lane-runner.ts` — understand the `onTelemetry` callback pattern
- [ ] Read `spawnMergeAgentV2` in `merge.ts` — understand the `spawnAgent` call and current `onTelemetry` absence
- [ ] Read `loadRuntimeLaneSnapshots` and `buildDashboardState` in `server.cjs`
- [ ] Read how the merge pane uses `sessions` and `telemetry` in `app.js`
- [ ] Read how `spawnAgent` in `agent-host.ts` delivers `onTelemetry` callbacks
- [ ] Verify test baseline: `cd extensions && npm run test:fast`

### Step 1: Add merge snapshot infrastructure

**In `types.ts`:**

Add a `RuntimeMergeSnapshot` interface (analogous to `RuntimeLaneSnapshot` but simpler — no progress/reviewer):

```typescript
export interface RuntimeMergeSnapshot {
    batchId: string;
    mergeNumber: number;          // 1-indexed merge agent number
    sessionName: string;          // e.g. "orch-henry-merge-1"
    waveIndex: number;
    status: "running" | "complete" | "failed";
    agent: RuntimeAgentTelemetrySnapshot | null;
    updatedAt: number;
}
```

Add `runtimeMergeSnapshotPath(stateRoot, batchId, mergeNumber)` alongside `runtimeLaneSnapshotPath`:
```typescript
export function runtimeMergeSnapshotPath(stateRoot: string, batchId: string, mergeNumber: number): string {
    return `${stateRoot}/.pi/runtime/${batchId}/lanes/merge-${mergeNumber}.json`;
}
```

Note: using the `lanes/` directory is intentional — it's already scanned by the dashboard.

- [ ] Add `RuntimeMergeSnapshot` interface to `types.ts`
- [ ] Add `runtimeMergeSnapshotPath()` function to `types.ts`

**In `process-registry.ts`:**

Add `writeMergeSnapshot` and `readMergeSnapshot` following the exact pattern of `writeLaneSnapshot`/`readLaneSnapshot`.

- [ ] Add `writeMergeSnapshot(stateRoot, batchId, mergeNumber, snapshot)` to `process-registry.ts`
- [ ] Add `readMergeSnapshot(stateRoot, batchId, mergeNumber)` to `process-registry.ts`
- [ ] Export both from `process-registry.ts`

### Step 2: Write snapshots from spawnMergeAgentV2

In `merge.ts`, `spawnMergeAgentV2` calls `spawnAgent(opts)`. Add an `onTelemetry` callback that writes a merge snapshot on each telemetry update:

```typescript
// Derive merge number from sessionName (e.g. "orch-henry-merge-1" → 1)
const mergeNumberMatch = sessionName.match(/-merge-(\d+)$/);
const mergeNumber = mergeNumberMatch ? parseInt(mergeNumberMatch[1]) : 1;
const startedAt = Date.now();

const { promise, kill } = spawnAgent(opts, undefined, (telemetry) => {
    try {
        writeMergeSnapshot(stateRoot ?? repoRoot, bid, mergeNumber, {
            batchId: bid,
            mergeNumber,
            sessionName,
            waveIndex: 0,   // not available here — pass as parameter if needed
            status: "running",
            agent: {
                agentId: sessionName,
                status: "running",
                elapsedMs: Date.now() - startedAt,
                toolCalls: telemetry.toolCalls ?? 0,
                contextPct: telemetry.contextUsage?.percent ?? 0,
                costUsd: telemetry.costUsd ?? 0,
                lastTool: telemetry.lastTool ?? "",
                inputTokens: telemetry.inputTokens ?? 0,
                outputTokens: telemetry.outputTokens ?? 0,
                cacheReadTokens: telemetry.cacheReadTokens ?? 0,
                cacheWriteTokens: telemetry.cacheWriteTokens ?? 0,
            },
            updatedAt: Date.now(),
        });
    } catch { /* non-fatal */ }
});
```

Also write a terminal snapshot on promise completion (status "complete" or "failed").

Check `spawnAgent`'s signature — the `onTelemetry` callback is the third parameter (`AgentTelemetryCallback`). Verify the exact signature before implementing.

- [ ] Add `onTelemetry` callback to `spawnAgent` call in `spawnMergeAgentV2`
- [ ] Write `running` snapshot on each telemetry update
- [ ] Write `complete`/`failed` terminal snapshot in the `promise.then`/`.catch` handlers
- [ ] Wrap all snapshot writes in try/catch (non-fatal)

### Step 3: Load and expose merge snapshots in dashboard server

**In `server.cjs`:**

Add `loadRuntimeMergeSnapshots(batchId)` modelled on `loadRuntimeLaneSnapshots`:
- Read all `merge-N.json` files from `.pi/runtime/{batchId}/lanes/`
- Return a map of `mergeNumber → snapshot`

Update `getActiveSessions()` to return active merger session names from the registry:
```javascript
function getActiveSessions() {
    const state = loadBatchState();
    if (!state?.batchId) return [];
    const registry = loadRuntimeRegistry(state.batchId);
    if (!registry?.agents) return [];
    // Return session names for active (non-terminal) merger agents
    return Object.values(registry.agents)
        .filter(a => a.role === 'merger' && !['exited','killed','crashed','timed_out'].includes(a.status))
        .map(a => a.agentId);
}
```

Add `runtimeMergeSnapshots` to `buildDashboardState` response, and add merge snapshot telemetry to the `telemetry` map so `telemetry[sessionName]` resolves for the merge pane:

- [ ] Add `loadRuntimeMergeSnapshots(batchId)` to `server.cjs`
- [ ] Update `getActiveSessions()` to return active merger session names from registry
- [ ] Add merge snapshot telemetry into the `telemetry` map in `buildDashboardState`
- [ ] Expose `runtimeMergeSnapshots` in the response object (for future use)

### Step 4: Testing & Verification

- [ ] Run full test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Run CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs init --preset full --dry-run --force`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Add JSDoc to `RuntimeMergeSnapshot` and `runtimeMergeSnapshotPath`
- [ ] Comment in `spawnMergeAgentV2` explaining the snapshot write
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- Inline comments in `spawnMergeAgentV2` and `getActiveSessions`

**Check If Affected:**
- None

## Completion Criteria

- [ ] All steps complete
- [ ] `merge-N.json` files written to `.pi/runtime/{batchId}/lanes/` during merge phase
- [ ] `getActiveSessions()` returns active merger session names
- [ ] Merge pane shows live telemetry (tool calls, cost, context %, elapsed) during merge phase
- [ ] Full test suite passing

## Git Commit Convention

- **Step completion:** `fix(TP-164): complete Step N — description`
- **Hydration:** `hydrate: TP-164 expand Step N checkboxes`

## Do NOT

- Change the merge result file format (`merge-result-*.json`) — that's separate from the telemetry snapshot
- Touch `waitForMergeResult()` or the polling mechanism
- Change `RuntimeLaneSnapshot` — merge agents get their own interface
- Commit without the task ID prefix

---

## Amendments (Added During Execution)
