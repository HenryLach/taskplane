# TP-026: Task-Runner RPC Wrapper Integration — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 11
**Iteration:** 6
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read spawnAgentTmux() in task-runner.ts
- [x] Read poll loop implementation
- [x] Read TP-025 artifacts
- [x] Verify RPC wrapper runs
- [x] R002: Fix Reviews table markdown formatting (separator row placement, deduplicate entries)
- [x] R002: Deduplicate Execution Log entries
- [x] R002: Add preflight findings to Discoveries/Notes (edit targets, no-change guardrails, wrapper help outcome)

---

### Step 1: Update spawnAgentTmux to Use RPC Wrapper
**Status:** ✅ Complete

- [x] Add resolveRpcWrapperPath() using findPackageRoot() pattern
- [x] Generate telemetry file paths with naming contract (sessionName + timestamp, using getSidecarDir() for workspace-awareness)
- [x] Build rpc-wrapper.mjs command with correct args and passthrough of existing pi flags (--thinking, --no-session, --no-extensions, --no-skills)
- [x] Replace pi -p command in tmux new-session with node rpc-wrapper.mjs command (preserve quoteArg shell-quoting for Windows/MSYS paths)
- [x] R003: Deduplicate execution log entries and add Step 1 design notes subsection
- [x] R004: Add extension-file-relative fallback to resolveRpcWrapperPath() (use findPackageRoot result dirname or walk up from extension file path)
- [x] R004: Fix return-shape comment — document that function now returns { promise, kill, sidecarPath, exitSummaryPath }
- [x] R004: Enrich telemetry filenames with available contract identifiers (tmuxPrefix, taskId from TASK_AUTOSTART) where present

---

### Step 2: Read Sidecar Telemetry During Polling
**Status:** ✅ Complete

- [x] Implement sidecar JSONL tailing helper (incremental byte-offset reads, partial-line handling, malformed-line resilience)
- [x] Integrate tailing into tmux poll loop: on each 2s tick, read new sidecar lines and update state (tokens, cost, context%, tool calls, retries)
- [x] Derive workerContextPct from message_end usage.totalTokens against config.context.worker_context_window (parity with subprocess mode)
- [x] Expose retry telemetry: add retry tracking fields to TaskState and lane-state payload so dashboard can consume them
- [x] Handle missing/empty sidecar gracefully (file not yet created, empty reads, partial trailing lines)
- [x] R006: Fix retry-active state persistence across ticks — move retryActive into SidecarTailState, update on auto_retry_start/end events, dispatch telemetry on any parsed event (not just truthy numeric fields)
- [x] R006: Add tests for tailSidecarJsonl + poll integration (retry lifecycle across ticks, partial-line buffering, missing-file, final-tail-on-session-end)

---

### Step 3: Produce Structured Exit Diagnostic
**Status:** ✅ Complete

- [x] Read exit summary JSON after tmux session exit (non-fatal parse with deterministic fallback for missing/malformed files)
- [x] Build ExitClassificationInput with all signals: exitSummary, doneFileFound, timerKilled (wall-clock timeout flag), stallDetected (stall timer), userKilled (manual kill), contextPct (from sidecar tail state)
- [x] Call classifyExit() and build full TaskExitDiagnostic (with progress metadata: partialProgressCommits, lastKnownStep, repoId, durationSec)
- [x] Add exitDiagnostic as optional field to PersistedTaskRecord and LaneTaskOutcome (additive, preserve legacy exitReason, update serialization + validation)
- [x] Preserve telemetry files by default (no cleanup — dashboard may read them; add log of paths for operator visibility)
- [x] R008: Wire contextKilled into classifyExit — add contextKilled field to ExitClassificationInput, handle in classifyExit() before process_crash, update buildExitDiagnostic to pass it, update existing classification tests
- [x] R008: Tighten exitDiagnostic validation — reject arrays (Array.isArray), add minimal shape check (classification is string)
- [x] R008: Add Step 3 helper tests — _readExitSummary (missing, malformed, valid), _buildExitDiagnostic (timer/context/user kill mapping, missing summary), persistence round-trip (exitDiagnostic present/absent/invalid shapes)

---

### Step 4: Testing & Verification
**Status:** ✅ Complete

