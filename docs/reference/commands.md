# Commands Reference

This page documents Taskplane command surfaces:

1. pi session slash commands (`/task`, `/orch*`, `/taskplane-settings`)
2. CLI shell commands (`taskplane ...`)

> Slash commands are registered by Taskplane extensions when loaded in pi.

---

## Task Runner Commands

> ⚠️ **Deprecated in v0.10.x.** The `/task*` commands below are deprecated and will be removed in a future major version. Use `/orch` for all workflows — it provides worktree isolation, dashboard, inline reviews, and supervisor monitoring.

### `/task <path/to/PROMPT.md>`

> **Deprecated.** Use `/orch <path/to/PROMPT.md>` instead.

Start autonomous execution of a single task.

**Syntax**

```text
/task <path/to/PROMPT.md>
```

**Behavior**

- Resolves path from current working directory
- Runs in the current branch/worktree (no orchestrator worktree isolation)
- Parses `PROMPT.md`
- Loads existing `STATUS.md` (or generates one if missing)
- Creates `.reviews/` if needed
- Starts worker/reviewer loop

**Examples**

```text
/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
/task taskplane-tasks/auth/AUTH-014-rbac/PROMPT.md
```

**Isolation note**

- `/task` commits in your current working tree.
- Avoid editing unrelated files while it runs.
- Prefer `/orch <path/to/PROMPT.md>` when you want worktree isolation for a single task.

**Common responses**

- `Usage: /task <path/to/PROMPT.md>` if missing arg
- `File not found: ...` if path is invalid
- Warning if another task is already running

---

### `/task-status`

> **Deprecated.** Use the dashboard (`taskplane dashboard`) or `/orch-status` instead.

Show current in-memory + STATUS.md task progress.

**Syntax**

```text
/task-status
```

**Behavior**

- Prints task ID/name, phase, iteration count, review count
- Prints per-step checkbox totals
- Re-reads `STATUS.md` and refreshes runner widget state

**Common responses**

- `No task loaded. Use /task <path/to/PROMPT.md>`
- `STATUS.md not found`

---

### `/task-pause`

> **Deprecated.** Use `/orch-pause` instead.

Pause task execution after current worker iteration completes.

**Syntax**

```text
/task-pause
```

**Behavior**

- Sets runner phase to paused
- Does not force-kill worker mid-iteration

**Common responses**

- `No task is running`

---

### `/task-resume`

> **Deprecated.** Use `/orch-resume` instead.

Resume a paused task.

**Syntax**

```text
/task-resume
```

**Behavior**

- Requires a paused task to be loaded in memory
- Restarts execution loop from current STATUS state

**Common responses**

- `Task is not paused`
- `No task loaded`

---

## Orchestrator Commands

### `/orch [<areas|paths|all>]`

Universal entry point for Taskplane. When called without arguments, detects project state and activates the supervisor for guided interaction. When called with arguments, starts parallel batch execution.

**Syntax**

```text
/orch                      # Detect state → supervisor routing
/orch <areas|paths|all>    # Start batch execution directly
```

**No-argument routing**

When `/orch` is called without arguments, it detects the current project state and routes to the appropriate supervisor flow:

| Detected state | Condition | Supervisor action |
|----------------|-----------|-------------------|
| **Active batch** | `batch-state.json` with non-terminal phase | Shows status summary (supervisor already running) |
| **Completed batch** | Completed batch + orch branch exists | Offers retrospective and integration guidance |
| **No config** | No `.pi/taskplane-config.json` found | Starts onboarding flow (project setup, task areas, git branching) |
| **Pending tasks** | Config exists, pending tasks found | Offers to plan and start a batch |
| **No tasks** | Config exists, no pending tasks | Helps create tasks from specs, GitHub Issues, or conversation |

States are evaluated in the order shown above (active batch and completed batch take priority over config checks).

**Arguments (batch execution mode)**

- `all` — scan all configured task areas
- one or more area names (e.g. `auth billing`)
- one or more filesystem paths (area dir or specific task prompt path)

**Behavior (with arguments)**

