## Plan Review: Step 6 — Testing & Verification

### Verdict: REVISE

### Summary
Step 6 planning in `STATUS.md` is currently too thin to be execution-safe. The prompt requires a concrete test matrix (mailbox utils, rpc-wrapper steering behavior, and supervisor tool delivery), but the current plan only lists three generic bullets.

---

### Blocking findings

1. **Step 6 plan does not preserve the required test checklist from `PROMPT.md`.**

   `PROMPT.md` Step 6 explicitly requires multiple named behaviors (write/read/ack/size-limit/batchId validation, rpc-wrapper steering checks, startup steering mode, supervisor tool write path, full-suite run).  
   `STATUS.md` currently has only:
   - create `mailbox.test.ts`
   - full suite passing
   - fix failures

   That is not specific enough for deterministic execution/review.

   **Required plan correction:** expand Step 6 checkboxes in `STATUS.md` to explicitly mirror the prompt’s required cases (at least one checkbox per required behavior).

2. **RPC-wrapper verification is not mapped to the existing test surface.**

   The mailbox steering logic lives in `bin/rpc-wrapper.mjs` (`checkMailboxAndSteer`, `set_steering_mode`, `--mailbox-dir` parsing). Existing test patterns already live in `extensions/tests/rpc-wrapper.test.ts`, but Step 6 plan doesn’t state where these assertions will be added.

   **Required plan correction:** explicitly add Step 6 items to extend `extensions/tests/rpc-wrapper.test.ts` for:
   - `--mailbox-dir` parse/arg coverage
   - mailbox delivery on `message_end` (steer injection + ack move)
   - silent no-op when mailbox is absent
   - startup `set_steering_mode: "all"` when mailbox is enabled

3. **`send_agent_message` behavioral verification is underspecified.**

   Requirement says: tool writes to correct inbox. But the plan does not define how this will be tested (tool-level execution vs source-text assertions). Since `doSendAgentMessage` is closure-scoped in `extension.ts`, this needs an explicit test strategy.

   **Required plan correction:** add an explicit tool-behavior test plan (mock `ExtensionAPI`, capture `send_agent_message` registration, invoke `execute(...)`, assert file created under `.pi/mailbox/{batchId}/{session}/inbox/*.msg.json` with expected payload).

4. **No planned verification for Step 5 cleanup behavior despite code changes already landed.**

   `cleanup.ts` and `/orch-integrate` cleanup summary math were changed for mailbox artifacts. Step 6 currently has no checkbox to validate mailbox cleanup counters/deletion behavior.

   **Required plan correction:** add targeted tests for:
   - post-integrate deletion of `.pi/mailbox/{batchId}` and counter reporting
   - stale sweep deleting old mailbox batch dirs while preserving fresh ones

---

### Non-blocking notes

- Prefer deterministic timestamp control (`Date.now` stubbing) when testing inbox sort order.
- Include at least one UTF-8 multibyte content case for the 4KB byte-limit check (not just ASCII length).
- Run the exact full-suite command from the prompt (or `npm run test:fast` equivalent) and record the command in execution log.