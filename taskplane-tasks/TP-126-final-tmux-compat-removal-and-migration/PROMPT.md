# Task: TP-126 - Final TMUX Compatibility Removal and Migration

**Created:** 2026-04-02
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Final removal of legacy TMUX compatibility surface across config/state/types/contracts. High coordination risk; requires migration behavior, docs, and broad tests.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2 (external contract changes)

## Canonical Task Folder

```
taskplane-tasks/TP-126-final-tmux-compat-removal-and-migration/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Remove the remaining centralized TMUX compatibility surface after TP-125, while preserving operator safety through explicit migration handling. The result should eliminate TMUX references from active runtime contracts, with clear upgrade guidance and deterministic failure/migration behavior for legacy inputs.

## Dependencies

- **Task:** TP-122 (guardrails)
- **Task:** TP-125 (centralized compatibility shim)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/tmux-compat.ts` (from TP-125)
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/types.ts`
- `docs/reference/configuration/task-orchestrator.yaml.md`
- `docs/reference/commands.md`
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`

## File Scope

- `extensions/taskplane/tmux-compat.ts` (remove or reduce to migration-only utilities)
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts`
- `templates/config/task-orchestrator.yaml`
- `docs/reference/configuration/task-orchestrator.yaml.md`
- `docs/reference/commands.md`
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Removal plan and migration contract
- [ ] Define exact legacy inputs to stop accepting (or downgrade to explicit migration warnings)
- [ ] Decide migration policy per input: auto-normalize, hard error with fix hint, or one-release grace
- [ ] Document policy in STATUS.md before code changes

### Step 1: Remove remaining compatibility paths
- [ ] Remove/retire `tmuxPrefix` config alias handling
- [ ] Remove/retire `tmuxSessionName` persisted-lane ingress handling
- [ ] Remove/retire `spawnMode: "tmux"` acceptance paths where Runtime V2 no longer supports it
- [ ] Keep error messages actionable with migration hints

### Step 2: Update schema/types/docs/templates
- [ ] Update schema/types to canonical non-TMUX fields only
- [ ] Update templates/config docs to canonical keys/values
- [ ] Update command/doctor docs to reflect final no-TMUX contract

### Step 3: Tests and migration coverage
- [ ] Update fixtures that used TMUX-era fields
- [ ] Add migration/failure tests for legacy input detection and guidance
- [ ] Run full extension suite
- [ ] Run CLI smoke tests: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`

### Step 4: Final verification & delivery
- [ ] Re-run TMUX reference audit and record final counts
- [ ] Confirm no functional TMUX runtime logic remains
- [ ] Publish migration notes in docs and STATUS.md

## Do NOT

- Silently break legacy config/state without explicit error or migration guidance
- Change persisted schema semantics without corresponding tests and docs
- Leave mixed terminology after final removal

## Git Commit Convention

- `feat(TP-126): ...`
- `refactor(TP-126): ...`
- `test(TP-126): ...`
- `docs(TP-126): ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