- Runs additive upgrade migrations (e.g., creating missing `.pi/agents/supervisor.md` from template). Migrations are tracked in `.pi/taskplane.json` and never overwrite existing files. Failures are non-fatal.
- Runs orphan-session/state detection before starting
- Discovers tasks and dependencies
- Computes waves and lane assignments
- Creates an **orch branch** (`orch/<operator>-<batchId>`) from the current branch — all batch work lands here, not on your working branch
- **Starts the engine asynchronously and returns control to the pi session immediately** — the wave loop runs in the background while you continue interacting with the session
- Executes tasks in isolated worktrees
- Merges successful lane branches into the orch branch
- Engine emits structured lifecycle events to `.pi/supervisor/events.jsonl` for observability
- On completion, shows integration guidance (or auto-integrates if `integration` is set to `auto`)
- Can be used with a single task path when you want `/task` semantics with worktree isolation

**Runtime V2 backend (migration in progress)**

When `/orch` is invoked with a single direct PROMPT.md path in repo mode
(not workspace mode), the engine uses the **Runtime V2 backend** which
spawns workers as direct child processes without TMUX. Multi-task batches
and workspace mode continue to use the legacy TMUX-backed backend.
The selection is automatic and logged for operator visibility.

**Onboarding flow (no config)**

When `/orch` detects no Taskplane configuration, the supervisor walks the operator through first-time setup:

1. **Project assessment** — analyzes repo structure, package files, and existing docs
2. **Task area design** — proposes task areas based on project structure; operator refines
3. **Git branching** — detects branch strategy and protection rules; recommends configuration
4. **Config generation** — creates `.pi/taskplane-config.json`, area `CONTEXT.md` files, `.pi/agents/` overrides, and `.gitignore` entries
5. **First task guidance** — offers to create a starter task, pull from GitHub Issues, or run a smoke test

The onboarding adapts based on project maturity — a greenfield project gets full scaffolding guidance, while an established codebase gets a streamlined setup focused on task areas and config.

**Supervisor activation**

After starting the engine, `/orch` activates the **supervisor agent** in the same pi session. The supervisor:

- Monitors engine events (wave starts, task completions, merge results, failures)
- Provides proactive status notifications to the operator
- Handles failure recovery based on its autonomy level
- Responds to natural-language questions ("how's it going?", "what failed?")
- Logs all recovery actions to `.pi/supervisor/actions.jsonl`

The supervisor persists until the batch completes, fails, is stopped, or is aborted. A lockfile at `.pi/supervisor/lock.json` prevents duplicate supervisors across sessions.

