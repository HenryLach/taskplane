# TP-032: Verification Baseline & Fingerprinting — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** 🟨 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 11
**Iteration:** 6
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
**Status:** ✅ Complete
- [x] Create verification.ts with typed interfaces and exports: VerificationCommand, CommandResult, TestFingerprint, VerificationBaseline, FingerprintDiff
- [x] Implement runVerificationCommands(): execute commands with repo-scoped cwd, stable commandId from config key, capture exitCode/stdout/stderr, error classification (spawn_error, timeout, nonzero_exit)
- [x] Implement parseTestOutput(): vitest JSON adapter extracting file/case/kind/messageNorm; fallback parser for non-JSON/malformed/non-test commands emitting command_error fingerprints; normalization: ANSI strip, whitespace collapse, path separator normalize, duration/timestamp removal
- [x] Implement diffFingerprints(baseline, postMerge): set-based equality on composite key (commandId+file+case+kind+messageNorm), dedup before subtraction, return new failures only
- [x] R003: Design notes added documenting runner contract, fingerprint equality key, and error-path behaviors
- [x] R004-1: Fix parseVitestOutput to handle suite-level failures (testResults[].status==="failed" with empty assertionResults) — emit runtime_error fingerprints from testResults[].message; ensure parseTestOutput falls back to command_error when exitCode!==0 and vitest returns empty fingerprints
- [x] R004-2: Fix duplicate R003 review row in STATUS.md

---

### Step 2: Baseline Capture & Comparison in Merge Flow
**Status:** ✅ Complete
- [x] R005-1: Decouple orchestrator-side baseline verification from merge-agent verification (merge-agent verify remains for agent-side revert logic; orchestrator-side baseline diff gates merge advancement separately)
- [x] R005-2: Implement orchestrator-side baseline capture/post-merge/diff in mergeWave() with persistence to `.pi/verification/{opId}/` and per-repo naming
- [x] R005-3: Implement flaky re-run (failed commands only, once) with classification: verification_new_failure blocks lane, flaky_suspected is warning-only
- [x] R005-4: Add decision note in STATUS.md documenting verification command source and integration architecture
- [x] R006-1: Fix baseline artifact naming to include repo attribution in workspace mode (include repoId in filename to prevent overwrites when mergeWave() called per repo group)
- [x] R006-2: Fix rollback failure on verification_new_failure — treat reset failure as merge-fatal (set laneResult.error, gate target-branch advancement on successful rollback)
- [x] R006-3: Mark verification_new_failure lanes as failed in laneResult (set laneResult.error, exclude from success counters in anySuccess/mergedCount/branch-cleanup paths in engine.ts and resume.ts)

---

### Step 3: Configuration & Modes
**Status:** ✅ Complete
- [x] R007-1: Add VerificationConfig interface to config-schema.ts, defaults in DEFAULT_ORCHESTRATOR_SECTION, YAML→unified mapping in config-loader.ts (mapOrchestratorYaml), legacy adapter in toOrchestratorConfig, and legacy type in types.ts OrchestratorConfig
- [x] R007-2: Wire verification.enabled as explicit feature flag — gating in merge.ts/engine.ts/resume.ts so that testing_commands presence alone does not enable fingerprinting; only `enabled: true` triggers it. Wire flakyReruns (including 0 = no reruns) through runPostMergeVerification
- [x] R007-3: Implement strict/permissive mode behavior for baseline unavailable — strict: set failedLane + error (merge failure policy applies), permissive: log warning, continue without baseline. Precedence: verification.mode gates baseline-unavailable handling; failure.on_merge_failure gates how the resulting merge failure is handled (pause vs abort)
- [x] R007-4: Add Step 3 decision note documenting precedence between verification.mode and failure.on_merge_failure, and behavior when enabled but commands empty
- [x] R008-1: Add config-loader regression tests for verification section — defaults, YAML→camelCase mapping, toOrchestratorConfig() snake_case round-trip in project-config-loader.test.ts
- [x] R008-2: Add merge-flow tests for verification mode behavior — (a) enabled+strict+no commands → merge failure, (b) enabled+permissive+no commands → continues, (c) enabled=false → no baseline capture, (d) flakyReruns=0 → no rerun attempt

---

