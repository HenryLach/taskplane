# Task: TP-057 - Persistent Reviewer Context

**Created:** 2026-03-24
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Introduces a new sub-agent lifecycle model (persistent reviewer with tool-driven blocking), changes the reviewer spawn/communication pattern, adds a new extension file, and modifies the review_step tool handler. High blast radius across task-runner, reviewer template, and extension surface.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-057-persistent-reviewer-context/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Currently, each `review_step` tool call spawns a fresh reviewer agent in a new tmux session. For a 4-step task at review level 2, this means 8 separate reviewer spawns, each re-reading the entire codebase from scratch. Implement a persistent reviewer model: one reviewer per task that stays alive across all `review_step` calls, receiving new review requests via a blocking `wait_for_review` tool.

This mirrors the persistent worker context model (TP-048) but for the reviewer sub-agent, using a tool-driven blocking pattern instead of autonomous execution.

**Design spec:** `.pi/local/docs/taskplane/persistent-reviewer-context-spec.md`
(Option D: Tool-Driven Reviewer was selected.)

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/persistent-reviewer-context-spec.md` — full design spec with architecture, signal protocol, and open question answers
- `extensions/task-runner.ts` — `review_step` tool handler (~line 2072), `spawnReviewerSession()`, reviewer verdict extraction
- `templates/agents/task-reviewer.md` — current reviewer system prompt
- `extensions/taskplane/execution.ts` — RPC wrapper spawn pattern, `buildTmuxSpawnArgs()`

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`
- `extensions/reviewer-extension.ts` (new)
- `templates/agents/task-reviewer.md`
- `templates/agents/local/task-reviewer.md`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/persistent-reviewer-context.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read the design spec at `.pi/local/docs/taskplane/persistent-reviewer-context-spec.md` — understand Option D architecture, signal protocol, and open question answers
- [ ] Read the `review_step` tool handler in `task-runner.ts` (~line 2072) — understand current spawn/poll/verdict flow
- [ ] Read `spawnReviewerSession()` in `task-runner.ts` — understand current reviewer tmux spawn
- [ ] Read the reviewer template at `templates/agents/task-reviewer.md`
- [ ] Read the RPC wrapper spawn pattern in `execution.ts` — `buildTmuxSpawnArgs()`

### Step 1: Create Reviewer Extension with `wait_for_review` Tool

Create `extensions/reviewer-extension.ts` — a pi extension that registers the `wait_for_review` tool for the persistent reviewer agent.

**`wait_for_review` tool behavior:**
1. Poll for the next signal file: `.reviews/.review-signal-{N}` (N = monotonically increasing)
2. When found, read the corresponding `request-R00{N}.md` file
3. Return the request content as the tool result
4. If the signal file contains "shutdown", return a shutdown message so the reviewer exits cleanly

**Polling:**
- Poll interval: 2-5 seconds (configurable via constant)
- Timeout: match the merge timeout pattern — configurable, with a reasonable default (e.g., 30 minutes per review)
- Between polls, check for shutdown signal

**The reviewer's workflow becomes:**
1. Reviewer spawns with system prompt explaining persistent review mode
2. Reviewer calls `wait_for_review()` → blocks
3. Tool returns review request content
4. Reviewer reads whatever source/context it needs via standard tools (read, bash, etc.)
5. Reviewer writes verdict to `.reviews/R00{N}-{type}-step{N}.md`
6. Reviewer calls `wait_for_review()` again → blocks
7. Repeat until shutdown signal

**Extension also needs:**
- The signal directory path passed via environment variable (e.g., `REVIEWER_SIGNAL_DIR`)
- A counter tracking which signal number to watch for next
- Clean error handling if the request file doesn't exist when the signal fires

**Artifacts:**
- `extensions/reviewer-extension.ts` (new)
- `extensions/taskplane/types.ts` (modified — add reviewer polling constants)

### Step 2: Update `review_step` Handler for Persistent Mode

Modify the `review_step` tool handler in `task-runner.ts` to reuse a persistent reviewer session:

**First `review_step` call for a task:**
1. Spawn reviewer tmux session with the reviewer-extension loaded (in addition to task-runner for file tools)
2. Pass `REVIEWER_SIGNAL_DIR` env var pointing to `.reviews/`
3. Store the session name and signal counter in task-level state
4. Write request file: `.reviews/request-R001.md` (same format as today)
5. Write signal file: `.reviews/.review-signal-001`
6. Poll for verdict file: `.reviews/R001-{type}-step{N}.md` (same as today)
7. Extract verdict, return to worker

