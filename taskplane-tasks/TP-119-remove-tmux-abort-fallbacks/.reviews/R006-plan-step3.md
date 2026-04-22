## Plan Review: Step 3: Remove dead TMUX helpers

### Verdict: REVISE

### Summary
The Step 3 intent is directionally correct, but the current plan is missing critical dependency handling for helper exports that are still referenced outside the Step 3 checklist. As written, removing `tmuxHasSession`, `tmuxKillSession`, and `tmuxAsync` from `execution.ts` will either break imports or force ad-hoc decisions during implementation. Add explicit outcomes for those remaining call sites before proceeding.

### Issues Found
1. **[Severity: important]** — The plan removes sync TMUX helpers from `execution.ts` but does not account for active importers outside Step 3 scope: `extensions/taskplane/engine.ts:9` (`tmuxKillSession`) and `extensions/taskplane/extension.ts:20` (`tmuxHasSession`). If helpers are deleted without a migration decision, Step 3 will fail build/runtime checks.
2. **[Severity: important]** — The plan removes `tmuxAsync` from `execution.ts` without covering current consumers: `extensions/taskplane/merge.ts:10,2569` and async wrappers in `execution.ts` itself (`tmuxHasSessionAsync`, `tmuxKillSessionAsync`, pane capture). This needs an explicit replacement path (re-home helper, inline command exec, or keep minimal shared helper) to avoid breaking merge health monitoring.

### Missing Items
- Explicit Step 3 outcome for handling non-abort call sites identified in preflight inventory (`engine.ts`, `extension.ts`, `merge.ts`) when helper exports are removed.
- Explicit decision on whether TMUX liveness/kill behavior is being removed entirely vs. relocated to narrower modules.

### Suggestions
- Add a completion check: grep for `tmuxHasSession|tmuxKillSession|tmuxAsync` imports/usages after edits to verify only intended TMUX paths remain.
- Fold in R005 cleanup suggestion while touching Step 3 scope: remove unused `prefix` in `resume.ts` if still present.