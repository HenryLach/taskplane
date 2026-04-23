# Task: TP-104 - Direct Agent Host, Process Registry, and Normalized Events

**Created:** 2026-03-30
**Size:** L

## Review Level: 3 (Full)

**Assessment:** This replaces the most failure-prone part of the control plane: TMUX-backed child hosting. High novelty and broad runtime effect, but it is the core stability payoff of Runtime V2.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-104-direct-agent-host-process-registry-and-normalized-events/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the direct-child Runtime V2 agent host and process registry. Worker, reviewer, and merger agents must be spawnable without TMUX, with one deterministic owner, normalized event streams, durable manifests, and mailbox delivery preserved via Pi RPC steering.

## Dependencies

- **Task:** TP-100 (Runtime V2 architecture suite staged)
- **Task:** TP-102 (shared runtime contracts defined)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md` — target ownership and process registry model
- `docs/specifications/framework/taskplane-runtime-v2/03-bridge-and-mailbox.md` — mailbox expectations the new host must preserve
- `docs/specifications/framework/taskplane-runtime-v2/04-observability-and-dashboard.md` — normalized event expectations
- `docs/specifications/taskplane/spawn-telemetry-stability.md` — failure history the new host is intended to eliminate

## Environment

- **Workspace:** `bin/`, `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `bin/rpc-wrapper.mjs`
- `bin/agent-host.mjs`
- `extensions/taskplane/process-registry.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/cleanup.ts`
- `extensions/tests/rpc-wrapper.test.ts`
- `extensions/tests/*registry*`

## Steps

### Step 0: Preflight

- [ ] Trace the current rpc-wrapper responsibilities and identify which belong in a Runtime V2 host versus higher-level runtime code
- [ ] Define the manifest, registry, and normalized event flow before cutting code

### Step 1: Implement Process Registry and Manifests

- [ ] Create the runtime registry and per-agent manifest helpers
- [ ] Persist enough metadata to replace TMUX-based liveness and cleanup checks
- [ ] Define deterministic state transitions for running, wrapping up, exited, crashed, timed out, and killed agents

### Step 2: Implement Direct Agent Host

- [ ] Implement or evolve the host so it spawns `pi --mode rpc` directly with `shell: false` and no TMUX dependency
- [ ] Normalize RPC events into durable per-agent event logs and parent-facing updates
- [ ] Preserve mailbox inbox delivery and exit summaries on the new host

### Step 3: Testing & Verification

- [ ] Add or update behavioral tests for direct-child hosting, registry lifecycle, normalized event persistence, and mailbox delivery
- [ ] Run the full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update Runtime V2 docs if host/registry naming differs from plan
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md`
- `docs/specifications/framework/taskplane-runtime-v2/04-observability-and-dashboard.md`

**Check If Affected:**
- `docs/reference/commands.md`
- `docs/explanation/architecture.md`

## Completion Criteria

- [ ] Agents can be hosted without TMUX installed
- [ ] A runtime registry and per-agent manifests replace TMUX liveness for the new backend
- [ ] Normalized event logs exist for downstream dashboard and supervisor work

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-104): complete Step N — description`
- **Bug fixes:** `fix(TP-104): description`
- **Tests:** `test(TP-104): description`
- **Hydration:** `hydrate: TP-104 expand Step N checkboxes`

## Do NOT

- Retain TMUX as a hidden fallback in the correctness path
- Use shell-composed command strings where argument arrays suffice
- Leave mailbox delivery broken while changing transport

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
