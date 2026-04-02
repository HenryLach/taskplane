# Task: TP-124 - Comment and Type Doc De-TMUX Sweep

**Created:** 2026-04-02
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Primarily non-functional wording cleanup across comments/JSDoc/type descriptions. Moderate file count, low behavioral risk.
**Score:** 3/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-124-comment-and-type-doc-detmux-sweep/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Clean residual TMUX wording in code comments, JSDoc, and type descriptions so the Runtime V2 codebase reads consistently. Preserve compatibility behavior and literal external contracts where required.

## Dependencies

- **Task:** TP-122 (reference audit/guard)
- **Task:** TP-123 (operator messaging cleanup)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/types.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/diagnostics.ts`
- `extensions/taskplane/process-registry.ts`

## File Scope

- `extensions/taskplane/types.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/diagnostics.ts`
- `extensions/taskplane/process-registry.ts`
- `extensions/taskplane/agent-host.ts`
- `extensions/tests/*.test.ts` (only if wording assertions break)

## Steps

### Step 0: Inventory doc-only TMUX references
- [ ] Use audit output to identify doc/comment/type-description references
- [ ] Mark lines that are true external-contract literals and must stay unchanged
- [ ] Log inventory split in STATUS.md

### Step 1: Update comments and JSDoc
- [ ] Replace TMUX-era wording with Runtime V2/session terminology in comments
- [ ] Keep migration-history comments concise and accurate
- [ ] Remove stale references to deleted TMUX functions/flows

### Step 2: Update type descriptions (non-breaking)
- [ ] Update descriptive comments on interfaces/type fields to backend-neutral terms
- [ ] Keep literal enum/error-code values unchanged unless explicitly backward-compatible
- [ ] Ensure generated docs/comments still describe current behavior

### Step 3: Validation
- [ ] Run lint/typecheck-equivalent checks used in project workflow
- [ ] Run targeted tests for any source-structure assertions impacted by wording edits
- [ ] Fix regressions

### Step 4: Delivery
- [ ] Record before/after count for comment/doc references
- [ ] Note which literal compatibility strings remain and why

## Do NOT

- Rename literal error-code enum members in this task
- Change persisted schema fields in this task
- Introduce functional behavior changes hidden in comment-only commits

## Git Commit Convention

- `docs(TP-124): ...`
- `refactor(TP-124): ...`
- `test(TP-124): ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
