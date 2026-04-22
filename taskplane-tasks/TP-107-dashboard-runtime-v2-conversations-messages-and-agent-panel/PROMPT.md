# Task: TP-107 - Dashboard Runtime V2 Conversations, Messages, and Agent Panel

**Created:** 2026-03-30
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Dashboard/server/client work on top of the new runtime artifacts. Moderate blast radius across observability surfaces, but conceptually straightforward once registry and normalized events exist.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-107-dashboard-runtime-v2-conversations-messages-and-agent-panel/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Migrate the dashboard onto Runtime V2 artifacts so it becomes the authoritative operator surface: normalized conversations, runtime agent panel, and mailbox messages. This task should eliminate TMUX pane capture as the primary visibility source and absorb TP-093 onto the new backend.

## Dependencies

- **Task:** TP-104 (normalized event logs and runtime registry exist)
- **Task:** TP-105 (lane-runner emits the first Runtime V2 snapshots)
- **Task:** TP-106 (mailbox replies/broadcast and registry-backed control are available)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/04-observability-and-dashboard.md` — target observability model
- `dashboard/server.cjs` — current dashboard data loader paths that still mix legacy artifacts and TMUX concepts
- `dashboard/public/app.js` — current conversation and lane rendering code
- `docs/specifications/taskplane/agent-mailbox-steering.md` — message panel semantics to preserve

## Environment

- **Workspace:** `dashboard/`, `docs/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `dashboard/public/style.css`
- `dashboard/public/index.html`
- `docs/explanation/architecture.md`
- `README.md`

## Steps

### Step 0: Preflight

- [ ] Audit the dashboard's current dependence on lane-state files, worker-conversation logs, and TMUX pane capture
- [ ] Map each panel to its Runtime V2 source of truth: registry, lane snapshots, normalized agent events, and mailbox state

### Step 1: Runtime V2 Data Loading

- [ ] Add Runtime V2 loaders for registry, per-agent events, and lane snapshots while retaining temporary compatibility shims only where necessary
- [ ] Define clear precedence when both legacy and Runtime V2 artifacts exist during migration

### Step 2: Conversations, Messages, and Agent Panel

- [ ] Render conversation streams from normalized event logs instead of pane capture
- [ ] Add/update the mailbox messages panel on top of Runtime V2 mailbox + delivery events
- [ ] Add an agent/process panel driven by the runtime registry

### Step 3: Testing & Verification

- [ ] Run dashboard/server sanity checks: `node --check dashboard/server.cjs`
- [ ] Perform manual dashboard verification for conversations, messages, and agent health on a Runtime V2 run
- [ ] Run the full suite if shared extension/server contracts changed: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update README and architecture docs for the new dashboard model if behavior/user guidance changed
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/framework/taskplane-runtime-v2/04-observability-and-dashboard.md`

**Check If Affected:**
- `README.md`
- `docs/explanation/architecture.md`
- `docs/tutorials/use-the-dashboard.md`

## Completion Criteria

- [ ] The dashboard shows Runtime V2 conversations and messages without relying on TMUX pane capture
- [ ] A runtime agent panel exists and is sourced from the registry
- [ ] Mailbox activity is visible end-to-end on the new backend

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-107): complete Step N — description`
- **Bug fixes:** `fix(TP-107): description`
- **Tests:** `test(TP-107): description`
- **Hydration:** `hydrate: TP-107 expand Step N checkboxes`

## Do NOT

- Keep pane capture as the primary conversation source
- Hide legacy/v2 precedence rules in server heuristics without documenting them
- Ship a messages panel that cannot represent delivered vs replied state correctly

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
