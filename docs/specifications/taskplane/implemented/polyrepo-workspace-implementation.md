# Polyrepo Workspace Implementation — Working Solution

> **Status:** Validated via end-to-end smoke test  
> **Created:** 2026-03-18  
> **Last Validated:** 2026-03-19 (v0.5.12)  
> **Test Workspace:** `C:/dev/tp-test-workspace/` (3 repos, 6 tasks, 3 waves)  
> **Smoke Test Skill:** `.pi/skills/polyrepo-smoke-test/SKILL.md`

---

## 1. Overview

Taskplane's polyrepo workspace mode orchestrates tasks across multiple git
repositories from a single workspace root. This document captures the final
working solution after extensive iteration, focusing on the non-obvious design
decisions and bugs that were discovered and fixed.

### Key insight

The workspace root is **not a git repo** — it's a plain directory containing
multiple repos. Every subsystem that assumes `cwd` is a git repo needs
workspace-aware handling.

---

## 2. Architecture

```
workspace-root/                        ← NOT a git repo
├── .pi/
│   ├── taskplane-pointer.json         ← points to config repo
│   ├── taskplane-workspace.yaml       ← repo map, routing, tasks_root
│   └── batch-state.json               ← runtime state (during/after batch)
├── api-service/                       ← git repo (develop branch)
│   └── .worktrees/{opId}-{batchId}/   ← batch-scoped worktree container
│       └── lane-{N}/                  ← lane worktree
├── web-client/                        ← git repo (develop branch)
│   └── .worktrees/{opId}-{batchId}/
│       └── lane-{N}/
└── shared-libs/                       ← git repo (develop branch) + CONFIG REPO
    ├── .taskplane/                    ← shared config (committed to git)
    │   ├── taskplane-config.json      ← unified config
    │   └── agents/                    ← worker/reviewer/merger prompts
    ├── task-management/               ← task area (contains all tasks)
    │   └── platform/general/
    │       ├── CONTEXT.md
    │       ├── dependencies.json
    │       └── TP-001/ through TP-006/
    └── .worktrees/{opId}-{batchId}/
        ├── lane-{N}/
        └── merge/                     ← merge worktree
```

---

## 3. Config Resolution Chain

```
User runs `pi` from workspace root
  → taskplane auto-loads (npm package)
  → orchestrator extension: session_start
    → loadWorkspaceConfig(cwd)
      → reads .pi/taskplane-workspace.yaml
      → validates repos exist on disk, are git repos
      → validates routing.tasks_root exists
    → resolvePointer(cwd, wsConfig)
      → reads .pi/taskplane-pointer.json
      → resolves config_repo + config_path → shared-libs/.taskplane/
    → loadProjectConfig(cwd, pointerConfigRoot)
      → reads shared-libs/.taskplane/taskplane-config.json
    → buildExecutionContext()
      → returns { workspaceRoot, repoRoot, mode: "workspace", ... }
```

### Critical config details

| Field | In File | Value | Notes |
|-------|---------|-------|-------|
| `configVersion` | taskplane-config.json | `1` (integer) | NOT `"1.0"` or `"1"` — strict equality check |
| `taskAreas.general.path` | taskplane-config.json | `"shared-libs/task-management/platform/general"` | Must be workspace-relative, not config-repo-relative |
| `routing.tasks_root` | taskplane-workspace.yaml | `"shared-libs/task-management"` | Must include repo prefix since tasks are inside a repo |
| `routing.default_repo` | taskplane-workspace.yaml | `"shared-libs"` | Must match a key in the `repos` map |
| `repos.*.default_branch` | taskplane-workspace.yaml | `"develop"` | `taskplane init` doesn't set this — add manually if not using `main` |
| `config_repo` | taskplane-pointer.json | `"shared-libs"` | snake_case, not camelCase |
| `config_path` | taskplane-pointer.json | `".taskplane"` | snake_case, not camelCase |

### What `taskplane init` does and doesn't do

**Does:**
- Detects workspace mode (multiple git repos in subdirectories)
- Finds existing `.taskplane/` config in repos
- Creates `.pi/taskplane-pointer.json` and `.pi/taskplane-workspace.yaml`

**Doesn't (requires manual setup):**
- `default_branch` per repo (defaults to detecting current HEAD)
- `tasks_root` correction (defaults to `"taskplane-tasks"` which may not exist)
- Agent files in the config repo (need to copy from templates)

