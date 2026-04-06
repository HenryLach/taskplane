# `/taskplane-settings` Reference

The `/taskplane-settings` command opens an interactive TUI for viewing and editing
all Taskplane configuration. This page documents every available setting.

> **Tip:** You don't need to memorize this page. The TUI shows descriptions
> inline when you highlight each setting. Use this as a deeper reference for
> understanding what each setting does and when to change it.

---

## How settings work

Settings are organized into **sections** that match the TUI navigation.
Taskplane resolves effective values using layered precedence:

1. **Schema defaults** (internal)
2. **Global preferences** (`~/.pi/agent/taskplane/preferences.json`)
3. **Project overrides** (`.pi/taskplane-config.json`)

The settings TUI writes to two user-visible layers:

| Layer | Stored in | Shared? | Typical use |
|-------|-----------|:-------:|-------------|
| **Global preferences** | `~/.pi/agent/taskplane/preferences.json` | ❌ Personal | Your baseline defaults across all projects |
| **Project overrides** | `.pi/taskplane-config.json` | ✅ Team-wide | Project-specific exceptions to your global baseline |

When editing a setting:
- The default save target is **Global preferences**.
- You can explicitly choose **Save to project override** when needed.
- If a project override already exists, you can choose **Remove project override** to fall back to global preferences.

Source indicators in the TUI show where each value comes from:
- `(project)` — set in project config
- `(global)` — inherited from your global preferences (or internal defaults if no explicit global value exists)

---

## Orchestrator

