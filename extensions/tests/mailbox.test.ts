/**
 * Mailbox Tests — TP-089 Step 6
 *
 * Tests for mailbox utilities (write/read/ack), cleanup integration,
 * and path helpers.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/mailbox.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { join, dirname } from "path";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
	writeMailboxMessage,
	readInbox,
	ackMessage,
	mailboxRoot,
	sessionInboxDir,
	sessionAckDir,
	broadcastInboxDir,
	isValidMailboxMessage,
} from "../taskplane/mailbox.ts";

import {
	MAILBOX_DIR_NAME,
	MAILBOX_MAX_CONTENT_BYTES,
	MAILBOX_MESSAGE_TYPES,
} from "../taskplane/types.ts";

import {
	cleanupPostIntegrate,
	sweepStaleArtifacts,
	STALE_ARTIFACT_MAX_AGE_MS,
} from "../taskplane/cleanup.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir(prefix: string): string {
	const dir = join(tmpdir(), `mailbox-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function cleanupDir(dir: string): void {
	try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── 1. Path Helpers ──────────────────────────────────────────────────

describe("Mailbox path helpers", () => {
	it("mailboxRoot returns correct path", () => {
		const result = mailboxRoot("/workspace", "20260329T120000");
		expect(result).toBe(join("/workspace", ".pi", MAILBOX_DIR_NAME, "20260329T120000"));
	});

	it("sessionInboxDir returns correct path", () => {
		const result = sessionInboxDir("/workspace", "20260329T120000", "orch-lane-1-worker");
		expect(result).toBe(join("/workspace", ".pi", MAILBOX_DIR_NAME, "20260329T120000", "orch-lane-1-worker", "inbox"));
	});

	it("sessionAckDir returns correct path", () => {
		const result = sessionAckDir("/workspace", "20260329T120000", "orch-lane-1-worker");
		expect(result).toBe(join("/workspace", ".pi", MAILBOX_DIR_NAME, "20260329T120000", "orch-lane-1-worker", "ack"));
	});

	it("broadcastInboxDir returns correct path", () => {
		const result = broadcastInboxDir("/workspace", "20260329T120000");
		expect(result).toBe(join("/workspace", ".pi", MAILBOX_DIR_NAME, "20260329T120000", "_broadcast", "inbox"));
	});
});

// ── 2. writeMailboxMessage ───────────────────────────────────────────

describe("writeMailboxMessage", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir("write");
	});

	afterEach(() => {
		cleanupDir(tmpDir);
	});

	it("creates correct file structure (inbox dir + .msg.json file)", () => {
		const msg = writeMailboxMessage(tmpDir, "batch-1", "orch-lane-1-worker", {
			from: "supervisor",
			type: "steer",
			content: "Focus on the API endpoint.",
		});

		const inboxDir = sessionInboxDir(tmpDir, "batch-1", "orch-lane-1-worker");
		expect(existsSync(inboxDir)).toBe(true);

		const files = readdirSync(inboxDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/\.msg\.json$/);
	});

	it("message file contains all required fields", () => {
		const msg = writeMailboxMessage(tmpDir, "batch-1", "orch-lane-1-worker", {
			from: "supervisor",
			type: "steer",
			content: "Fix the bug.",
			expectsReply: true,
			replyTo: "prev-msg-id",
		});

		expect(typeof msg.id).toBe("string");
		expect(msg.batchId).toBe("batch-1");
		expect(msg.from).toBe("supervisor");
		expect(msg.to).toBe("orch-lane-1-worker");
		expect(typeof msg.timestamp).toBe("number");
		expect(msg.type).toBe("steer");
		expect(msg.content).toBe("Fix the bug.");
		expect(msg.expectsReply).toBe(true);
		expect(msg.replyTo).toBe("prev-msg-id");

		// Read back from disk and verify
		const inboxDir = sessionInboxDir(tmpDir, "batch-1", "orch-lane-1-worker");
		const files = readdirSync(inboxDir);
		const diskMsg = JSON.parse(readFileSync(join(inboxDir, files[0]), "utf-8"));
		expect(diskMsg.id).toBe(msg.id);
		expect(diskMsg.batchId).toBe("batch-1");
		expect(diskMsg.content).toBe("Fix the bug.");
	});

	it("generated id has format {timestamp}-{5char-hex}", () => {
		const msg = writeMailboxMessage(tmpDir, "batch-1", "session-1", {
			from: "supervisor",
			type: "steer",
			content: "test",
		});

		const parts = msg.id.split("-");
		expect(parts.length).toBeGreaterThanOrEqual(2);
		// First part should be a timestamp number
		expect(Number.isFinite(Number(parts[0]))).toBe(true);
		// Last part should be hex, 5 chars
		const nonce = parts.slice(1).join("-"); // rejoin in case timestamp had no dash
		expect(nonce.length).toBe(5);
		expect(/^[0-9a-f]{5}$/.test(nonce)).toBe(true);
	});

	it("defaults: expectsReply=false, replyTo=null", () => {
		const msg = writeMailboxMessage(tmpDir, "batch-1", "session-1", {
			from: "supervisor",
			type: "steer",
			content: "test",
		});

		expect(msg.expectsReply).toBe(false);
		expect(msg.replyTo).toBe(null);
	});

	it("rejects content exceeding 4KB byte limit (ASCII)", () => {
		const bigContent = "x".repeat(MAILBOX_MAX_CONTENT_BYTES + 1);
		let threw = false;
		try {
			writeMailboxMessage(tmpDir, "batch-1", "session-1", {
				from: "supervisor",
				type: "steer",
				content: bigContent,
			});
		} catch (err: any) {
			threw = true;
			expect(err.message).toContain("byte limit");
		}
		expect(threw).toBe(true);
	});

	it("rejects content exceeding 4KB byte limit (UTF-8 multibyte)", () => {
		// Each emoji is 4 bytes in UTF-8. 1025 emojis = 4100 bytes > 4096
		const emojiContent = "🎯".repeat(1025);
		expect(Buffer.byteLength(emojiContent, "utf8")).toBeGreaterThan(MAILBOX_MAX_CONTENT_BYTES);

		let threw = false;
		try {
			writeMailboxMessage(tmpDir, "batch-1", "session-1", {
				from: "supervisor",
				type: "steer",
				content: emojiContent,
			});
		} catch (err: any) {
			threw = true;
			expect(err.message).toContain("byte limit");
		}
		expect(threw).toBe(true);
	});

	it("accepts content at exactly 4KB limit", () => {
		const exactContent = "x".repeat(MAILBOX_MAX_CONTENT_BYTES);
		expect(Buffer.byteLength(exactContent, "utf8")).toBe(MAILBOX_MAX_CONTENT_BYTES);

		const msg = writeMailboxMessage(tmpDir, "batch-1", "session-1", {
			from: "supervisor",
			type: "steer",
			content: exactContent,
		});
		expect(msg.content.length).toBe(MAILBOX_MAX_CONTENT_BYTES);
	});

	it("writes to _broadcast inbox when to='_broadcast'", () => {
		const msg = writeMailboxMessage(tmpDir, "batch-1", "_broadcast", {
			from: "supervisor",
			type: "info",
			content: "Attention all agents.",
		});

		const broadcastDir = broadcastInboxDir(tmpDir, "batch-1");
		expect(existsSync(broadcastDir)).toBe(true);
		const files = readdirSync(broadcastDir);
		expect(files).toHaveLength(1);
	});
});

// ── 3. readInbox ─────────────────────────────────────────────────────

describe("readInbox", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir("read");
	});

	afterEach(() => {
		cleanupDir(tmpDir);
	});

	it("returns sorted messages (timestamp ascending, filename tie-break)", () => {
		const inboxDir = join(tmpDir, "inbox");
		mkdirSync(inboxDir, { recursive: true });

		// Write messages with different timestamps
		const msg1 = { id: "1000-aaa00", batchId: "batch-1", from: "supervisor", to: "session-1", timestamp: 1000, type: "steer", content: "first" };
		const msg3 = { id: "3000-ccc00", batchId: "batch-1", from: "supervisor", to: "session-1", timestamp: 3000, type: "steer", content: "third" };
		const msg2 = { id: "2000-bbb00", batchId: "batch-1", from: "supervisor", to: "session-1", timestamp: 2000, type: "steer", content: "second" };

		// Write in non-sorted order
		writeFileSync(join(inboxDir, "3000-ccc00.msg.json"), JSON.stringify(msg3));
		writeFileSync(join(inboxDir, "1000-aaa00.msg.json"), JSON.stringify(msg1));
		writeFileSync(join(inboxDir, "2000-bbb00.msg.json"), JSON.stringify(msg2));

		const results = readInbox(inboxDir, "batch-1");
		expect(results).toHaveLength(3);
		expect(results[0].message.content).toBe("first");
		expect(results[1].message.content).toBe("second");
		expect(results[2].message.content).toBe("third");
	});

	it("skips non-.msg.json files (.tmp files, random files)", () => {
		const inboxDir = join(tmpDir, "inbox");
		mkdirSync(inboxDir, { recursive: true });

		const validMsg = { id: "1000-aaa00", batchId: "batch-1", from: "sup", to: "s1", timestamp: 1000, type: "steer", content: "valid" };
		writeFileSync(join(inboxDir, "1000-aaa00.msg.json"), JSON.stringify(validMsg));
		writeFileSync(join(inboxDir, "1000-aaa00.msg.json.tmp"), JSON.stringify(validMsg)); // temp file
		writeFileSync(join(inboxDir, "random.txt"), "not a message");
		writeFileSync(join(inboxDir, "data.json"), '{"not": "a message"}');

		const results = readInbox(inboxDir, "batch-1");
		expect(results).toHaveLength(1);
		expect(results[0].message.content).toBe("valid");
	});

	it("returns empty array when inbox dir doesn't exist", () => {
		const results = readInbox(join(tmpDir, "nonexistent", "inbox"), "batch-1");
		expect(results).toHaveLength(0);
	});

	it("rejects messages with mismatched batchId (leaves in inbox)", () => {
		const inboxDir = join(tmpDir, "inbox");
		mkdirSync(inboxDir, { recursive: true });

		const wrongBatch = { id: "1000-aaa00", batchId: "wrong-batch", from: "sup", to: "s1", timestamp: 1000, type: "steer", content: "wrong" };
		const rightBatch = { id: "2000-bbb00", batchId: "batch-1", from: "sup", to: "s1", timestamp: 2000, type: "steer", content: "right" };
		writeFileSync(join(inboxDir, "1000-aaa00.msg.json"), JSON.stringify(wrongBatch));
		writeFileSync(join(inboxDir, "2000-bbb00.msg.json"), JSON.stringify(rightBatch));

		const results = readInbox(inboxDir, "batch-1");
		expect(results).toHaveLength(1);
		expect(results[0].message.content).toBe("right");

		// Wrong batch message is still in inbox (not deleted)
		expect(existsSync(join(inboxDir, "1000-aaa00.msg.json"))).toBe(true);
	});

	it("skips malformed JSON files (doesn't throw)", () => {
		const inboxDir = join(tmpDir, "inbox");
		mkdirSync(inboxDir, { recursive: true });

		writeFileSync(join(inboxDir, "bad-json.msg.json"), "not valid json {{{");
		const validMsg = { id: "1000-aaa00", batchId: "batch-1", from: "sup", to: "s1", timestamp: 1000, type: "steer", content: "valid" };
		writeFileSync(join(inboxDir, "1000-aaa00.msg.json"), JSON.stringify(validMsg));

		const results = readInbox(inboxDir, "batch-1");
		expect(results).toHaveLength(1);
		expect(results[0].message.content).toBe("valid");
	});

	it("skips messages with invalid shape (missing required fields)", () => {
		const inboxDir = join(tmpDir, "inbox");
		mkdirSync(inboxDir, { recursive: true });

		// Missing 'type' field
		const incomplete = { id: "1000-aaa00", batchId: "batch-1", from: "sup", to: "s1", timestamp: 1000, content: "test" };
		writeFileSync(join(inboxDir, "1000-aaa00.msg.json"), JSON.stringify(incomplete));

		// Missing 'id' field
		const noId = { batchId: "batch-1", from: "sup", to: "s1", timestamp: 1000, type: "steer", content: "test" };
		writeFileSync(join(inboxDir, "no-id.msg.json"), JSON.stringify(noId));

		// Non-finite timestamp
		const badTs = { id: "2000-bbb00", batchId: "batch-1", from: "sup", to: "s1", timestamp: NaN, type: "steer", content: "test" };
		writeFileSync(join(inboxDir, "2000-bbb00.msg.json"), JSON.stringify(badTs));

		const results = readInbox(inboxDir, "batch-1");
		expect(results).toHaveLength(0);
	});
});

// ── 4. ackMessage ────────────────────────────────────────────────────

describe("ackMessage", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir("ack");
	});

	afterEach(() => {
		cleanupDir(tmpDir);
	});

	it("moves file from inbox/ to ack/ directory", () => {
		const inboxDir = join(tmpDir, "session", "inbox");
		mkdirSync(inboxDir, { recursive: true });

		const filename = "1000-aaa00.msg.json";
		writeFileSync(join(inboxDir, filename), '{"test": true}');

		const result = ackMessage(inboxDir, filename);
		expect(result).toBe(true);

		// File should be gone from inbox
		expect(existsSync(join(inboxDir, filename))).toBe(false);

		// File should exist in ack/
		const ackDir = join(tmpDir, "session", "ack");
		expect(existsSync(join(ackDir, filename))).toBe(true);
	});

	it("creates ack/ dir if it doesn't exist", () => {
		const inboxDir = join(tmpDir, "session2", "inbox");
		mkdirSync(inboxDir, { recursive: true });

		const filename = "1000-bbb00.msg.json";
		writeFileSync(join(inboxDir, filename), '{"test": true}');

		const ackDir = join(tmpDir, "session2", "ack");
		expect(existsSync(ackDir)).toBe(false);

		const result = ackMessage(inboxDir, filename);
		expect(result).toBe(true);
		expect(existsSync(ackDir)).toBe(true);
	});

	it("returns false on ENOENT race (already acked)", () => {
		const inboxDir = join(tmpDir, "session3", "inbox");
		mkdirSync(inboxDir, { recursive: true });

		// File doesn't exist — simulates race condition
		const result = ackMessage(inboxDir, "nonexistent.msg.json");
		expect(result).toBe(false);
	});
});

// ── 5. isValidMailboxMessage ─────────────────────────────────────────

describe("isValidMailboxMessage", () => {
	it("validates a correct message shape", () => {
		const msg = {
			id: "1000-aaa00",
			batchId: "batch-1",
			from: "supervisor",
			to: "session-1",
			timestamp: 1000,
			type: "steer",
			content: "test",
		};
		expect(isValidMailboxMessage(msg)).toBe(true);
	});

	it("rejects null/undefined/non-object", () => {
		expect(isValidMailboxMessage(null)).toBe(false);
		expect(isValidMailboxMessage(undefined)).toBe(false);
		expect(isValidMailboxMessage("string")).toBe(false);
		expect(isValidMailboxMessage(42)).toBe(false);
	});

	it("rejects missing required fields", () => {
		// Missing id
		expect(isValidMailboxMessage({ batchId: "b", from: "f", to: "t", timestamp: 1, type: "steer", content: "c" })).toBe(false);
		// Missing content
		expect(isValidMailboxMessage({ id: "i", batchId: "b", from: "f", to: "t", timestamp: 1, type: "steer" })).toBe(false);
		// Missing type
		expect(isValidMailboxMessage({ id: "i", batchId: "b", from: "f", to: "t", timestamp: 1, content: "c" })).toBe(false);
	});

	it("rejects invalid type value", () => {
		const msg = {
			id: "1000-aaa00",
			batchId: "batch-1",
			from: "supervisor",
			to: "session-1",
			timestamp: 1000,
			type: "invalid_type",
			content: "test",
		};
		expect(isValidMailboxMessage(msg)).toBe(false);
	});

	it("rejects non-finite timestamp", () => {
		const msg = {
			id: "1000-aaa00",
			batchId: "batch-1",
			from: "supervisor",
			to: "session-1",
			timestamp: NaN,
			type: "steer",
			content: "test",
		};
		expect(isValidMailboxMessage(msg)).toBe(false);
	});

	it("accepts all valid message types", () => {
		for (const type of MAILBOX_MESSAGE_TYPES) {
			const msg = {
				id: "1000-aaa00",
				batchId: "batch-1",
				from: "supervisor",
				to: "session-1",
				timestamp: 1000,
				type,
				content: "test",
			};
			expect(isValidMailboxMessage(msg)).toBe(true);
		}
	});
});

// ── 6. writeMailboxMessage — supervisor tool path verification ───────

describe("writeMailboxMessage — supervisor tool path", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir("supervisor");
	});

	afterEach(() => {
		cleanupDir(tmpDir);
	});

	it("writes to correct inbox path for target session", () => {
		const sessionName = "orch-henry-lane-1-worker";
		const msg = writeMailboxMessage(tmpDir, "batch-42", sessionName, {
			from: "supervisor",
			type: "steer",
			content: "Course correct: focus on the API.",
		});

		// Verify file exists at expected path
		const expectedInboxDir = sessionInboxDir(tmpDir, "batch-42", sessionName);
		const files = readdirSync(expectedInboxDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toBe(`${msg.id}.msg.json`);

		// Verify message content from disk
		const diskMsg = JSON.parse(readFileSync(join(expectedInboxDir, files[0]), "utf-8"));
		expect(diskMsg.from).toBe("supervisor");
		expect(diskMsg.to).toBe(sessionName);
		expect(diskMsg.type).toBe("steer");
		expect(diskMsg.content).toBe("Course correct: focus on the API.");
	});

	it("correctly sets from='supervisor' and requested type", () => {
		const msg = writeMailboxMessage(tmpDir, "batch-42", "session-1", {
			from: "supervisor",
			type: "info",
			content: "FYI: test results are ready.",
		});

		expect(msg.from).toBe("supervisor");
		expect(msg.type).toBe("info");
	});
});

// ── 7. Cleanup — cleanupPostIntegrate ────────────────────────────────

describe("cleanupPostIntegrate — mailbox cleanup", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir("cleanup");
	});

	afterEach(() => {
		cleanupDir(tmpDir);
	});

	it("deletes .pi/mailbox/{batchId}/ and reports mailboxDirsDeleted=1", () => {
		const batchId = "20260329T120000";
		const mailboxBatchDir = join(tmpDir, ".pi", MAILBOX_DIR_NAME, batchId);
		mkdirSync(join(mailboxBatchDir, "session-1", "inbox"), { recursive: true });
		mkdirSync(join(mailboxBatchDir, "session-1", "ack"), { recursive: true });
		writeFileSync(join(mailboxBatchDir, "session-1", "inbox", "msg.msg.json"), "{}");
		writeFileSync(join(mailboxBatchDir, "session-1", "ack", "old.msg.json"), "{}");

		const result = cleanupPostIntegrate(tmpDir, batchId);
		expect(result.mailboxDirsDeleted).toBe(1);
		expect(existsSync(mailboxBatchDir)).toBe(false);
		expect(result.warnings).toHaveLength(0);
	});

	it("no-op when mailbox dir doesn't exist (mailboxDirsDeleted=0)", () => {
		const result = cleanupPostIntegrate(tmpDir, "nonexistent-batch");
		expect(result.mailboxDirsDeleted).toBe(0);
		expect(result.warnings).toHaveLength(0);
	});
});

// ── 8. Cleanup — sweepStaleArtifacts ─────────────────────────────────

describe("sweepStaleArtifacts — mailbox stale sweep", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir("sweep");
	});

	afterEach(() => {
		cleanupDir(tmpDir);
	});

	it("deletes old mailbox batch dirs (>7 days by mtime)", () => {
		const mailboxBase = join(tmpDir, ".pi", MAILBOX_DIR_NAME);
		const oldBatchDir = join(mailboxBase, "old-batch");
		mkdirSync(join(oldBatchDir, "session-1", "inbox"), { recursive: true });

		// Set mtime to 8 days ago
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		utimesSync(oldBatchDir, eightDaysAgo, eightDaysAgo);

		const result = sweepStaleArtifacts(tmpDir, {
			isBatchActive: () => false,
			now: () => Date.now(),
		});

		expect(result.staleDirsDeleted).toBe(1);
		expect(existsSync(oldBatchDir)).toBe(false);
	});

	it("preserves recent mailbox batch dirs (<7 days)", () => {
		const mailboxBase = join(tmpDir, ".pi", MAILBOX_DIR_NAME);
		const recentBatchDir = join(mailboxBase, "recent-batch");
		mkdirSync(join(recentBatchDir, "session-1", "inbox"), { recursive: true });

		// Recent dir — mtime is now (default)
		const result = sweepStaleArtifacts(tmpDir, {
			isBatchActive: () => false,
			now: () => Date.now(),
		});

		expect(result.staleDirsDeleted).toBe(0);
		expect(existsSync(recentBatchDir)).toBe(true);
	});

	it("skips files under .pi/mailbox/ (only processes directories)", () => {
		const mailboxBase = join(tmpDir, ".pi", MAILBOX_DIR_NAME);
		mkdirSync(mailboxBase, { recursive: true });
		writeFileSync(join(mailboxBase, "stray-file.txt"), "should not be deleted");

		// Set file mtime to 8 days ago
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		utimesSync(join(mailboxBase, "stray-file.txt"), eightDaysAgo, eightDaysAgo);

		const result = sweepStaleArtifacts(tmpDir, {
			isBatchActive: () => false,
			now: () => Date.now(),
		});

		expect(result.staleDirsDeleted).toBe(0);
		// File should still exist (not deleted because it's not a directory)
		expect(existsSync(join(mailboxBase, "stray-file.txt"))).toBe(true);
	});

	it("handles mixed old/new dirs correctly", () => {
		const mailboxBase = join(tmpDir, ".pi", MAILBOX_DIR_NAME);
		const oldDir = join(mailboxBase, "old-batch");
		const newDir = join(mailboxBase, "new-batch");
		mkdirSync(join(oldDir, "inbox"), { recursive: true });
		mkdirSync(join(newDir, "inbox"), { recursive: true });

		// Old: 10 days ago
		const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		utimesSync(oldDir, tenDaysAgo, tenDaysAgo);

		const result = sweepStaleArtifacts(tmpDir, {
			isBatchActive: () => false,
			now: () => Date.now(),
		});

		expect(result.staleDirsDeleted).toBe(1);
		expect(existsSync(oldDir)).toBe(false);
		expect(existsSync(newDir)).toBe(true);
	});
});

// ── 9. MAILBOX_MESSAGE_TYPES constant ────────────────────────────────

describe("MAILBOX_MESSAGE_TYPES", () => {
	it("contains all expected types", () => {
		const expectedTypes = ["steer", "query", "abort", "info", "reply", "escalate"];
		for (const t of expectedTypes) {
			expect(MAILBOX_MESSAGE_TYPES.has(t)).toBe(true);
		}
		expect(MAILBOX_MESSAGE_TYPES.size).toBe(expectedTypes.length);
	});
});

// ── 10. TP-090: Steering-pending annotation contract ────────────────

/**
 * These tests verify the TP-090 contract by exercising the annotation logic
 * that lives in task-runner.ts. Since that logic is embedded in the polling
 * loop and not directly importable, we verify it via source extraction
 * (contract tests) and by reimplementing the pure helper (sanitization).
 */