See also: [`/orch-takeover`](#orch-takeover) for session takeover, [Supervisor config](#supervisor-settings) for model and autonomy settings.

**Orch branch model**

`/orch` never modifies your working branch directly. Instead, it creates a dedicated orch branch where all task work is merged. When the batch completes, you integrate the results using `/orch-integrate` (or let auto-integration handle it). This keeps your working branch stable while tasks execute.

See also: [`/orch-integrate`](#orch-integrate-orch-branch---merge---pr---force)

**Examples**

```text
/orch                                    # Detect state, activate supervisor
/orch all                                # Start batch for all task areas
/orch auth billing                       # Start batch for specific areas
/orch taskplane-tasks/auth/tasks
/orch taskplane-tasks/auth/tasks/AUTH-001-login/PROMPT.md
```

---

### `/orch-plan <areas|paths|all> [--refresh]`

Preview execution plan without running tasks.

**Syntax**

```text
/orch-plan <areas|paths|all> [--refresh]
```

**Options**

- `--refresh` — bypass dependency cache and force re-scan

**Output includes**

- preflight checks
- discovery results
- dependency graph
- wave plan and lane assignment estimate

**Examples**

```text
/orch-plan all
/orch-plan auth billing
/orch-plan all --refresh
```

---

### `/orch-status`

Show current batch progress summary.

**Syntax**

```text
/orch-status
```

**Output includes**

- batch ID and phase
- current wave index / total waves
- succeeded, failed, skipped, blocked, total task counts
- elapsed time
- error count (if any)

---

### `/orch-pause`

Pause batch after current tasks finish.

**Syntax**

```text
/orch-pause
```

**Behavior**

- Sets orchestrator pause signal
- Lane polling sees signal and stops scheduling further work

**Common responses**

- No active batch
- Batch already paused

---

### `/orch-resume [--force]`

Resume a paused or interrupted batch from persisted state.

**Syntax**

```text
/orch-resume [--force]
```

**Options**

- `--force` — allow resuming from `stopped` or `failed` phases that are normally non-resumable. Runs pre-resume diagnostics before proceeding.

**Behavior**

- Loads `.pi/batch-state.json`
- Validates resumable phase (see eligibility matrix below)
- Reconciles `.DONE` markers and live sessions
- **Starts the engine asynchronously and returns control immediately** (same non-blocking model as `/orch`)
- Reactivates the supervisor agent in the session
- Reconnects/re-executes tasks as needed
- Continues from first incomplete wave

**Resume eligibility**

| Phase | Normal | `--force` |
|-------|--------|-----------|
| `paused` | ✅ Eligible | ✅ Eligible |
| `executing` | ✅ Eligible | ✅ Eligible |
| `merging` | ✅ Eligible | ✅ Eligible |
| `stopped` | ❌ Rejected | ✅ Eligible (after diagnostics) |
| `failed` | ❌ Rejected | ✅ Eligible (after diagnostics) |
| `completed` | ❌ Rejected | ❌ Rejected (always) |

**Pre-resume diagnostics (`--force` only)**

When `--force` is used on a `stopped` or `failed` batch, Taskplane runs pre-resume diagnostics before allowing execution to continue:

- **Worktree health** — verifies lane worktrees still exist on disk
- **Branch consistency** — confirms expected branches are present
- **State coherence** — validates batch state internal consistency; in workspace mode, also checks repo-level state

If diagnostics fail, the resume is blocked with an operator-facing explanation. Fix the reported issues and retry.

When diagnostics pass, the batch phase is reset to `paused` and `resilience.resumeForced` is recorded in state for audit purposes. Normal resume flow then proceeds.

**Examples**

```text
/orch-resume                  # Resume from paused/executing/merging
/orch-resume --force           # Force resume from stopped or failed
```

**Common responses**

- No batch state to resume
- State invalid or non-resumable phase
- Cannot resume while a batch is actively running
- `--force` diagnostics failed: worktree/branch/state issues detected

---

### `/orch-abort [--hard]`

Abort current batch.

**Syntax**

```text
/orch-abort [--hard]
```

**Modes**

- default (graceful): cooperative stop + cleanup
- `--hard`: immediate session termination

**Behavior**

- Writes abort signal file: `.pi/orch-abort-signal`
- Attempts to terminate matching tmux sessions
- Cleans in-memory/persisted batch state
- Preserves worktrees/branches for inspection

---

### `/orch-deps <areas|paths|all> [--refresh] [--task <ID>]`

Show dependency graph.

**Syntax**

```text
/orch-deps <areas|paths|all> [--refresh] [--task <ID>]
```

**Options**

- `--refresh` — bypass dependency cache
- `--task <ID>` — filter to one task (e.g. `--task AUTH-014`)

**Examples**

```text
/orch-deps all
/orch-deps auth --refresh
/orch-deps all --task AUTH-014
```

---

### `/orch-sessions`

List active orchestrator tmux sessions.

**Syntax**

```text
/orch-sessions
```

**Behavior**

- Lists sessions matching configured orchestrator tmux prefix
- Useful for debugging/resume/cleanup in tmux mode

---

### `/orch-takeover`

Force takeover of the supervisor from another pi session.

**Syntax**

```text
/orch-takeover
```

**Behavior**

When a batch is running, exactly one pi session owns the supervisor role. If you open a new pi session and want to take over supervisor duties (e.g., the original session is unresponsive or you've switched terminals), use `/orch-takeover`.

The command checks the supervisor lockfile at `.pi/supervisor/lock.json` and handles four cases:

| Lockfile state | Action |
|----------------|--------|
| No active batch | Informs you — run `/orch` first |
| No lockfile / corrupt / stale heartbeat | Activates supervisor normally (no takeover needed) |
| Live lock (PID alive, heartbeat recent) | Force takeover — writes a new lock; the previous session yields on its next heartbeat check |
| Already the active supervisor | No-op — informs you this session already owns it |

**Rehydration**

On takeover, the supervisor reads batch state, recent engine events, and the audit trail to reconstruct context. A summary is displayed so you know where the batch stands.

**Yield mechanism**

The previous supervisor's heartbeat timer (30-second interval) detects that the lockfile's `sessionId` no longer matches its own. It yields gracefully — clearing its supervisor state and notifying the operator in that session.

**Common responses**

- `✅ This session is already the active supervisor.`
- `No active batch to supervise.`
- `🔄 Previous supervisor (PID ...) process is dead. Activating supervisor.`
- `⚡ Forcing supervisor takeover from PID ...`

---

### `/orch-integrate [<orch-branch>] [--merge] [--pr] [--force]`

Integrate a completed orch batch into your working branch.

After `/orch` finishes, all task work lives on an orch branch (`orch/<operator>-<batchId>`). This command brings that work into your working branch using one of three modes.

**Syntax**

```text
/orch-integrate [<orch-branch>] [--merge] [--pr] [--force]
```

**Arguments**

- `<orch-branch>` — (optional) name of the orch branch to integrate. Auto-detected from batch state if omitted. Required when batch state is unavailable or multiple orch branches exist.

**Modes**

| Flag | Mode | Description |
|------|------|-------------|
| *(default)* | Fast-forward | `git merge --ff-only` — cleanest history, fails if branches have diverged |
| `--merge` | Merge commit | `git merge --no-edit` — creates a merge commit, works when branches have diverged |
| `--pr` | Pull request | Pushes orch branch to origin and creates a PR via `gh pr create` |

**Options**

- `--force` — skip the branch safety check (normally the command verifies you're on the same branch the batch was started from)

**Branch safety check**

By default, `/orch-integrate` verifies that your current branch matches the base branch recorded when the batch started. This prevents accidentally integrating into the wrong branch. Use `--force` to skip this check.

**Resolution order**

The command determines which orch branch to integrate using this priority:

1. **Persisted batch state** (`.pi/batch-state.json`) — preferred source, provides orch branch, base branch, and batch ID
2. **Positional argument** — overrides or supplements batch state
3. **Branch scan** — if neither state nor argument is available, scans for `orch/*` branches. Works automatically when exactly one exists; prompts for selection when multiple are found.

**Cleanup**

- In **fast-forward** and **merge** modes: on success, the local orch branch is deleted and batch state is cleaned up. Cleanup failures are non-fatal (shown as warnings).
- In **PR mode**: the orch branch is preserved (needed for the pull request). Batch state is not cleaned up.

**Examples**

```text
/orch-integrate                          # Auto-detect branch, fast-forward
/orch-integrate --merge                  # Auto-detect branch, merge commit
/orch-integrate --pr                     # Auto-detect branch, create PR
/orch-integrate orch/op-abc123           # Specific branch, fast-forward
/orch-integrate orch/op-abc123 --pr      # Specific branch, create PR
/orch-integrate --force                  # Skip branch safety check
```

**Supervisor-managed integration**

When the integration setting is `supervised` or `auto`, the supervisor automatically handles integration after the batch completes — you don't need to run `/orch-integrate` manually.

- **`supervised`** — the supervisor builds an integration plan (mode, branches, protection status), presents it for your confirmation, then executes it.
- **`auto`** — the supervisor executes integration immediately without asking, pausing only if issues arise (conflicts, CI failures, branch protection).

Both modes detect branch protection via the GitHub API and default to PR mode when the target branch is protected. If fast-forward fails, the supervisor falls back to merge mode, then to PR mode. You can still run `/orch-integrate` manually at any time, regardless of the configured mode.

See [Integration setting](configuration/taskplane-settings.md#orchestrator) for configuration details.

**Common responses**

- `⏳ Batch ... is currently in "running" phase.` — batch must complete before integration
- `❌ Fast-forward failed — branches have diverged.` — use `--merge` or `--pr` instead
- `⚠️ Batch was started from main, but you're on develop.` — switch branches or use `--force`
- `ℹ️ Batch ... used legacy merge mode` — older batch that was already merged directly (no orch branch to integrate)
- `❌ No completed batch found and no orch branches exist.` — run `/orch` first

### Orchestrator Tools (Programmatic Access)

The key orchestrator commands are also registered as **extension tools** that the supervisor agent (and any agent in the session) can invoke programmatically:

| Tool | Equivalent Command | Parameters |
|------|-------------------|------------|
| `orch_start(target)` | `/orch <target>` | `target`: string (required) — `"all"` or task area name/path |
| `orch_status()` | `/orch-status` | — |
| `orch_pause()` | `/orch-pause` | — |
| `orch_resume(force?)` | `/orch-resume [--force]` | `force`: boolean (optional) |
| `orch_abort(hard?)` | `/orch-abort [--hard]` | `hard`: boolean (optional) |
| `orch_integrate(mode?, force?, branch?)` | `/orch-integrate [opts]` | `mode`: "fast-forward"\|"merge"\|"pr", `force`: boolean, `branch`: string |
| `orch_retry_task(taskId)` | — | `taskId`: string (required) — retry a specific failed/stalled task |
| `orch_skip_task(taskId)` | — | `taskId`: string (required) — skip a task and unblock dependents |
| `orch_force_merge(waveIndex?, skipFailed?)` | — | `waveIndex`: number (optional, 0-based), `skipFailed`: boolean (optional) — force merge a wave with mixed results |

These tools share the same logic as the slash commands. They return text results and catch errors gracefully (never throw). The supervisor agent uses these to manage batches proactively during monitoring.

### Recovery Tools (TP-077, TP-078)

The `orch_retry_task`, `orch_skip_task`, and `orch_force_merge` tools enable surgical task-level and wave-level recovery:

- **`orch_retry_task(taskId)`** — Resets a failed or stalled task to `pending` status. Clears exit reason, timing, and diagnostic fields. Decrements failure counters. Transitions batch from `failed` → `stopped` if no failures remain. Use `orch_resume(force=true)` after retrying to re-execute.

- **`orch_skip_task(taskId)`** — Marks a failed, stalled, or pending task as `skipped`. Updates counters and recomputes blocked dependents using the dependency graph. Unblocked tasks are reported in the response. Use `orch_resume(force=true)` after skipping to continue.

- **`orch_force_merge(waveIndex?, skipFailed?)`** — Forces a wave merge that was rejected due to mixed-outcome lanes (succeeded + failed tasks on the same lane). Updates the merge result from `partial` to `succeeded`. If `skipFailed=true`, automatically marks all failed/stalled tasks in the wave as `skipped` and adjusts counters. If `skipFailed=false` and failed tasks exist, rejects with guidance to skip them first. Defaults to the current wave if `waveIndex` is omitted. Use `orch_resume(force=true)` after force merging to continue.

All three tools reject operations while the engine is actively running (launching/executing/merging/planning) — pause the batch first. They modify the persisted `batch-state.json` directly and sync in-memory state for the dashboard widget.

---

## Configuration Commands

### `/taskplane-settings`

Open the interactive settings TUI for viewing and editing taskplane configuration.

**Syntax**

```text
/taskplane-settings
```

**Behavior**

- Shows a two-level navigation: section selector → field list
- Displays 13 sections covering orchestrator, supervisor, task-runner, user preferences, and advanced (JSON-only) fields
- Each field shows its current value and source indicator: `(project)`, `(user)`, or `(default)`
- Enum and boolean fields use toggleable controls; strings and numbers use text input
- Layer 1 (project) changes write to `.pi/taskplane-config.json`
- Layer 2 (user preference) changes write to `~/.pi/agent/taskplane/preferences.json`
- Dual-layer (L1+L2) fields prompt for save destination
- Project config changes require confirmation before writing
- New config parameters added in future schema updates appear automatically
- Changes take effect on next session restart

**Sections**

| Section | Description |
|---------|-------------|
| Orchestrator | Lanes, worktree layout, spawn mode, operator ID |
| Dependencies | Dependency source and caching |
| Assignment | Task assignment strategy |
| Pre-Warm | Auto-detection settings |
| Merge | Merge model, tools, and ordering |
| Failure Policy | Task/merge failure handling, timeouts |
| Monitoring | Poll interval |
| Supervisor | Supervisor model and autonomy level |
| Worker | Worker model, tools, thinking, spawn mode |
| Reviewer | Reviewer model, tools, thinking |
| Context Limits | Context window, iteration limits, progress limits |
| User Preferences | Dashboard port and other per-user settings |
| Advanced (JSON Only) | Read-only listing of uncovered/non-editable fields (collections, records, arrays, and other fields not directly editable in the TUI) |

**Example**

```text
/taskplane-settings
```

Opens the settings TUI in the current pi session. No arguments needed.

**Common responses**

- `❌ Orchestrator not initialized. Workspace configuration failed at startup.` — the execution context (`execCtx`) was not set during session startup; typically caused by a missing or invalid workspace/repo configuration. Fix the config and restart the pi session.
- `❌ Failed to load settings: <message>` — an error occurred while loading or parsing config files (e.g., malformed JSON/YAML, filesystem permission issue). The error message provides specifics.

---

## CLI Commands

These are shell commands (not pi slash commands).

### `taskplane init [options]`

Scaffold Taskplane project files. Auto-detects repo vs workspace layout and runs the appropriate init flow.

**Mode detection:**

- **Single-repo mode** — current directory is a git repo with no git repo subdirectories. Scaffolds config in `.pi/`.
- **Workspace mode** — current directory is not a git repo but contains git repo subdirectories. Scaffolds config in `<config-repo>/.taskplane/` and creates a pointer file.
- **Ambiguous** — git repo with git repo subdirectories. Prompts interactively; defaults to single-repo mode in non-interactive modes (`--preset`, `--dry-run`).

**Common options**

- `--preset <name>` — use `minimal`, `full`, or `runner-only`
- `--tasks-root <relative-path>` — use an existing task directory (for example `docs/task-management`)
- `--no-examples` — skip example task scaffolding
- `--include-examples` — when `--tasks-root` is used, include examples in that directory (default is skip)
- `--force` — overwrite existing files
- `--dry-run` — preview files without writing

**Notes**

- `--tasks-root` must be relative to project root.
- When `--tasks-root` is passed, Taskplane skips sample tasks by default to avoid polluting an existing task area.
- Init adds required `.gitignore` entries for runtime artifacts (batch state, orchestrator logs, worktrees, etc.) and offers to untrack any that are already committed.
- tmux availability is detected at init time. When tmux is found, `spawn_mode` defaults to `"tmux"` in the orchestrator config; otherwise it defaults to `"subprocess"`.
- Init generates `taskplane-config.json` (JSON) alongside YAML configs. JSON takes precedence when present; YAML is retained during the transition period.

### `taskplane doctor`

Validate installation and project configuration.

On Windows, if tmux is not found, doctor suggests running `taskplane install-tmux`.

### `taskplane install-tmux [options]`

Install or upgrade tmux for Git Bash on Windows. Downloads tmux and libevent packages from the official MSYS2 package repository and places binaries in `~/bin/`.

**Options**

- `--check` — show current tmux status without installing
- `--force` — reinstall even if already up to date

**Notes**

- Windows only. On macOS/Linux, prints a redirect to `brew install tmux` or `apt install tmux`.
- Requires Node.js ≥ 21.7 (for native zstd decompression).
- Requires Git Bash (provides `tar` and the MSYS2 runtime).
- Installs to `~/bin/` which is on PATH in Git Bash by default. No admin rights needed.
- Safe to re-run for upgrades.

### `taskplane version`

Show package and environment version details.

### `taskplane dashboard [--port <n>] [--no-open]`

Launch the web dashboard server.

### `taskplane uninstall [options]`

Uninstall Taskplane project artifacts and optionally the installed package.

Common options:

- `--dry-run` — preview what would be removed
- `--yes` — skip confirmations
- `--package` — also run `pi remove` for this scope
- `--package-only` — remove package only, skip project cleanup
- `--local` / `--global` — force package uninstall scope
- `--remove-tasks` — also remove task area directories from `.pi/task-runner.yaml`
- `--all` — equivalent to `--package --remove-tasks`

Notes:

- Package removal deletes Taskplane extensions, skills, and dashboard package files.
- Project cleanup preserves task directories by default unless `--remove-tasks` is passed.

---

## Related

- [Task Runner Config Reference](configuration/task-runner.yaml.md)
- [Task Orchestrator Config Reference](configuration/task-orchestrator.yaml.md)
- [Task Format Reference](task-format.md)
