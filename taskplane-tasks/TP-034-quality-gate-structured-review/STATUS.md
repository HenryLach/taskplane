# TP-034: Quality Gate Structured Review — Status

**Current Step:** Step 1: Define Quality Gate Configuration & Verdict Schema
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
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
**Status:** 🟨 In Progress
- [ ] Add QualityGateConfig interface to config-schema.ts and wire into TaskRunnerSection with defaults (enabled: false, reviewModel: "", maxReviewCycles: 2, maxFixCycles: 1, passThreshold: "no_critical")
- [ ] Add quality_gate mapping to toTaskConfig() adapter in config-loader.ts and TaskConfig interface in task-runner.ts
- [ ] Create quality-gate.ts with ReviewVerdict, ReviewFinding, StatusReconciliation interfaces and PassThreshold type
- [ ] Add verdict evaluation logic: applyVerdictRules() implementing critical/important/status_mismatch rules
- [ ] Add parseVerdict() with fail-open behavior for malformed/missing JSON
- [ ] Add config-loader test coverage for quality gate defaults and adapter mapping

---

### Step 2: Implement Structured Review
**Status:** ⬜ Not Started
- [ ] Spawn review agent after steps complete, before .DONE
- [ ] Build review evidence package
- [ ] Parse verdict JSON
- [ ] Apply verdict rules
- [ ] PASS → .DONE, NEEDS_FIXES → remediation

---

### Step 3: Remediation Cycle
**Status:** ⬜ Not Started
- [ ] Write REVIEW_FEEDBACK.md
- [ ] Spawn fix agent
- [ ] Re-run review after fix
- [ ] Max cycles exhaustion → fail
- [ ] .DONE only after PASS

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Disabled behavior test
- [ ] PASS verdict test
- [ ] NEEDS_FIXES remediation test
- [ ] Max cycles exhaustion test
- [ ] Malformed verdict fail-open test
- [ ] Verdict rules tests
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Config docs updated
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