// Reimplement sanitizeSteeringContent for direct testing
// (mirrors the function in task-runner.ts)
function sanitizeSteeringContent(content: string): string {
	let s = content.replace(/\r?\n/g, " / ").replace(/\|/g, "\\|");
	if (s.length > 200) s = s.slice(0, 197) + "...";
	return s;
}

// Reimplement appendTableRow for test isolation
function appendTableRow(statusPath: string, sectionName: string, row: string): void {
	let content = readFileSync(statusPath, "utf-8").replace(/\r\n/g, "\n");
	const lines = content.split("\n");
	let insertIdx = -1, inSection = false, lastTableRow = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].match(new RegExp(`^##\\s+${sectionName}`))) {
			inSection = true;
			continue;
		}
		if (inSection) {
			if (lines[i].match(/^##\s/) || lines[i].trim() === "---") {
				insertIdx = lastTableRow >= 0 ? lastTableRow + 1 : i;
				break;
			}
			if (lines[i].startsWith("|") && !lines[i].match(/^\|[\s-|]+\|$/)) {
				lastTableRow = i;
			}
		}
	}
	if (insertIdx === -1) {
		insertIdx = lastTableRow >= 0 ? lastTableRow + 1 : lines.length;
	}
	lines.splice(insertIdx, 0, row);
	writeFileSync(statusPath, lines.join("\n"));
}

