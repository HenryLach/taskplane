# R003 — Plan Review (Step 2: Implement STATUS.md preservation)

### Verdict: REVISE

## What I reviewed
- `taskplane-tasks/TP-099-integration-status-preservation/PROMPT.md`
- `taskplane-tasks/TP-099-integration-status-preservation/STATUS.md` (Step 2 plan)
- `extensions/taskplane/merge.ts` (artifact staging block)
- `extensions/taskplane/execution.ts` (`commitTaskArtifacts` behavior)

## Blocking findings

1. **Scope drift on `.reviews/` artifacts (contract risk)**  
   The Step 2 plan says to source `.reviews/` from lane worktrees. Current merge artifact staging in `merge.ts` is intentionally TP-035 allowlisted to exactly:
   - `.DONE`
   - `STATUS.md`
   - `REVIEW_VERDICT.json`

   Expanding to `.reviews/` is a behavior/security contract change and is not required to fix the confirmed root cause for #356 (STATUS overwrite from `repoRoot`).

2. **Overwrite decision rule is ambiguous**  
   The plan says “check if file exists and has different content from lane merge” before deciding skip/overwrite, but it does not define a reliable way to determine “from lane merge” provenance. This is error-prone.

   For this bug, the safe deterministic rule should be explicit: **never overwrite an existing allowlisted artifact already present in `mergeWorkDir`; only backfill missing artifacts.**

3. **Missing deterministic source resolution for backfill**  
   “Copy from lane worktree path instead of `repoRoot`” is directionally correct, but the plan needs exact source-selection rules per task/lane plus path containment checks (repo-root escape protection) consistent with current hardening.

## Required updates before approval

1. In Step 2 plan text, explicitly keep TP-035 allowlist unchanged unless a separate task authorizes expansion.
2. Define the artifact algorithm precisely:
   - Build allowlisted task artifact paths from lane task folders (as today).
   - If `dest` exists in `mergeWorkDir` → **skip** (no overwrite).
   - If `dest` missing → attempt backfill from lane worktree/task folder source.
   - Stage + commit only changed files.
3. Add explicit note that path safety checks (resolve/relative containment) must remain in place for any new source-path logic.

## Non-blocking suggestion
- Mention `REVIEW_VERDICT.json` explicitly in Step 2 plan so all allowlisted artifacts are covered, not just `STATUS.md`/`.DONE`.
