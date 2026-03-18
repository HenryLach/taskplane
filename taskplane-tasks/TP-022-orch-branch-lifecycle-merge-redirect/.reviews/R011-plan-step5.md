## Plan Review: Step 5: Testing & Verification

### Verdict: REVISE

### Summary
The Step 5 plan is directionally correct but currently under-specifies several required verification outcomes for TP-022. In `STATUS.md:94-98`, the checklist is shorter than the Step 5 requirements in `PROMPT.md:130-137`, so key branch-lifecycle guarantees could regress without being explicitly validated. Add those missing outcomes and tighten one ambiguous merge-validation item before proceeding.

### Issues Found
1. **[Severity: important]** — The Step 5 checklist in `taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:94-98` omits required prompt outcomes from `PROMPT.md:133-137`: (a) verify worktrees are based on `orchBranch`, (b) verify post-merge worktree reset targets `orchBranch`, and (c) verify cleanup preserves `orchBranch` in manual integration mode. **Suggested fix:** add these as explicit Step 5 verification items so completion criteria are directly tested.
2. **[Severity: important]** — “Merge no longer touches user's branch” (`STATUS.md:96`) is too broad for the current gated implementation in `extensions/taskplane/merge.ts:775-820`, which has distinct checked-out vs non-checked-out advancement paths. **Suggested fix:** state explicit verification intent for both paths (non-checked-out `update-ref` path and checked-out fast-forward fallback path) and assert the repo-mode user checkout isolation guarantee.
3. **[Severity: minor]** — The plan says “Unit tests passing” (`STATUS.md:94`) but does not explicitly tie this to the required full-suite command in `PROMPT.md:130` (`cd extensions && npx vitest run`) or capture focused regression intent for resume parity/terminal-phase gating touched in Step 4. **Suggested fix:** include the exact full-suite run and call out targeted regressions already added for engine/resume parity.

### Missing Items
- Explicit Step 5 checks for worktree base branch routing, post-merge reset target, and manual-mode orch-branch preservation.
- Explicit two-path merge advancement verification aligned with current `merge.ts` behavior.
- Explicit full-suite execution command and regression coverage intent for resume parity behaviors.

### Suggestions
- Keep Step 5 concise, but align each checklist item 1:1 with `PROMPT.md:130-137` to avoid accidental scope drop.
- When recording completion, include a short result note (e.g., vitest pass count + any targeted scenarios run) for auditability.
