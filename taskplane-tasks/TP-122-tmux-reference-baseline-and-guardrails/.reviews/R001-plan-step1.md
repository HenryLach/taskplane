## Plan Review: Step 1: Add audit script

### Verdict: REVISE

### Summary
The Step 1 checklist captures the core deliverables (new script, machine-readable summary, strict mode), but the current plan is missing key outcome-level guardrails needed to keep the audit reliable. In particular, strict-mode detection boundaries and deterministic output contract are not defined, which creates a high risk of false positives or unstable output that would undermine the guardrail.

### Issues Found
1. **[Severity: important]** — The plan does not define what counts as “functional TMUX command usage” for strict mode. Without explicit scope (e.g., process execution of `tmux` via spawn/exec/shell vs plain strings/comments/compat metadata), the script can incorrectly fail on non-functional references and block follow-up work. **Suggested fix:** add plan language for a concrete detection strategy and explicit exclusions.
2. **[Severity: important]** — “Machine-readable summary” is listed, but no stable output contract is planned (schema + ordering rules). Step 2 requires parseable and deterministic output, so this needs to be decided in Step 1. **Suggested fix:** define a fixed JSON schema and deterministic sorting/normalization rules (stable file ordering, stable category ordering, normalized paths).

### Missing Items
- A planned classification rule-set for by-category reporting (how matches are assigned to compat-code vs user-facing strings vs comments/docs vs types/contracts).
- A clear strict-mode failure contract (exit code behavior and what is included in failure diagnostics).

### Suggestions
- Add `--strict` and `--json` (or equivalent) CLI behavior explicitly in the plan so Step 2 tests can target a stable interface.
- Include at least one “known-good” output example in STATUS.md once implemented to reduce ambiguity for future tasks.
