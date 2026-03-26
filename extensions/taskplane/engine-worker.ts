/**
 * Engine Worker Thread Entry Point (TP-071)
 *
 * This module runs inside a Node.js worker_thread. It receives serializable
 * configuration via `workerData` and communicates with the main thread via
 * `parentPort.postMessage()`.
 *
 * The main thread spawns this worker and translates messages back into the
 * callbacks that the rest of the extension expects (onNotify, onMonitorUpdate,
 * onEngineEvent, onComplete/onError).
 *
 * Control signals (pause, resume) are received from the main thread via
 * `parentPort.on("message")` and applied to the local `batchState.pauseSignal`.
 *
 * @module orch/engine-worker
 */
import { parentPort, workerData } from "worker_threads";
import { executeOrchBatch } from "./engine.ts";
import { resumeOrchBatch } from "./resume.ts";
import { freshOrchBatchState } from "./types.ts";
import type {
	EngineEvent,
	MonitorState,
	OrchBatchRuntimeState,
	OrchestratorConfig,
	TaskRunnerConfig,
	WorkspaceConfig,
	WorkspaceRepoConfig,
} from "./types.ts";

// ── Types for worker <-> main thread messages ────────────────────────

/**
 * Messages sent FROM the worker TO the main thread.
 */
export type WorkerOutMessage =
	| { type: "notify"; message: string; level: "info" | "warning" | "error" }
	| { type: "monitor-update"; state: MonitorState }
	| { type: "engine-event"; event: EngineEvent }
	| { type: "batch-state-sync"; state: SerializedBatchState }
	| { type: "complete" }
	| { type: "error"; message: string };

/**
 * Messages sent FROM the main thread TO the worker.
 */
export type WorkerInMessage =
	| { type: "pause" }
	| { type: "resume" }
	| { type: "abort" };

/**
 * Serializable form of OrchBatchRuntimeState fields that need sync back.
 * We only send fields that the main thread needs for display/state tracking.
 */
export interface SerializedBatchState {
	phase: string;
	batchId: string;
	baseBranch: string;
	orchBranch: string;
	mode: string;
	currentWaveIndex: number;
	totalWaves: number;
	totalTasks: number;
	succeededTasks: number;
	failedTasks: number;
	skippedTasks: number;
	blockedTasks: number;
	startedAt: number;
	endedAt: number | null;
	errors: string[];
}

/**
 * Serializable form of WorkspaceConfig (Map → array of entries).
 */
export interface SerializedWorkspaceConfig {
	mode: string;
	repos: Array<[string, WorkspaceRepoConfig]>;
	routing: WorkspaceConfig["routing"];
	configPath: string;
}

/**
 * workerData shape passed from the main thread.
 */
export interface EngineWorkerData {
	/** "start" for new batch, "resume" for resume */
	action: "start" | "resume";
	/** User arguments (target string) — only for "start" action */
	args?: string;
	/** Orchestrator configuration */
	orchConfig: OrchestratorConfig;
	/** Task runner configuration */
	runnerConfig: TaskRunnerConfig;
	/** Repository root (cwd) */
	repoRoot: string;
	/** Workspace configuration (serialized) — null for repo mode */
	workspaceConfig?: SerializedWorkspaceConfig | null;
	/** Workspace root directory */
	workspaceRoot?: string;
	/** Agent root directory */
	agentRoot?: string;
	/** Force flag for resume */
	force?: boolean;
}

// ── Deserialization helpers ──────────────────────────────────────────

/**
 * Reconstruct WorkspaceConfig from serialized form.
 */
function deserializeWorkspaceConfig(
	serialized: SerializedWorkspaceConfig | null | undefined,
): WorkspaceConfig | null {
	if (!serialized) return null;
	return {
		mode: serialized.mode as WorkspaceConfig["mode"],
		repos: new Map(serialized.repos),
		routing: serialized.routing,
		configPath: serialized.configPath,
	};
}

/**
 * Extract serializable batch state for sync back to main thread.
 */
