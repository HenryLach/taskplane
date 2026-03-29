## Code Review: Step 2 — rpc-wrapper mailbox check and steer injection

### Verdict: APPROVE

### Scope reviewed
- Diff range: `6563c52821cc1d21ed1949df97938808ff12049f..HEAD`
- Changed files:
  - `bin/rpc-wrapper.mjs`
  - `taskplane-tasks/TP-089-mailbox-core-and-rpc-injection/STATUS.md`
- Neighboring context checked:
  - `extensions/taskplane/mailbox.ts`
  - `extensions/taskplane/types.ts`
  - `extensions/tests/rpc-wrapper.test.ts`

### Findings
No blocking issues found in the current Step 2 implementation.

The previously reported delivery-proof bug is fixed: when `proc.stdin` is unavailable/destroyed, messages are now skipped and left in `inbox/` (not moved to `ack/`, not counted as delivered).

### Non-blocking notes
- New mailbox behavior in `rpc-wrapper.mjs` is not yet covered by direct tests (`parseArgs --mailbox-dir`, `checkMailboxAndSteer`, `isValidMailboxMessageShape`, startup `set_steering_mode`). Given Step 6 is the dedicated test step, this is acceptable for now, but those should be added there.

### Validation performed
- `git diff 6563c52821cc1d21ed1949df97938808ff12049f..HEAD --name-only`
- `git diff 6563c52821cc1d21ed1949df97938808ff12049f..HEAD`
- `node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/rpc-wrapper.test.ts` (pass)
- Manual runtime check of `checkMailboxAndSteer()` with destroyed stdin confirms message stays in inbox and is not acked.
