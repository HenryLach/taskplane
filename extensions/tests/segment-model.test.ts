/**
 * Segment model contract tests (TP-080).
 *
 * Focus: behavioral contracts for segment IDs, plan determinism,
 * and computeWaveAssignments segment plan wiring.
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";

import { buildSegmentId, DEFAULT_ORCHESTRATOR_CONFIG } from "../taskplane/types.ts";
import { buildTaskSegmentPlans, computeWaveAssignments } from "../taskplane/waves.ts";
import type { ParsedTask } from "../taskplane/types.ts";

function makeTask(taskId: string, overrides: Partial<ParsedTask> = {}): ParsedTask {
	return {
		taskId,
		taskName: `Task ${taskId}`,
		reviewLevel: 2,
		size: "M",
		dependencies: [],
		fileScope: [],
		taskFolder: `/tasks/${taskId}`,
		promptPath: `/tasks/${taskId}/PROMPT.md`,
		areaName: "default",
		status: "pending",
		...overrides,
	};
}

describe("segment ID contract", () => {
	it("buildSegmentId uses stable <taskId>::<repoId> format", () => {
		expect(buildSegmentId("TP-100", "api")).toBe("TP-100::api");
		expect(buildSegmentId("UI-009", "web-client")).toBe("UI-009::web-client");
	});
});

describe("task segment plan determinism", () => {
	it("orders task map keys, segments, and edges deterministically", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-200", makeTask("TP-200", { resolvedRepoId: "api", fileScope: ["docs/README.md", "api/src/main.ts"] })],
			["TP-100", makeTask("TP-100", {
				explicitSegmentDag: {
					repoIds: ["web", "api"],
					edges: [
						{ fromRepoId: "web", toRepoId: "api" },
					],
				},
			})],
		]);

		const plans = buildTaskSegmentPlans(pending);
		expect([...plans.keys()]).toEqual(["TP-100", "TP-200"]);

		const explicit = plans.get("TP-100")!;
		expect(explicit.mode).toBe("explicit-dag");
		expect(explicit.segments.map((s) => s.segmentId)).toEqual([
			"TP-100::web",
			"TP-100::api",
		]);
		expect(explicit.edges.map((e) => `${e.fromSegmentId}->${e.toSegmentId}`)).toEqual([
			"TP-100::web->TP-100::api",
		]);

		const inferred = plans.get("TP-200")!;
		expect(inferred.mode).toBe("inferred-sequential");
		expect(inferred.segments.map((s) => s.segmentId)).toEqual(["TP-200::api"]);
		expect(inferred.edges).toEqual([]);
	});

	it("repo-mode guard: noisy file-scope prefixes do not create synthetic multi-repo segments", () => {
		const pending = new Map<string, ParsedTask>([
			[
				"TP-300",
				makeTask("TP-300", {
					fileScope: ["src/index.ts", "lib/util.ts", "scripts/build.mjs"],
				}),
			],
		]);

		const plans = buildTaskSegmentPlans(pending);
		const plan = plans.get("TP-300")!;
		expect(plan.mode).toBe("repo-singleton");
		expect(plan.segments.map((s) => s.segmentId)).toEqual(["TP-300::default"]);
		expect(plan.edges).toEqual([]);
	});

	it("uses declared promptRepoIds order before fallback inference", () => {
		const pending = new Map<string, ParsedTask>([
			[
				"TP-350",
				makeTask("TP-350", {
					promptRepoId: "dashboard",
					promptRepoIds: ["dashboard", "administration"],
					resolvedRepoId: "dashboard",
					fileScope: ["administration/src/view.tsx", "dashboard/src/report.ts"],
				}),
			],
		]);

		const plans = buildTaskSegmentPlans(pending, {
			workspaceRepoIds: ["dashboard", "administration"],
		});
		const plan = plans.get("TP-350")!;
		expect(plan.mode).toBe("inferred-sequential");
		expect(plan.segments.map((s) => s.repoId)).toEqual(["dashboard", "administration"]);
		expect(plan.edges.map((e) => `${e.fromSegmentId}->${e.toSegmentId}`)).toEqual([
			"TP-350::dashboard->TP-350::administration",
		]);
		expect(plan.edges.every((e) => e.reason === "prompt:execution-target-repos")).toBe(true);
	});

	it("uses dependency resolvedRepoIds order when inferring cross-repo segments", () => {
		const pending = new Map<string, ParsedTask>([
			[
				"TP-360",
				makeTask("TP-360", {
					resolvedRepoId: "dashboard",
					resolvedRepoIds: ["dashboard", "administration"],
				}),
			],
			[
				"TP-361",
				makeTask("TP-361", {
					dependencies: ["TP-360"],
				}),
			],
		]);

		const plans = buildTaskSegmentPlans(pending);
		const plan = plans.get("TP-361")!;
		expect(plan.mode).toBe("inferred-sequential");
		expect(plan.segments.map((s) => s.repoId)).toEqual(["dashboard", "administration"]);
		expect(plan.edges.map((e) => `${e.fromSegmentId}->${e.toSegmentId}`)).toEqual([
			"TP-361::dashboard->TP-361::administration",
		]);
	});
});

describe("computeWaveAssignments segment plan wiring", () => {
	it("returns segmentPlans on successful wave computation", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-400", makeTask("TP-400")],
			["TP-401", makeTask("TP-401", { dependencies: ["TP-400"] })],
		]);

		const result = computeWaveAssignments(pending, new Set<string>(), DEFAULT_ORCHESTRATOR_CONFIG);
		expect(result.errors).toEqual([]);
		expect(result.waves).toHaveLength(2);
		expect(result.segmentPlans).toBeDefined();
		expect(result.segmentPlans!.size).toBe(2);
	});

	it("accepts workspaceRepoIds to infer cross-repo file scope hints", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-450", makeTask("TP-450", {
				resolvedRepoId: "api",
				fileScope: ["api/src/service.ts", "web/src/client.ts"],
			})],
		]);

		const result = computeWaveAssignments(
			pending,
			new Set<string>(),
			DEFAULT_ORCHESTRATOR_CONFIG,
			{ workspaceRepoIds: ["api", "web"] },
		);
		expect(result.errors).toEqual([]);
		expect(result.segmentPlans).toBeDefined();
		expect(result.segmentPlans!.get("TP-450")!.segments.map((s) => s.repoId)).toEqual(["api", "web"]);
	});

	it("omits segmentPlans when graph validation fails", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-500", makeTask("TP-500", { dependencies: ["TP-501"] })],
			["TP-501", makeTask("TP-501", { dependencies: ["TP-500"] })],
		]);

		const result = computeWaveAssignments(pending, new Set<string>(), DEFAULT_ORCHESTRATOR_CONFIG);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.waves).toEqual([]);
		expect(result.segmentPlans).toBeUndefined();
	});
});
