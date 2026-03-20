# TP-032: Verification Baseline & Fingerprinting — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read merge flow and verification execution
- [x] Read roadmap Phase 4 section 4a
- [x] Understand vitest output format

---

### Step 1: Verification Command Runner & Fingerprint Parser
**Status:** ⬜ Not Started
- [ ] Create verification.ts module
- [ ] Implement runVerificationCommands()
- [ ] Implement parseTestOutput() with vitest adapter
- [ ] Implement diffFingerprints()

---

### Step 2: Baseline Capture & Comparison in Merge Flow
**Status:** ⬜ Not Started
- [ ] Capture baseline pre-merge per repo
- [ ] Capture post-merge fingerprints
- [ ] Compute new failures diff
- [ ] Block on new failures, pass on pre-existing only
- [ ] Flaky handling: re-run once

---

### Step 3: Configuration & Modes
**Status:** ⬜ Not Started
- [ ] Add verification config section
- [ ] Strict/permissive mode behavior
- [ ] Feature flag (disabled by default)

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Fingerprint parser tests
- [ ] Diff algorithm tests
- [ ] Pre-existing vs new failure tests
- [ ] Flaky handling tests
- [ ] Mode behavior tests
- [ ] Workspace mode tests
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Config reference docs updated
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| merge.ts verification is simple ran/passed/output - no fingerprinting | In scope (Step 1-2) | extensions/taskplane/merge.ts |
| config-schema.ts has TestingConfig.commands and MergeConfig.verify but no verification section | In scope (Step 3) | extensions/taskplane/config-schema.ts |
| Vitest JSON reporter outputs testResults[].assertionResults[] with fullName/status/failureMessages | In scope (Step 1) | vitest docs |
| mergeWave() already creates isolated merge worktree - baseline capture hooks in before/after merge | In scope (Step 2) | extensions/taskplane/merge.ts |

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-20 04:08 | Task started | Extension-driven execution |
| 2026-03-20 04:08 | Step 0 started | Preflight |
| 2026-03-20 04:08 | Task started | Extension-driven execution |
| 2026-03-20 04:08 | Step 0 started | Preflight |
| 2026-03-20 04:10 | Review R001 | plan Step 0: APPROVE |
| 2026-03-20 04:12 | Review R001 | plan Step 0: REVISE |

## Blockers

*None*

## Notes

*Reserved for execution notes*
