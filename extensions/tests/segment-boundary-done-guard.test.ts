/**
 * TP-165: Regression tests for segment boundary .DONE guard
 * and expansion request consumption fixes.
 *
 * Bug #1: .DONE was created after the first segment completes when the
 *   task had pending expansion requests (dynamic segment creation).
 *   Fix: lane-runner checks for pending expansion request files in the
 *   worker's outbox before creating .DONE.
 *
 * Bug #2: Engine looked in the wrong outbox directory for expansion
 *   request files because resolveTaskWorkerAgentId fell back to
 *   lane.laneSessionId (without -worker suffix).
 *   Fix: resolveTaskWorkerAgentId uses agentIdPrefix + global laneNumber
 *   to derive the canonical worker agent ID.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, beforeEach, afterEach } from "node:test";

import { expect } from "./expect.ts";
import { hasPendingExpansionRequestFiles } from "../taskplane/lane-runner.ts";
import { resolveTaskWorkerAgentId } from "../taskplane/engine.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function makeTempDir(): string {
	const dir = join(tmpdir(), `tp165-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function rmrf(dir: string): void {
	try {
		const { rmSync } = require("fs");
		rmSync(dir, { recursive: true, force: true });
	} catch { /* best effort */ }
}

// ── Bug #1: Premature .DONE guard with pending expansion requests ───

describe("TP-165 regression: .DONE suppressed when expansion requests pending", () => {
	let stateRoot: string;
	const batchId = "20260412T000000";
	const agentId = "orch-henry-lane-1-worker";

	beforeEach(() => {
		stateRoot = makeTempDir();
	});

	afterEach(() => {
		rmrf(stateRoot);
	});

	it("detects pending expansion request files in outbox", () => {
		const outboxDir = join(stateRoot, ".pi", "mailbox", batchId, agentId, "outbox");
		mkdirSync(outboxDir, { recursive: true });
		writeFileSync(join(outboxDir, "segment-expansion-exp-001.json"), JSON.stringify({
			requestId: "exp-001",
			taskId: "TP-100",
			fromSegmentId: "TP-100::default",
			requestedRepoIds: ["api"],
			placement: "after-current",
		}));

		const result = hasPendingExpansionRequestFiles(stateRoot, batchId, agentId);
		expect(result).toBe(true);
	});

	it("returns false when outbox is empty", () => {
		const outboxDir = join(stateRoot, ".pi", "mailbox", batchId, agentId, "outbox");
		mkdirSync(outboxDir, { recursive: true });

		const result = hasPendingExpansionRequestFiles(stateRoot, batchId, agentId);
		expect(result).toBe(false);
	});

	it("returns false when outbox does not exist", () => {
		const result = hasPendingExpansionRequestFiles(stateRoot, batchId, agentId);
		expect(result).toBe(false);
	});

	it("ignores already-processed expansion files", () => {
		const outboxDir = join(stateRoot, ".pi", "mailbox", batchId, agentId, "outbox");
		mkdirSync(outboxDir, { recursive: true });
		// A processed file has been renamed to .json.processed
		writeFileSync(join(outboxDir, "segment-expansion-exp-001.json.processed"), "{}");

		const result = hasPendingExpansionRequestFiles(stateRoot, batchId, agentId);
		expect(result).toBe(false);
	});

	it("detects pending even when processed files coexist", () => {
		const outboxDir = join(stateRoot, ".pi", "mailbox", batchId, agentId, "outbox");
		mkdirSync(outboxDir, { recursive: true });
		writeFileSync(join(outboxDir, "segment-expansion-exp-001.json.processed"), "{}");
		writeFileSync(join(outboxDir, "segment-expansion-exp-002.json"), JSON.stringify({
			requestId: "exp-002",
		}));

		const result = hasPendingExpansionRequestFiles(stateRoot, batchId, agentId);
		expect(result).toBe(true);
	});
});

// ── Bug #2: Expansion consumption agent ID resolution ───────────────

describe("TP-165 regression: resolveTaskWorkerAgentId workspace-mode fix", () => {
	it("workspace mode: uses global laneNumber, not repo-scoped laneSessionId", () => {
		// In workspace mode, laneSessionId = "orch-op-api-lane-1" (local number 1)
		// but global laneNumber may be 3. The worker outbox uses global numbering.
		const outcomes: any[] = [];
		const laneByTaskId = new Map([
			["TP-200", { laneSessionId: "orch-op-api-lane-1", laneNumber: 3 } as any],
		]);
		const result = resolveTaskWorkerAgentId("TP-200", outcomes, laneByTaskId, "orch-op");
		expect(result).toBe("orch-op-lane-3-worker");
		// MUST NOT be "orch-op-api-lane-1-worker" (the old buggy behavior)
		expect(result).not.toBe("orch-op-api-lane-1-worker");
	});

	it("repo mode: produces correct worker ID from lane", () => {
		const outcomes: any[] = [{ taskId: "TP-100", sessionName: "", status: "succeeded" }];
		const laneByTaskId = new Map([
			["TP-100", { laneSessionId: "orch-henry-lane-1", laneNumber: 1 } as any],
		]);
		const result = resolveTaskWorkerAgentId("TP-100", outcomes, laneByTaskId, "orch-henry");
		expect(result).toBe("orch-henry-lane-1-worker");
	});

	it("prefers outcome.sessionName when available (no fallback needed)", () => {
		const outcomes: any[] = [{ taskId: "TP-100", sessionName: "orch-henry-lane-1-worker", status: "succeeded" }];
		const result = resolveTaskWorkerAgentId("TP-100", outcomes, new Map());
		expect(result).toBe("orch-henry-lane-1-worker");
	});
});
