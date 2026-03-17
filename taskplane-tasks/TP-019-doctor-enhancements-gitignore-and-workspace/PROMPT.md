# Task: TP-019 - Doctor Enhancements: Gitignore, Artifact, and Workspace Validation

**Created:** 2026-03-17
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Extends existing `cmdDoctor()` with additional checks. No new architecture — adds validation logic to a well-understood function. Low risk.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-019-doctor-enhancements-gitignore-and-workspace/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Enhance `taskplane doctor` with gitignore validation, tracked artifact detection, workspace pointer chain validation, config repo default branch checks, and legacy YAML migration warnings. These checks ensure project health across all onboarding scenarios.

See spec: `.pi/local/docs/settings-and-onboarding-spec.md` — Git tracking rules (Doctor checks), Resolved Decision #2 (config branch), #5 (full chain validation), and Migration path.

## Dependencies

- **Task:** TP-015 (Init v2 — gitignore entries must exist for doctor to validate)
- **Task:** TP-016 (Pointer resolution — doctor validates the pointer chain)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/settings-and-onboarding-spec.md` — doctor checks spec

## Environment

- **Workspace:** `bin/taskplane.mjs`
- **Services required:** None

## File Scope

- `bin/taskplane.mjs`

## Steps

### Step 0: Preflight

- [ ] Read current `cmdDoctor()` implementation
- [ ] Read spec sections on doctor checks

### Step 1: Gitignore and Tracked Artifact Checks

- [ ] Check `.gitignore` exists and has required taskplane entries
- [ ] Check no runtime artifacts are tracked by git (`git ls-files`)
- [ ] Show actionable remediation for each issue

### Step 2: Workspace Pointer Chain Validation

- [ ] In workspace mode: validate pointer file → config repo → `.taskplane/` directory
- [ ] Validate each repo listed in `workspace.json` exists on disk
- [ ] Check `.taskplane/` exists on config repo's default branch (not just current branch)

### Step 3: Legacy Config Migration Warning

- [ ] Detect YAML config without JSON equivalent
- [ ] Warn: "Legacy YAML config detected. Use /settings to migrate."

### Step 4: tmux Availability vs spawn_mode Check

- [ ] If project config has `spawn_mode: "tmux"` but tmux is not installed, show error with `taskplane install-tmux` suggestion

### Step 5: Testing & Verification

- [ ] Test doctor output with missing gitignore, tracked artifacts, missing pointer
- [ ] Run: `node bin/taskplane.mjs doctor`

### Step 6: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (doctor output is self-documenting)

**Check If Affected:**
- `docs/tutorials/install.md` — doctor section

## Completion Criteria

- [ ] All steps complete
- [ ] All new checks produce clear, actionable output
- [ ] Existing doctor checks unchanged
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-019): description`
- **Checkpoints:** `checkpoint: TP-019 description`

## Do NOT

- Remove any existing doctor checks
- Make doctor modify files (it's read-only diagnostics)
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
