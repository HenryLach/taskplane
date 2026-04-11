# Task: TP-160 - Pass reviewer model/thinking/tools config to spawnReviewer subprocess

**Created:** 2026-04-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Multi-file threading change on the critical execution path. The reviewer model config is currently read and validated at batch start but silently dropped before execution. Correctness risk: wrong approach could cause all reviews to fail. Plan review essential.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-160-reviewer-model-not-passed-to-subprocess/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

The reviewer model, thinking mode, and tools configured in `/taskplane-settings` (stored in `runnerConfig.reviewer.*`) are read at batch start and validated — but then completely dropped before execution. The `spawnReviewer()` function in `agent-bridge-extension.ts` spawns the reviewer pi subprocess with no `--model` or `--thinking` flags, so reviews always use the session default model regardless of what the user configured.

The gap is in the call chain:

```
runnerConfig.reviewer.model        ← configured by user
    → [DROPPED] executeWave()      ← only receives orchConfig
        → executeLaneV2()          ← only receives orchConfig  
            → LaneRunnerConfig     ← workerModel hardcoded "", no reviewerModel
                → worker env       ← no TASKPLANE_REVIEWER_* vars set
                    → spawnReviewer()  ← no --model or --thinking passed
```

The fix: thread `runnerConfig.reviewer` through the call chain as env vars, and use them in `spawnReviewer`.

**Important:** the reviewer config is in `TaskRunnerConfig` (not `OrchestratorConfig`). `executeWave` currently only receives `OrchestratorConfig`. The cleanest fix avoids a large signature change by passing reviewer settings through `extraEnvVars` (already used to pass `ORCH_BATCH_ID` and `TASKPLANE_SUPERVISOR_AUTONOMY`) and then through `LaneRunnerConfig`.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/engine.ts` — call sites for `executeWave` (lines ~2363, ~1795) — note that `runnerConfig` is available in engine.ts scope at these call sites
- `extensions/taskplane/execution.ts` — `executeWave()` signature and `executeLaneV2()` call site (lines ~1558-1680), `executeLaneV2()` function (lines ~2193-2300), `LaneRunnerConfig` interface in `lane-runner.ts`
- `extensions/taskplane/lane-runner.ts` — `LaneRunnerConfig` interface (lines ~72-110), worker env setup in `executeTaskV2` (lines ~320-345)
- `extensions/taskplane/agent-bridge-extension.ts` — `spawnReviewer()` (lines ~478-580), the args array that builds the pi CLI command

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/engine.ts` — pass reviewer config into `executeWave`
- `extensions/taskplane/execution.ts` — add reviewer config to `executeWave` signature, pass through `extraEnvVars` to `executeLaneV2`
- `extensions/taskplane/lane-runner.ts` — add `reviewerModel`, `reviewerThinking`, `reviewerTools` to `LaneRunnerConfig`, pass as env vars to worker subprocess
- `extensions/taskplane/agent-bridge-extension.ts` — read env vars in `spawnReviewer`, pass `--model`, `--thinking`, `--tools` to pi CLI

## Steps

### Step 0: Preflight

- [ ] Read `executeWave()` signature and body in `execution.ts` to understand what it passes to `executeLaneV2`
- [ ] Read `LaneRunnerConfig` in `lane-runner.ts` — understand existing worker env setup
- [ ] Read `spawnReviewer()` in `agent-bridge-extension.ts` — confirm the args array and env inheritance
- [ ] Confirm `runnerConfig` is in scope at the `executeWave` call sites in `engine.ts`
- [ ] Verify test baseline: `cd extensions && npm run test:fast`

### Step 1: Thread reviewer config through the call chain

**Part A — Add to executeWave signature and pass via extraEnvVars:**

In `execution.ts`, add optional reviewer config params to `executeWave()`:

```typescript
reviewerConfig?: {
    model?: string;
    thinking?: string;
    tools?: string;
}
```

In the `executeLaneV2` call inside `executeWave`, add reviewer config to `extraEnvVars`:

```typescript
executeLaneV2(lane, config, repoRoot, wavePauseSignal, wsRoot, isWsMode, {
    ORCH_BATCH_ID: batchId,
    TASKPLANE_SUPERVISOR_AUTONOMY: supervisorAutonomy,
    ...(reviewerConfig?.model ? { TASKPLANE_REVIEWER_MODEL: reviewerConfig.model } : {}),
    ...(reviewerConfig?.thinking ? { TASKPLANE_REVIEWER_THINKING: reviewerConfig.thinking } : {}),
    ...(reviewerConfig?.tools ? { TASKPLANE_REVIEWER_TOOLS: reviewerConfig.tools } : {}),
}, onSupervisorAlert)
```

- [ ] Add `reviewerConfig?` param to `executeWave` signature
- [ ] Thread it through to `executeLaneV2` extraEnvVars

