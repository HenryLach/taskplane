/**
 * Tests for TP-071: Engine Worker Thread
 *
 * Validates:
 * - engine-worker.ts structure and message contracts
 * - Serialization/deserialization helpers for cross-thread data transfer
 * - startBatchInWorker integration in extension.ts
 * - Worker lifecycle (pause, abort, crash detection, session exit cleanup)
 * - Source-based verification of worker thread wiring
 */
import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
	serializeWorkspaceConfig,
	deserializeWorkspaceConfig,
	applySerializedState,
} from "../taskplane/engine-worker.ts";
import type {
	EngineWorkerData,
	SerializedBatchState,
	SerializedWorkspaceConfig,
} from "../taskplane/engine-worker.ts";
import { freshOrchBatchState } from "../taskplane/types.ts";
import type { OrchBatchRuntimeState, WorkspaceConfig } from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Helper to read source files for source-based tests */
function readSource(filename: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", filename), "utf-8");
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — Serialization helpers (workspace config)
// ══════════════════════════════════════════════════════════════════════

describe("1.x — Workspace config serialization", () => {
	it("1.1: serializeWorkspaceConfig converts Map to array of entries", () => {
		const config: WorkspaceConfig = {
			mode: "workspace",
			repos: new Map([
				["api", { path: "/repo/api", defaultBranch: "main" }],
				["frontend", { path: "/repo/frontend", defaultBranch: "develop" }],
			]) as any,
			routing: { tasksRoot: "/tasks", defaultRepo: "api", strict: false } as any,
			configPath: "/workspace/config.json",
		};

		const serialized = serializeWorkspaceConfig(config);

		expect(serialized).not.toBeNull();
		expect(serialized!.mode).toBe("workspace");
		expect(Array.isArray(serialized!.repos)).toBe(true);
		expect(serialized!.repos).toHaveLength(2);
		expect(serialized!.repos[0][0]).toBe("api");
		expect(serialized!.repos[0][1].path).toBe("/repo/api");
	});

	it("1.2: serializeWorkspaceConfig returns null for null/undefined input", () => {
		expect(serializeWorkspaceConfig(null)).toBeNull();
		expect(serializeWorkspaceConfig(undefined)).toBeNull();
	});

	it("1.3: deserializeWorkspaceConfig reconstructs Map from entries", () => {
		const serialized: SerializedWorkspaceConfig = {
			mode: "workspace",
			repos: [
				["api", { path: "/repo/api", defaultBranch: "main" } as any],
				["frontend", { path: "/repo/frontend", defaultBranch: "develop" } as any],
			],
			routing: { tasksRoot: "/tasks", defaultRepo: "api", strict: false } as any,
			configPath: "/workspace/config.json",
		};

		const restored = deserializeWorkspaceConfig(serialized);

		expect(restored).not.toBeNull();
		expect(restored!.repos).toBeInstanceOf(Map);
		expect(restored!.repos.size).toBe(2);
		expect(restored!.repos.get("api")?.path).toBe("/repo/api");
		expect(restored!.repos.get("frontend")?.defaultBranch).toBe("develop");
	});

	it("1.4: deserializeWorkspaceConfig returns null for null/undefined input", () => {
		expect(deserializeWorkspaceConfig(null)).toBeNull();
		expect(deserializeWorkspaceConfig(undefined)).toBeNull();
	});

	it("1.5: roundtrip preserves workspace config", () => {
		const original: WorkspaceConfig = {
			mode: "workspace",
			repos: new Map([
				["backend", { path: "/repo/backend", defaultBranch: "main" } as any],
			]),
			routing: { tasksRoot: "/tasks", defaultRepo: "backend", strict: true } as any,
			configPath: "/ws/config.json",
		};

		const restored = deserializeWorkspaceConfig(serializeWorkspaceConfig(original));

		expect(restored).not.toBeNull();
		expect(restored!.mode).toBe(original.mode);
		expect(restored!.repos.size).toBe(original.repos.size);
		expect(restored!.repos.get("backend")?.path).toBe("/repo/backend");
		expect(restored!.configPath).toBe(original.configPath);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Batch state serialization
// ══════════════════════════════════════════════════════════════════════

describe("2.x — Batch state serialization (applySerializedState)", () => {
	it("2.1: applySerializedState updates target state from serialized data", () => {
		const target = freshOrchBatchState();
		const serialized: SerializedBatchState = {
			phase: "completed",
			batchId: "20260326T120000",
			baseBranch: "main",
			orchBranch: "orch/henry-20260326T120000",
			mode: "repo",
			currentWaveIndex: 2,
			totalWaves: 3,
			totalTasks: 10,
			succeededTasks: 8,
			failedTasks: 1,
			skippedTasks: 1,
			blockedTasks: 0,
			startedAt: 1000,
			endedAt: 2000,
			errors: ["some error"],
		};

		applySerializedState(target, serialized);

		expect(target.phase).toBe("completed");
		expect(target.batchId).toBe("20260326T120000");
		expect(target.orchBranch).toBe("orch/henry-20260326T120000");
		expect(target.succeededTasks).toBe(8);
		expect(target.endedAt).toBe(2000);
		expect(target.errors).toEqual(["some error"]);
	});

	it("2.2: applySerializedState preserves main-thread-only fields", () => {
		const target = freshOrchBatchState();
		target.pauseSignal = { paused: true };
		target.dependencyGraph = { dependencies: new Map(), dependents: new Map(), nodes: new Set() };

		const serialized: SerializedBatchState = {
			phase: "executing",
			batchId: "20260326T130000",
			baseBranch: "main",
			orchBranch: "orch/op-20260326T130000",
			mode: "repo",
			currentWaveIndex: 0,
			totalWaves: 2,
			totalTasks: 5,
			succeededTasks: 0,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			startedAt: 3000,
			endedAt: null,
			errors: [],
		};

		applySerializedState(target, serialized);

		// These should be preserved (not overwritten by applySerializedState)
		expect(target.pauseSignal.paused).toBe(true);
		expect(target.dependencyGraph).not.toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Worker entry point structure (source-based)
// ══════════════════════════════════════════════════════════════════════

describe("3.x — Engine worker entry point structure", () => {
	it("3.1: engine-worker.ts uses fork mode with TASKPLANE_ENGINE_FORK guard", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain("TASKPLANE_ENGINE_FORK");
		expect(src).toContain("process.send");
		expect(src).toContain('process.once("message"');
	});

	it("3.2: engine-worker.ts dynamically imports engine and resume modules", () => {
		const src = readSource("engine-worker.ts");
		// Dynamic imports in worker context to avoid circular deps
		expect(src).toContain('./engine.ts"');
		expect(src).toContain('./resume.ts"');
		expect(src).toContain("executeOrchBatch");
		expect(src).toContain("resumeOrchBatch");
	});

	it("3.3: engine-worker.ts listens for control messages from parent process", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain('process.on("message"');
		// Must handle pause and resume/abort
		expect(src).toContain('"pause"');
		expect(src).toContain("batchState.pauseSignal.paused = true");
	});

	it("3.4: engine-worker.ts sends state-sync messages back to parent", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain('"state-sync"');
		expect(src).toContain("serializeBatchState(batchState)");
	});

	it("3.5: engine-worker.ts sends complete message with final state", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain('"complete"');
		expect(src).toContain("serializeBatchState");
	});

	it("3.6: engine-worker.ts has error handling for unhandled rejections", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain(".catch(");
		expect(src).toContain('"error"');
		expect(src).toContain('batchState.phase = "failed"');
	});

	it("3.7: engine-worker.ts supports both execute and resume modes", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain('data.mode === "resume"');
		expect(src).toContain("executeOrchBatch(");
		expect(src).toContain("resumeOrchBatch(");
	});

	it("3.8: engine-worker.ts guards execution with fork sentinel check", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain('TASKPLANE_ENGINE_FORK');
		expect(src).toContain("process.send");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Extension integration (source-based)
// ══════════════════════════════════════════════════════════════════════

describe("4.x — Extension worker thread integration", () => {
	it("4.1: extension.ts imports fork from child_process", () => {
		const src = readSource("extension.ts");
		expect(src).toContain('import { fork');
		expect(src).toContain('"child_process"');
	});

	it("4.2: extension.ts imports worker types from engine-worker.ts", () => {
		const src = readSource("extension.ts");
		expect(src).toContain('from "./engine-worker.ts"');
		expect(src).toContain("serializeWorkspaceConfig");
		expect(src).toContain("applySerializedState");
	});

	it("4.3: startBatchInWorker function exists and is exported", () => {
		const src = readSource("extension.ts");
		expect(src).toContain("export function startBatchInWorker(");
	});

	it("4.4: startBatchInWorker has fallback to main-thread on spawn failure", () => {
		const src = readSource("extension.ts");
		const fnStart = src.indexOf("function startBatchInWorker(");
		const fnEnd = src.indexOf("\n// ── TP-043", fnStart);
		const fnBody = src.substring(fnStart, fnEnd);
		expect(fnBody).toContain("catch (spawnErr");
		expect(fnBody).toContain("startBatchAsync(");
		expect(fnBody).toContain("Falling back to main-thread");
	});

	it("4.5: startBatchInWorker has settled terminal guard", () => {
		const src = readSource("extension.ts");
		const fnStart = src.indexOf("function startBatchInWorker(");
		const fnEnd = src.indexOf("\n// ── TP-043", fnStart);
		const fnBody = src.substring(fnStart, fnEnd);
		expect(fnBody).toContain("let settled = false");
		expect(fnBody).toContain("const settle = ()");
		expect(fnBody).toContain("if (settled) return");
	});

	it("4.6: activeWorker is tracked at extension scope", () => {
		const src = readSource("extension.ts");
		expect(src).toContain("let activeWorker: ChildProcess | null = null");
	});

	it("4.7: doOrchPause forwards pause to engine process", () => {
		const src = readSource("extension.ts");
		const pauseBody = src.substring(
			src.indexOf("function doOrchPause()"),
			src.indexOf("function doOrchResume("),
		);
		expect(pauseBody).toContain('activeWorker?.send({ type: "pause" })');
	});

	it("4.8: doOrchAbort kills engine on hard abort", () => {
		const src = readSource("extension.ts");
		const abortStart = src.indexOf("function doOrchAbort(");
		const nextFn = src.indexOf("\n\tfunction ", abortStart + 1);
		const abortBody = src.substring(abortStart, nextFn > 0 ? nextFn : abortStart + 3000);
		expect(abortBody).toContain("activeWorker.kill()");
		expect(abortBody).toContain('{ type: "pause" }');
	});

	it("4.9: session_end kills engine process", () => {
		const src = readSource("extension.ts");
		const sessionEndIdx = src.indexOf('"session_end"');
		const sessionEndBlock = src.substring(sessionEndIdx, sessionEndIdx + 500);
		expect(sessionEndBlock).toContain("activeWorker");
		expect(sessionEndBlock).toContain(".kill()");
	});

	it("4.10: startBatchAsync is preserved as fallback (PROMPT requirement)", () => {
		const src = readSource("extension.ts");
		expect(src).toContain("export function startBatchAsync(");
		// Must still have the setTimeout-based detach pattern
		const fnStart = src.indexOf("function startBatchAsync(");
		const fnEnd = src.indexOf("function startBatchInWorker(", fnStart);
		const fnBody = src.substring(fnStart, fnEnd > 0 ? fnEnd : fnStart + 2000);
		expect(fnBody).toContain("setTimeout(");
		expect(fnBody).toContain(".catch(");
	});

	it("4.11: resolveEngineWorkerPath resolves engine-worker-entry.mjs path", () => {
		const src = readSource("extension.ts");
		expect(src).toContain("function resolveEngineWorkerPath()");
		const fnStart = src.indexOf("function resolveEngineWorkerPath()");
		const fnBody = src.substring(fnStart, fnStart + 300);
		expect(fnBody).toContain("engine-worker-entry.mjs");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Message type contracts
// ══════════════════════════════════════════════════════════════════════

describe("5.x — Worker message type contracts", () => {
	it("5.1: WorkerToMainMessage type covers all message kinds", () => {
		const src = readSource("engine-worker.ts");
		// All message types must be present in the type definition
		expect(src).toContain('"notify"');
		expect(src).toContain('"monitor-update"');
		expect(src).toContain('"engine-event"');
		expect(src).toContain('"state-sync"');
		expect(src).toContain('"complete"');
		expect(src).toContain('"error"');
	});

	it("5.2: WorkerInMessage type covers pause, resume, and abort", () => {
		const src = readSource("engine-worker.ts");
		const typeDefStart = src.indexOf("WorkerInMessage");
		const typeDefBlock = src.substring(typeDefStart, typeDefStart + 200);
		expect(typeDefBlock).toContain('"pause"');
		expect(typeDefBlock).toContain('"resume"');
		expect(typeDefBlock).toContain('"abort"');
	});

	it("5.3: EngineWorkerData interface has all required fields", () => {
		const src = readSource("engine-worker.ts");
		const interfaceStart = src.indexOf("interface EngineWorkerData");
		// Find the closing brace of the interface — scan for a line with just "}"
		const interfaceBody = src.substring(interfaceStart, interfaceStart + 800);
		expect(interfaceBody).toContain("mode:");
		expect(interfaceBody).toContain("orchConfig:");
		expect(interfaceBody).toContain("runnerConfig:");
		expect(interfaceBody).toContain("cwd:");
		expect(interfaceBody).toContain("workspaceConfig");
	});

	it("5.4: SerializedBatchState has all display fields", () => {
		const src = readSource("engine-worker.ts");
		const interfaceStart = src.indexOf("interface SerializedBatchState");
		const interfaceBlock = src.substring(interfaceStart, interfaceStart + 600);
		expect(interfaceBlock).toContain("phase:");
		expect(interfaceBlock).toContain("batchId:");
		expect(interfaceBlock).toContain("orchBranch:");
		expect(interfaceBlock).toContain("succeededTasks:");
		expect(interfaceBlock).toContain("failedTasks:");
		expect(interfaceBlock).toContain("totalTasks:");
		expect(interfaceBlock).toContain("errors:");
	});
});
