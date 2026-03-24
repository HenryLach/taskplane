# Task: TP-053 - Expose Orchestrator Commands as Tools for Supervisor Agent

**Created:** 2026-03-24
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Registers existing command logic as extension tools. High blast radius — these tools give agents programmatic control over batch lifecycle. Moderate novelty — follows the review_step pattern from TP-050 but applied to multiple commands. No security changes, easy revert.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-053-supervisor-orch-tools/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

The supervisor agent currently cannot invoke orchestrator commands programmatically.
Slash commands (`/orch-resume`, `/orch-integrate`, `/orch-pause`, etc.) are processed
by pi's command system before reaching the LLM — the supervisor can't "type" them.
The only exception is `/orch all` which has hardcoded routing→batch transition plumbing.

This task registers the key orchestrator commands as **extension tools** that any
agent in the session (particularly the supervisor) can invoke. The tool handlers
reuse the existing command handler logic — this is a wiring task, not a reimplementation.

This follows the pattern established by `review_step` in TP-050.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/extension.ts` — all command handlers live here. Key handlers:
  - `/orch-resume` (line ~1811): parses `--force`, calls `resumeOrchBatch()`
  - `/orch-integrate` (line ~2330): parses `--pr`/`--merge`/`--force`/branch, runs integration
  - `/orch-pause` (line ~1793): sets `pauseSignal.paused = true`
  - `/orch-abort` (line ~1961): writes abort signal file, kills sessions
  - `/orch-status` (line ~1732): reads and displays batch state
- `extensions/task-runner.ts` — reference for how `review_step` tool was registered (line ~2072). Follow the same pattern: `pi.registerTool()` with `Type.Object` parameters, `promptSnippet`, `promptGuidelines`, and async `execute` handler.

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/tests/*` (new or modified test files)

## Steps

### Step 0: Preflight

- [ ] Read each command handler to understand its logic, argument parsing, and dependencies on module-level state (`orchBatchState`, `execCtx`, `orchConfig`, etc.)
- [ ] Read the `review_step` tool registration in `task-runner.ts` (line ~2072) as the pattern to follow
- [ ] Understand pi's `registerTool()` API: parameters, execute signature, return shape
- [ ] Identify which commands need the execution context (`requireExecCtx`) and which don't

### Step 1: Register orchestrator tools

Register the following tools in `extension.ts`. Each tool handler should extract
the core logic from the corresponding command handler, sharing as much code as
possible (ideally call the same internal functions).

**Tools to register:**

1. **`orch_resume`**
   - Parameters: `force` (optional boolean, default false)
   - Behavior: same as `/orch-resume [--force]`
   - Returns: status message (resumed, already running, no batch to resume, etc.)
   - Guard: require execCtx, reject if batch already executing

2. **`orch_integrate`**
   - Parameters: `mode` (optional: "fast-forward" | "merge" | "pr", default "fast-forward"), `force` (optional boolean), `branch` (optional string)
   - Behavior: same as `/orch-integrate [--pr] [--merge] [--force] [<branch>]`
   - Returns: integration result message
   - Guard: require execCtx

3. **`orch_pause`**
   - Parameters: none
   - Behavior: same as `/orch-pause`
   - Returns: status message
   - Guard: reject if no batch running

4. **`orch_abort`**
   - Parameters: `hard` (optional boolean, default false)
   - Behavior: same as `/orch-abort [--hard]`
   - Returns: status message
   - Note: must work even without execCtx (safety-critical)

5. **`orch_status`**
   - Parameters: none
   - Behavior: same as `/orch-status` — returns batch state summary
   - Returns: formatted batch state as text

**Tool registration guidelines:**
- Register all tools unconditionally (not gated on orchestrated mode — the
  supervisor runs in the main session, not inside a lane)
- Each tool should have a clear `description` and `promptSnippet`
- Include `promptGuidelines` for the supervisor to know when to use each tool
- Return format: `{ content: [{ type: "text", text: "..." }], details: undefined }`
- Error handling: catch errors and return them as text results (don't throw)

**Code sharing strategy:**
Extract the core logic from each command handler into a shared internal function
that both the command handler and the tool handler call. For example:

```typescript
// Shared logic
async function doResume(force: boolean, ctx: ExtensionContext): Promise<string> {
    // ... existing resume logic ...
    return "Batch resumed successfully.";
}

// Command handler calls it
pi.registerCommand("orch-resume", {
    handler: async (args, ctx) => {
        const result = await doResume(parsed.force, ctx);
        ctx.ui.notify(result, "info");
    }
});

// Tool handler calls it
pi.registerTool({
    name: "orch_resume",
    execute: async (..., ctx) => {
        const result = await doResume(params.force, ctx);
        return { content: [{ type: "text", text: result }] };
    }
});
```

This avoids duplicating logic and ensures command and tool behaviors stay in sync.

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 2: Update supervisor primer/prompt with tool awareness

The supervisor needs to know these tools exist. Update the supervisor's system
prompt construction (in `supervisor.ts`) to mention the available tools:

```
## Available Orchestrator Tools

You can invoke these tools directly — no need to ask the operator:

- orch_resume(force?) — resume a paused batch
- orch_integrate(mode?, force?, branch?) — integrate completed batch
- orch_pause() — pause running batch
- orch_abort(hard?) — abort running batch  
- orch_status() — check batch state

Use these proactively when the situation calls for it. For example:
- Batch paused due to failure you fixed → call orch_resume()
- Batch completed → offer to call orch_integrate(mode="pr")
- Stuck batch → call orch_status() to diagnose, then orch_abort() if needed
```

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified — monitoring prompt)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Run tests: `cd extensions && npx vitest run`
- [ ] Add tests for: each tool is registered (source extraction: `name: "orch_resume"`, etc.)
- [ ] Add tests for: tool parameters match expected schema
- [ ] Add tests for: tools have promptSnippet and description
- [ ] Add tests for: supervisor prompt mentions orchestrator tools

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None required (tools are self-documenting via promptSnippet/guidelines)

**Check If Affected:**
- `docs/reference/commands.md` — mention that commands are also available as tools
- `extensions/taskplane/supervisor-primer.md` — if it references command limitations

## Completion Criteria

- [ ] 5 orchestrator tools registered: orch_resume, orch_integrate, orch_pause, orch_abort, orch_status
- [ ] Each tool reuses existing command handler logic (no duplication)
- [ ] Supervisor prompt updated with tool awareness
- [ ] All tools return text results (no throws)
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-053): complete Step N — description`
- **Bug fixes:** `fix(TP-053): description`
- **Tests:** `test(TP-053): description`

## Do NOT

- Reimpliment command logic — extract and share it
- Remove the existing slash commands (they still work for user input)
- Register tools inside lane workers (these are main-session tools for the supervisor)
- Change the `/orch all` routing→batch transition mechanism (it already works)
- Add new orchestrator features — this is purely wiring existing commands as tools

---

## Amendments (Added During Execution)
