# Task: TP-113 - Legacy TMUX Backend Deprecation and Registry-Only Operator Surface

**Created:** 2026-03-31
**Size:** L

## Review Level: 3 (Full)

**Assessment:** This is the Runtime V2 cleanup transition task: formalize legacy TMUX backend deprecation, move operator surfaces to registry-first/registry-only behavior, and reduce accidental TMUX coupling in day-to-day orchestration.
**Score:** 7/8 — Blast radius: 3, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-113-legacy-tmux-backend-deprecation-and-registry-only-operator-surface/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Transition Taskplane from dual-surface runtime behavior to an explicit Runtime V2-first operator experience.

Deliverables:

1. Deprecation posture for legacy TMUX backend (`spawn_mode: tmux` and TMUX-centric operator expectations)
2. Registry-first (and where safe, registry-only) operator surfaces for agent/session visibility and steering
3. Tight legacy fallback boundaries with explicit messaging, not silent TMUX assumptions

This task follows TP-112 and is the cleanup step toward Runtime V2 default/sunsetting TMUX runtime dependence.

## Dependencies

- **Task:** TP-108 (batch+merge Runtime V2 migration)
- **Task:** TP-109 (workspace packet-home + resume alignment)
- **Task:** TP-112 (resume/monitor de-TMUX parity)

## Explicit Non-Goals

- Do not remove every TMUX helper function in one pass
- Do not break legacy batch recovery for already-persisted legacy sessions
- Do not couple this work to TP-111 conversation fidelity

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/sessions.ts`
- `extensions/taskplane/worktree.ts` (preflight/doctor)
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/types.ts` (naming fields such as `tmuxSessionName`)

## Environment

- **Workspace:** `extensions/taskplane/`, `docs/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/sessions.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/types.ts` (additive aliasing/rename prep only)
- `extensions/tests/*supervisor*.test.ts`
- `extensions/tests/*routing*.test.ts`
- `extensions/tests/*doctor*.test.ts`
- `extensions/tests/*session*.test.ts`

## Steps

### Step 0: Preflight inventory and boundary map

- [ ] Inventory all remaining TMUX references by category: legacy runtime, operator fallback, diagnostics/docs, naming debt
- [ ] Define deprecation boundary: what remains supported short-term vs what is now V2-only
- [ ] Log explicit keep/remove rationale in STATUS.md

### Step 1: Config and preflight deprecation posture

- [ ] Mark `spawn_mode: tmux` as deprecated in config handling and operator messaging
- [ ] Ensure doctor/preflight messaging is V2-first and only treats TMUX as legacy compatibility
- [ ] Add explicit warnings when projects are still configured for TMUX backend

### Step 2: Operator surface migration

- [ ] Make `list_active_agents`, status/session views, and steering validation registry-first
- [ ] Restrict TMUX fallback to explicit legacy contexts (not default/noisy dual path)
- [ ] Remove/alias TMUX-centric user-facing wording where registry runtime data exists

### Step 3: Abort/recovery and safety shims

- [ ] Keep minimal legacy TMUX cleanup shims for old sessions/batches
- [ ] Ensure abort/recovery behavior is deterministic and registry-owned in V2 path
- [ ] Avoid duplicate control flows that can diverge between extension fallback and runtime modules

### Step 4: Naming and schema cleanup prep

- [ ] Introduce neutral naming bridge (`laneSessionName` / `laneRuntimeId`) where feasible
- [ ] Keep backward-compatible read/write behavior for persisted state
- [ ] Add migration notes for future full TMUX code removal

### Step 5: Tests and verification

- [ ] Add behavioral tests for registry-only operator path in V2 batches
- [ ] Add tests that legacy fallback activates only under explicit legacy conditions
- [ ] Run targeted tests
- [ ] Run full suite
- [ ] Fix all failures

### Step 6: Documentation and release notes

- [ ] Update Runtime V2 rollout docs to reflect deprecation state and remaining compatibility shims
- [ ] Update operator command docs for registry-first behavior
- [ ] Add migration guidance for users still on legacy TMUX backend

## Documentation Requirements

**Must Update:**
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md`
- `docs/reference/commands.md`

**Check If Affected:**
- `README.md`
- `docs/explanation/architecture.md`

## Completion Criteria

- [ ] V2 operator surfaces are registry-first by default (no silent TMUX dependence)
- [ ] Legacy TMUX backend is explicitly deprecated with clear messaging
- [ ] Legacy fallback behavior is tightly scoped and intentional
- [ ] Full suite passes

## Git Commit Convention

- `feat(TP-113): complete Step N — ...`
- `fix(TP-113): ...`
- `test(TP-113): ...`
- `hydrate: TP-113 expand Step N checkboxes`

## Do NOT

- Remove all TMUX code blindly without preserving migration safety
- Leave mixed runtime/operator behavior undocumented
- Claim full TMUX removal unless compatibility shims are actually retired

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