### Step 4: Testing & Verification
**Status:** ✅ Complete
- [x] R009-1: Parser edge cases — suite-level vitest failures (no assertionResults), non-zero exit with empty parsed output → command_error fallback
- [x] R009-2: Rollback/advancement safety — (a) successful rollback on verification_new_failure, (b) rollback failure / no preLaneHead blocks ALL advancement, (c) engine.ts + resume.ts counting + cleanup parity (exclude lr.error lanes)
- [x] R009-3: Workspace mode artifact naming — per-repo repoId suffix prevents filename collisions
- [x] Diff algorithm + pre-existing vs new failure tests (including deduplication, fixed detection)
- [x] Flaky handling tests (flakyReruns=0 immediate block, cleared re-run → flaky_suspected)
- [x] Mode behavior tests (strict/permissive on missing baseline and no-commands)
- [x] Full test suite passes (`cd extensions && npx vitest run`)

---

### Step 5: Documentation & Delivery
**Status:** 🟨 In Progress
- [x] Update task-orchestrator.yaml.md: add `verification` section to schema overview, field table, key mapping table, section mapping table, and JSON example
- [x] Check commands.md for merge output changes — no change needed: verification baseline fingerprinting is internal to the merge flow, gated by config; no command syntax, arguments, or documented output format changes
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | APPROVE | .reviews/R010-code-step4.md |
| R010 | code | Step 4 | APPROVE | .reviews/R010-code-step4.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |

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
| 2026-03-20 04:18 | Worker iter 1 | done in 261s, ctx: 28%, tools: 47 |
| 2026-03-20 04:18 | Step 0 complete | Preflight |
| 2026-03-20 04:18 | Step 1 started | Verification Command Runner & Fingerprint Parser |
| 2026-03-20 04:20 | Review R003 | plan Step 1: REVISE |
| 2026-03-20 04:21 | Review R003 | plan Step 1: REVISE |
| 2026-03-20 04:24 | Worker iter 2 | done in 193s, ctx: 20%, tools: 29 |
| 2026-03-20 04:25 | Worker iter 1 | done in 318s, ctx: 23%, tools: 42 |
| 2026-03-20 04:28 | Review R004 | code Step 1: REVISE |
| 2026-03-20 04:29 | Review R004 | code Step 1: REVISE |
| 2026-03-20 04:30 | Worker iter 2 | done in 133s, ctx: 15%, tools: 19 |
| 2026-03-20 04:30 | Step 1 complete | Verification Command Runner & Fingerprint Parser |
| 2026-03-20 04:30 | Step 2 started | Baseline Capture & Comparison in Merge Flow |
| 2026-03-20 04:30 | Worker iter 1 | done in 55s, ctx: 12%, tools: 8 |
| 2026-03-20 04:30 | Step 1 complete | Verification Command Runner & Fingerprint Parser |
| 2026-03-20 04:30 | Step 2 started | Baseline Capture & Comparison in Merge Flow |
| 2026-03-20 04:33 | Review R005 | plan Step 2: REVISE |
| 2026-03-20 04:33 | Review R005 | plan Step 2: REVISE |
| 2026-03-20 04:44 | Worker iter 2 | done in 670s, ctx: 47%, tools: 102 |
| 2026-03-20 04:45 | Worker iter 3 | done in 702s, ctx: 55%, tools: 90 |
| 2026-03-20 04:50 | Review R006 | code Step 2: REVISE |
| 2026-03-20 04:51 | Review R006 | code Step 2: REVISE |
| 2026-03-20 04:58 | Worker iter 2 | done in 516s, ctx: 28%, tools: 63 |
| 2026-03-20 04:58 | Step 2 complete | Baseline Capture & Comparison in Merge Flow |
| 2026-03-20 04:58 | Step 3 started | Configuration & Modes |
| 2026-03-20 04:59 | Worker iter 3 | done in 511s, ctx: 35%, tools: 76 |
| 2026-03-20 04:59 | Step 2 complete | Baseline Capture & Comparison in Merge Flow |
| 2026-03-20 04:59 | Step 3 started | Configuration & Modes |
| 2026-03-20 05:02 | Review R007 | plan Step 3: REVISE |
| 2026-03-20 05:03 | Review R007 | plan Step 3: REVISE |
| 2026-03-20 05:11 | Worker iter 3 | done in 560s, ctx: 35%, tools: 66 |
| 2026-03-20 05:11 | Worker iter 4 | done in 539s, ctx: 38%, tools: 67 |
| 2026-03-20 05:15 | Review R008 | code Step 3: REVISE |
| 2026-03-20 05:16 | Review R008 | code Step 3: REVISE |
| 2026-03-20 05:23 | Worker iter 4 | done in 451s, ctx: 36%, tools: 46 |
| 2026-03-20 05:23 | Step 3 complete | Configuration & Modes |
| 2026-03-20 05:23 | Step 4 started | Testing & Verification |
| 2026-03-20 05:25 | Worker iter 3 | done in 491s, ctx: 37%, tools: 54 |
| 2026-03-20 05:25 | Step 3 complete | Configuration & Modes |
| 2026-03-20 05:25 | Step 4 started | Testing & Verification |
| 2026-03-20 05:25 | Review R009 | plan Step 4: REVISE |
| 2026-03-20 05:32 | Step 4 implemented | R009 revisions + full test suite 1534/1534 pass |
| 2026-03-20 05:27 | Review R009 | plan Step 4: REVISE |
| 2026-03-20 05:35 | Worker iter 5 | done in 588s, ctx: 33%, tools: 51 |
| 2026-03-20 05:36 | Worker iter 4 | done in 547s, ctx: 37%, tools: 49 |
| 2026-03-20 05:39 | Review R010 | code Step 4: APPROVE |
| 2026-03-20 05:39 | Step 4 complete | Testing & Verification |
| 2026-03-20 05:39 | Step 5 started | Documentation & Delivery |
| 2026-03-20 05:40 | Review R010 | code Step 4: APPROVE |
| 2026-03-20 05:40 | Step 4 complete | Testing & Verification |
| 2026-03-20 05:40 | Step 5 started | Documentation & Delivery |
| 2026-03-20 05:41 | Review R011 | plan Step 5: REVISE |
| 2026-03-20 05:42 | Review R011 | plan Step 5: REVISE |
| 2026-03-20 05:43 | Worker iter 5 | error (code 3221225786) in 53s, ctx: 16%, tools: 9 |

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

