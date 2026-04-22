# Task: TP-055 - Runtime Model Fallback

**Created:** 2026-03-24
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Modifies agent spawn and error classification — medium blast radius across execution and engine modules. Introduces a new failure recovery pattern. No security impact but touches core execution paths.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-055-runtime-model-fallback/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

When a configured agent model becomes unavailable mid-batch (API key expired, rate limit, model deprecated, provider outage), tasks should fall back to the session model instead of failing repeatedly. This complements the pre-flight model validation (v0.7.2) which catches misconfiguration at batch start — this feature catches mid-run unavailability.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/execution.ts` — agent spawn, poll loop, `buildTmuxSpawnArgs()`
- `extensions/taskplane/engine.ts` — Tier 0 recovery, batch lifecycle
- `extensions/taskplane/types.ts` — exit classifications, config types
- `extensions/taskplane/diagnostics.ts` — `classifyExit()` function
- `extensions/taskplane/config-schema.ts` — config schema and defaults

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/execution.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/diagnostics.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/tests/runtime-model-fallback.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `classifyExit()` in `diagnostics.ts` — understand current exit classifications
- [ ] Read agent spawn flow in `execution.ts` — how worker/reviewer sessions are built
- [ ] Read Tier 0 recovery patterns in `engine.ts`
- [ ] Read config schema in `config-schema.ts` — understand current model config shape

### Step 1: Add Exit Classification for Model Access Errors

Extend the exit classification system to detect model access failures:

1. Add `model_access_error` to the exit classification enum/type in `types.ts`
2. Update `classifyExit()` in `diagnostics.ts` to detect model access errors from RPC exit summaries. Look for patterns like:
   - HTTP 401/403 (auth failure)
   - HTTP 429 (rate limit)
   - "model not found" / "model unavailable" error messages
   - API key expiration signals
3. Ensure the classification is distinct from generic `agent_error` so the fallback logic can trigger specifically on model issues

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/diagnostics.ts` (modified)

### Step 2: Add Model Fallback Config

1. Add `modelFallback` setting to the config schema:
   - Path: `taskRunner.modelFallback` (or top-level `modelFallback`)
   - Values: `"inherit"` (default) — fall back to session model; `"fail"` — fail immediately (current behavior)
2. Update config loader to read and default the new field
3. Thread the setting through to execution context

**Artifacts:**
- `extensions/taskplane/config-schema.ts` (modified)
- `extensions/taskplane/config-loader.ts` (modified)

### Step 3: Implement Fallback in Execution

When a lane worker or reviewer exits with `model_access_error`:

1. Check `modelFallback` config setting
2. If `"inherit"`:
   - Log a warning: "Model [X] unavailable, falling back to session model"
   - Emit a supervisor event (Tier 0 pattern) so the operator is notified
   - Retry the spawn WITHOUT the explicit `--model` flag (pi defaults to session model)
   - Track that a fallback occurred in lane state for dashboard visibility
3. If `"fail"`:
   - Behave exactly as today — let the normal failure/retry path handle it
4. Limit fallback retries to 1 attempt — if the session model also fails, the task fails normally

Important constraints:
- This should work for ALL agent types: lane workers, reviewers (spawned by `review_step`), and merge agents
- The fallback should be logged to the telemetry sidecar
- Don't retry on non-model errors (generic crashes, context overflow, etc.)

**Artifacts:**
- `extensions/taskplane/execution.ts` (modified)
- `extensions/taskplane/engine.ts` (modified — Tier 0 event emission)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Create `extensions/tests/runtime-model-fallback.test.ts` with:
  - Exit classification tests: model access errors correctly classified
  - Config loading: `modelFallback` defaults to `"inherit"`, respects `"fail"`
  - Fallback logic: source-based tests verifying the retry-without-model pattern exists
  - Edge cases: fallback disabled, fallback model also fails, non-model errors don't trigger fallback
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 5: Documentation & Delivery

- [ ] Update config reference docs with `modelFallback` setting
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/configuration/task-runner.yaml.md` — add `modelFallback` setting
- `docs/reference/configuration/task-orchestrator.yaml.md` — mention fallback behavior

**Check If Affected:**
- `docs/how-to/troubleshoot-common-issues.md` — add model fallback troubleshooting
- `docs/explanation/execution-model.md` — mention fallback in failure semantics section

## Completion Criteria

- [ ] `model_access_error` exit classification added and tested
- [ ] `modelFallback` config setting added with `"inherit"` default
- [ ] Fallback retry implemented for worker, reviewer, and merge agent spawns
- [ ] Supervisor notified when fallback occurs
- [ ] All tests passing (existing + new)
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-055): complete Step N — description`
- **Bug fixes:** `fix(TP-055): description`
- **Tests:** `test(TP-055): description`
- **Hydration:** `hydrate: TP-055 expand Step N checkboxes`

## Do NOT

- Change pre-flight model validation behavior — it stays as-is
- Add fallback for non-model errors (context overflow, generic crashes)
- Make fallback retry more than once — if session model fails too, accept the failure
- Modify the `/task` or `/orch` command surface
- Change the RPC wrapper — classification happens from the exit summary it already produces

---

## Amendments (Added During Execution)

