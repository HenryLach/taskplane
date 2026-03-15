# R001 — Plan Review (Step 0: Define workspace/runtime contracts)

## Verdict
**Changes requested** — Step 0 planning is still too high-level to safely implement.

## Reviewed artifacts
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/PROMPT.md`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/config.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/discovery.ts`

> Note: `.pi/local/docs/taskplane/*` files referenced by the prompt were not present in this worktree, so this review is based on task requirements + current code contracts.

## Blocking findings

### 1) Step 0 plan is not hydrated to implementation-level detail
`STATUS.md` only has two broad checkboxes for Step 0. It does not define:
- exact new type names/contracts,
- exact validation matrix,
- exact error-code surface,
- explicit repo-mode compatibility invariants.

For this task, that is too coarse and likely to cause rework in Steps 1–2.

### 2) Execution-context contract is not explicit enough to remove `cwd == repoRoot` assumptions
Current runtime paths assume monorepo behavior:
- `engine.ts:45` sets `const repoRoot = cwd`
- startup/config/discovery are wired to `ctx.cwd` directly (`extension.ts:578`, `extension.ts:579`, `extension.ts:219`, `extension.ts:542`)
- discovery resolves area paths from `cwd` (`discovery.ts:391`, `discovery.ts:410`)

Step 0 must define a canonical context contract that separates at least:
- workspace root,
- orchestrator state root,
- default execution repo root,
- repo map/routing data.

Without this, Step 2 threading will be ambiguous.

### 3) Validation/error surface is underspecified and likely to drift into silent fallback
Current config loaders swallow parse/load issues and return defaults (`config.ts:66`, `config.ts:98`). That pattern is okay for optional config, but Step 0 requires **clear validation/error surfaces** for invalid workspace configuration.

The plan must explicitly define typed, stable, branchable errors (code union + error class), not ad-hoc strings.

## Required plan updates before implementation

1. **Hydrate Step 0 in `STATUS.md`** into concrete sub-tasks (types, error codes, invariants, acceptance checks).
2. **Define the exact Step 0 contract set in `types.ts`**, including:
   - workspace config shape,
   - repo/routing structures,
   - canonical execution context used by startup + engine.
3. **Define workspace validation error API** in the same style as existing typed errors in `types.ts` (stable code union + error class).
4. **Add explicit mode-behavior matrix** to the plan:
   - no workspace config file,
   - workspace config present + valid,
   - workspace config present + invalid.
5. **Add a minimal test plan now** (to be implemented in Step 3), covering mode selection + invalid config handling.

## Suggested acceptance criteria for Step 0
- New workspace/runtime contracts compile and are exported.
- Error codes are deterministic and machine-branchable.
- Repo-mode defaults remain unchanged when workspace config is absent.
- Contracts contain enough information to stop passing raw `cwd` as the only execution root in Step 2.
