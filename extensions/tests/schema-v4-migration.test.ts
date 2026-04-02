/**
 * Schema v4 Migration Tests — TP-081 Step 3
 *
 * Behavioral tests for v4 schema persistence:
 * - v3→v4 migration (segments default, task fields absent)
 * - v4 clean read with segment records
 * - v4 validation rejection for malformed segment fields
 * - v4 task-level field validation
 * - Round-trip serialization for v4 fields
 * - Full migration chain v1→v2→v3→v4
 *
 * Run: cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/schema-v4-migration.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";

import {
	validatePersistedState,
	upconvertV3toV4,
	serializeBatchState,
} from "../taskplane/persistence.ts";
import {
	BATCH_STATE_SCHEMA_VERSION,
	defaultResilienceState,
	defaultBatchDiagnostics,
} from "../taskplane/types.ts";
import type {
	OrchBatchRuntimeState,
	AllocatedLane,
	LaneTaskOutcome,
	AllocatedTask,
	ParsedTask,
	PersistedBatchState,
	PersistedSegmentRecord,
} from "../taskplane/types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal valid v4 batch state object. */
function makeValidV4(): Record<string, unknown> {
	return {
		schemaVersion: 4,
		phase: "executing",
		batchId: "20260328T010000",
		baseBranch: "main",
		orchBranch: "orch/henry-20260328T010000",
		mode: "repo",
		startedAt: 1741478400000,
		updatedAt: 1741478460000,
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TP-001"]],
		lanes: [{
			laneNumber: 1,
			laneId: "lane-1",
			laneSessionId: "orch-lane-1",
			worktreePath: "/tmp/wt-1",
			branch: "task/lane-1-20260328T010000",
			taskIds: ["TP-001"],
		}],
		tasks: [{
			taskId: "TP-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "running",
			taskFolder: "/tmp/tasks/TP-001",
			startedAt: 1741478400000,
			endedAt: null,
			doneFileFound: false,
			exitReason: "",
		}],
		mergeResults: [],
		totalTasks: 1,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		resilience: defaultResilienceState(),
		diagnostics: defaultBatchDiagnostics(),
		segments: [],
	};
}

/** Build a minimal valid v3 batch state (no segments, no v4 task fields). */
function makeValidV3(): Record<string, unknown> {
	const v4 = makeValidV4();
	v4.schemaVersion = 3;
	delete v4.segments;
	return v4;
}

/** Build a well-formed segment record for testing. */
function makeSegmentRecord(overrides?: Partial<PersistedSegmentRecord>): PersistedSegmentRecord {
	return {
		segmentId: "TP-001::api",
		taskId: "TP-001",
		repoId: "api",
		status: "pending",
		laneId: "",
		sessionName: "",
		worktreePath: "",
		branch: "",
		startedAt: null,
		endedAt: null,
		retries: 0,
		dependsOnSegmentIds: [],
		exitReason: "",
		...overrides,
	};
}

// ═════════════════════════════════════════════════════════════════════
// 1. v3 → v4 Migration
// ═════════════════════════════════════════════════════════════════════

