# Task: TP-159 - Detect and recover ghost workers after silent subprocess death (#461)

**Created:** 2026-04-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Touches the monitor loop and process registry — core execution path. Logic must be correct on all platforms (Windows `process.kill(pid, 0)` behavior differs). Risk of false-positive failure detection if grace periods aren't handled correctly.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-159-ghost-worker-liveness-detection/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix issue #461: when a worker subprocess dies silently (OOM kill, segfault, parent crash) without going through the normal completion handshake, Taskplane leaves the batch in a perpetual `executing` state. The process registry, lane snapshot, and batch state all continue reporting the worker as `running` even though both the worker PID and parent PID are dead.

The infrastructure to detect this already exists but is not wired up:
- `detectOrphans(registry)` in `process-registry.ts` — scans for non-terminal registry entries with dead PIDs
- `markOrphansCrashed(stateRoot, batchId, orphanIds)` — updates their manifests to `crashed`
- `isProcessAlive(pid)` — reliable PID liveness check (used inside `isV2AgentAlive`)

The fix has two parts:
1. **Monitor loop**: call `detectOrphans` + `markOrphansCrashed` once per poll cycle to immediately update stale registry entries when PIDs are dead. This ensures `list_active_agents`, `read_agent_status`, and dashboard all reflect reality promptly.
2. **Lane snapshot staleness**: when the lane snapshot's `updatedAt` is very old (beyond a generous threshold) AND the registry shows the worker is dead/crashed, immediately return `failed` instead of waiting for the full stall timeout.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/execution.ts` — `monitorLanes()` poll loop (lines ~1111-1340), `resolveTaskMonitorState()` (lines ~855-1070), `isV2AgentAlive()` (lines ~167-193)
- `extensions/taskplane/process-registry.ts` — `detectOrphans()`, `markOrphansCrashed()`, `isProcessAlive()` (lines ~213-290)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/execution.ts`
- `extensions/taskplane/process-registry.ts` (read only — may need minor additions)

## Steps

### Step 0: Preflight

- [ ] Read `monitorLanes()` in `execution.ts` — understand the full poll loop structure
- [ ] Read `resolveTaskMonitorState()` — understand the `sessionAlive` decision tree and grace periods
- [ ] Read `detectOrphans()` and `markOrphansCrashed()` in `process-registry.ts` — confirm they exist and are correct
- [ ] Verify test baseline: `cd extensions && npm run test:fast`

### Step 1: Wire orphan detection into the monitor poll loop

In `monitorLanes()`, after the existing liveness registry refresh (line ~1170: `setV2LivenessRegistryCache(readRegistrySnapshot(...))`), add orphan detection:

```typescript
// Detect and mark crashed workers — updates registry on disk so
// list_active_agents and dashboard reflect reality immediately.
if (runtimeBackend === "v2" && batchId) {
    try {
        const registry = readRegistrySnapshot(stateRootForRegistry ?? repoRoot, batchId);
        const orphans = detectOrphans(registry);
        if (orphans.length > 0) {
            markOrphansCrashed(stateRootForRegistry ?? repoRoot, batchId, orphans);
            // Refresh cache so this poll cycle sees the updated status
            setV2LivenessRegistryCache(
                readRegistrySnapshot(stateRootForRegistry ?? repoRoot, batchId)
            );
        }
    } catch { /* non-fatal — monitor loop must never throw */ }
}
```

- [ ] Implement orphan detection block in the monitor poll loop
- [ ] Ensure it is wrapped in try/catch (monitor loop must never throw)
- [ ] Ensure the cache is refreshed after marking orphans

### Step 2: Fast-fail on dead PID + stale snapshot

In `resolveTaskMonitorState()`, in the section that handles `snap == null || snap.taskId !== taskId` AND stale > 30s (lines ~898-910), add a fast-fail path for confirmed dead workers:

Currently the code consults `isV2AgentAlive` after 30s staleness, but `isV2AgentAlive` may still return true if the registry hasn't been updated yet. After Step 1, orphans get marked `crashed` each poll cycle, so `isV2AgentAlive` will correctly return false for dead PIDs. But add an explicit fast-fail for robustness:

When `snap.updatedAt` is stale beyond `stallTimeoutMs / 2` (half the stall timeout) AND `isV2AgentAlive` returns false, return `failed` immediately rather than continuing to wait for the stall timer. This ensures the monitor doesn't wait the full stall timeout (default 30 min) before declaring a ghost worker failed.

- [ ] Read the existing grace period logic carefully before modifying — do NOT reduce the 30s startup grace (that's needed for slow workers)
- [ ] The fast-fail should only apply when `trackerAgeMs >= 60_000` (startup grace has elapsed) AND snapshot is stale AND agent is confirmed dead
- [ ] Implement fast-fail path

### Step 3: Verify supervisor/operator visibility

- [ ] Confirm that when `markOrphansCrashed` updates the registry, `read_agent_status` and `list_active_agents` tools reflect the crashed status on the next call
- [ ] Confirm that the `failed` task result from `resolveTaskMonitorState` flows through the monitor loop and results in the batch phase transitioning to `failed` (or `stopped`) as expected — trace the path from `snapshot.status === "failed"` to `terminalTasks.set()` to `totalFailed++` to engine failure handling

### Step 4: Testing & Verification

- [ ] Run full test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Run CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs init --preset full --dry-run --force`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Add comments explaining the orphan detection block and fast-fail path
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/execution.ts` — inline comments for new logic

**Check If Affected:**
- `docs/explanation/persistence-and-resume.md` — may mention stall detection behavior

## Completion Criteria

- [ ] All steps complete
- [ ] Orphan detection fires every poll cycle and updates registry immediately
- [ ] A dead-PID worker is detected and marked `crashed` within one poll interval (default 5s)
- [ ] A ghost worker that died after startup grace period fails within at most `stallTimeout / 2` minutes (not the full stall timeout)
- [ ] `list_active_agents` and `read_agent_status` accurately reflect crashed workers
- [ ] Full test suite passing
- [ ] CLI smoke passing

## Git Commit Convention

- **Step completion:** `fix(TP-159): complete Step N — description`
- **Hydration:** `hydrate: TP-159 expand Step N checkboxes`

## Do NOT

- Reduce the 30-second startup grace period (needed for legitimate slow starts)
- Reduce the 60-second tracker startup grace (needed for wave transitions)
- Make the monitor loop throw on errors — all new code must be wrapped in try/catch
- Modify `isProcessAlive()` — it uses `process.kill(pid, 0)` which is the correct cross-platform approach for PID liveness
- Touch lane-runner, agent-host, or any spawning code — this is a pure monitor-side fix
- Commit without the task ID prefix

---

## Amendments (Added During Execution)
