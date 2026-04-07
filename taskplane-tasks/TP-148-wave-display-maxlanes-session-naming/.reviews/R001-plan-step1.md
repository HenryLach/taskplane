## Plan Review: Step 1 — Wave display with segment context

### Verdict: APPROVE

### Summary
The plan correctly identifies the three areas needing change: persisted state enrichment, dashboard display, and engine events. The approach aligns with PROMPT.md's recommended Option B (add segment context to wave display rather than collapsing waves at the engine level). The existing codebase already has the segment data foundation in place (`PersistedSegmentRecord[]`, `task.segmentIds`, `task.activeSegmentId`), so the primary work is surfacing this in the wave display paths.

### Issues Found
No blocking issues.

### Missing Items
None — the plan covers the three stated outcomes (persisted state context, dashboard display, engine events) and includes targeted testing.

### Suggestions
- **Schema caution for wavePlan enrichment:** The first checkbox says "Add segment context to wavePlan in persisted state (segment index/total/repoId per task in each wave)." The current `wavePlan` field is `string[][]` (types.ts:2912). If the implementation changes this type to a richer structure, it would break backward compatibility with resume, migrations, and the dashboard's existing `wavePlan` consumers (app.js:455, 582–587, 937–938). Consider adding a parallel `wavePlanMeta` field (or similar) alongside the existing `wavePlan: string[][]` rather than altering its type. Alternatively, the dashboard already has per-task segment data (`task.segmentIds`, `task.activeSegmentId`, `segments[]` records) — the wave chips could derive segment context client-side from existing data by cross-referencing `wavePlan` task IDs with the task records and segment status map, avoiding any schema change entirely.
- **Dashboard already has helpers:** `taskSegmentProgress()` and `parseSegmentId()` in `app.js` (lines 322–380) already compute segment index/total/repoId for task-level display. The wave chip rendering (app.js:582–587) could reuse these helpers to show "TP-006 (2/3: api-service)" without new server-side data.
- **Tooltip vs inline:** The plan says "show segment info in wave tooltip and task rows." For the wave chip row specifically, inline text like `W3 [TP-006 (2/3: api-service)]` is more immediately visible than tooltip-only — consider making the segment annotation inline in the chip label.