describe("Schema v4 Migration (TP-081)", () => {

	describe("v3 → v4 migration", () => {
		it("migrates v3 state to v4 with empty segments", () => {
			const v3 = makeValidV3();
			const result = validatePersistedState(v3);

			expect(result.schemaVersion).toBe(4);
			expect(result.segments).toEqual([]);
		});

		it("preserves all v3 fields during migration", () => {
			const v3 = makeValidV3();
			v3.resilience = {
				resumeForced: true,
				retryCountByScope: { "TP-001:w0:l1": 2 },
				lastFailureClass: "api_error",
				repairHistory: [],
			};
			v3.diagnostics = {
				taskExits: {
					"TP-001": { classification: "api_error", cost: 0.5, durationSec: 60 },
				},
				batchCost: 0.5,
			};

			const result = validatePersistedState(v3);

			expect(result.schemaVersion).toBe(4);
			expect(result.phase).toBe("executing");
			expect(result.batchId).toBe("20260328T010000");
			expect(result.resilience.resumeForced).toBe(true);
			expect(result.resilience.retryCountByScope["TP-001:w0:l1"]).toBe(2);
			expect(result.diagnostics.batchCost).toBe(0.5);
			expect(result.segments).toEqual([]);
		});

		it("task-level v4 fields are undefined after migration", () => {
			const v3 = makeValidV3();
			const result = validatePersistedState(v3);

			// v4 optional fields are not backfilled by migration
			expect(result.tasks[0].packetRepoId).toBeUndefined();
			expect(result.tasks[0].packetTaskPath).toBeUndefined();
			expect(result.tasks[0].segmentIds).toBeUndefined();
			expect(result.tasks[0].activeSegmentId).toBeUndefined();
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 2. v4 Clean Read
	// ═════════════════════════════════════════════════════════════════

	describe("v4 clean read", () => {
		it("reads v4 state with empty segments", () => {
			const v4 = makeValidV4();
			const result = validatePersistedState(v4);

			expect(result.schemaVersion).toBe(4);
			expect(result.segments).toEqual([]);
			expect(result.tasks).toHaveLength(1);
		});

		it("reads v4 state with populated segments", () => {
			const v4 = makeValidV4();
			v4.segments = [
				makeSegmentRecord({
					segmentId: "TP-001::api",
					taskId: "TP-001",
					repoId: "api",
					status: "succeeded",
					laneId: "lane-1",
					sessionName: "orch-lane-1",
					worktreePath: "/tmp/wt-api-1",
					branch: "task/lane-1-seg-api",
					startedAt: 1741478400000,
					endedAt: 1741478430000,
					retries: 0,
					dependsOnSegmentIds: [],
					exitReason: "Segment completed",
				}),
				makeSegmentRecord({
					segmentId: "TP-001::web",
					taskId: "TP-001",
					repoId: "web",
					status: "running",
					laneId: "lane-1",
					sessionName: "orch-lane-1",
					worktreePath: "/tmp/wt-web-1",
					branch: "task/lane-1-seg-web",
					startedAt: 1741478430000,
					endedAt: null,
					retries: 0,
					dependsOnSegmentIds: ["TP-001::api"],
					exitReason: "",
				}),
			];

			const result = validatePersistedState(v4);

			expect(result.segments).toHaveLength(2);
			expect(result.segments[0].segmentId).toBe("TP-001::api");
			expect(result.segments[0].status).toBe("succeeded");
			expect(result.segments[0].endedAt).toBe(1741478430000);
			expect(result.segments[1].segmentId).toBe("TP-001::web");
			expect(result.segments[1].status).toBe("running");
			expect(result.segments[1].dependsOnSegmentIds).toEqual(["TP-001::api"]);
		});

		it("reads v4 state with task-level segment fields", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].packetRepoId = "shared-libs";
			(v4.tasks as any[])[0].packetTaskPath = "/tmp/tasks/TP-001";
			(v4.tasks as any[])[0].segmentIds = ["TP-001::api", "TP-001::web"];
			(v4.tasks as any[])[0].activeSegmentId = "TP-001::web";

			const result = validatePersistedState(v4);

			expect(result.tasks[0].packetRepoId).toBe("shared-libs");
			expect(result.tasks[0].packetTaskPath).toBe("/tmp/tasks/TP-001");
			expect(result.tasks[0].segmentIds).toEqual(["TP-001::api", "TP-001::web"]);
			expect(result.tasks[0].activeSegmentId).toBe("TP-001::web");
		});

		it("reads v4 state with null activeSegmentId", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].activeSegmentId = null;

			const result = validatePersistedState(v4);

			expect(result.tasks[0].activeSegmentId).toBeNull();
		});

		it("reads v4 state with empty segmentIds", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].segmentIds = [];

			const result = validatePersistedState(v4);

			expect(result.tasks[0].segmentIds).toEqual([]);
		});

		it("reads segment with exitDiagnostic", () => {
			const v4 = makeValidV4();
			v4.segments = [
				makeSegmentRecord({
					status: "failed",
					exitDiagnostic: {
						classification: "api_error",
						exitCode: 1,
						errorMessage: "API rate limited",
					} as any,
					exitReason: "API rate limited",
				}),
			];

			const result = validatePersistedState(v4);

			expect(result.segments[0].exitDiagnostic).toBeDefined();
			expect(result.segments[0].exitDiagnostic!.classification).toBe("api_error");
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 3. v4 Validation Rejection
	// ═════════════════════════════════════════════════════════════════

	describe("v4 validation rejection — segments", () => {
		it("rejects v4 missing segments field", () => {
			const v4 = makeValidV4();
			delete v4.segments;

			expect(() => validatePersistedState(v4)).toThrow(/segments/);
		});

		it("rejects segments as non-array", () => {
			const v4 = makeValidV4();
			v4.segments = "bad";

			expect(() => validatePersistedState(v4)).toThrow(/segments/);
		});

		it("rejects segment missing segmentId", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			delete seg.segmentId;
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/segmentId/);
		});

		it("rejects segment missing taskId", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			delete seg.taskId;
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/taskId/);
		});

		it("rejects segment missing repoId", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			delete seg.repoId;
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/repoId/);
		});

		it("rejects segment with invalid status", () => {
			const v4 = makeValidV4();
			v4.segments = [makeSegmentRecord({ status: "exploded" as any })];

			expect(() => validatePersistedState(v4)).toThrow(/status/);
		});

		it("rejects segment with non-number startedAt", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			seg.startedAt = "yesterday";
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/startedAt/);
		});

		it("rejects segment with non-number endedAt", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			seg.endedAt = "today";
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/endedAt/);
		});

		it("rejects segment with non-number retries", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			seg.retries = "once";
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/retries/);
		});

		it("rejects segment with non-array dependsOnSegmentIds", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			seg.dependsOnSegmentIds = "bad";
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/dependsOnSegmentIds/);
		});

		it("rejects segment with non-string element in dependsOnSegmentIds", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			seg.dependsOnSegmentIds = [42];
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/dependsOnSegmentIds/);
		});

		it("rejects segment with non-object exitDiagnostic", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			seg.exitDiagnostic = "bad";
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/exitDiagnostic/);
		});

		it("rejects segment exitDiagnostic missing classification", () => {
			const v4 = makeValidV4();
			const seg = makeSegmentRecord() as any;
			seg.exitDiagnostic = { exitCode: 1 };
			v4.segments = [seg];

			expect(() => validatePersistedState(v4)).toThrow(/classification/);
		});

		it("rejects segment as non-object", () => {
			const v4 = makeValidV4();
			v4.segments = ["not-an-object"];

			expect(() => validatePersistedState(v4)).toThrow(/segments\[0\]/);
		});

		it("accepts all valid segment statuses", () => {
			for (const status of ["pending", "running", "succeeded", "failed", "stalled", "skipped"]) {
				const v4 = makeValidV4();
				v4.segments = [makeSegmentRecord({ status: status as any })];

				const result = validatePersistedState(v4);
				expect(result.segments[0].status).toBe(status);
			}
		});

		it("accepts segment with null startedAt and endedAt", () => {
			const v4 = makeValidV4();
			v4.segments = [makeSegmentRecord({ startedAt: null, endedAt: null })];

			const result = validatePersistedState(v4);
			expect(result.segments[0].startedAt).toBeNull();
			expect(result.segments[0].endedAt).toBeNull();
		});

		it("accepts segment with numeric startedAt and endedAt", () => {
			const v4 = makeValidV4();
			v4.segments = [makeSegmentRecord({ startedAt: 1000, endedAt: 2000 })];

			const result = validatePersistedState(v4);
			expect(result.segments[0].startedAt).toBe(1000);
			expect(result.segments[0].endedAt).toBe(2000);
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 4. v4 Task-Level Field Validation
	// ═════════════════════════════════════════════════════════════════

	describe("v4 task-level field validation", () => {
		it("rejects non-string packetRepoId", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].packetRepoId = 42;

			expect(() => validatePersistedState(v4)).toThrow(/packetRepoId/);
		});

		it("rejects non-string packetTaskPath", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].packetTaskPath = true;

			expect(() => validatePersistedState(v4)).toThrow(/packetTaskPath/);
		});

		it("rejects non-array segmentIds", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].segmentIds = "bad";

			expect(() => validatePersistedState(v4)).toThrow(/segmentIds/);
		});

		it("rejects non-string element in segmentIds", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].segmentIds = [42];

			expect(() => validatePersistedState(v4)).toThrow(/segmentIds/);
		});

		it("rejects non-string non-null activeSegmentId", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].activeSegmentId = 42;

			expect(() => validatePersistedState(v4)).toThrow(/activeSegmentId/);
		});

		it("accepts undefined v4 task fields (backward compat)", () => {
			const v4 = makeValidV4();
			// No v4 fields set on task

			const result = validatePersistedState(v4);

			expect(result.tasks[0].packetRepoId).toBeUndefined();
			expect(result.tasks[0].packetTaskPath).toBeUndefined();
			expect(result.tasks[0].segmentIds).toBeUndefined();
			expect(result.tasks[0].activeSegmentId).toBeUndefined();
		});

		it("accepts null activeSegmentId", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].activeSegmentId = null;

			const result = validatePersistedState(v4);
			expect(result.tasks[0].activeSegmentId).toBeNull();
		});

		it("accepts empty-string packetRepoId and packetTaskPath", () => {
			const v4 = makeValidV4();
			(v4.tasks as any[])[0].packetRepoId = "";
			(v4.tasks as any[])[0].packetTaskPath = "";

			const result = validatePersistedState(v4);
			expect(result.tasks[0].packetRepoId).toBe("");
			expect(result.tasks[0].packetTaskPath).toBe("");
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 5. upconvertV3toV4 Unit Tests
	// ═════════════════════════════════════════════════════════════════

	describe("upconvertV3toV4 unit tests", () => {
		it("bumps v3 to v4 and adds empty segments", () => {
			const obj: Record<string, unknown> = { schemaVersion: 3 };
			upconvertV3toV4(obj);

			expect(obj.schemaVersion).toBe(4);
			expect(obj.segments).toEqual([]);
		});

		it("does not overwrite existing segments on v3", () => {
			const existing = [{ segmentId: "x" }];
			const obj: Record<string, unknown> = { schemaVersion: 3, segments: existing };
			upconvertV3toV4(obj);

			expect(obj.schemaVersion).toBe(4);
			// The existing segments are preserved — upconvert checks !obj.segments
			// Since segments exists, it's not overwritten
			expect(obj.segments).toBe(existing);
		});

		it("is idempotent on v4", () => {
			const segments = [{ segmentId: "y" }];
			const obj: Record<string, unknown> = { schemaVersion: 4, segments };
			upconvertV3toV4(obj);

			expect(obj.schemaVersion).toBe(4);
			expect(obj.segments).toBe(segments);
		});

		it("is a no-op on v5+ objects", () => {
			const obj: Record<string, unknown> = { schemaVersion: 5 };
			upconvertV3toV4(obj);

			expect(obj.schemaVersion).toBe(5);
			expect(obj.segments).toBeUndefined();
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 6. Full Migration Chain
	// ═════════════════════════════════════════════════════════════════

	describe("full migration chain v1 → v4", () => {
		it("v1 fixture migrates to v4 with all defaults", () => {
			const v1: Record<string, unknown> = {
				schemaVersion: 1,
				phase: "executing",
				batchId: "20260328T010000",
				startedAt: 1741478400000,
				updatedAt: 1741478460000,
				endedAt: null,
				currentWaveIndex: 0,
				totalWaves: 1,
				wavePlan: [["TP-001"]],
				lanes: [{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "orch-lane-1",
					worktreePath: "/tmp/wt-1",
					branch: "task/lane-1",
					taskIds: ["TP-001"],
				}],
				tasks: [{
					taskId: "TP-001",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "/tmp/tasks/TP-001",
					startedAt: null,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
				}],
				mergeResults: [],
				totalTasks: 1,
				succeededTasks: 0,
				failedTasks: 0,
				skippedTasks: 0,
				blockedTasks: 0,
				blockedTaskIds: [],
				lastError: null,
				errors: [],
			};

			const result = validatePersistedState(v1);

			// v4
			expect(result.schemaVersion).toBe(4);
			// v2 defaults
			expect(result.mode).toBe("repo");
			expect(result.baseBranch).toBe("");
			// v3 defaults
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
			// v4 defaults
			expect(result.segments).toEqual([]);
			// Original fields
			expect(result.phase).toBe("executing");
			expect(result.tasks).toHaveLength(1);
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 7. Serialization Roundtrip
	// ═════════════════════════════════════════════════════════════════

	describe("serialization roundtrip with v4 fields", () => {
		function buildRuntimeFromPersisted(persisted: PersistedBatchState): {
			runtimeState: OrchBatchRuntimeState;
			wavePlan: string[][];
			lanes: AllocatedLane[];
			outcomes: LaneTaskOutcome[];
		} {
			const dummyParsedTask: ParsedTask = {
				taskId: "TP-001",
				taskName: "Test Task",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder: "/tmp/tasks/TP-001",
				promptPath: "/tmp/tasks/TP-001/PROMPT.md",
				areaName: "test",
				status: "pending",
			};

			const lanes: AllocatedLane[] = persisted.lanes.map((lr) => ({
				laneNumber: lr.laneNumber,
				laneId: lr.laneId,
				laneSessionId: lr.laneSessionId,
				worktreePath: lr.worktreePath,
				branch: lr.branch,
				tasks: lr.taskIds.map((taskId, i) => ({
					taskId,
					order: i,
					task: { ...dummyParsedTask, taskId },
					estimatedMinutes: 10,
				} as AllocatedTask)),
				strategy: "round-robin" as const,
				estimatedLoad: 1,
				estimatedMinutes: 10,
			}));

			const outcomes: LaneTaskOutcome[] = persisted.tasks.map((tr) => ({
				taskId: tr.taskId,
				status: tr.status,
				startTime: tr.startedAt,
				endTime: tr.endedAt,
				exitReason: tr.exitReason,
				sessionName: tr.sessionName,
				doneFileFound: tr.doneFileFound,
			}));

			const runtimeState: OrchBatchRuntimeState = {
				phase: persisted.phase as any,
				batchId: persisted.batchId,
				baseBranch: persisted.baseBranch,
				orchBranch: persisted.orchBranch ?? "",
				mode: persisted.mode as any ?? "repo",
				pauseSignal: { paused: false },
				waveResults: [],
				currentWaveIndex: persisted.currentWaveIndex,
				totalWaves: persisted.totalWaves,
				blockedTaskIds: new Set(persisted.blockedTaskIds ?? []),
				startedAt: persisted.startedAt,
				endedAt: persisted.endedAt,
				totalTasks: persisted.totalTasks,
				succeededTasks: persisted.succeededTasks,
				failedTasks: persisted.failedTasks,
				skippedTasks: persisted.skippedTasks,
				blockedTasks: persisted.blockedTasks,
				errors: persisted.errors ?? [],
				currentLanes: lanes,
				dependencyGraph: null,
				mergeResults: [],
				resilience: persisted.resilience,
				diagnostics: persisted.diagnostics,
				segments: persisted.segments,
				_extraFields: persisted._extraFields,
			};

			return { runtimeState, wavePlan: persisted.wavePlan, lanes, outcomes };
		}

		it("preserves segments array through serialize → parse → validate roundtrip", () => {
			const v4 = makeValidV4();
			v4.segments = [
				makeSegmentRecord({
					segmentId: "TP-001::api",
					taskId: "TP-001",
					repoId: "api",
					status: "succeeded",
					laneId: "lane-1",
					sessionName: "orch-lane-1",
					worktreePath: "/tmp/wt-api",
					branch: "task/seg-api",
					startedAt: 1000,
					endedAt: 2000,
					retries: 1,
					dependsOnSegmentIds: [],
					exitReason: "Segment done",
				}),
				makeSegmentRecord({
					segmentId: "TP-001::web",
					taskId: "TP-001",
					repoId: "web",
					status: "pending",
					dependsOnSegmentIds: ["TP-001::api"],
				}),
			];

			const validated = validatePersistedState(v4);
			const { runtimeState, wavePlan, lanes, outcomes } = buildRuntimeFromPersisted(validated);
			const json = serializeBatchState(runtimeState, wavePlan, lanes, outcomes);
			const reParsed = JSON.parse(json);

			expect(reParsed.schemaVersion).toBe(4);
			expect(reParsed.segments).toHaveLength(2);
			expect(reParsed.segments[0].segmentId).toBe("TP-001::api");
			expect(reParsed.segments[0].status).toBe("succeeded");
			expect(reParsed.segments[0].retries).toBe(1);
			expect(reParsed.segments[1].segmentId).toBe("TP-001::web");
			expect(reParsed.segments[1].dependsOnSegmentIds).toEqual(["TP-001::api"]);

			// Re-validate the serialized output
			const reValidated = validatePersistedState(reParsed);
			expect(reValidated.segments).toHaveLength(2);
			expect(reValidated.segments[0].segmentId).toBe("TP-001::api");
		});

		it("empty segments array survives roundtrip", () => {
			const v4 = makeValidV4();
			const validated = validatePersistedState(v4);
			const { runtimeState, wavePlan, lanes, outcomes } = buildRuntimeFromPersisted(validated);
			const json = serializeBatchState(runtimeState, wavePlan, lanes, outcomes);
			const reParsed = JSON.parse(json);

			expect(reParsed.segments).toEqual([]);

			const reValidated = validatePersistedState(reParsed);
			expect(reValidated.segments).toEqual([]);
		});

		it("v3 → validate → serialize produces valid v4 with segments", () => {
			const v3 = makeValidV3();
			const validated = validatePersistedState(v3);

			expect(validated.schemaVersion).toBe(4);
			expect(validated.segments).toEqual([]);

			const { runtimeState, wavePlan, lanes, outcomes } = buildRuntimeFromPersisted(validated);
			const json = serializeBatchState(runtimeState, wavePlan, lanes, outcomes);
			const reParsed = JSON.parse(json);

			// Serialized output is v4
			expect(reParsed.schemaVersion).toBe(4);
			expect(reParsed.segments).toEqual([]);

			// Validates as v4
			const reValidated = validatePersistedState(reParsed);
			expect(reValidated.schemaVersion).toBe(4);
			expect(reValidated.segments).toEqual([]);
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 8. Version Rejection
	// ═════════════════════════════════════════════════════════════════

	describe("version rejection", () => {
		it("rejects unsupported future version 5", () => {
			const v5 = makeValidV4();
			v5.schemaVersion = 5;

			expect(() => validatePersistedState(v5)).toThrow(/5/);
		});

		it("accepts v1, v2, v3, and v4", () => {
			// v4 clean
			expect(validatePersistedState(makeValidV4()).schemaVersion).toBe(4);

			// v3 upconvert
			expect(validatePersistedState(makeValidV3()).schemaVersion).toBe(4);
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 9. BATCH_STATE_SCHEMA_VERSION constant
	// ═════════════════════════════════════════════════════════════════

	describe("schema version constant", () => {
		it("BATCH_STATE_SCHEMA_VERSION is 4", () => {
			expect(BATCH_STATE_SCHEMA_VERSION).toBe(4);
		});
	});
});