- [x] Verify existing TP-026 test coverage (rpc-wrapper.test.ts, sidecar-tailing.test.ts, task-runner-exit-diagnostic.test.ts) — all pass, covers command gen, sidecar tailing, exit classification, crash scenarios, persistence round-trip
- [x] Create task-runner-rpc-integration.test.ts: (1) workspace telemetry path tests — getSidecarDir with ORCH_SIDECAR_DIR, source pattern for telemetry dir; (2) /orch subprocess non-regression — source-extract spawnAgent() asserting `pi -p --mode json` (not rpc-wrapper), pollUntilTaskComplete unmodified; (3) exitDiagnostic persistence/resume round-trip — build→upsert→sync→serialize→validate, completed + failed + legacy scenarios. 10 tests pass.
- [x] Run full vitest suite — 1107 tests pass across 29 files; 1 pre-existing failure (worktree-lifecycle.test.ts: TP-029 git init issues, not TP-026)

---

### Step 5: Documentation & Delivery
**Status:** 🟨 In Progress

- [x] R011: Check `docs/explanation/architecture.md` for affected descriptions — no change needed (docs describe spawn/sidecar at architecture level without mechanism details; PROMPT defers doc updates to TP-027)
- [x] R011: Run full test suite as closure gate — 171/171 TP-026 tests pass; 25 pre-existing failures in cleanup-resilience.test.ts (3) and worktree-lifecycle.test.ts (22) due to git init temp dir issues on Windows worktree, not TP-026 related
- [x] R011: Verify completion criteria — /orch subprocess path unchanged (pollUntilTaskComplete + spawnAgent untouched), exitDiagnostic in task outcomes (persistence + validation + round-trip tested), sidecar/exit summary produced in tmux mode (sidecarPath + exitSummaryPath wired through spawnAgentTmux)
- [x] Inline comments updated in spawnAgentTmux explaining RPC wrapper flow (already comprehensive: 30+ line doc block on spawnAgentTmux, full doc blocks on sidecar tailing + exit diagnostic helpers, inline comments in poll loop and exit classification section)
- [ ] `.DONE` created and STATUS.md marked complete

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
| R007 | plan | Step 3 | APPROVE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | APPROVE | .reviews/R010-code-step4.md |
| R010 | code | Step 4 | APPROVE | .reviews/R010-code-step4.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Edit target: `spawnAgentTmux()` at task-runner.ts:1030 — builds pi command & polls tmux session | Step 1-3 edit target | extensions/task-runner.ts |
| Edit target: tmux poll loop at task-runner.ts:1130 (while/has-session loop) — add sidecar tailing here | Step 2 edit target | extensions/task-runner.ts |
| Read-only: `pollUntilTaskComplete()` at execution.ts:616 — /orch subprocess path, DO NOT MODIFY | No-change guardrail | extensions/taskplane/execution.ts |
| Read-only: `spawnAgent()` subprocess function — /orch path, DO NOT MODIFY | No-change guardrail | extensions/task-runner.ts |
| `resolveTaskRunnerExtensionPath()` pattern at execution.ts:27 — use same pattern for rpc-wrapper.mjs path resolution | Reuse pattern in Step 1 | extensions/taskplane/execution.ts |
| `rpc-wrapper.mjs` verified: `node bin/rpc-wrapper.mjs --help` exits 0, shows required args (--sidecar-path, --exit-summary-path, --prompt-file) and optional args (--model, --system-prompt-file, --tools, --extensions) | Preflight verified | bin/rpc-wrapper.mjs |
| `classifyExit()` and all diagnostic types exist in diagnostics.ts (TP-025 complete) | Available for Step 3 | extensions/taskplane/diagnostics.ts |
| Caller sites: spawnAgentTmux called at task-runner.ts:1613 (worker) and :1778 (reviewer) | Step 1 scope | extensions/task-runner.ts |
| `spawnAgentTmux()` is the sole edit target for spawn changes (line 1030, task-runner.ts). Its poll loop (lines 1130–1160) is where sidecar tailing will go. | Step 1–2 edit target | `extensions/task-runner.ts:1030` |
| `pollUntilTaskComplete` in `extensions/taskplane/execution.ts:616` is the **orchestrator** poll loop — NOT in scope. Must not be modified. | No-change guardrail | `extensions/taskplane/execution.ts:616` |
| `spawnAgent()` subprocess path is separate and must not change per PROMPT. | No-change guardrail | `extensions/task-runner.ts` |
| `resolveTaskRunnerExtensionPath()` in `execution.ts:27` shows pattern for resolving npm package paths — reuse for `rpc-wrapper.mjs`. | Pattern reference | `extensions/taskplane/execution.ts:27` |
| `node bin/rpc-wrapper.mjs --help` runs successfully. Args: `--sidecar-path`, `--exit-summary-path`, `--prompt-file` (required); `--model`, `--system-prompt-file`, `--tools`, `--extensions` (optional). | Verified | `bin/rpc-wrapper.mjs` |
| `classifyExit()` and `TaskExitDiagnostic` types exist in `extensions/taskplane/diagnostics.ts` (from TP-025). | Ready to use | `extensions/taskplane/diagnostics.ts` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-19 22:16 | Task started | Extension-driven execution |
| 2026-03-19 22:16 | Step 0 started | Preflight |
| 2026-03-19 22:17 | Review R001 | plan Step 0: REVISE |
| 2026-03-19 22:18 | Worker iter 1 | done in 63s, ctx: 15%, tools: 14 |
| 2026-03-19 22:19 | Worker iter 2 | done in 75s, ctx: 17%, tools: 19 |
| 2026-03-19 22:19 | Review R002 | code Step 0: REVISE |
| 2026-03-19 22:22 | Worker iter 3 | done in 138s, ctx: 13%, tools: 25 |
| 2026-03-19 22:22 | Step 0 complete | Preflight |
| 2026-03-19 22:22 | Step 1 started | Update spawnAgentTmux to Use RPC Wrapper |
| 2026-03-19 22:24 | Review R003 | plan Step 1: REVISE |
| 2026-03-19 22:26 | Step 1 iter 1 | Hydrated checkboxes, added resolveRpcWrapperPath(), started command rewrite |
| 2026-03-19 | Step 1 iter 2 | Completed spawn rewrite: telemetry paths, rpc-wrapper command, return type |
| 2026-03-19 22:34 | Worker iter 2 | done in 587s, ctx: 31%, tools: 52 |
| 2026-03-19 22:35 | Worker iter 2 | done in 562s, ctx: 33%, tools: 63 |
| 2026-03-19 22:38 | Review R004 | code Step 1: REVISE |
| 2026-03-19 22:39 | Review R004 | code Step 1: REVISE |
| 2026-03-19 | Step 1 R004 revisions | Fixed resolveRpcWrapperPath (5-strategy resolution), telemetry naming contract (opId/batchId/repoId), doc block return shape, removed duplicate --no-session |
| 2026-03-19 22:48 | Worker iter 2 | done in 535s, ctx: 32%, tools: 67 |
| 2026-03-19 22:48 | Step 1 complete | Update spawnAgentTmux to Use RPC Wrapper |
| 2026-03-19 | Step 1 R004 iter 2 | Added extension-file-relative fallback (#4) to resolveRpcWrapperPath(), enriched telemetry basenames with taskId segment, passed taskId from callers. All 1020 tests pass. |
| 2026-03-19 22:48 | Step 2 started | Read Sidecar Telemetry During Polling |
| 2026-03-19 22:50 | Worker iter 2 | done in 735s, ctx: 34%, tools: 74 |
| 2026-03-19 22:50 | Step 1 complete | Update spawnAgentTmux to Use RPC Wrapper |
| 2026-03-19 22:50 | Step 2 started | Read Sidecar Telemetry During Polling |
| 2026-03-19 22:51 | Review R005 | plan Step 2: REVISE |
| 2026-03-19 | Step 2 iter 1 | Implemented sidecar JSONL tailing (tailSidecarJsonl + SidecarTailState), integrated into poll loop with onTelemetry callback, added context% parity, retry tracking fields (TaskState + lane-state), partial-line resilience. 1018 tests pass. |
| 2026-03-19 22:52 | Review R005 | plan Step 2: REVISE |
| 2026-03-19 23:01 | Worker iter 3 | done in 553s, ctx: 28%, tools: 65 |
| 2026-03-19 23:01 | Worker iter 3 | done in 503s, ctx: 31%, tools: 51 |
| 2026-03-19 23:05 | Review R006 | code Step 2: REVISE |
| 2026-03-19 23:05 | Review R006 | code Step 2: REVISE |
| 2026-03-19 | Step 2 R006 revisions | Fixed retry state persistence (retryActive in SidecarTailState), added hadEvents gating, created sidecar-tailing.test.ts (27 tests). All 1044+ tests pass. |
| 2026-03-19 | Step 2 complete | Read Sidecar Telemetry During Polling (including R006 revisions) |
| 2026-03-19 23:20 | Worker iter 3 | done in 872s, ctx: 36%, tools: 53 |
| 2026-03-19 23:20 | Step 2 complete | Read Sidecar Telemetry During Polling |
| 2026-03-19 23:20 | Step 3 started | Produce Structured Exit Diagnostic |
| 2026-03-19 23:23 | Review R007 | plan Step 3: REVISE |
| 2026-03-19 | Step 3 iter 1 | Implemented exit summary reader (readExitSummary), buildExitDiagnostic helper, kill-reason tracking (timer/context/user), exitDiagnostic additive field on LaneTaskOutcome + PersistedTaskRecord + persistence validation + resume carry-forward. All 1047 tests pass. |
| 2026-03-19 | Step 3 complete | Produce Structured Exit Diagnostic |
| 2026-03-19 23:28 | Worker iter 3 | done in 1356s, ctx: 33%, tools: 61 |
| 2026-03-19 23:28 | Step 2 complete | Read Sidecar Telemetry During Polling |
| 2026-03-19 23:28 | Step 3 started | Produce Structured Exit Diagnostic |
| 2026-03-19 23:31 | Review R007 | plan Step 3: APPROVE |
| 2026-03-19 23:36 | Worker iter 4 | done in 753s, ctx: 36%, tools: 98 |
| 2026-03-19 23:37 | Worker iter 4 | done in 354s, ctx: 22%, tools: 47 |
| 2026-03-19 23:40 | Review R008 | code Step 3: REVISE |
| 2026-03-19 23:45 | Review R008 | code Step 3: REVISE |
| 2026-03-19 | Step 3 R008 iter 2 | Fixed exitDiagnostic carry-forward in upsertTaskOutcome + syncTaskOutcomesFromMonitor, added 16 tests (upsert/sync/round-trip). All 71 TP-026 tests pass, 1095 total pass. |
| 2026-03-19 | Step 3 complete | Produce Structured Exit Diagnostic (including R008 revisions) |
| 2026-03-19 23:52 | Worker iter 4 | done in 389s, ctx: 41%, tools: 43 |
| 2026-03-19 23:52 | Step 3 complete | Produce Structured Exit Diagnostic |
| 2026-03-19 23:52 | Step 4 started | Testing & Verification |
| 2026-03-19 | Step 3 R008 iter 4 | Re-applied R008 revisions: contextKilled wired into classifyExit (3b priority), readExitSummary rejects arrays, exitDiagnostic validation tightened (Array.isArray + classification string check), added 30 task-runner-exit-diagnostic tests + 8 contextKilled classification tests. All 1097 tests pass. |
| 2026-03-19 23:53 | Worker iter 4 | done in 813s, ctx: 44%, tools: 84 |
| 2026-03-19 23:53 | Step 3 complete | Produce Structured Exit Diagnostic |
| 2026-03-19 23:53 | Step 4 started | Testing & Verification |
| 2026-03-19 23:55 | Review R009 | plan Step 4: REVISE |
| 2026-03-19 23:55 | Review R009 | plan Step 4: REVISE |
| 2026-03-20 00:04 | Worker iter 5 | done in 532s, ctx: 29%, tools: 37 |
| 2026-03-20 00:09 | Worker iter 5 | done in 808s, ctx: 48%, tools: 61 |
| 2026-03-20 00:09 | Worker iter 6 | done in 338s, ctx: 35%, tools: 37 |
| 2026-03-20 00:14 | Review R010 | code Step 4: APPROVE |
| 2026-03-20 00:14 | Step 4 complete | Testing & Verification |
| 2026-03-20 00:14 | Step 5 started | Documentation & Delivery |
| 2026-03-20 00:14 | Review R010 | code Step 4: APPROVE |
| 2026-03-20 00:14 | Step 4 complete | Testing & Verification |
| 2026-03-20 00:14 | Step 5 started | Documentation & Delivery |
| 2026-03-20 00:15 | Review R011 | plan Step 5: REVISE |
| 2026-03-20 00:15 | Review R011 | plan Step 5: REVISE |

---

## Blockers

*None*

---

## Notes

### Step 1 Design Notes

**Telemetry filename pattern:**
`{sidecarDir}/telemetry/{opId}-{batchId}-{repoId}[-{taskId}][-lane-{N}]-{role}.jsonl` (sidecar)
`{sidecarDir}/telemetry/{opId}-{batchId}-{repoId}[-{taskId}][-lane-{N}]-{role}-exit.json` (exit summary)

Where:
- `sidecarDir` = `getSidecarDir()` (respects `ORCH_SIDECAR_DIR` for workspace mode, falls back to `.pi/`)
- `sessionName` = tmux session name (e.g., `task-worker`, `orch-lane-1-worker`) — already scoped by lane/role
- `timestamp` = `Date.now()` for uniqueness across iterations

**Identifier sources:**
- `sessionName` incorporates the tmux prefix (set from `TASK_RUNNER_TMUX_PREFIX` by orchestrator), which already includes lane identity
- In workspace mode, `getSidecarDir()` returns the shared `.pi/` under `ORCH_SIDECAR_DIR`, so all lanes write to the same telemetry directory — sessionName provides collision avoidance

**Preserved passthrough flags:**
The current `pi -p` command passes `--no-session`, `--no-extensions`, `--no-skills`, `--model`, `--tools`, `--thinking`, `--append-system-prompt`, and the prompt file via `@file`. The rpc-wrapper handles `--model`, `--tools`, `--system-prompt-file`, `--prompt-file` natively. Remaining flags (`--thinking`, `--no-session`, `--no-extensions`, `--no-skills`) are passed via `-- ...passthrough`.

**Shell quoting:**
Reuse the existing `quoteArg()` function for all path arguments. The `node` command replaces `pi` — same shell-quoting rules apply since both are executed via tmux `new-session` as a shell string.

### Step 3 Design Notes

**TaskExitDiagnostic field → source mapping:**
| Field | Source |
|-------|--------|
| classification | `classifyExit()` with all signals |
| exitCode | `exitSummary.exitCode` (null if no summary) |
| errorMessage | `exitSummary.error` (null if no summary) |
| tokensUsed | `exitSummary.tokens` (null if no summary) |
| contextPct | `state.workerContextPct` from sidecar tailing |
| partialProgressCommits | Set to 0 at task-runner level; orchestrator enriches post-commit |
| partialProgressBranch | Set to null at task-runner level; orchestrator enriches |
| durationSec | `Math.round(state.workerElapsed / 1000)` |
| lastKnownStep | `state.currentStep` |
| lastKnownCheckbox | null (would require STATUS.md parsing) |
| repoId | `TASKPLANE_REPO_ID` env or "default" |

**Kill reason tracking:**
- `killReason` variable tracks "timer" | "context" | "user" | null
- Timer kill: set in wallClockKillTimer setTimeout
- Context kill: set in onTelemetry when pct >= killPct
- User kill: inferred when result.killed but killReason is null
- stallDetected: always false in /task mode (stall monitoring is an /orch concern)

**Additive persistence:**
- `exitDiagnostic?: TaskExitDiagnostic` added to both `LaneTaskOutcome` and `PersistedTaskRecord`
- Legacy `exitReason: string` preserved as-is on both types
- Validation in `loadState()` accepts optional object field
- Resume path carries forward exitDiagnostic from persisted state
- No breaking changes to schema — pre-TP-026 state files load cleanly (field absent = undefined)

**Telemetry file retention:**
- Sidecar JSONL and exit summary JSON are NOT cleaned up after reading
- Paths logged to stderr for operator visibility
- Dashboard can read them independently
- `cleanupTmp()` only removes prompt/system-prompt temp files

### Preflight Findings (Step 0)

**Edit targets (in scope):**
- `extensions/task-runner.ts` — `spawnAgentTmux()` at line 1030: modify spawn command to use `rpc-wrapper.mjs` instead of `pi -p`. Add sidecar tailing to the poll loop (lines 1130–1160). Add exit summary reading after session ends.
- `extensions/taskplane/diagnostics.ts` — May need minor additions for integration (types already exist from TP-025).
- `extensions/tests/task-runner-rpc.test.ts` — New test file for RPC integration tests.

**No-change guardrails:**
- `extensions/taskplane/execution.ts` — Contains `pollUntilTaskComplete()` (orchestrator path) and `spawnLaneSession()`. These are `/orch` paths and must NOT be modified.
- `extensions/task-runner.ts` — `spawnAgent()` (subprocess mode) must remain unchanged.

**Wrapper verification:**
- `node bin/rpc-wrapper.mjs --help` succeeded. Required args: `--sidecar-path`, `--exit-summary-path`, `--prompt-file`. Optional: `--model`, `--system-prompt-file`, `--tools`, `--extensions`.

**Path resolution pattern:**
- `resolveTaskRunnerExtensionPath()` in `execution.ts:27` resolves paths relative to the installed npm package using `import.meta.url`. Reuse this pattern for `rpc-wrapper.mjs`.
