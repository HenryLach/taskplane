## Plan Review: Step 4: Remove aliases

### Verdict: REVISE

### Summary
The current Step 4 checklist is too narrow to reliably achieve the stated outcome of actually removing aliases while preserving legacy state compatibility. Right now it only names type/function alias deletion plus a full-suite run (`STATUS.md:47-49`), but it does not define what legacy `tmuxSessionName` handling must remain after alias removal. As written, this can either leave stale alias usage in production paths or accidentally break the required old-state read contract.

### Issues Found
1. **[Severity: important]** — Missing explicit backward-compatibility guard for post-alias behavior. The task still requires reading prior persisted state (`PROMPT.md:94`), but Step 4 has no completion criterion for “legacy input accepted, canonical runtime state uses `laneSessionId` only.” Suggested fix: add a Step 4 outcome that compatibility is input-only (or otherwise explicitly scoped) and validated by targeted persistence/resume tests.
2. **[Severity: important]** — Missing explicit cleanup scope for remaining production `tmuxSessionName` fallbacks. “Remove aliases” (`PROMPT.md:25`, `STATUS.md:47-48`) is broader than deleting one type field and one function alias; many runtime/dashboard references currently still use `laneSessionId || tmuxSessionName`. Suggested fix: add a grep-based completion criterion defining allowed leftovers (e.g., parser/compat ingress only) so Step 4 does not stop early with stale alias references.

### Missing Items
- A concrete post-Step-4 compatibility outcome: old state files with only `tmuxSessionName` still load successfully.
- A concrete post-Step-4 cleanup outcome: non-test production references to `tmuxSessionName` are eliminated or explicitly limited to documented compatibility ingress points.

### Suggestions
- As in the Step 3 plan revision pattern, add a short “allowed leftovers” note in STATUS for Step 4 so review can quickly distinguish intentional compat code from missed renames.
- Log a post-step grep summary (production/tests/docs) to make alias-removal completeness auditable.