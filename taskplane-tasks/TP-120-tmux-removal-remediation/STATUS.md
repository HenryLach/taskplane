# TP-120: TMUX Removal Remediation — Status

**Current Step:** Step 3: Remove abort.ts TMUX code
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 7
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight — Inventory remaining TMUX code
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Count remaining TMUX refs
- [x] Identify TMUX functions in execution.ts
- [x] Identify TMUX usage in merge.ts
- [x] Identify TMUX usage in abort.ts
- [x] Log inventory

### Step 1: Remove TMUX helper functions from execution.ts
**Status:** ✅ Complete
- [x] Remove tmuxHasSessionAsync()
- [x] Remove tmuxKillSessionAsync()
- [x] Remove captureTmuxPaneTailAsync()
- [x] Remove captureTmuxPaneTail()
- [x] Remove toTmuxPath()
- [x] Remove other TMUX-only helpers
- [x] Update imports — remove TMUX references
- [x] Remove fallback branches, keep V2-only paths
- [x] R002: Seed/clear V2 liveness registry cache in MergeHealthMonitor.poll()
- [x] R002: Update supervisor-merge-monitoring test expectations for V2 liveness path

### Step 2: Remove merge health monitor TMUX polling
**Status:** ✅ Complete
- [x] Replace or remove tmuxHasSessionAsync in MergeHealthMonitor.poll()
- [x] Remove captureTmuxPaneTail* calls
- [x] Remove tmuxHasSessionAsync import from merge.ts
- [x] Evaluate if entire health monitor is legacy dead code
- [x] R004: Remove merge.ts TMUX capture helpers and all functional `spawn("tmux"` / `spawnSync("tmux"` calls
- [x] R004: Replace pane-output-based health semantics with V2-safe liveness/result-file semantics
- [x] R004: Update merge-monitor tests for V2 liveness + no TMUX capture behavior

### Step 3: Remove abort.ts TMUX code
**Status:** 🟨 In Progress
- [ ] Remove execSync('tmux list-sessions') from abort.ts
- [ ] Replace with V2 registry or remove
- [ ] Ensure V2 abort is only path
- [ ] Remove `/orch-abort` TMUX list/kill path from extension.ts by routing to V2-only abort behavior
- [ ] Implement concrete non-TMUX session discovery that still aborts correctly when only persisted state exists
- [ ] Add/adjust abort tests for graceful/hard V2 targeting and no-batch/no-session handling without TMUX

### Step 4: Config rename — tmux_prefix → sessionPrefix
**Status:** ⬜ Not Started
- [ ] Rename in config-schema.ts
- [ ] Update config-loader.ts (keep backward-compat alias)
- [ ] Rename generateLaneSessionId parameter
- [ ] Update all call sites
- [ ] Update settings-tui.ts
- [ ] Update template YAML
- [ ] Update dashboard

### Step 5: Tests
**Status:** ⬜ Not Started
- [ ] Update test references
- [ ] Run full suite
- [ ] Fix all failures
- [ ] Verify zero functional TMUX code

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md
- [ ] Final TMUX reference count
- [ ] Log before/after count

---

## Step 0 Inventory (2026-04-02)

- TMUX reference count (`grep -rn "tmux" extensions/taskplane/*.ts | grep -v "test\|//" | wc -l`): **160**
- `extensions/taskplane/execution.ts` TMUX functions identified:
  - `runTmuxCommandAsync()` (private helper)
  - `tmuxHasSessionAsync()`
  - `tmuxKillSessionAsync()`
  - `captureTmuxPaneTailAsync()`
  - `toTmuxPath()`
  - `captureTmuxPaneTail()`
- `extensions/taskplane/merge.ts` TMUX usage identified:
  - Import of `tmuxHasSessionAsync` from `execution.ts`
  - `MergeHealthMonitor.poll()` liveness check uses `tmuxHasSessionAsync(sessionName)`
  - Merge pane capture helpers (`captureMergePaneOutput`, `captureMergePaneOutputAsync`, `runMergeTmuxCommandAsync`) invoke `tmux capture-pane`
  - Session naming still references `config.orchestrator.tmux_prefix`
- `extensions/taskplane/abort.ts` TMUX usage identified:
  - `execSync('tmux list-sessions -F "#{session_name}"')` in abort flow Step 3 for session discovery

## Notes

- Reviewer suggestion (R002): add focused unit coverage for merge-monitor behavior when liveness cache is missing/populated.
- Reviewer suggestion (R002): clean up residual TMUX wording in execution comments in a follow-up.
- Reviewer suggestion (R004): if monitor remains, keep the V2 liveness cache seed/clear pattern inside poll cycles.
- Step 2 evaluation: `MergeHealthMonitor` is still active runtime code (constructed in `engine.ts` merge flow), so it was retained and de-TMUXed rather than removed.
- Reviewer suggestion (R007): after TMUX removal in abort flow, consider renaming TMUX-specific abort error identifiers/messages to backend-neutral names in follow-up.

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 13:48 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 13:48 | Step 0 started | Preflight — Inventory remaining TMUX code |
|-----------|--------|---------|
| 2026-04-02 13:51 | Review R001 | plan Step 1: APPROVE |
| 2026-04-02 14:01 | Review R002 | code Step 1: REVISE |
| 2026-04-02 14:04 | Review R003 | code Step 1: APPROVE |
| 2026-04-02 14:06 | Review R004 | plan Step 2: REVISE |
| 2026-04-02 14:07 | Review R005 | plan Step 2: APPROVE |
| 2026-04-02 14:16 | Review R006 | code Step 2: APPROVE |
| 2026-04-02 14:18 | Worker iter 1 | killed (wall-clock timeout) in 1800s, tools: 157 |
| 2026-04-02 14:18 | Step 3 started | Remove abort.ts TMUX code |
| 2026-04-02 14:21 | Review R007 | plan Step 3: REVISE |
