# R001 — Plan Review (Step 1: Add packet-home routing contract)

## Verdict
**Changes requested** — Step 1 plan is directionally correct but still too coarse to implement safely against the current codebase.

## Reviewed artifacts
- `taskplane-tasks/TP-079-workspace-packet-home-contract-and-mode-enforcement/PROMPT.md`
- `taskplane-tasks/TP-079-workspace-packet-home-contract-and-mode-enforcement/STATUS.md`
- `docs/specifications/taskplane/multi-repo-task-execution.md`
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/tests/workspace-config.integration.test.ts`
- `extensions/tests/project-config-loader.test.ts`

## Blocking findings

### 1) Step 1 is not hydrated to implementation-level work
`STATUS.md` still has only the top-level checklist (`STATUS.md:22-29`) and no concrete file-level sub-steps. Given the contract impact, this needs explicit sequencing (types, validation order, cross-config validation, error surface, tests).

### 2) Plan does not resolve current file-contract drift
Prompt Step 1 artifact paths reference `workspace-config.ts` / `workspace-config.test.ts` (`PROMPT.md:76-77`, `55`), but the current implementation lives in `workspace.ts` and `workspace-config.integration.test.ts`. The plan must explicitly choose whether to:
- modify existing `workspace.ts`, or
- introduce a new `workspace-config.ts` and rewire imports.

Without this decision, implementation will continue to stall.

### 3) Required invariant #2 cannot be enforced in workspace YAML validation alone
Spec requires:
1) `tasksRoot` inside `repos[taskPacketRepo].path`
2) every task-area path inside `tasksRoot` (`multi-repo-task-execution.md:106-113`)

Current `loadWorkspaceConfig()` only has workspace YAML data (`workspace.ts:292-531`). Task-area paths come from task-runner config and are resolved during discovery from `cwd` (`discovery.ts:430-455`) with workspace root passed by extension (`extension.ts:1630-1637`).

So Step 1 must explicitly add a **cross-config validation point** (likely in `buildExecutionContext()` after loading task-runner config, `workspace.ts:579-593`), not only routing-field checks in workspace YAML parsing.

### 4) Error-code and type-surface updates are underspecified
Current `WorkspaceRoutingConfig` has only `tasksRoot/defaultRepo/strict` (`types.ts:2863-2888`) and `WorkspaceConfigErrorCode` has no packet-home or containment codes (`types.ts:2970-2982`).

Step 1 requires actionable invariant errors, but the plan does not define:
- new routing field type(s),
- new validation error codes/messages,
- deterministic validation order.

### 5) Canonical schema impact is not concretely planned
`TaskplaneConfig` currently contains only `taskRunner` and `orchestrator` (`config-schema.ts:438-445`), and JSON load merge handles only those two sections (`config-loader.ts:349-356`).

If Step 1 says "add to canonical schema/types," the plan must state whether this is:
- a `WorkspaceRoutingConfig` runtime/type-only change now (with JSON threading in Step 3), or
- immediate `taskplane-config.json` schema expansion in Step 1.

Right now this boundary is ambiguous.

## Required plan updates before implementation
1. Expand Step 1 in `STATUS.md` into concrete sub-checks with exact target files and order.
2. Resolve artifact path drift (existing `workspace.ts` vs new `workspace-config.ts`) and document chosen approach.
3. Define validation split explicitly:
   - workspace-only checks in workspace config loader,
   - cross-config check (`task_areas` inside `tasksRoot`) in execution-context build path.
4. Define the new error surface (codes + message format) for:
   - missing/invalid `taskPacketRepo`,
   - `tasksRoot` outside packet repo,
   - task-area outside `tasksRoot`.
5. Define compatibility policy for legacy configs missing `taskPacketRepo` (hard fail vs deterministic migration default), aligned with Step 3 expectations.
6. Add a Step 1 test matrix (even if implemented in Step 4) covering:
   - valid config,
   - unknown `taskPacketRepo`,
   - `tasksRoot` escaping packet repo,
   - task area escaping `tasksRoot`,
   - actionable error messages.

## Non-blocking guidance
- Preserve existing `defaultRepo` behavior for discovery fallback and `repoRoot` selection (`discovery.ts:968-972`, `workspace.ts:583-587`) unless explicitly changing it in a later step.
- Reuse canonical path normalization logic already used in workspace validation (`workspace.ts:395-397`) for containment checks to avoid Windows/path-case false positives.
