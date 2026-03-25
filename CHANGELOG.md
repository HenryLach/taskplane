# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.14.1] - 2026-03-25

### Fixed
- **Merge message says "into develop" (#201)** — now shows the actual orch branch name.
- **Dashboard merge agents section empty during merge (#202)** — session filter updated to match `orch-{operatorId}-merge-{N}` naming pattern. Telemetry lookups also fixed.
- **Two pre-existing test failures (#193)** — `supervisor-merge-monitoring.test.ts` tests 9.3 and 10.5 updated to match current implementation.

## [0.14.0] - 2026-03-25

### New
- **Supervisor template pattern (TP-058, #135)** — the supervisor agent now follows the same composable template pattern as workers, reviewers, and mergers. Base template (`templates/agents/supervisor.md`) ships with npm and auto-updates. Local override (`.pi/agents/supervisor.md`) enables project-specific customization without editing extension source.
- **Routing template** — `templates/agents/supervisor-routing.md` for onboarding/no-batch mode.
- **Init copies supervisor template** — `taskplane init` now creates `.pi/agents/supervisor.md` alongside other agent templates.

### Changed
- `buildSupervisorSystemPrompt()` and `buildRoutingSystemPrompt()` load templates with `{{placeholder}}` variable injection instead of inline string construction. Falls back to inline prompt when templates are missing.

## [0.13.0] - 2026-03-24

### New
- **Persistent reviewer context (TP-057, #146)** — one reviewer per task instead of per review. The reviewer stays alive across all `review_step` calls via a `wait_for_review` blocking tool, maintaining full context about the task and previous reviews. ~50-60% reduction in reviewer token cost. Falls back to fresh spawn if the persistent reviewer crashes or hits the context limit.
- **New file: `extensions/reviewer-extension.ts`** — registers the `wait_for_review` tool for persistent reviewer mode. Signal protocol uses numbered files (`.review-signal-{NNN}`) for request coordination and `.review-shutdown` for clean exit.

### Changed
- **Reviewer template updated** — supports both persistent mode (with `wait_for_review` tool) and fallback fresh-spawn mode. Cross-step awareness: reviewer references previous findings when reviewing later steps.

## [0.12.0] - 2026-03-24

### New
- **Supervisor merge monitoring (TP-056, #145)** — the supervisor actively monitors merge agent health during the merge phase. Detects dead sessions (tmux died, no result file) within 2-3 minutes instead of waiting for the 90-minute timeout. Escalation tiers: healthy → possibly stalled (10 min) → dead → stuck (20 min). 763 new tests.

### Fixed
- **Stale retrying badge (#189)** — the dashboard telemetry accumulator never cleared `retryActive` when a retry resolved via `message_end`. Stale retry state from previous batches persisted, causing a permanently flashing "retrying" badge. Server-side fix: clear `retryActive` on every successful `message_end`.

## [0.11.0] - 2026-03-24

### New
- **`/task` deprecation (TP-054, #164)** — `/task`, `/task-status`, `/task-pause`, `/task-resume` now show deprecation warnings recommending `/orch`. Commands still work (soft deprecation). Docs updated.
- **Runtime model fallback (TP-055, #134)** — when a configured agent model becomes unavailable mid-batch (rate limit, API key expired, model deprecated), tasks fall back to the session model instead of failing. Configurable via `modelFallback: "inherit"` (default) or `"fail"`. New `model_access_error` exit classification. 509 new tests.

## [0.10.2] - 2026-03-24

### Fixed
- **Dashboard rendering crash** — PR #175 introduced a TDZ (Temporal Dead Zone) crash: `reviewerActive` used before its `const` declaration. Dashboard showed empty lanes section.

## [0.10.1] - 2026-03-24

### Fixed
- **macOS path resolution (#177)** — workers crashed immediately on Homebrew/nvm npm installs because `rpc-wrapper.mjs` and `task-runner.ts` couldn't be found. Resolution now uses `npm root -g` as the primary dynamic lookup, covering all npm setups. Added `/opt/homebrew` static fallback.

## [0.10.0] - 2026-03-24

### New
- **Supervisor orchestrator tools (TP-053)** — the supervisor agent can now invoke `orch_resume`, `orch_integrate`, `orch_pause`, `orch_abort`, and `orch_status` as extension tools. No more asking the user to type slash commands — the supervisor acts autonomously.
- **Shared command/tool helpers** — orchestrator command logic extracted into shared internal functions called by both slash commands and tools. Ensures behavior parity.

### Fixed
- **Retrying badge during reviews (#174)** — dashboard no longer shows a flashing "retrying" badge during `review_step` tool calls.

### Docs
- **execution-model.md** — rewritten for persistent-context + worker-driven inline reviews.
- **review-loop.md** — rewritten for `review_step` tool model.
- **README.md** — updated key features, single-task guidance, architecture description.

## [0.9.3] - 2026-03-24

### Fixed
- **State persistence log spam (issue #166)** — `endTime` for completed/failed tasks was set to `lastPollTime` on every poll tick, causing `changed=true` → persist → log every few seconds. Now freezes once set. Eliminates the `[orch] state/...: persisted: task-transition` flood in the supervisor session.
- **Reviewer sub-row scoped to active task** — reviewer activity row in the dashboard now only appears under the task being reviewed, not under all tasks in the lane.

## [0.9.2] - 2026-03-24

### Fixed
- **Stale branches after integrate (TP-051, issue #142)** — `/orch-integrate` now deletes `task/*` and `saved/task/*` branches from the integrated batch. Also cleans orphaned branches from previous batches. Preserves `orch/*` in PR mode and partial-progress `saved/*` refs.
- **Task startedAt timing (TP-051, issue #19)** — task start times now use actual execution timestamps instead of STATUS.md file mtime. Fixes incorrect timing in dashboard and batch history.

### New
- **Integrate guidance after batch completion (TP-052, issue #99)** — clear, prominent message shows exact `/orch-integrate` and `--pr` commands after every batch completion. Appears in engine output and supervisor routing.
- **Branch protection detection (TP-052, issue #100)** — `/orch-integrate` checks for branch protection via `gh api` before attempting merge. Warns and suggests `--pr` when protection detected. Graceful degradation when `gh` unavailable.
- **Post-batch prompt visibility (TP-052, issue #88)** — supervisor sends a clear conversational message when transitioning to routing mode after batch completion, ensuring the user sees an active input prompt.

## [0.9.1] - 2026-03-24

### Fixed
- **Code review baseline** — `review_step` tool now accepts `baseline` parameter so workers pass the pre-step HEAD SHA. Reviewer sees only the step's changes instead of an empty diff.
- **Reviewer model inheritance** — all reviewer model fallbacks changed from hardcoded `openai/gpt-5.3-codex` to session model inheritance. Config default is now empty (triggers inheritance chain).
- **Dead code removed** — `resolveExtensionPath()` and `isWorkerToolMode()` (19 lines, never called).

## [0.9.0] - 2026-03-24

### New
- **Worker-driven inline reviews (TP-050)** — workers now drive the review process via a `review_step` extension tool, preserving their full context across reviews. Reviewers spawn in named tmux sessions with RPC wrapper telemetry. REVISE feedback is addressed inline by the worker in the same context.
- **Dashboard reviewer sub-row** — live reviewer activity (elapsed, tools, last tool, cost, context%) displayed as a sub-row under the worker row during reviews. Dashboard no longer appears frozen during review phases.
- **Review protocol in worker template** — worker agent template includes review level interpretation (0-3), skip rules for low-risk steps, and verdict handling instructions.

### Changed
- **Review architecture** — reviews moved from outer-loop deferred model (post-worker-exit) to worker-driven inline model (mid-execution via tool call). Review level scoring (0-3) still determines which reviews run.
- **Lane-state sidecar** — extended with reviewer metrics: `reviewerSessionName`, `reviewerType`, `reviewerStep`, `reviewerElapsed`, `reviewerContextPct`, `reviewerLastTool`, `reviewerToolCount`, `reviewerCostUsd`, `reviewerInputTokens`, `reviewerOutputTokens`.

## [0.8.2] - 2026-03-24

### Fixed
- **Telemetry temp file leak** — lane prompt files now written to `.pi/telemetry/` instead of system tmpdir, cleaned up with batch artifacts.
- **Telemetry filename accuracy** — `generateTelemetryPaths()` accepts actual `batchId` and `repoId` instead of hardcoding timestamp and "default". Filenames now correlate correctly across agents in a batch.
- **Shared opId resolution** — extracted `resolveTelemOpId()` helper to prevent divergence between lane and merge telemetry naming.
- **Merge agent crash on fresh projects** — `spawnMergeAgent()` now checks `.pi/agents/task-merger.md` existence before passing `--system-prompt-file`. Falls back gracefully when agent definition is missing.

## [0.8.1] - 2026-03-24

### New
- **RPC telemetry for all orchestrator agents (TP-049, issue #139)** — lane workers, merge agents, and reviewers now spawn through the RPC wrapper during `/orch` batches, producing `.pi/telemetry/*.jsonl` sidecar files and exit summaries. The dashboard consumes these for accurate per-agent tokens, cost, context%, and tool call metrics.

## [0.8.0] - 2026-03-23

### New
- **Persistent worker context (TP-048, issue #140)** — workers now spawn once per task instead of once per step. The worker handles all remaining steps in a single context window, committing at each step boundary. If context runs out mid-task, the next iteration picks up from the last completed step. Typical tasks complete in a single iteration.
- **Context window auto-detect (TP-047, issue #140)** — `worker_context_window` is now auto-detected from pi's model registry instead of hardcoded at 200K. Claude 4.6 Opus correctly uses its 1M context window. Explicit config overrides still take precedence.
- **Updated context defaults** — `warn_percent` raised from 70% to 85%, `kill_percent` from 85% to 95%, maximizing useful context utilization.

### Fixed
- **Model pre-flight display** — worker/reviewer models now read from the full unified config (including user preferences), not the stripped orchestrator config. Previously always showed "inherit" regardless of `/settings`.
- **Dashboard NaN heartbeat (issue #129)** — `relativeTime()` now handles ISO string timestamps from the supervisor lockfile.
- **Lockfile batchId stuck (issue #130)** — heartbeat tick refreshes batchId from live batch state when it was initially "(initializing)".
- **Dashboard shows wrong batch (issue #20)** — after batch completion, dashboard now shows the just-finished batch instead of the previous one. Fixed async race between history fetch and view rendering.
- **Onboarding task area registration (issue #138)** — supervisor onboarding script now explicitly requires registering task areas in config, with example JSON and verification step.
- **Merge timeout default** — increased from 10 to 90 minutes to accommodate large batches with tests.

## [0.7.2] - 2026-03-23

### New
- **Model availability pre-flight check** — `/orch` validates all configured agent models (worker, reviewer, merger, supervisor) against the pi model registry before starting a batch. Misconfigured models block with a clear error instead of failing hours into a run.
- **Unified supervisor mode (issue #128)** — routing-mode supervisor can now start batches via `/orch all`. Batch completion transitions back to conversational mode instead of deactivating. Enables continuous workflow: `/orch` → conversation → run tasks → complete → conversation continues.
- **Async merge polling (TP-046, issue #136)** — `waitForMergeResult` converted from synchronous `sleepSync` to async `sleepAsync`. Supervisor, heartbeat, and user input remain responsive during the merge phase.
- **Dashboard wave bar fix (TP-045, issue #101)** — completed wave segments now render green instead of black in the progress bar.

### Fixed
- **Agent model defaults** — removed hardcoded `openai/gpt-5.3-codex` from reviewer template and model-specific comments from local templates. All agents default to inheriting the session model.
- **`resolveConfigRoot` export** — fixed `/orch` crash (`resolveConfigRoot is not a function`) caused by missing re-export from config barrel.
- **Supervisor session cleanup** — extension deactivates supervisor on `session_end` to clean heartbeat/lock in normal shutdown paths.
- **Merge result schema tolerance** — parser accepts `source`/`sourceBranch`/`source_branch` and equivalent variants. Merge request includes explicit JSON schema guidance.

### Docs
- Updated commands reference for unified supervisor mode.

## [0.7.0] - 2026-03-23

### New
- **Resume coherence and merge-retry recovery (TP-037)** — resume now checks wave merge outcomes (not just task `.DONE`) so completed-task waves with missing/failed merges are retried instead of skipped; stale pending-task session allocations are cleared to avoid false failure classification on resume.
- **Merge-timeout resilience (TP-038)** — merge timeout handling now checks for a written result file before killing the session, supports timeout retries with exponential backoff, and re-reads config on retry so updated `merge.timeoutMinutes` is respected without restarting.
- **Tier 0 watchdog integration (TP-039)** — deterministic recovery paths are wired into the engine loop with retry budgets, recovery/exhaustion/escalation event emission, and pause-on-exhaustion behavior for operator visibility.
- **Non-blocking orchestration runtime (TP-040)** — `/orch` and `/orch-resume` now return control immediately while batch execution continues asynchronously; engine lifecycle events are persisted to `.pi/supervisor/events.jsonl` for live supervision and dashboard consumption.
- **Supervisor agent (TP-041)** — added `extensions/taskplane/supervisor.ts` with dynamic supervisor prompt injection, lockfile + heartbeat ownership (`.pi/supervisor/lock.json`), startup takeover recovery, `/orch-takeover`, autonomy-level behavior controls, and structured action audit logging.
- **Universal `/orch` routing and onboarding flows (TP-042)** — `/orch` with no args now routes by detected project state (active batch, pending integration, no config, pending tasks, no tasks) and launches supervisor-led onboarding/returning-user conversational flows.
- **Supervisor-managed integration + batch summaries (TP-043)** — supervised/auto integration modes now run from terminal batch callbacks, detect branch protection, execute PR/CI lifecycle flows, and generate structured supervisor batch summaries.
- **Dashboard supervisor panel (TP-044)** — dashboard now surfaces supervisor status, recovery timelines, event context, conversation stream data (when available), and summary content with graceful degradation for pre-supervisor batches.

### Fixed
- **Merge result schema compatibility hardening** — merge result parsing now tolerates known key variants (`source_branch`/`sourceBranch`/`source`, `target_*`, `merge_commit`/`mergeCommit`) and normalizes verification payload variants to prevent false merge hangs/timeouts when agents produce non-canonical keys.
- **Merger prompt schema precision** — merge request generation now embeds an explicit required snake_case JSON schema to reduce model drift in merge result files.
- **Supervisor shutdown cleanup** — extension now deactivates supervisor on session end to clean heartbeat/lock ownership in normal shutdown paths.
- **Task status artifact reconciliation** — TP-037..TP-044 `STATUS.md` files were reconciled after batch completion so staged task records no longer incorrectly show "Not Started".

### Docs
- Updated architecture, command reference, settings reference, first-run orchestration tutorial, and dashboard tutorial for non-blocking engine + supervisor-led workflows.
- Watchdog/supervisor specification docs were finalized and synchronized ahead of implementation.

### Internal
- Added extensive deterministic regression coverage for resume bugs, timeout resilience, watchdog behavior, non-blocking engine flow, supervisor routing/behavior, auto-integration, and merge-result schema compatibility.
- Test suite expanded to **51 files / 2151 tests** at release cut.

## [0.6.1] - 2026-03-20

### New
- **Skip reviews for low-risk steps (TP-036)** — Step 0 (Preflight) and the final step (Documentation & Delivery) now skip plan and code reviews regardless of review level. Saves ~4 review agent invocations per task (~25-30% faster for M-sized tasks). Middle implementation steps are unaffected.

### Docs
- Supervisor-led onboarding scripts added to watchdog spec — 8 conversational scripts for project setup, task area design, git branching, batch planning, health checks, and post-batch retrospectives.

## [0.6.0] - 2026-03-20

### New
- **RPC wrapper & structured diagnostics (TP-025)** — `bin/rpc-wrapper.mjs` wraps `pi --mode rpc` to capture telemetry from worker/reviewer sessions. `TaskExitDiagnostic` interface with 9-way exit classification (`completed`, `api_error`, `context_overflow`, `process_crash`, etc.). Sidecar JSONL files for real-time telemetry with secret redaction.
- **Task-runner RPC integration (TP-026)** — `spawnAgentTmux()` uses the RPC wrapper for `/task` tmux sessions. Sidecar tailing during poll loop provides live token counts and cost. Structured exit diagnostics replace free-text `exitReason`. `/orch` subprocess path unchanged.
- **Dashboard real-time telemetry (TP-027)** — Dashboard displays per-lane token counts, cost, context utilization %, last tool call, retry status, and batch total cost. Graceful degradation for pre-RPC sessions.
- **Partial progress preservation (TP-028)** — Failed tasks with lane branch commits get saved branches (`saved/{opId}-{taskId}-{batchId}`). Commit count and branch name recorded in task outcome. Works in single-repo and workspace mode.
- **Cleanup resilience & post-merge gate (TP-029)** — Fixes issue #93: lane worktrees and branches cleaned up in ALL workspace repos per wave (not just last-wave repos). Force cleanup fallback (`rm -rf` + `git worktree prune`). Post-merge cleanup gate blocks next wave if cleanup fails. Polyrepo acceptance criteria validated after `/orch-integrate`.
- **State schema v3 & migration (TP-030)** — `batch-state.json` schema v3 with `resilience` (retry counters, repair history, failure classification) and `diagnostics` (per-task exit summaries, batch cost) sections. Auto-migration from v1/v2 with conservative defaults. Corrupt state enters `paused` (never auto-deleted). Unknown fields preserved on roundtrip.
- **Force-resume & diagnostic reports (TP-031)** — `/orch-resume --force` for `failed`/`stopped` phases with pre-resume diagnostics. Merge failure defaults to `paused` (not `failed`). Structured diagnostic reports (JSONL event log + human-readable summary) emitted on batch completion/failure.
- **Verification baseline & fingerprinting (TP-032)** — Pre-merge verification baselines per repo. Normalized test output fingerprinting. `newFailures = postMerge - baseline` — pre-existing failures no longer block valid merges. Flaky test handling (re-run once). Strict/permissive modes. Opt-in via `verification.enabled`.
- **Transactional merge & retry matrix (TP-033)** — Merge transaction envelope (capture pre/post refs, rollback on failure, safe-stop if rollback fails). Retry policy matrix with persisted counters scoped by `(repoId, wave, lane)`. Cooldown delays, max attempts, wave gate on cleanup failure.
- **Quality gate structured review (TP-034)** — Opt-in post-completion quality gate. Cross-model structured review with JSON verdict (PASS/NEEDS_FIXES). Severity-classified findings. `.DONE` only created after PASS when enabled. Remediation cycle (max 2 reviews). Configurable via `quality_gate.enabled`.
- **STATUS.md reconciliation & artifact staging scope (TP-035)** — Automatic STATUS.md checkbox correction from quality gate review findings. Artifact staging restricted to task-owned paths only. System-owned template checkboxes removed.
- **Supervisor primer** — `extensions/taskplane/supervisor-primer.md` ships with npm package. Operational runbook for the future supervisor agent covering architecture, recovery patterns, git operations, and batch state management.

### Fixed
- Reviewer APPROVE threshold raised — REVISE now means "will fail without fixes", not "I found something". Minor findings go to Suggestions (no checkboxes), not Issues Found.
- Worker prompt updated — Issues Found items create mandatory checkboxes, Suggestions logged in Notes only.

### Docs
- `docs/specifications/` — moved from `.pi/local/docs/` to git-tracked location for worktree accessibility
- `docs/explanation/waves-lanes-and-worktrees.md` — comprehensive rewrite covering orch branch model, file-scope affinity, batch-scoped worktrees, per-repo merge, integration flow
- `docs/explanation/architecture.md` — updated for JSON config, orch branch flow
- "Repo mode" renamed to "single-repo mode" across all docs
- Watchdog & recovery tiers specification (v2) — interactive supervisor architecture
- AGENTS.md — added JSON config precedence rule (invariant #6)

## [0.5.3] - 2026-03-18

### Fixed
- **Cross-repo TASK_AUTOSTART path resolution** — workspace mode now uses absolute paths for task PROMPT.md so workers in api-service/web-client worktrees can find tasks that live in shared-libs.

## [0.5.12] - 2026-03-19

### Fixed
- **`.DONE` files missing after `/orch-integrate`** — artifact staging was deleting `.DONE` files from the working tree after copying to the merge worktree. After ff integration, they weren't restored. Now `.DONE` files are preserved in the working tree (the stash in `/orch-integrate` handles them).
- **`.worktrees/` directory excluded from artifact staging** — prevents worktree internals from being committed to the orch branch.
- **Test isolation** — config loader tests no longer break when user preferences override reviewer model.

## [0.5.11] - 2026-03-19

### Fixed
- **`/orch-integrate` blocked by dirty STATUS.md files** — workspace mode preserves STATUS.md in the working tree for dashboard visibility, but these dirty files blocked `git merge --ff-only`. Now auto-stashes before integration and pops after.
- **Batch completion message unclear** — simplified to two options: "Apply now (recommended)" and "Push & open PR for review". Removed `--merge` from default display (shown in ff error fallback). Added "Your branch was not modified" reassurance.

## [0.5.10] - 2026-03-19

### Fixed
- **Dashboard wave progress bar stale** — STATUS.md was reverted in develop's working tree after artifact staging, causing the dashboard to show partial checkbox counts for completed waves. Now only .DONE files are removed; STATUS.md modifications are preserved for dashboard visibility.
- **`/orch-integrate` commit count always 0** — count was measured after fast-forward when HEAD already equals orch tip. Now measured before.

## [0.5.9] - 2026-03-18

### Fixed
- **`/orch-integrate` only integrated default repo** — in workspace mode, now loops over all repos that have the orch branch and integrates each one.

## [0.5.8] - 2026-03-18

### Fixed
- **Task artifacts committed to develop instead of orch branch** — `.DONE` and `STATUS.md` files are now staged into the merge worktree (on the orch branch) instead of committed directly to develop. This prevents branch divergence that blocked `/orch-integrate` fast-forward.

## [0.5.7] - 2026-03-18

### Fixed
- **Orch branch only created in default repo** — workspace mode now creates the orch branch in every repo at batch start. Merges target the orch branch directly instead of the repo's current branch, so `/orch-integrate` has actual commits to apply.

## [0.5.6] - 2026-03-18

### Fixed
- **Dashboard missing merge sub-rows for single-repo waves** — Wave 3 merge showed "succeeded" but no lane details when only one repo was involved. Threshold changed from 2+ to 1+ repo results.

## [0.5.5] - 2026-03-18

### Fixed
- **Workspace task artifacts not committed before merge** — workers wrote `.DONE` and `STATUS.md` to the canonical task folder (shared-libs) via absolute paths, leaving them as uncommitted working tree changes. New `commitWorkspaceTaskArtifacts()` runs after each wave before the merge step, committing task artifacts to the task-area repo so they appear in the orch branch and don't block `/orch-integrate`.

## [0.5.4] - 2026-03-18

### Fixed
- **Task completion not detected in workspace mode** — orchestrator polled for `.DONE` inside lane worktrees, but in workspace mode workers write `.DONE` to the canonical task folder (shared-libs). Now resolves `.DONE` and `STATUS.md` from the absolute task folder path in workspace mode. Also fixes dashboard STATUS.md monitoring for cross-repo tasks.

## [0.5.3] - 2026-03-18

### Fixed
- **Cross-repo TASK_AUTOSTART path resolution** — workspace mode now uses absolute paths for task PROMPT.md so workers in api-service/web-client worktrees can find tasks that live in shared-libs.

## [0.5.2] - 2026-03-18

### Fixed
- **TASKPLANE_WORKSPACE_ROOT not set for lane sessions** — env var condition was always false in workspace mode. Lane sessions couldn't find config, showing "0 areas".

## [0.5.1] - 2026-03-18

### Fixed
- **Lane sessions couldn't find task-runner extension** — lane tmux sessions hardcoded `{repoRoot}/extensions/task-runner.ts` which only exists in the taskplane dev repo. Now searches npm global install paths. This was a critical bug preventing workspace/polyrepo mode from working for any project other than taskplane itself.
- **Batch completion message missing integration instructions** — now shows orch branch name and `/orch-integrate` command options.
- **Batch state deleted on clean completion** — state is now preserved when an orch branch exists so `/orch-integrate` can find it.

## [0.5.0] - 2026-03-18

### Added
- **Orchestrator-managed branch model** (issue #24) — `/orch` now creates an ephemeral `orch/{opId}-{batchId}` branch and does all work there. User's HEAD is never touched during batch execution. VS Code stays on whatever branch the user is working on.
- **`/orch-integrate` command** — integrates completed batch work into your working branch. Three modes: fast-forward (default), `--merge` (real merge), `--pr` (push and open GitHub PR). Includes branch safety check (warns if current branch differs from batch origin).
- **Batch-scoped worktree containers** — worktree paths changed from `{prefix}-{opId}-{N}` to `{basePath}/{opId}-{batchId}/lane-{N}`. Prevents directory collisions between concurrent batches. Merge worktree is inside the container.
- **Auto-integration config** — `integration` setting (`"manual"` default, `"auto"` opt-in). Manual = user runs `/orch-integrate`. Auto = fast-forward on completion.
- **Settings reference doc** — `docs/reference/configuration/taskplane-settings.md` documents every setting with types, defaults, options, and descriptions.
- 86 new tests (828 total across 22 test files), including new `orch-integrate.test.ts`.

### Changed
- Wave merges use `git update-ref` instead of `git merge --ff-only` in the main repo — no longer touches the working tree.
- Stash/pop logic removed from merge flow (no longer needed since orch branch is never checked out in main repo).
- Post-merge worktree reset targets orch branch HEAD instead of user's branch.
- Batch completion message shows orch branch name and `/orch-integrate` instructions.

### Fixed
- **Settings TUI input fields freeze terminal** (issue #57) — replaced inline submenu with single-value cycling pattern that exits TUI, then prompts via `ctx.ui.input()`. Works on all platforms.
- Renamed `/settings` to `/taskplane-settings` to avoid collision with pi's built-in `/settings` command.
- Protected branch blindness — `/orch` on a protected branch no longer wastes hours before failing at merge time.

### Removed
- Orchestrator `spawn_mode` setting removed from `/taskplane-settings` TUI — `/orch` always requires tmux, making the setting misleading. The worker-level Spawn Mode (controls `/task` behavior) remains.




## [0.4.0] - 2026-03-17

### Added
- **`/taskplane-settings` TUI command** — interactive config editor with section navigation, source indicators (project/user/default), type-specific controls, and validation. Primary config interface — users rarely need to edit files directly.
- **JSON config schema** — unified `taskplane-config.json` replaces both YAML files. Unified loader with YAML fallback for backward compatibility.
- **`taskplane init` v2** — auto-detects repo vs workspace mode (no `--workspace` flag needed). Enforces selective gitignore entries. Detects and offers to untrack accidentally committed runtime artifacts. Defaults `spawn_mode` to `"tmux"` when available.
- **Pointer file resolution** — workspace mode uses `taskplane-pointer.json` to locate config, agents, and state in the designated config repo. All subsystems (task-runner, orchestrator, dashboard, merge agent) follow the pointer.
- **User preferences** — `~/.pi/agent/taskplane/preferences.json` for personal settings (operator ID, models, tmux prefix, dashboard port). Merged with project config at load time.
- **Doctor enhancements** — gitignore validation, tracked artifact detection, workspace pointer chain validation, config repo default branch check, legacy YAML migration warning, tmux vs `spawn_mode` mismatch detection.
- Configurable merge agent timeout (`merge.timeout_minutes`, default: 10 min, was hardcoded 5 min). Exposed in `/taskplane-settings` TUI.

### Changed
- **Per-step git commits** replace per-checkbox commits — reduces git overhead by ~70-80% without losing recovery capability. STATUS.md is still updated after each checkbox.
- CHANGELOG.md mandatory in release process (AGENTS.md pre-release checklist added).

## [0.3.1] - 2026-03-16

### Added
- Agent prompt inheritance — base prompts ship in package and auto-update on `pi update`. Local `.pi/agents/*.md` files are thin project-specific overrides composed at runtime. `standalone: true` opts out.
- `taskplane init` now scaffolds thin local agent files instead of full copies.

## [0.3.0] - 2026-03-16

### Breaking
- **Node.js minimum raised to 22** (was 20). All CLI commands fail fast with a clear error on older versions. CI updated to Node 22.

### Added
- `taskplane install-tmux` — automated tmux installation for Git Bash on Windows. Downloads from MSYS2 mirrors, no admin rights needed. `--check` for status, `--force` to reinstall/upgrade.
- tmux documented as strongly recommended prerequisite across all public-facing docs.
- `taskplane doctor` suggests `install-tmux` when tmux is missing on Windows.

## [0.2.9] - 2026-03-16

### Added
- `taskplane install-tmux` command (same as v0.3.0 — released before the Node.js bump).

## [0.2.8] - 2026-03-16

### Fixed
- Dashboard STATUS.md eye icon resolves paths correctly in workspace mode (was double-pathing repo prefix).

## [0.2.7] - 2026-03-16

### Fixed
- State/sidecar files (batch-state.json, lane-state, merge results) now write to workspace root's `.pi/` instead of repo root's `.pi/` in workspace mode. Fixes dashboard not showing batch progress.

## [0.2.6] - 2026-03-16

### Fixed
- Tolerate flat `verification_passed`/`verification_commands` fields in merge result JSON (merge agents may write flat fields instead of nested `verification` object).

## [0.2.5] - 2026-03-16

### Fixed
- Normalize merge result `status` field to uppercase before validation. Merge agents may write lowercase (`"success"` vs `"SUCCESS"`).

## [0.2.4] - 2026-03-16

### Fixed
- Worktree base branch resolved from current HEAD instead of `default_branch` in workspace config. Was causing worktrees to branch from `develop` instead of the user's feature branch.

## [0.2.3] - 2026-03-16

### Fixed
- Thread `TASKPLANE_WORKSPACE_ROOT` env var to lane sessions so task-runner can find `.pi/task-runner.yaml` in workspace mode.

## [0.2.2] - 2026-03-16

### Fixed
- Discovery resolves task area paths from workspace root (not repo root) in workspace mode.

## [0.2.1] - 2026-03-16

### Fixed
- Preflight `git worktree list` check runs from repo root in workspace mode (workspace root is not a git repo).

## [0.2.0] - 2026-03-15

### Added
- **Polyrepo workspace mode** — multi-repository orchestration with per-repo lanes, merges, and resume.
- Workspace config (`.pi/taskplane-workspace.yaml`) with repo definitions, routing, and strict mode.
- Task repo routing via `## Execution Target` in PROMPT.md.
- Repo-scoped lane allocation with global lane numbering.
- Repo-scoped merge sequencing with partial-success reporting.
- Operator-scoped naming for sessions, worktrees, branches, and merge artifacts (collision resistance).
- Schema v2 persistence with repo-aware task/lane records and v1→v2 auto-upconversion.
- Resume reconciliation across repos.
- Dashboard repo filter, badges, and per-repo merge sub-rows.
- Strict routing enforcement (`routing.strict: true`).
- 398 tests across 15 test files.

## [0.1.18] - 2026-03-15

### Changed
- Rebalanced hydration philosophy — outcome-level checkboxes (2-5 per step) replace exhaustive implementation scripts (15+ micro-checkboxes).
- Updated task-worker and task-reviewer agent prompts with "Adaptive Planning, Not Exhaustive Scripting" guidance.

## [0.1.17] - 2026-03-15

### Fixed
- Dashboard eye icon contrast improved — higher opacity, accent color on hover/active states, box-shadow ring for on/off distinction.

## [0.1.16] - 2026-03-15

### Fixed
- Minor bug fixes and stability improvements.

## [0.1.15] - 2026-03-15

### Fixed
- Minor bug fixes and stability improvements.

## [0.1.14] - 2026-03-15

### Fixed
- `taskplane doctor` now parses task-area `context:` paths only from the `task_areas` block, preventing false-positive CONTEXT warnings from unrelated YAML sections.

## [0.1.13] - 2026-03-15

### Added
- `taskplane init --tasks-root <relative-path>` to target an existing task directory (for example `docs/task-management`) instead of creating an alternate task area path.

### Changed
- When `--tasks-root` is provided, sample task packets are skipped by default; pass `--include-examples` to scaffold examples intentionally into that directory.

## [0.1.12] - 2026-03-15

### Added
- `taskplane uninstall` CLI command with project cleanup + optional package uninstall scopes (`--package`, `--package-only`, `--local`, `--global`, `--remove-tasks`, `--all`, `--dry-run`).
- Dynamic example scaffolding in `taskplane init`: all `templates/tasks/EXAMPLE-*` packets are now discovered and generated.
- Second default example task packet: `EXAMPLE-002-parallel-smoke`.
- GitHub governance baseline for OSS collaboration:
  - CI workflow (`.github/workflows/ci.yml`)
  - Dependabot config
  - CODEOWNERS
  - Docs improvement issue form + issue template config

### Changed
- Onboarding is now orchestrator-first (`/orch-plan all` + `/orch all` + dashboard), with `/task` documented as explicit single-task mode.
- Docs now explicitly clarify `/task` runs in current branch/worktree while `/orch` uses isolated worktrees (recommended default even for single-task isolation).
- `AGENTS.md` now includes branching/PR workflow and release-playbook guidance for coding agents.
- Maintainer documentation expanded with repository governance and release mapping between GitHub releases and npm publish.

### Fixed
- CI baseline now avoids peer-dependency import failures from extension runtime-only modules in this repo context.
- Branch protection/check naming documentation aligned with the required GitHub check context (`ci`).

## [0.1.11] - 2026-03-14

### Added
- Taskplane CLI package entrypoint (`taskplane`) with init/doctor/version/dashboard commands
- Web dashboard packaging under `dashboard/` with CLI launch support
- Project scaffolding via `taskplane init` (configs, agents, task templates)
- Dependency-aware parallel orchestration commands (`/orch*`)
- Batch persistence and resume foundations (`/orch-resume`, persisted batch state)

### Changed
- Package layout aligned for pi package distribution (`extensions/`, `skills/`, `templates/`, `dashboard/`)
- Documentation strategy shifted to phased, public open-source structure

### Fixed
- Dashboard root resolution based on runtime `--root` instead of hardcoded repo path

[Unreleased]: https://github.com/HenryLach/taskplane/compare/v0.14.1...HEAD
[0.14.1]: https://github.com/HenryLach/taskplane/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/HenryLach/taskplane/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/HenryLach/taskplane/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/HenryLach/taskplane/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/HenryLach/taskplane/compare/v0.10.2...v0.11.0
[0.10.2]: https://github.com/HenryLach/taskplane/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/HenryLach/taskplane/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/HenryLach/taskplane/compare/v0.9.3...v0.10.0
[0.9.3]: https://github.com/HenryLach/taskplane/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/HenryLach/taskplane/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/HenryLach/taskplane/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/HenryLach/taskplane/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/HenryLach/taskplane/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/HenryLach/taskplane/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/HenryLach/taskplane/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/HenryLach/taskplane/compare/v0.7.1...v0.7.2
[0.7.0]: https://github.com/HenryLach/taskplane/compare/v0.6.1...v0.7.0
[0.1.14]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.14
[0.1.13]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.13
[0.1.12]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.12
[0.1.11]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.11
