# R001 — Plan Review (Step 1: Diagnose the exact merge/rebase conflict)

## Verdict
**Changes requested**

## What I reviewed
- `taskplane-tasks/TP-099-integration-status-preservation/PROMPT.md`
- `taskplane-tasks/TP-099-integration-status-preservation/STATUS.md`
- `extensions/taskplane/extension.ts` (integration execution paths)
- `extensions/taskplane/merge.ts` (artifact checkpointing in merge worktree)
- `extensions/taskplane/supervisor.ts` (PR merge strategy)
- `extensions/tests/orch-integrate.integration.test.ts` (real-git test patterns)

## Blocking findings

### 1) Step 1 plan is not present in the task STATUS
In the task packet STATUS (`taskplane-tasks/.../STATUS.md`), Step 1 is still only two broad prompt-level checkboxes and has no concrete diagnosis procedure (commands, expected observations, decision criteria).

For Review Level 2, this is not implementation-ready.

### 2) The diagnosis plan must explicitly map to actual runtime integration paths
Current integration code paths do **not** run a rebase:
- `/orch-integrate` ff mode: `git merge --ff-only` (`extension.ts`)
- `/orch-integrate --merge`: `git merge --no-edit` (`extension.ts`)
- `/orch-integrate --pr`: push + `gh pr create` (`extension.ts`)
- Supervisor PR merge: `gh pr merge --squash` fallback `--merge` (`supervisor.ts`)

So Step 1 must explicitly answer: **where exactly is `git rebase main` happening in the failing flow?** If it is manual/out-of-band, state that and scope mitigation accordingly.

### 3) The plan does not include a differential diagnosis between rebase-loss vs merge-artifact overwrite
There is a second plausible drop point in `merge.ts`: artifact staging copies `STATUS.md/.DONE/REVIEW_VERDICT.json` from `repoRoot` into `mergeWorkDir` before committing checkpoint artifacts. This can overwrite merged lane state if `repoRoot` has stale task files.

Step 1 must isolate these two hypotheses:
- H1: rebase conflict/drop before PR/squash
- H2: merge-stage artifact overwrite in `merge.ts`

Without this split, implementation risk is high (fixing the wrong layer).

## Required updates before approval

1. Expand Step 1 in task `STATUS.md` into a concrete repro matrix with at least:
   - **Case A**: no rebase, just orch merge path
   - **Case B**: orch branch rebased onto updated main
   - **Case C**: squash merge result check
2. For each case, specify exact git evidence to capture:
   - `git log --oneline --graph`
   - `git diff main...orch -- <task>/STATUS.md`
   - blob hashes for `STATUS.md` before/after (`git rev-parse <commit>:<path>`)
3. Add an explicit decision rule in Step 1 output:
   - identify one authoritative operation that drops state (rebase vs merge.ts checkpoint overwrite vs squash)
4. Include `.DONE` and `.reviews/` in diagnosis validation, not just `STATUS.md`.
5. Reuse existing real-git test style from `orch-integrate.integration.test.ts` (temp repo + deterministic commits) so Step 3 test implementation is straightforward.

## Non-blocking note
There appears to be analysis captured in root `STATUS.md` (repo root) but not in the task packet STATUS. Keep planning state in the task packet to avoid reviewer/worker drift.