**Subsequent `review_step` calls:**
1. Check if reviewer session is still alive (`tmux has-session`)
2. If alive: increment signal counter, write request + signal files, poll for verdict
3. If dead: fall back to fresh spawn (log warning, emit supervisor event)

**Task completion cleanup:**
1. Write `.reviews/.review-shutdown` signal
2. Wait briefly for reviewer to exit cleanly
3. Kill tmux session if still alive after grace period

**Fallback behavior:**
- If persistent reviewer crashes, times out, or hits context limit → kill session, spawn fresh reviewer for that specific review (current behavior)
- Log the fallback event for telemetry/dashboard
- Next `review_step` call attempts to spawn a new persistent reviewer

**Artifacts:**
- `extensions/task-runner.ts` (modified — `review_step` handler, session lifecycle)

### Step 3: Update Reviewer Template for Persistent Mode

Update the reviewer system prompt to support the persistent review workflow:

**Key changes:**
- Explain that the reviewer handles multiple reviews across the task's steps
- Instruct to call `wait_for_review()` to receive review requests
- After writing each review file, call `wait_for_review()` again
- Reference previous reviews when relevant (e.g., "I flagged X in Step 1's plan — checking if addressed")
- On shutdown signal, exit cleanly

**The reviewer should still:**
- Load its own context via tools (read source files, docs as needed) — NOT have everything pre-loaded
- Follow the same verdict format (APPROVE, REVISE, RETHINK)
- Write review files in the same format as today
- Apply the same review level criteria

**Important:** The reviewer template must work for both persistent mode (with `wait_for_review` tool available) AND fallback fresh-spawn mode (without the tool, single review then exit). The template should detect which mode it's in based on available tools.

**Artifacts:**
- `templates/agents/task-reviewer.md` (modified)
- `templates/agents/local/task-reviewer.md` (modified)

### Step 4: Path Resolution and Spawn Integration

The reviewer extension needs to be found and loaded by the reviewer tmux session:

1. Add `extensions/reviewer-extension.ts` to the spawn command's `--extensions` list (alongside task-runner.ts)
2. Update path resolution in `execution.ts` if needed — `resolveTaskplanePackageFile()` should cover it since it resolves relative to the package root
3. Ensure the reviewer-extension.ts is included in `package.json` `files` array so it ships with the npm package

**Artifacts:**
- `extensions/taskplane/execution.ts` (modified if path resolution needed)
- `package.json` (modified — add reviewer-extension.ts to files)

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] Create `extensions/tests/persistent-reviewer-context.test.ts` with:
  - `wait_for_review` tool: signal file detection, request content return, shutdown handling, timeout behavior
  - Signal protocol: monotonic numbering, race condition safety, missing request file handling
  - Session reuse: second `review_step` reuses existing session, tmux has-session check
  - Fallback: dead session detected → fresh spawn, logged as fallback event
  - Cleanup: shutdown signal sent on task completion, session killed after grace period
  - Source-based tests: reviewer-extension registers wait_for_review, review_step checks for existing session
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 6: Documentation & Delivery

- [ ] Update `docs/explanation/review-loop.md` — add persistent reviewer section
- [ ] Update `extensions/taskplane/supervisor-primer.md` — add persistent reviewer to architecture description
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/explanation/review-loop.md` — add persistent reviewer context section
- `extensions/taskplane/supervisor-primer.md` — update reviewer architecture description

**Check If Affected:**
- `docs/explanation/execution-model.md` — reviewer spawn model description
- `docs/reference/configuration/task-runner.yaml.md` — if any new config keys added

## Completion Criteria

- [ ] Reviewer spawns once per task and handles all reviews via `wait_for_review` tool
- [ ] Signal protocol works: request files → signal files → verdict files
- [ ] Fallback to fresh spawn works when persistent reviewer fails
- [ ] Reviewer template works in both persistent and fallback modes
- [ ] Shutdown signal cleanly terminates reviewer session
- [ ] reviewer-extension.ts ships in npm package
- [ ] All tests passing (existing + new)
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-057): complete Step N — description`
- **Bug fixes:** `fix(TP-057): description`
- **Tests:** `test(TP-057): description`
- **Hydration:** `hydrate: TP-057 expand Step N checkboxes`

## Do NOT

- Change the review verdict format (APPROVE, REVISE, RETHINK, UNAVAILABLE)
- Change the review level system (0-3)
- Remove the fallback to fresh spawn — it's the safety net
- Pre-load the entire codebase into the reviewer's initial prompt — the reviewer loads what it needs via tools
- Modify the worker's `review_step` tool signature (parameters stay the same)
- Add persistent reviewer config options in this task — hardcode sensible defaults, config comes later

---

## Amendments (Added During Execution)

