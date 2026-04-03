import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import { readReviewerTelemetrySnapshot, type LaneRunnerConfig } from "../taskplane/lane-runner.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function extractFunction(source: string, signature: string): string {
	const start = source.indexOf(signature);
	if (start < 0) throw new Error(`Function not found: ${signature}`);
	const braceStart = source.indexOf("{", start);
	if (braceStart < 0) throw new Error(`No opening brace for: ${signature}`);

	let depth = 0;
	for (let i = braceStart; i < source.length; i++) {
		const ch = source[i];
		if (ch === "{") depth++;
		if (ch === "}") depth--;
		if (depth === 0) {
			return source.slice(start, i + 1);
		}
	}
	throw new Error(`No closing brace for: ${signature}`);
}

describe("TP-121: dashboard reviewer lane-state synthesis", () => {
	it("maps reviewer snapshot fields to legacy lane-state shape", () => {
		const serverSrc = readFileSync(join(__dirname, "..", "..", "dashboard", "server.cjs"), "utf-8");
		const fnSrc = extractFunction(serverSrc, "function synthesizeLaneStateFromSnapshot(");
		const synthesize = new Function(`${fnSrc}; return synthesizeLaneStateFromSnapshot;`)() as
			(key: string, snap: any, fallbackBatchId: string) => any;

		const laneState = synthesize("lane-1", {
			batchId: "batch-1",
			taskId: "TP-121",
			status: "running",
			worker: { status: "running", elapsedMs: 1000, toolCalls: 2 },
			reviewer: {
				status: "running",
				elapsedMs: 2500,
				toolCalls: 3,
				contextPct: 41,
				lastTool: "read: STATUS.md",
				costUsd: 0.12,
				inputTokens: 111,
				outputTokens: 222,
				cacheReadTokens: 333,
				cacheWriteTokens: 444,
			},
		}, "fallback-batch");

		expect(laneState.reviewerStatus).toBe("running");
		expect(laneState.reviewerElapsed).toBe(2500);
		expect(laneState.reviewerContextPct).toBe(41);
		expect(laneState.reviewerLastTool).toBe("read: STATUS.md");
		expect(laneState.reviewerToolCount).toBe(3);
		expect(laneState.reviewerCostUsd).toBe(0.12);
		expect(laneState.reviewerInputTokens).toBe(111);
		expect(laneState.reviewerOutputTokens).toBe(222);
		expect(laneState.reviewerCacheReadTokens).toBe(333);
		expect(laneState.reviewerCacheWriteTokens).toBe(444);
	});
});

describe("TP-121: lane-runner reviewer-state ingestion", () => {
	it("returns null when .reviewer-state.json is absent", () => {
		const root = mkdtempSync(join(tmpdir(), "tp121-no-reviewer-"));
		try {
			const taskDir = join(root, "task");
			mkdirSync(taskDir, { recursive: true });
			const statusPath = join(taskDir, "STATUS.md");
			writeFileSync(statusPath, "# status\n", "utf-8");
			const cfg: LaneRunnerConfig = {
				batchId: "batch-1",
				agentIdPrefix: "orch-test",
				laneNumber: 1,
				worktreePath: root,
				branch: "main",
				repoId: "repo",
				stateRoot: root,
				workerModel: "",
				workerTools: "read,write",
				workerThinking: "",
				workerSystemPrompt: "",
				projectName: "project",
				maxIterations: 1,
				noProgressLimit: 1,
				maxWorkerMinutes: 1,
				warnPercent: 80,
				killPercent: 95,
			};

			const reviewer = readReviewerTelemetrySnapshot(cfg, statusPath);
			expect(reviewer).toBe(null);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
