# Plan Review — TP-080 Step 1 (Add segment contracts)

## Verdict: REVISE

Step 1 is not implementation-ready yet. `STATUS.md` still has only generic checklist bullets and does not define the concrete type contract needed for downstream Steps 2–3.

## What I reviewed

- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/PROMPT.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/STATUS.md`
- `extensions/taskplane/types.ts` (current task-level contracts: `ParsedTask`, `DependencyGraph`, `WaveComputationResult`)
- `extensions/taskplane/discovery.ts` (parsing/routing inputs available for future segment construction)
- `extensions/taskplane/waves.ts` (current planner remains task-node based)

## Required plan fixes before implementation

1. **Define exact new Step-1 types (names + fields + semantics).**  
   The plan must explicitly specify the segment contracts to add in `types.ts` (not just “segment types”). At minimum:
   - segment identity (`segmentId`, `taskId`, `repoId`)
   - segment dependency edge shape (`from`, `to`, provenance)
   - task→segments mapping shape with stable ID rule `<taskId>::<repoId>`

2. **Lock deterministic ordering semantics in the contract comments.**  
   Future inference/validation depends on stable output. Plan should declare required sort order for:
   - segments within a task
   - edge lists (tie-breakers)
   - task-to-segment mapping iteration

3. **Define provenance typing now (explicit vs inferred) with room for observability.**  
   Step 1 requires this; plan should include a concrete union (e.g., `"explicit" | "inferred"`) and whether reason/source metadata is captured for logs/debug output.

4. **State backward-compat behavior explicitly (non-breaking additive types).**  
   Current planner APIs in `waves.ts` are task-based. Step 1 should be additive and must not force refactors yet. Plan should say existing `DependencyGraph` / wave contracts remain valid until Step 3 wiring.

5. **Clarify repo-mode handling for segment IDs.**  
   Existing contracts frequently use optional `repoId` in repo mode. The plan must specify how `<taskId>::<repoId>` is represented when no workspace repo ID exists (or explicitly scope segment graphing to workspace mode for now).

## Suggested minimal hydration to add in STATUS Step 1

- Add exact interface/type names to be introduced in `types.ts`.
- Add one line documenting deterministic ordering guarantees for those types.
- Add one line documenting repo-mode compatibility for segment ID generation.