### Step 1 Design Notes (R003 response)

**Runner Result Schema (`CommandResult`):**
```ts
interface CommandResult {
  commandId: string;    // Stable key from config (e.g., "test", "build") — matches testing.commands key
  command: string;      // Raw command string
  cwd: string;          // Repo-scoped working directory (merge worktree root or repo subdir)
  exitCode: number;     // Process exit code (-1 for spawn failure)
  stdout: string;       // Captured stdout
  stderr: string;       // Captured stderr
  durationMs: number;   // Execution time
  error?: string;       // Error classification: "spawn_error" | "timeout" | "nonzero_exit"
}
```
- `commandId` is deterministic — derived from the config key in `testing.commands` (e.g., `{ test: "npx vitest run" }` → commandId = `"test"`).
- Same `commandId` is used for baseline and post-merge runs, ensuring diff alignment.
- `cwd` is the merge worktree path (for single-repo) or `join(mergeWorktree, repoSubdir)` for workspace repos.

**Fingerprint Composite Key:**
`(commandId, file, case, kind, messageNorm)` — all five fields must match for two fingerprints to be considered equal.

**Normalization Rules (`messageNorm`):**
1. Strip ANSI escape sequences (`/\x1B\[[0-9;]*[a-zA-Z]/g`)
2. Normalize path separators (`\\` → `/`)
3. Collapse whitespace (runs of spaces/tabs → single space, trim)
4. Remove duration strings (e.g., `(42ms)`, `(1.2s)`)
5. Remove timestamps (ISO-8601 patterns)
6. Lowercase for comparison stability

**Parser Adapters:**
- **vitest JSON adapter:** Parses `testResults[].assertionResults[]`. Maps `status==="failed"` entries to fingerprints with `kind="assertion_error"`, `file` from `testFilePath`, `case` from `fullName`, `messageNorm` from first `failureMessages[]` entry after normalization.
- **Fallback parser:** For non-JSON output, malformed JSON, empty output, or non-test commands. Emits a single fingerprint: `{ commandId, file: "<command>", case: "<exit>", kind: "command_error", messageNorm: <normalized stderr or stdout> }`.

**Error-Path Behaviors:**
- Spawn failure (command not found): `CommandResult.error = "spawn_error"`, `exitCode = -1`. Fallback parser emits `command_error` fingerprint.
- Timeout: `CommandResult.error = "timeout"`, process killed. Fallback parser emits fingerprint.
- Malformed JSON: vitest adapter falls through to fallback parser.
- Empty output: Fallback parser emits fingerprint with empty `messageNorm`.

