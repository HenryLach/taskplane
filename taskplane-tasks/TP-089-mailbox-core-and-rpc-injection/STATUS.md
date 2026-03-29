# TP-089: Agent Mailbox Core and RPC Steering Injection — Status

**Current Step:** Step 1: Mailbox message format and write utilities
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-29
**Review Level:** 2
**Review Counter:** 4
**Iteration:** 4
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read the agent-mailbox-steering spec (Architecture + Delivery sections)
- [x] Read current rpc-wrapper handleEvent/message_end flow
- [x] Read spawnAgentTmux() in task-runner.ts and spawnMergeAgent() in merge.ts
- [x] Read existing supervisor tool registration pattern (orch_retry_task)

---

### Step 1: Mailbox message format and write utilities
**Status:** 🟨 In Progress

#### 1a. Message schema in `extensions/taskplane/types.ts`
- [x] Define `MailboxMessageType` as string union: `"steer" | "query" | "abort" | "info" | "reply" | "escalate"`
- [x] Define `MailboxMessage` interface with fields:
  - `id: string` — format: `{timestamp}-{5char-hex-nonce}` (e.g., `"1774744971303-a7f2c"`)
  - `batchId: string` — must match current batch ID
  - `from: string` — sender identifier (`"supervisor"` or session name)
  - `to: string` — target session name or `"_broadcast"`
  - `timestamp: number` — epoch ms from Date.now()
  - `type: MailboxMessageType`
  - `content: string` — the message body (max 4KB UTF-8 bytes)
  - `expectsReply?: boolean` — optional, default false
  - `replyTo?: string | null` — optional, reference to a previous message ID
- [x] Define `MAILBOX_MAX_CONTENT_BYTES = 4096` constant
- [x] Define `MAILBOX_DIR_NAME = "mailbox"` constant

#### 1b. Path helpers in new `extensions/taskplane/mailbox.ts`
- [x] Create `extensions/taskplane/mailbox.ts` module
- [x] `mailboxRoot(stateRoot: string, batchId: string): string` → `.pi/mailbox/{batchId}/`
- [x] `sessionInboxDir(stateRoot: string, batchId: string, sessionName: string): string` → `.../{sessionName}/inbox/`
- [x] `sessionAckDir(stateRoot: string, batchId: string, sessionName: string): string` → `.../{sessionName}/ack/`
- [x] `broadcastInboxDir(stateRoot: string, batchId: string): string` → `.../_broadcast/inbox/`

#### 1c. `writeMailboxMessage(stateRoot, batchId, to, opts)` utility
- [x] Input type `WriteMailboxMessageOpts`: `{ from: string; type: MailboxMessageType; content: string; expectsReply?: boolean; replyTo?: string | null }`
- [x] Generated inside utility: `id` (timestamp+nonce), `batchId` (from arg), `to` (from arg), `timestamp` (Date.now())
- [x] Defaults: `expectsReply` → `false`, `replyTo` → `null`
- [x] Generate message ID: `{Date.now()}-{crypto.randomBytes(3).toString('hex').slice(0,5)}`
- [x] Build full `MailboxMessage` object with all fields
- [x] Validate content size: `Buffer.byteLength(content, 'utf8') <= MAILBOX_MAX_CONTENT_BYTES`, throw descriptive error if exceeded
- [x] Ensure inbox directory exists: `mkdirSync({sessionInboxDir}, { recursive: true })`
- [x] Atomic write: write to temp file `{id}.msg.json.tmp` (does NOT match `*.msg.json` glob) in **same directory** as inbox, then `renameSync()` to final `{id}.msg.json`
- [x] On write/rename failure: attempt cleanup of temp file, then re-throw
- [x] Return the written `MailboxMessage` object (including generated ID)

#### 1d. `readInbox(inboxDir, expectedBatchId)` utility
- [x] `readdirSync(inboxDir)` — return empty array if dir doesn't exist (ENOENT)
- [x] Filter: only files ending with `.msg.json` (excludes `.msg.json.tmp` temp files)
- [x] Read each file, parse JSON, validate shape:
  - Required: `id` (string), `batchId` (string), `to` (string), `type` (string in MailboxMessageType set), `content` (string), `timestamp` (finite number), `from` (string)
  - Invalid shape → warn to stderr, skip, leave in inbox (no throw/crash)
