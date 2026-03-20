# TP-034: Quality Gate Structured Review — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 11
**Iteration:** 6
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read task completion flow
- [x] Read review agent spawn pattern
- [x] Read roadmap Phase 5 sections
- [x] (R001) Record preflight findings with file/line anchors in Notes section
- [x] (R001) Record risk/compatibility notes from roadmap Phase 5 in Notes section
- [x] (R001) Clean up duplicate execution log rows
- [x] (R002) Revert TP-026 STATUS.md changes from this branch scope
- [x] (R002) Add Tier-2 context read evidence (CONTEXT.md takeaways) to Notes

---

### Step 1: Define Configuration & Verdict Schema
**Status:** ✅ Complete
- [x] Add QualityGateConfig interface to config-schema.ts and wire into TaskRunnerSection with defaults (enabled: false, reviewModel: "", maxReviewCycles: 2, maxFixCycles: 1, passThreshold: "no_critical")
- [x] Add quality_gate mapping to toTaskConfig() adapter in config-loader.ts and TaskConfig interface in task-runner.ts
- [x] Create quality-gate.ts with ReviewVerdict, ReviewFinding, StatusReconciliation interfaces and PassThreshold type
- [x] Add verdict evaluation logic: applyVerdictRules() implementing critical/important/status_mismatch rules
- [x] Add parseVerdict() with fail-open behavior for malformed/missing JSON
- [x] Add config-loader test coverage for quality gate defaults and adapter mapping

---

### Step 2: Implement Structured Review
**Status:** ✅ Complete
- [x] Add `runQualityGate()` function in quality-gate.ts: generates review prompt with evidence (PROMPT.md, STATUS.md, git diff, file list), instructs agent to write `REVIEW_VERDICT.json` to task folder
- [x] Add `doQualityGateReview()` in task-runner.ts: spawns review agent (using quality_gate.review_model with fallback chain), reads/parses REVIEW_VERDICT.json, applies verdict rules with configured pass_threshold
- [x] Integrate quality gate into executeTask(): after all steps complete, if quality_gate.enabled, call quality gate before .DONE; if disabled, keep existing .DONE path unchanged
- [x] Handle all fail-open paths: missing verdict file, agent crash/non-zero exit, malformed JSON → synthetic PASS so task is never blocked by gate bugs
- [x] (R006) Fix prompt verdict rules to be threshold-aware: generate rules from passThreshold instead of hardcoded "3+ important => NEEDS_FIXES" that conflicts with `no_critical` threshold runtime logic
- [x] (R006) Fix buildGitDiff() to compute robust diff range (merge-base with main or bounded fallback) instead of hardcoded HEAD~20

---

### Step 3: Remediation Cycle
**Status:** ✅ Complete
- [x] Add `generateFeedbackMd()` to quality-gate.ts: deterministic template with cycle number, blocking findings (critical+important only), concrete remediation actions; file is intentionally staged (aligns with 5e artifact scope)
- [x] Add `buildFixAgentPrompt()` to quality-gate.ts: generates prompt instructing fix agent to address REVIEW_FEEDBACK.md findings in same worktree
- [x] Implement remediation loop in task-runner.ts: write REVIEW_FEEDBACK.md, spawn fix agent (reusing worker spawn pattern), re-run doQualityGateReview after fix completes; replace the current Step 3 placeholder break
- [x] Handle fix-agent abnormal exits deterministically: crash/non-zero/timeout consumes fix budget, logs reason, proceeds to next review cycle (or fails if budget exhausted); no ambiguous looping
- [x] On max cycles exhaustion: persist blocking findings summary (critical+important items + cycle count) into STATUS.md execution log and set error state
- [x] Log per-cycle remediation outcomes in STATUS.md execution log for operator visibility (fix attempt, review rerun result, terminal reason)
- [x] (R008) Make generateFeedbackMd() threshold-aware: include suggestion findings in REVIEW_FEEDBACK.md when passThreshold is `all_clear`, and include suggestion counts in terminal failure summaries
- [x] (R008) Add explicit wall-clock timeout handling for fix agent: kill agent on timeout, return non-zero exit code to consume fix budget deterministically
- [x] (R008) Update terminal failure findings summary to include suggestion counts when threshold is `all_clear`

---

