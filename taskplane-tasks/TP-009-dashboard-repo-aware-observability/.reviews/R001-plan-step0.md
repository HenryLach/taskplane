# R001 — Plan Review (Step 0: Extend dashboard data model)

## Verdict
**REVISE**

Step 0 is not hydrated enough to implement safely. `STATUS.md` still only mirrors the two high-level prompt bullets and does not define concrete payload contracts, compatibility behavior, or verification for lane/task/merge repo attribution.

## What I reviewed
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/PROMPT.md`
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md`
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `extensions/taskplane/formatting.ts`
- `extensions/taskplane/persistence.ts` (current merge-result persistence shape)
- `extensions/taskplane/types.ts` (repo-aware runtime/persisted fields)

## Blocking findings

### 1) Missing Step 0 implementation plan detail
`STATUS.md` Step 0 does not specify file-level changes, data fields, or endpoint surfaces. For this task, Step 0 needs explicit planning for `/api/state` + `/api/stream` payloads (and whether `/api/history*` is included).

### 2) Merge repo attribution source is undefined
Current dashboard backend reads `.pi/batch-state.json` (`dashboard/server.cjs`). Persisted `mergeResults` currently keep only summary fields (`waveIndex`, `status`, `failedLane`, `failureReason`) and do **not** include `repoResults`/per-repo outcomes (`extensions/taskplane/persistence.ts`).

Without a stated source strategy, Step 1 (“group merge outcomes by repo”) is under-specified.

### 3) Backward-compat contract is not defined
Plan should explicitly state additive-only payload changes and behavior when repo fields are absent (repo mode, v1 state, or older history entries). Right now compatibility is a checkbox with no contract.

### 4) No verification matrix for payload shape regressions
No targeted tests/manual verification are defined for payload contract changes. Given dashboard payload coupling with frontend, this is a gap.

## Required plan updates before implementation

1. **Hydrate Step 0 in `STATUS.md` with concrete outcomes**, e.g.:
   - Define canonical repo fields for lane/task/merge payload objects.
   - Implement backend payload enrichment in `dashboard/server.cjs`.
   - Preserve old consumer shape (additive fields only; no renames/removals).
   - Add verification for workspace + repo-mode payloads.

2. **Define exact payload contract (field names + fallback semantics)**
   - Lanes: `repoId` (optional) from persisted lane record.
   - Tasks: `repoId` and `resolvedRepoId` passthrough semantics.
   - Merge entries: explicitly define how repo attribution is represented **given current persisted schema limits**.

3. **Resolve merge attribution scope ambiguity explicitly**
   - If Step 0 relies only on dashboard files, define the best-effort merge attribution available now.
   - If per-repo merge grouping requires persistence/schema changes, record that as a required scope amendment/dependency so Step 1 is not blocked by hidden prerequisites.

4. **Add a Step 0 verification matrix**
   - Repo mode batch-state fixture: fields absent/empty but payload remains valid.
   - Workspace mode fixture (`batch-state-v2-workspace.json`): lane/task repo fields exposed correctly.
   - Merge payload compatibility: existing UI still renders when repo attribution is missing.

## Note
`PROMPT.md` file scope includes `extensions/taskplane/formatting.ts`; the plan should state whether Step 0 updates TUI/dashboard view-model contracts now or intentionally defers them to Step 1, to avoid drift between web dashboard and orchestrator dashboard formatting.
