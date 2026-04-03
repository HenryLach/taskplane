# Task: TP-128 - Full Package TMUX Extrication

**Created:** 2026-04-02
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Extends TMUX removal beyond orch runtime to cover task-runner.ts, CLI, and supervisor templates. Touches legacy code that may have hidden consumers.
**Score:** 4/8 — Blast radius: 2 (task-runner, CLI, templates), Pattern novelty: 1 (removing dead code), Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-128-full-package-tmux-extrication/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Complete the TMUX extrication across the entire taskplane package. The orch runtime (`extensions/taskplane/*`) is clean (TP-117–126), but TMUX code remains in:

1. **`extensions/task-runner.ts`** — `spawnAgentTmux`, `spawn_mode: "tmux"` env branch, TMUX session helpers. This is the legacy `/task` runner (deprecated, replaced by `/orch`).
2. **`bin/taskplane.mjs`** — CLI doctor/install-tmux guidance, TMUX availability checks.
3. **Supervisor templates** — `templates/agents/supervisor.md`, `extensions/taskplane/supervisor-primer.md`, `extensions/taskplane/supervisor.ts` may reference TMUX operations or suggest TMUX remediation.
4. **Audit script scope** — `scripts/tmux-reference-audit.mjs` only scans `extensions/taskplane/*.ts`, should cover the full package.

After this task, no file in the published package should contain functional TMUX code. The only acceptable TMUX references are migration comments and the `tmux-compat.ts` shim.

## Dependencies

- **Task:** TP-126 (final compat removal — done)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — legacy /task runner with TMUX spawn paths
- `bin/taskplane.mjs` — CLI entry point with doctor checks
- `templates/agents/supervisor.md` — supervisor system prompt
- `extensions/taskplane/supervisor-primer.md` — supervisor operational primer
- `scripts/tmux-reference-audit.mjs` — audit script to expand

## File Scope

- `extensions/task-runner.ts`
- `bin/taskplane.mjs`
- `templates/agents/supervisor.md`
- `extensions/taskplane/supervisor-primer.md`
- `extensions/taskplane/supervisor.ts`
- `scripts/tmux-reference-audit.mjs`
- `extensions/tests/*.test.ts` (tests for removed task-runner TMUX code)

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Count TMUX references in task-runner.ts, bin/taskplane.mjs, templates/, supervisor files
- [ ] Log inventory in STATUS.md

### Step 1: Remove TMUX from task-runner.ts
- [ ] Remove `spawnAgentTmux` function and TMUX session spawning code
- [ ] Remove `spawn_mode: "tmux"` environment branch handling
- [ ] Remove TMUX session helpers only used by task-runner (not shared with orch)
- [ ] Keep the task-runner functional for `/task` mode (subprocess only)
- [ ] Update tests that reference removed TMUX task-runner code

### Step 2: Remove TMUX from CLI
- [ ] Remove TMUX availability checks from doctor/preflight in bin/taskplane.mjs
- [ ] Remove install-tmux guidance messages
- [ ] Update any TMUX-related CLI help text

### Step 3: De-TMUX supervisor templates and primer
- [ ] Remove TMUX operation references from templates/agents/supervisor.md
- [ ] Remove TMUX remediation suggestions from supervisor-primer.md
- [ ] Check supervisor.ts for TMUX fallback instructions and remove

### Step 4: Expand audit script scope
- [ ] Update scripts/tmux-reference-audit.mjs to scan full package (extensions/, bin/, templates/, dashboard/)
- [ ] Update the guard test if needed to cover expanded scope

### Step 5: Tests and verification
- [ ] Run full test suite
- [ ] Fix all failures
- [ ] Run the expanded audit script and verify results

### Step 6: Documentation & Delivery
- [ ] Update STATUS.md with completion summary
- [ ] Log final TMUX reference count across entire package

## Do NOT

- Remove tmux-compat.ts (needed for one-release state migration)
- Remove config-loader migration error throwing (needed for user migration)
- Break the legacy /task command entirely (keep subprocess path working)

## Git Commit Convention

- `feat(TP-128): complete Step N — ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