function serializeBatchState(state: OrchBatchRuntimeState): SerializedBatchState {
	return {
		phase: state.phase,
		batchId: state.batchId,
		baseBranch: state.baseBranch,
		orchBranch: state.orchBranch,
		mode: state.mode,
		currentWaveIndex: state.currentWaveIndex,
		totalWaves: state.totalWaves,
		totalTasks: state.totalTasks,
		succeededTasks: state.succeededTasks,
		failedTasks: state.failedTasks,
		skippedTasks: state.skippedTasks,
		blockedTasks: state.blockedTasks,
		startedAt: state.startedAt,
		endedAt: state.endedAt,
		errors: [...state.errors],
	};
}

// ── Worker main ──────────────────────────────────────────────────────

if (parentPort) {
	const data = workerData as EngineWorkerData;
	const port = parentPort;

	// Create a fresh batch state for this worker
	const batchState: OrchBatchRuntimeState = freshOrchBatchState();
	batchState.phase = "launching";
	batchState.startedAt = Date.now();

	// Deserialize workspace config
	const wsConfig = deserializeWorkspaceConfig(data.workspaceConfig);

	// ── Control signal listener ──────────────────────────────────
	// Main thread sends pause/resume/abort signals via postMessage.
	// We apply them to the in-worker batchState.pauseSignal.
	port.on("message", (msg: WorkerInMessage) => {
		switch (msg.type) {
			case "pause":
				batchState.pauseSignal.paused = true;
				break;
			case "resume":
				batchState.pauseSignal.paused = false;
				break;
			case "abort":
				batchState.pauseSignal.paused = true;
				break;
		}
	});

	// ── Callback factories (replace ctx-dependent callbacks) ─────
	const onNotify = (message: string, level: "info" | "warning" | "error") => {
		port.postMessage({ type: "notify", message, level } satisfies WorkerOutMessage);
		// Sync batch state on every notify (lightweight — just the summary fields)
		port.postMessage({ type: "batch-state-sync", state: serializeBatchState(batchState) } satisfies WorkerOutMessage);
	};

	const onMonitorUpdate = (state: MonitorState) => {
		port.postMessage({ type: "monitor-update", state } satisfies WorkerOutMessage);
	};

	const onEngineEvent = (event: EngineEvent) => {
		port.postMessage({ type: "engine-event", event } satisfies WorkerOutMessage);
	};

	// ── Execute engine ───────────────────────────────────────────
	const enginePromise = data.action === "resume"
		? resumeOrchBatch(
			data.orchConfig,
			data.runnerConfig,
			data.repoRoot,
			batchState,
			onNotify,
			onMonitorUpdate,
			wsConfig,
			data.workspaceRoot,
			data.agentRoot,
			data.force ?? false,
		)
		: executeOrchBatch(
			data.args ?? "",
			data.orchConfig,
			data.runnerConfig,
			data.repoRoot,
			batchState,
			onNotify,
			onMonitorUpdate,
			wsConfig,
			data.workspaceRoot,
			data.agentRoot,
			onEngineEvent,
		);

	enginePromise
		.then(() => {
			// Final state sync before completion
			port.postMessage({ type: "batch-state-sync", state: serializeBatchState(batchState) } satisfies WorkerOutMessage);
			port.postMessage({ type: "complete" } satisfies WorkerOutMessage);
		})
		.catch((err: unknown) => {
			const errMsg = err instanceof Error ? err.message : String(err);
			// Ensure batch state reflects the failure
			if (batchState.phase !== "completed" && batchState.phase !== "failed") {
				batchState.phase = "failed";
				batchState.endedAt = Date.now();
				batchState.errors.push(`Unhandled engine error: ${errMsg}`);
			}
			port.postMessage({ type: "batch-state-sync", state: serializeBatchState(batchState) } satisfies WorkerOutMessage);
			port.postMessage({ type: "error", message: errMsg } satisfies WorkerOutMessage);
		});
}