---

## 4. Orch Branch Model (Per-Repo)

### Branch creation (engine.ts)

At batch start, the orchestrator creates `orch/{opId}-{batchId}` in **every
repo** in the workspace, not just the default repo:

```typescript
for (const [repoId, repoConf] of workspaceConfig.repos) {
    const repoBranch = getCurrentBranch(repoConf.path) || "HEAD";
    runGit(["branch", orchBranch, repoBranch], repoConf.path);
}
```

**Why every repo:** Tasks can target any repo. If TP-002 targets api-service,
the lane worktree branches from api-service's orch branch. If the orch branch
doesn't exist there, worktree creation fails.

### Merge target (merge.ts)

Wave merges ALWAYS target the orch branch passed from engine.ts. The merge
flow does NOT call `resolveBaseBranch()` (which returns the repo's current
branch, e.g., `develop`). Instead:

```typescript
const groupBaseBranch = baseBranch; // baseBranch IS the orch branch
```

**Why not resolveBaseBranch:** In workspace mode, `resolveBaseBranch()` detects
each repo's current HEAD (develop), which bypasses the orch branch model entirely.
Merges would go directly to develop, making `/orch-integrate` a no-op.

### Branch advancement (merge.ts)

After lane merges succeed, the orch branch is updated via `git update-ref`
(not `git merge --ff-only`), because the orch branch is NOT checked out in
the main repo:

```typescript
const checkedOutBranch = getCurrentBranch(repoRoot);
const targetIsCheckedOut = checkedOutBranch === targetBranch;

if (targetIsCheckedOut) {
    // git merge --ff-only (updates HEAD + index + worktree)
} else {
    // git update-ref (safe, doesn't touch working tree)
}
```

### Integration (/orch-integrate in extension.ts)

`/orch-integrate` loops over ALL workspace repos that have the orch branch:

```typescript
for (const [repoId, repoConf] of wsConfig.repos) {
    const branchCheck = runGit(["rev-parse", "--verify", `refs/heads/${orchBranch}`], repoConf.path);
    if (branchCheck.ok) {
        reposToIntegrate.push({ id: repoId, root: repoConf.path });
    }
}
```

Each repo is fast-forwarded independently. Commit counts are measured BEFORE
the ff merge (after ff, `HEAD === orch tip` so count would be 0).

---

## 5. Cross-Repo Task Execution

### The problem

Tasks live in `shared-libs/task-management/...` but workers execute in
`api-service/.worktrees/.../lane-1/` or `web-client/.worktrees/.../lane-1/`.
Three things need absolute paths:

### TASK_AUTOSTART (execution.ts)

Workers need to find the task's PROMPT.md. In workspace mode, the path is
absolute (the canonical path in shared-libs), not relative to the worktree:

```typescript
if (workspaceRoot) {
    // Workspace mode: always use absolute path for cross-repo safety
    relativePath = resolve(promptPath);
} else if (promptNorm.startsWith(repoRootNorm + "/")) {
    // Repo mode: relative path (mirrors into worktree)
    relativePath = promptNorm.slice(repoRootNorm.length + 1);
}
```

### .DONE detection (execution.ts)

The orchestrator polls for `.DONE` to detect task completion. In workspace mode,
`.DONE` is written by the worker to the canonical task folder (shared-libs),
not the worktree. `resolveCanonicalTaskPaths()` uses `isWorkspaceMode` to
return the absolute canonical path:

```typescript
if (isWorkspaceMode) {
    resolvedFolder = resolve(taskFolder); // canonical path
} else if (folderNorm.startsWith(repoRootNorm + "/")) {
    resolvedFolder = join(worktreePath, relativePath); // worktree mirror
}
```

This flag is threaded through:
- `pollUntilTaskComplete()` — polls .DONE
- `monitorLanes()` — reads STATUS.md for dashboard
- `parseWorktreeStatusMd()` — checkbox progress
- `resolveTaskDonePath()` — used by monitor

### TASKPLANE_WORKSPACE_ROOT (execution.ts)

Lane sessions need this env var so the task-runner inside the lane can find
the workspace config. The condition must be `if (workspaceRoot)` — NOT
`if (workspaceRoot !== repoRoot)` because in workspace mode `cwd === workspaceRoot`:

```typescript
if (workspaceRoot) {
    vars.TASKPLANE_WORKSPACE_ROOT = workspaceRoot;
}
```

---

