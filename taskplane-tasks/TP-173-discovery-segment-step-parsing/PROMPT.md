# Task: TP-173 - Discovery Segment-Step Parsing

**Created:** 2026-04-12
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** New parsing logic in discovery.ts that all downstream consumers depend on. Must be correct — wrong mapping breaks worker scoping.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-173-discovery-segment-step-parsing/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Add parsing of `#### Segment: <repoId>` markers within PROMPT.md steps to `discovery.ts`. Build a `StepSegmentMapping` data structure that maps each step to its repo-scoped checkbox groups. This is the foundation for Phase A of the segment-aware steps specification — all other Phase A tasks depend on this mapping.

**Reference specification:** `docs/specifications/taskplane/segment-aware-steps.md` (sections A.1, A.10)

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/segment-aware-steps.md` — Phase A specification (read sections A.1 and A.10)
- `extensions/taskplane/discovery.ts` — existing PROMPT.md parser

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/discovery*.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read discovery.ts — understand how PROMPT.md is currently parsed (step extraction, checkbox extraction)
- [ ] Read types.ts — understand ParsedTask interface and where StepSegmentMapping would live
- [ ] Read the spec (segment-aware-steps.md sections A.1, A.10) for exact parsing rules
- [ ] Document findings in STATUS.md

### Step 1: Add Types

- [ ] Add `SegmentCheckboxGroup` interface: `{ repoId: string; checkboxes: string[] }`
- [ ] Add `StepSegmentMapping` interface: `{ stepNumber: number; stepName: string; segments: SegmentCheckboxGroup[] }`
- [ ] Add `stepSegmentMap?: StepSegmentMapping[]` to `ParsedTask` (optional for backward compat)
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)

### Step 2: Implement Segment Parsing

- [ ] In the PROMPT.md parser (discovery.ts), after extracting steps, scan each step section for `#### Segment: <repoId>` sub-headers
- [ ] Collect checkboxes (`- [ ]` lines) after each segment header into a `SegmentCheckboxGroup`
- [ ] Checkboxes before any segment header (or in steps with no segment headers) belong to the task's primary repoId (packet repo fallback)
- [ ] Populate `ParsedTask.stepSegmentMap` with the results
- [ ] Handle edge cases: empty segments, duplicate repoId within a step (error), unknown repoId (warning)
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/discovery.ts` (modified)

### Step 3: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add test: PROMPT.md with segment markers → correct StepSegmentMapping
- [ ] Add test: PROMPT.md without segment markers → single segment per step with primary repoId
- [ ] Add test: mixed steps (some with markers, some without) → correct mapping
- [ ] Add test: duplicate repoId in same step → discovery error
- [ ] Add test: empty segment (no checkboxes) → discovery warning
- [ ] Add test: unknown repoId → discovery warning with suggestion

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None (internal types/parsing)

**Check If Affected:**
- `docs/reference/task-format.md` — if segment marker format should be documented

## Completion Criteria

- [ ] All steps complete
- [ ] `ParsedTask.stepSegmentMap` populated correctly for multi-segment tasks
- [ ] Single-segment tasks produce expected fallback mapping
- [ ] Edge cases handled with appropriate warnings/errors
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `feat(TP-173): complete Step N — description`
- **Hydration:** `hydrate: TP-173 expand Step N checkboxes`

## Do NOT

- Change how steps are parsed (only ADD segment parsing within steps)
- Modify lane-runner or execution logic (that's TP-174)
- Make stepSegmentMap required on ParsedTask (must be optional for compat)
- Skip tests
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

