# Task: TP-161 - Extract task-runner utilities into taskplane library

**Created:** 2026-04-11
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Creates two new modules and updates 6+ test files. The extraction must be behaviorally identical to the originals — any signature changes need explicit documentation. Test coverage provides the regression net but the plan must be correct before writing any code.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 0, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-161-task-runner-extract-utilities/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

First phase of the task-runner consolidation (see `docs/specifications/taskplane/task-runner-consolidation.md`). The goal of this task is to:

1. Run a full preflight inventory to find every reference to `task-runner.ts`
2. Create `extensions/taskplane/sidecar-telemetry.ts` with verbatim-extracted sidecar utilities
3. Create `extensions/taskplane/context-window.ts` with extracted context window utilities (adapted signature — see spec)
4. Export `loadAgentDef` from `execution.ts` for test use
5. Update all test files to import from the new locations
6. Verify the full test suite passes

`extensions/task-runner.ts` is NOT deleted in this task — that is TP-162. This task only creates the new homes and updates the test imports. The goal is a green test suite with both the old file still present and the new modules in place. TP-162 will then delete `task-runner.ts` knowing the tests are already pointed at the new locations.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/task-runner-consolidation.md` — full spec including open question resolutions
- `extensions/task-runner.ts` — source of the utilities to extract (read the relevant sections)
- `extensions/taskplane/task-executor-core.ts` — verify `isLowRiskStep` is already there
- `extensions/taskplane/execution.ts` — where `loadAgentDef` will be exported from

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/taskplane/sidecar-telemetry.ts` (new)
- `extensions/taskplane/context-window.ts` (new)
- `extensions/taskplane/execution.ts` (export `loadAgentDef`)
- `extensions/tests/context-pressure-cache.test.ts` (update imports)
- `extensions/tests/context-window-autodetect.test.ts` (update imports)
- `extensions/tests/context-window-resolution.test.ts` (update imports)
- `extensions/tests/project-config-loader.test.ts` (update imports)
- `extensions/tests/task-runner-review-skip.test.ts` (update imports)
- `extensions/tests/sidecar-tailing.test.ts` (update imports)
- Additional test files discovered during Step 0 preflight

## Steps

### Step 0: Preflight — full reference inventory (BLOCKING)

Run these greps and document every result in the Discoveries table before writing any code:

```bash
# Direct imports
grep -rn "from.*task-runner" extensions/tests/

# Source-reading references (readFileSync("...task-runner.ts"))
grep -rn "task-runner\.ts" extensions/tests/

# Any other references in extensions/
grep -rn "task-runner" extensions/taskplane/ extensions/task-orchestrator.ts
```

For each source-reading test found: determine if it tests dead behavior (`/task` command, tmux sessions, etc.) or live behavior (patterns that moved to new locations). Dead behavior tests can be deleted. Live behavior tests need updating.

Also verify:
- [ ] `isLowRiskStep` is in `task-executor-core.ts` (so `task-runner-review-skip.test.ts` just needs an import update)
- [ ] `getSidecarDir` equivalent does NOT exist in `execution.ts` or `lane-runner.ts`
- [ ] Run test baseline: `cd extensions && npm run test:fast`

Document all findings in the Discoveries table before proceeding.

### Step 1: Create extensions/taskplane/sidecar-telemetry.ts

Read `task-runner.ts` and extract **verbatim** (no signature changes):
- `SidecarTailState` interface
- `SidecarTelemetryDelta` interface
- `getSidecarDir(stateRoot: string, batchId: string, agentId: string): string`
- `createSidecarTailState(path: string): SidecarTailState`
- `tailSidecarJsonl(state: SidecarTailState): SidecarTelemetryDelta`

