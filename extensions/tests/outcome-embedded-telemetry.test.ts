import { describe, it } from "node:test";
import { expect } from "./expect.ts";

import { resolveBatchHistoryTaskTokens } from "../taskplane/engine.ts";
import type { LaneTaskOutcome, TokenCounts } from "../taskplane/types.ts";

function makeOutcome(overrides: Partial<LaneTaskOutcome> = {}): LaneTaskOutcome {
	return {
		taskId: "TP-116",
		status: "succeeded",
		startTime: 100,
		endTime: 200,
		exitReason: "ok",
		sessionName: "orch-op-lane-2-worker",
		doneFileFound: true,
		laneNumber: 2,
		...overrides,
	};
}

describe("TP-116: outcome-embedded telemetry for batch history", () => {
	it("uses outcome.telemetry when present", () => {
		const outcome = makeOutcome({
			telemetry: {
				inputTokens: 111,
				outputTokens: 222,
				cacheReadTokens: 333,
				cacheWriteTokens: 444,
				costUsd: 0.55,
				toolCalls: 7,
				durationMs: 9_000,
			},
		});
		const v2Fallback = new Map<number, TokenCounts>([[2, {
			input: 9,
			output: 9,
			cacheRead: 9,
			cacheWrite: 9,
			costUsd: 9,
		}]]);
		const legacyFallback = new Map<string, TokenCounts>([["orch-op-lane-2", {
			input: 8,
			output: 8,
			cacheRead: 8,
			cacheWrite: 8,
			costUsd: 8,
		}]]);

		const tokens = resolveBatchHistoryTaskTokens(outcome, 2, v2Fallback, legacyFallback);
		expect(tokens).toEqual({
			input: 111,
			output: 222,
			cacheRead: 333,
			cacheWrite: 444,
			costUsd: 0.55,
		});
	});

	it("falls back to V2 lane snapshot tokens when telemetry is absent", () => {
		const outcome = makeOutcome({ telemetry: undefined, laneNumber: 3, sessionName: "orch-op-lane-3-worker" });
		const v2Fallback = new Map<number, TokenCounts>([[3, {
			input: 10,
			output: 20,
			cacheRead: 30,
			cacheWrite: 40,
			costUsd: 0.12,
		}]]);

		const tokens = resolveBatchHistoryTaskTokens(outcome, 3, v2Fallback, new Map());
		expect(tokens).toEqual({
			input: 10,
			output: 20,
			cacheRead: 30,
			cacheWrite: 40,
			costUsd: 0.12,
		});
	});

	it("returns zero tokens for skipped tasks (no crash)", () => {
		const outcome = makeOutcome({
			status: "skipped",
			doneFileFound: false,
			startTime: null,
			endTime: null,
			telemetry: undefined,
			laneNumber: 4,
			sessionName: "orch-op-lane-4-worker",
		});
		const v2Fallback = new Map<number, TokenCounts>([[4, {
			input: 999,
			output: 999,
			cacheRead: 999,
			cacheWrite: 999,
			costUsd: 9.99,
		}]]);

		const tokens = resolveBatchHistoryTaskTokens(outcome, 4, v2Fallback, new Map());
		expect(tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
	});
});