## 6. Task Artifact Commit Flow

Workers write `.DONE` and `STATUS.md` updates to the canonical task folder
(shared-libs/task-management/...) via absolute paths. These changes land as
uncommitted modifications in shared-libs's working tree (on `develop`).

These artifacts must end up on the **orch branch**, not develop. The solution:
copy them into the merge worktree (which is on the orch branch's temp branch)
and commit there.

### Flow (merge.ts, after lane merges succeed, before update-ref)

```
1. git status --porcelain in repoRoot (shared-libs)
2. Filter for .DONE and STATUS.md files (exclude .worktrees/ paths)
3. Copy each file: repoRoot/{file} → mergeWorkDir/{file}
4. git add + git commit in mergeWorkDir
5. Leave .DONE and STATUS.md in develop's working tree (do NOT delete/revert)
6. update-ref advances orch branch to include the artifact commit
```

**Why leave files in develop's working tree:**
- STATUS.md: dashboard reads from canonical path for live progress display
- .DONE: harmless untracked files, cleaned up by `/orch-integrate` auto-stash
- Previous approach of deleting/reverting caused: dashboard showing stale
  progress (v0.5.10), .DONE files missing after ff (v0.5.12)

**Why `/orch-integrate` auto-stashes:** The dirty STATUS.md and .DONE files
in develop's working tree would block `git merge --ff-only`. The integrate
command stashes before ff and pops after. After ff, the working tree matches
the orch branch content, so the stash pop is clean.

**Why not commit to develop:** Committing to develop causes develop and the
orch branch to diverge, blocking `/orch-integrate` fast-forward.

**Why not commit to the lane branch:** The worker writes to the canonical path
(shared-libs), not to the lane's worktree (which may be in api-service). The
lane branch only has commits from the repo it's checked out in.

---

## 7. Task Runner Extension Path (execution.ts)

Lane sessions spawn `pi --no-session -e <task-runner-path>`. The task-runner
extension path must be resolved from the installed npm package, NOT from
`{repoRoot}/extensions/task-runner.ts` (which only exists in the taskplane dev repo):

```typescript
function resolveTaskRunnerExtensionPath(repoRoot: string): string {
    // 1. Local project (taskplane development)
    const localPath = join(resolve(repoRoot), "extensions", "task-runner.ts");
    if (existsSync(localPath)) return localPath;

    // 2. Global npm install paths
    // APPDATA, HOME/.npm-global, /usr/local/lib, etc.
    // 3. Peer of pi's package
    // ...
}
```

---

## 8. Bugs Discovered and Fixed (Chronological)

| Version | Bug | Root Cause | Fix |
|---------|-----|-----------|-----|
| v0.5.1 | Lane sessions couldn't find task-runner extension | Hardcoded `{repoRoot}/extensions/task-runner.ts` | `resolveTaskRunnerExtensionPath()` searches npm paths |
| v0.5.1 | No integration message at batch completion | `orchBatchComplete()` didn't mention orch branch | Added orchBranch + /orch-integrate instructions |
| v0.5.1 | Batch state deleted, /orch-integrate had nothing to read | `deleteBatchState()` on clean completion | Preserve state when orchBranch exists |
| v0.5.2 | `TASKPLANE_WORKSPACE_ROOT` not set | Condition `workspaceRoot !== repoRoot` always false | Changed to `if (workspaceRoot)` |
| v0.5.3 | Cross-repo TASK_AUTOSTART path unresolvable | Relative path from workspace root doesn't exist in repo worktree | Absolute path in workspace mode |
| v0.5.4 | .DONE not detected (task never completes) | Polled in worktree, but .DONE written to canonical path | `isWorkspaceMode` flag → absolute canonical path |
| v0.5.5 | Task artifacts uncommitted in shared-libs | Workers wrote to canonical path, nobody committed them | `commitWorkspaceTaskArtifacts()` (later replaced) |
| v0.5.6 | Dashboard missing Wave 3 merge sub-rows | `repoResults.length >= 2` threshold | Changed to `>= 1` |
| v0.5.7 | Orch branch only in default repo | Created only in `repoRoot` | Loop over all workspace repos |
| v0.5.7 | Merges bypassed orch branch | `resolveBaseBranch()` returned develop | Use `baseBranch` directly (IS the orch branch) |
| v0.5.8 | Task artifacts committed to develop, not orch branch | `commitWorkspaceTaskArtifacts()` committed to checked-out branch | Copy artifacts into merge worktree instead |
| v0.5.9 | `/orch-integrate` only integrated default repo | Single-repo git operations | Loop over all repos with orch branch |
| v0.5.10 | Commit count showed 0 after integration | Measured after ff when HEAD === orch tip | Measure before ff |
| v0.5.10 | Dashboard wave bar stale (W1 orange not green) | STATUS.md reverted by `git checkout --` after artifact staging | Stop reverting STATUS.md — keep in working tree for dashboard |
| v0.5.11 | `/orch-integrate` blocked by dirty STATUS.md | Working tree STATUS.md modifications blocked ff merge | Auto-stash before ff/merge, pop after |
| v0.5.11 | Batch completion message unclear | Three options confused users | Simplified to two: "Apply now" and "Open PR" |
| v0.5.12 | `.DONE` files missing after `/orch-integrate` | `unlinkSync` deleted .DONE from working tree during artifact staging; after ff they weren't reliably restored | Stop deleting .DONE files — stash in `/orch-integrate` handles them |
| v0.5.12 | `.worktrees/` committed to orch branch | Artifact staging filter didn't exclude worktree paths | Added `.worktrees/` exclusion to artifact file filter |
| v0.5.12 | Test failures from global preferences leaking | `loadProjectConfig` in tests merged `~/.pi/agent/taskplane/preferences.json` | Fixed test to check individual fields, not `toEqual` on full object |

### Pattern: every bug was a "workspace root ≠ repo root" assumption

The codebase was built for repo mode where `cwd = repoRoot = workspaceRoot`.
Every workspace bug was a place where this assumption leaked through:
- Path resolution (relative from wrong root)
- Git operations (in wrong repo)
- Config loading (from wrong directory)
- Polling (in wrong directory)
- Branch operations (in wrong repo)

---

## 9. Smoke Test Checklist

After any changes to the workspace/orch flow, validate with the polyrepo
smoke test skill (`.pi/skills/polyrepo-smoke-test/SKILL.md`):

- [ ] `taskplane init` detects workspace mode
- [ ] `taskplane doctor` passes
- [ ] `/orch-plan all` shows correct waves (3 waves, 6 tasks)
- [ ] `/orch all` executes — all 3 lane sessions start
- [ ] All lanes show task progress (not "0 areas")
- [ ] Wave 1 merge succeeds (3 repos)
- [ ] Wave 2 executes (2 lanes, cross-repo deps resolved)
- [ ] Wave 3 executes and merges
- [ ] Dashboard shows all waves with repo sub-rows
- [ ] Batch completion message shows orch branch + /orch-integrate
- [ ] `develop` branch untouched in all repos before integrate
- [ ] `/orch-integrate` succeeds in all repos
- [ ] Commit count > 0
- [ ] Orch branches cleaned up
- [ ] No dirty working tree in any repo

---

## 10. Known Remaining Issues

| Issue | Severity | Tracking | Description |
|-------|----------|----------|-------------|
| Lane worktrees/branches not cleaned in non-final-wave repos | Minor | [#93](https://github.com/HenryLach/taskplane/issues/93) | Only repos active in the last wave get worktree cleanup. Repos from earlier waves retain full worktree dirs, registered git worktrees, and lane branches. |
| Stale auto-stashes after integrate | Minor | [#93](https://github.com/HenryLach/taskplane/issues/93) | `/orch-integrate` auto-stash entries persist in `git stash list` after successful pop. Previous run stashes also accumulate. |
| Empty `.worktrees/` parent dirs | Cosmetic | [#93](https://github.com/HenryLach/taskplane/issues/93) | Even after worktree cleanup, the `.worktrees/` parent directory remains as an empty untracked directory. |
| `taskplane init` `tasks_root` default | UX | — | Defaults to `"taskplane-tasks"` instead of detecting where task areas actually live. Requires manual fix. |
| `taskplane init` `default_branch` | UX | — | Not set per repo. Repos using `develop` (not `main`) need manual config. |
| Pi input prompt not visible after batch | UX | [#88](https://github.com/HenryLach/taskplane/issues/88) | After batch completion, pi's text input editor isn't visible. User must click terminal and type blind. |
| Test isolation for global preferences | Testing | — | `loadProjectConfig` in tests reads `~/.pi/agent/taskplane/preferences.json`, causing test results to vary by machine. Should mock HOME or isolate prefs. |
