# Task: TP-167 - Init Windows Backslash Path Normalization

**Created:** 2026-04-12
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Low-risk, single-file fix in CLI init command. Backslash normalization is a well-understood pattern.
**Score:** 1/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-167-init-windows-backslash-normalization/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix `taskplane init` on Windows writing backslash paths into `.pi/taskplane-workspace.yaml` and `.taskplane/taskplane-config.json` (#446). YAML parsers reject unescaped backslashes. All paths written to config files must use forward slashes.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

## Environment

- **Workspace:** `bin/`
- **Services required:** None

## File Scope

- `bin/taskplane.mjs`
- `extensions/tests/init*.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `bin/taskplane.mjs` init command — find where paths are written to YAML and JSON config
- [ ] Identify all code paths that write paths without normalization
- [ ] Check if there's an existing normalize utility in the codebase

### Step 1: Normalize Paths to Forward Slashes

- [ ] Add path normalization (`.replace(/\\/g, '/')`) before writing to workspace YAML
- [ ] Add path normalization before writing to taskplane-config.json
- [ ] Ensure all path-writing code paths are covered (workspace mode, repo mode, full preset, minimal preset)
- [ ] Run targeted tests: `tests/init*.test.ts`

**Artifacts:**
- `bin/taskplane.mjs` (modified)

### Step 2: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add test: init on path with backslashes → verify config files contain forward slashes only

### Step 3: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- `docs/tutorials/install.md` — verify no Windows-specific path caveats needed

## Completion Criteria

- [ ] All steps complete
- [ ] Config files from `taskplane init` use forward slashes on all platforms
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-167): complete Step N — description`
- **Hydration:** `hydrate: TP-167 expand Step N checkboxes`

## Do NOT

- Change path handling in runtime code (only init/scaffolding)
- Modify existing config loading logic
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

