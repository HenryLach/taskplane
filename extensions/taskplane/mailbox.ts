/**
 * Agent Mailbox — file-based cross-agent messaging utilities.
 *
 * Provides the core mailbox operations for the agent-mailbox-steering
 * protocol: write, read, and acknowledge messages in batch-scoped,
 * session-scoped inbox directories.
 *
 * Directory structure:
 * ```
 * .pi/mailbox/{batchId}/
 * ├── {sessionName}/
 * │   ├── inbox/          ← pending messages
 * │   └── ack/            ← processed messages (moved from inbox)
 * └── _broadcast/
 *     └── inbox/          ← messages to all agents
 * ```
 *
 * All file operations are synchronous (matching rpc-wrapper pattern).
 * Write operations are atomic (temp file + rename in same directory).
 * Read/ack operations are best-effort (log warnings, don't crash).
 *
 * @module orch/mailbox
 * @since TP-089
 */

import { join, dirname } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, unlinkSync, appendFileSync } from "fs";
import { randomBytes } from "crypto";
import type { MailboxMessage, MailboxMessageType, WriteMailboxMessageOpts } from "./types.ts";
import { MAILBOX_DIR_NAME, MAILBOX_MAX_CONTENT_BYTES, MAILBOX_MESSAGE_TYPES } from "./types.ts";

// ── Path Helpers ─────────────────────────────────────────────────────

/**
 * Root directory for all mailboxes in a batch.
 *
 * @param stateRoot - Root directory containing .pi/ (workspace root or repo root)
 * @param batchId - Batch ID for scoping
 * @returns Absolute path: `{stateRoot}/.pi/mailbox/{batchId}/`
 *
 * @since TP-089
 */
export function mailboxRoot(stateRoot: string, batchId: string): string {
	return join(stateRoot, ".pi", MAILBOX_DIR_NAME, batchId);
}

/**
 * Inbox directory for a specific agent session.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param batchId - Batch ID
 * @param sessionName - tmux session name (unique per batch)
 * @returns Absolute path: `{stateRoot}/.pi/mailbox/{batchId}/{sessionName}/inbox/`
 *
 * @since TP-089
 */
export function sessionInboxDir(stateRoot: string, batchId: string, sessionName: string): string {
	return join(stateRoot, ".pi", MAILBOX_DIR_NAME, batchId, sessionName, "inbox");
}

/**
 * Ack directory for a specific agent session.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param batchId - Batch ID
 * @param sessionName - tmux session name
 * @returns Absolute path: `{stateRoot}/.pi/mailbox/{batchId}/{sessionName}/ack/`
 *
 * @since TP-089
 */
export function sessionAckDir(stateRoot: string, batchId: string, sessionName: string): string {
	return join(stateRoot, ".pi", MAILBOX_DIR_NAME, batchId, sessionName, "ack");
}

/**
 * Broadcast inbox directory (messages to all agents).
 *
 * @param stateRoot - Root directory containing .pi/
 * @param batchId - Batch ID
 * @returns Absolute path: `{stateRoot}/.pi/mailbox/{batchId}/_broadcast/inbox/`
 *
 * @since TP-089
 */
export function broadcastInboxDir(stateRoot: string, batchId: string): string {
	return join(stateRoot, ".pi", MAILBOX_DIR_NAME, batchId, "_broadcast", "inbox");
}


// ── Write ────────────────────────────────────────────────────────────

/**
 * Write a message to a target agent's inbox.
 *
 * Generates a unique message ID and writes the message atomically
 * (temp file + rename in the same directory). The temp file uses a
 * `.msg.json.tmp` extension that is excluded by the inbox reader's
 * `*.msg.json` filter.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param batchId - Current batch ID
 * @param to - Target session name or `"_broadcast"`
 * @param opts - Message content and metadata from the caller
 * @returns The written MailboxMessage (including generated fields)
 * @throws If content exceeds 4KB UTF-8 bytes or file I/O fails
 *
 * @since TP-089
 */
