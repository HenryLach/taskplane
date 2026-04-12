/**
 * Tests for artifact cleanup policies (TP-168).
 *
 * Covers:
 * - Age sweep expansion (verification, conversations, lane-state)
 * - Telemetry size cap with oldest-first eviction
 * - Batch-start cleanup of prior batch artifacts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, utimesSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import {
	sweepStaleArtifacts,
	enforceTelemetrySizeCap,
	cleanupPriorBatchArtifacts,
	STALE_ARTIFACT_MAX_AGE_MS,
	TELEMETRY_SIZE_CAP_BYTES,
} from "../taskplane/cleanup.ts";
import type { SweepDeps } from "../taskplane/cleanup.ts";

// ── Helpers ─────────────────────────────────────────────────────────

function createTempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "cleanup-test-"));
	mkdirSync(join(root, ".pi"), { recursive: true });
	return root;
}

/** Create a file and set its mtime to a specific time. */
function createFileWithMtime(filePath: string, content: string, mtimeMs: number): void {
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, content);
	const mtime = new Date(mtimeMs);
	utimesSync(filePath, mtime, mtime);
}

/** Create a directory and set its mtime. */
function createDirWithMtime(dirPath: string, mtimeMs: number): void {
	mkdirSync(dirPath, { recursive: true });
	const mtime = new Date(mtimeMs);
	utimesSync(dirPath, mtime, mtime);
}

/** Default non-active sweep deps. */
function inactiveDeps(nowMs: number): SweepDeps {
	return {
		isBatchActive: () => false,
		now: () => nowMs,
	};
}

// ── Constants ───────────────────────────────────────────────────────

describe("TP-168: Cleanup constants", () => {
	it("STALE_ARTIFACT_MAX_AGE_MS is 3 days", () => {
		assert.equal(STALE_ARTIFACT_MAX_AGE_MS, 3 * 24 * 60 * 60 * 1000);
	});

	it("TELEMETRY_SIZE_CAP_BYTES is 500MB", () => {
		assert.equal(TELEMETRY_SIZE_CAP_BYTES, 500 * 1024 * 1024);
	});
});

// ── Age Sweep: All Artifact Types ───────────────────────────────────

