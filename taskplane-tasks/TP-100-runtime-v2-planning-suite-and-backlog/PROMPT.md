# Task: TP-100 - Runtime V2 Planning Suite and Implementation Backlog

**Created:** 2026-03-30
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Foundational architecture and task decomposition only. No runtime code changes, but it sets the direction for removing TMUX and `/task` from the v2 foundation.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-100-runtime-v2-planning-suite-and-backlog/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Create the authoritative Runtime V2 architecture suite under `docs/specifications/framework/taskplane-runtime-v2/`, index it from the specifications docs, and restage the implementation program around a no-TMUX / no-`/task` foundation so future execution work has a durable map.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/spawn-telemetry-stability.md` — source investigation that motivated the redesign
- `docs/specifications/framework/taskplane-runtime-v2/README.md` — new suite entry point and document map
- `docs/specifications/README.md` — ensure the new suite is indexed correctly

## Environment

- **Workspace:** `docs/specifications/`, `taskplane-tasks/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `docs/specifications/framework/taskplane-runtime-v2/*`
- `docs/specifications/README.md`
- `docs/specifications/taskplane/spawn-telemetry-stability.md`
- `taskplane-tasks/CONTEXT.md`

## Steps

### Step 0: Preflight

- [ ] Review the spawn-telemetry investigation and existing architecture docs
- [ ] Review the unimplemented mailbox and polyrepo/segment task horizon before staging the new plan

### Step 1: Author Runtime V2 Planning Suite

- [ ] Create the Runtime V2 architecture, process model, mailbox/bridge, observability, polyrepo compatibility, rollout, and crosswalk docs
- [ ] Document the no-TMUX, no-`/task`, mailbox-first direction clearly enough for future sessions to pick up without conversation context

### Step 2: Restage the Backlog

- [ ] Map open work (`TP-082` through `TP-093`) onto the Runtime V2 foundation
- [ ] Stage new implementation tasks required to reach a usable Runtime V2 foundation

### Step 3: Validation and Delivery

- [ ] Index the new docs from the specifications README
- [ ] Update the investigation doc to point at the follow-on architecture suite
- [ ] Record the staging outcome in task memory and mark the planning suite complete

## Documentation Requirements

**Must Update:**
- `docs/specifications/framework/taskplane-runtime-v2/README.md`
- `docs/specifications/README.md`
- `docs/specifications/taskplane/spawn-telemetry-stability.md`

**Check If Affected:**
- `README.md`
- `docs/explanation/architecture.md`

## Completion Criteria

- [ ] Runtime V2 planning docs exist and are indexed
- [ ] The implementation crosswalk covers mailbox and polyrepo/segment horizon work
- [ ] The planning task is durably recorded so future sessions can resume from task packets alone

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-100): complete Step N — description`
- **Bug fixes:** `fix(TP-100): description`
- **Tests:** `test(TP-100): description`
- **Hydration:** `hydrate: TP-100 expand Step N checkboxes`

## Do NOT

- Implement runtime code in this task
- Reintroduce TMUX or `/task` as a v2 dependency
- Leave the new planning suite unindexed

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
