# R005 — Plan Review (Step 2: Wire orchestrator startup context)

## Verdict
**Changes requested** — Step 2 is much better hydrated now, but there are still critical plan inconsistencies that would break workspace-mode behavior.

## Reviewed artifacts
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/PROMPT.md`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md`
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/execution.ts`

## What improved
- Step 2 is now concretely hydrated in `STATUS.md` (good progress vs prior coarse plan).
- The plan correctly introduces startup context loading (`buildExecutionContext(...)`) and explicit startup guarding for invalid workspace config.

## Blocking findings

### 1) Root usage plan is internally inconsistent across extension vs engine/runtime
Current Step 2 checklist mixes these decisions:
- pass `execCtx.repoRoot` to `executeOrchBatch()` / `resumeOrchBatch()`
- but use `execCtx.workspaceRoot` for state/orphan/abort/discovery paths in `extension.ts`

That conflicts with current engine/runtime behavior:
- `executeOrchBatch()` aliases `cwd` to `repoRoot` and persists state there (`engine.ts:45`, `engine.ts:167`, `engine.ts:760`)
- `resumeOrchBatch()` does the same (`resume.ts:339`, `resume.ts:749`)
- execution abort polling reads `.pi/orch-abort-signal` under its `repoRoot` (`execution.ts:487`)

If extension writes/reads `.pi` under `workspaceRoot` while engine/execution use `repoRoot`, abort/resume/orphan detection will drift.

### 2) “Thread execution context into engine entry points” is not actually planned as context threading
The checklist currently plans only root substitution at call sites (string path swap), not entry-point contract changes.

Given `ExecutionContext` already exists and is the new canonical contract, Step 2 should explicitly choose one of:
1. **True threading:** update `executeOrchBatch`/`resumeOrchBatch` to accept `ExecutionContext` (or `{workspaceRoot, repoRoot}`), and use roots intentionally per operation; or
2. **Transitional adapter:** keep signatures but add explicit `workspaceRoot` + `repoRoot` params so discovery/state/git roots cannot be conflated.

Without this, workspace mode will still inherit `cwd == repoRoot` assumptions inside engine/resume.

### 3) Startup error handling item is not feasible as written (“skip command registration”)
Commands are currently registered at extension initialization time, before `session_start` (`extension.ts`, command registrations above `pi.on("session_start", ...)`).

So “catch in session_start and skip command registration” is not implementable unless command registration is structurally moved.

Plan should instead specify deterministic behavior already compatible with current architecture:
- store initialization error state (`initError` / `execCtx=null`),
- surface actionable startup notification once,
- guard all command handlers with a shared `ensureInitialized()` check.

### 4) Step 2 plan still lacks explicit command-surface coverage list
Context/root changes affect more than `/orch` and `/orch-resume`:
- `/orch-plan` and `/orch-deps` call `runDiscovery(..., ctx.cwd, ...)` (`extension.ts:245`, `extension.ts:568`)
- orphan/state operations call `ctx.cwd` (`extension.ts:121`, `136`, `156`, `415`, `490`)
- abort signal path uses `ctx.cwd` (`extension.ts:390`)

The plan should explicitly enumerate which commands/paths are in-scope for this step to avoid partial migration.

## Required plan updates before implementation
1. Add a **single authoritative root matrix** for Step 2 and enforce it end-to-end (extension + engine + resume + execution + persistence):
   - where `.pi` state lives,
   - where discovery resolves from,
   - where git/worktree/merge commands run.
2. Replace “pass repoRoot as cwd” checklist items with an explicit entry-point contract migration strategy (ExecutionContext or split roots).
3. Replace “skip command registration” with implementable init-error guarding (shared guard in handlers).
4. Enumerate all Step 2 call sites/commands being migrated (`/orch`, `/orch-plan`, `/orch-deps`, `/orch-resume`, orphan detection, abort signal/state paths).
5. Add Step 2 verification bullets (to execute in Step 3):
   - repo mode parity,
   - workspace valid config startup success,
   - workspace invalid config startup blocked with deterministic error,
   - abort/resume/orphan flows all read/write the same `.pi` root.

## Non-blocking note
- R004 (Step 1 code review) still flags a high-severity repo validation edge in `workspace.ts`; not a Step 2 planning blocker, but should be addressed before broader workspace-mode rollout.
