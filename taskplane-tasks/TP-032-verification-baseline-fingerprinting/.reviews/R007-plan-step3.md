## Plan Review: Step 3: Configuration & Modes

### Verdict: REVISE

### Summary
The Step 3 checklist captures the right intent, but the plan is still too thin to guarantee the new config actually controls runtime behavior. Right now it lists outcomes at a headline level (`STATUS.md:49-53`) without covering the required config plumbing chain or the concrete merge-failure behavior needed for strict mode. Tightening those outcomes will prevent a “config exists but is inert” implementation.

### Issues Found
1. **[Severity: critical]** — The plan does not include full config plumbing beyond `config-schema.ts`, so `verification` settings may never reach merge execution.
   - Evidence: Step 3 only lists three high-level bullets (`taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:49-53`).
   - Runtime path currently depends on legacy adapters/types: `types.ts` `OrchestratorConfig` has no verification section (`extensions/taskplane/types.ts:11-55`), `mapOrchestratorYaml()` does not map a verification block (`extensions/taskplane/config-loader.ts:236-261`), and `toOrchestratorConfig()` does not emit verification fields (`extensions/taskplane/config-loader.ts:721-766`).
   - Suggested fix: Add an explicit Step 3 outcome that includes schema + loader mapping + legacy adapter + runtime type/default updates.

2. **[Severity: important]** — Strict/permissive behavior is not defined at the actual baseline-unavailable decision point.
   - Evidence: baseline capture failure currently always continues permissively (`extensions/taskplane/merge.ts:867-875`).
   - Risk: “strict mode” can be declared in config but still silently behave as permissive, violating PROMPT requirements (`PROMPT.md:89-91`).
   - Suggested fix: Add an outcome for strict mode to convert baseline-unavailable into a merge failure with diagnostic/failureReason that triggers existing pause/abort policy handling.

3. **[Severity: important]** — `flaky_reruns` is not planned as a wired control path; current behavior is hardcoded to one rerun.
   - Evidence: implementation comments and flow explicitly rerun once (`extensions/taskplane/merge.ts:550-552`, `622-650`).
   - Risk: config drift where `flaky_reruns` appears configurable but does nothing.
   - Suggested fix: Add a Step 3 outcome specifying how rerun count is threaded into `runPostMergeVerification`, including edge behavior for `0`.

### Missing Items
- Explicit backward-compat mapping intent for YAML fallback key `flaky_reruns` and JSON camelCase key `flakyReruns`.
- Test coverage intent for config defaults/parsing and strict vs permissive baseline-unavailable behavior (both normal run and resume path).
- Definition of feature-flag precedence when `testing.commands` exists but `verification.enabled` is false.

### Suggestions
- Keep one source-of-truth resolution rule documented in plan notes: verification runs only when `verification.enabled === true` **and** testing commands are present.
- While updating STATUS, clean the duplicated review/execution entries to keep operator auditability reliable.