**Exported Types from `verification.ts`:** `VerificationCommand`, `CommandResult`, `TestFingerprint`, `VerificationBaseline`, `FingerprintDiff`, `runVerificationCommands()`, `parseTestOutput()`, `diffFingerprints()`.

### Step 2 Decision Notes (R005 response)

**Verification Command Source:**
The orchestrator-side baseline system uses `testing.commands` (`Record<string, string>` — named keys like `{ test: "npx vitest run" }`) from the task runner config section. This is distinct from `merge.verify` (a `string[]` passed to the merge agent). The merge agent's own verification (via `merge.verify`) continues independently — it handles agent-side revert-on-failure logic. The orchestrator-side baseline comparison is a separate layer that gates merge advancement.

**Integration Architecture:**
1. **Two-layer verification**: Merge-agent runs `merge.verify` commands and may revert on failure (existing behavior, untouched). Orchestrator captures baseline/post-merge fingerprints using `testing.commands` and gates advancement based on diff results.
2. **Timing**: Baseline is captured once per `mergeWave()` call on the merge worktree before any lane merges. Post-merge capture happens after each successful lane merge (SUCCESS/CONFLICT_RESOLVED). If the merge agent already failed the lane (BUILD_FAILURE/CONFLICT_UNRESOLVED), orchestrator-side verification is skipped for that lane.
3. **Commands source threading**: `testing.commands` is passed as an optional `Record<string, string>` parameter to `mergeWave()` / `mergeWaveByRepo()`. When empty or undefined, baseline fingerprinting is skipped entirely (opt-in, matches the disabled-by-default requirement). The engine.ts caller sources this from the config.
4. **Flaky re-run**: When new failures are detected, only the failed commands (not all commands) are re-run once. If the failure disappears on re-run, the lane is classified as `flaky_suspected` (warning-only, does not block). If the failure persists, the lane is classified as `verification_new_failure` (blocks merge advancement).
5. **Persistence**: Baseline/post-merge artifacts are written to `.pi/verification/{opId}/baseline-b{batchId}-w{waveIndex}.json` and `.pi/verification/{opId}/post-b{batchId}-w{waveIndex}-lane{laneNumber}.json`. In workspace mode, repoId is appended: `baseline-b{batchId}-w{waveIndex}-{repoId}.json`.
6. **Failure propagation**: `verification_new_failure` sets `failedLane` and `failureReason` in the merge loop, same as BUILD_FAILURE. The lane result's `verificationBaseline` field carries the detailed diff. Downstream failure policy (engine.ts `computeMergeFailurePolicy`) handles it identically to any other merge failure.

### Step 3 Decision Notes (R007 response)

**Config Precedence & Feature Flag:**
Verification baseline fingerprinting runs **only** when BOTH conditions are met:
1. `orchestrator.verification.enabled === true` (feature flag, default: false)
2. `taskRunner.testing.commands` has at least one command configured

If `enabled` is false, no baseline capture or comparison occurs regardless of commands being configured. This is the explicit opt-in gate.

**Strict vs Permissive Mode (`verification.mode`):**
Controls behavior when baseline is **unavailable** (capture failure or missing commands):
- **strict**: Baseline-unavailable triggers an immediate merge failure (`MergeWaveResult.status = "failed"` with diagnostic `failureReason`). The downstream `failure.onMergeFailure` policy then determines whether the batch pauses or aborts — strict mode does NOT bypass that policy.
- **permissive** (default): Baseline-unavailable logs a warning and continues without orchestrator-side verification. Merge-agent verification (`merge.verify`) still applies independently.

Two specific scenarios handled:
1. **Enabled but no commands**: strict → immediate merge failure; permissive → warning, skip verification
2. **Baseline capture throws**: strict → immediate merge failure; permissive → warning, set baseline=null, continue

**Flaky Re-runs (`verification.flakyReruns`):**
- `flakyReruns: 0` → disabled. Any new failure immediately blocks (no re-run).
- `flakyReruns: 1` (default) → re-run failed commands once. If failures clear → `flaky_suspected` (warning). If persist → `verification_new_failure` (blocks).
- `flakyReruns: N > 1` → up to N re-runs; break early if failures clear on any attempt.

**YAML ↔ JSON Key Mapping:**
- YAML: `verification.flaky_reruns` (snake_case)
- JSON: `orchestrator.verification.flakyReruns` (camelCase)
- Legacy adapter: `config.verification.flaky_reruns` (snake_case in OrchestratorConfig type)
- `convertStructuralKeys()` handles YAML→unified mapping automatically.
