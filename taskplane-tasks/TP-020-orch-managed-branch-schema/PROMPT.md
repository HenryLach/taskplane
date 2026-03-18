# Task: TP-020 - Orch-Managed Branch Schema & Config

**Created:** 2026-03-18
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Schema and config additions with clear contracts. Low risk, existing patterns.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-020-orch-managed-branch-schema/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Add the schema, type definitions, config fields, and settings TUI entries needed for the orchestrator-managed branch model (issue #24). This task lays the foundation — no behavioral changes yet, just the data model that subsequent tasks (TP-021 through TP-024) build on.

The managed branch model will have the orchestrator create an ephemeral `orch/{opId}-{batchId}` branch instead of merging into the user's current branch directly. This task adds the fields to track that branch and the integration mode config.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/orch-managed-branch-spec.md` — full spec with design rationale
- `extensions/taskplane/types.ts` — current schema (add fields here)
- `extensions/taskplane/config-schema.ts` — config schema definitions
- `extensions/taskplane/config-loader.ts` — config loading, camelCase↔snake_case mappings
- `extensions/taskplane/settings-tui.ts` — TUI field definitions

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/types.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/settings-tui.ts`
- `extensions/tests/settings-tui.test.ts`
- `extensions/tests/*` (any test files touching types/config)

## Steps

### Step 0: Preflight

- [ ] Read `types.ts` — locate `OrchBatchRuntimeState`, `PersistedBatchState`, `freshOrchBatchState()`, `OrchestratorConfig`, `DEFAULT_ORCHESTRATOR_CONFIG`
- [ ] Read `config-schema.ts` — understand how config fields are defined and validated
- [ ] Read `config-loader.ts` — understand camelCase↔snake_case mappings and `resolveConfigValue()`
- [ ] Read `settings-tui.ts` — understand how TUI fields are declared (especially the Orchestrator section)

### Step 1: Add `orchBranch` to Runtime + Persisted State

Add `orchBranch: string` to the state interfaces and initialization:

- [ ] Add `orchBranch: string` to `OrchBatchRuntimeState` with JSDoc: `"Orchestrator-managed branch name (e.g., 'orch/henry-20260318T140000'). Empty = legacy mode (merge into baseBranch directly)."`
- [ ] Add `orchBranch: string` to `PersistedBatchState`
- [ ] Set `orchBranch: ""` in `freshOrchBatchState()`
- [ ] Update `persistRuntimeState()` in `persistence.ts` to serialize `orchBranch`
- [ ] Update state loading/deserialization to default `orchBranch` to `""` for backward compatibility with older state files

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/persistence.ts` (modified)

### Step 2: Add `integration` to Orchestrator Config

- [ ] Add `integration: "manual" | "auto"` to the `OrchestratorConfig.orchestrator` interface in `types.ts`
- [ ] Set default to `"manual"` in `DEFAULT_ORCHESTRATOR_CONFIG`
- [ ] Add the field to `config-schema.ts` validation/schema definition
- [ ] Add camelCase↔snake_case mapping in `config-loader.ts` (so JSON `integration` and YAML `integration` both work)

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/config-schema.ts` (modified)
- `extensions/taskplane/config-loader.ts` (modified)

### Step 3: Add Integration Toggle to Settings TUI

- [ ] Add an "Integration" toggle field in the Orchestrator section of `settings-tui.ts`
  - `configPath: "orchestrator.orchestrator.integration"`
  - `label: "Integration"`
  - `control: "toggle"`
  - `fieldType: "enum"`
  - `values: ["manual", "auto"]`
  - `description: "How completed batches are integrated. manual = user runs /orch-integrate. auto = fast-forward on completion."`

**Artifacts:**
- `extensions/taskplane/settings-tui.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Run unit tests: `cd extensions && npx vitest run`
- [ ] Verify `freshOrchBatchState()` returns `orchBranch: ""`
- [ ] Verify `DEFAULT_ORCHESTRATOR_CONFIG` has `integration: "manual"`
- [ ] Verify settings TUI test still passes (especially Advanced section discoverability — `integration` should NOT appear in Advanced since it's editable)
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (docs task TP-024 handles user-facing docs)

**Check If Affected:**
- `docs/reference/configuration/taskplane-settings.md` — will need Integration row added (handled by TP-024)

## Completion Criteria

- [ ] `orchBranch` field exists in `OrchBatchRuntimeState` and `PersistedBatchState`
- [ ] `integration` field exists in `OrchestratorConfig` with default `"manual"`
- [ ] Settings TUI shows Integration toggle
- [ ] Backward-compatible state loading (missing `orchBranch` defaults to `""`)
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `feat(TP-020): complete Step N — description`
- **Bug fixes:** `fix(TP-020): description`
- **Tests:** `test(TP-020): description`
- **Hydration:** `hydrate: TP-020 expand Step N checkboxes`

## Do NOT

- Implement any behavioral changes (branch creation, merge redirect, etc.) — that's TP-022
- Modify `engine.ts` or `merge.ts` — those are downstream tasks
- Change worktree path generation — that's TP-021
- Add the `/orch-integrate` command — that's TP-023
- Skip tests

---

## Amendments (Added During Execution)