### Step 4: Testing & Verification
**Status:** ✅ Complete
- [x] Fail-open coverage: reviewer non-zero exit, reviewer crash, missing/unreadable verdict file each produce synthetic PASS
- [x] Disabled behavior test: quality gate disabled → .DONE created normally (no gate logic runs)
- [x] PASS verdict test: quality gate enabled, PASS verdict → .DONE created with quality gate metadata
- [x] NEEDS_FIXES remediation test: NEEDS_FIXES triggers feedback generation and fix cycle
- [x] Max cycles exhaustion test: cycles exhausted → task error state, .DONE NOT created, findings summary in log
- [x] Fix-agent timeout/crash/non-zero tests: each consumes fix budget deterministically
- [x] Verdict rules tests: threshold matrix covering no_critical, no_important, all_clear (suggestions blocking)
- [x] generateFeedbackMd threshold-aware tests: suggestions included under all_clear, excluded otherwise
- [x] Full test suite passes: `cd extensions && npx vitest run` zero failures
- [x] (R010) Remove duplicated test blocks (4.x-7.x after section 10.x, lines 1304-1759) and remove unused FEEDBACK_FILENAME import
- [x] (R010) Add integration-level tests: composed gate decision logic with .DONE file I/O assertions — PASS creates .DONE, NEEDS_FIXES leaves .DONE absent, cycle/budget progression determinism, fail-open on missing verdict after fix crash
- [x] (R010) Full test suite passes after changes: `cd extensions && npx vitest run` zero failures

---

