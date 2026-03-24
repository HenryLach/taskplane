# Task: TP-047 - Context Window Auto-Detect

**Created:** 2026-03-23
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Low-risk config default change. Touches one file's defaulting logic and config schema. No new patterns, no auth, easy revert.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-047-context-window-auto-detect/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Replace the hardcoded `worker_context_window: 200000` default with auto-detection
from pi's model registry. The current 200K default is stale — Claude 4.6 Opus has
a 1M context window, but our warn/kill signals fire at 70%/85% of 200K (140K/170K
tokens), wasting 83% of available context. The fix is to read
`ctx.model.contextWindow` when the user hasn't explicitly configured a value, and
also update `warn_percent` and `kill_percent` defaults to better utilize the full
window.

**Issue:** #140 (context window portion only)

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — main file to modify (context tracking logic, defaults, `runWorker()`, `spawnAgentTmux` telemetry callback)
- `extensions/taskplane/config-schema.ts` — JSON config schema defaults
- `extensions/taskplane/config-loader.ts` — config loading and fallback values

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/tests/*` (new or modified test file)
- `templates/config/task-runner.yaml`

## Steps

### Step 0: Preflight

- [ ] Read `extensions/task-runner.ts` and locate all references to `worker_context_window`, `warn_percent`, `kill_percent`
- [ ] Read `extensions/taskplane/config-schema.ts` and `config-loader.ts` to understand the config loading chain
- [ ] Verify `ctx.model` is available in the task-runner extension context and check what properties it exposes (especially `contextWindow`)

### Step 1: Auto-detect context window from pi model registry

The current default in `task-runner.ts` line ~167:
```typescript
worker_context_window: 200000, warn_percent: 70, kill_percent: 85,
```

Change the resolution logic so `worker_context_window` is resolved at runtime, not at config parse time:

1. When `worker_context_window` is used (in `runWorker()` and the step loop), resolve it as:
   ```typescript
   const contextWindow = config.context.worker_context_window  // explicit user override (non-zero/non-default)
     ?? ctx.model?.contextWindow   // read real value from pi's model registry
     ?? 200_000;                   // fallback if pi doesn't expose it
   ```
2. The config default should be `0` or `undefined`/`null` to signal "auto-detect". If the user has explicitly set a value in their config, that takes precedence.
3. Update `config-schema.ts` and `config-loader.ts` defaults to match (use `0` or omit to signal auto-detect).
4. Log the resolved context window at worker spawn time so the operator can see what value is being used:
   ```
   [task-runner] worker context window: 1000000 (auto-detected from anthropic/claude-opus-4-6)
   ```

### Step 2: Update warn_percent and kill_percent defaults

Change defaults from `warn_percent: 70, kill_percent: 85` to `warn_percent: 85, kill_percent: 95`.

Update in all three locations:
- `extensions/task-runner.ts` — hardcoded defaults
- `extensions/taskplane/config-schema.ts` — JSON config schema
- `extensions/taskplane/config-loader.ts` — config loader fallbacks
- `templates/config/task-runner.yaml` — template comments/defaults

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Run tests: `cd extensions && npx vitest run`
- [ ] Verify no existing tests break from the default changes
- [ ] Add test(s) for context window resolution logic: explicit config value takes precedence, auto-detect from model works, fallback to 200K when model doesn't expose it
- [ ] Add test(s) verifying the new warn/kill defaults (85/95)

### Step 4: Documentation & Delivery

- [ ] Update template `task-runner.yaml` comments to explain auto-detect behavior
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `templates/config/task-runner.yaml` — update `worker_context_window`, `warn_percent`, `kill_percent` comments/defaults

**Check If Affected:**
- `docs/reference/configuration/task-runner.yaml.md` — update if config docs reference old defaults
- `docs/explanation/execution-model.md` — update if it discusses context window behavior

## Completion Criteria

- [ ] Context window auto-detected from pi model registry when not explicitly configured
- [ ] Explicit `worker_context_window` in config still takes precedence
- [ ] warn_percent default is 85, kill_percent default is 95
- [ ] Resolved context window logged at worker spawn time
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-047): complete Step N — description`
- **Bug fixes:** `fix(TP-047): description`
- **Tests:** `test(TP-047): description`
- **Hydration:** `hydrate: TP-047 expand Step N checkboxes`

## Do NOT

- Change the worker iteration loop structure (that's TP-048)
- Change the per-step worker spawn pattern (that's TP-048)
- Change reviewer spawn behavior
- Remove the ability to explicitly configure `worker_context_window`
- Modify any merge-related code

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
