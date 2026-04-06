# Taskplane Settings & Onboarding Specification

**Status:** Reviewed — ready for task decomposition
**Date:** 2026-03-16
**Author:** Generated from design discussion

---

## Overview

This document specifies how Taskplane configuration should work across four
onboarding scenarios, with a clear separation between **project initialization**
(done once for the project) and **user initialization** (done by each person
who joins).

### Core principles

1. **Project config is shared** — committed to git, reviewed via PRs, identical for all team members.
2. **Global preferences are personal** — model preferences, operator ID, spawn mode. Not committed.
3. **Runtime artifacts are gitignored** — batch state, lane state, logs, merge results. These are machine-specific and ephemeral. Committing them causes correctness problems for other team members.
4. **The TUI is the primary config interface** — files are an implementation detail, not a user-facing editing surface.
5. **Polyrepo projects need a config home** — one of the repos serves as the canonical source for shared config.
6. **Init enforces gitignore rules** — selective gitignore entries are a correctness requirement, not a global preference.

---

## Configuration layers

### Layer 1: Project config (shared, git-tracked)

Settings that affect how tasks execute, how the orchestrator behaves, and how
the project's task areas are organized. Every team member must have the same
values.

| Setting | Examples |
|---------|---------|
| Task areas | paths, prefixes, CONTEXT.md locations |
| Merge policy | verify commands, order, failure behavior |
| Failure policy | on_task_failure, stall_timeout, max_worker_minutes |
| Assignment | strategy, size_weights |
| Lane count | max_lanes |
| Worktree location | subdirectory vs sibling |
| Protected branches | branch names/globs to warn about |
| Workspace repos | repo paths, default branches (polyrepo only) |
| Routing | tasks_root, default_repo, strict (polyrepo only) |

**Format:** JSON (`taskplane-config.json`)
**Location:** Inside a git-tracked directory (see scenarios below)

### Layer 2: User config (personal, not tracked)

Settings that are specific to the individual developer. Different team members
may have different values.

| Setting | Examples |
|---------|---------|
| Operator ID | `henry`, `alice` (auto-detected from OS username if not set) |
| Default models | worker model, reviewer model, merger model |
| tmux prefix | `orch` (cosmetic preference) |
| Dashboard port | `8099` (local port availability) |

Note: `spawn_mode` is a **project setting** (Layer 1), not a user setting.
If the project requires tmux, all team members need tmux installed.
`taskplane doctor` warns if tmux is missing when the project uses tmux mode.

**Format:** JSON (`preferences.json`)
**Location:** `~/.pi/agent/taskplane/preferences.json` (global, outside any project)

### Layer 3: Agent prompts (shared base + project overrides)

Already implemented in v0.3.1:

- **Base prompts** ship in the npm package, auto-update on `pi update`.
- **Project override files** contain project-specific additions (e.g.,
  "always use pnpm", "run `make test`"). These are project rules, not
  personal preferences — they are committed to git and shared.
- `standalone: true` opts out of inheritance.

**Location by mode:**

| Mode | Override file location | Git tracked? |
|------|----------------------|:------------:|
| Monorepo | `.pi/agents/*.md` (in the repo) | ✅ Yes |
| Polyrepo | `<config-repo>/.taskplane/agents/*.md` | ✅ Yes |