### Step 5: Documentation & Delivery
**Status:** 🟨 In Progress
- [x] Add `quality_gate` / `qualityGate` section to `docs/reference/configuration/task-runner.yaml.md`: field table with defaults, YAML→JSON key mappings, section mapping, and example JSON snippet
- [x] Update `docs/explanation/execution-model.md` to describe opt-in quality gate between step completion and .DONE creation
- [x] Assess `docs/reference/status-format.md` — no changes needed: REVIEW_VERDICT.json and REVIEW_FEEDBACK.md are task-folder artifacts (like .DONE), not STATUS.md fields; quality gate logs to existing execution log table, adds no new STATUS.md sections or header fields
- [x] Final doc/code consistency check: defaults, threshold semantics, fail-open match implementation (fixed no_important doc to say "fewer than 3 important" matching code; added status_mismatch note)
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | APPROVE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R004 | code | Step 1 | APPROVE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | APPROVE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | REVISE | .reviews/R010-code-step4.md |
| R010 | code | Step 4 | REVISE | .reviews/R010-code-step4.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-20 00:20 | Task started | Extension-driven execution |
| 2026-03-20 00:20 | Step 0 started | Preflight |
| 2026-03-20 00:21 | Review R001 | plan Step 0: REVISE |
| 2026-03-20 00:24 | Worker iter 1 | done in 174s, ctx: 18%, tools: 31 |
| 2026-03-20 00:25 | Worker iter 1 | done in 205s, ctx: 21%, tools: 41 |
| 2026-03-20 00:26 | Review R002 | code Step 0: REVISE |
| 2026-03-20 | R002 revisions applied | Reverted TP-026 scope leak, added Tier-2 context evidence |
| 2026-03-20 | Step 0 complete | Preflight done, ready for Step 1 |
| 2026-03-20 00:27 | Review R002 | code Step 0: REVISE |
| 2026-03-20 00:28 | Worker iter 1 | done in 123s, ctx: 11%, tools: 25 |
| 2026-03-20 00:28 | Step 0 complete | Preflight |
| 2026-03-20 00:28 | Step 1 started | Define Quality Gate Configuration & Verdict Schema |
| 2026-03-20 00:29 | Worker iter 1 | done in 133s, ctx: 12%, tools: 26 |
| 2026-03-20 00:29 | Step 0 complete | Preflight |
| 2026-03-20 00:29 | Step 1 started | Define Quality Gate Configuration & Verdict Schema |
| 2026-03-20 00:30 | Review R003 | plan Step 1: REVISE |
| 2026-03-20 00:30 | Review R003 | plan Step 1: REVISE |
| 2026-03-20 | Step 1 complete | Config schema, adapter, quality-gate.ts, verdict logic, tests all done |
| 2026-03-20 00:37 | Worker iter 2 | done in 410s, ctx: 23%, tools: 53 |
| 2026-03-20 00:39 | Worker iter 2 | done in 558s, ctx: 37%, tools: 57 |
| 2026-03-20 00:40 | Review R004 | code Step 1: APPROVE |
| 2026-03-20 00:40 | Step 1 complete | Define Quality Gate Configuration & Verdict Schema |
| 2026-03-20 00:40 | Step 2 started | Implement Structured Review |
| 2026-03-20 00:42 | Review R005 | plan Step 2: REVISE |
| 2026-03-20 00:43 | Review R004 | code Step 1: APPROVE |
| 2026-03-20 00:43 | Step 1 complete | Define Quality Gate Configuration & Verdict Schema |
| 2026-03-20 00:43 | Step 2 started | Implement Structured Review |
| 2026-03-20 00:45 | Review R005 | plan Step 2: APPROVE |
| 2026-03-20 | Step 2 complete | doQualityGateReview(), executeTask() integration, fail-open paths all verified |
| 2026-03-20 00:48 | Worker iter 3 | done in 191s, ctx: 20%, tools: 35 |
| 2026-03-20 00:51 | Worker iter 3 | done in 561s, ctx: 28%, tools: 49 |
| 2026-03-20 00:51 | Review R006 | code Step 2: REVISE |
| 2026-03-20 00:54 | Review R006 | code Step 2: REVISE |
| 2026-03-20 00:55 | Worker iter 3 | done in 61s, ctx: 13%, tools: 12 |
| 2026-03-20 00:55 | Step 2 complete | Implement Structured Review |
| 2026-03-20 00:55 | Step 3 started | Remediation Cycle |
| 2026-03-20 00:58 | Review R007 | plan Step 3: REVISE |
| 2026-03-20 00:58 | Worker iter 3 | done in 369s, ctx: 22%, tools: 40 |
| 2026-03-20 00:58 | Step 2 complete | Implement Structured Review |
| 2026-03-20 00:58 | Step 3 started | Remediation Cycle |
| 2026-03-20 | Step 3 complete | Remediation cycle: generateFeedbackMd, buildFixAgentPrompt, doQualityGateFixAgent, full loop with deterministic failure handling |
| 2026-03-20 00:59 | Review R007 | plan Step 3: REVISE |
| 2026-03-20 01:04 | Worker iter 4 | done in 370s, ctx: 25%, tools: 34 |
| 2026-03-20 01:04 | Worker iter 4 | done in 292s, ctx: 26%, tools: 40 |
| 2026-03-20 01:07 | Review R008 | code Step 3: REVISE |
| 2026-03-20 01:09 | Review R008 | code Step 3: REVISE |
| 2026-03-20 01:14 | Worker iter 4 | done in 395s, ctx: 28%, tools: 39 |
| 2026-03-20 01:14 | Step 3 complete | Remediation Cycle |
| 2026-03-20 01:14 | Step 4 started | Testing & Verification |
| 2026-03-20 01:15 | Worker iter 4 | done in 389s, ctx: 33%, tools: 46 |
| 2026-03-20 01:15 | Step 3 complete | Remediation Cycle |
| 2026-03-20 01:15 | Step 4 started | Testing & Verification |
| 2026-03-20 01:16 | Review R009 | plan Step 4: REVISE |
| 2026-03-20 | Step 4 complete | 69 quality-gate tests (4.x fail-open, 5.x feedbackMd, 6.x fixPrompt, 7.x threshold matrix), 1229/1229 full suite pass |
| 2026-03-20 01:17 | Review R009 | plan Step 4: REVISE |
| 2026-03-20 01:24 | Worker iter 5 | done in 442s, ctx: 28%, tools: 41 |
| 2026-03-20 01:25 | Worker iter 5 | done in 443s, ctx: 32%, tools: 30 |
| 2026-03-20 01:29 | Review R010 | code Step 4: REVISE |
| 2026-03-20 01:30 | Review R010 | code Step 4: REVISE |
| 2026-03-20 | R010 revisions applied | Removed duplicated tests (already done), added 11.x composed gate flow integration tests (9 tests), 111 quality-gate tests pass, 1261/1261 full suite pass |
| 2026-03-20 | Step 4 complete | Testing & Verification |
| 2026-03-20 01:39 | Worker iter 5 | done in 597s, ctx: 37%, tools: 58 |
| 2026-03-20 01:39 | Step 4 complete | Testing & Verification |
| 2026-03-20 01:39 | Step 5 started | Documentation & Delivery |
| 2026-03-20 01:40 | Worker iter 5 | done in 598s, ctx: 31%, tools: 67 |
| 2026-03-20 01:40 | Step 4 complete | Testing & Verification |
| 2026-03-20 01:40 | Step 5 started | Documentation & Delivery |
| 2026-03-20 01:42 | Review R011 | plan Step 5: REVISE |
| 2026-03-20 01:42 | Review R011 | plan Step 5: REVISE |

