# R003 — Plan Review (Step 1: Add end-to-end polyrepo regression tests)

## Verdict
**REVISE**

## Reviewed artifacts
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/PROMPT.md`
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`
- `extensions/tests/fixtures/polyrepo-builder.ts`
- `extensions/tests/polyrepo-fixture.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/merge-repo-scoped.test.ts`
- `extensions/tests/naming-collision.test.ts`
- `extensions/tests/discovery-routing.test.ts`

## Blocking findings

### 1) Step 1 is not hydrated into implementation-ready work
`STATUS.md` still has only two prompt-level bullets for Step 1. For a Level 3 task, this is not enough to execute safely or review meaningfully.

### 2) Task status is internally inconsistent
Top-level status says `✅ Complete`, while Step 1 is `🟨 In Progress`. This makes operator/reviewer state unreliable and should be normalized before implementation proceeds.

### 3) No file-level mapping from Step 1 acceptance criteria to concrete tests
The plan does not specify where each required behavior will be asserted:
- `/task` routing
- `/orch-plan`
- `/orch` execution behavior
- per-repo merge outcomes
- resume semantics
- naming collision safety
- repo-aware persisted state fields

Given existing coverage is distributed across multiple test files, Step 1 needs an explicit **delta map** (which files get new assertions vs which existing coverage is reused).

### 4) No deterministic execution strategy for “end-to-end” scope
The plan does not state whether Step 1 will:
- run full tmux/git merge-agent orchestration, or
- use deterministic integration-style coverage via fixture + pure/module-level orchestration helpers.

Without this decision, Step 1 risks flaky/non-portable tests (especially around tmux and merge-agent spawning).

### 5) Step 1 depends on an unresolved Step 0 topology ambiguity
Step 0 claims “docs repo task root”, but current fixture builder and static state fixture imply different task-root placements. Step 1 path-sensitive assertions (routing, resume, state fields) depend on this being canonicalized first.

## Required updates before approval
1. Hydrate Step 1 in `STATUS.md` into concrete outcome-level items with target files.
2. Fix status consistency (`Complete` vs `In Progress`).
3. Add an acceptance matrix mapping each Step 1 requirement to exact assertions and files.
4. Declare deterministic test strategy (no hidden dependency on live tmux/merge-agent).
5. Resolve/document canonical fixture task-root topology before adding Step 1 path assertions.
6. Add targeted verification commands for Step 1 test files (not only full-suite run).

## Non-blocking note
`STATUS.md` review/log tables still contain duplicate rows; cleaning this up will improve traceability.
