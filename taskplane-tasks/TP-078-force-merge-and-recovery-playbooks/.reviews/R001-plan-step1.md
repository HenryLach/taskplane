# R001 Plan Review — Step 1 (`orch_force_merge`)

## Verdict: ❌ Changes requested

The Step 1 direction is good (new tool + persisted-state mutation path), but the plan is missing a **critical implementation requirement**: it must perform a real merge with mixed-lane override, not only mark state as merged.

## What is good

- Tool surface/params are correctly scoped (`waveIndex?`, `skipFailed?`) in `extension.ts`.
- Uses persisted batch state and in-memory sync patterns consistent with `orch_retry_task` / `orch_skip_task`.
- Includes operator guidance (`orch_resume(...)` hint) and wave index validation.

## Blocking gaps to fix

### 1) Real merge execution is missing (state-only override is unsafe)
**Severity:** High (blocking)

Prompt requires: “invoke merge logic with a bypass flag” (PROMPT.md Step 1).

Current approach updates `mergeResults[...]` to `succeeded` without running merge logic (`extension.ts:2679-2685`).

Why this is a blocker:
- Mixed lanes are explicitly excluded from merge eligibility in `merge.ts` (`merge.ts:1218-1234`).
- If you flip persisted status to succeeded without merging commits, resume logic will skip merge retry (`resume.ts:567-571`) and succeeded commits from mixed lanes can be dropped.

**Plan update required:** add explicit merge invocation path (likely through `mergeWaveByRepo`/`mergeWave`) with a force flag that includes mixed-outcome lanes.

---

### 2) Validation is too broad; must be specifically “mixed-outcome merge failure”
**Severity:** High

Current logic allows any non-succeeded merge entry (`extension.ts:2614-2617`). That can bypass unrelated merge failures (conflict/build/setup), which should not be force-marked as success.

**Plan update required:** require latest wave merge result to match mixed-outcome condition (status/reason pattern from engine), and reject non-mixed failure reasons.

---

### 3) Return payload does not include actual merge outcome details
**Severity:** Medium

Prompt asks to return merge outcome (changed files/conflicts). Current output is synthesized from task statuses, not merge-agent results (`extension.ts:2719-2734`).

**Plan update required:** return real merge result data from merge execution (lane outcomes, conflicts, merge commits; file-level summary if available).

---

### 4) Step 1 scope should include `merge.ts`/`engine.ts` changes (as specified)
**Severity:** Medium

Task file scope includes `merge.ts` and `engine.ts` for this step, but current plan centers only in `extension.ts`.

**Plan update required:** define minimal cross-module contract:
- Add force option in merge API (`allowMixedOutcomeLanes` or equivalent), default `false`.
- Keep engine/resume default behavior unchanged.
- Use force option only from `orch_force_merge` path.

---

## Recommended revised Step 1 plan (minimal)

1. Register `orch_force_merge(waveIndex?, skipFailed?)` tool (done).
2. Validate batch is in resumable terminal phase and target wave has **mixed-outcome partial merge failure**.
3. If `skipFailed=true`, mark failed/stalled tasks in wave as skipped (counter + blocked recompute).
4. Reconstruct wave lanes from persisted state and call merge logic with mixed-lane override enabled.
5. Persist real merge result + sync in-memory state.
6. Return concrete merge outcome (merged lanes/commits/conflicts; failure details when merge still fails).

## Note

Until gap #1 is addressed, this tool can report success while leaving actual lane commits unmerged, which violates determinism/recoverability guarantees.