/**
 * Simulate the task-runner steering annotation logic.
 * This mirrors the code in the polling loop of task-runner.ts executeTask().
 */
function processSteeringPending(taskFolder: string, statusPath: string): number {
	const steeringFlagPath = join(taskFolder, ".steering-pending");
	let annotated = 0;
	if (existsSync(steeringFlagPath)) {
		const raw = readFileSync(steeringFlagPath, "utf-8");
		const lines = raw.split("\n").filter(l => l.trim());
		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as { ts: number; content: string; id: string };
				const sanitized = sanitizeSteeringContent(entry.content);
				const ts = new Date(entry.ts).toISOString().slice(0, 16).replace("T", " ");
				appendTableRow(statusPath, "Execution Log", `| ${ts} | \u26a0\ufe0f Steering | ${sanitized} |`);
				annotated++;
			} catch {
				// Skip malformed lines
			}
		}
		rmSync(steeringFlagPath);
	}
	return annotated;
}

const SAMPLE_STATUS_MD = `# TP-TEST: Test Task — Status

**Current Step:** Step 1
**Status:** 🟡 In Progress

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-29 12:00 | Task started | Extension-driven execution |

---

## Blockers

*None*
`;

describe("TP-090: Steering-pending annotation", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir("steering");
	});

	afterEach(() => {
		cleanupDir(tmpDir);
	});

	it(".steering-pending triggers STATUS.md annotation", () => {
		const statusPath = join(tmpDir, "STATUS.md");
		writeFileSync(statusPath, SAMPLE_STATUS_MD);

		const entry = { ts: 1774800000000, content: "Focus on the API endpoint.", id: "1000-abc12" };
		writeFileSync(join(tmpDir, ".steering-pending"), JSON.stringify(entry) + "\n");

		const count = processSteeringPending(tmpDir, statusPath);
		expect(count).toBe(1);

		const content = readFileSync(statusPath, "utf-8");
		expect(content).toContain("\u26a0\ufe0f Steering");
		expect(content).toContain("Focus on the API endpoint.");
	});

	it("flag file is deleted after annotation", () => {
		const statusPath = join(tmpDir, "STATUS.md");
		writeFileSync(statusPath, SAMPLE_STATUS_MD);

		const entry = { ts: 1774800000000, content: "Test deletion.", id: "2000-def34" };
		writeFileSync(join(tmpDir, ".steering-pending"), JSON.stringify(entry) + "\n");

		processSteeringPending(tmpDir, statusPath);

		expect(existsSync(join(tmpDir, ".steering-pending"))).toBe(false);
	});

	it("annotates multiple entries from one .steering-pending file", () => {
		const statusPath = join(tmpDir, "STATUS.md");
		writeFileSync(statusPath, SAMPLE_STATUS_MD);

		const entries = [
			{ ts: 1774800000000, content: "First steering.", id: "1000-aaa00" },
			{ ts: 1774800001000, content: "Second steering.", id: "2000-bbb00" },
		];
		const jsonl = entries.map(e => JSON.stringify(e)).join("\n") + "\n";
		writeFileSync(join(tmpDir, ".steering-pending"), jsonl);

		const count = processSteeringPending(tmpDir, statusPath);
		expect(count).toBe(2);

		const content = readFileSync(statusPath, "utf-8");
		expect(content).toContain("First steering.");
		expect(content).toContain("Second steering.");
	});

	it("skips malformed JSONL lines gracefully", () => {
		const statusPath = join(tmpDir, "STATUS.md");
		writeFileSync(statusPath, SAMPLE_STATUS_MD);

		const jsonl = '{invalid json\n' +
			JSON.stringify({ ts: 1774800000000, content: "Valid entry.", id: "3000-ccc00" }) + '\n';
		writeFileSync(join(tmpDir, ".steering-pending"), jsonl);

		const count = processSteeringPending(tmpDir, statusPath);
		expect(count).toBe(1);

		const content = readFileSync(statusPath, "utf-8");
		expect(content).toContain("Valid entry.");
	});

	it("no-op when .steering-pending doesn't exist", () => {
		const statusPath = join(tmpDir, "STATUS.md");
		writeFileSync(statusPath, SAMPLE_STATUS_MD);

		const count = processSteeringPending(tmpDir, statusPath);
		expect(count).toBe(0);

		// STATUS.md unchanged (no steering rows)
		const content = readFileSync(statusPath, "utf-8");
		expect(content).not.toContain("\u26a0\ufe0f Steering");
	});
});

