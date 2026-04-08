/**
 * Engine Child Process Entry Point (TP-071)
 *
 * This module serves two purposes:
 * 1. Exports types and helpers used by extension.ts (main thread)
 * 2. When forked as a child process, runs the engine in a separate Node.js process
 *
 * Uses child_process.fork() instead of worker_threads because Node v25's
 * default --experimental-strip-types rejects .ts files inside node_modules.
 * Fork creates a new process where --experimental-transform-types takes effect.
 *
 * Communication:
 * - Child → Parent: process.send() for notify, monitor-update, engine-event, state-sync, complete, error
 * - Parent → Child: child.send() for init, pause, resume, abort
 *
 * @module orch/engine-worker
 */
import type {
	AllocatedLane,
	EngineEvent,
	MonitorState,
	OrchBatchPhase,
	OrchBatchRuntimeState,
	OrchestratorConfig,
	SupervisorAlert,
	TaskRunnerConfig,
	WorkspaceConfig,
	WorkspaceRepoConfig,
} from "./types.ts";

// ── Types for worker <-> main thread messages ────────────────────────

/**
 * Messages sent FROM the worker TO the main thread.
 */
export type WorkerErrorSource = "enginePromise" | "uncaughtException" | "unhandledRejection";

export type WorkerToMainMessage =
	| { type: "notify"; msg: string; level: "info" | "warning" | "error" }
	| { type: "monitor-update"; state: MonitorState }
	| { type: "engine-event"; event: EngineEvent }
	| { type: "supervisor-alert"; alert: SupervisorAlert }
	| { type: "state-sync"; state: SerializedBatchState }
	| { type: "complete"; state: SerializedBatchState }
	| { type: "error"; message: string; stack?: string; source?: WorkerErrorSource };

/**
 * Messages sent FROM the main thread TO the worker.
 */
export type WorkerInMessage =
	| { type: "pause" }
	| { type: "resume" }
	| { type: "abort" };

/**
 * Serializable form of OrchBatchRuntimeState fields synced to main thread.
 * Only includes fields the main thread needs for display/state tracking.
 */
export interface SerializedBatchState {
	phase: OrchBatchPhase;
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
	/** Active lanes for the current wave (synced so /orch-sessions works). */
	currentLanes: AllocatedLane[];
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
	/** Sentinel flag — distinguishes engine worker from test-runner worker threads */
	engineWorker: true;
	/** "execute" for new batch, "resume" for resume */
	mode: "execute" | "resume";
	/** User arguments (target string) — only for "execute" mode */
	args?: string;
	/** Orchestrator configuration */
	orchConfig: OrchestratorConfig;
	/** Task runner configuration */
	runnerConfig: TaskRunnerConfig;
	/** Repository root (cwd) */
	cwd: string;
	/** Workspace configuration (serialized) — null for repo mode */
	workspaceConfig?: SerializedWorkspaceConfig | null;
	/** Workspace root directory */
	workspaceRoot?: string;
	/** Agent root directory */
	agentRoot?: string;
	/** Force flag for resume */
	force?: boolean;
	/** Supervisor autonomy mode propagated to worker bridge tools. */
	supervisorAutonomy?: "interactive" | "supervised" | "autonomous";
}

// ── Serialization helpers (used by both main thread and worker) ──────

/**
 * Serialize WorkspaceConfig for cross-thread transfer.
 * Converts the Map to an array of entries.
 */
export function serializeWorkspaceConfig(
	config: WorkspaceConfig | null | undefined,
): SerializedWorkspaceConfig | null {
	if (!config) return null;
	return {
		mode: config.mode,
		repos: [...config.repos.entries()],
		routing: config.routing,
		configPath: config.configPath,
	};
}

/**
 * Reconstruct WorkspaceConfig from serialized form.
 */
export function deserializeWorkspaceConfig(
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
		currentLanes: state.currentLanes,
	};
}

/**
 * Apply serialized batch state from worker to main-thread batch state.
 *
 * Updates only the fields that the worker thread tracks — preserves
 * main-thread-only fields like pauseSignal, dependencyGraph, etc.
 */
export function applySerializedState(
	batchState: OrchBatchRuntimeState,
	serialized: SerializedBatchState,
): void {
	batchState.phase = serialized.phase;
	batchState.batchId = serialized.batchId;
	batchState.baseBranch = serialized.baseBranch;
	batchState.orchBranch = serialized.orchBranch;
	batchState.mode = serialized.mode as OrchBatchRuntimeState["mode"];
	batchState.currentWaveIndex = serialized.currentWaveIndex;
	batchState.totalWaves = serialized.totalWaves;
	batchState.totalTasks = serialized.totalTasks;
	batchState.succeededTasks = serialized.succeededTasks;
	batchState.failedTasks = serialized.failedTasks;
	batchState.skippedTasks = serialized.skippedTasks;
	batchState.blockedTasks = serialized.blockedTasks;
	batchState.startedAt = serialized.startedAt;
	batchState.endedAt = serialized.endedAt;
	batchState.errors = [...serialized.errors];
	batchState.currentLanes = serialized.currentLanes ?? [];
}

// ── Engine main (runs when launched as a forked child process) ───────

