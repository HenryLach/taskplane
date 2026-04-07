# TP-146: Investigate Missing Orch Branch in Workspace Mode — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
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
**Status:** ⬜ Not Started
- [ ] Root cause in Discoveries table
- [ ] Recommended fix
- [ ] Implement or recommend follow-up

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full test suite passing

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-07 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-07 02:11 | Task started | Runtime V2 lane-runner execution |
| 2026-04-07 02:11 | Step 0 started | Preflight |
| 2026-04-07 02:26 | Review R001 | plan Step 1: APPROVE |
