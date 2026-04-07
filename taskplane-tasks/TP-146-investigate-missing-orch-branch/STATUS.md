# TP-146: Investigate Missing Orch Branch in Workspace Mode — Status

**Current Step:** Step 4: Testing & Verification
**Status:** ✅ Complete
**Last Updated:** 2026-04-07
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** S

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Read engine.ts orch branch creation
- [x] Read worktree.ts provisioning
- [x] Read waves.ts per-repo allocation

### Step 1: Trace orch branch creation
**Status:** ✅ Complete
- [x] Identify orch branch creation per-repo (engine.ts:2137-2155) — ALL repos in workspaceConfig.repos get orch branch; failure is atomic (batch stops)
- [x] Trace resolveBaseBranch fallback chain — SILENT fallback to getCurrentBranch (develop) if orch branch missing in repo (waves.ts:575-594)
- [x] Analyze merge target resolution — YES, mergeWaveByRepo ALWAYS uses raw baseBranch=orchBranch (merge.ts:2281), never resolveBaseBranch
- [x] Check doOrchIntegrate per-repo loop — YES, extension.ts:3170-3208 iterates repos and executeIntegration calls performCleanup which deletes orch branch PER REPO; partial failure leaves some repos integrated and others not
- [x] Check ensureTaskFilesCommitted — commits to primary repo's checked-out branch (develop), NOT orch branch; but this affects ALL repos equally and is handled by absolute paths for cross-repo segments; NOT the root cause of api-service-specific issue

### Step 2: Analyze batch evidence
**Status:** ✅ Complete
- [x] Analyzed code paths — found 3 contributing factors: (1) resolveBaseBranch silent fallback, (2) buildIntegrationExecutor only handles primary repo, (3) doOrchIntegrate non-atomic per-repo loop
- [x] Traced git history: fix 6294209f had TWO bugs (check.status instead of check.ok + missing runGit import), fixed in 31842846 and 55ba4dcb; both fixes present in v0.24.30 used by e2e test
- [x] Confirmed buildIntegrationExecutor (extension.ts:1329) scoped to single repoRoot — supervisor auto-integration misses secondary workspace repos

### Step 3: Document findings
**Status:** ✅ Complete
- [x] Write root cause analysis in STATUS.md Discoveries table (D1-D5)
- [x] Add resolveBaseBranch warning log for silent fallback (code fix) — replaced debug console.error with structured WARNING in waves.ts:582-590
- [x] Document recommended follow-up tasks — added 2 tech debt items to CONTEXT.md + amendments in PROMPT.md

### Step 4: Testing & Verification
**Status:** ✅ Complete
- [x] Full test suite passing — 3231 tests, 0 failures

---

## Discoveries

| ID | Category | Finding | Action |
|----|----------|---------|--------|
| D1 | Root Cause | `resolveBaseBranch` (waves.ts:564) has a SILENT fallback: when the orch branch doesn't exist in a secondary repo, it returns `getCurrentBranch(repoRoot)` (e.g., `develop`) without any warning. Workers then operate on develop-based lane branches, bypassing orch isolation. The original fix (6294209f) had two bugs: used `check.status` instead of `check.ok` and forgot `runGit` import — both fixed in later commits (31842846, 55ba4dcb) and included in v0.24.30. | **Fix in this task:** Add execLog warning when fallback occurs |
| D2 | Gap | `buildIntegrationExecutor` (extension.ts:1329) is scoped to primary repo only. Supervisor auto-integration never integrates secondary workspace repos. | **Follow-up task** recommended |
| D3 | Gap | `doOrchIntegrate` (extension.ts:3170-3208) processes repos sequentially with no rollback. Partial success deletes orch branch in early repos while leaving later repos untouched. | **Follow-up task** recommended |
| D4 | Observation | `ensureTaskFilesCommitted` (execution.ts:1404) commits to primary repo's checked-out branch (`develop`), not the orch branch. If task files are untracked at batch start, the orch branch doesn't have them. Worktrees from orch branch would miss task files. This affects ALL repos equally and is mitigated by absolute paths for cross-repo segments. | Log as tech debt in CONTEXT.md |
| D5 | History | Original fix attempt (6294209f, April 3) added Step 0 to `resolveBaseBranch` but shipped with `check.status === 0` (wrong property — `runGit` returns `{ ok }` not `{ status }`) AND missing `runGit` import. Both bugs made the check always fail silently, effectively disabling the fix. Corrected in 31842846 (check.ok) and 55ba4dcb (import). | Documented |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-07 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-07 02:11 | Task started | Runtime V2 lane-runner execution |
| 2026-04-07 02:11 | Step 0 started | Preflight |
| 2026-04-07 02:26 | Review R001 | plan Step 1: APPROVE |
| 2026-04-07 02:46 | Worker iter 1 | done in 2116s, tools: 198 |
| 2026-04-07 02:46 | Task complete | .DONE created |