export function writeMailboxMessage(
	stateRoot: string,
	batchId: string,
	to: string,
	opts: WriteMailboxMessageOpts,
): MailboxMessage {
	// Validate content size (UTF-8 bytes, not string length)
	const contentBytes = Buffer.byteLength(opts.content, "utf8");
	if (contentBytes > MAILBOX_MAX_CONTENT_BYTES) {
		throw new Error(
			`Mailbox message content exceeds ${MAILBOX_MAX_CONTENT_BYTES} byte limit ` +
			`(${contentBytes} bytes). Steering messages should be concise directives. ` +
			`Write larger context to a file and reference it by path.`,
		);
	}

	// Generate unique message ID
	const timestamp = Date.now();
	const nonce = randomBytes(3).toString("hex").slice(0, 5);
	const id = `${timestamp}-${nonce}`;

	// Build the full message
	const message: MailboxMessage = {
		id,
		batchId,
		from: opts.from,
		to,
		timestamp,
		type: opts.type,
		content: opts.content,
		expectsReply: opts.expectsReply ?? false,
		replyTo: opts.replyTo ?? null,
	};

	// Determine inbox directory
	const inboxDir = to === "_broadcast"
		? broadcastInboxDir(stateRoot, batchId)
		: sessionInboxDir(stateRoot, batchId, to);

	// Ensure inbox directory exists
	mkdirSync(inboxDir, { recursive: true });

	// Atomic write: temp file (.msg.json.tmp) then rename to final (.msg.json)
	const finalFilename = `${id}.msg.json`;
	const tempFilename = `${id}.msg.json.tmp`;
	const tempPath = join(inboxDir, tempFilename);
	const finalPath = join(inboxDir, finalFilename);

	try {
		writeFileSync(tempPath, JSON.stringify(message, null, 2) + "\n", "utf-8");
		renameSync(tempPath, finalPath);
	} catch (err) {
		// Attempt cleanup of temp file on failure
		try {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		} catch {
			// Best effort cleanup
		}
		throw new Error(
			`Failed to write mailbox message to ${finalPath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	return message;
}


// ── Read ─────────────────────────────────────────────────────────────

/**
 * Read pending messages from an inbox directory.
 *
 * Returns messages sorted by timestamp (ascending), with filename
 * lexical order as tie-breaker. Only reads files matching the
 * `*.msg.json` pattern (excludes `.msg.json.tmp` temp files).
 *
 * Messages with invalid shape or mismatched batchId are logged as
 * warnings and left in the inbox (no throw/crash).
 *
 * @param inboxDir - Absolute path to the inbox directory
 * @param expectedBatchId - Expected batch ID for validation
 * @returns Sorted array of `{ filename, message }` entries
 *
 * @since TP-089
 */
export function readInbox(
	inboxDir: string,
	expectedBatchId: string,
): Array<{ filename: string; message: MailboxMessage }> {
	// Return empty if directory doesn't exist
	if (!existsSync(inboxDir)) return [];

	let entries: string[];
	try {
		entries = readdirSync(inboxDir);
	} catch (err) {
		process.stderr.write(
			`[mailbox] WARNING: failed to read inbox ${inboxDir}: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return [];
	}

	// Filter: only *.msg.json files (excludes .msg.json.tmp, .tmp, etc.)
	const msgFiles = entries.filter(f => f.endsWith(".msg.json") && !f.endsWith(".msg.json.tmp"));

	const results: Array<{ filename: string; message: MailboxMessage }> = [];

	for (const filename of msgFiles) {
		const filePath = join(inboxDir, filename);
		let raw: string;
		try {
			raw = readFileSync(filePath, "utf-8");
		} catch (err) {
			process.stderr.write(
				`[mailbox] WARNING: failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			continue;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			process.stderr.write(
				`[mailbox] WARNING: malformed JSON in ${filename}, skipping\n`,
			);
			continue;
		}

		// Validate shape
		if (!isValidMailboxMessage(parsed)) {
			process.stderr.write(
				`[mailbox] WARNING: invalid message shape in ${filename}, skipping\n`,
			);
			continue;
		}

		const msg = parsed as MailboxMessage;

		// Validate batchId
		if (msg.batchId !== expectedBatchId) {
			process.stderr.write(
				`[mailbox] WARNING: batchId mismatch in ${filename} (expected ${expectedBatchId}, got ${msg.batchId}), skipping\n`,
			);
			continue;
		}

		results.push({ filename, message: msg });
	}

	// Sort: primary by timestamp (ascending), tie-break by filename lexical
	results.sort((a, b) => {
		const tsDiff = a.message.timestamp - b.message.timestamp;
		if (tsDiff !== 0) return tsDiff;
		return a.filename.localeCompare(b.filename);
	});

	return results;
}


// ── Acknowledge ──────────────────────────────────────────────────────

/**
 * Move a message from inbox to ack directory.
 *
 * Atomic rename. If the file is already gone (another process acked it),
 * returns false. The ack directory is derived structurally from the inbox
 * directory: `dirname(inboxDir)/ack/`.
 *
 * @param inboxDir - Absolute path to the inbox directory
 * @param filename - Message filename (e.g., `1774744971303-a7f2c.msg.json`)
 * @returns true if acked successfully, false if already acked (ENOENT race)
 *
 * @since TP-089
 */
export function ackMessage(inboxDir: string, filename: string): boolean {
	const ackDir = join(dirname(inboxDir), "ack");

	try {
		mkdirSync(ackDir, { recursive: true });
	} catch (err) {
		process.stderr.write(
			`[mailbox] WARNING: failed to create ack dir ${ackDir}: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return false;
	}

	const srcPath = join(inboxDir, filename);
	const dstPath = join(ackDir, filename);

	try {
		renameSync(srcPath, dstPath);
		return true;
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			// Another process already acked this message — race is harmless
			return false;
		}
		process.stderr.write(
			`[mailbox] WARNING: failed to ack ${filename}: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return false;
	}
}


// ── Validation ───────────────────────────────────────────────────────

/**
 * Runtime validation for mailbox message shape.
 *
 * Checks that all required fields are present and correctly typed.
 * Does not validate batchId match (caller's responsibility).
 *
 * @param obj - Parsed JSON value to validate
 * @returns true if obj is a valid MailboxMessage shape
 *
 * @since TP-089
 */
export function isValidMailboxMessage(obj: unknown): obj is MailboxMessage {
	if (!obj || typeof obj !== "object") return false;
	const m = obj as Record<string, unknown>;
	return (
		typeof m.id === "string" &&
		typeof m.batchId === "string" &&
		typeof m.from === "string" &&
		typeof m.to === "string" &&
		typeof m.timestamp === "number" && Number.isFinite(m.timestamp) &&
		typeof m.type === "string" && MAILBOX_MESSAGE_TYPES.has(m.type) &&
		typeof m.content === "string"
	);
}


// ── Outbox (Agent → Supervisor, TP-106) ─────────────────────────

/**
 * Outbox directory for a specific agent session.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param batchId - Batch ID
 * @param sessionName - Agent ID / session name
 * @returns Absolute path: `{stateRoot}/.pi/mailbox/{batchId}/{sessionName}/outbox/`
 *
 * @since TP-106
 */
export function sessionOutboxDir(stateRoot: string, batchId: string, sessionName: string): string {
	return join(stateRoot, ".pi", MAILBOX_DIR_NAME, batchId, sessionName, "outbox");
}

/**
 * Write a reply or escalation message to an agent's outbox.
 *
 * Used by agents (via bridge tools or direct write) to communicate
 * back to the supervisor. The engine or lane-runner polls outbox
 * directories and surfaces messages as supervisor alerts.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param batchId - Current batch ID
 * @param from - Agent ID writing the message
 * @param opts - Message content and metadata
 * @returns The written MailboxMessage
 *
 * @since TP-106
 */
export function writeOutboxMessage(
	stateRoot: string,
	batchId: string,
	from: string,
	opts: WriteMailboxMessageOpts,
): MailboxMessage {
	const outboxDir = sessionOutboxDir(stateRoot, batchId, from);
	mkdirSync(outboxDir, { recursive: true });

	const contentBytes = Buffer.byteLength(opts.content, "utf8");
	if (contentBytes > MAILBOX_MAX_CONTENT_BYTES) {
		throw new Error(
			`Outbox message content exceeds ${MAILBOX_MAX_CONTENT_BYTES} byte limit (${contentBytes} bytes).`,
		);
	}

	const timestamp = Date.now();
	const nonce = randomBytes(3).toString("hex").slice(0, 5);
	const id = `${timestamp}-${nonce}`;

	const message: MailboxMessage = {
		id,
		batchId,
		from,
		to: "supervisor",
		timestamp,
		type: opts.type,
		content: opts.content,
		expectsReply: opts.expectsReply ?? false,
		replyTo: opts.replyTo ?? null,
	};

	const finalFilename = `${id}.msg.json`;
	const tempFilename = `${id}.msg.json.tmp`;
	const tempPath = join(outboxDir, tempFilename);
	const finalPath = join(outboxDir, finalFilename);

	try {
		writeFileSync(tempPath, JSON.stringify(message, null, 2) + "\n", "utf-8");
		renameSync(tempPath, finalPath);
	} catch (err) {
		try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch { /* cleanup */ }
		throw new Error(`Failed to write outbox message: ${err instanceof Error ? err.message : String(err)}`);
	}

	return message;
}

/**
 * Read pending outbox messages from an agent's outbox directory.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param batchId - Batch ID
 * @param agentId - Agent ID whose outbox to read
 * @returns Array of outbox messages sorted by timestamp
 *
 * @since TP-106
 */
export function readOutbox(
	stateRoot: string,
	batchId: string,
	agentId: string,
): MailboxMessage[] {
	const outboxDir = sessionOutboxDir(stateRoot, batchId, agentId);
	if (!existsSync(outboxDir)) return [];

	let entries: string[];
	try {
		entries = readdirSync(outboxDir);
	} catch {
		return [];
	}

	const msgFiles = entries.filter(f => f.endsWith(".msg.json") && !f.endsWith(".msg.json.tmp"));
	const messages: MailboxMessage[] = [];

	for (const filename of msgFiles) {
		try {
			const raw = readFileSync(join(outboxDir, filename), "utf-8");
			const parsed = JSON.parse(raw);
			if (isValidMailboxMessage(parsed)) {
				messages.push(parsed);
			}
		} catch { /* skip malformed */ }
	}

	messages.sort((a, b) => a.timestamp - b.timestamp);
	return messages;
}

/**
 * Ack (consume) a specific outbox message by moving it to processed/.
 *
 * Returns false if the message is already gone (race-safe/idempotent).
 *
 * @since TP-106
 */
export function ackOutboxMessage(
	stateRoot: string,
	batchId: string,
	agentId: string,
	messageId: string,
): boolean {
	const outboxDir = sessionOutboxDir(stateRoot, batchId, agentId);
	const processedDir = join(outboxDir, "processed");
	const file = `${messageId}.msg.json`;
	const srcPath = join(outboxDir, file);
	const dstPath = join(processedDir, file);

	try {
		mkdirSync(processedDir, { recursive: true });
		renameSync(srcPath, dstPath);
		return true;
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return false;
		process.stderr.write(
			`[mailbox] WARNING: failed to ack outbox ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return false;
	}
}

export type MailboxAuditEventType =
	| "message_sent"
	| "message_delivered"
	| "message_replied"
	| "message_escalated"
	| "message_rate_limited";

/**
 * Append a mailbox audit event to .pi/mailbox/{batchId}/events.jsonl.
 *
 * Best-effort: logs warning but never throws.
 *
 * @since TP-106
 */
export function appendMailboxAuditEvent(
	stateRoot: string,
	batchId: string,
	event: {
		type: MailboxAuditEventType;
		ts?: number;
		from?: string;
		to?: string;
		messageId?: string;
		messageType?: string;
		contentPreview?: string;
		broadcast?: boolean;
		reason?: string;
		retryAfterMs?: number;
	},
): void {
	const eventsPath = join(mailboxRoot(stateRoot, batchId), "events.jsonl");
	try {
		mkdirSync(dirname(eventsPath), { recursive: true });
		appendFileSync(
			eventsPath,
			JSON.stringify({ batchId, ts: event.ts ?? Date.now(), ...event }) + "\n",
			"utf-8",
		);
	} catch (err) {
		process.stderr.write(
			`[mailbox] WARNING: failed to append mailbox event: ${err instanceof Error ? err.message : String(err)}\n`,
		);
	}
}


// ── Broadcast (TP-106) ────────────────────────────────────────

/**
 * Write a broadcast message to all agents.
 *
 * The message is written to `_broadcast/inbox/`. Agent hosts check
 * this directory alongside their own inbox on each `message_end`.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param batchId - Current batch ID
 * @param opts - Message content and metadata
 * @returns The written MailboxMessage
 *
 * @since TP-106
 */
export function writeBroadcastMessage(
	stateRoot: string,
	batchId: string,
	opts: WriteMailboxMessageOpts,
): MailboxMessage {
	return writeMailboxMessage(stateRoot, batchId, "_broadcast", {
		...opts,
		from: opts.from || "supervisor",
	});
}


// ── Rate Limiting (TP-106) ─────────────────────────────────────

/** Default rate limit: max 1 message per agent per 30 seconds. */
export const RATE_LIMIT_WINDOW_MS = 30_000;

/** In-memory rate limit tracker. Keyed by target agent ID. */
const rateLimitTracker = new Map<string, number>();

/**
 * Check whether sending a message to a target is rate-limited.
 *
 * @param targetAgentId - Agent ID being sent to
 * @param windowMs - Rate limit window in ms (default: 30_000)
 * @returns Object with `allowed` and optional `retryAfterMs`
 *
 * @since TP-106
 */
export function checkRateLimit(
	targetAgentId: string,
	windowMs: number = RATE_LIMIT_WINDOW_MS,
): { allowed: boolean; retryAfterMs?: number } {
	const lastSent = rateLimitTracker.get(targetAgentId);
	if (!lastSent) return { allowed: true };

	const elapsed = Date.now() - lastSent;
	if (elapsed >= windowMs) return { allowed: true };

	return { allowed: false, retryAfterMs: windowMs - elapsed };
}

/**
 * Record a send timestamp for rate limiting.
 *
 * @param targetAgentId - Agent ID that was sent to
 *
 * @since TP-106
 */
export function recordSend(targetAgentId: string): void {
	rateLimitTracker.set(targetAgentId, Date.now());
}

/**
 * Reset rate limit state (for testing).
 * @since TP-106
 */
export function _resetRateLimits(): void {
	rateLimitTracker.clear();
}
