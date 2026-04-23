# Task: TP-041 — Supervisor Agent

**Created:** 2026-03-21
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Core new capability — adds an interactive LLM agent to the orchestration loop. Novel pattern (agent sharing pi session with operator). Must handle recovery, lockfile, and session takeover.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-041-supervisor-agent/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Implement the supervisor agent — the interactive LLM agent that monitors
batches, handles failures, and communicates with the operator. After `/orch`
starts a batch (non-blocking, from TP-040), the supervisor activates in the
same pi session. The operator can converse naturally ("how's it going?",
"fix it", "I'm going to bed") while the supervisor monitors engine events
and executes recovery actions.

Key components:
- Supervisor system prompt (injected into pi session after /orch)
- Lockfile + heartbeat for session takeover prevention
- Engine event consumption and proactive notifications
- Recovery action execution with audit trail
- Autonomy levels (interactive, supervised, autonomous)

## Dependencies

- **Task:** TP-040 (non-blocking engine must exist — supervisor runs in the freed pi session)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/watchdog-and-recovery-tiers.md` — Sections 4.2-4.5, 6.1-6.4, 13.10
- `extensions/taskplane/supervisor-primer.md` — operational runbook the supervisor reads on startup
- `extensions/taskplane/extension.ts` — command handlers, session lifecycle

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** tmux


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/supervisor.ts` (new)
- `extensions/taskplane/types.ts`
- `extensions/taskplane/supervisor-primer.md` (may need updates)
- `extensions/tests/supervisor.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read the supervisor primer — understand what the supervisor needs to know
- [ ] Read extension.ts session lifecycle and command handlers
- [ ] Read spec Sections 4.2-4.5, 6.1-6.4
- [ ] Understand how pi's `sendMessage()` works for injecting prompts

### Step 1: Supervisor System Prompt + Activation

- [ ] Create `extensions/taskplane/supervisor.ts` module
- [ ] Design the supervisor system prompt that gets injected after `/orch` starts a batch:
  - Identity: "You are the batch supervisor"
  - Context: batch metadata, file paths, wave plan
  - Capabilities: full tool access for monitoring and recovery
  - Standing orders: monitor events, handle failures, keep operator informed
  - Reference: instruct to read `supervisor-primer.md` for detailed operational knowledge
- [ ] After engine starts (non-blocking), inject the supervisor prompt via `pi.sendMessage()` or equivalent
- [ ] Supervisor model inherits session model by default, configurable via `supervisor.model` in settings

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (new)
- `extensions/taskplane/extension.ts` (modified)

### Step 2: Lockfile + Session Takeover

- [ ] On supervisor activation, write `.pi/supervisor/lock.json` with pid, sessionId, batchId, heartbeat
- [ ] Update heartbeat every 30 seconds
- [ ] On startup (extension load), check for existing lockfile:
  - If pid alive → warn "supervisor already running", offer force takeover
  - If pid dead → take over, reconstruct from audit trail
- [ ] On force takeover: update lockfile, previous session yields on next heartbeat check
- [ ] Clean up lockfile on batch completion or session exit

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)
- `extensions/taskplane/extension.ts` (modified)

### Step 3: Engine Event Consumption + Notifications

- [ ] Supervisor tails `.pi/supervisor/events.jsonl` for engine events
- [ ] On significant events, proactively notify operator:
  - `wave_start` → "Wave N starting with K tasks..."
  - `task_complete` → (silent unless asked, or batched into wave summary)
  - `merge_success` → "Wave N merged. Tests pass."
  - `merge_failed` / `tier0_escalation` → "⚠️ [description]. Attempting recovery..." or "❌ Need your input."
  - `batch_complete` → "🏁 Batch complete! [summary]"
- [ ] Notification frequency adapts to autonomy level (interactive = more, autonomous = less)

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 4: Recovery Action Execution + Audit Trail

- [ ] Supervisor can execute recovery actions using standard tools (bash, read, write, edit)
- [ ] Before any destructive action, log to `.pi/supervisor/actions.jsonl`
- [ ] Autonomy levels control what requires operator confirmation:
  - Interactive: ask before everything
  - Supervised: Tier 0 patterns auto, novel recovery asks
  - Autonomous: handle everything, pause only when stuck
- [ ] Add `supervisor.autonomy` config: `interactive | supervised | autonomous`

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)
- `extensions/taskplane/types.ts` (modified — autonomy level type)

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: supervisor prompt injection after /orch
- [ ] Test: lockfile created with correct fields on activation
- [ ] Test: heartbeat updates periodically
- [ ] Test: stale lockfile (dead pid) triggers takeover
- [ ] Test: live lockfile (alive pid) prevents duplicate supervisor
- [ ] Test: engine events consumed and notifications generated
- [ ] Test: audit trail written for recovery actions
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 6: Documentation & Delivery

- [ ] Update `docs/reference/commands.md` — document supervisor behavior after `/orch`
- [ ] Update supervisor-primer.md if implementation details diverged from spec
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/commands.md` — supervisor behavior with `/orch`

**Check If Affected:**
- `docs/explanation/architecture.md` — supervisor in architecture diagram
- `docs/reference/configuration/taskplane-settings.md` — supervisor config options

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] `/orch` activates supervisor after starting batch
- [ ] Operator can converse with supervisor during batch
- [ ] Lockfile prevents duplicate supervisors
- [ ] Session takeover works for crashed supervisors
- [ ] Engine events produce proactive notifications
- [ ] Recovery actions logged to audit trail
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-041): complete Step N — description`
- **Bug fixes:** `fix(TP-041): description`
- **Tests:** `test(TP-041): description`
- **Hydration:** `hydrate: TP-041 expand Step N checkboxes`

## Do NOT

- Implement onboarding flows (that's TP-042)
- Implement auto-integration (that's TP-043)
- Implement dashboard supervisor panel (that's TP-044)
- Change the engine's execution logic (that's TP-039/040)

---

## Amendments (Added During Execution)
