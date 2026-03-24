# TP-053: Expose Orchestrator Commands as Tools for Supervisor Agent — Status

**Current Step:** Step 1
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Done

- [x] Read each command handler (resume, integrate, pause, abort, status)
- [x] Read review_step tool registration as pattern reference
- [x] Understand pi registerTool() API
- [x] Identify execCtx dependencies per command

---

### Step 1: Register orchestrator tools
**Status:** 🟡 In Progress

**Design decisions (from R001 review):**
- **Shared reporter pattern:** Each extracted helper takes a `report(text, level)` callback. Command handlers pass `ctx.ui.notify`. Tool handlers accumulate messages into an array and return them as a single text result.
- **Integrate mode mapping:** Tool param `mode: "fast-forward"|"merge"|"pr"` maps to internal `"ff"|"merge"|"pr"`. Default `"fast-forward"`.
- **Resume return semantics:** Tool returns **immediate initiation/guard result only** (e.g., "Batch resume initiated" or guard rejection). Downstream progress is asynchronous via engine events.
- **Integrate helper boundary:** Full command parity — includes branch-protection check, multi-repo iteration, cleanup/acceptance, supervisor summary/deactivation.
- **Tools registered unconditionally** (not gated on orchestrated mode — supervisor runs in main session).

**Checklist:**

- [ ] Add `import { Type } from "@mariozechner/pi-ai"` to extension.ts
- [ ] Extract `doOrchStatus(orchBatchState, execCtx, stateRoot)` → returns formatted text
- [ ] Extract `doOrchPause(orchBatchState, updateOrchWidget)` → returns status message
- [ ] Extract `doOrchAbort(...)` → captures all notify output, returns collected text
- [ ] Extract `doOrchResume(force, ...)` → guard checks + fire-and-forget launch, returns immediate result
- [ ] Extract `doOrchIntegrate(mode, force, branch, ...)` → full parity with command handler including cleanup and supervisor lifecycle
- [ ] Register `orch_status` tool (no params)
- [ ] Register `orch_pause` tool (no params)
- [ ] Register `orch_abort` tool (`hard?: boolean`)
- [ ] Register `orch_resume` tool (`force?: boolean`)
- [ ] Register `orch_integrate` tool (`mode?: "fast-forward"|"merge"|"pr"`, `force?: boolean`, `branch?: string`)
- [ ] Each tool has description, promptSnippet, promptGuidelines
- [ ] All tools catch errors and return text (no throws)
- [ ] Existing command handlers call the shared helpers (no duplication)

---

### Step 2: Update supervisor prompt with tool awareness
**Status:** ⬜ Not Started

- [ ] Add Available Orchestrator Tools section to supervisor monitoring prompt
- [ ] Include tool names, parameters, and usage guidance
- [ ] Add proactive usage examples

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] All existing tests pass
- [ ] Tests for each tool registration (5 tools)
- [ ] Tests for tool parameter schemas
- [ ] Tests for supervisor prompt mentions tools

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Check affected docs
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `Type` from `@mariozechner/pi-ai` must be imported in extension.ts (not currently imported) | Add import | extension.ts:1 |
| `orchBatchState`, `execCtx`, `orchConfig`, etc. are all closure-scoped inside `export default function(pi)` | Tools must be registered inside the same closure | extension.ts:1206 |
| `orch-pause` doesn't need execCtx, `orch-status` doesn't need execCtx, `orch-abort` doesn't need execCtx | Only resume/integrate need execCtx guard | Command handlers |
| `orch-resume` has complex onTerminal callback with supervisor integration—tool should wrap the command handler pattern but return a simple result | Extract doResume as internal function | extension.ts:1811 |
| `orch-integrate` is the most complex—depends on execCtx, ws config, repo iteration, cleanup | Tool handler can invoke the same code path | extension.ts:2330 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-24 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
