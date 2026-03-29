# R009 Code Review — Step 3: Deterministic inference fallback

## Verdict
**REVISE**

## Scope Reviewed
Baseline commands requested:
- `git diff 7abaed3d0e775eb06f12031a55615b90e4648a13..HEAD --name-only`
- `git diff 7abaed3d0e775eb06f12031a55615b90e4648a13..HEAD`

Result: no committed delta vs baseline (`HEAD` equals baseline). I reviewed the working-tree step edits as the effective step change set.

Changed files reviewed in full:
- `extensions/taskplane/waves.ts`
- `extensions/tests/waves-repo-scoped.test.ts`
- (context from same working tree) `extensions/taskplane/types.ts`, `extensions/taskplane/discovery.ts`, `extensions/tests/discovery-routing.test.ts`

Neighbor/context checks:
- `extensions/taskplane/extension.ts` (consumer of `computeWaveAssignments`)
- `docs/specifications/taskplane/multi-repo-task-execution.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/STATUS.md`

## What Looks Good
- Segment planning helpers are cleanly factored (`inferTaskRepoOrder`, `buildSegmentPlanForTask`, `buildTaskSegmentPlans`).
- Explicit DAG authority is preserved when metadata exists.
- Deterministic ordering is implemented for task map keys and edge sorting.
- New step tests in `waves-repo-scoped.test.ts` cover important happy-path deterministic behavior.

## Findings (Blocking)

### 1) Repo mode can incorrectly produce multi-segment inferred plans from local path prefixes
**Where:** `extensions/taskplane/waves.ts` lines 678–684 and 694–700.

`inferTaskRepoOrder()` always treats `fileScope` first path segments as repo signals. In repo mode (`task.resolvedRepoId` absent), this can produce multi-repo inferred plans like `src`, `tests`, etc., instead of the required repo-singleton fallback.

This contradicts the Step contract and type intent (`repo-singleton: repo mode fallback (resolvedRepoId ?? "default")` in `types.ts` and Step 3 checklist).

**Repro (current code):**
```bash
node --experimental-strip-types --no-warnings -e "import { inferTaskRepoOrder } from './extensions/taskplane/waves.ts'; const task={taskId:'TP-1',taskName:'t',reviewLevel:1,size:'M',dependencies:[],fileScope:['src/a.ts','tests/b.ts'],taskFolder:'',promptPath:'',areaName:'default',status:'pending'}; const pending=new Map([['TP-1',task]]); console.log(JSON.stringify(inferTaskRepoOrder(task,pending,new Set())));"
```
Output:
```json
{"repoIds":["src","tests"],"usedFallback":false}
```
Expected in repo mode: singleton fallback (`default`) with `usedFallback: true`.

**Suggested fix:** short-circuit repo-mode inference (no `resolvedRepoId`) to singleton fallback before fileScope/dependency signal processing, or pass explicit mode context into inference.

**Test gap to add:** repo-mode task with multi-prefix `fileScope` should still return `mode: "repo-singleton"` and a single `default` segment.

---

### 2) `computeWaveAssignments()` does not always return additive `segmentPlans`
**Where:** `extensions/taskplane/waves.ts` lines 1359–1367.

The function early-returns on validation/topology errors without `segmentPlans`, despite Step 3 plan/checklist stating `computeWaveAssignments()` should always return additive segment plans.

**Repro (current code):**
```bash
node --experimental-strip-types --no-warnings -e "import { computeWaveAssignments } from './extensions/taskplane/waves.ts'; import { DEFAULT_ORCHESTRATOR_CONFIG } from './extensions/taskplane/types.ts'; const task={taskId:'TP-1',taskName:'t',reviewLevel:1,size:'M',dependencies:['TP-999'],fileScope:['api/x.ts'],taskFolder:'',promptPath:'',areaName:'default',status:'pending',resolvedRepoId:'api'}; const res=computeWaveAssignments(new Map([['TP-1',task]]),new Set(),DEFAULT_ORCHESTRATOR_CONFIG); console.log(JSON.stringify({hasSegmentPlans:Object.prototype.hasOwnProperty.call(res,'segmentPlans'),errors:res.errors.map(e=>e.code)}));"
```
Output:
```json
{"hasSegmentPlans":false,"errors":["DEP_UNRESOLVED"]}
```

**Suggested fix:** build `segmentPlans` before early returns and include it in all return paths (or at minimum return an empty deterministic map on error paths).

**Test gap to add:** failing graph validation still returns `segmentPlans` in deterministic taskId order.

## Validation Notes
Executed:
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/waves-repo-scoped.test.ts tests/discovery-routing.test.ts`
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`

Result: tests passed in current tree, but the two contract gaps above are not currently covered by tests.
