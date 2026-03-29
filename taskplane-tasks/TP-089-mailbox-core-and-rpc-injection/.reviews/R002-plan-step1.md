# R002 — Plan Review (Step 1: Mailbox message format and write utilities)

## Verdict
**Changes requested (targeted):** the Step 1 plan is much better and close to implementation-ready, but a few cross-platform and contract details are still underspecified.

## Reviewed artifacts
- `taskplane-tasks/TP-089-mailbox-core-and-rpc-injection/PROMPT.md`
- `taskplane-tasks/TP-089-mailbox-core-and-rpc-injection/STATUS.md`
- `docs/specifications/taskplane/agent-mailbox-steering.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/index.ts`
- `bin/rpc-wrapper.mjs`
- `extensions/tests/rpc-wrapper.test.ts`

## What improved since R001
- Step 1 is now properly hydrated into concrete sub-steps (schema, paths, write/read/ack, errors).
- Type contract is much clearer (message union + interface + constants).
- Atomic write and ENOENT race behavior are explicitly planned.
- UTF-8 byte-limit enforcement is now explicit.

## Remaining blocking findings

### 1) `ackMessage` path derivation is not cross-platform-safe
Current plan says: derive ack dir by replacing `/inbox/` with `/ack/`.

That will break on Windows path separators (`\`) and on inbox paths without trailing slash normalization.

**Required change:** define ack path structurally (e.g., via `dirname(mailboxDir)` + `join(..., "ack")`, or shared path helper), not via string replacement.

---

### 2) `writeMailboxMessage(...)` input contract is still ambiguous
The plan defines output shape well, but does not pin down what `message` input must contain vs what is generated.

Without this, Step 4 may drift (e.g., caller forgets `from`, or `replyTo` conventions diverge).

**Required change:** add an explicit input type/signature contract, e.g.:
- required from caller: `from`, `type`, `content`, optional `expectsReply`, `replyTo`
- generated inside utility: `id`, `batchId`, `to`, `timestamp`

Also specify defaulting (`expectsReply=false`, `replyTo=null`).

---

### 3) `readInbox` validation is still too loose for deterministic ordering/safety
Current plan only requires `id`, `batchId`, `to`, `type`, `content`.

But Step 1 also requires sorting by timestamp; if `timestamp` is missing/non-numeric, ordering becomes ambiguous.

**Required change:** validation contract should explicitly require and type-check at runtime:
- `timestamp` as finite number
- `type` in allowed `MailboxMessageType` set
- `content` string
- (preferably) `from` string

And define behavior for invalid-shape files: warn + skip + leave in inbox (do not throw/crash).

## Non-blocking suggestion
- Decide and document module export stance now (`index.ts` re-export vs direct import from `mailbox.ts`) so Step 2/4 and tests use a single import pattern.

---

Once those three items are clarified in `STATUS.md`, this plan is implementation-ready for Step 1.