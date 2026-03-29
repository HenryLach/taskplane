# R001 — Plan Review (Step 1: Mailbox message format and write utilities)

## Verdict
**Changes requested** — the Step 1 plan is still too coarse to implement safely/deterministically.

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

## Blocking findings

### 1) Step 1 is not hydrated to implementation-level work items
`STATUS.md` still has broad bullets only (define types, implement utilities, enforce 4KB). That is not enough for a high-blast-radius cross-process contract.

You need explicit sub-steps for:
- schema/types contract,
- path contract,
- write semantics,
- read semantics,
- ack semantics,
- failure handling,
- test cases.

### 2) Message schema contract is underspecified
The plan does not define exact field semantics for `MailboxMessage`:
- required vs optional fields (`expectsReply`, `replyTo`),
- `to` allowed values (`sessionName` vs `_broadcast`),
- ID generation format (timestamp+nonce),
- timestamp source/type,
- whether `type` is union/const set (project style in `types.ts` favors string unions over TS `enum`).

Without this, Step 2/4 may diverge on parsing/validation.

### 3) `readInbox(mailboxDir)` validation contract is ambiguous
Step text says "validate batchId", but current planned signature only takes `mailboxDir`.

Plan must define where expected batch identity comes from:
- parsed from path,
- explicit function argument (`expectedBatchId`), or
- both.

Also define behavior on invalid files:
- skip and keep in inbox,
- skip and move to ack,
- or throw.

### 4) Atomic file operation details are missing
The plan says "temp file + rename" but omits critical behavior:
- temp file location must be same directory as final file (rename atomicity),
- temp naming collision strategy,
- cleanup behavior on write/rename failure,
- `ackMessage` idempotence policy (ENOENT race handling when multiple readers/processes).

Existing project precedent (`persistence.ts`, `supervisor.ts`) should be mirrored explicitly.

### 5) 4KB limit definition is incomplete
Need to specify **UTF-8 byte length** (`Buffer.byteLength(content, "utf8")`), not JS string length.

This matters for non-ASCII content and ensures deterministic cross-platform enforcement.

### 6) Deterministic ordering rules are not defined
`readInbox` must define exact sort behavior:
- primary: message timestamp,
- tie-breaker: filename lexical order.

Also specify filename pattern filtering (`*.msg.json`) and malformed JSON handling.

### 7) Module placement/export contract not planned
Prompt allows `supervisor.ts` or new `mailbox.ts`, but plan doesn’t choose.

Given `supervisor.ts` is already very large, Step 1 should explicitly choose a dedicated `extensions/taskplane/mailbox.ts` utility module and (if needed) export via `extensions/taskplane/index.ts` for reuse/testing.

## Required updates before implementation
1. Expand Step 1 in `STATUS.md` into concrete, file-level subtasks.
2. Define canonical mailbox type contract in `types.ts` (message type union + interface + optional parse/validation helpers).
3. Define mailbox path helpers now (root/batch/session directories) so Step 2/3/4/5 share one path contract.
4. Define exact signatures:
   - `writeMailboxMessage(...)`
   - `readInbox(...)`
   - `ackMessage(...)`
   including expected inputs/outputs and error behavior.
5. Define deterministic sorting, file filtering, malformed-file handling, and batch mismatch handling.
6. Define 4KB limit as UTF-8 bytes and include rejection behavior/message.
7. Add a Step 1 test checklist (to be implemented in Step 6) covering write/read/ack/size/invalid cases.

## Non-blocking note
Good callout in prompt to keep compatibility when mailbox is absent. Keep Step 1 utilities pure and reusable so Step 2 (`rpc-wrapper`) and Step 4 (`send_agent_message`) can use the same validation/path logic without duplication.
