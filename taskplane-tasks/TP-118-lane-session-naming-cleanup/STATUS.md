# TP-118: Lane Session Naming Cleanup — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** 🟨 In Progress
- [x] Read PROMPT.md and STATUS.md
- [x] Count tmuxSessionName references
- [x] Identify type definitions to update
- [x] Plan alias-first approach

### Step 1: Type alias introduction
**Status:** ⬜ Not Started
- [ ] Add laneSessionId alias to types
- [ ] Rename generateTmuxSessionName → generateLaneSessionId (keep alias)
- [ ] Backward-compat state reading

### Step 2: Rename in production code
**Status:** ⬜ Not Started
- [ ] execution.ts
- [ ] engine.ts, merge.ts, extension.ts, persistence.ts, resume.ts
- [ ] Dashboard server.cjs and app.js
- [ ] naming.ts

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
|-----------|--------|---------|
