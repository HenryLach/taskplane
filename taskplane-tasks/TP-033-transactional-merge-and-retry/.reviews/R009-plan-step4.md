## Plan Review: Step 4: Documentation & Delivery

### Verdict: REVISE

### Summary
The Step 4 plan is directionally correct, but it is too thin to reliably satisfy TP-033 documentation outcomes. It currently tracks only a generic “config docs updated” checkbox plus `.DONE`, without specifying the required retry-policy content or the prompt-mandated secondary docs impact check. Tightening these outcomes will prevent shipping behavior changes without clear operator-facing documentation.

### Issues Found
1. **[Severity: important]** — The plan does not define what must be documented in the retry policy section.
   - Evidence: `PROMPT.md:105-112` requires documenting retry policy in `docs/reference/configuration/task-orchestrator.yaml.md`, but `STATUS.md:73` only says “Config reference docs updated.”
   - Suggested fix: Add explicit outcomes to document (at minimum) the merge failure classifications, retriable vs non-retriable behavior, max attempts/cooldowns, and exhaustion behavior.

2. **[Severity: important]** — The plan omits the required “check if affected” for command docs.
   - Evidence: `PROMPT.md:113-114` explicitly calls out checking `docs/reference/commands.md` if merge output changed; Step 4 checklist in `STATUS.md:73-74` does not include this decision point.
   - Suggested fix: Add a Step 4 outcome to explicitly assess command-surface impact and either update `docs/reference/commands.md` or record “no change required” with rationale.

3. **[Severity: minor]** — `.DONE` gating is not tied to a verification condition.
   - Evidence: `STATUS.md:74` has `.DONE` creation as a standalone item, but no “done when docs reflect implemented behavior” acceptance statement.
   - Suggested fix: Add a short completion gate (e.g., docs updated + impact check completed + STATUS/review entries current) before creating `.DONE`.

### Missing Items
- Explicit retry-matrix documentation outcomes (content-level, not just file touched).
- Explicit commands-doc impact check outcome per prompt.
- Clear completion gate criteria before `.DONE`.

### Suggestions
- In the config reference, include a compact table matching implemented policy values and note precedence with `failure.on_merge_failure` when retries are exhausted.
- Add a brief note for scope key semantics (`{repoId}:w{N}:l{K}`, `default` fallback) so workspace operators can interpret persisted retry counters.