## Blockers

*None*

## Notes

### Preflight Findings

**1. .DONE creation point:** `task-runner.ts:1897-1898` — after all steps complete, `writeFileSync(donePath, ...)` creates `.DONE`. Quality gate must intercept **before** this line. The code path is inside `executeTask()` at the `// All done` comment block.

**2. Reviewer spawn pattern:** `task-runner.ts:2321-2398` — `doReview()` function handles both subprocess and tmux modes. Uses `spawnAgent()`/`spawnAgentTmux()`, reads structured output from file. Existing reviewer uses markdown output with `extractVerdict()` (line 951) parsing `### Verdict: APPROVE|REVISE|RETHINK`. Quality gate will need a different parser for JSON verdicts.

**3. Config adapter chain:** `config-schema.ts` → `config-loader.ts:toTaskConfig()` (line 803) → `TaskConfig` interface (task-runner.ts:39). Quality gate config must be added to: (a) `TaskRunnerSection` in config-schema.ts, (b) `toTaskConfig()` adapter, (c) `TaskConfig` interface in task-runner.ts, (d) defaults in both locations.

**4. Config naming convention:** `config-schema.ts` uses camelCase interfaces (e.g., `workerContextWindow`), `TaskConfig` in task-runner.ts uses snake_case (e.g., `worker_context_window`). Quality gate config should follow both: `qualityGate` in schema, `quality_gate` in TaskConfig.

**5. Fail-open behavior:** Roadmap 5a specifies malformed/missing verdict → PASS (fail-open). This prevents quality gate bugs from blocking task completion.

**6. Verdict rules (from roadmap 5a):** Any critical → NEEDS_FIXES. 3+ important → NEEDS_FIXES. Only suggestions → PASS. Any status_mismatch → NEEDS_FIXES.

**7. Remediation budget:** Max 2 review cycles (initial + after fix). No infinite loops. Config fields: `max_review_cycles: 2`, `max_fix_cycles: 1`.

**8. Artifact staging scope (5e):** REVIEW_VERDICT.json should be staged in post-task commits when quality gate is enabled.

### Tier-2 Context Read (taskplane-tasks/CONTEXT.md)

- **Config files:** `.pi/task-runner.yaml` and `.pi/task-orchestrator.yaml` are the config paths listed in CONTEXT.md. Quality gate config additions must align with the `config-schema.ts` → `config-loader.ts` → `TaskConfig` adapter chain (as detailed in Preflight Finding #3 above).
- **Extensions live in `extensions/taskplane/`:** New `quality-gate.ts` module belongs here, consistent with existing module layout (discovery.ts, waves.ts, execution.ts, etc.).
- **Tests live in `extensions/tests/`:** New `quality-gate.test.ts` follows the established pattern.
- **Tech debt items:** Two existing items noted (worktree naming docs, intermittent test failure). Neither affects this task, but the intermittent test failure should be watched when running full suite in Step 4.

### Risk / Compatibility Notes (from Roadmap Phase 5)

- **Backward compatibility:** `quality_gate.enabled` defaults to `false`. When disabled, zero code path changes — .DONE is created immediately as today. No existing behavior affected.
- **Fail-open is critical:** If the review agent crashes, times out, or produces invalid JSON, task must still complete (PASS). This prevents infrastructure issues from blocking all tasks.
- **Config shape must match existing patterns:** The `TaskRunnerSection` interface in config-schema.ts uses flat sections (e.g., `worker`, `reviewer`, `context`). Adding `qualityGate` follows the same pattern. The `toTaskConfig()` adapter must map `qualityGate` → `quality_gate` (snake_case) for the task-runner's internal `TaskConfig`.
- **No .DONE delete/recreate:** `.DONE` is only created after PASS. The gate runs *before* creation, not after. No deletion needed.
- **Cost/latency concern:** Each quality gate review adds an LLM call with full git diff context. The `pass_threshold` config lets operators control sensitivity.
