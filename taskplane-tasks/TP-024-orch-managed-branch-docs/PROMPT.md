# Task: TP-024 - Orch-Managed Branch Documentation

**Created:** 2026-03-18
**Size:** S

## Review Level: 0 (None)

**Assessment:** Documentation only — no code changes, no security impact, easily reversible.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-024-orch-managed-branch-docs/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Update all user-facing documentation to reflect the orchestrator-managed branch model. The code changes are done (TP-020 through TP-023) — this task ensures docs match the new behavior.

## Dependencies

- **Task:** TP-023 (`/orch-integrate` command must exist)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/orch-managed-branch-spec.md` — full spec (source of truth for behavior)
- `docs/reference/commands.md` — existing command docs
- `docs/reference/configuration/taskplane-settings.md` — settings reference
- `README.md` — command table and overview

## Environment

- **Workspace:** `docs/`, root
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `docs/reference/commands.md`
- `docs/reference/configuration/taskplane-settings.md`
- `docs/explanation/architecture.md`
- `README.md`

## Steps

### Step 0: Preflight

- [ ] Read current `docs/reference/commands.md` — identify where `/orch-integrate` should be added
- [ ] Read current `docs/reference/configuration/taskplane-settings.md` — identify where Integration setting goes
- [ ] Read `README.md` — identify command table
- [ ] Read `docs/explanation/architecture.md` — check if merge flow description needs update

### Step 1: Add `/orch-integrate` to Commands Reference

- [ ] Add `/orch-integrate` entry to `docs/reference/commands.md` with:
  - Description: integrates completed orch batch into working branch
  - Arguments: `--merge`, `--pr`, `--force`
  - Branch safety check behavior
  - Examples of each mode
- [ ] Update `/orch` entry to mention that it creates an orch branch and no longer touches the user's branch
- [ ] Update the batch completion flow description

**Artifacts:**
- `docs/reference/commands.md` (modified)

### Step 2: Update Settings Reference

- [ ] Add Integration setting row to the Orchestrator section in `docs/reference/configuration/taskplane-settings.md`
  - Setting: Integration
  - Type: enum
  - Default: `manual`
  - Options: `manual`, `auto`
  - Description: How completed batches are integrated

**Artifacts:**
- `docs/reference/configuration/taskplane-settings.md` (modified)

### Step 3: Update README and Architecture

- [ ] Add `/orch-integrate` to the command table in `README.md`
- [ ] Update the orchestrator workflow description in README if it mentions merging into the user's branch
- [ ] Update `docs/explanation/architecture.md` if it describes the merge flow (replace "merges into base branch" with "merges into orch branch, user integrates")

**Artifacts:**
- `README.md` (modified)
- `docs/explanation/architecture.md` (modified, if needed)

### Step 4: Documentation & Delivery

- [ ] Review all changes for consistency
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/commands.md` — add `/orch-integrate`
- `docs/reference/configuration/taskplane-settings.md` — add Integration setting
- `README.md` — add command to table

**Check If Affected:**
- `docs/explanation/architecture.md` — merge flow description
- `docs/how-to/troubleshoot-common-issues.md` — merge troubleshooting may reference old flow

## Completion Criteria

- [ ] `/orch-integrate` fully documented in commands reference
- [ ] Integration setting documented in settings reference
- [ ] README command table updated
- [ ] Architecture doc reflects new merge model (if applicable)
- [ ] No references to "merging into user's branch" remain in docs

## Git Commit Convention

- **Step completion:** `docs(TP-024): complete Step N — description`
- **Hydration:** `hydrate: TP-024 expand Step N checkboxes`

## Do NOT

- Make any code changes
- Modify templates (those are generic scaffolding, not project-specific)
- Add internal/planning docs to public documentation
- Reference `.pi/local/docs/` paths in public docs

---

## Amendments (Added During Execution)
