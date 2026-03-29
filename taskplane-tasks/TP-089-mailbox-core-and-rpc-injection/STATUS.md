# TP-089: Agent Mailbox Core and RPC Steering Injection — Status

**Current Step:** Step 2: rpc-wrapper mailbox check and steer injection
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-29
**Review Level:** 2
**Review Counter:** 8
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
**Status:** ✅ Complete

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
**Status:** 🟨 In Progress

#### 2a. CLI argument parsing
- [x] Add `--mailbox-dir <path>` to `parseArgs()` in rpc-wrapper.mjs
- [x] Store as `args.mailboxDir` (null when not provided)
- [x] Update printUsage() help text

#### 2b. Steering mode at session startup
- [x] After sending prompt command, if mailboxDir is set, send `{"type": "set_steering_mode", "mode": "all"}` to pi via proc.stdin
- [x] Only when mailboxDir is provided (backward compatible)

#### 2c. Inbox check on message_end
- [x] In handleEvent `message_end` case, after displayProgress and querySessionStats, call `checkMailboxAndSteer()`
- [x] `checkMailboxAndSteer()`: readdirSync on `{mailboxDir}/inbox/` for `*.msg.json` files
- [x] **Broadcast is deferred to TP-092 (Phase 4)** — do NOT consume `_broadcast/inbox` in this task
- [x] Derive paths: `inboxDir = join(mailboxDir, 'inbox')`, `expectedSessionName = basename(mailboxDir)`, `expectedBatchId = basename(dirname(mailboxDir))`
- [x] ENOENT on inbox readdirSync is quiet no-op (inbox dir may not exist yet)
- [x] Read each `*.msg.json` file, parse JSON, validate:
  - `batchId` matches `expectedBatchId` (derived from path, not message content)
  - `to` matches `expectedSessionName` (no misdelivery)
  - `id` (string), `content` (string), `type` (string in MAILBOX_MESSAGE_TYPES set)
  - `timestamp` is finite number (required for deterministic sort)
  - Invalid messages: log warning, skip, leave in inbox
- [x] **Sort messages by timestamp ascending, filename lexical as tie-break** before injection
- [x] For each valid message: `proc.stdin.write(JSON.stringify({ type: 'steer', message: content }) + '\n')`
- [x] Move delivered messages from inbox/ to ack/ via rename (create ack/ dir if needed, ENOENT non-fatal)
- [x] Log to stderr: `[STEERING] Delivered message {id}`
- [x] Skip silently when mailboxDir is null (backward compatible)
- [x] Wrap in try/catch — never crash on mailbox I/O errors

#### 2d. Export for testing
- [x] Export checkMailboxAndSteer and isValidMailboxMessageShape for unit testing

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
| R005 | code | Step 1 | APPROVE | .reviews/R005-code-step1.md |
| R006 | plan | Step 2 | REVISE | .reviews/R006-plan-step2.md |
| R007 | plan | Step 2 | REVISE | .reviews/R007-plan-step2.md |
| R008 | plan | Step 2 | APPROVE | .reviews/R008-plan-step2.md |

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
| 2026-03-29 03:27 | Reviewer R005 | persistent reviewer dead — respawning for code review (1/3) |
| 2026-03-29 03:27 | Reviewer R005 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 03:32 | Review R005 | code Step 1: APPROVE (fallback) |
| 2026-03-29 03:33 | Reviewer R006 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 03:35 | Review R006 | plan Step 2: REVISE (fallback) |
| 2026-03-29 03:36 | Reviewer R007 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-29 03:38 | Review R007 | plan Step 2: REVISE (fallback) |
| 2026-03-29 03:39 | Reviewer R008 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer session died while waiting for verdict |
| 2026-03-29 03:40 | Review R008 | plan Step 2: APPROVE (fallback) |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
