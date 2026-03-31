# Task: TP-106 - Mailbox Replies, Broadcast, and Registry-Backed Supervisor Control

**Created:** 2026-03-30
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Builds directly on the new host/registry to finish the mailbox control plane. Broad but mostly deterministic work; the main risk is preserving supervisor ergonomics while changing liveness assumptions.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-106-mailbox-replies-broadcast-and-registry-backed-supervisor-control/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Finish the mailbox-first control plane on Runtime V2: registry-backed supervisor tools, agent replies/escalations, broadcast, rate limiting, and minimal bridge tools for agent→supervisor contact. This task absorbs the pending TP-091 and TP-092 work onto the new runtime identity model.

## Dependencies

- **Task:** TP-104 (direct agent host and runtime registry exist)
- **Task:** TP-105 (lane-runner single-task Runtime V2 path exists)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/03-bridge-and-mailbox.md` — target mailbox and bridge protocols
- `docs/specifications/taskplane/agent-mailbox-steering.md` — current mailbox phases and semantics
- `extensions/taskplane/extension.ts` — current supervisor tool surface that still assumes TMUX liveness
- `extensions/taskplane/mailbox.ts` — existing mailbox core to extend rather than replace

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/mailbox.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/agent-bridge-extension.ts`
- `extensions/tests/mailbox.test.ts`
- `extensions/tests/*supervisor*`

## Steps

### Step 0: Preflight

- [ ] Review current mailbox implementation and identify which assumptions are session/TMUX-specific rather than agent-ID/registry-based
- [ ] Trace the current supervisor tools (`send_agent_message`, `list_active_agents`, `read_agent_status`) and outline the Runtime V2 source of truth for each

### Step 1: Registry-Backed Supervisor Tools

- [ ] Rework supervisor-facing agent tools to validate and resolve against the runtime registry instead of TMUX
- [ ] Preserve familiar agent IDs while severing the assumption that they are terminal/session names
- [ ] Ensure delivery and liveness errors are surfaced from registry/runtime state, not terminal state

### Step 2: Agent Replies, Broadcast, and Rate Limiting

- [ ] Implement agent→supervisor replies/escalations on the new runtime flow
- [ ] Implement broadcast and per-agent rate limiting on top of the mailbox model
- [ ] Keep auditability intact for sent, delivered, replied, and rate-limited messages

### Step 3: Bridge Contact Tools

- [ ] Add minimal agent-side bridge/contact tools for reply/escalate flows where generic file writes would be brittle
- [ ] Document how these tools fit with future review and segment-expansion bridge work

### Step 4: Testing & Verification

- [ ] Add or update behavioral tests for registry-backed tool behavior, reply flow, broadcast, and rate limiting
- [ ] Run the full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update mailbox and command docs for the new Runtime V2 control model
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/agent-mailbox-steering.md`
- `docs/reference/commands.md`

**Check If Affected:**
- `README.md`
- `docs/specifications/framework/taskplane-runtime-v2/03-bridge-and-mailbox.md`

## Completion Criteria

- [ ] Supervisor messaging tools are registry-backed rather than TMUX-backed
- [ ] Agents can reply/escalate to the supervisor on Runtime V2
- [ ] Broadcast and rate limiting work without reintroducing terminal assumptions

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-106): complete Step N — description`
- **Bug fixes:** `fix(TP-106): description`
- **Tests:** `test(TP-106): description`
- **Hydration:** `hydrate: TP-106 expand Step N checkboxes`

## Do NOT

- Keep `tmuxHasSession()` as the authority for agent liveness
- Require operators to type directly into agents
- Split mailbox truth between registry-backed and TMUX-backed sources without a clear precedence rule

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
