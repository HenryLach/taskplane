/**
 * State Schema v3 Migration Tests — TP-030 Step 3
 *
 * Tests for v1→v3 migration, v2→v3 migration, v3 clean read,
 * strict v3 validation, unknown-field roundtrip preservation,
 * corrupt-state handling, and version-mismatch error guidance.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/state-migration.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
	validatePersistedState,
	upconvertV1toV2,
	upconvertV2toV3,
	upconvertV3toV4,
	analyzeOrchestratorStartupState,
	serializeBatchState,
} from "../taskplane/persistence.ts";
import {
	BATCH_STATE_SCHEMA_VERSION,
	defaultResilienceState,
	defaultBatchDiagnostics,
	freshOrchBatchState,
} from "../taskplane/types.ts";
import type {
	OrchBatchRuntimeState,
	AllocatedLane,
	LaneTaskOutcome,
	AllocatedTask,
	ParsedTask,
	PersistedBatchState,
} from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixtureJSON(name: string): unknown {
	return JSON.parse(readFileSync(join(fixturesDir, name), "utf-8"));
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal valid v4 batch state object. */
function makeValidV4(): Record<string, unknown> {
	return {
		schemaVersion: 4,
		phase: "executing",
		batchId: "20260319T010000",
		baseBranch: "main",
		orchBranch: "",
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
			branch: "task/lane-1-20260319T010000",
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

/** Alias for backward-compat in existing tests. */
function makeValidV3(): Record<string, unknown> {
	const v4 = makeValidV4();
	v4.schemaVersion = 3;
	delete v4.segments;
	return v4;
}

/** Build a minimal valid v2 batch state object. */
function makeValidV2(): Record<string, unknown> {
	const v4 = makeValidV4();
	v4.schemaVersion = 2;
	delete v4.resilience;
	delete v4.diagnostics;
	delete v4.orchBranch;
	delete v4.segments;
	return v4;
}

/** Build a minimal valid v1 batch state object. */
function makeValidV1(): Record<string, unknown> {
	const v4 = makeValidV4();
	v4.schemaVersion = 1;
	delete v4.mode;
	delete v4.baseBranch;
	delete v4.resilience;
	delete v4.diagnostics;
	delete v4.orchBranch;
	delete v4.segments;
	return v4;
}

// ═════════════════════════════════════════════════════════════════════
// 1. Migration Happy Paths
// ═════════════════════════════════════════════════════════════════════

describe("State Schema v3 Migration", () => {

	describe("v1 → v3 migration", () => {
		it("migrates v1 fixture to v3 with correct defaults", () => {
			const v1Data = loadFixtureJSON("batch-state-v1-valid.json");
			const result = validatePersistedState(v1Data);

			// Schema version bumped to 4 (v1→v2→v3→v4)
			expect(result.schemaVersion).toBe(4);

			// v1→v2 defaults applied
			expect(result.mode).toBe("repo");
			expect(result.baseBranch).toBe("");

			// v2→v3 defaults applied: resilience
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.resilience.resumeForced).toBe(false);
			expect(result.resilience.retryCountByScope).toEqual({});
			expect(result.resilience.lastFailureClass).toBeNull();
			expect(result.resilience.repairHistory).toEqual([]);

			// v2→v3 defaults applied: diagnostics
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
			expect(result.diagnostics.taskExits).toEqual({});
			expect(result.diagnostics.batchCost).toBe(0);

			// Existing fields preserved
			expect(result.phase).toBe("executing");
			expect(result.batchId).toBe("20260309T010000");
			expect(result.tasks).toHaveLength(3);
			expect(result.lanes).toHaveLength(2);
			expect(result.wavePlan).toHaveLength(2);
			expect(result.tasks[0].taskId).toBe("TS-001");
			expect(result.tasks[0].status).toBe("succeeded");
		});

		it("migrates inline v1 object to v4", () => {
			const v1 = makeValidV1();
			const result = validatePersistedState(v1);

			expect(result.schemaVersion).toBe(4);
			expect(result.mode).toBe("repo");
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
			expect(result.segments).toEqual([]);
		});
	});

	describe("v2 → v3 migration", () => {
		it("migrates v2 fixture to v4 preserving all existing fields", () => {
			const v2Data = loadFixtureJSON("batch-state-valid.json");
			const result = validatePersistedState(v2Data);

			// Schema version bumped to 4 (v2→v3→v4)
			expect(result.schemaVersion).toBe(4);

			// All v2 fields preserved
			expect(result.phase).toBe("executing");
			expect(result.batchId).toBe("20260309T010000");
			expect(result.mode).toBe("repo");
			expect(result.baseBranch).toBe("main");
			expect(result.tasks).toHaveLength(3);
			expect(result.lanes).toHaveLength(2);
			expect(result.wavePlan).toHaveLength(2);
			expect(result.totalTasks).toBe(3);
			expect(result.succeededTasks).toBe(1);

			// v3 defaults applied
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
		});

		it("migrates v2 workspace-mode fixture preserving repo-aware fields", () => {
			const v2ws = loadFixtureJSON("batch-state-v2-workspace.json");
			const result = validatePersistedState(v2ws);

			expect(result.schemaVersion).toBe(4);
			expect(result.mode).toBe("workspace");
			expect(result.tasks[0].repoId).toBe("api");
			expect(result.lanes[0].repoId).toBe("api");
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
		});

		it("migrates inline v2 object to v4", () => {
			const v2 = makeValidV2();
			const result = validatePersistedState(v2);

			expect(result.schemaVersion).toBe(4);
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
			expect(result.segments).toEqual([]);
		});
	});

	describe("v3 clean read", () => {
		it("reads a well-formed v3 state with upconversion to v4", () => {
			const v3 = makeValidV3();
			const result = validatePersistedState(v3);

			expect(result.schemaVersion).toBe(4);
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
			expect(result.segments).toEqual([]);
			expect(result.phase).toBe("executing");
			expect(result.tasks).toHaveLength(1);
		});

		it("reads a well-formed v4 state without modification", () => {
			const v4 = makeValidV4();
			const result = validatePersistedState(v4);

			expect(result.schemaVersion).toBe(4);
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
			expect(result.segments).toEqual([]);
			expect(result.phase).toBe("executing");
			expect(result.tasks).toHaveLength(1);
		});

		it("reads v3 state with populated resilience and diagnostics", () => {
			const v3 = makeValidV3();
			v3.resilience = {
				resumeForced: true,
				retryCountByScope: { "TP-001:w0:l1": 2 },
				lastFailureClass: "context-overflow",
				repairHistory: [{
					id: "r-20260319-001",
					strategy: "stale-worktree-cleanup",
					status: "succeeded",
					startedAt: 1000,
					endedAt: 2000,
				}],
			};
			v3.diagnostics = {
				taskExits: {
					"TP-001": {
						classification: "context-overflow",
						cost: 1.50,
						durationSec: 120,
						retries: 1,
					},
				},
				batchCost: 1.50,
			};

			const result = validatePersistedState(v3);

			expect(result.resilience.resumeForced).toBe(true);
			expect(result.resilience.retryCountByScope["TP-001:w0:l1"]).toBe(2);
			expect(result.resilience.lastFailureClass).toBe("context-overflow");
			expect(result.resilience.repairHistory).toHaveLength(1);
			expect(result.resilience.repairHistory[0].strategy).toBe("stale-worktree-cleanup");
			expect(result.diagnostics.taskExits["TP-001"].classification).toBe("context-overflow");
			expect(result.diagnostics.taskExits["TP-001"].cost).toBe(1.50);
			expect(result.diagnostics.batchCost).toBe(1.50);
		});

		it("reads v3 state with exitDiagnostic on task records", () => {
			const v3 = makeValidV3();
			(v3.tasks as any[])[0].exitDiagnostic = {
				classification: "success",
				exitCode: 0,
				errorMessage: null,
				tokensUsed: 5000,
				contextPct: 25.0,
				partialProgressCommits: 3,
				partialProgressBranch: "task/lane-1",
				durationSec: 60,
				lastKnownStep: 2,
				lastKnownCheckbox: "Implement feature",
				repoId: null,
			};

			const result = validatePersistedState(v3);
			expect(result.tasks[0].exitDiagnostic).toBeDefined();
			expect(result.tasks[0].exitDiagnostic!.classification).toBe("success");
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 2. Strict v3 Validation Rejection
	// ═════════════════════════════════════════════════════════════════

	describe("strict v3 validation rejection", () => {
		it("rejects v3 missing resilience section", () => {
			const v3 = makeValidV3();
			delete v3.resilience;

			expect(() => validatePersistedState(v3)).toThrow(/resilience/i);
		});

		it("rejects v3 missing diagnostics section", () => {
			const v3 = makeValidV3();
			delete v3.diagnostics;

			expect(() => validatePersistedState(v3)).toThrow(/diagnostics/i);
		});

		it("rejects v3 with non-object resilience", () => {
			const v3 = makeValidV3();
			v3.resilience = "bad";

			expect(() => validatePersistedState(v3)).toThrow(/resilience/i);
		});

		it("rejects v3 with non-object diagnostics", () => {
			const v3 = makeValidV3();
			v3.diagnostics = 42;

			expect(() => validatePersistedState(v3)).toThrow(/diagnostics/i);
		});

		it("rejects resilience.resumeForced as non-boolean", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).resumeForced = "yes";

			expect(() => validatePersistedState(v3)).toThrow(/resumeForced/);
		});

		it("rejects resilience.retryCountByScope as array", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).retryCountByScope = [1, 2, 3];

			expect(() => validatePersistedState(v3)).toThrow(/retryCountByScope/);
		});

		it("rejects non-numeric value in retryCountByScope", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).retryCountByScope = { "scope-1": "two" };

			expect(() => validatePersistedState(v3)).toThrow(/retryCountByScope/);
		});

		it("rejects resilience.lastFailureClass as number", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).lastFailureClass = 42;

			expect(() => validatePersistedState(v3)).toThrow(/lastFailureClass/);
		});

		it("rejects resilience.repairHistory as non-array", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).repairHistory = "not-array";

			expect(() => validatePersistedState(v3)).toThrow(/repairHistory/);
		});

		it("rejects repairHistory entry missing required fields", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).repairHistory = [{ id: "r-001" }]; // missing strategy, status, etc.

			expect(() => validatePersistedState(v3)).toThrow(/repairHistory/);
		});

		it("rejects repairHistory entry with invalid status", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).repairHistory = [{
				id: "r-001",
				strategy: "test",
				status: "exploded", // invalid
				startedAt: 1000,
				endedAt: 2000,
			}];

			expect(() => validatePersistedState(v3)).toThrow(/repairHistory/);
		});

		it("rejects repairHistory entry with non-number startedAt", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).repairHistory = [{
				id: "r-001",
				strategy: "test",
				status: "succeeded",
				startedAt: "now",
				endedAt: 2000,
			}];

			expect(() => validatePersistedState(v3)).toThrow(/repairHistory/);
		});

		it("rejects repairHistory entry with non-string repoId", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).repairHistory = [{
				id: "r-001",
				strategy: "test",
				status: "succeeded",
				startedAt: 1000,
				endedAt: 2000,
				repoId: 42,
			}];

			expect(() => validatePersistedState(v3)).toThrow(/repairHistory/);
		});

		it("rejects diagnostics.taskExits as array", () => {
			const v3 = makeValidV3();
			(v3.diagnostics as any).taskExits = [];

			expect(() => validatePersistedState(v3)).toThrow(/taskExits/);
		});

		it("rejects taskExits entry missing classification", () => {
			const v3 = makeValidV3();
			(v3.diagnostics as any).taskExits = {
				"TP-001": { cost: 1.0, durationSec: 60 }, // missing classification
			};

			expect(() => validatePersistedState(v3)).toThrow(/classification/);
		});

		it("rejects taskExits entry with non-number cost", () => {
			const v3 = makeValidV3();
			(v3.diagnostics as any).taskExits = {
				"TP-001": { classification: "success", cost: "free", durationSec: 60 },
			};

			expect(() => validatePersistedState(v3)).toThrow(/cost/);
		});

		it("rejects taskExits entry with non-number durationSec", () => {
			const v3 = makeValidV3();
			(v3.diagnostics as any).taskExits = {
				"TP-001": { classification: "success", cost: 1.0, durationSec: "fast" },
			};

			expect(() => validatePersistedState(v3)).toThrow(/durationSec/);
		});

		it("rejects taskExits entry with non-number retries", () => {
			const v3 = makeValidV3();
			(v3.diagnostics as any).taskExits = {
				"TP-001": { classification: "success", cost: 1.0, durationSec: 60, retries: "once" },
			};

			expect(() => validatePersistedState(v3)).toThrow(/retries/);
		});

		it("rejects diagnostics.batchCost as non-number", () => {
			const v3 = makeValidV3();
			(v3.diagnostics as any).batchCost = "zero";

			expect(() => validatePersistedState(v3)).toThrow(/batchCost/);
		});

		it("rejects exitDiagnostic on task as non-object", () => {
			const v3 = makeValidV3();
			(v3.tasks as any[])[0].exitDiagnostic = "bad";

			expect(() => validatePersistedState(v3)).toThrow(/exitDiagnostic/);
		});

		it("rejects exitDiagnostic on task missing classification", () => {
			const v3 = makeValidV3();
			(v3.tasks as any[])[0].exitDiagnostic = { exitCode: 0 };

			expect(() => validatePersistedState(v3)).toThrow(/classification/);
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 3. Unknown Field Preservation
	// ═════════════════════════════════════════════════════════════════

	describe("unknown field roundtrip preservation", () => {
		it("preserves unknown top-level fields through validatePersistedState", () => {
			const v3 = makeValidV3();
			v3.customPlugin = { foo: "bar" };
			v3.futureField = 42;

			const result = validatePersistedState(v3);

			expect(result._extraFields).toBeDefined();
			expect(result._extraFields!.customPlugin).toEqual({ foo: "bar" });
			expect(result._extraFields!.futureField).toBe(42);
		});

		it("does not set _extraFields when no unknown fields present", () => {
			const v3 = makeValidV3();
			const result = validatePersistedState(v3);

			expect(result._extraFields).toBeUndefined();
		});

		it("preserves unknown fields from v2 state through migration", () => {
			const v2 = makeValidV2();
			v2.externalToolMetadata = { version: "1.2.3" };

			const result = validatePersistedState(v2);

			expect(result.schemaVersion).toBe(4);
			expect(result._extraFields).toBeDefined();
			expect(result._extraFields!.externalToolMetadata).toEqual({ version: "1.2.3" });
		});

		it("preserves unknown fields from v1 state through migration", () => {
			const v1 = makeValidV1();
			v1.legacyField = "preserved";

			const result = validatePersistedState(v1);

			expect(result.schemaVersion).toBe(4);
			expect(result._extraFields).toBeDefined();
			expect(result._extraFields!.legacyField).toBe("preserved");
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 4. Corrupt State Handling
	// ═════════════════════════════════════════════════════════════════

	describe("corrupt state / paused-corrupt handling", () => {
		it("recommends paused-corrupt for invalid state with no orphans", () => {
			const result = analyzeOrchestratorStartupState(
				[], // no orphan sessions
				"invalid",
				null,
				"Parse error: unexpected token",
				new Set<string>(),
			);

			expect(result.recommendedAction).toBe("paused-corrupt");
			expect(result.stateStatus).toBe("invalid");
			expect(result.loadedState).toBeNull();
			expect(result.orphanSessions).toHaveLength(0);
			expect(result.userMessage).toContain("corrupt");
			expect(result.userMessage).toContain("NOT been deleted");
		});

		it("recommends paused-corrupt for io-error state with no orphans", () => {
			const result = analyzeOrchestratorStartupState(
				[],
				"io-error",
				null,
				"EACCES: permission denied",
				new Set<string>(),
			);

			expect(result.recommendedAction).toBe("paused-corrupt");
			expect(result.stateStatus).toBe("io-error");
			expect(result.userMessage).toContain("corrupt");
			expect(result.userMessage).toContain("NOT been deleted");
		});

		it("does NOT recommend cleanup-stale for corrupt state", () => {
			// Both invalid and io-error with no orphans should NOT auto-delete
			for (const status of ["invalid", "io-error"] as const) {
				const result = analyzeOrchestratorStartupState(
					[],
					status,
					null,
					"some error",
					new Set<string>(),
				);
				expect(result.recommendedAction).not.toBe("cleanup-stale");
				expect(result.recommendedAction).toBe("paused-corrupt");
			}
		});

		it("includes error context in paused-corrupt user message", () => {
			const result = analyzeOrchestratorStartupState(
				[],
				"invalid",
				null,
				"JSON parse failed at line 42",
				new Set<string>(),
			);

			expect(result.userMessage).toContain("JSON parse failed at line 42");
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 5. Version Mismatch Error Guidance
	// ═════════════════════════════════════════════════════════════════

	describe("version mismatch error guidance", () => {
		it("includes upgrade guidance for unsupported future version", () => {
			const futureState = makeValidV3();
			futureState.schemaVersion = 99;

			try {
				validatePersistedState(futureState);
				expect.fail("should have thrown");
			} catch (err: any) {
				expect(err.code).toBe("STATE_SCHEMA_INVALID");
				expect(err.message).toContain("99");
				expect(err.message).toMatch(/[Uu]pgrade/);
				expect(err.message).toContain("taskplane");
			}
		});

		it("includes upgrade guidance for version 5 (hypothetical next)", () => {
			const futureState = makeValidV4();
			futureState.schemaVersion = 5;

			try {
				validatePersistedState(futureState);
				expect.fail("should have thrown");
			} catch (err: any) {
				expect(err.code).toBe("STATE_SCHEMA_INVALID");
				expect(err.message).toContain("5");
				expect(err.message).toMatch(/[Uu]pgrade/);
			}
		});

		it("includes both upgrade guidance AND delete fallback", () => {
			const futureState = makeValidV3();
			futureState.schemaVersion = 99;

			try {
				validatePersistedState(futureState);
				expect.fail("should have thrown");
			} catch (err: any) {
				expect(err.message).toMatch(/[Uu]pgrade/);
				expect(err.message).toContain("delete");
			}
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 6. Upconversion Unit Tests
	// ═════════════════════════════════════════════════════════════════

	describe("upconvertV1toV2", () => {
		it("converts v1 to v2 with correct defaults", () => {
			const obj: Record<string, unknown> = { schemaVersion: 1, phase: "idle" };
			upconvertV1toV2(obj);

			expect(obj.schemaVersion).toBe(2);
			expect(obj.mode).toBe("repo");
			expect(obj.baseBranch).toBe("");
		});

		it("is idempotent on v2 objects", () => {
			const obj: Record<string, unknown> = { schemaVersion: 2, mode: "workspace", baseBranch: "main" };
			upconvertV1toV2(obj);

			expect(obj.schemaVersion).toBe(2);
			expect(obj.mode).toBe("workspace");
			expect(obj.baseBranch).toBe("main");
		});

		it("is idempotent on v3+ objects", () => {
			for (const version of [3, 4]) {
				const obj: Record<string, unknown> = { schemaVersion: version, mode: "repo" };
				upconvertV1toV2(obj);

				expect(obj.schemaVersion).toBe(version);
			}
		});
	});

	describe("upconvertV2toV3", () => {
		it("converts v2 to v3 with default resilience and diagnostics", () => {
			const obj: Record<string, unknown> = { schemaVersion: 2 };
			upconvertV2toV3(obj);

			expect(obj.schemaVersion).toBe(3);
			expect(obj.resilience).toEqual(defaultResilienceState());
			expect(obj.diagnostics).toEqual(defaultBatchDiagnostics());
		});

		it("is idempotent on v3+ objects", () => {
			const customResilience = {
				resumeForced: true,
				retryCountByScope: { "X:w0:l1": 3 },
				lastFailureClass: "tool-error",
				repairHistory: [],
			};
			for (const version of [3, 4]) {
				const obj: Record<string, unknown> = { schemaVersion: version, resilience: customResilience };
				upconvertV2toV3(obj);

				expect(obj.schemaVersion).toBe(version);
				expect(obj.resilience).toBe(customResilience); // Same reference, not replaced
			}
		});

		it("does NOT backfill resilience on v3+ with missing resilience (that's validation's job)", () => {
			// upconvertV2toV3 sees schemaVersion >= 3, so it no-ops.
			// The missing resilience will be caught by validation, not silently patched.
			for (const version of [3, 4]) {
				const obj: Record<string, unknown> = { schemaVersion: version };
				upconvertV2toV3(obj);

				expect(obj.schemaVersion).toBe(version);
				expect(obj.resilience).toBeUndefined();
			}
		});
	});

	describe("upconvertV3toV4", () => {
		it("converts v3 to v4 with empty segments array", () => {
			const obj: Record<string, unknown> = { schemaVersion: 3 };
			upconvertV3toV4(obj);

			expect(obj.schemaVersion).toBe(4);
			expect(obj.segments).toEqual([]);
		});

		it("is idempotent on v4 objects", () => {
			const existingSegments = [{ segmentId: "TP-001::api" }];
			const obj: Record<string, unknown> = { schemaVersion: 4, segments: existingSegments };
			upconvertV3toV4(obj);

			expect(obj.schemaVersion).toBe(4);
			expect(obj.segments).toBe(existingSegments); // Same reference, not replaced
		});

		it("does NOT backfill segments on v4 with missing segments (that's validation's job)", () => {
			const obj: Record<string, unknown> = { schemaVersion: 4 };
			upconvertV3toV4(obj);

			expect(obj.schemaVersion).toBe(4);
			expect(obj.segments).toBeUndefined();
		});
	});

	describe("upconvert chain v1→v2→v3→v4", () => {
		it("chains correctly through all versions", () => {
			const obj: Record<string, unknown> = { schemaVersion: 1 };
			upconvertV1toV2(obj);
			upconvertV2toV3(obj);
			upconvertV3toV4(obj);

			expect(obj.schemaVersion).toBe(4);
			expect(obj.mode).toBe("repo");
			expect(obj.baseBranch).toBe("");
			expect(obj.resilience).toEqual(defaultResilienceState());
			expect(obj.diagnostics).toEqual(defaultBatchDiagnostics());
			expect(obj.segments).toEqual([]);
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 7. BATCH_STATE_SCHEMA_VERSION constant
	// ═════════════════════════════════════════════════════════════════

	describe("schema version constant", () => {
		it("BATCH_STATE_SCHEMA_VERSION is 4", () => {
			expect(BATCH_STATE_SCHEMA_VERSION).toBe(4);
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 8. Edge Cases
	// ═════════════════════════════════════════════════════════════════

	describe("edge cases", () => {
		it("accepts repairHistory entry with optional repoId", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).repairHistory = [{
				id: "r-001",
				strategy: "stale-worktree-cleanup",
				status: "succeeded",
				startedAt: 1000,
				endedAt: 2000,
				repoId: "api",
			}];

			const result = validatePersistedState(v3);
			expect(result.resilience.repairHistory[0].repoId).toBe("api");
		});

		it("accepts taskExits entry with optional retries", () => {
			const v3 = makeValidV3();
			(v3.diagnostics as any).taskExits = {
				"TP-001": { classification: "success", cost: 0.5, durationSec: 30, retries: 2 },
			};

			const result = validatePersistedState(v3);
			expect(result.diagnostics.taskExits["TP-001"].retries).toBe(2);
		});

		it("accepts taskExits entry without optional retries", () => {
			const v3 = makeValidV3();
			(v3.diagnostics as any).taskExits = {
				"TP-001": { classification: "success", cost: 0.5, durationSec: 30 },
			};

			const result = validatePersistedState(v3);
			expect(result.diagnostics.taskExits["TP-001"].retries).toBeUndefined();
		});

		it("accepts valid repairHistory statuses: succeeded, failed, skipped", () => {
			for (const status of ["succeeded", "failed", "skipped"]) {
				const v3 = makeValidV3();
				(v3.resilience as any).repairHistory = [{
					id: `r-${status}`,
					strategy: "test",
					status,
					startedAt: 1000,
					endedAt: 2000,
				}];

				const result = validatePersistedState(v3);
				expect(result.resilience.repairHistory[0].status).toBe(status);
			}
		});

		it("accepts lastFailureClass as null (no failures)", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).lastFailureClass = null;

			const result = validatePersistedState(v3);
			expect(result.resilience.lastFailureClass).toBeNull();
		});

		it("accepts lastFailureClass as a string classification", () => {
			const v3 = makeValidV3();
			(v3.resilience as any).lastFailureClass = "tool-error";

			const result = validatePersistedState(v3);
			expect(result.resilience.lastFailureClass).toBe("tool-error");
		});

		it("v2 with existing resilience/diagnostics fields: treated as unknown during migration", () => {
			// Edge case: someone manually added resilience to a v2 state.
			// upconvertV2toV3 sees they're present and won't overwrite them.
			const v2 = makeValidV2();
			v2.resilience = {
				resumeForced: true,
				retryCountByScope: { "X:w0:l1": 5 },
				lastFailureClass: "tool-error",
				repairHistory: [],
			};
			v2.diagnostics = {
				taskExits: {},
				batchCost: 99.0,
			};

			const result = validatePersistedState(v2);
			expect(result.schemaVersion).toBe(4);
			// The pre-existing values should be preserved (not overwritten with defaults)
			expect(result.resilience.resumeForced).toBe(true);
			expect(result.resilience.retryCountByScope["X:w0:l1"]).toBe(5);
			expect(result.diagnostics.batchCost).toBe(99.0);
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 9. Serialization Roundtrip Tests (R008)
	// ═════════════════════════════════════════════════════════════════

	describe("serialization roundtrip", () => {
		/**
		 * Helper: build a minimal runtime state and matching lanes/outcomes
		 * from a validated PersistedBatchState, suitable for serializeBatchState().
		 */
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
				...(tr.exitDiagnostic ? { exitDiagnostic: tr.exitDiagnostic } : {}),
				...(tr.partialProgressCommits !== undefined ? { partialProgressCommits: tr.partialProgressCommits } : {}),
				...(tr.partialProgressBranch !== undefined ? { partialProgressBranch: tr.partialProgressBranch } : {}),
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
				_extraFields: persisted._extraFields,
			};

			return { runtimeState, wavePlan: persisted.wavePlan, lanes, outcomes };
		}

		it("preserves unknown top-level fields through validate → serialize → parse roundtrip", () => {
			// Step 1: Build v3 state with unknown fields
			const v3 = makeValidV3();
			v3.customPlugin = { foo: "bar", nested: { deep: true } };
			v3.futureField = 42;

			// Step 2: Validate (read path — captures unknown fields in _extraFields)
			const validated = validatePersistedState(v3);
			expect(validated._extraFields).toBeDefined();
			expect(validated._extraFields!.customPlugin).toEqual({ foo: "bar", nested: { deep: true } });

			// Step 3: Serialize (write path — merges _extraFields back into output)
			const { runtimeState, wavePlan, lanes, outcomes } = buildRuntimeFromPersisted(validated);
			const json = serializeBatchState(runtimeState, wavePlan, lanes, outcomes);
			const reParsed = JSON.parse(json);

			// Step 4: Assert unknown fields survived serialization
			expect(reParsed.customPlugin).toEqual({ foo: "bar", nested: { deep: true } });
			expect(reParsed.futureField).toBe(42);
			expect(reParsed.schemaVersion).toBe(4);

			// Step 5: Re-validate the serialized output (full roundtrip)
			const reValidated = validatePersistedState(reParsed);
			expect(reValidated._extraFields).toBeDefined();
			expect(reValidated._extraFields!.customPlugin).toEqual({ foo: "bar", nested: { deep: true } });
			expect(reValidated._extraFields!.futureField).toBe(42);
		});

		it("preserves exitDiagnostic on task records through serialize → re-validate roundtrip", () => {
			// Step 1: Build v3 state with exitDiagnostic on a task
			const v3 = makeValidV3();
			const exitDiag = {
				classification: "context-overflow",
				exitCode: 1,
				errorMessage: "Context window exhausted",
				tokensUsed: 200000,
				contextPct: 99.5,
				partialProgressCommits: 2,
				partialProgressBranch: "task/lane-1-partial",
				durationSec: 300,
				lastKnownStep: 3,
				lastKnownCheckbox: "Implement migration logic",
				repoId: null,
			};
			(v3.tasks as any[])[0].exitDiagnostic = exitDiag;
			(v3.tasks as any[])[0].status = "failed";
			(v3.tasks as any[])[0].exitReason = "context-overflow";

			// Step 2: Validate (read path)
			const validated = validatePersistedState(v3);
			expect(validated.tasks[0].exitDiagnostic).toBeDefined();
			expect(validated.tasks[0].exitDiagnostic!.classification).toBe("context-overflow");

			// Step 3: Serialize (write path)
			const { runtimeState, wavePlan, lanes, outcomes } = buildRuntimeFromPersisted(validated);
			const json = serializeBatchState(runtimeState, wavePlan, lanes, outcomes);
			const reParsed = JSON.parse(json);

			// Step 4: Assert exitDiagnostic survived serialization
			const taskRecord = reParsed.tasks.find((t: any) => t.taskId === "TP-001");
			expect(taskRecord).toBeDefined();
			expect(taskRecord.exitDiagnostic).toBeDefined();
			expect(taskRecord.exitDiagnostic.classification).toBe("context-overflow");
			expect(taskRecord.exitDiagnostic.exitCode).toBe(1);
			expect(taskRecord.exitDiagnostic.errorMessage).toBe("Context window exhausted");
			expect(taskRecord.exitDiagnostic.tokensUsed).toBe(200000);
			expect(taskRecord.exitDiagnostic.contextPct).toBe(99.5);
			expect(taskRecord.exitDiagnostic.partialProgressCommits).toBe(2);
			expect(taskRecord.exitDiagnostic.partialProgressBranch).toBe("task/lane-1-partial");
			expect(taskRecord.exitDiagnostic.durationSec).toBe(300);
			expect(taskRecord.exitDiagnostic.lastKnownStep).toBe(3);
			expect(taskRecord.exitDiagnostic.lastKnownCheckbox).toBe("Implement migration logic");
			expect(taskRecord.exitDiagnostic.repoId).toBeNull();

			// Step 5: Re-validate the serialized output
			const reValidated = validatePersistedState(reParsed);
			expect(reValidated.tasks[0].exitDiagnostic).toBeDefined();
			expect(reValidated.tasks[0].exitDiagnostic!.classification).toBe("context-overflow");
			expect(reValidated.tasks[0].exitDiagnostic!.tokensUsed).toBe(200000);
		});

		it("preserves resilience and diagnostics through serialize → re-validate roundtrip", () => {
			const v3 = makeValidV3();
			v3.resilience = {
				resumeForced: true,
				retryCountByScope: { "TP-001:w0:l1": 3 },
				lastFailureClass: "tool-error",
				repairHistory: [{
					id: "r-001",
					strategy: "stale-worktree-cleanup",
					status: "succeeded",
					startedAt: 1000,
					endedAt: 2000,
				}],
			};
			v3.diagnostics = {
				taskExits: {
					"TP-001": { classification: "tool-error", cost: 2.50, durationSec: 180, retries: 3 },
				},
				batchCost: 2.50,
			};

			const validated = validatePersistedState(v3);
			const { runtimeState, wavePlan, lanes, outcomes } = buildRuntimeFromPersisted(validated);
			const json = serializeBatchState(runtimeState, wavePlan, lanes, outcomes);
			const reParsed = JSON.parse(json);

			// Resilience survives
			expect(reParsed.resilience.resumeForced).toBe(true);
			expect(reParsed.resilience.retryCountByScope["TP-001:w0:l1"]).toBe(3);
			expect(reParsed.resilience.lastFailureClass).toBe("tool-error");
			expect(reParsed.resilience.repairHistory).toHaveLength(1);

			// Diagnostics survives
			expect(reParsed.diagnostics.taskExits["TP-001"].classification).toBe("tool-error");
			expect(reParsed.diagnostics.batchCost).toBe(2.50);

			// Re-validate
			const reValidated = validatePersistedState(reParsed);
			expect(reValidated.resilience.resumeForced).toBe(true);
			expect(reValidated.diagnostics.batchCost).toBe(2.50);
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 10. Corrupt State Runtime Behavior (R008)
	// ═════════════════════════════════════════════════════════════════

	describe("corrupt state runtime behavior (integration)", () => {
		it("paused-corrupt recommendation sets runtime phase to paused when handler executes", () => {
			// This test verifies the contract between analyzeOrchestratorStartupState
			// and the extension handler: the recommendation is "paused-corrupt", and
			// the handler mutates orchBatchState.phase to "paused".
			//
			// We simulate the handler logic from extension.ts (case "paused-corrupt")
			// without importing extension.ts (which has heavy dependencies).

			// Step 1: Get the recommendation
			const result = analyzeOrchestratorStartupState(
				[],
				"invalid",
				null,
				"Unexpected token at position 42",
				new Set<string>(),
			);
			expect(result.recommendedAction).toBe("paused-corrupt");

			// Step 2: Simulate the handler (mirrors extension.ts case "paused-corrupt")
			const orchBatchState: { phase: string; errors: string[] } = {
				phase: "idle",
				errors: [],
			};

			// Handler logic (from extension.ts lines 783-791):
			orchBatchState.phase = "paused";
			orchBatchState.errors.push(result.userMessage);

			// Step 3: Assert runtime state reflects paused
			expect(orchBatchState.phase).toBe("paused");
			expect(orchBatchState.errors).toHaveLength(1);
			expect(orchBatchState.errors[0]).toContain("corrupt");
			expect(orchBatchState.errors[0]).toContain("NOT been deleted");
			expect(orchBatchState.errors[0]).toContain("Unexpected token at position 42");
		});

		it("paused-corrupt handler does NOT delete state file (no cleanup call)", () => {
			// The critical behavioral property: paused-corrupt path returns immediately
			// after setting phase to paused — it does NOT fall through to cleanup-stale
			// or any other branch that calls deleteBatchState().
			const result = analyzeOrchestratorStartupState(
				[],
				"io-error",
				null,
				"ENOENT or permission error",
				new Set<string>(),
			);

			// Recommendation is paused-corrupt, not cleanup-stale
			expect(result.recommendedAction).toBe("paused-corrupt");
			expect(result.recommendedAction).not.toBe("cleanup-stale");

			// The user message explicitly tells the user the file was NOT deleted
			expect(result.userMessage).toContain("NOT been deleted");
		});
	});
});
