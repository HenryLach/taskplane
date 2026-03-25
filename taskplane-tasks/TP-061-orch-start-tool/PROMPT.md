# Task: TP-061 - Add orch_start Tool

**Created:** 2026-03-25
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Registers one new tool that calls existing `startBatchAsync()`. Follows the pattern established by TP-053 for the other orch tools. Low risk.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-061-orch-start-tool/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

The supervisor has tools for managing batches (`orch_status`, `orch_resume`, `orch_pause`, `orch_abort`, `orch_integrate`) but cannot start one. Starting a batch requires the user to type `/orch all`. Add an `orch_start` tool so the supervisor can initiate batches programmatically.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/extension.ts` — existing orch tool registrations (search for `orch_status`, `orch_resume` etc.), `doOrchStart` or batch start logic, `/orch` command handler
- `extensions/taskplane/engine.ts` — `startBatchAsync()` function

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/tests/orch-supervisor-tools.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read existing orch tool registrations in `extension.ts` — understand the pattern (shared helper + tool registration)
- [ ] Find the `/orch` command handler — understand how `startBatchAsync()` is called with a target
- [ ] Read `startBatchAsync()` in `engine.ts` — understand parameters and return value

### Step 1: Register orch_start Tool

Follow the exact pattern used by the other orch tools (TP-053):

1. **Extract a shared helper** `doOrchStart(target, ctx)` if one doesn't already exist — wraps the batch start logic from the `/orch` command handler
2. **Register the tool:**
   ```
   orch_start(target: string)
   ```
   - `target`: `"all"` or a path to a specific PROMPT.md / task area
   - Returns immediate ACK: batch ID, task count, wave count — downstream progress is async
   - Guards: no batch already running, tasks exist, valid target
3. **Both `/orch` command and `orch_start` tool call the same shared helper**

**Important considerations:**
- The `/orch` command has complex routing logic (no-args → supervisor routing, with-args → batch start). The tool should only handle the batch-start path, not routing.
- The tool should return a text summary (batch started, ID, task count) not the full batch state
- Error cases: already running, no tasks found, invalid target → return descriptive error text

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 2: Update Supervisor Prompt

Add `orch_start` to the available tools section in the supervisor template:

- `templates/agents/supervisor.md` — add to the "Available Orchestrator Tools" section
- Brief description: `orch_start(target)` — start a new batch. Target is "all" or a path.

**Artifacts:**
- `templates/agents/supervisor.md` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite.

- [ ] Add `orch_start` tests to `extensions/tests/orch-supervisor-tools.test.ts`:
  - Tool is registered with correct schema (target parameter)
  - Tool includes description, promptSnippet, promptGuidelines
  - Source-based: shared helper exists and is called by both command and tool
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `templates/agents/supervisor.md` — add orch_start to tools section

**Check If Affected:**
- `docs/reference/commands.md` — mention orch_start tool availability

## Completion Criteria

- [ ] `orch_start` tool registered with target parameter
- [ ] Shared helper called by both `/orch` command and tool
- [ ] Guards prevent starting when batch already running
- [ ] Supervisor template lists the new tool
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-061): complete Step N — description`
- **Bug fixes:** `fix(TP-061): description`
- **Hydration:** `hydrate: TP-061 expand Step N checkboxes`

## Do NOT

- Change the `/orch` routing logic (no-args → supervisor mode)
- Add the tool to non-supervisor contexts — it should only be available when the supervisor is active
- Make the tool synchronous — batch start is async, tool returns immediate ACK
- Change `startBatchAsync()` internals

---

## Amendments (Added During Execution)