describe("TP-168: Age sweep covers all artifact types", () => {
	const now = Date.now();
	const staleTime = now - (4 * 24 * 60 * 60 * 1000); // 4 days ago (> 3 day threshold)
	const freshTime = now - (1 * 24 * 60 * 60 * 1000); // 1 day ago (< 3 day threshold)

	it("deletes stale telemetry .jsonl files", () => {
		const root = createTempRoot();
		const telDir = join(root, ".pi", "telemetry");
		mkdirSync(telDir, { recursive: true });
		createFileWithMtime(join(telDir, "worker-batch123-lane1.jsonl"), "data", staleTime);
		createFileWithMtime(join(telDir, "fresh-batch456.jsonl"), "data", freshTime);

		const result = sweepStaleArtifacts(root, inactiveDeps(now));
		assert.equal(result.staleFilesDeleted, 1);
		assert.ok(!existsSync(join(telDir, "worker-batch123-lane1.jsonl")));
		assert.ok(existsSync(join(telDir, "fresh-batch456.jsonl")));
	});

	it("deletes stale telemetry exit.json files", () => {
		const root = createTempRoot();
		const telDir = join(root, ".pi", "telemetry");
		mkdirSync(telDir, { recursive: true });
		createFileWithMtime(join(telDir, "worker-batch123-exit.json"), "{}", staleTime);

		const result = sweepStaleArtifacts(root, inactiveDeps(now));
		assert.equal(result.staleFilesDeleted, 1);
		assert.ok(!existsSync(join(telDir, "worker-batch123-exit.json")));
	});

	it("deletes stale merge-result and merge-request files", () => {
		const root = createTempRoot();
		createFileWithMtime(join(root, ".pi", "merge-result-abc.json"), "{}", staleTime);
		createFileWithMtime(join(root, ".pi", "merge-request-abc.txt"), "data", staleTime);

		const result = sweepStaleArtifacts(root, inactiveDeps(now));
		assert.equal(result.staleFilesDeleted, 2);
	});

	it("deletes stale verification directories", () => {
		const root = createTempRoot();
		const verDir = join(root, ".pi", "verification", "op-old");
		mkdirSync(verDir, { recursive: true });
		// Write a file inside the dir first, then set dir mtime
		writeFileSync(join(verDir, "snapshot.json"), "{}");
		// Set mtime AFTER writing files (writing updates dir mtime)
		const staleDate = new Date(staleTime);
		utimesSync(verDir, staleDate, staleDate);

		const freshVerDir = join(root, ".pi", "verification", "op-new");
		createDirWithMtime(freshVerDir, freshTime);

		const result = sweepStaleArtifacts(root, inactiveDeps(now));
		assert.equal(result.staleDirsDeleted >= 1, true, "should delete stale verification dir");
		assert.ok(!existsSync(verDir), "stale verification dir should be removed");
		assert.ok(existsSync(freshVerDir), "fresh verification dir should be kept");
	});

	it("deletes stale worker-conversation-*.jsonl files", () => {
		const root = createTempRoot();
		createFileWithMtime(
			join(root, ".pi", "worker-conversation-batch123-lane1.jsonl"),
			"[]",
			staleTime,
		);
		createFileWithMtime(
			join(root, ".pi", "worker-conversation-batch456-lane2.jsonl"),
			"[]",
			freshTime,
		);

		const result = sweepStaleArtifacts(root, inactiveDeps(now));
		assert.equal(result.staleFilesDeleted, 1);
		assert.ok(!existsSync(join(root, ".pi", "worker-conversation-batch123-lane1.jsonl")));
		assert.ok(existsSync(join(root, ".pi", "worker-conversation-batch456-lane2.jsonl")));
	});

	it("deletes stale lane-state-*.json files", () => {
		const root = createTempRoot();
		createFileWithMtime(
			join(root, ".pi", "lane-state-batch123-lane1.json"),
			"{}",
			staleTime,
		);
		createFileWithMtime(
			join(root, ".pi", "lane-state-batch456-lane2.json"),
			"{}",
			freshTime,
		);

		const result = sweepStaleArtifacts(root, inactiveDeps(now));
		assert.equal(result.staleFilesDeleted, 1);
		assert.ok(!existsSync(join(root, ".pi", "lane-state-batch123-lane1.json")));
		assert.ok(existsSync(join(root, ".pi", "lane-state-batch456-lane2.json")));
	});

	it("skips sweep when batch is active", () => {
		const root = createTempRoot();
		createFileWithMtime(
			join(root, ".pi", "lane-state-batch123.json"),
			"{}",
			staleTime,
		);

		const result = sweepStaleArtifacts(root, {
			isBatchActive: () => true,
			now: () => now,
		});
		assert.equal(result.skipped, true);
		assert.equal(result.staleFilesDeleted, 0);
		assert.ok(existsSync(join(root, ".pi", "lane-state-batch123.json")));
	});

	it("preserves files within 3-day threshold", () => {
		const root = createTempRoot();
		const telDir = join(root, ".pi", "telemetry");
		mkdirSync(telDir, { recursive: true });

		// File just barely within threshold (2 days ago)
		const withinTime = now - (2 * 24 * 60 * 60 * 1000);
		createFileWithMtime(join(telDir, "recent.jsonl"), "data", withinTime);
		createFileWithMtime(
			join(root, ".pi", "worker-conversation-recent.jsonl"),
			"[]",
			withinTime,
		);
		createFileWithMtime(
			join(root, ".pi", "lane-state-recent.json"),
			"{}",
			withinTime,
		);

		const result = sweepStaleArtifacts(root, inactiveDeps(now));
		assert.equal(result.staleFilesDeleted, 0);
		assert.equal(result.staleDirsDeleted, 0);
	});
});

// ── Telemetry Size Cap ──────────────────────────────────────────────