In polyrepo mode, the task-runner follows the workspace pointer to find
agent overrides in the config repo (see Resolved Decision #1). The workspace
root's `.pi/agents/` directory is not used in workspace mode.

**Personal model preferences** (which model the worker/reviewer uses) are
in Layer 2 (user config at `~/.pi/agent/taskplane/preferences.json`), not
in the agent override files. This keeps the agent files purely about
project behavior rules while allowing individuals to use their preferred
models.

---

## Git tracking rules

### Why this matters

`.gitignore` only prevents **untracked** files from being staged. It does NOT
prevent already-tracked files from being pulled. If one team member commits a
runtime artifact (e.g., `batch-state.json`) to git, every other team member
who pulls will receive that file — even if they have it in their `.gitignore`.
Once a file is tracked, `.gitignore` is irrelevant for that file.

This means committing runtime artifacts causes real problems:
- The orchestrator may try to resume another user's batch
- Worktree paths reference another machine's filesystem
- Lane state files reference non-existent tmux sessions
- Merge result files from a completed batch confuse the next run

**Therefore, `taskplane init` must create selective gitignore entries as part
of project initialization.** This is not optional — it is a correctness
requirement.

### What is committed vs. gitignored

| File | Tracked? | Reason |
|------|:--------:|--------|
| `.pi/taskplane-config.json` | ✅ Committed | Project settings — shared by team |
| `.pi/taskplane.json` | ✅ Committed | Version tracker — shared |
| `.pi/agents/task-worker.md` | ✅ Committed | Agent overrides — shared project rules |
| `.pi/agents/task-reviewer.md` | ✅ Committed | Agent overrides — shared project rules |
| `.pi/agents/task-merger.md` | ✅ Committed | Agent overrides — shared project rules |
| `<tasks-root>/CONTEXT.md` | ✅ Committed | Task area context — shared |
| `<tasks-root>/<task-id>/PROMPT.md` | ✅ Committed | Task definitions — shared |
| `<tasks-root>/<task-id>/STATUS.md` | ✅ Committed | Task progress — shared |
| `.pi/batch-state.json` | ❌ Gitignored | Active batch — machine-specific |
| `.pi/batch-history.json` | ❌ Gitignored | Batch history — machine-specific |
| `.pi/lane-state-*.json` | ❌ Gitignored | Lane monitoring — machine-specific |
| `.pi/merge-result-*.json` | ❌ Gitignored | Merge sidecar — machine-specific |
| `.pi/merge-request-*.txt` | ❌ Gitignored | Merge sidecar — machine-specific |
| `.pi/worker-conversation-*.jsonl` | ❌ Gitignored | Worker logs — machine-specific |
| `.pi/orch-logs/` | ❌ Gitignored | Orchestrator logs — machine-specific |
| `.pi/orch-abort-signal` | ❌ Gitignored | Abort signal file — machine-specific |
| `.pi/settings.json` | ❌ Gitignored | Pi's own settings — user-specific |
| `.worktrees/` | ❌ Gitignored | Worktree directories — machine-specific |

### Required gitignore entries

`taskplane init` must add these entries to the project's `.gitignore` (or
create the file if it doesn't exist). If the entries already exist, skip them.

```gitignore
# Taskplane runtime artifacts (machine-specific, do not commit)
.pi/batch-state.json
.pi/batch-history.json
.pi/lane-state-*
.pi/merge-result-*
.pi/merge-request-*
.pi/worker-conversation-*
.pi/orch-logs/
.pi/orch-abort-signal
.pi/settings.json
.worktrees/

# Pi project-local packages (if using pi install -l)
.pi/npm/
```

### Doctor checks for git tracking

`taskplane doctor` should include these checks:

1. **Gitignore entries present** — warn if any required entries are missing
   from `.gitignore`:
   ```
   ⚠️  .gitignore missing Taskplane runtime entries
        → Run taskplane init to add them, or add manually
   ```

2. **Runtime artifacts not tracked** — warn if any runtime artifact is
   currently tracked by git (`git ls-files` returns a match):
   ```
   ❌ .pi/batch-state.json is tracked by git (should be gitignored)
        → Run: git rm --cached .pi/batch-state.json
        This file contains machine-specific state that will cause problems
        for other team members.
   ```

### Polyrepo workspace root

In polyrepo mode, the workspace root is NOT a git repo, so `.gitignore` does
not apply there. All files in the workspace root's `.pi/` are inherently
local (untracked). This is fine — the workspace root only contains:
- `taskplane-pointer.json` — local pointer to config repo
- Runtime artifacts — ephemeral, machine-specific

The git tracking rules above apply to the **config repo** (e.g.,
`platform-docs`) where the shared project config lives.

---

## What lives where

### Monorepo

```
my-project/                      ← git repo root
├── .pi/
│   ├── taskplane-config.json    ← project config (committed)
│   ├── agents/
│   │   ├── task-worker.md       ← shared agent overrides (committed)
│   │   ├── task-reviewer.md     ← shared agent overrides (committed)
│   │   └── task-merger.md       ← shared agent overrides (committed)
│   ├── taskplane.json           ← version tracker (committed)
│   └── settings.json            ← pi's own settings (may be gitignored)
├── taskplane-tasks/
│   ├── CONTEXT.md
│   └── ...
└── src/

~/.pi/agent/taskplane/
└── preferences.json             ← user config (personal, never committed)
```

### Polyrepo (workspace)

```
workspace/                       ← NOT a git repo
├── .pi/
│   └── taskplane-pointer.json   ← points to config repo (not committed — see below)
│
├── platform-docs/               ← git repo (designated "config repo")
│   ├── .taskplane/
│   │   ├── taskplane-config.json    ← project config (committed)
│   │   ├── workspace.json           ← workspace definition (committed)
│   │   └── agents/
│   │       ├── task-worker.md       ← shared agent overrides (committed)
│   │       ├── task-reviewer.md
│   │       └── task-merger.md
│   └── task-management/
│       └── ...
│
├── alerts/                      ← git repo
├── dashboard/                   ← git repo
└── ...

~/.pi/agent/taskplane/
└── preferences.json             ← user config (personal, never committed)
```

**Key:** The workspace root's `.pi/` is NOT in any git repo, so it can only
contain pointers and cached/generated state. The real config lives inside
the config repo (`platform-docs/.taskplane/`).

---

## Mode auto-detection

`taskplane init` detects the mode automatically. No `--workspace` flag needed.

### Detection logic

```
Is the current directory a git repo?
├── YES → Is it also a parent of git repos in subdirectories?
│   ├── NO  → REPO MODE (standard monorepo)
│   └── YES → AMBIGUOUS — prompt user:
│             "This directory is a git repo AND contains git repos.
│              • Repo mode — treat as a single monorepo
│              • Workspace mode — treat subdirs as independent repos
│              Which mode?"
└── NO  → Does it contain git repos in subdirectories?
    ├── YES → WORKSPACE MODE (polyrepo)
    └── NO  → ERROR — "Not a git repo and no git repos found.
                        Run from a git repo or a workspace root."
```

### tmux auto-detection

During any init (repo or workspace), taskplane checks for tmux:

| tmux available? | spawn_mode default | Message |
|:---:|---|---|
| ✅ Yes | `"tmux"` | *(silent — tmux is the expected default)* |
| ❌ No | `"subprocess"` | `"⚠ tmux not found. Using subprocess mode. Run taskplane install-tmux for full orchestrator support."` |

`spawn_mode` is a project setting (Layer 1) because it affects how lanes
are spawned for all team members. If the project lead has tmux, the team
should too. `taskplane doctor` will catch mismatches.

---

## The four onboarding scenarios

### Scenario A: First user initializes a monorepo project

**Who:** Project lead or first developer to adopt Taskplane.
**Action type:** Project initialization + user initialization.

#### What happens

```
$ cd my-project
$ taskplane init
```

Auto-detection: current directory is a git repo → **repo mode**.

**Step 1 — Project init** (creates shared config):

1. Interactive prompts (or `--preset full`):
   - Project name (detected from package.json or folder)
   - Tasks root path (default: `taskplane-tasks/`)
   - Confirm detected stack (Node, Go, Python, etc.)
2. Environment detection:
   - tmux available? → set `spawn_mode: "tmux"` (default when present)
   - tmux not found? → set `spawn_mode: "subprocess"`, suggest `taskplane install-tmux`
3. Creates:
   - `.pi/taskplane-config.json` — project settings with sensible defaults
   - `.pi/agents/task-worker.md` — thin local override file
   - `.pi/agents/task-reviewer.md` — thin local override file
   - `.pi/agents/task-merger.md` — thin local override file
   - `.pi/taskplane.json` — version tracker
   - `taskplane-tasks/CONTEXT.md` — task area context
   - `taskplane-tasks/EXAMPLE-001-*/` — example tasks (optional)
4. Adds selective gitignore entries to `.gitignore` (creates file if needed):
   - Runtime artifacts, worktrees, pi settings (see "Git tracking rules")
   - Skips entries that already exist in `.gitignore`
5. Commits to git (or prompts user to commit).

**Step 2 — User init** (creates personal preferences):

1. Creates `~/.pi/agent/taskplane/preferences.json` with defaults:
   - `operator_id`: auto-detected from OS username
   - Model preferences: empty (inherit from project or defaults)
2. This is automatic and silent — user doesn't need to do anything.

**User's role:**
- Answer init prompts (project name, task root)
- Review and commit the generated files
- Optionally customize via `/taskplane-settings` TUI later

---

### Scenario B: Additional user joins an existing monorepo project

**Who:** New team member cloning the repo.
**Action type:** User initialization only. Project is already set up.

#### What happens

```
$ git clone <repo-url>
$ cd my-project
$ pi install npm:taskplane    # or already globally installed
$ taskplane doctor            # verifies everything is in place
```

**What's already there** (from git):
- `.pi/taskplane-config.json` — project settings ✓
- `.pi/agents/*.md` — agent overrides ✓
- `.pi/taskplane.json` — version tracker ✓
- `taskplane-tasks/CONTEXT.md` — task area ✓

**What's created automatically:**
- `~/.pi/agent/taskplane/preferences.json` — personal defaults (on first `pi` launch with taskplane loaded)

**What the user might want to customize:**
- `/taskplane-settings` → adjust personal preferences (model, spawn mode)
- Nothing else — project config is already correct.

**User's role:**
- Clone the repo
- Ensure taskplane is installed (`pi install npm:taskplane`)
- Run `taskplane doctor` to verify
- Optionally personalize via `/taskplane-settings`

**Key insight:** The new user runs **zero init commands** for the project.
`taskplane init` is not needed — and should detect this:

```
$ taskplane init
ℹ Project already initialized (taskplane-config.json exists).
  Run taskplane doctor to verify, or /taskplane-settings to customize.
```

---

### Scenario C: First user initializes a polyrepo (workspace) project

**Who:** Project lead or first developer.
**Action type:** Project initialization + workspace initialization + user initialization.

#### What happens

```
$ cd ~/dev/emailgistics          # workspace root (not a git repo)
$ taskplane init
```

Auto-detection: current directory is NOT a git repo, but contains git repos
as subdirectories → **workspace mode**.

```
Detected workspace layout:
  This directory is not a git repo, but contains 26 git repositories.
  Setting up in workspace mode.
```

**Step 1 — Workspace discovery:**

1. Scans subdirectories for git repos. Lists them:
   ```
   Found 26 git repositories:
     administration, ai, alerts, auth, ...
   ```
2. Asks: "Which repo should hold Taskplane config?"
   - Suggests repos with existing docs/task-management folders
   - User selects: `platform-docs`
3. Asks: "Where are tasks managed?"
   - Default: `<config-repo>/task-management/`
   - User confirms or adjusts

**Step 2 — Project init** (in the config repo):

1. Environment detection:
   - tmux available? → set `spawn_mode: "tmux"` (default when present)
   - tmux not found? → set `spawn_mode: "subprocess"`, suggest `taskplane install-tmux`
2. Creates in `platform-docs/.taskplane/`:
   - `taskplane-config.json` — merged project + orchestrator settings
   - `workspace.json` — workspace definition (repos, paths, routing)
   - `agents/task-worker.md` — thin override files
   - `agents/task-reviewer.md`
   - `agents/task-merger.md`
3. Adds selective gitignore entries to the config repo's `.gitignore`:
   - Runtime artifacts, worktrees, pi settings (see "Git tracking rules")
   - Scoped to `.taskplane/` prefix where applicable
4. Commits to the config repo.

**Step 3 — Workspace root bootstrap:**

1. Creates `<workspace-root>/.pi/taskplane-pointer.json`:
   ```json
   {
     "config_repo": "platform-docs",
     "config_path": ".taskplane"
   }
   ```
2. This file tells Taskplane where to find the real config.
3. This file is NOT in a git repo — each user creates it during their onboarding.

**Step 4 — User init** (same as monorepo):

1. Creates `~/.pi/agent/taskplane/preferences.json` with defaults.

**User's role:**
- Run `taskplane init` and answer prompts (mode auto-detected)
- Select the config repo
- Review and commit the config to the config repo
- The workspace root `.pi/` pointer is local-only

---

### Scenario D: Additional user joins an existing polyrepo (workspace) project

**Who:** New team member setting up the workspace on their machine.
**Action type:** Workspace bootstrap + user initialization. Project config already exists.

#### What happens

```
$ cd ~/dev/emailgistics          # workspace root (cloned all repos)
$ taskplane init
```

Auto-detection: not a git repo, contains git repos → workspace mode.
Then discovers existing config:

```
Detected workspace layout (26 git repositories).
ℹ Found existing Taskplane config in platform-docs/.taskplane/
  Using existing configuration.

Creating workspace pointer... done
```

**What's already there** (in the config repo, from git):
- `platform-docs/.taskplane/taskplane-config.json` ✓
- `platform-docs/.taskplane/workspace.json` ✓
- `platform-docs/.taskplane/agents/*.md` ✓

**Step 1 — Workspace detection:**

1. Detects workspace mode (not a git repo, has git repo subdirectories).
2. Scans for git repos.
3. Finds existing `.taskplane/` directory in `platform-docs`.
4. Does NOT re-prompt for config repo selection — it's already configured.

**Step 2 — Workspace root bootstrap:**

1. Creates `<workspace-root>/.pi/taskplane-pointer.json` pointing to `platform-docs/.taskplane/`
2. This is the **only file created** in the workspace root.

**Step 3 — User init:**

1. Creates `~/.pi/agent/taskplane/preferences.json` with defaults.

**User's role:**
- Clone all repos into the workspace folder
- Run `taskplane init`
- Taskplane auto-discovers existing config — no decisions needed
- Optionally personalize via `/taskplane-settings`

**Key insight:** Scenario D is almost fully automatic. The only reason
`taskplane init` is needed is to create the local pointer file.
Everything else is already in git.

---

## Summary: Project init vs. user init

| | Project init | User init |
|---|---|---|
| **What** | Shared config, task areas, agent overrides, gitignore rules | Personal preferences, workspace pointer |
| **Who does it** | First person to adopt Taskplane | Every team member |
| **Where it lives** | In a git repo (committed, shared) | `~/.pi/agent/taskplane/` + workspace `.pi/` |
| **How often** | Once per project, ever | Once per user per machine |
| **Monorepo** | `taskplane init` (detects repo mode) | Automatic on first launch |
| **Polyrepo** | `taskplane init` (detects workspace mode) | `taskplane init` (creates pointer only) |
| **Idempotent** | Yes — detects existing config, skips | Yes — creates only if missing |
| **Gitignore** | Created/updated during project init | N/A (user config is outside git) |

---

## Migration path

For existing projects (pre-JSON config):

1. **Backward compatible:** `loadConfig()` checks for JSON first, falls back to YAML.
2. **`/settings` TUI first use:** Reads YAML, writes JSON. YAML files remain but are no longer read after JSON exists.
3. **`taskplane doctor`** warns: "Legacy YAML config detected. Run `/taskplane-settings` to migrate."
4. **No forced migration** — YAML continues to work indefinitely.

---

## Resolved design decisions

These were originally open questions, resolved through design review.

### 1. Agent overrides in polyrepo: follow the pointer

The task-runner follows the pointer file to find agent overrides in the
config repo. Same mechanism used for all config resolution — one pattern
to understand, one code path to maintain.

Resolution chain:
1. Read `<workspace-root>/.pi/taskplane-pointer.json`
2. Resolve `config_repo` + `config_path`
3. Load agents from `<config-repo>/<config-path>/agents/*.md`

The workspace root's `.pi/agents/` directory is not used in workspace mode.

### 2. Config repo branch: init warns, doctor validates

Config artifacts MUST be merged to the config repo's default branch before
other users can onboard. If User A initializes on `feat/setup-taskplane`
but doesn't merge to `develop`, User B's `taskplane init` won't find the
existing config and will treat it as a fresh project.

**Init behavior:**
- After creating config in the config repo, display:
  ```
  ⚠ Important: merge these changes to your default branch (e.g., develop)
    before other team members run taskplane init.

    cd platform-docs
    git push && [create PR / merge to develop]
  ```

**Doctor behavior:**
- If running in workspace mode, check whether `.taskplane/` exists on the
  config repo's default branch (not just the current branch):
  ```
  ⚠ .taskplane/ exists on current branch (feat/setup) but not on
    default branch (develop). Other users won't find the config.
    → Merge to develop so teammates can onboard.
  ```

### 3. Multiple workspaces: works naturally

Each workspace root gets its own `.pi/taskplane-pointer.json` pointing to
its own config repo. No shared state between workspaces. Operator-scoped
naming in tmux sessions and worktrees prevents collisions even if both
workspaces are active simultaneously.

No special handling needed.

### 4. Dashboard in polyrepo: follows the pointer

Implementation change only — no design decision needed. The dashboard
server reads the pointer file, follows it to the config repo, and finds
batch state and task area paths from there. Same resolution chain as the
task-runner and orchestrator.

### 5. Doctor in polyrepo: validates the full chain

`taskplane doctor` in workspace mode validates everything, in order of
severity:

1. Pointer file exists and is valid JSON with required fields
2. Config repo path exists on disk
3. Config repo has `.taskplane/` directory with required files
4. `.taskplane/` exists on the config repo's default branch (not just
   current branch — see decision #2)
5. Each repo listed in `workspace.json` exists on disk and is a git repo
6. tmux is available if `spawn_mode` is `"tmux"`
7. Gitignore entries are present (see "Git tracking rules")

Repo existence checks use `git rev-parse --git-dir` (fast, no network).

### 6. Gitignore `.pi/npm/`: include it

Even though `.pi/npm/` is pi's concern (project-local package installs),
accidentally committing it puts hundreds of megabytes of `node_modules/`
into git. Since taskplane is already writing gitignore entries during init,
adding one more line costs nothing and prevents a common mistake.

Added to the required gitignore entries:

```gitignore
# Pi project-local packages (if using pi install -l)
.pi/npm/
```

### 7. Auto-fix tracked runtime artifacts: yes, during init

`taskplane init` checks whether any runtime artifact is currently tracked
by git (`git ls-files`). If found, offers to untrack them:

```
⚠ Found runtime artifacts tracked by git:
    .pi/batch-state.json
    .pi/batch-history.json

  These files contain machine-specific state that will cause problems
  for other team members. Untrack them? [Y/n]

  Running: git rm --cached .pi/batch-state.json .pi/batch-history.json
  ✅ Files untracked (still on disk, now gitignored)
```

This is safe — `git rm --cached` only removes from the index, doesn't
delete the files from disk. Combined with the gitignore entries added
in the same init run, the files stay local going forward.