Settings that control how `/orch` runs parallel task batches.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Max Lanes** | number | `3` | Any positive integer | Maximum parallel execution lanes (worktrees). Each lane runs one task at a time. More lanes = more parallelism but more disk/memory usage. |
| **Worktree Location** | enum | `subdirectory` | `subdirectory`, `sibling` | Where lane worktree directories are created. `subdirectory` = `.worktrees/{prefix}-{N}` inside the repo. `sibling` = `../{prefix}-{N}` next to the repo (useful when the project root isn't a git repo, e.g., polyrepo workspaces). |
| **Worktree Prefix** | string | `taskplane-wt` | Any string | Prefix for worktree directory names. Combined with operator ID and lane number: `{prefix}-{opId}-{N}`. |
| **Batch ID Format** | enum | `timestamp` | `timestamp`, `sequential` | Format for batch identifiers used in branch names and logs. `timestamp` = `20260317T140000`. `sequential` = incrementing number. |
| **Tmux Prefix** | string | `orch` | Any string | Prefix for orchestrator tmux session names. Sessions are named `{prefix}-{opId}-lane-{N}`. Change if you run multiple taskplane instances and need distinct session names. *(L1+L2)* |
| **Operator ID** | string | *(auto-detect)* | Any string | Identifier for this operator. Auto-detected from OS username if empty. Used in session names, worktree paths, and branch names for collision resistance when multiple people run batches on the same repo. *(L1+L2)* |
| **Integration** | enum | `manual` | `manual`, `supervised`, `auto` | How completed batches are integrated into your working branch. `manual` = you run `/orch-integrate` after the batch completes (gives you full control over timing and integration mode). `supervised` = the supervisor proposes an integration plan, asks for your confirmation, then executes it. `auto` = the supervisor executes integration automatically without asking, pausing only if issues arise (conflicts, CI failures). Both `supervised` and `auto` detect branch protection and default to PR mode when the target branch is protected. See [`/orch-integrate`](../commands.md) for details on the manual integration flow. |

---

## Dependencies

Settings that control how task dependencies are discovered for wave scheduling.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Dep Source** | enum | `prompt` | `prompt`, `agent` | How dependencies are extracted. `prompt` = parsed from the `## Dependencies` section of PROMPT.md. `agent` = an AI agent analyzes tasks for implicit dependencies. |
| **Dep Cache** | boolean | `true` | `true`, `false` | Cache dependency analysis results between runs. Speeds up repeated `/orch` calls on the same task set. Disable if tasks change frequently between runs. |

---

## Assignment

Settings that control how tasks are distributed across lanes.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Strategy** | enum | `affinity-first` | `affinity-first`, `round-robin`, `load-balanced` | How tasks within a wave are assigned to lanes. `affinity-first` = tasks with overlapping file scope go to the same lane (reduces merge conflicts). `round-robin` = even distribution. `load-balanced` = assigns based on task size weights. |

> **Note:** Size weights (`S:1`, `M:2`, `L:4`) are used by the load-balanced strategy
> but are not editable in the TUI. Edit them in `.pi/taskplane-config.json` directly.

---

## Pre-Warm

Settings for pre-warming lane worktrees before task execution.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Auto-Detect** | boolean | `false` | `true`, `false` | Automatically detect pre-warm commands from project config (e.g., `npm install`). When enabled, the orchestrator runs setup commands in each worktree before task execution. |

> **Note:** Named pre-warm commands and the `always` list are not editable in the TUI.
> Configure them in `.pi/taskplane-config.json` under `orchestrator.preWarm`.

---

## Merge

Settings that control how completed lanes are merged back into the base branch.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Merge Model** | string | *(inherit)* | Any model ID | Model for the merge agent. Empty = inherits the active session's model. Set explicitly if you want a specific model for merges (e.g., a faster model for simple merges). *(L1+L2)* |
| **Merge Tools** | string | `read,write,edit,bash,grep,find,ls` | Comma-separated tool names | Tools available to the merge agent. Restrict if you want to limit what the merge agent can do. |
| **Merge Thinking** | picker | *(inherit)* | `inherit (use session thinking)`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh` | Thinking mode for merge agent. `inherit` uses active session default; level values force an explicit mode. Legacy `on` is normalized to `high`. *(L1+L2)* |
| **Merge Order** | enum | `fewest-files-first` | `fewest-files-first`, `sequential` | Order in which completed lanes are merged. `fewest-files-first` = lanes with fewer changed files merge first (reduces conflict complexity). `sequential` = merge in lane number order. |
| **Merge Timeout (minutes)** | number | `10` | Any positive number | Maximum time for the merge agent to complete. If exceeded, the merge session is killed and the batch pauses. Increase for large batches with many files (e.g., 15-20 min for 50+ file diffs). |

> **Note:** Verification commands (`merge.verify`) are not editable in the TUI.
> Configure them in `.pi/taskplane-config.json` under `orchestrator.merge.verify`.

---

## Failure Policy

Settings that control what happens when things go wrong during a batch.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **On Task Failure** | enum | `skip-dependents` | `skip-dependents`, `stop-wave`, `stop-all` | What happens when a task fails. `skip-dependents` = skip tasks that depend on the failed task, continue others. `stop-wave` = stop the current wave, skip remaining waves. `stop-all` = immediately stop everything. |
| **On Merge Failure** | enum | `pause` | `pause`, `abort` | What happens when a merge fails. `pause` = pause the batch so you can inspect and resume. `abort` = terminate the batch entirely. |
| **Stall Timeout (min)** | number | `30` | Any positive number | Minutes of no progress before a task is considered stalled. The monitor checks STATUS.md for changes — if no checkboxes are checked for this duration, the task is killed. |
| **Max Worker Min** | number | `30` | Any positive number | Maximum wall-clock minutes a worker can run per task in orchestrated mode. Prevents runaway tasks from blocking the batch indefinitely. |
| **Abort Grace (sec)** | number | `60` | Any positive number | Seconds to wait after sending an abort signal before force-killing a session. Gives workers time to commit their current work. |

---

## Monitoring

Settings for the orchestrator's monitoring loop.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Poll Interval (sec)** | number | `5` | Any positive number | How often (in seconds) the orchestrator checks lane/task status. Lower = more responsive dashboard updates but more filesystem reads. Higher = less overhead. |

---

## Supervisor

Settings for the supervisor agent that monitors batches and handles failures.

The supervisor activates automatically when `/orch` starts a batch. It shares the operator's pi session, monitoring engine events and providing proactive status updates.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Supervisor Model** | string | *(inherit)* | Any model ID | Model for the supervisor agent. Empty = inherits the active session's model. Set explicitly if you want a different model for supervision (e.g., a model with stronger reasoning for failure recovery). *(L1+L2)* |
| **Autonomy Level** | enum | `supervised` | `interactive`, `supervised`, `autonomous` | Controls how much the supervisor does automatically vs. asking the operator. `interactive` = ask before any recovery action. `supervised` = known recovery patterns auto, novel recovery asks. `autonomous` = handle everything, pause only when stuck. |

### Autonomy level details

| Classification | Interactive | Supervised | Autonomous |
|----------------|-------------|------------|------------|
| **Diagnostic** (reading state, running tests) | ✅ Auto | ✅ Auto | ✅ Auto |
| **Tier 0 Known** (session restart, worktree cleanup, merge retry) | ❓ Ask | ✅ Auto | ✅ Auto |
| **Destructive** (state edits, git operations, session kills) | ❓ Ask | ❓ Ask | ✅ Auto |

In all modes, the supervisor logs every recovery action to `.pi/supervisor/actions.jsonl` for audit trail purposes.

---

## Worker

Settings that control how `/task` spawns and manages worker agents.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Worker Model** | string | *(inherit)* | Any model ID | Model for worker agents. Empty = inherits the active session's model. Format: `provider/model-id` (e.g., `anthropic/claude-sonnet-4-20250514`). *(L1+L2)* |
| **Worker Tools** | string | `read,write,edit,bash,grep,find,ls` | Comma-separated tool names | Tools available to worker agents. The default set covers all standard operations. |
| **Worker Thinking** | picker | *(inherit)* | `inherit (use session thinking)`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh` | Thinking mode for workers. `inherit` uses active session default; level values force an explicit mode. Legacy `on` is normalized to `high`. |
| **Spawn Mode** | enum | `subprocess` | `subprocess` | Runtime mode for `/task` worker/reviewer subprocesses. Runtime V2 supports subprocess only. |

> **Tip:** When you change Worker/Reviewer/Merge model to one that advertises thinking capability, the TUI suggests setting the corresponding Thinking picker to `high`.
>
> If a model reports `thinking=no`, Taskplane still lets you set any thinking level and shows an informational note. Unsupported models ignore the setting at runtime.

---

## Reviewer

Settings that control reviewer agents (cross-model review).

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Reviewer Model** | string | *(inherit)* | Any model ID | Model for reviewer agents. Empty = inherits session model. Best practice: use a different model than the worker for independent review (e.g., worker on Claude, reviewer on GPT). *(L1+L2)* |
| **Reviewer Tools** | string | `read,write,bash,grep,find,ls` | Comma-separated tool names | Tools available to reviewer agents. Note: reviewers don't get `edit` by default — they review but don't modify code. |
| **Reviewer Thinking** | picker | `high` | `inherit (use session thinking)`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh` | Thinking mode for reviewers. `inherit` uses active session default; level values force an explicit mode. Legacy `on` is normalized to `high`. |

---

## Context Limits

Settings that control worker iteration limits and context window management.

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Context Window** | number | `200000` | Any positive number | Worker context window size in tokens. Workers track their context usage against this limit. When usage exceeds the kill threshold, the iteration is terminated to prevent context overflow. |
| **Warn %** | number | `70` | 1-100 | Context utilization percentage that triggers a warning. The worker is notified it's approaching the limit and should wrap up soon. |
| **Kill %** | number | `85` | 1-100 | Context utilization percentage that force-terminates the worker iteration. The worker's current work is lost for that iteration, but STATUS.md checkpoints are preserved. |
| **Max Iterations** | number | `20` | Any positive number | Maximum worker iterations per step. Each iteration is a fresh-context agent invocation. If the worker hasn't completed the step after this many iterations, execution stops. |
| **Max Review Cycles** | number | `2` | Any positive number | Maximum REVISE loops per review stage. If the reviewer keeps returning REVISE after this many cycles, the task moves forward anyway. Prevents infinite review loops. |
| **No Progress Limit** | number | `3` | Any positive number | Maximum consecutive iterations with no checkbox progress before the task is marked as stalled. Prevents workers from spinning without making progress. |
| **Max Worker Min (ctx)** | number | *(not set)* | Any positive number or empty | Per-worker wall-clock cap in minutes. Unlike the orchestrator's `Max Worker Min` (which applies per-task in `/orch`), this applies per-worker-iteration. Empty = no cap. |

---

## Global Preferences

Personal baseline settings that affect your local environment across projects.

### First-install bootstrap behavior

On first use, `taskplane init` bootstraps `~/.pi/agent/taskplane/preferences.json` if it is missing/empty/corrupt. The bootstrap seeds:

- `initAgentDefaults.workerThinking = "high"`
- `initAgentDefaults.reviewerThinking = "high"`
- `initAgentDefaults.mergeThinking = "high"`

During first interactive init, Taskplane also saves your chosen worker/reviewer/merger model+thinking defaults globally. If `pi --list-models` reports 2+ providers, init recommends selecting reviewer/merger from a different provider than worker (cross-provider review guidance).

| Setting | Type | Default | Options | Description |
|---------|------|---------|---------|-------------|
| **Dashboard Port** | number | *(not set)* | Any valid port number | Port for `taskplane dashboard`. Default is 8099 if not set. Change if that port is in use on your machine. |

---

## Advanced (JSON Only)

The TUI's Advanced section shows fields that exist in the config schema but aren't
directly editable through the TUI — typically collections, arrays, and record types.
These include:

| Field | Type | Description |
|-------|------|-------------|
| `taskRunner.taskAreas` | Record | Task area definitions (paths, prefixes, CONTEXT.md) |
| `taskRunner.referenceDocs` | Record | Named reference documents available to tasks |
| `taskRunner.standards` | Object | Project coding standards (docs, rules) |
| `taskRunner.testing` | Object | Test commands (`testing.commands.test`, etc.) |
| `taskRunner.neverLoad` | Array | Docs excluded from task execution context |
| `taskRunner.selfDocTargets` | Record | Where agents log discoveries |
| `taskRunner.protectedDocs` | Array | Docs requiring user approval to modify |
| `orchestrator.preWarm.commands` | Record | Named pre-warm commands |
| `orchestrator.preWarm.always` | Array | Commands always run before wave execution |
| `orchestrator.assignment.sizeWeights` | Record | Size weights for load-balanced assignment |
| `orchestrator.merge.verify` | Array | Post-merge verification commands |

To edit these, modify `.pi/taskplane-config.json` directly.

---

## Related

- [Commands Reference](../commands.md) — `/taskplane-settings` command syntax
- [task-runner.yaml Reference](task-runner.yaml.md) — legacy YAML format (still supported)
- [task-orchestrator.yaml Reference](task-orchestrator.yaml.md) — legacy YAML format (still supported)
