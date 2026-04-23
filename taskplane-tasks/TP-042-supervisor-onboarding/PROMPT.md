# Task: TP-042 — Supervisor Onboarding & /orch Routing

**Created:** 2026-03-21
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds context-aware routing to /orch and onboarding conversation flows. Changes the primary user entry point. Must handle all project states correctly.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-042-supervisor-onboarding/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Make `/orch` (with no arguments) the universal entry point for Taskplane. When
invoked without arguments, the supervisor assesses the project state and offers
the most relevant next action:

- **No config exists:** Initiate onboarding (project setup, task areas, git branching)
- **Config exists, pending tasks:** Offer to plan/start a batch
- **Config exists, no pending tasks:** Help create tasks (from specs, GitHub Issues, or conversation)
- **Batch running:** Report status
- **Batch completed, not integrated:** Offer integration

Implement the onboarding scripts from the spec (Scripts 1-5) as conversational
guides that the supervisor follows during first-time setup.

## Dependencies

- **Task:** TP-041 (supervisor agent must be functional)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/watchdog-and-recovery-tiers.md` — Section 14 (all subsections)
- `extensions/taskplane/extension.ts` — /orch command handler
- `extensions/taskplane/supervisor.ts` — supervisor module (from TP-041)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/supervisor-primer.md`
- `extensions/tests/supervisor-onboarding.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read spec Section 14 — all onboarding scripts and routing logic
- [ ] Read current /orch command handler — understand how args are parsed
- [ ] Read supervisor.ts from TP-041

### Step 1: /orch Routing Logic

- [ ] When `/orch` is called with no arguments:
  1. Check if config exists (`.pi/taskplane-config.json`)
  2. Check if a batch is active (`batch-state.json` with non-terminal phase)
  3. Check if a completed batch needs integration (orch branch exists)
  4. Check for pending tasks (scan task areas)
  5. Route to appropriate supervisor conversation based on state
- [ ] When `/orch` is called WITH arguments (e.g., `all`, area names): existing behavior (start batch directly)
- [ ] `/orch` with no args + no config → onboarding flow
- [ ] `/orch` with no args + config + pending tasks → "ready to run, want me to start?"
- [ ] `/orch` with no args + config + no tasks → "what would you like to work on?"

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 2: Onboarding Flow (Scripts 1-5)

- [ ] Implement project detection: read repo structure, package files, git branches, existing docs
- [ ] Supervisor prompt includes onboarding script guidance from the primer
- [ ] Conversational task area setup: supervisor proposes areas based on project structure, operator refines
- [ ] Git branching assessment: detect branch strategy, check protection, recommend configuration
- [ ] Config generation: write `.pi/taskplane-config.json`, CONTEXT.md files, `.pi/agents/` overrides, .gitignore entries
- [ ] First-task guidance: offer to create a task, pull from GitHub Issues, or run a smoke test

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)
- `extensions/taskplane/supervisor-primer.md` (updated with onboarding scripts if needed)

### Step 3: Returning User Flows (Scripts 6-8)

- [ ] Script 6 (batch planning): surface pending tasks, tech debt, GitHub Issues — help decide what to work on
- [ ] Script 7 (health check): config validity, git state, stale worktrees, task inventory
- [ ] Script 8 (retrospective): triggered after integration — summarize batch, recommend improvements

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: /orch with no args and no config → onboarding flow activated
- [ ] Test: /orch with no args, config exists, pending tasks → batch planning offered
- [ ] Test: /orch with no args, config exists, no tasks → "what to work on" flow
- [ ] Test: /orch with no args, batch running → status report
- [ ] Test: /orch with args → existing behavior (start batch directly)
- [ ] Test: /orch all still works as before
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update `docs/reference/commands.md` — document /orch with no arguments
- [ ] Update `docs/tutorials/run-your-first-orchestration.md` — reflect new /orch entry point
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/commands.md` — /orch no-args behavior
- `docs/tutorials/run-your-first-orchestration.md` — updated first-run experience

**Check If Affected:**
- `README.md` — quick start section

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] /orch with no args routes to correct supervisor flow based on project state
- [ ] Onboarding creates valid config from conversation
- [ ] Existing /orch behavior with args preserved
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-042): complete Step N — description`
- **Bug fixes:** `fix(TP-042): description`
- **Tests:** `test(TP-042): description`
- **Hydration:** `hydrate: TP-042 expand Step N checkboxes`

## Do NOT

- Change the supervisor agent core (that's TP-041)
- Implement auto-integration (that's TP-043)
- Implement dashboard changes (that's TP-044)
- Remove `taskplane init` CLI command (it stays as fallback for non-interactive use)

---

## Amendments (Added During Execution)
