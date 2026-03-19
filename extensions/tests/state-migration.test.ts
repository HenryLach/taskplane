/**
 * State Schema v3 Migration Tests — TP-030 Step 3
 *
 * Tests for v1→v3 migration, v2→v3 migration, v3 clean read,
 * strict v3 validation, unknown-field roundtrip preservation,
 * corrupt-state handling, and version-mismatch error guidance.
 *
 * Run: npx vitest run extensions/tests/state-migration.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
	validatePersistedState,
	upconvertV1toV2,
	upconvertV2toV3,
	analyzeOrchestratorStartupState,
} from "../taskplane/persistence.ts";
import {
	BATCH_STATE_SCHEMA_VERSION,
	defaultResilienceState,
	defaultBatchDiagnostics,
} from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixtureJSON(name: string): unknown {
	return JSON.parse(readFileSync(join(fixturesDir, name), "utf-8"));
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal valid v3 batch state object. */
function makeValidV3(): Record<string, unknown> {
	return {
		schemaVersion: 3,
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
			tmuxSessionName: "orch-lane-1",
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
	};
}

/** Build a minimal valid v2 batch state object. */
function makeValidV2(): Record<string, unknown> {
	const v3 = makeValidV3();
	v3.schemaVersion = 2;
	delete v3.resilience;
	delete v3.diagnostics;
	delete v3.orchBranch;
	return v3;
}

/** Build a minimal valid v1 batch state object. */
function makeValidV1(): Record<string, unknown> {
	const v2 = makeValidV2();
	v2.schemaVersion = 1;
	delete v2.mode;
	delete v2.baseBranch;
	return v2;
}

// ═════════════════════════════════════════════════════════════════════
// 1. Migration Happy Paths
// ═════════════════════════════════════════════════════════════════════

describe("State Schema v3 Migration", () => {

	describe("v1 → v3 migration", () => {
		it("migrates v1 fixture to v3 with correct defaults", () => {
			const v1Data = loadFixtureJSON("batch-state-v1-valid.json");
			const result = validatePersistedState(v1Data);

			// Schema version bumped to 3
			expect(result.schemaVersion).toBe(3);

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

		it("migrates inline v1 object to v3", () => {
			const v1 = makeValidV1();
			const result = validatePersistedState(v1);

			expect(result.schemaVersion).toBe(3);
			expect(result.mode).toBe("repo");
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
		});
	});

	describe("v2 → v3 migration", () => {
		it("migrates v2 fixture to v3 preserving all existing fields", () => {
			const v2Data = loadFixtureJSON("batch-state-valid.json");
			const result = validatePersistedState(v2Data);

			// Schema version bumped to 3
			expect(result.schemaVersion).toBe(3);

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

			expect(result.schemaVersion).toBe(3);
			expect(result.mode).toBe("workspace");
			expect(result.tasks[0].repoId).toBe("api");
			expect(result.lanes[0].repoId).toBe("api");
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
		});

		it("migrates inline v2 object to v3", () => {
			const v2 = makeValidV2();
			const result = validatePersistedState(v2);

			expect(result.schemaVersion).toBe(3);
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
		});
	});

	describe("v3 clean read", () => {
		it("reads a well-formed v3 state without modification", () => {
			const v3 = makeValidV3();
			const result = validatePersistedState(v3);

			expect(result.schemaVersion).toBe(3);
			expect(result.resilience).toEqual(defaultResilienceState());
			expect(result.diagnostics).toEqual(defaultBatchDiagnostics());
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

			expect(result.schemaVersion).toBe(3);
			expect(result._extraFields).toBeDefined();
			expect(result._extraFields!.externalToolMetadata).toEqual({ version: "1.2.3" });
		});

		it("preserves unknown fields from v1 state through migration", () => {
			const v1 = makeValidV1();
			v1.legacyField = "preserved";

			const result = validatePersistedState(v1);

			expect(result.schemaVersion).toBe(3);
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

		it("includes upgrade guidance for version 4 (hypothetical next)", () => {
			const futureState = makeValidV3();
			futureState.schemaVersion = 4;

			try {
				validatePersistedState(futureState);
				expect.fail("should have thrown");
			} catch (err: any) {
				expect(err.code).toBe("STATE_SCHEMA_INVALID");
				expect(err.message).toContain("4");
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

		it("is idempotent on v3 objects", () => {
			const obj: Record<string, unknown> = { schemaVersion: 3, mode: "repo" };
			upconvertV1toV2(obj);

			expect(obj.schemaVersion).toBe(3);
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

		it("is idempotent on v3 objects", () => {
			const customResilience = {
				resumeForced: true,
				retryCountByScope: { "X:w0:l1": 3 },
				lastFailureClass: "tool-error",
				repairHistory: [],
			};
			const obj: Record<string, unknown> = { schemaVersion: 3, resilience: customResilience };
			upconvertV2toV3(obj);

			expect(obj.schemaVersion).toBe(3);
			expect(obj.resilience).toBe(customResilience); // Same reference, not replaced
		});

		it("does NOT backfill resilience on v3 with missing resilience (that's validation's job)", () => {
			// upconvertV2toV3 sees schemaVersion >= 3, so it no-ops.
			// The missing resilience will be caught by validation, not silently patched.
			const obj: Record<string, unknown> = { schemaVersion: 3 };
			upconvertV2toV3(obj);

			expect(obj.schemaVersion).toBe(3);
			// resilience was NOT added because schemaVersion is already 3
			expect(obj.resilience).toBeUndefined();
		});
	});

	describe("upconvert chain v1→v2→v3", () => {
		it("chains correctly through all versions", () => {
			const obj: Record<string, unknown> = { schemaVersion: 1 };
			upconvertV1toV2(obj);
			upconvertV2toV3(obj);

			expect(obj.schemaVersion).toBe(3);
			expect(obj.mode).toBe("repo");
			expect(obj.baseBranch).toBe("");
			expect(obj.resilience).toEqual(defaultResilienceState());
			expect(obj.diagnostics).toEqual(defaultBatchDiagnostics());
		});
	});

	// ═════════════════════════════════════════════════════════════════
	// 7. BATCH_STATE_SCHEMA_VERSION constant
	// ═════════════════════════════════════════════════════════════════

	describe("schema version constant", () => {
		it("BATCH_STATE_SCHEMA_VERSION is 3", () => {
			expect(BATCH_STATE_SCHEMA_VERSION).toBe(3);
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
			expect(result.schemaVersion).toBe(3);
			// The pre-existing values should be preserved (not overwritten with defaults)
			expect(result.resilience.resumeForced).toBe(true);
			expect(result.resilience.retryCountByScope["X:w0:l1"]).toBe(5);
			expect(result.diagnostics.batchCost).toBe(99.0);
		});
	});
});
