# R003 — Plan Review (Step 1: Apply naming contract consistently)

## Verdict
**Changes requested**

## Reviewed artifacts
- `taskplane-tasks/TP-010-team-scale-session-and-worktree-naming/PROMPT.md`
- `taskplane-tasks/TP-010-team-scale-session-and-worktree-naming/STATUS.md`
- `taskplane-tasks/TP-010-team-scale-session-and-worktree-naming/naming-contract.md`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/abort.ts`

## Blocking findings

### 1) Step 1 plan is not hydrated to implementation-level work items
`STATUS.md` still has only two high-level bullets for Step 1 (`STATUS.md:27-28`).
For this blast radius, the plan needs explicit module-level checklist items (what changes in each file, and why).

### 2) Step 1 plan is built on unresolved Step 0 contract gaps
The current contract still leaves collision/interference gaps that must be resolved before implementation:
- `repoSlug` is defined (`naming-contract.md:63-74`) but not included in repo-mode naming formulas (`naming-contract.md:101-103`, `135`).
- `listWorktrees()` change is described as pattern expansion only (`naming-contract.md:140-143`) without operator scoping.
- merge temp worktree directory naming is not addressed in the contract, while code uses fixed path `merge-workspace` (`merge.ts:548`).

If Step 1 proceeds as-is, naming will still be unsafe in concurrent team usage.

### 3) Plan does not define operator-scoped discovery/cleanup behavior (critical for team-scale)
Current consumers operate on broad prefix patterns and can affect other operators:
- orphan detection uses only `tmux_prefix` (`extension.ts:133-134`)
- abort session targeting filters by prefix/pattern, not operator ownership (`abort.ts:41-49`)
- worktree discovery/cleanup call sites are prefix-only (`engine.ts:472`, `resume.ts:1034`, `resume.ts:1053`)
- sidecar cleanup deletes all matching files regardless of owner (`engine.ts:650-653`)

Step 1 plan must explicitly include ownership scoping rules (by opId and/or batch context) for these paths.

### 4) Naming context lifecycle for resume/recovery is not planned
The plan says to resolve operator ID and thread it through naming (`naming-contract.md:210-230`), but does not specify lifecycle guarantees for resume:
- where `opId` is captured (once per batch)
- how it is persisted/reused across `/orch-resume`
- how mixed-operator resume is handled intentionally

Without this, determinism/recoverability can regress (especially when session/worktree matching becomes operator-scoped).

### 5) Step 1 plan lacks explicit test impact map for changed naming surfaces
Given required changes across `waves.ts`, `worktree.ts`, `merge.ts`, and session/cleanup consumers, Step 1 plan needs a concrete test update list before implementation. At minimum include targeted updates/additions in:
- `extensions/tests/waves-repo-scoped.test.ts`
- `extensions/tests/worktree-lifecycle.test.ts`
- `extensions/tests/merge-repo-scoped.test.ts`
- `extensions/tests/external-task-path-resolution.test.ts` and/or `orch-state-persistence.test.ts` (session filtering/abort/recovery behaviors)

## Required plan updates before approval
1. Hydrate Step 1 in `STATUS.md` with file-level tasks and sequencing.
2. Resolve Step 0 contract defects first (repoSlug usage, operator-scoped worktree discovery semantics, merge worktree naming).
3. Add explicit owner-scoping plan for session detection, abort targeting, worktree cleanup/reset, and sidecar cleanup.
4. Define `opId` lifecycle contract for batch start + persistence + resume.
5. Add a targeted test plan tied to each modified module.

## Non-blocking note
- `STATUS.md` Reviews table is malformed/duplicated (`STATUS.md:61-68`), which makes reviewer state tracking noisy.
