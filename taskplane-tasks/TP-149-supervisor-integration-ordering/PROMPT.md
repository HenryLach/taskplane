# Task: TP-149 - Supervisor Integration Mode Ordering

**Created:** 2026-04-07
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Small change to supervisor integration logic. Low blast radius.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-149-supervisor-integration-ordering/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Fix the supervisor's integration mode selection to try modes in the correct order. (#459)

### Current behavior

When the supervisor runs `orch_integrate` autonomously (auto integration mode), it:
1. Tries PR mode (fails if no remotes)
2. Tries fast-forward (fails if branches diverged)
3. Tries merge (may have conflicts)

### Expected behavior

1. Try fast-forward first (cleanest, most common)
2. If FF fails (diverged), try merge commit
3. Only try PR mode if remotes exist

### Additional improvement

Before attempting integration, check if any repo has remotes configured. If none do, skip PR mode entirely and go straight to FF → merge.

## Environment

- **Workspace:** `extensions/taskplane/`, `dashboard/`, `bin/`
- **Services required:** None
- **Submodule workspace:** `.pi/git/github.com/loopyd/taskplane` (absolute: `/mnt/PROJECTS/repos/bof3-decomp/.pi/git/github.com/loopyd/taskplane`)


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## Dependencies

- None

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/supervisor.ts` — integration logic
- `extensions/taskplane/extension.ts` — orch-integrate command handler
- `templates/agents/supervisor.md` — supervisor prompt

## File Scope

- `extensions/taskplane/supervisor.ts`
- `templates/agents/supervisor.md`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read supervisor.ts integration logic
- [ ] Read extension.ts orch-integrate handler

### Step 1: Fix integration mode ordering
- [ ] Check for remotes before attempting PR mode
- [ ] Default order: fast-forward → merge → PR (only if remotes exist)
- [ ] Log which mode was attempted and why it failed/succeeded
- [ ] Update supervisor prompt if it contains integration guidance
- [ ] Run targeted tests

### Step 2: Testing & Verification
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 3: Documentation & Delivery
- [ ] Update STATUS.md

## Git Commit Convention

- `feat(TP-149): complete Step N — description`

## Do NOT

- Change the orch_integrate tool API
- Remove PR mode entirely (it's needed for repos with remotes/protection)
- Force-push or modify remote branches

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
