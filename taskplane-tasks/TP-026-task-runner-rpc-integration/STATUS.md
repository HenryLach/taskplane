# TP-026: Task-Runner RPC Wrapper Integration — Status

**Current Step:** Step 2: Read Sidecar Telemetry During Polling
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 5
**Iteration:** 3
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
**Status:** 🟨 In Progress

- [ ] Implement sidecar JSONL tailing helper (incremental byte-offset reads, partial-line handling, malformed-line resilience)
- [ ] Integrate tailing into tmux poll loop: on each 2s tick, read new sidecar lines and update state (tokens, cost, context%, tool calls, retries)
- [ ] Derive workerContextPct from message_end usage.totalTokens against config.context.worker_context_window (parity with subprocess mode)
- [ ] Expose retry telemetry: add retry tracking fields to TaskState and lane-state payload so dashboard can consume them
- [ ] Handle missing/empty sidecar gracefully (file not yet created, empty reads, partial trailing lines)

---

### Step 3: Produce Structured Exit Diagnostic
**Status:** ⬜ Not Started

- [ ] Read exit summary JSON after session exit
- [ ] Call classifyExit() and populate TaskExitDiagnostic
- [ ] Add exitDiagnostic additively to batch state task record
- [ ] Clean up or preserve telemetry files

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Test rpc-wrapper command generation
- [ ] Test sidecar tailing and accumulation
- [ ] Test exit summary reading and classification
- [ ] Test crash scenario (missing summary)
- [ ] Test workspace mode paths
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Inline comments updated
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
| 2026-03-19 22:52 | Review R005 | plan Step 2: REVISE |

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
