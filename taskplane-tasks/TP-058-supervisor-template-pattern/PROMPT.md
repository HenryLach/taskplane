# Task: TP-058 - Supervisor Template Pattern

**Created:** 2026-03-24
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Refactors the supervisor prompt from inline code to the composable template pattern used by workers, reviewers, and mergers. Medium blast radius — touches supervisor spawn, templates, init/onboarding, and config loading. No new patterns (follows established template inheritance), but the supervisor prompt is large and has dynamic sections.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-058-supervisor-template-pattern/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

The supervisor agent is the only agent type without the base+local template inheritance pattern. Its entire system prompt is built inline in `supervisor.ts` via `buildSupervisorSystemPrompt()` (~200 lines) and `buildRoutingSystemPrompt()` (~150 lines). Users cannot customize supervisor behavior without editing extension source code.

Refactor the supervisor to follow the same composable template pattern as workers, reviewers, and mergers:
- `templates/agents/supervisor.md` — base template, ships with npm, auto-updates
- `templates/agents/local/supervisor.md` — local scaffold, copied to `.pi/agents/supervisor.md` during init
- `.pi/agents/supervisor.md` — project-specific overrides, composed with base at runtime

Dynamic data (batch metadata, autonomy level, wave counts, file paths) is still injected by code, but the static prompt structure lives in an editable template.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/supervisor.ts` — `buildSupervisorSystemPrompt()` (~line 1773) and `buildRoutingSystemPrompt()` (~line 2016). These contain the full prompt content to extract.
- `templates/agents/task-worker.md` — reference for the base template format (frontmatter, section structure)
- `templates/agents/local/task-worker.md` — reference for the local scaffold format
- `extensions/taskplane/extension.ts` — `handleInit()` and onboarding flow that copies local templates to `.pi/agents/`
- `extensions/task-runner.ts` — `loadAgentDef()` function that loads and composes agent definitions

## Environment

- **Workspace:** `extensions/taskplane/`, `templates/`
- **Services required:** None

## File Scope

- `templates/agents/supervisor.md` (new)
- `templates/agents/local/supervisor.md` (new)
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/extension.ts`
- `extensions/tests/supervisor-template.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `buildSupervisorSystemPrompt()` in `supervisor.ts` (~line 1773) — understand all static vs dynamic sections
- [ ] Read `buildRoutingSystemPrompt()` in `supervisor.ts` (~line 2016) — understand routing prompt structure
- [ ] Read the worker base template (`templates/agents/task-worker.md`) — understand format conventions
- [ ] Read `loadAgentDef()` in `task-runner.ts` — understand how base+local templates are composed
- [ ] Read `handleInit()` in `extension.ts` — understand how local scaffolds are copied during init

### Step 1: Create Base and Local Templates

**Base template (`templates/agents/supervisor.md`):**

Extract the STATIC sections from `buildSupervisorSystemPrompt()` into a markdown template. The template should contain:

- Identity section ("You are the batch supervisor...")
- Standing orders (monitor events, handle failures, keep operator informed, log actions, respect autonomy)
- Recovery action classification matrix (diagnostic, tier0 known, destructive)
- Audit trail format and rules
- Operational knowledge reference (primer path placeholder)
- Startup checklist
- Available orchestrator tools section (orch_status, orch_pause, etc.)

**What stays in code (dynamic):**
- Current batch context block (batchId, phase, branches, task counts) — injected as template variables
- Autonomy decision table (varies by autonomy level)
- Guardrails section (varies by integration mode — manual vs supervised vs auto)
- Key file paths (batch-state.json, events.jsonl, actions.jsonl)

Use template variable placeholders for dynamic values, e.g., `{{batchId}}`, `{{phase}}`, `{{autonomy}}`. The code replaces these at runtime.

**Also create a routing template** — either a separate `templates/agents/supervisor-routing.md` or a clearly marked section within the main template that `buildRoutingSystemPrompt()` can reference. The routing prompt has different static content (onboarding scripts, task creation guidance) but follows the same dynamic injection pattern.

**Local scaffold (`templates/agents/local/supervisor.md`):**

Follow the same pattern as `templates/agents/local/task-worker.md`:
- Frontmatter with `name: supervisor`
- Comments explaining what the base prompt handles
- Guidance on what to customize (project-specific supervisor behavior)
- Examples from issue #135 (linter before integration, CI dashboard URL, PR templates, etc.)

**Artifacts:**
- `templates/agents/supervisor.md` (new)
- `templates/agents/supervisor-routing.md` (new, if separate)
- `templates/agents/local/supervisor.md` (new)

### Step 2: Refactor Prompt Building to Use Templates

Update `buildSupervisorSystemPrompt()` and `buildRoutingSystemPrompt()` to:

1. Load the base template via the same `loadAgentDef()` pattern (or a supervisor-specific loader)
2. Replace template variable placeholders with dynamic values
3. Append the local override (`.pi/agents/supervisor.md`) if it exists
4. Return the composed prompt

The existing function signatures should stay the same — callers don't need to change.

**Fallback:** If the base template can't be found (e.g., older installation), fall back to the current inline prompt. This ensures backward compatibility during the transition.

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified — refactored prompt builders)

### Step 3: Update Init and Onboarding

Update `handleInit()` in `extension.ts` to:

1. Copy `templates/agents/local/supervisor.md` → `.pi/agents/supervisor.md` during `taskplane init` (alongside existing worker/reviewer/merger copies)
2. Update `taskplane doctor` to check for `.pi/agents/supervisor.md` existence

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Create `extensions/tests/supervisor-template.test.ts` with:
  - Template file existence tests (base + local scaffold exist in templates/)
  - Template content tests (required sections present, placeholder variables defined)
  - Prompt builder tests (templates are loaded and variables are replaced)
  - Local override composition tests (project-specific content appended)
  - Fallback tests (missing template → inline prompt still works)
  - Init integration tests (supervisor template copied during init)
  - Source-based tests for refactored prompt builders
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 5: Documentation & Delivery

- [ ] Update `extensions/taskplane/supervisor-primer.md` — note that supervisor prompt is now template-based
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/supervisor-primer.md` — mention template-based supervisor prompt

**Check If Affected:**
- `docs/reference/commands.md` — `/settings` or init docs may reference agent templates
- `docs/explanation/architecture.md` — may describe the agent template pattern

## Completion Criteria

- [ ] `templates/agents/supervisor.md` base template contains all static supervisor prompt content
- [ ] `templates/agents/local/supervisor.md` scaffold follows the same pattern as other agents
- [ ] `buildSupervisorSystemPrompt()` loads template and injects dynamic values
- [ ] `buildRoutingSystemPrompt()` loads template and injects dynamic values
- [ ] `.pi/agents/supervisor.md` created during `taskplane init`
- [ ] Local override content is appended to base template at runtime
- [ ] Fallback to inline prompt works when template is missing
- [ ] All tests passing (existing + new)
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-058): complete Step N — description`
- **Bug fixes:** `fix(TP-058): description`
- **Tests:** `test(TP-058): description`
- **Hydration:** `hydrate: TP-058 expand Step N checkboxes`

## Do NOT

- Change supervisor behavior — only extract the prompt to templates
- Remove any dynamic injection (batch metadata, autonomy, etc.)
- Break backward compatibility — missing template must fall back to inline prompt
- Modify the supervisor-primer.md content (it's a read-only runbook, not a template)
- Change the routing/onboarding conversation flow logic
- Change the `buildSupervisorSystemPrompt` / `buildRoutingSystemPrompt` function signatures

---

## Amendments (Added During Execution)

