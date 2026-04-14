import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { expect } from "./expect.ts";
import { loadBatchHistory, saveBatchHistory, updateBatchHistoryIntegration } from "../taskplane/persistence.ts";
import { withPreservedBatchHistory } from "../taskplane/extension.ts";
import type { BatchHistorySummary } from "../taskplane/types.ts";

function makeSummary(batchId: string, status: BatchHistorySummary["status"], startedAt = 1000): BatchHistorySummary {
	return {
		batchId,
		status,
		startedAt,
		endedAt: startedAt + 500,
		durationMs: 500,
		totalWaves: 1,
		totalTasks: 1,
		succeededTasks: status === "completed" ? 1 : 0,
		failedTasks: status === "failed" ? 1 : 0,
		skippedTasks: 0,
		blockedTasks: 0,
		tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
		tasks: [{
			taskId: "TP-137",
			taskName: "TP-137",
			status: status === "failed" ? "failed" : "succeeded",
			wave: 1,
			lane: 1,
			durationMs: 500,
			tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
			exitReason: null,
		}],
		waves: [{
			wave: 1,
			tasks: ["TP-137"],
			mergeStatus: "succeeded",
			durationMs: 500,
			tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
		}],
	};
}

describe("batch history persistence", () => {
	it("saveBatchHistory writes entries and keeps newest first", () => {
		const root = mkdtempSync(join(tmpdir(), "tp-137-history-"));
		try {
			saveBatchHistory(root, makeSummary("batch-old", "completed", 1000));
			saveBatchHistory(root, makeSummary("batch-new", "completed", 2000));

			const history = loadBatchHistory(root);
			expect(history).toHaveLength(2);
			expect(history[0].batchId).toBe("batch-new");
			expect(history[1].batchId).toBe("batch-old");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("saveBatchHistory upserts resumed batches by batchId", () => {
		const root = mkdtempSync(join(tmpdir(), "tp-137-resume-"));
		try {
			saveBatchHistory(root, makeSummary("batch-resume", "partial", 1000));
			saveBatchHistory(root, makeSummary("batch-resume", "completed", 2000));

			const history = loadBatchHistory(root);
			expect(history).toHaveLength(1);
			expect(history[0].batchId).toBe("batch-resume");
			expect(history[0].status).toBe("completed");
			expect(history[0].startedAt).toBe(2000);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("withPreservedBatchHistory restores pre-integration history snapshot", () => {
		const root = mkdtempSync(join(tmpdir(), "tp-137-preserve-"));
		const piDir = join(root, ".pi");
		const historyPath = join(piDir, "batch-history.json");
		mkdirSync(piDir, { recursive: true });
		const original = JSON.stringify([makeSummary("batch-live", "completed", 3000)], null, 2);
		writeFileSync(historyPath, original, "utf-8");

		try {
			const result = withPreservedBatchHistory(root, () => {
				writeFileSync(historyPath, JSON.stringify([makeSummary("batch-stale", "failed", 1000)], null, 2), "utf-8");
				return "ok";
			});

			expect(result).toBe("ok");
			expect(readFileSync(historyPath, "utf-8")).toBe(original);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("updateBatchHistoryIntegration (TP-179)", () => {
	it("sets integratedAt on a matching history entry", () => {
		const root = mkdtempSync(join(tmpdir(), "tp-179-intAt-"));
		try {
			saveBatchHistory(root, makeSummary("batch-int", "completed", 5000));

			const ts = Date.now();
			updateBatchHistoryIntegration(root, "batch-int", ts);

			const history = loadBatchHistory(root);
			expect(history).toHaveLength(1);
			expect(history[0].batchId).toBe("batch-int");
			expect(history[0].integratedAt).toBe(ts);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("is a no-op when batchId is not found in history", () => {
		const root = mkdtempSync(join(tmpdir(), "tp-179-noop-"));
		try {
			saveBatchHistory(root, makeSummary("batch-other", "completed", 3000));

			updateBatchHistoryIntegration(root, "nonexistent-batch", Date.now());

			const history = loadBatchHistory(root);
			expect(history).toHaveLength(1);
			expect(history[0].batchId).toBe("batch-other");
			expect(history[0].integratedAt).toBe(undefined);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves other entries when updating integratedAt", () => {
		const root = mkdtempSync(join(tmpdir(), "tp-179-multi-"));
		try {
			saveBatchHistory(root, makeSummary("batch-A", "completed", 1000));
			saveBatchHistory(root, makeSummary("batch-B", "completed", 2000));

			const ts = 9999;
			updateBatchHistoryIntegration(root, "batch-A", ts);

			const history = loadBatchHistory(root);
			expect(history).toHaveLength(2);
			const entryA = history.find(e => e.batchId === "batch-A");
			const entryB = history.find(e => e.batchId === "batch-B");
			expect(entryA!.integratedAt).toBe(ts);
			expect(entryB!.integratedAt).toBe(undefined);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not crash when history file does not exist", () => {
		const root = mkdtempSync(join(tmpdir(), "tp-179-nofile-"));
		try {
			// Should not throw — just log and return
			updateBatchHistoryIntegration(root, "batch-ghost", Date.now());

			// History should still be empty
			const history = loadBatchHistory(root);
			expect(history).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
