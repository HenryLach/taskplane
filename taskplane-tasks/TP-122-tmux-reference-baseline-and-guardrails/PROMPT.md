# Task: TP-122 - TMUX Reference Baseline and Guardrails

**Created:** 2026-04-02
**Size:** S

## Review Level: 2 (Plan + Code)

**Assessment:** Adds static guardrails and a repeatable audit to prevent TMUX regressions while cleanup continues. Low runtime risk, moderate process impact.
**Score:** 4/8 — Blast radius: 1 (tooling/tests), Pattern novelty: 1, Security: 0, Reversibility: 2 (guardrails can block CI if wrong)

## Canonical Task Folder

```
taskplane-tasks/TP-122-tmux-reference-baseline-and-guardrails/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Create a deterministic TMUX-reference audit + guardrail so future changes cannot accidentally reintroduce functional TMUX runtime behavior. This task establishes the baseline and gives all follow-up tasks an objective pass/fail gate.

## Dependencies

- **Task:** TP-120 (TMUX removal remediation baseline)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/*.ts` (current TMUX reference surface)
- `extensions/tests/*.test.ts` (source-structure guard patterns)
- `package.json` (test script wiring)

## File Scope

- `scripts/tmux-reference-audit.mjs` (new)
- `extensions/tests/tmux-reference-guard.test.ts` (new)
- `package.json` (optional script hook)
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`

## Steps

### Step 0: Baseline inventory
- [ ] Record current TMUX reference counts by file for `extensions/taskplane/*.ts`
- [ ] Classify references into buckets: compat-code, user-facing strings, comments/docs, types/contracts
- [ ] Capture baseline in STATUS.md for future tasks

### Step 1: Add audit script
- [ ] Create `scripts/tmux-reference-audit.mjs`
- [ ] Emit machine-readable summary (total + by-file + by-category)
- [ ] Support a strict mode that fails on functional TMUX command usage

### Step 2: Add regression guard test
- [ ] Add `extensions/tests/tmux-reference-guard.test.ts`
- [ ] Assert no functional TMUX command execution remains in `extensions/taskplane/*.ts`
- [ ] Assert audit script output stays parseable and deterministic

### Step 3: Tests and validation
- [ ] Run targeted tests including new guard test
- [ ] Run full extension suite
- [ ] Fix failures

### Step 4: Documentation & delivery
- [ ] Update migration doc with the new guardrail and how to run it
- [ ] Update STATUS.md summary with baseline numbers and command examples

## Do NOT

- Change orchestrator runtime behavior in this task
- Rename compat fields in config/state here
- Add brittle tests tied to exact comment wording

## Git Commit Convention

- `test(TP-122): ...`
- `chore(TP-122): ...`
- `docs(TP-122): ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
