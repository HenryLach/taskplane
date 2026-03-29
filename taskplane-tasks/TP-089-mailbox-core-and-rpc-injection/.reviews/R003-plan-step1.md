# R003 — Plan Review (Step 1: Mailbox message format and write utilities)

## Verdict
**Changes requested (small but blocking):** this plan is now very strong and nearly implementation-ready, but one atomicity/race detail still needs correction before coding.

## Reviewed artifacts
- `taskplane-tasks/TP-089-mailbox-core-and-rpc-injection/PROMPT.md`
- `taskplane-tasks/TP-089-mailbox-core-and-rpc-injection/STATUS.md`
- `docs/specifications/taskplane/agent-mailbox-steering.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/persistence.ts`
- `bin/rpc-wrapper.mjs`
- `extensions/tests/rpc-wrapper.test.ts`

## What improved since R002
- Step 1 is clearly hydrated and implementation-scoped.
- `writeMailboxMessage` input contract is now explicit (caller-supplied vs generated fields).
- `ackMessage` path derivation is now structural/cross-platform safe.
- `readInbox` runtime validation now includes `timestamp`, `type`, and `from` (good for deterministic sorting/safety).

## Remaining blocking finding

### 1) Temp filename pattern can race with readers (`*.msg.json` collision)
Current Step 1c plans temp writes as:
- temp: `.tmp-{nonce}.msg.json`
- final: `{timestamp}-{nonce}.msg.json`

Step 1d plans readers to include all `*.msg.json` files.
That means readers can pick up temp files before rename, causing racey behavior (premature delivery/ack, malformed-read warnings, or writer rename failures).

**Required change:**
- Use a temp filename that does **not** match the inbox read filter (e.g. `.tmp-{nonce}.json` or `{id}.msg.json.tmp`).
- Keep final deliverable filenames as the only `*.msg.json` entries.
- (Recommended) make `readInbox` filter stricter than extension match, e.g. final pattern only, to future-proof against hidden/aux files.

## Non-blocking suggestion
- Clarify naming in the plan that `readInbox(mailboxDir, ...)`/`ackMessage(mailboxDir, ...)` receive an **inbox directory** path specifically (parameter name `inboxDir`), to avoid Step 2 call-site confusion with session root vs inbox root.

---

Once the temp-file/read-filter race is fixed in `STATUS.md`, this Step 1 plan is implementation-ready.