**Part B — Pass extraEnvVars into worker env in executeLaneV2:**

In `executeLaneV2`, the `extraEnvVars` are currently used for `ORCH_BATCH_ID` and `TASKPLANE_SUPERVISOR_AUTONOMY` but the remaining env vars are NOT forwarded to the lane runner config or the worker subprocess. Add the reviewer vars to `LaneRunnerConfig`:

```typescript
reviewerModel: extraEnvVars?.TASKPLANE_REVIEWER_MODEL || "",
reviewerThinking: extraEnvVars?.TASKPLANE_REVIEWER_THINKING || "",
reviewerTools: extraEnvVars?.TASKPLANE_REVIEWER_TOOLS || "",
```

First add these fields to `LaneRunnerConfig` in `lane-runner.ts`.

- [ ] Add `reviewerModel`, `reviewerThinking`, `reviewerTools` (all `string`) to `LaneRunnerConfig` interface in `lane-runner.ts`
- [ ] Add them to the `laneRunnerConfig` object in `executeLaneV2`

**Part C — Set env vars in the worker subprocess:**

In `lane-runner.ts`, in the `hostOpts.env` block where worker subprocess env vars are set, add:

```typescript
...(config.reviewerModel ? { TASKPLANE_REVIEWER_MODEL: config.reviewerModel } : {}),
...(config.reviewerThinking ? { TASKPLANE_REVIEWER_THINKING: config.reviewerThinking } : {}),
...(config.reviewerTools ? { TASKPLANE_REVIEWER_TOOLS: config.reviewerTools } : {}),
```

- [ ] Add reviewer env vars to worker subprocess env in `lane-runner.ts`

**Part D — Use env vars in spawnReviewer:**

In `agent-bridge-extension.ts`, update `spawnReviewer` to read and use the reviewer config env vars:

```typescript
const reviewerModel = process.env.TASKPLANE_REVIEWER_MODEL || "";
const reviewerThinking = process.env.TASKPLANE_REVIEWER_THINKING || "";
const reviewerTools = process.env.TASKPLANE_REVIEWER_TOOLS || "read,write,edit,bash,grep,find,ls";

const args = [
    cliPath, "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills",
    "--tools", reviewerTools,
    "--system-prompt", systemPrompt,
];
if (reviewerModel) args.push("--model", reviewerModel);
if (reviewerThinking) args.push("--thinking", reviewerThinking);
```

- [ ] Read env vars at the top of `spawnReviewer`
- [ ] Add `--model` and `--thinking` args conditionally (empty string = inherit, don't pass flag)
- [ ] Use `reviewerTools` from env (fall back to default tool list)

**Part E — Pass reviewer config from engine.ts call sites:**

In `engine.ts`, at both `executeWave` call sites (~lines 1795 and 2363), pass the reviewer config. `runnerConfig` is in scope at both:

```typescript
executeWave(
    ...,
    { 
        model: runnerConfig?.reviewer?.model || runnerConfig?.worker?.model || "",
        thinking: runnerConfig?.reviewer?.thinking || "",
        tools: runnerConfig?.reviewer?.tools || "",
    }
)
```

- [ ] Update both `executeWave` call sites in `engine.ts`

### Step 2: Testing & Verification

- [ ] Run full test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Run CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs init --preset full --dry-run --force`
- [ ] Fix all failures

### Step 3: Documentation & Delivery

- [ ] Add a brief comment in `spawnReviewer` explaining where the model comes from (`TASKPLANE_REVIEWER_MODEL` env var set by lane-runner from `runnerConfig.reviewer.model`)
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- Inline comments in `spawnReviewer` and the `LaneRunnerConfig` fields

**Check If Affected:**
- `docs/reference/configuration/taskplane-settings.md` — the Reviewer Model section should confirm it's actually used (check if it says anything incorrect)

## Completion Criteria

- [ ] All steps complete
- [ ] `spawnReviewer` passes `--model` and `--thinking` to pi CLI when configured
- [ ] Empty/inherit model (`""`) means no `--model` flag is passed (pi inherits session default)
- [ ] Reviewer tools from config are used
- [ ] No regression in batches that don't configure a reviewer model (empty string = safe)
- [ ] Full test suite passing

## Git Commit Convention

- **Step completion:** `fix(TP-160): complete Step N — description`
- **Hydration:** `hydrate: TP-160 expand Step N checkboxes`

## Do NOT

- Add reviewer model to `OrchestratorConfig` — it belongs in `TaskRunnerConfig`
- Change the `OrchestratorConfig` type — use the extraEnvVars pattern already established
- Pass reviewer config for non-review flows (it's only used inside `spawnReviewer`)
- Commit without the task ID prefix

---

## Amendments (Added During Execution)
