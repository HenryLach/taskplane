## Code Review: Step 2 — rpc-wrapper mailbox check and steer injection

### Verdict: REVISE

### Scope reviewed
- Diff range: `6563c52821cc1d21ed1949df97938808ff12049f..HEAD`
- Changed files:
  - `bin/rpc-wrapper.mjs`
  - `taskplane-tasks/TP-089-mailbox-core-and-rpc-injection/STATUS.md`
- Neighboring context checked:
  - `extensions/taskplane/mailbox.ts`
  - `extensions/taskplane/types.ts`

### Findings

1. **[High] Messages are acked as "delivered" even when nothing was injected (stdin unavailable).**
   - **Where:** `bin/rpc-wrapper.mjs` lines 596–613
   - **What happens:** `checkMailboxAndSteer()` only conditionally writes to stdin:
     - if `proc.stdin && !proc.stdin.destroyed`, write `steer`
     - otherwise it still renames message to `ack/`, increments `delivered`, and logs `[STEERING] Delivered message ...`
   - **Why this is a problem:** `ack/` is intended as delivery proof. If stdin is closed/destroyed, this code drops messages while falsely marking them delivered, violating mailbox delivery semantics.
   - **Repro (ran locally):** invoking `checkMailboxAndSteer()` with `proc.stdin.destroyed=true` moved `1.msg.json` to `ack/` and returned `{ delivered: 1 }` without any write.
   - **Suggested fix:** require successful injection precondition before acking/logging delivery. If stdin is unavailable, keep message in inbox and count as skipped (or return early).

### Non-blocking notes
- `existsSync` was added to `rpc-wrapper.mjs` imports but is unused.

### Validation performed
- `git diff 6563c52821cc1d21ed1949df97938808ff12049f..HEAD --name-only`
- `git diff 6563c52821cc1d21ed1949df97938808ff12049f..HEAD`
- `node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/rpc-wrapper.test.ts` (pass)
