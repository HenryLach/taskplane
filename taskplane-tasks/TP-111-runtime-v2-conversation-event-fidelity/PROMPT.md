# Task: TP-111 - Runtime V2 Conversation Event Fidelity

**Created:** 2026-03-31
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Improves Runtime V2 observability correctness by ensuring normalized event streams contain real conversation content (not just lifecycle/tool telemetry) and dashboard conversation rendering is faithful.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-111-runtime-v2-conversation-event-fidelity/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Close the remaining Runtime V2 observability gap: the dashboard now reads `/api/agent-events/:agentId`, but the underlying event stream often lacks full conversation payloads (notably `prompt_sent` and `assistant_message`).

Implement reliable normalized conversation emission from the Runtime V2 agent-host path and ensure the dashboard conversation viewer renders that data as the primary source of truth.

## Dependencies

- **Task:** TP-104 (normalized events + registry foundation)
- **Task:** TP-107 (V2 conversation endpoint/viewer wiring)

## Explicit Non-Goals

- Do not migrate batch/merge execution ownership (TP-108 scope)
- Do not migrate workspace packet-home/resume authority (TP-109 scope)
- Do not reintroduce TMUX pane capture as primary visibility

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/04-observability-and-dashboard.md`
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md`
- `extensions/taskplane/agent-host.ts`
- `extensions/taskplane/types.ts` (`RuntimeAgentEventType`, `RuntimeAgentEvent`)
- `dashboard/public/app.js`
- `dashboard/server.cjs`

## Environment

- **Workspace:** `extensions/taskplane/`, `dashboard/`, `docs/`
- **Services required:** None

## File Scope

- `extensions/taskplane/agent-host.ts`
- `extensions/taskplane/types.ts` (only if event payload/type contract needs additive clarification)
- `extensions/tests/*` (add focused coverage for conversation event emission)
- `dashboard/public/app.js` (viewer mapping/formatting only if needed)
- `docs/specifications/framework/taskplane-runtime-v2/04-observability-and-dashboard.md`

## Steps

### Step 0: Preflight

- [ ] Trace current Runtime V2 event emission in `agent-host.ts` for user prompts, assistant text, and tool phases
- [ ] Compare emitted event types/payloads to dashboard renderer expectations and Runtime V2 observability spec

### Step 1: Runtime V2 conversation event emission

- [ ] Emit `prompt_sent` events with safe/truncated prompt preview payload
- [ ] Emit `assistant_message` events with safe/truncated assistant content payload
- [ ] Keep existing lifecycle/tool/telemetry events intact
- [ ] Ensure payloads are bounded to prevent unbounded event-log growth
- [ ] Preserve backward compatibility for existing consumers

### Step 2: Dashboard rendering parity

- [ ] Verify/adjust `renderV2Event(...)` mappings for emitted payload shapes
- [ ] Ensure viewer displays meaningful user/assistant/tool progression from normalized events alone
- [ ] Keep legacy fallback path available but secondary

### Step 3: Testing & verification

- [ ] Add behavioral/source tests proving `prompt_sent` and `assistant_message` are emitted on Runtime V2 path
- [ ] Add/extend dashboard source-contract tests for expected payload fields
- [ ] Run targeted tests
- [ ] Run full extension suite and fix failures

### Step 4: Documentation & delivery

- [ ] Update Runtime V2 observability doc with final event fidelity behavior
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/framework/taskplane-runtime-v2/04-observability-and-dashboard.md`

**Check If Affected:**
- `docs/reference/commands.md`
- `docs/specifications/taskplane/agent-mailbox-steering.md`

## Completion Criteria

- [ ] Runtime V2 per-agent event logs include usable `prompt_sent` and `assistant_message` records
- [ ] Dashboard conversation viewer provides coherent conversation flow from normalized events (without requiring pane capture)
- [ ] Event payloads are bounded and safe for long-running batches
- [ ] Full suite passes

## Git Commit Convention

- `feat(TP-111): complete Step N — ...`
- `fix(TP-111): ...`
- `test(TP-111): ...`
- `hydrate: TP-111 expand Step N checkboxes`

## Do NOT

- Couple this work to TP-108/TP-109 migration scope
- Make TMUX capture a required path for Runtime V2 conversation visibility
- Emit unbounded raw payload blobs that degrade dashboard/server performance

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
