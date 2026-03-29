## Plan Review: Step 6 — Testing & Verification

### Verdict: REVISE

### Summary
Step 6 planning is still not execution-ready. `STATUS.md` Step 6 remains a 3-line placeholder and does not reflect the required test matrix from `PROMPT.md`.

This is effectively unchanged from R022, so the same blocking gaps remain.

---

### Blocking findings

1. **Step 6 checklist is still too thin vs `PROMPT.md` requirements.**

   `PROMPT.md` Step 6 explicitly requires named tests for mailbox write/read/ack/size/batch validation, rpc-wrapper delivery behavior, startup steering mode, supervisor send tool delivery, and full-suite execution.

   `STATUS.md` currently has only:
   - create mailbox.test.ts
   - full suite passing
   - fix failures

   **Required plan correction:** Expand Step 6 checkboxes to mirror each required behavior in `PROMPT.md` (one checkbox per required test target).

2. **RPC-wrapper mailbox coverage is not planned against existing test surface.**

   `bin/rpc-wrapper.mjs` now exposes mailbox-specific logic (`parseArgs --mailbox-dir`, `checkMailboxAndSteer`, `isValidMailboxMessageShape`, startup `set_steering_mode`).

   `extensions/tests/rpc-wrapper.test.ts` currently has no mailbox assertions.

   **Required plan correction:** Explicitly plan additions to `rpc-wrapper.test.ts` for:
   - `--mailbox-dir` parse coverage
   - `checkMailboxAndSteer` delivery on `message_end` path (steer injection + ack move)
   - silent no-op when mailbox is absent/unset
   - startup `set_steering_mode: "all"` when mailbox is enabled

3. **`send_agent_message` verification strategy is still unspecified.**

   The requirement says to test that supervisor tool writes to the correct inbox, but `doSendAgentMessage` is closure-scoped in `extension.ts`.

   **Required plan correction:** Add an explicit approach for behavioral testing, e.g.:
   - capture `send_agent_message` registration from extension bootstrap and invoke its `execute(...)`, or
   - extract/export a testable helper and validate produced mailbox file path/payload.

   The plan must state which method will be used.

4. **No planned tests for Step 5 cleanup behavior/regressions.**

   Mailbox cleanup behavior was added in `cleanup.ts` (post-integrate + stale sweep) and should be verified in Step 6.

   **Required plan correction:** Add checkboxes for:
   - `cleanupPostIntegrate` removes `.pi/mailbox/{batchId}` and reports `mailboxDirsDeleted`
   - `sweepStaleArtifacts` removes stale mailbox batch dirs and preserves fresh ones
   - callsite/root correctness regression (workspace/state root vs repo root) so cleanup targets actual mailbox location

---

### Non-blocking notes

- Use deterministic time control (`Date.now` stubs) for sort-order and staleness tests.
- Include at least one UTF-8 multibyte case for the 4KB byte-limit test.
- Run and record the exact full-suite command from the prompt in execution log.
