# Plan Review — TP-080 Step 1 (Add segment contracts)

## Verdict: APPROVE

Step 1 planning is now implementation-ready.

## What I reviewed

- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/PROMPT.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/STATUS.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/waves.ts`
- `docs/specifications/taskplane/multi-repo-task-execution.md`

## Why this plan is ready

1. **Concrete type contracts are now explicitly defined.**  
   Step 1 includes specific contracts and names for segment identity, node/edge shapes, task-level segment plan, and explicit prompt metadata shape.

2. **Stable ID rule is specified.**  
   The plan locks segment ID generation to `<taskId>::<repoId>`, which aligns with the specification and gives deterministic graph keys.

3. **Deterministic ordering semantics are called out up front.**  
   Segment ordering, edge ordering, and task-level ordering guarantees are documented in the plan, reducing ambiguity for Step 3 inference and tests.

4. **Observability/provenance typing is covered.**  
   `"explicit" | "inferred"` provenance plus optional `reason` gives enough structure for debug visibility without overcommitting runtime behavior too early.

5. **Backward compatibility is preserved.**  
   The `ParsedTask` metadata addition is explicitly optional/additive, which is consistent with existing parser behavior and current task-only planning paths.

6. **Repo-mode behavior is explicitly addressed.**  
   The plan clarifies how segment IDs are formed in repo mode, so Step 1 can proceed without waiting on later runtime changes.

## Non-blocking recommendations

- Prefer a documented constant for the repo-mode synthetic repo ID (rather than ad hoc literals) so later steps/tests use one source of truth.
- In contract comments, explicitly state that ordered lists should be represented as arrays (not map iteration order) to avoid accidental nondeterminism.