- [x] Reject messages where `batchId !== expectedBatchId` — log warning to stderr, skip (leave in inbox)
- [x] Skip files with malformed JSON — log warning, skip (leave in inbox)
- [x] Sort: primary by `timestamp` (numeric ascending), tie-break by filename lexical order
- [x] Return `Array<{ filename: string; message: MailboxMessage }>`

#### 1e. `ackMessage(inboxDir, filename)` utility
- [x] Derive ack directory structurally: `join(dirname(inboxDir), 'ack')` — NOT string replacement (cross-platform safe)
- [x] Ensure ack directory exists: `mkdirSync(ackDir, { recursive: true })`
- [x] Atomic move: `renameSync(join(inboxDir, filename), join(ackDir, filename))`
- [x] Handle ENOENT race gracefully (another process already acked) — return false
- [x] Return true on success

#### 1f. Error handling and module export
- [x] Write failures throw with descriptive messages
- [x] Read/ack failures are best-effort (log, don't crash)
- [x] All file ops use sync variants (matching rpc-wrapper pattern)
- [x] Module: `extensions/taskplane/mailbox.ts` — direct imports by consumers (Step 2/4), NOT re-exported via index.ts (keeps surface minimal)

---

### Step 2: rpc-wrapper mailbox check and steer injection
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on rpc-wrapper handleEvent structure

- [ ] Add --mailbox-dir arg and inbox check on message_end
- [ ] Inject via steer RPC command
- [ ] Move delivered messages to ack/

---

### Step 3: Thread mailbox-dir through spawn paths
**Status:** ⬜ Not Started

- [ ] spawnAgentTmux() passes --mailbox-dir for worker + reviewer
- [ ] spawnMergeAgent() passes --mailbox-dir for merger
- [ ] Fix ORCH_BATCH_ID env var gap

---

### Step 4: Supervisor send_agent_message tool
**Status:** ⬜ Not Started

- [ ] Register tool with session name resolution from batch state
- [ ] Write message to target inbox

---

### Step 5: Batch cleanup for mailbox directory
**Status:** ⬜ Not Started

- [ ] Add mailbox/ to post-batch and age-based cleanup

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Create mailbox.test.ts with behavioral tests
- [ ] Full test suite passing
- [ ] All failures fixed

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec status
- [ ] Log discoveries

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | plan | Step 1 | REVISE | .reviews/R002-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | plan | Step 1 | APPROVE | .reviews/R004-plan-step1.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-28 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-29 03:13 | Task started | Extension-driven execution |
| 2026-03-29 03:13 | Step 0 started | Preflight |
| 2026-03-29 03:13 | Task started | Extension-driven execution |
| 2026-03-29 03:13 | Step 0 started | Preflight |
| 2026-03-29 03:13 | Worker iter 1 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-29 03:13 | No progress | Iteration 1: 0 new checkboxes (1/3 stall limit) |
| 2026-03-29 03:13 | Worker iter 2 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-29 03:13 | No progress | Iteration 2: 0 new checkboxes (2/3 stall limit) |
| 2026-03-29 03:13 | Worker iter 2 | done in 6s, ctx: 0%, tools: 0 |
| 2026-03-29 03:13 | No progress | Iteration 1: 0 new checkboxes (1/3 stall limit) |
| 2026-03-29 03:13 | Worker iter 3 | done in 2s, ctx: 0%, tools: 0 |
| 2026-03-29 03:13 | No progress | Iteration 3: 0 new checkboxes (3/3 stall limit) |
| 2026-03-29 03:13 | Task blocked | No progress after 3 iterations |
| 2026-03-29 03:13 | Worker iter 3 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-29 03:13 | No progress | Iteration 2: 0 new checkboxes (2/3 stall limit) |
| 2026-03-29 03:13 | Worker iter 4 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-29 03:13 | No progress | Iteration 3: 0 new checkboxes (3/3 stall limit) |
| 2026-03-29 03:13 | Task blocked | No progress after 3 iterations |
| 2026-03-29 03:16 | Reviewer R001 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 03:19 | Review R001 | plan Step 1: REVISE (fallback) |
| 2026-03-29 03:20 | Reviewer R002 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 03:21 | Review R002 | plan Step 1: REVISE (fallback) |
| 2026-03-29 03:22 | Reviewer R003 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 03:23 | Review R003 | plan Step 1: REVISE (fallback) |
| 2026-03-29 03:25 | Review R004 | plan Step 1: APPROVE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
