# TP-032: Verification Baseline & Fingerprinting — Status

**Current Step:** Step 1: Verification Command Runner & Fingerprint Parser
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read merge flow and verification execution
- [x] Read roadmap Phase 4 section 4a
- [x] Understand vitest output format
- [x] R002-1: Read CONTEXT.md and verify TP-030 dependency; add insertion-point findings
- [x] R002-2: Fix reviews table (header/separator order, deduplicate R001, remove contradictory verdicts)
- [x] R002-3: Deduplicate execution log entries
- [x] R002-4: Revert unrelated TP-031 STATUS.md edits

---

### Step 1: Verification Command Runner & Fingerprint Parser
**Status:** 🟨 In Progress
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
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| merge.ts verification is simple ran/passed/output - no fingerprinting | In scope (Step 1-2) | extensions/taskplane/merge.ts |
| config-schema.ts has TestingConfig.commands and MergeConfig.verify but no verification section | In scope (Step 3) | extensions/taskplane/config-schema.ts |
| Vitest JSON reporter outputs testResults[].assertionResults[] with fullName/status/failureMessages | In scope (Step 1) | vitest docs |
| mergeWave() already creates isolated merge worktree - baseline capture hooks in before/after merge | In scope (Step 2) | extensions/taskplane/merge.ts |
| CONTEXT.md reviewed: default task area, key files mapped. No blockers for TP-032. | Preflight complete | taskplane-tasks/CONTEXT.md |
| TP-030 dependency satisfied: v3 schema complete with resilience/diagnostics sections, .DONE exists | Preflight complete | taskplane-tasks/TP-030-state-schema-v3-migration/ |
| Roadmap 4a defines fingerprint shape: {commandId, file, case, kind, messageNorm} | In scope (Step 1) | docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md L559-592 |
| Roadmap 4a config: verification.enabled (default false), mode (strict/permissive), flaky_reruns (1) | In scope (Step 3) | docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md L841-844 |

## Insertion Points

| Target | File | Line/Location | Notes |
|--------|------|---------------|-------|
| Baseline capture (pre-merge) | merge.ts | Before `for (const lane of orderedLanes)` loop (~L683) | Run verification commands on merge worktree pre-merge state |
| Post-merge fingerprint capture | merge.ts | After merge result SUCCESS/CONFLICT_RESOLVED (~L762) | Capture fingerprints, diff against baseline |
| New failure blocking | merge.ts | Between result recording and `break` on failure (~L779) | Block merge if newFailures > 0, classify as verification_new_failure |
| Config: verification section | config-schema.ts | New `VerificationConfig` interface + add to `OrchestratorSection` | enabled, mode, flakyReruns fields |
| Config defaults | config-schema.ts | `DEFAULT_ORCHESTRATOR_SECTION` (~L470+) | verification: { enabled: false, mode: "strict", flakyReruns: 1 } |
| buildMergeRequest verify cmds | merge.ts | `buildMergeRequest()` (~L197) | Currently uses config.merge.verify — baseline system uses testing.commands instead |
| mergeWaveByRepo per-repo baseline | merge.ts | `mergeWaveByRepo()` (~L1053) | Per-repo baseline capture/comparison for workspace mode |

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-20 04:08 | Task started | Extension-driven execution |
| 2026-03-20 04:08 | Step 0 started | Preflight |
| 2026-03-20 04:12 | Review R001 | plan Step 0: REVISE |
| 2026-03-20 04:12 | Worker iter 1 | done in 113s, ctx: 33%, tools: 21 |
| 2026-03-20 04:14 | Review R002 | code Step 0: REVISE |
| 2026-03-20 04:17 | Worker iter 0 | done in 210s, ctx: 23%, tools: 41 |
| 2026-03-20 04:17 | Step 0 complete | Preflight |
| 2026-03-20 04:17 | Step 1 started | Verification Command Runner & Fingerprint Parser |

## Blockers

*None*

## Notes

### Preflight Findings (Step 0)

**TP-030 dependency:** Satisfied. `.DONE` exists in `taskplane-tasks/TP-030-state-schema-v3-migration/`. v3 state schema includes `PersistedMergeResult` (types.ts:1506) with `mergeResults` array in `BatchStateV3` (types.ts:1608) — verification data can be stored alongside merge results.

**Current verification flow:**
- `merge.ts:buildMergeRequest()` (L197-232) passes `config.merge.verify` commands to the merge agent template
- Merge agent runs commands in the merge worktree and writes result as `verification: { ran, passed, output }` (types.ts:1014-1020)
- `merge.ts:parseMergeResult()` (L34-117) normalizes flat/nested verification fields
- `BUILD_FAILURE` status (merge.ts:774-779) blocks merge when verification fails — but has no baseline comparison

**Key insertion points:**
1. **Baseline capture:** Before lane merge loop in `mergeWave()` (~L683) — run verification commands on pre-merge state in the merge worktree
2. **Post-merge comparison:** After `SUCCESS`/`CONFLICT_RESOLVED` result (~L762) — capture post-merge fingerprints, diff against baseline
3. **Workspace per-repo:** `mergeWaveByRepo()` (~L1053) iterates repo groups; baseline capture per group via `resolveRepoRoot()`
4. **Config plumbing:** `config-schema.ts` needs `VerificationConfig` interface; `config-loader.ts` needs loading/defaults; `types.ts` needs no changes (reuses existing MergeVerification shape)

**Vitest JSON output shape:** `testResults[].assertionResults[]` with fields: `fullName`, `status` ("passed"/"failed"), `failureMessages[]`. Maps to fingerprint shape `{commandId, file, case, kind, messageNorm}`.

**Merge agent template:** `templates/agents/task-merger.md` (L71-88) contains verification step instructions. Baseline fingerprinting runs orchestrator-side (in merge.ts), NOT in the merge agent — this is a separate layer.
