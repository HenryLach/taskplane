# R002 — Code Review (Step 0: Define naming contract)

## Verdict
**Changes requested**

## Scope reviewed
Baseline diff: `7135eb2..HEAD`

Changed files:
- `taskplane-tasks/TP-010-team-scale-session-and-worktree-naming/naming-contract.md`
- `taskplane-tasks/TP-010-team-scale-session-and-worktree-naming/STATUS.md`
- `taskplane-tasks/TP-010-team-scale-session-and-worktree-naming/.reviews/*`
- `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/STATUS.md` (out-of-scope noise)

Neighboring implementation checked for consistency:
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/abort.ts`
- `extensions/taskplane/engine.ts`

---

## Blocking findings

### 1) Repo slug is defined but not actually included in repo-mode naming formulas
`naming-contract.md` introduces `repoSlug` specifically for cross-repo disambiguation (`naming-contract.md:63-74`), but the concrete repo-mode formulas omit it:
- TMUX repo mode: `{tmux_prefix}-{opId}-lane-{N}` (`naming-contract.md:101`)
- Worktree: `{worktree_prefix}-{opId}-{N}` (`naming-contract.md:135`)

This leaves a collision path for the **same operator** running two repo-mode batches in different repos on the same machine (same lane number / same second).

Current code context confirms repo mode currently has no repo dimension (`waves.ts:503-507`), so this contract should explicitly close that gap.

**Required fix:** Update the contract to include `repoSlug` wherever names are machine-global in repo mode (at minimum TMUX sessions; and worktree names when `worktree_location: sibling`).

---

### 2) Worktree discovery contract is not operator-scoped, which can cause cross-run interference
The contract says `listWorktrees()` should match `{prefix}-{opId}-{N}` and legacy `{prefix}-{N}` (`naming-contract.md:140-143`), but does not require filtering to the **current operator**.

That is unsafe with current call sites:
- `ensureLaneWorktrees()` reuses/resets discovered worktrees (`worktree.ts:1195-1220`)
- `removeAllWorktrees()` deletes discovered worktrees (`worktree.ts:1294-1303`)

If discovery is prefix-only across all `opId`s, one operator can reset/reuse/remove another operator’s active worktrees.

**Required fix:** Contract must specify operator-scoped discovery/cleanup semantics (e.g., `listWorktrees(prefix, repoRoot, opId)`), with a deliberate legacy-handling strategy that does not capture other operators’ resources.

---

### 3) Merge worktree directory collision remains unaddressed
The contract updates merge temp branch naming (`naming-contract.md:154-158`) and sidecar names (`naming-contract.md:164-168`) but does not update merge worktree directory naming.

Current merge path is a single fixed directory:
- `join(repoRoot, ".worktrees", "merge-workspace")` (`merge.ts:548`)

So concurrent merges in the same repo still contend on one path even after `opId` is introduced.

**Required fix:** Add merge worktree directory naming to the contract (include `opId` and/or `batchId`) plus cleanup rules.

---

## Non-blocking notes

1. `STATUS.md` table formatting is broken in Reviews section (separator row appears after entries) and contains duplicate `R001` rows (`STATUS.md:62-65`).
2. `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/STATUS.md` changed in this step diff but is unrelated to TP-010 step 0; consider reverting to keep scope clean.
