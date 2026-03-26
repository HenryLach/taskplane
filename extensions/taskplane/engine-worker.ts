/**
 * Engine Worker Thread Entry Point
 *
 * Runs the orchestrator engine (executeOrchBatch / resumeOrchBatch) in a
 * Node.js worker_thread so the main thread stays free for TUI interaction
 * and supervisor agent LLM calls.
 *
 * Communication:
 *   Worker → Main: postMessage({ type: "notify"|"monitor-update"|"engine-event"|"state-sync"|"complete"|"error", ... })
 *   Main → Worker: postMessage({ type: "pause"|"unpause" })
 *
 * @module orch/engine-worker
 * @since TP-071
 */
import { parentPort, workerData } from "worker_threads";

import { executeOrchBatch } from "./engine.ts";
import { resumeOrchBatch } from "./resume.ts";
import type { EngineEvent, MonitorState, OrchBatchRuntimeState, OrchestratorConfig, TaskRunnerConfig, WorkspaceConfig, WorkspaceRepoConfig } from "./types.ts";
import { freshOrchBatchState } from "./types.ts";
import type { MonitorUpdateCallback } from "./execution.ts";
import type { EngineEventCallback } from "./types.ts";

// ── Message Types ────────────────────────────────────────────────────

/** Messages sent FROM the worker TO the main thread */
export type WorkerToMainMessage =
	| { type: "notify"; msg: string; level: "info" | "warning" | "error" }
	| { type: "monitor-update"; state: MonitorState }
	| { type: "engine-event"; event: EngineEvent }
	| { type: "state-sync"; state: SerializedBatchState }
	| { type: "complete"; state: SerializedBatchState }
	| { type: "error"; message: string };

/** Messages sent FROM the main thread TO the worker */
export type MainToWorkerMessage =
	| { type: "pause" }
	| { type: "unpause" };

// ── Serialization ────────────────────────────────────────────────────

/**
 * Serialized form of OrchBatchRuntimeState that survives structured clone.
 * Sets become arrays, Maps become arrays of entries.
 */
export interface SerializedBatchState {
	phase: OrchBatchRuntimeState["phase"];
	batchId: string;
	baseBranch: string;
	orchBranch: string;
	mode: OrchBatchRuntimeState["mode"];
	currentWaveIndex: number;
	totalWaves: number;
	startedAt: number;
	endedAt: number | null;
	totalTasks: number;
	succeededTasks: number;
	failedTasks: number;
	skippedTasks: number;
	blockedTasks: number;
	errors: string[];
	/** blockedTaskIds as array (Set in runtime) */
	blockedTaskIds: string[];
	/** Shallow-serialized wave results */
	waveResults: OrchBatchRuntimeState["waveResults"];
	/** Shallow-serialized current lanes */
	currentLanes: OrchBatchRuntimeState["currentLanes"];
	/** Shallow-serialized merge results */
	mergeResults: OrchBatchRuntimeState["mergeResults"];
	/** Resilience state */
	resilience?: OrchBatchRuntimeState["resilience"];
	/** Diagnostics state */
	diagnostics?: OrchBatchRuntimeState["diagnostics"];
}

/** Serialize OrchBatchRuntimeState for postMessage transfer. */
export function serializeBatchState(state: OrchBatchRuntimeState): SerializedBatchState {
	return {
		phase: state.phase,
		batchId: state.batchId,
		baseBranch: state.baseBranch,
		orchBranch: state.orchBranch,
		mode: state.mode,
		currentWaveIndex: state.currentWaveIndex,
		totalWaves: state.totalWaves,
		startedAt: state.startedAt,
		endedAt: state.endedAt,
		totalTasks: state.totalTasks,
		succeededTasks: state.succeededTasks,
		failedTasks: state.failedTasks,
		skippedTasks: state.skippedTasks,
		blockedTasks: state.blockedTasks,
		errors: [...state.errors],
		blockedTaskIds: [...state.blockedTaskIds],
		waveResults: state.waveResults,
		currentLanes: state.currentLanes,
		mergeResults: state.mergeResults,
		resilience: state.resilience,
		diagnostics: state.diagnostics,
	};
}

/** Apply a serialized state snapshot onto a live OrchBatchRuntimeState. */
export function applySerializedState(target: OrchBatchRuntimeState, src: SerializedBatchState): void {
	target.phase = src.phase;
	target.batchId = src.batchId;
	target.baseBranch = src.baseBranch;
	target.orchBranch = src.orchBranch;
	target.mode = src.mode;
	target.currentWaveIndex = src.currentWaveIndex;
	target.totalWaves = src.totalWaves;
	target.startedAt = src.startedAt;
	target.endedAt = src.endedAt;
	target.totalTasks = src.totalTasks;
	target.succeededTasks = src.succeededTasks;
	target.failedTasks = src.failedTasks;
	target.skippedTasks = src.skippedTasks;
	target.blockedTasks = src.blockedTasks;
	target.errors = src.errors;
	target.blockedTaskIds = new Set(src.blockedTaskIds);
	target.waveResults = src.waveResults;
	target.currentLanes = src.currentLanes;
	target.mergeResults = src.mergeResults;
	target.resilience = src.resilience;
	target.diagnostics = src.diagnostics;
}

