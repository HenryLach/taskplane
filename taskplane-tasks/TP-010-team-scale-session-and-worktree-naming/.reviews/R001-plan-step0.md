# R001 — Plan Review (Step 0: Define naming contract)

## Verdict
**Changes requested**

## Reviewed artifacts
- `taskplane-tasks/TP-010-team-scale-session-and-worktree-naming/PROMPT.md`
- `taskplane-tasks/TP-010-team-scale-session-and-worktree-naming/STATUS.md`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/abort.ts`
- `extensions/taskplane/sessions.ts`
- `extensions/taskplane/engine.ts`
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md`

## Blocking findings

### 1) Step 0 plan is not hydrated yet
`STATUS.md` still only contains the prompt-level bullets for Step 0 (`STATUS.md:19-20`), with no concrete implementation plan items.

For a naming-contract task with cross-module blast radius, Step 0 needs explicit, file-level planning before implementation starts.

### 2) Naming contract scope is not defined across all naming surfaces
Current naming is spread across multiple modules and formats:
- lane ID / tmux lane session naming in `waves.ts` (`waves.ts:482-507`)
- lane branch + worktree directory naming in `worktree.ts` (`worktree.ts:23-24`, `worktree.ts:66-74`)
- merge session + merge temp artifacts/workspace naming in `merge.ts` (`merge.ts:547-548`, `merge.ts:596-599`)

The Step 0 plan does not define one canonical component contract (repo slug/operator/batch/lane) that these surfaces must share. Without this, Step 1 can easily ship inconsistent identifiers.

### 3) Operator/repo slug fallback and sanitization rules are not specified
The task requires fallback rules when operator metadata is unavailable, but Step 0 does not define:
- source precedence for operator identity,
- normalization/sanitization/truncation rules,
- behavior when repo IDs contain characters unsafe for tmux/file paths.

Relevant risk signals in current code:
- `waves.ts` assumes validated repo IDs for tmux-safe naming (`waves.ts:496` comment),
- workspace validation focuses on repo paths, not explicit repo-id character policy (`workspace.ts:177`, `workspace.ts:207`, `workspace.ts:253`).

### 4) Parser/consumer compatibility plan is missing
Several consumers parse or pattern-match session names today:
- abort targeting (`abort.ts:45`, `abort.ts:48`)
- `/orch-sessions` prefix filter (`sessions.ts:43`)
- batch-history lane extraction from session name (`engine.ts:543`)

Step 0 needs an explicit compatibility strategy so new naming does not silently break abort/reconcile/observability flows.

### 5) Step 0 acceptance tests are not planned
No test matrix is defined yet for the naming contract itself (determinism, uniqueness, readability, fallback behavior, parser compatibility).

Given TP-010 requirements and backlog acceptance (`polyrepo-execution-backlog.md` TP-POLY-007), Step 0 should lock test expectations before Step 1 code changes.

## Required plan updates before approval
1. Hydrate Step 0 in `STATUS.md` into concrete implementation checklist items (module-by-module).
2. Define canonical naming schema (component order, separators, max length, allowed chars) and apply matrix per artifact type:
   - lane IDs
   - lane tmux sessions
   - worker/reviewer derived sessions
   - merge tmux sessions
   - worktree directories
   - lane branches
   - merge temp worktree/branch/result/request artifacts
3. Specify operator-id fallback precedence + sanitization and explicit fallback token when metadata is unavailable.
4. Specify repo-slug derivation/sanitization and collision behavior.
5. Add compatibility plan for name consumers (`abort.ts`, `sessions.ts`, `engine.ts`) and persistence/resume implications.
6. Add Step 0 test plan (pure-function tests + collision scenarios + compatibility parsing tests).
7. Include Step 0 documentation outputs (contract draft target locations) so Step 4 doc updates are prepared, not deferred.

## Non-blocking note
- `STATUS.md` execution log contains duplicated start rows (`STATUS.md:74` and `STATUS.md:76`). Consider cleaning for operator clarity.
