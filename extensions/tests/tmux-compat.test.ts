import { describe, it } from "node:test";
import { expect } from "./expect.ts";

import {
	classifySpawnModeCompatibility,
	formatSpawnModeTmuxDeprecation,
	normalizeLaneSessionAlias,
	normalizeSessionPrefixAlias,
	readLaneSessionAliases,
	resolveSessionPrefixAlias,
} from "../taskplane/tmux-compat.ts";

describe("tmux compatibility shim", () => {
	describe("session prefix alias", () => {
		it("resolves canonical sessionPrefix ahead of legacy tmuxPrefix", () => {
			expect(resolveSessionPrefixAlias("canonical", "legacy")).toBe("canonical");
		});

		it("falls back to legacy tmuxPrefix when canonical missing", () => {
			expect(resolveSessionPrefixAlias(undefined, "legacy")).toBe("legacy");
		});

		it("normalizes tmuxPrefix in place and deletes legacy key", () => {
			const raw: { sessionPrefix?: unknown; tmuxPrefix?: unknown } = { tmuxPrefix: "orch" };
			normalizeSessionPrefixAlias(raw);

			expect(raw.sessionPrefix).toBe("orch");
			expect("tmuxPrefix" in raw).toBe(false);
		});

		it("keeps canonical sessionPrefix when both canonical and legacy are present", () => {
			const raw: { sessionPrefix?: unknown; tmuxPrefix?: unknown } = {
				sessionPrefix: "canon",
				tmuxPrefix: "legacy",
			};
			normalizeSessionPrefixAlias(raw);

			expect(raw.sessionPrefix).toBe("canon");
			expect("tmuxPrefix" in raw).toBe(false);
		});
	});

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

	describe("spawnMode legacy classification", () => {
		it("classifies subprocess as supported non-legacy", () => {
			expect(classifySpawnModeCompatibility("subprocess")).toEqual({
				value: "subprocess",
				isSupported: true,
				isLegacyTmux: false,
			});
		});

		it("classifies tmux as supported legacy mode", () => {
			expect(classifySpawnModeCompatibility("tmux")).toEqual({
				value: "tmux",
				isSupported: true,
				isLegacyTmux: true,
			});
		});

		it("classifies unknown values as unsupported", () => {
			expect(classifySpawnModeCompatibility("other")).toEqual({
				isSupported: false,
				isLegacyTmux: false,
			});
		});

		it("formats canonical deprecation message", () => {
			const message = formatSpawnModeTmuxDeprecation([
				"orchestrator.orchestrator.spawnMode",
				"taskRunner.worker.spawnMode",
			]);
			expect(message).toContain("spawn_mode \"tmux\" is legacy-only under Runtime V2");
			expect(message).toContain("Use \"subprocess\" instead");
			expect(message).toContain("orchestrator.orchestrator.spawnMode, taskRunner.worker.spawnMode");
		});
	});
});