Export all directly (no `_` prefix needed — they're no longer escape hatches).

Add a JSDoc file header explaining this was extracted from task-runner.ts and is the canonical home for sidecar telemetry utilities.

- [ ] Create `extensions/taskplane/sidecar-telemetry.ts` with extracted sidecar utilities
- [ ] All 5 exports present with correct signatures (verified by reading original)
- [ ] File compiles (no type errors from missing imports)

### Step 2: Create extensions/taskplane/context-window.ts

Read `task-runner.ts` and extract context window utilities. Note the **signature adaptation** required (from spec Q2 resolution):

Original: `resolveContextWindow(config: TaskConfig, ctx: ExtensionContext)`
New: `resolveContextWindow(configuredWindow: number | undefined, ctx: ExtensionContext | null)`

This avoids importing `TaskConfig` (a task-runner internal type). The behavior is identical — the caller passes `config.context.worker_context_window` directly as `configuredWindow`.

**Exports:**
```typescript
export const FALLBACK_CONTEXT_WINDOW: number  // 200_000

export function resolveContextWindow(
    configuredWindow: number | undefined,
    ctx: ExtensionContext | null,
): { contextWindow: number; source: string }
```

- [ ] Create `extensions/taskplane/context-window.ts`
- [ ] `FALLBACK_CONTEXT_WINDOW` exported as `200_000`
- [ ] `resolveContextWindow` adapted signature, same behavior
- [ ] Imports only from `@mariozechner/pi-coding-agent` for `ExtensionContext`, no task-runner types

### Step 3: Export loadAgentDef from execution.ts

Read `loadAgentDef` from `task-runner.ts`. It returns `{ systemPrompt: string; tools: string; model: string } | null` by loading and parsing agent `.md` files with YAML frontmatter.

Add an equivalent exported function in `execution.ts` near the existing `loadBaseAgentPrompt` and `loadLocalAgentPrompt` functions. It can be a thin wrapper or a direct export of the existing logic — whichever is cleaner. The function must:
- Accept `(cwd: string, name: string)` parameters
- Return `{ systemPrompt: string; tools: string; model: string } | null`
- Use pointer resolution for workspace mode (check if this is already handled by the existing agent loaders)

- [ ] `loadAgentDef` exported from `execution.ts`
- [ ] Signature matches what `project-config-loader.test.ts` expects

### Step 4: Update all test imports

Update every test file identified in Step 0:

- [ ] `context-pressure-cache.test.ts` — import sidecar utilities from `../taskplane/sidecar-telemetry`
- [ ] `context-window-autodetect.test.ts` — import from `../taskplane/context-window`
- [ ] `context-window-resolution.test.ts` — import from `../taskplane/context-window`
- [ ] `sidecar-tailing.test.ts` — import from `../taskplane/sidecar-telemetry`
- [ ] `project-config-loader.test.ts` — `_loadAgentDef` → `loadAgentDef` from `../taskplane/execution`; `loadConfig` → appropriate import; `_resetPointerWarning` → handle (may be a test-only reset — check if it can be replaced or if a new reset hook is needed)
- [ ] `task-runner-review-skip.test.ts` — `isLowRiskStep` → `../taskplane/task-executor-core`
- [ ] Any additional test files from Step 0 inventory — update or delete as appropriate

**Do NOT update task-runner.ts itself** — leave its exports in place. TP-162 will delete the file. This task only redirects test imports to the new locations.

### Step 5: Testing & Verification

- [ ] Run full test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] All tests that passed in Step 0 baseline still pass
- [ ] No new failures introduced
- [ ] Fix all failures

### Step 6: Documentation & Delivery

- [ ] JSDoc headers on both new files explaining their origin and purpose
- [ ] Discoveries logged in STATUS.md (especially the Step 0 inventory results)

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/sidecar-telemetry.ts` — JSDoc header
- `extensions/taskplane/context-window.ts` — JSDoc header

**Check If Affected:**
- None — docs update is in TP-162

## Completion Criteria

- [ ] All steps complete
- [ ] `sidecar-telemetry.ts` and `context-window.ts` exist with correct exports
- [ ] `loadAgentDef` exported from `execution.ts`
- [ ] All test files updated to import from new locations
- [ ] Full test suite passes (same pass rate as baseline)
- [ ] `task-runner.ts` is NOT deleted (that is TP-162's job)

## Git Commit Convention

- **Step completion:** `refactor(TP-161): complete Step N — description`
- **New file:** `refactor(TP-161): add sidecar-telemetry.ts` / `add context-window.ts`
- **Hydration:** `hydrate: TP-161 expand Step N checkboxes`

## Do NOT

- Delete `task-runner.ts` — that is TP-162
- Change signatures beyond the documented `resolveContextWindow` adaptation
- Modify `task-executor-core.ts` — it is already correct
- Modify `lane-runner.ts`, `agent-bridge-extension.ts`, or `agent-host.ts`
- Remove `task-runner.ts` from `package.json` — that is TP-162
- Commit without the task ID prefix

---

## Amendments (Added During Execution)