describe("TP-168: Telemetry size cap eviction", () => {
	it("does nothing when under cap", () => {
		const root = createTempRoot();
		const telDir = join(root, ".pi", "telemetry");
		mkdirSync(telDir, { recursive: true });
		writeFileSync(join(telDir, "small.jsonl"), "x".repeat(100));

		const result = enforceTelemetrySizeCap(root, 1024); // 1KB cap
		assert.equal(result.filesDeleted, 0);
		assert.equal(result.bytesFreed, 0);
	});

	it("deletes oldest files first when over cap", () => {
		const root = createTempRoot();
		const telDir = join(root, ".pi", "telemetry");
		mkdirSync(telDir, { recursive: true });

		const now = Date.now();
		// Create 3 files: oldest (100B), middle (100B), newest (100B) = 300B total
		createFileWithMtime(join(telDir, "oldest.jsonl"), "x".repeat(100), now - 3000);
		createFileWithMtime(join(telDir, "middle.jsonl"), "y".repeat(100), now - 2000);
		createFileWithMtime(join(telDir, "newest.jsonl"), "z".repeat(100), now - 1000);

		// Cap at 200 bytes — should delete the oldest file (100B)
		const result = enforceTelemetrySizeCap(root, 200);
		assert.equal(result.filesDeleted, 1);
		assert.equal(result.bytesFreed, 100);
		assert.ok(!existsSync(join(telDir, "oldest.jsonl")), "oldest should be deleted");
		assert.ok(existsSync(join(telDir, "middle.jsonl")), "middle should remain");
		assert.ok(existsSync(join(telDir, "newest.jsonl")), "newest should remain");
	});

	it("deletes multiple files to get under cap", () => {
		const root = createTempRoot();
		const telDir = join(root, ".pi", "telemetry");
		mkdirSync(telDir, { recursive: true });

		const now = Date.now();
		createFileWithMtime(join(telDir, "a.jsonl"), "x".repeat(200), now - 3000);
		createFileWithMtime(join(telDir, "b.jsonl"), "y".repeat(200), now - 2000);
		createFileWithMtime(join(telDir, "c.jsonl"), "z".repeat(200), now - 1000);

		// Cap at 250 bytes — should delete 2 oldest (400B freed), keeping newest (200B)
		const result = enforceTelemetrySizeCap(root, 250);
		assert.equal(result.filesDeleted, 2);
		assert.equal(result.bytesFreed, 400);
		assert.ok(!existsSync(join(telDir, "a.jsonl")));
		assert.ok(!existsSync(join(telDir, "b.jsonl")));
		assert.ok(existsSync(join(telDir, "c.jsonl")));
	});

	it("returns empty result when telemetry directory doesn't exist", () => {
		const root = createTempRoot();
		// No telemetry dir created
		const result = enforceTelemetrySizeCap(root, 100);
		assert.equal(result.filesDeleted, 0);
		assert.equal(result.bytesFreed, 0);
	});

	it("skips subdirectories (only counts files)", () => {
		const root = createTempRoot();
		const telDir = join(root, ".pi", "telemetry");
		mkdirSync(telDir, { recursive: true });
		mkdirSync(join(telDir, "subdir"), { recursive: true });
		writeFileSync(join(telDir, "subdir", "nested.jsonl"), "x".repeat(100));
		writeFileSync(join(telDir, "top.jsonl"), "y".repeat(50));

		// Cap at 10 bytes — only the top-level file counts
		const result = enforceTelemetrySizeCap(root, 10);
		assert.equal(result.filesDeleted, 1);
		assert.ok(!existsSync(join(telDir, "top.jsonl")));
		assert.ok(existsSync(join(telDir, "subdir", "nested.jsonl")), "nested file should survive");
	});
});

// ── Batch-Start Cleanup ─────────────────────────────────────────────

