# R001 — Plan Review (Step 0: Parse execution target metadata)

## Verdict
**Changes requested** — current Step 0 plan is too coarse to execute deterministically.

## Reviewed artifacts
- `taskplane-tasks/TP-002-task-repo-routing-and-execution-target-parsing/PROMPT.md`
- `taskplane-tasks/TP-002-task-repo-routing-and-execution-target-parsing/STATUS.md`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/tests/` (current test layout)

## Blocking findings

### 1) Step 0 is not hydrated to implementation-level tasks
`STATUS.md` still only mirrors the two prompt bullets (`STATUS.md:19-20`) without concrete implementation units.

For this parser change, the plan should explicitly break out:
- parser extraction logic,
- `ParsedTask` shape change,
- compatibility behavior,
- tests.

### 2) Metadata grammar is not defined, so implementation is ambiguous
The requirement says “`## Execution Target / Repo:` metadata” (`PROMPT.md:63`), but the plan does not define accepted concrete forms.

`discovery.ts` currently uses deterministic section parsing patterns for dependencies/file-scope (`parsePromptForOrchestrator`), so Step 0 needs the same level of specificity for execution-target parsing (exact header(s), line formats, whitespace/case handling).

### 3) Data contract change is missing from plan
`ParsedTask` currently has no repo-target field (`types.ts:51`).

Step 0 should define where parsed prompt metadata is stored (e.g., `promptRepoId?: string`), distinct from Step 2’s resolved routing field. Without this, Step 1/2 handoff is unclear.

### 4) Backward-compat behavior is not operationally specified
“Preserve backward compatibility” is listed (`STATUS.md:20`) but not defined.

Step 0 must explicitly state:
- missing execution-target metadata => no parse error, task remains valid,
- no changes to existing ID/dependency/file-scope parsing behavior,
- no new fatal discovery errors introduced in Step 0.

### 5) No concrete test plan for parser behavior
There are currently no routing/discovery-focused tests in `extensions/tests/` (no `*routing*` files yet).

Given parser regex sensitivity, Step 0 needs a targeted test matrix before implementation (positive/negative/compat cases).

## Required plan updates before implementation
1. **Hydrate Step 0 in `STATUS.md`** into concrete checklist items, including file-level targets (`discovery.ts`, `types.ts`, tests).
2. **Define exact parse grammar** for execution target metadata (supported markdown shapes and precedence when multiple matches exist).
3. **Define `ParsedTask` field contract** for prompt-declared repo metadata, explicitly separate from future resolved `repoId`.
4. **Define backward-compat semantics** (missing metadata is non-fatal; existing parsing unchanged).
5. **Add a Step 0 test matrix** (at minimum):
   - prompt with no execution target,
   - section-based repo declaration,
   - inline `Repo:` declaration form,
   - whitespace/case/markdown decoration variants,
   - ensure dependencies/file-scope extraction remains unchanged.

## Non-blocking note
- `STATUS.md` execution log currently contains duplicate “Task started / Step 0 started” entries (`STATUS.md:73-76`). Clean up when updating status.