/**
 * Serialized WorkspaceConfig for workerData transfer.
 * Map<string, WorkspaceRepoConfig> → Array<[string, WorkspaceRepoConfig]>
 */
export interface SerializedWorkspaceConfig {
	mode: WorkspaceConfig["mode"];
	repos: Array<[string, WorkspaceRepoConfig]>;
	routing: WorkspaceConfig["routing"];
	configPath: string;
}

/** Serialize WorkspaceConfig for structured clone. */
export function serializeWorkspaceConfig(config: WorkspaceConfig): SerializedWorkspaceConfig {
	return {
		mode: config.mode,
		repos: [...config.repos.entries()],
		routing: config.routing,
		configPath: config.configPath,
	};
}

/** Deserialize WorkspaceConfig from workerData. */
export function deserializeWorkspaceConfig(data: SerializedWorkspaceConfig): WorkspaceConfig {
	return {
		mode: data.mode,
		repos: new Map(data.repos),
		routing: data.routing,
		configPath: data.configPath,
	};
}

// ── Worker Data Contract ─────────────────────────────────────────────

/** Data passed to the worker via workerData. Must be structured-clone-safe. */
export interface EngineWorkerData {
	/** "execute" for /orch, "resume" for /orch-resume */
	mode: "execute" | "resume";
	/** User args (target) for executeOrchBatch */
	args: string;
	/** Orchestrator configuration */
	orchConfig: OrchestratorConfig;
	/** Task runner configuration */
	runnerConfig: TaskRunnerConfig;
	/** Current working directory (repo root) */
	cwd: string;
	/** Workspace config (null if repo mode) */
	workspaceConfig: SerializedWorkspaceConfig | null;
	/** Workspace root path */
	workspaceRoot?: string;
	/** Agent root path */
	agentRoot?: string;
	/** Force flag for resume */
	force?: boolean;
}

// ── Worker Entry Point ───────────────────────────────────────────────

if (parentPort) {
	const port = parentPort;
	const data = workerData as EngineWorkerData;

	// Create a fresh batch state for the worker. The main thread keeps
	// its own copy, updated via state-sync messages.
	const batchState = freshOrchBatchState();
	batchState.phase = "launching";
	batchState.startedAt = Date.now();

	// Listen for control messages from main thread
	port.on("message", (msg: MainToWorkerMessage) => {
		switch (msg.type) {
			case "pause":
				batchState.pauseSignal.paused = true;
				break;
			case "unpause":
				batchState.pauseSignal.paused = false;
				break;
		}
	});

	// Build callbacks that post messages to main thread
	const onNotify = (message: string, level: "info" | "warning" | "error") => {
		port.postMessage({ type: "notify", msg: message, level } satisfies WorkerToMainMessage);
	};

	const onMonitorUpdate: MonitorUpdateCallback = (state: MonitorState) => {
		port.postMessage({ type: "monitor-update", state } satisfies WorkerToMainMessage);
	};

	const onEngineEvent: EngineEventCallback = (event: EngineEvent) => {
		port.postMessage({ type: "engine-event", event } satisfies WorkerToMainMessage);
	};

	// State sync: wrap the onNotify to also periodically sync state.
	// We send state-sync after each notify (which happens at each significant
	// engine transition) to keep the main thread's copy up to date.
	const onNotifyWithSync = (message: string, level: "info" | "warning" | "error") => {
		onNotify(message, level);
		port.postMessage({ type: "state-sync", state: serializeBatchState(batchState) } satisfies WorkerToMainMessage);
	};

	const onMonitorUpdateWithSync: MonitorUpdateCallback = (state: MonitorState) => {
		onMonitorUpdate(state);
		// Also send state-sync since monitor updates can trigger state changes
		port.postMessage({ type: "state-sync", state: serializeBatchState(batchState) } satisfies WorkerToMainMessage);
	};

	// Deserialize workspace config if present
	const workspaceConfig = data.workspaceConfig
		? deserializeWorkspaceConfig(data.workspaceConfig)
		: undefined;

	// Run the engine
	const enginePromise = data.mode === "resume"
		? resumeOrchBatch(
			data.orchConfig,
			data.runnerConfig,
			data.cwd,
			batchState,
			onNotifyWithSync,
			onMonitorUpdateWithSync,
			workspaceConfig,
			data.workspaceRoot,
			data.agentRoot,
			data.force ?? false,
		)
		: executeOrchBatch(
			data.args,
			data.orchConfig,
			data.runnerConfig,
			data.cwd,
			batchState,
			onNotifyWithSync,
			onMonitorUpdateWithSync,
			workspaceConfig,
			data.workspaceRoot,
			data.agentRoot,
			onEngineEvent,
		);

	enginePromise
		.then(() => {
			port.postMessage({ type: "complete", state: serializeBatchState(batchState) } satisfies WorkerToMainMessage);
		})
		.catch((err: unknown) => {
			const errMsg = err instanceof Error ? err.message : String(err);
			// Update state before sending
			if (batchState.phase !== "completed" && batchState.phase !== "failed") {
				batchState.phase = "failed";
				batchState.endedAt = Date.now();
				batchState.errors.push(`Unhandled engine error: ${errMsg}`);
			}
			port.postMessage({ type: "error", message: errMsg } satisfies WorkerToMainMessage);
			port.postMessage({ type: "complete", state: serializeBatchState(batchState) } satisfies WorkerToMainMessage);
		});
}