describe("TP-168: Batch-start cleanup of prior batch artifacts", () => {
	it("removes prior batch telemetry files but protects current batch", () => {
		const root = createTempRoot();
		const telDir = join(root, ".pi", "telemetry");
		mkdirSync(telDir, { recursive: true });

		const currentBatch = "batch-current-123";
		const oldBatch = "batch-old-456";

		writeFileSync(join(telDir, `worker-${currentBatch}-lane1.jsonl`), "current");
		writeFileSync(join(telDir, `worker-${oldBatch}-lane1.jsonl`), "old");

		const result = cleanupPriorBatchArtifacts(root, currentBatch);
		assert.equal(result.itemsDeleted, 1);
		assert.ok(existsSync(join(telDir, `worker-${currentBatch}-lane1.jsonl`)), "current batch preserved");
		assert.ok(!existsSync(join(telDir, `worker-${oldBatch}-lane1.jsonl`)), "old batch removed");
	});

	it("removes prior batch merge-result/request files", () => {
		const root = createTempRoot();
		const currentBatch = "current-abc";
		const oldBatch = "old-def";

		writeFileSync(join(root, ".pi", `merge-result-${oldBatch}.json`), "{}");
		writeFileSync(join(root, ".pi", `merge-request-${oldBatch}.txt`), "req");
		writeFileSync(join(root, ".pi", `merge-result-${currentBatch}.json`), "{}");

		const result = cleanupPriorBatchArtifacts(root, currentBatch);
		assert.equal(result.itemsDeleted, 2);
		assert.ok(existsSync(join(root, ".pi", `merge-result-${currentBatch}.json`)));
	});

	it("removes prior batch conversation logs", () => {
		const root = createTempRoot();
		const currentBatch = "batchABC";

		writeFileSync(join(root, ".pi", "worker-conversation-oldBatch-lane1.jsonl"), "[]");
		writeFileSync(join(root, ".pi", `worker-conversation-${currentBatch}-lane1.jsonl`), "[]");

		const result = cleanupPriorBatchArtifacts(root, currentBatch);
		assert.equal(result.itemsDeleted, 1);
		assert.ok(existsSync(join(root, ".pi", `worker-conversation-${currentBatch}-lane1.jsonl`)));
		assert.ok(!existsSync(join(root, ".pi", "worker-conversation-oldBatch-lane1.jsonl")));
	});

	it("removes prior batch lane-state files", () => {
		const root = createTempRoot();
		const currentBatch = "batchXYZ";

		writeFileSync(join(root, ".pi", "lane-state-oldBatch-lane1.json"), "{}");
		writeFileSync(join(root, ".pi", `lane-state-${currentBatch}-lane1.json`), "{}");

		const result = cleanupPriorBatchArtifacts(root, currentBatch);
		assert.equal(result.itemsDeleted, 1);
		assert.ok(existsSync(join(root, ".pi", `lane-state-${currentBatch}-lane1.json`)));
	});

	it("removes prior batch mailbox directories", () => {
		const root = createTempRoot();
		const currentBatch = "batch-now";
		const oldBatch = "batch-then";

		mkdirSync(join(root, ".pi", "mailbox", currentBatch), { recursive: true });
		writeFileSync(join(root, ".pi", "mailbox", currentBatch, "msg.json"), "{}");
		mkdirSync(join(root, ".pi", "mailbox", oldBatch), { recursive: true });
		writeFileSync(join(root, ".pi", "mailbox", oldBatch, "msg.json"), "{}");

		const result = cleanupPriorBatchArtifacts(root, currentBatch);
		assert.ok(result.itemsDeleted >= 1);
		assert.ok(existsSync(join(root, ".pi", "mailbox", currentBatch)));
		assert.ok(!existsSync(join(root, ".pi", "mailbox", oldBatch)));
	});

	it("removes prior batch context-snapshot directories", () => {
		const root = createTempRoot();
		const currentBatch = "batch-now";
		const oldBatch = "batch-then";

		mkdirSync(join(root, ".pi", "context-snapshots", currentBatch), { recursive: true });
		mkdirSync(join(root, ".pi", "context-snapshots", oldBatch), { recursive: true });

		const result = cleanupPriorBatchArtifacts(root, currentBatch);
		assert.ok(result.itemsDeleted >= 1);
		assert.ok(existsSync(join(root, ".pi", "context-snapshots", currentBatch)));
		assert.ok(!existsSync(join(root, ".pi", "context-snapshots", oldBatch)));
	});

	it("skips cleanup when no batchId provided", () => {
		const root = createTempRoot();
		const telDir = join(root, ".pi", "telemetry");
		mkdirSync(telDir, { recursive: true });
		writeFileSync(join(telDir, "something.jsonl"), "data");

		const result = cleanupPriorBatchArtifacts(root, "");
		assert.equal(result.itemsDeleted, 0);
		assert.ok(result.warnings.length > 0);
		assert.ok(existsSync(join(telDir, "something.jsonl")));
	});

	it("handles non-existent .pi directory gracefully", () => {
		const root = mkdtempSync(join(tmpdir(), "cleanup-test-"));
		// No .pi directory at all
		const result = cleanupPriorBatchArtifacts(root, "some-batch");
		assert.equal(result.itemsDeleted, 0);
		assert.equal(result.warnings.length, 0);
	});
});
