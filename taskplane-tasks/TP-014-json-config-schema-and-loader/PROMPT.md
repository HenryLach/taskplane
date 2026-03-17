# Task: TP-014 - JSON Config Schema and Loader

**Created:** 2026-03-17
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** New config format with schema validation, backward-compatible YAML fallback, and migration path. Touches config loading in both task-runner and orchestrator extensions. Moderate blast radius across multiple modules.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-014-json-config-schema-and-loader/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Define the JSON schema for `taskplane-config.json` (which replaces both `task-runner.yaml` and `task-orchestrator.yaml`) and implement a unified config loader that reads JSON with YAML fallback for backward compatibility. This is the foundation for the `/settings` TUI and the new onboarding flow.

The JSON config merges both YAML files into a single `taskplane-config.json` with a clear schema. The loader must handle: JSON present (use it), JSON absent + YAML present (read YAML, produce same config object), neither present (defaults).

See spec: `.pi/local/docs/settings-and-onboarding-spec.md` — Layer 1 (Project config) and Migration path sections.

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/settings-and-onboarding-spec.md` — full spec for config layers
- `docs/reference/configuration/task-runner.yaml.md` — current config reference
- `docs/reference/configuration/task-orchestrator.yaml.md` — current config reference

## Environment

- **Workspace:** `extensions/taskplane/`, `extensions/task-runner.ts`
- **Services required:** None

## File Scope

- `extensions/taskplane/types.ts`
- `extensions/taskplane/config.ts`
- `extensions/task-runner.ts`
- `docs/reference/configuration/*`

## Steps

### Step 0: Preflight

- [ ] Read current config loading in `config.ts`, `task-runner.ts`, and `types.ts`
- [ ] Read both YAML config reference docs to understand full schema surface

### Step 1: Define JSON Schema

- [ ] Define TypeScript interfaces for the unified `taskplane-config.json` schema
- [ ] Schema merges task-runner and orchestrator settings into one file with clear sections
- [ ] Include a `configVersion` field for future schema evolution

### Step 2: Implement Unified Config Loader

- [ ] Implement `loadProjectConfig()` that reads JSON first, falls back to YAML
- [ ] YAML fallback produces the same config object shape as JSON
- [ ] Missing fields fall back to sensible defaults (same as today)
- [ ] Update `task-runner.ts` `loadConfig()` to use the unified loader
- [ ] Update `extensions/taskplane/config.ts` to use the unified loader

### Step 3: Testing & Verification

- [ ] Add tests for JSON loading, YAML fallback, defaults, and schema validation
- [ ] Existing tests still pass with YAML configs
- [ ] Run: `cd extensions && npx vitest run`

### Step 4: Documentation & Delivery

- [ ] Update config reference docs to document JSON format alongside YAML
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/configuration/task-runner.yaml.md` — note JSON alternative
- `docs/reference/configuration/task-orchestrator.yaml.md` — note JSON alternative

**Check If Affected:**
- `docs/tutorials/install.md`

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] JSON config loads correctly with full schema
- [ ] YAML fallback produces identical config objects
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-014): description`
- **Bug fixes:** `fix(TP-014): description`
- **Tests:** `test(TP-014): description`
- **Checkpoints:** `checkpoint: TP-014 description`

## Do NOT

- Remove YAML support — it must remain as a fallback
- Change any runtime behavior — config objects must be identical regardless of source format
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
