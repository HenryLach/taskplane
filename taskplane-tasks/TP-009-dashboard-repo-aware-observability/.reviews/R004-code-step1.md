# R004 Code Review — TP-009 Step 1 (Implement repo-aware UI)

## Verdict: **REVISE**

Good progress on repo-aware rendering/filtering, but there are two correctness issues that should be fixed before sign-off.

## What I reviewed
- Diff range: `e7d5d8d..HEAD`
- Changed code files:
  - `dashboard/public/app.js`
  - `dashboard/public/index.html`
  - `dashboard/public/style.css`
  - `extensions/taskplane/persistence.ts`
  - `extensions/taskplane/types.ts`
- Neighboring consistency checks:
  - `dashboard/server.cjs`
- Validation run:
  - `cd extensions && npx vitest run` ✅ (290/290)

---

## Findings

### 1) Persisted `repoResults` schema validation is still incomplete
**Severity:** Medium  
**File:** `extensions/taskplane/persistence.ts` (merge validation block around `mergeResults[*].repoResults[*]`)

The validator currently checks:
- `repoResults` is an array
- each item is an object
- `status` enum validity
- `laneNumbers` is an array

But it does **not** validate key field types:
- `repoId` should be `string | undefined`
- `laneNumbers[]` elements should be numbers
- `failedLane` should be `number | null`
- `failureReason` should be `string | null`

This allows malformed persisted state to pass validation.

#### Repro run
```bash
cd extensions && npx tsx -e "import { readFileSync } from 'fs'; import { validatePersistedState } from './taskplane/persistence.ts'; const data=JSON.parse(readFileSync('./tests/fixtures/batch-state-valid.json','utf8')); data.mergeResults=[{waveIndex:0,status:'succeeded',failedLane:null,failureReason:null,repoResults:[{status:'succeeded',laneNumbers:['not-number'],failedLane:'x',failureReason:42,repoId:123}]}]; try{ const r=validatePersistedState(data); console.log('validated', JSON.stringify(r.mergeResults[0].repoResults[0])); }catch(e){ console.error('threw', (e).message);} "
```
Output:
```text
validated {"status":"succeeded","laneNumbers":["not-number"],"failedLane":"x","failureReason":42,"repoId":123}
```

---

### 2) Repo filter UI can display a stale selection that does not match active filtering
**Severity:** Medium  
**File:** `dashboard/public/app.js` (`updateRepoFilter`)

When repo filter visibility toggles off (`repos.length < 2`), `selectedRepo` is reset to `""`, but the `<select>` value is not reset. If the same repo option set returns later, options are not rebuilt (`changed === false`), so the dropdown can still show the old repo while runtime filtering is actually `All repos`.

#### Deterministic flow
1. Filter shown with repos `[A,B]`, user selects `B`.
2. Next payload has `<2` repos → `updateRepoFilter([])` sets `selectedRepo = ""` and returns.
3. Later payload returns to `[A,B]`.
4. `changed === false` (same options), so `$repoFilter.value` is never synchronized.
5. UI can still display `B`, while logic uses `selectedRepo === ""` (all repos).

This is operator-confusing because visible selection and rendered data can disagree.

**Suggested fix:** In `updateRepoFilter`, always synchronize `$repoFilter.value = selectedRepo` when `shouldShow` is true (not only inside the `changed` branch).

---

## Summary
- Repo-aware UI implementation is directionally solid (mode gating, repo badges, merge sub-rows, disappearing-repo fallback).
- Please address the two issues above, then this step should be ready to approve.
