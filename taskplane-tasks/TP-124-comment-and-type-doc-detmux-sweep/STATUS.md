# TP-124: Comment and Type Doc De-TMUX Sweep — Status

**Current Step:** Step 2: Update type descriptions (non-breaking)
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-02
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Inventory doc-only TMUX references
**Status:** ✅ Complete
- [x] Use audit output to identify doc/comment/type-description references
- [x] Mark true external-contract literals that must remain
- [x] Log inventory split in STATUS.md

### Step 1: Update comments and JSDoc
**Status:** ✅ Complete
- [x] Replace TMUX-era wording with Runtime V2/session terminology
- [x] Keep migration-history comments concise and accurate
- [x] Remove stale references to deleted TMUX flows

### Step 2: Update type descriptions (non-breaking)
**Status:** 🟨 In Progress
- [ ] Update descriptive comments on interfaces/type fields
- [ ] Keep literal enum/error-code values unchanged unless backward-compatible
- [ ] Ensure comments match current behavior

### Step 3: Validation
**Status:** ⬜ Not Started
- [ ] Run lint/typecheck-equivalent checks used in project workflow
- [ ] Run targeted tests for impacted source-structure assertions
- [ ] Fix regressions

### Step 4: Delivery
**Status:** ⬜ Not Started
- [ ] Record before/after count for comment/doc references
- [ ] Note which compatibility literals remain and why

---

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 20:58 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 20:58 | Step 0 started | Inventory doc-only TMUX references |
| 2026-04-02 21:07 | Step 0 inventory | Audit scope refs: 92 total, 47 comments/docs + 44 types/contracts (1 compat-code) |
| 2026-04-02 21:10 | Step 0 completed | Inventory split + compatibility literals captured |
| 2026-04-02 21:10 | Step 1 started | Update comments and JSDoc |
| 2026-04-02 21:22 | Step 1 completed | Comment/JSDoc wording de-TMUXed in non-type files |
| 2026-04-02 21:22 | Step 2 started | Update type descriptions (non-breaking) |
|-----------|--------|---------|

## Step 0 Inventory Snapshot

### Audit-derived doc/type reference split (in-scope files)
- `extensions/taskplane/agent-host.ts`: comments/docs 6
- `extensions/taskplane/diagnostics.ts`: comments/docs 3
- `extensions/taskplane/execution.ts`: comments/docs 25
- `extensions/taskplane/merge.ts`: comments/docs 9
- `extensions/taskplane/process-registry.ts`: comments/docs 2
- `extensions/taskplane/resume.ts`: comments/docs 2
- `extensions/taskplane/types.ts`: types/contracts 44
- **In-scope total:** 92 `tmux` refs → **91 doc/type refs** (`comments/docs` 47 + `types/contracts` 44) + 1 compat-code

### External-contract literals to keep unchanged
- `OrchestratorConfig.orchestrator.spawn_mode: "tmux" | "subprocess"` (`types.ts`) — legacy config compatibility value.
- `ExecutionErrorCode`: `"EXEC_TMUX_NOT_AVAILABLE"` (`types.ts`) — stable error-code contract.
- `ResumeErrorCode`: `"RESUME_TMUX_UNAVAILABLE"` (`types.ts`) — stable resume error-code contract.
- `AbortErrorCode`: `"ABORT_TMUX_LIST_FAILED"` (`types.ts`) — stable abort error-code contract.
- Existing type/property names that include `tmux` (for example `LaneStatus.tmuxSession`) are treated as compatibility contracts in this task; only doc wording will be updated.
| 2026-04-02 21:01 | Review R001 | plan Step 1: APPROVE |
