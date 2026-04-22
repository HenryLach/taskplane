## Code Review: Step 1: Remove TMUX from task-runner.ts

### Verdict: REVISE

### Summary
The TMUX extrication in `extensions/task-runner.ts` is substantial and the core objective (removing `spawnAgentTmux` and spawn-mode branching) appears implemented. However, Step 1 is not complete yet because the repository test suite is currently failing due to stale task-runner contract tests that still assert TMUX-era behavior. Since Step 1 explicitly includes updating tests that reference removed TMUX code, these failures are blocking.

### Issues Found
1. **[extensions/tests/persistent-worker-context.test.ts:302,359,386] [important]** — This test file still asserts TMUX-specific contracts (`spawnAgentTmux`, TMUX-style context kill/wall-clock strings). After your code changes, these assertions fail, and full test run fails.  
   **Fix:** Update this file to subprocess-only expectations (or restore equivalent behavior if still required), so it validates current Step 1 contracts instead of removed TMUX internals.

2. **[extensions/tests/mailbox.test.ts:862,869] [important]** — Mailbox contract tests still require TMUX/rpc-wrapper steering-path plumbing in task-runner (`steeringPendingPath`, `--steering-pending-path`), but that path no longer exists in this step, causing additional failures.  
   **Fix:** Either (a) restore equivalent steering-pending behavior in subprocess mode, or (b) explicitly migrate the contract/tests to the new subprocess design and remove stale assertions.

### Pattern Violations
- Several updated test files were reduced to source-string checks only, which weakens behavioral verification for critical task-runner flows (spawn, telemetry, reviewer lifecycle). This is not a blocker by itself, but it increases regression risk.

### Test Gaps
- Full suite currently fails (`node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`) with 5 failing tests, all tied to stale TMUX-era task-runner expectations.
- The revised tests in this step do not exercise subprocess runtime behavior end-to-end (they mostly assert static source contents).

### Suggestions
- Prefer replacing removed TMUX assertions with subprocess behavioral tests (mock `spawn`, validate args/callback effects), not just `toContain` checks.
- If steering annotation is intentionally dropped for task-runner subprocess mode, document that contract shift in the relevant task-runner/mailbox test comments to avoid future ambiguity.
