# Plan Review — TP-080 Step 3 (Deterministic inference fallback)

## Verdict: REVISE

Step 3 is not implementation-ready yet. The current Step 3 checklist in `STATUS.md` is still too high-level for a planner-path change in `waves.ts` that introduces new deterministic output (`segmentPlans`) and policy semantics (one active segment per task).

## What I reviewed

- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/PROMPT.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/STATUS.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/discovery.ts`
- `extensions/tests/waves-repo-scoped.test.ts`
- `docs/specifications/taskplane/multi-repo-task-execution.md` (segment ordering section)

## Why revision is required

Current Step 3 bullets do not yet define:
- the exact inference algorithm and data-source precedence,
- the concrete planner integration point (`computeWaveAssignments` + `WaveComputationResult.segmentPlans`),
- the exact representation of the one-active-segment policy (edge shape/order/provenance),
- or the concrete test matrix needed to validate determinism.

## Required plan fixes before implementation

1. **Define exact planner wiring in `waves.ts`.**
   - Specify whether `computeWaveAssignments()` always returns `segmentPlans` (recommended) or only in some cases.
   - State that existing `waves` output must remain behaviorally unchanged (additive only).
   - Lock deterministic insertion order for `TaskSegmentPlanMap` (sorted by `taskId`, per type contract).

2. **Define deterministic inference inputs and precedence concretely.**
   For tasks without `explicitSegmentDag`, specify exact source order, e.g.:
   - repo touches derived from `fileScope` repo-prefixes (first-seen order),
   - dependency-informed stabilization/tie-break behavior,
   - fallback to `task.resolvedRepoId` (workspace) or synthetic `"default"` (repo mode) when no multi-repo signal exists.
   Also explicitly note whether checklist-step text is out of scope for TP-080 Step 3 (currently not parsed in `ParsedTask`).

3. **Define repo-touch extraction/normalization rules.**
   - Exact prefix parsing rule from `fileScope` entries,
   - normalization expectations (case, separators),
   - dedupe behavior while preserving deterministic first appearance,
   - final sort/tie-break rule when first-appearance is equal/absent.

4. **Define one-active-segment representation explicitly.**
   - Specify how ordered inferred segments are serialized into edges (recommended: linear chain `s0->s1->...`).
   - Require `provenance: "inferred"` and stable `reason` strings.
   - Confirm edges are sorted by `fromSegmentId`, then `toSegmentId`.

5. **Clarify interaction with explicit DAG tasks in the same batch.**
   - State whether Step 3 will build plans for **all** tasks (`explicit-dag`, `inferred-sequential`, `repo-singleton`) so consumers can rely on a complete map.
   - Ensure explicit metadata remains authoritative where present (no inferred overwrite).

6. **Hydrate Step 3 test plan in `waves-repo-scoped.test.ts` with named cases.**
   Add concrete cases for at least:
   - inferred multi-repo ordering determinism from fileScope,
   - deterministic fallback when no fileScope signals (resolvedRepoId/default singleton),
   - one-active-segment chain edge generation,
   - map determinism (same output regardless of input map insertion order),
   - mixed explicit + inferred tasks producing stable `mode` and provenance.

## Non-blocking implementation guidance

- Keep inference pure and in-memory (no PROMPT re-read in planning path).
- Prefer small helpers in `waves.ts` (e.g., `buildTaskSegmentPlans`, `inferSegmentPlanForTask`) to keep `computeWaveAssignments()` readable and testable.
