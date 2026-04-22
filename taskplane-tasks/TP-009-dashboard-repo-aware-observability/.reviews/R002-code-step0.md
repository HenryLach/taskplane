# R002 Code Review — TP-009 Step 0

## Verdict: **REVISE**

Step 0 is close, but there is one correctness issue in schema validation that should be fixed before sign-off.

## What I reviewed
- Diff range: `f6975a5..HEAD`
- Changed files:
  - `dashboard/server.cjs`
  - `extensions/taskplane/persistence.ts`
  - `extensions/taskplane/types.ts`
  - `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md`
- Neighboring consistency checks:
  - `extensions/taskplane/merge.ts`
  - `extensions/taskplane/messages.ts`
  - `dashboard/public/app.js`
- Validation run:
  - `cd extensions && npx vitest run` ✅ (290/290 passing)

---

## Findings

### 1) Incomplete validation for new `mergeResults[*].repoResults[*]` schema
**Severity:** Medium  
**File:** `extensions/taskplane/persistence.ts` (around lines 572–599)

The new validator branch checks only:
- object shape
- `status`
- `laneNumbers` is an array

It does **not** validate:
- `repoId` type (`string | undefined`)
- `laneNumbers` element types (should be numbers)
- `failedLane` type (`number | null`)
- `failureReason` type (`string | null`)

So malformed state currently passes validation.

### Repro
I executed:

```bash
cd extensions && npx tsx -e "import { readFileSync } from 'fs'; import { validatePersistedState } from './taskplane/persistence.ts'; const data=JSON.parse(readFileSync('./tests/fixtures/batch-state-valid.json','utf8')); data.mergeResults=[{waveIndex:0,status:'succeeded',failedLane:null,failureReason:null,repoResults:[{status:'succeeded',laneNumbers:['not-number'],failedLane:'x',failureReason:42,repoId:123}]}]; try{ const r=validatePersistedState(data); console.log('validated', JSON.stringify(r.mergeResults[0].repoResults[0])); }catch(e){ console.error('threw', e.message);} "
```

Output:

```text
validated {"status":"succeeded","laneNumbers":["not-number"],"failedLane":"x","failureReason":42,"repoId":123}
```

### Why this matters
`validatePersistedState()` is the contract gate for resumability/recoverability. Allowing malformed persisted fields undermines deterministic state handling and can cause downstream UI/logic surprises once Step 1 starts consuming repo-level merge data.

### Suggested fix
In `validatePersistedState()` add full field checks for each repo result entry:
- `repoId === undefined || typeof repoId === "string"`
- `Array.isArray(laneNumbers)` and `laneNumbers.every(n => typeof n === "number")`
- `failedLane === null || typeof failedLane === "number"`
- `failureReason === null || typeof failureReason === "string"`

Also add targeted tests in `extensions/tests/orch-state-persistence.test.ts` for:
- valid `repoResults`
- invalid `repoId`
- invalid `laneNumbers` element type
- invalid `failedLane`
- invalid `failureReason`

---

## Notes
- `dashboard/server.cjs` addition of `batch.mode` defaulting to `"repo"` is correct and backward-compatible.
- `serializeBatchState()` enrichment of merge repo outcomes is directionally correct and additive.
- No regressions observed in existing test suite.
