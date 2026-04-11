# Task: TP-158 - Re-read config on /orch start to fix stale task_areas (#460)

**Created:** 2026-04-10
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Small, targeted change to one function. Plan review warranted because the reload touches `execCtx`, `orchConfig`, `runnerConfig` — the same state that all `/orch*` commands depend on, and the fix must not break mid-batch behavior.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-158-orch-config-reload-on-start/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix issue #460: when `.pi/taskplane-config.json` (or other Taskplane config files) are created **after** the pi session has already started, subsequent `/orch` runs fail with "Discovery had fatal errors" or dependency errors because `execCtx`/`runnerConfig` were loaded at `session_start` and never refreshed.

The fix: at the beginning of `doOrchStart()` in `extension.ts`, attempt to reload `execCtx`, `orchConfig`, `runnerConfig`, and `supervisorConfig` from disk before proceeding — the same reload logic already used by the `/taskplane-settings` `onConfigChanged` callback.

**Guard:** only reload when not already executing a batch (phase is not `executing`, `launching`, `merging`, or `planning`) to avoid swapping config mid-run.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/extension.ts` — `doOrchStart()` (search for `async function doOrchStart`), the `/taskplane-settings` `onConfigChanged` handler (search for `onConfigChanged`), `session_start` handler, and module-level variable declarations (`orchConfig`, `runnerConfig`, `supervisorConfig`, `execCtx`)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`

## Steps

### Step 0: Preflight

- [ ] Read `doOrchStart()` in `extension.ts` — understand the guard structure and where config is used
- [ ] Read the `/taskplane-settings` `onConfigChanged` callback — this is the reload pattern to replicate
- [ ] Read the `session_start` handler — understand what gets set at startup
- [ ] Verify test baseline: `cd extensions && npm run test:fast`

### Step 1: Add config reload at the top of doOrchStart()

Add a config-reload block near the top of `doOrchStart()`, before the execution context guard (`if (!execCtx)`):

```typescript
// Reload config from disk so changes made after session start
// (e.g. creating .pi/ config mid-session) take effect immediately.
// Skip if a batch is already active — don't swap config mid-run.
const activePhase = orchBatchState.phase;
const isActiveBatch = activePhase === "executing" || activePhase === "launching"
    || activePhase === "merging" || activePhase === "planning";
if (!isActiveBatch) {
    try {
        const freshCtx = buildExecutionContext(ctx.cwd, loadOrchestratorConfig, loadTaskRunnerConfig);
        execCtx = freshCtx;
        orchConfig = freshCtx.orchestratorConfig;
        runnerConfig = freshCtx.taskRunnerConfig;
        try {
            supervisorConfig = loadSupervisorConfig(freshCtx.repoRoot, freshCtx.pointer?.configRoot);
        } catch {
            supervisorConfig = { ...DEFAULT_SUPERVISOR_CONFIG };
        }
    } catch {
        // Non-fatal — if reload fails, proceed with existing config.
        // The existing config guard below will handle a null execCtx.
    }
}
```

- [ ] Implement the reload block as described above
- [ ] Verify it is positioned BEFORE the `if (!execCtx)` guard (so a freshly-created config that makes execCtx non-null works correctly)
- [ ] Verify it uses the same atomic pattern as the `/taskplane-settings` reload (build all into temporaries before assigning)

Wait — re-read the `/taskplane-settings` handler to check whether it already builds atomically. Replicate exactly.

### Step 2: Testing & Verification

- [ ] Run full test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Run CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs init --preset full --dry-run --force`
- [ ] Fix all failures

### Step 3: Documentation & Delivery

- [ ] Add a brief comment above the reload block explaining why it's there and what it fixes
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/extension.ts` — inline comment explaining the reload

**Check If Affected:**
- None — this is a focused single-function change

## Completion Criteria

- [ ] All steps complete
- [ ] Config created after session start is picked up by next `/orch` run
- [ ] No reload happens during an active batch (phase guard)
- [ ] Full test suite passing
- [ ] CLI smoke passing

## Git Commit Convention

- **Step completion:** `fix(TP-158): complete Step N — description`
- **Hydration:** `hydrate: TP-158 expand Step N checkboxes`

## Do NOT

- Reload config inside the no-args `/orch` routing handler (only needed in `doOrchStart`)
- Reload during an active batch
- Change the `/taskplane-settings` reload logic
- Touch any file other than `extension.ts`
- Commit without the task ID prefix

---

## Amendments (Added During Execution)
