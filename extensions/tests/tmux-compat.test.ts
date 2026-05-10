import { describe, it } from "node:test";
import { expect } from "./expect.ts";

import { normalizeLaneSessionAlias, readLaneSessionAliases } from "../taskplane/tmux-compat.ts";

describe("tmux compatibility shim (migration-only)", () => {
	describe("lane session alias", () => {
		it("reads canonical + legacy lane session fields for validation", () => {
			const lane = { laneSessionId: undefined, tmuxSessionName: "orch-lane-1" };
			const aliases = readLaneSessionAliases(lane);

			expect(aliases.laneSessionId).toBeUndefined();
			expect(aliases.tmuxSessionName).toBe("orch-lane-1");
		});

		it("normalizes tmuxSessionName to laneSessionId and removes legacy key", () => {
			const lane: { laneSessionId?: unknown; tmuxSessionName?: unknown } = {
				tmuxSessionName: "orch-legacy-lane-2",
			};
			normalizeLaneSessionAlias(lane);

			expect(lane.laneSessionId).toBe("orch-legacy-lane-2");
			expect("tmuxSessionName" in lane).toBe(false);
		});

		it("preserves canonical laneSessionId when both aliases are present", () => {
			const lane: { laneSessionId?: unknown; tmuxSessionName?: unknown } = {
				laneSessionId: "lane-canonical",
				tmuxSessionName: "lane-legacy",
			};
			normalizeLaneSessionAlias(lane);

			expect(lane.laneSessionId).toBe("lane-canonical");
			expect("tmuxSessionName" in lane).toBe(false);
		});
	});
});