// Guard: only run engine main when launched via fork() with the sentinel env var.
if (process.env.TASKPLANE_ENGINE_FORK === "1" && typeof process.send === "function") {
	const send = (msg: WorkerToMainMessage) => {
		try {
			process.send?.(msg);
		} catch {
			// best effort only
		}
	};

	const sendWithAck = (msg: WorkerToMainMessage, onFlushed: () => void) => {
		if (typeof process.send !== "function" || !process.connected) {
			onFlushed();
			return;
		}

		let flushed = false;
		const done = () => {
			if (flushed) return;
			flushed = true;
			onFlushed();
		};

		try {
			(process.send as (
				message: WorkerToMainMessage,
				sendHandle?: unknown,
				options?: unknown,
				callback?: (error: Error | null) => void,
			) => boolean)(msg, undefined, undefined, () => done());
			setTimeout(done, 75).unref();
		} catch {
			done();
		}
	};

	const normalizeError = (err: unknown): { message: string; stack?: string } => {
		if (err instanceof Error) return { message: err.message, stack: err.stack };
		return { message: String(err) };
	};

	// Wait for the init message carrying workerData, then start the engine.
	process.once("message", async (initMsg: { type: string; data: EngineWorkerData }) => {
		if (initMsg?.type !== "init") return;

		let batchState: OrchBatchRuntimeState | null = null;
		let fatalHandled = false;
		const reportFatalAndExit = (source: WorkerErrorSource, err: unknown) => {
			if (fatalHandled) return;
			fatalHandled = true;

			const normalized = normalizeError(err);
			if (batchState && batchState.phase !== "completed" && batchState.phase !== "failed") {
				batchState.phase = "failed";
				batchState.endedAt = Date.now();
				batchState.errors.push(`[${source}] ${normalized.message}`);
			}

			if (batchState) send({ type: "state-sync", state: serializeBatchState(batchState) });
			sendWithAck(
				{ type: "error", source, message: normalized.message, stack: normalized.stack },
				() => process.exit(1),
			);
			setTimeout(() => process.exit(1), 200).unref();
		};

		process.once("uncaughtException", (err: unknown) => reportFatalAndExit("uncaughtException", err));
		process.once("unhandledRejection", (reason: unknown) => reportFatalAndExit("unhandledRejection", reason));

		// Dynamic imports — only loaded in engine context to avoid circular
		// dependencies when this module is imported from extension.ts
		const { executeOrchBatch } = await import("./engine.ts");
		const { resumeOrchBatch } = await import("./resume.ts");
		const { freshOrchBatchState } = await import("./types.ts");

		const data = initMsg.data;

		// Create a fresh batch state for this process
		batchState = freshOrchBatchState();
		batchState.phase = "launching";
		batchState.startedAt = Date.now();

		// Deserialize workspace config
		const wsConfig = deserializeWorkspaceConfig(data.workspaceConfig);

		// ── Control signal listener ──────────────────────────────────
		// Main process sends pause/resume/abort signals via IPC.
		// We apply them to the in-process batchState.pauseSignal.
		process.on("message", (msg: WorkerInMessage) => {
			if (!batchState) return;
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
			send({ type: "notify", msg: message, level });
			if (!batchState) return;
			// Sync batch state on every notify (lightweight — just the summary fields)
			send({ type: "state-sync", state: serializeBatchState(batchState) });
		};

		const onMonitorUpdate = (state: MonitorState) => {
			send({ type: "monitor-update", state });
		};

		const onEngineEvent = (event: EngineEvent) => {
			send({ type: "engine-event", event });
		};

		// TP-076: Supervisor alert callback — sends structured alerts to main thread
		const onSupervisorAlert = (alert: import("./types.ts").SupervisorAlert) => {
			send({ type: "supervisor-alert", alert });
		};

		// ── Execute engine ───────────────────────────────────────────
		const enginePromise = data.mode === "resume"
			? resumeOrchBatch(
				data.orchConfig,
				data.runnerConfig,
				data.cwd,
				batchState,
				onNotify,
				onMonitorUpdate,
				wsConfig,
				data.workspaceRoot,
				data.agentRoot,
				data.force ?? false,
				onSupervisorAlert,
				data.supervisorAutonomy ?? "autonomous",
			)
			: executeOrchBatch(
				data.args ?? "",
				data.orchConfig,
				data.runnerConfig,
				data.cwd,
				batchState,
				onNotify,
				onMonitorUpdate,
				wsConfig,
				data.workspaceRoot,
				data.agentRoot,
				onEngineEvent,
				onSupervisorAlert,
				data.supervisorAutonomy ?? "autonomous",
			);

		enginePromise
			.then(() => {
				// Final state sync + completion signal
				const finalState = serializeBatchState(batchState);
				send({ type: "complete", state: finalState });
				// Disconnect IPC so the child process can exit cleanly
				process.disconnect?.();
			})
			.catch((err: unknown) => {
				const normalized = normalizeError(err);
				// Ensure batch state reflects the failure
				if (batchState.phase !== "completed" && batchState.phase !== "failed") {
					batchState.phase = "failed";
					batchState.endedAt = Date.now();
					batchState.errors.push(`Unhandled engine error: ${normalized.message}`);
				}
				send({ type: "state-sync", state: serializeBatchState(batchState) });
				send({ type: "error", source: "enginePromise", message: normalized.message, stack: normalized.stack });
				process.disconnect?.();
			});
	});
}
