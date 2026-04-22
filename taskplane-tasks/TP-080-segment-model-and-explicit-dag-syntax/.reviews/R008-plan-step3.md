# Plan Review — TP-080 Step 3 (Deterministic inference fallback)

## Verdict: APPROVE

The Step 3 plan in `STATUS.md` is now implementation-ready and addresses the gaps called out in R007.

## What I reviewed

- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/PROMPT.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/STATUS.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/discovery.ts`
- `extensions/tests/waves-repo-scoped.test.ts`
- `docs/specifications/taskplane/multi-repo-task-execution.md`

## Why this is approved

Step 3 now explicitly defines:

1. **Planner wiring**
   - `computeWaveAssignments()` will produce additive `segmentPlans`.
   - Existing `waves` output remains behaviorally unchanged.
   - Deterministic map population order is specified.

2. **Deterministic inference precedence**
   - File-scope repo touch extraction first.
   - De-dup + first-seen ordering.
   - Dependency-based stabilization signal.
   - Fallback to `resolvedRepoId`, then synthetic `default`.

3. **One-active-segment representation**
   - Inferred plans use linear chain edges (`s0 -> s1 -> ...`).
   - Inferred edges include `provenance: "inferred"` and stable reason text.
   - Edge sort order is explicitly locked.

4. **Explicit DAG authority and mixed-batch behavior**
   - Explicit metadata remains authoritative.
   - Mixed explicit + inferred tasks are covered.
   - Mode semantics are called out (`explicit-dag`, `inferred-sequential`, `repo-singleton`).

5. **Concrete Step 3 test matrix**
   - Deterministic inference, singleton fallback, chain edges, map determinism, and mixed explicit/inferred scenarios are all listed.

## Non-blocking note

During implementation, ensure repo-mode behavior stays singleton-only as intended by the Step 1 contract (i.e., avoid treating arbitrary repo-local `fileScope` directory prefixes as cross-repo segment IDs).
