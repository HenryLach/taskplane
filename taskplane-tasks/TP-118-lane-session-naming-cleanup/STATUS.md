# TP-118: Lane Session Naming Cleanup — Status

**Current Step:** Step 2: Rename in production code
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Count tmuxSessionName references
- [x] Identify type definitions to update
- [x] Plan alias-first approach

### Step 1: Type alias introduction
**Status:** ✅ Complete
- [x] Add laneSessionId alias to types
- [x] Rename generateTmuxSessionName → generateLaneSessionId (keep alias)
- [x] Backward-compat state reading

### Step 2: Rename in production code
**Status:** 🟨 In Progress
- [ ] execution.ts
- [ ] engine.ts, merge.ts, extension.ts, persistence.ts, resume.ts
- [ ] Dashboard server.cjs and app.js
- [ ] naming.ts
- [ ] Sweep remaining production modules (`abort.ts`, `formatting.ts`, `diagnostic-reports.ts`, `sessions.ts`, and any additional non-test references)
- [ ] Verify non-test `tmuxSessionName` references are removed or explicitly compatibility-scoped

### Step 3: Rename in tests
**Status:** ⬜ Not Started
- [ ] Update all test references
- [ ] Run full suite
- [ ] Fix all failures

### Step 4: Remove aliases
**Status:** ⬜ Not Started
- [ ] Remove tmuxSessionName from types
- [ ] Remove generateTmuxSessionName alias
- [ ] Verify full suite

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md
- [ ] Log rename count

---

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 05:12 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 05:12 | Step 0 started | Preflight |
| 2026-04-02 05:14 | Counted references | 193 total `tmuxSessionName` matches across worktree |
| 2026-04-02 05:15 | Identified types | `AllocatedLane` and `PersistedLaneRecord` in `extensions/taskplane/types.ts` |
| 2026-04-02 05:16 | Planned migration | Step 1 will add alias fields + function alias, plus persistence/resume dual-read for `tmuxSessionName` and `laneSessionId` |
| 2026-04-02 05:15 | Review R001 | plan Step 1: APPROVE |
| 2026-04-02 05:17 | Added type alias fields | `laneSessionId` added (alias phase) to `AllocatedLane` and `PersistedLaneRecord` |
| 2026-04-02 05:18 | Renamed generator | `generateLaneSessionId()` added and `generateTmuxSessionName` kept as deprecated alias |
| 2026-04-02 05:20 | Added compat state reads | Persisted lane validation now accepts either field and normalizes both `laneSessionId` and `tmuxSessionName` |
| 2026-04-02 05:22 | Targeted tests | `naming-collision`, `monorepo-compat-regression`, `orch-state-persistence` passed |
|-----------|--------|---------|
| 2026-04-02 05:18 | Review R002 | code Step 1: APPROVE |
| 2026-04-02 05:19 | Review R003 | plan Step 2: REVISE |

## Notes
- Reviewer suggestion: define allowed leftovers in Step 2 (compat normalization only) to avoid over/under-renaming.
- Reviewer suggestion: log post-step grep counts split by production/tests/docs for measurable progress.
