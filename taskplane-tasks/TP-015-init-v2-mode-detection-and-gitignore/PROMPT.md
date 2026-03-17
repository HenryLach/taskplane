# Task: TP-015 - Init v2: Mode Detection, Gitignore, and Artifact Cleanup

**Created:** 2026-03-17
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Major rework of `taskplane init` with mode auto-detection, gitignore enforcement, tracked artifact cleanup, tmux detection, and JSON config output. High blast radius on the CLI entry point.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-015-init-v2-mode-detection-and-gitignore/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Rewrite `taskplane init` to auto-detect repo vs workspace mode, output JSON config (via TP-014's loader), enforce gitignore entries for runtime artifacts, detect and offer to untrack accidentally committed artifacts, and default to tmux spawn mode when tmux is available. This implements Scenarios A-D from the settings and onboarding spec.

See spec: `.pi/local/docs/settings-and-onboarding-spec.md` — Mode auto-detection, Git tracking rules, and all four onboarding scenarios.

## Dependencies

- **Task:** TP-014 (JSON config schema and loader must exist)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/settings-and-onboarding-spec.md` — full spec

## Environment

- **Workspace:** `bin/taskplane.mjs`
- **Services required:** None

## File Scope

- `bin/taskplane.mjs`
- `.gitignore` (template generation)

## Steps

### Step 0: Preflight

- [ ] Read current `cmdInit()` implementation in `bin/taskplane.mjs`
- [ ] Read the spec's mode auto-detection and gitignore sections

### Step 1: Mode Auto-Detection

- [ ] Implement detection logic: git repo check → subdirectory scan → mode determination
- [ ] Handle ambiguous case (git repo with git repo subdirectories) with user prompt
- [ ] Handle error case (no git repo, no git repo subdirectories)
- [ ] Detect existing config and show "already initialized" message for Scenario B

### Step 2: Gitignore Enforcement

- [ ] Add selective gitignore entries to `.gitignore` during init (create file if needed)
- [ ] Skip entries that already exist
- [ ] Include `.pi/npm/` for project-local installs
- [ ] Check for tracked runtime artifacts (`git ls-files`) and offer `git rm --cached`

### Step 3: tmux and Environment Detection

- [ ] Check for tmux availability during init
- [ ] Default `spawn_mode` to `"tmux"` when present, `"subprocess"` when not
- [ ] Show guidance message when tmux is not found

### Step 4: Workspace Mode Init (Scenario C)

- [ ] Scan for git repos in subdirectories
- [ ] Prompt for config repo selection
- [ ] Create `.taskplane/` directory with config, workspace.json, and agents in config repo
- [ ] Create `taskplane-pointer.json` in workspace root `.pi/`
- [ ] Add gitignore entries to config repo's `.gitignore`
- [ ] Show post-init guidance about merging to default branch

### Step 5: Workspace Join (Scenario D)

- [ ] Detect existing `.taskplane/` in any subdirectory repo
- [ ] Create pointer file only — skip all project init steps
- [ ] Show confirmation of which config was found

### Step 6: Testing & Verification

- [ ] Test all four scenarios with `--dry-run`
- [ ] Test mode detection edge cases
- [ ] Run: `node bin/taskplane.mjs init --dry-run --force`

### Step 7: Documentation & Delivery

- [ ] Update `docs/tutorials/install.md` for new init flow
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/tutorials/install.md` — new init flow with mode detection

**Check If Affected:**
- `README.md` — install section
- `docs/reference/commands.md` — init command reference

## Completion Criteria

- [ ] All steps complete
- [ ] All four scenarios work correctly
- [ ] Gitignore entries created for all required patterns
- [ ] Tracked artifacts detected and cleanup offered
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-015): description`
- **Checkpoints:** `checkpoint: TP-015 description`

## Do NOT

- Break existing `--preset` flags — they should still work
- Remove YAML config generation until JSON is fully validated
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