describe("TP-090: sanitizeSteeringContent", () => {
	it("collapses newlines to ' / '", () => {
		expect(sanitizeSteeringContent("line1\nline2")).toBe("line1 / line2");
		expect(sanitizeSteeringContent("line1\r\nline2")).toBe("line1 / line2");
	});

	it("escapes pipe characters", () => {
		expect(sanitizeSteeringContent("use | for tables")).toBe("use \\| for tables");
	});

	it("truncates to 200 chars with ellipsis", () => {
		const long = "x".repeat(250);
		const result = sanitizeSteeringContent(long);
		expect(result.length).toBe(200);
		expect(result.endsWith("...")).toBe(true);
	});

	it("preserves content at exactly 200 chars", () => {
		const exact = "y".repeat(200);
		const result = sanitizeSteeringContent(exact);
		expect(result.length).toBe(200);
		expect(result).toBe(exact);
	});

	it("handles combined newlines and pipes", () => {
		expect(sanitizeSteeringContent("a\nb|c")).toBe("a / b\\|c");
	});
});

// ── 11. TP-090: Source extraction — task-runner contract verification ──

describe("TP-090: task-runner steering annotation contract (source extraction)", () => {
	let taskRunnerSrc: string;

	beforeEach(() => {
		taskRunnerSrc = readFileSync(join(__dirname, "..", "task-runner.ts"), "utf-8");
	});

	it("task-runner checks .steering-pending in polling loop", () => {
		expect(taskRunnerSrc).toContain(".steering-pending");
		// Source uses unicode escapes \u26a0\ufe0f — search for the literal string
		expect(taskRunnerSrc).toContain("Steering");
		expect(taskRunnerSrc).toContain("\\u26a0\\ufe0f");
	});

	it("task-runner has sanitizeSteeringContent function", () => {
		expect(taskRunnerSrc).toContain("function sanitizeSteeringContent");
	});

	it("steeringPendingPath is passed only for worker sessions", () => {
		// Worker spawn has steeringPendingPath
		expect(taskRunnerSrc).toContain("steeringPendingPath,");
		// The option is defined in spawnAgentTmux
		expect(taskRunnerSrc).toContain("steeringPendingPath?:");
	});

	it("rpc-wrapper passes --steering-pending-path from opts", () => {
		expect(taskRunnerSrc).toContain("--steering-pending-path");
	});
});
