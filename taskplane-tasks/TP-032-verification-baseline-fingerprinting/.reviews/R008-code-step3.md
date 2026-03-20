## Code Review: Step 3: Configuration & Modes

### Verdict: REVISE

### Summary
Step 3 correctly wires the new `orchestrator.verification` config through schema/defaults, YAML mapping, legacy adapters, and merge-time behavior gating. The strict/permissive branches and `flaky_reruns` threading are implemented in runtime flow and the suite is currently green. However, these new decision paths are still unprotected by targeted regression tests, which is too risky for merge-policy-sensitive behavior.

### Issues Found
1. **[merge.ts:872-940, merge.ts:1085-1104] [important]** — New strict/permissive baseline-unavailable behavior and `verification.enabled` feature-gating were added without direct behavioral tests.
   - **Risk:** Regressions here can silently flip from “fail/pause” to “continue” (or vice versa), impacting merge safety and operator expectations.
   - **Fix:** Add merge-flow tests that assert: (a) `enabled=true + mode=strict + no testing commands` fails merge, (b) `enabled=true + mode=permissive + no testing commands` continues without baseline verification, (c) `enabled=false` skips baseline logic even when `testing_commands` exist.

2. **[config-loader.ts:261-263, config-loader.ts:766-772, types.ts:56-61] [important]** — Verification config plumbing (YAML mapping + snake_case adapter output) has no dedicated loader/adapter assertions.
   - **Risk:** `verification.flaky_reruns` / mode mapping can drift or regress without detection, leaving config present but behavior inert.
   - **Fix:** Extend `extensions/tests/project-config-loader.test.ts` with explicit checks for defaults, YAML `verification.flaky_reruns` mapping, and `toOrchestratorConfig()` round-trip output.

3. **[merge.ts:551-552] [minor]** — Function docs still say flaky failures are “re-run once,” but behavior is now configurable via `flakyReruns`.
   - **Fix:** Update that comment to match the new configurable rerun count semantics.

### Pattern Violations
- Behavior-changing runtime/config changes landed without accompanying targeted tests (project standard: `AGENTS.md` → “Always do” #3).

### Test Gaps
- No direct tests for strict vs permissive baseline-unavailable paths.
- No direct test for feature-flag precedence (`verification.enabled` should fully gate fingerprinting).
- No direct test for `flaky_reruns: 0` (disable rerun) and `flaky_reruns > 1` retry loop behavior.
- No config-loader regression test covering verification mapping/adapter output.

### Suggestions
- Add a focused verification-mode test block (either new `verification-baseline.test.ts` or merge tests) before advancing to Step 4 completion sign-off.
- Keep `merge.verify` and baseline-fingerprinting behavior explicitly separated in tests to prevent future coupling regressions.
