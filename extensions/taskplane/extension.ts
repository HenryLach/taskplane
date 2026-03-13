import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { applyExtensionDefaults } from "../themeMap.ts";
import { execSync } from "child_process";

import {
	DEFAULT_ORCHESTRATOR_CONFIG,
	DEFAULT_TASK_RUNNER_CONFIG,
	ORCH_MESSAGES,
	computeWaveAssignments,
	createOrchWidget,
	deleteBatchState,
	detectOrphanSessions,
	executeAbort,
	executeLane,
	executeOrchBatch,
	formatDependencyGraph,
	formatDiscoveryResults,
	formatOrchSessions,
	formatPreflightResults,
	formatWavePlan,
	freshOrchBatchState,
	listOrchSessions,
	loadBatchState,
	loadOrchestratorConfig,
	loadTaskRunnerConfig,
	parseOrchSessionNames,
	resumeOrchBatch,
	runDiscovery,
	runPreflight,
} from "./index.ts";
import type {
	AbortMode,
	MonitorState,
	OrchestratorConfig,
	PersistedBatchState,
	TaskRunnerConfig,
} from "./index.ts";

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let orchBatchState = freshOrchBatchState();
	let orchConfig: OrchestratorConfig = { ...DEFAULT_ORCHESTRATOR_CONFIG };
	let runnerConfig: TaskRunnerConfig = { ...DEFAULT_TASK_RUNNER_CONFIG };
	let orchWidgetCtx: ExtensionContext | undefined;
	let latestMonitorState: MonitorState | null = null;

	// ── Widget Rendering ─────────────────────────────────────────────

	function updateOrchWidget() {
		if (!orchWidgetCtx) return;
		const ctx = orchWidgetCtx;
		const prefix = orchConfig.orchestrator.tmux_prefix;

		ctx.ui.setWidget(
			"task-orchestrator",
			createOrchWidget(
				() => orchBatchState,
				() => latestMonitorState,
				prefix,
			),
		);
	}

	// ── Commands ─────────────────────────────────────────────────────

	pi.registerCommand("orch", {
		description: "Start batch execution: /orch <areas|paths|all>",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify(
					"Usage: /orch <areas|paths|all>\n\n" +
					"Examples:\n" +
					"  /orch all                          Run all pending tasks\n" +
					"  /orch time-off performance-management   Run specific areas\n" +
					"  /orch path/to/tasks                Scan directory\n" +
					"  /orch path/to/PROMPT.md            Single task with isolation",
					"info",
				);
				return;
			}

			// Prevent concurrent batch execution (merging is an active state)
			if (orchBatchState.phase !== "idle" && orchBatchState.phase !== "completed" && orchBatchState.phase !== "failed" && orchBatchState.phase !== "stopped") {
				ctx.ui.notify(
					`⚠️ A batch is already ${orchBatchState.phase} (${orchBatchState.batchId}). ` +
					`Use /orch-pause to pause or wait for completion.`,
					"warning",
				);
				return;
			}

			// ── Orphan detection (TS-009 Step 3) ─────────────────────
			const orphanResult = detectOrphanSessions(
				orchConfig.orchestrator.tmux_prefix,
				ctx.cwd,
			);

			switch (orphanResult.recommendedAction) {
				case "resume": {
					// Safety net: if the persisted phase is not actually resumable (e.g. "failed",
					// "stopped") — which can happen when the batch crashed after writing a terminal
					// phase but before /orch-abort cleaned up — auto-delete the state file and
					// fall through to start fresh rather than blocking the user with a catch-22.
					const resumablePhases = ["paused", "executing", "merging"];
					const phase = orphanResult.loadedState?.phase ?? "";
					const hasOrphans = orphanResult.orphanSessions.length > 0;
					if (!hasOrphans && !resumablePhases.includes(phase)) {
						try { deleteBatchState(ctx.cwd); } catch { /* best effort */ }
						ctx.ui.notify(
							`🧹 Cleared non-resumable stale batch (${orphanResult.loadedState?.batchId}, phase=${phase}). Starting fresh.`,
							"info",
						);
						break; // fall through to start a new batch
					}
					// Genuinely resumable or has live orphan sessions — prompt user
					ctx.ui.notify(orphanResult.userMessage, "warning");
					return;
				}

				case "abort-orphans":
					// Orphan sessions without usable state
					ctx.ui.notify(orphanResult.userMessage, "warning");
					return;

				case "cleanup-stale":
					// No orphans + stale/invalid state file — auto-delete and continue
					try {
						deleteBatchState(ctx.cwd);
					} catch {
						// Best-effort cleanup — proceed even if delete fails
					}
					if (orphanResult.userMessage) {
						ctx.ui.notify(orphanResult.userMessage, "info");
					}
					break;

				case "start-fresh":
					// No orphans, no state file — proceed normally
					break;
			}

			// Reset batch state for new execution
			orchBatchState = freshOrchBatchState();
			latestMonitorState = null;
			updateOrchWidget();

			await executeOrchBatch(
				args,
				orchConfig,
				runnerConfig,
				ctx.cwd,
				orchBatchState,
				(message, level) => {
					ctx.ui.notify(message, level);
					updateOrchWidget(); // Refresh widget on every phase message
				},
				(monState: MonitorState) => {
					const changed = !latestMonitorState ||
						latestMonitorState.totalDone !== monState.totalDone ||
						latestMonitorState.totalFailed !== monState.totalFailed ||
						latestMonitorState.lanes.some((l, i) =>
							l.currentTaskId !== monState.lanes[i]?.currentTaskId ||
							l.currentStep !== monState.lanes[i]?.currentStep ||
							l.completedChecks !== monState.lanes[i]?.completedChecks,
						);
					latestMonitorState = monState;
					if (changed) updateOrchWidget(); // Only refresh on actual state change
				},
			);

			// Final widget update after batch completes
			updateOrchWidget();
		},
	});

	pi.registerCommand("orch-plan", {
		description: "Preview execution plan: /orch-plan <areas|paths|all> [--refresh]",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify(
					"Usage: /orch-plan <areas|paths|all> [--refresh]\n\n" +
					"Shows the execution plan (tasks, waves, lane assignments)\n" +
					"without actually executing anything.\n\n" +
					"Options:\n" +
					"  --refresh   Force re-scan of areas (bypass dependency cache)\n\n" +
					"Examples:\n" +
					"  /orch-plan all\n" +
					"  /orch-plan time-off notifications\n" +
					"  /orch-plan docs/task-management/domains/time-off/tasks\n" +
					"  /orch-plan all --refresh",
					"info",
				);
				return;
			}

			// Parse --refresh flag
			const hasRefresh = /--refresh/.test(args);
			const cleanArgs = args.replace(/--refresh/g, "").trim();
			if (!cleanArgs) {
				ctx.ui.notify(
					"Usage: /orch-plan <areas|paths|all> [--refresh]\n" +
					"Error: target argument required (e.g., 'all', area name, or path)",
					"error",
				);
				return;
			}
			if (hasRefresh) {
				ctx.ui.notify("🔄 Refresh mode: re-scanning all areas (cache bypassed)", "info");
			}

			// ── Section 1: Preflight ─────────────────────────────────
			const preflight = runPreflight(orchConfig);
			ctx.ui.notify(formatPreflightResults(preflight), preflight.passed ? "info" : "error");
			if (!preflight.passed) return;

			// ── Section 2: Discovery ─────────────────────────────────
			const discovery = runDiscovery(cleanArgs, runnerConfig.task_areas, ctx.cwd, {
				refreshDependencies: hasRefresh,
				dependencySource: orchConfig.dependencies.source,
				useDependencyCache: orchConfig.dependencies.cache,
			});
			ctx.ui.notify(formatDiscoveryResults(discovery), discovery.errors.length > 0 ? "warning" : "info");

			// Check for fatal errors
			const fatalErrors = discovery.errors.filter(
				(e) =>
					e.code === "DUPLICATE_ID" ||
					e.code === "DEP_UNRESOLVED" ||
					e.code === "DEP_PENDING" ||
					e.code === "DEP_AMBIGUOUS" ||
					e.code === "PARSE_MISSING_ID",
			);
			if (fatalErrors.length > 0) {
				ctx.ui.notify("❌ Cannot compute plan due to discovery errors above.", "error");
				return;
			}

			if (discovery.pending.size === 0) {
				ctx.ui.notify("No pending tasks found. Nothing to plan.", "info");
				return;
			}

			// ── Section 3: Dependency Graph ──────────────────────────
			ctx.ui.notify(
				formatDependencyGraph(discovery.pending, discovery.completed),
				"info",
			);

			// ── Section 4: Waves + Estimate ──────────────────────────
			// Uses computeWaveAssignments pipeline only — NO re-parsing
			const waveResult = computeWaveAssignments(
				discovery.pending,
				discovery.completed,
				orchConfig,
			);

			ctx.ui.notify(
				formatWavePlan(waveResult, orchConfig.assignment.size_weights),
				waveResult.errors.length > 0 ? "error" : "info",
			);
		},
	});

	pi.registerCommand("orch-status", {
		description: "Show current batch progress",
		handler: async (_args, ctx) => {
			if (orchBatchState.phase === "idle") {
				ctx.ui.notify("No batch is running. Use /orch <areas|paths|all> to start.", "info");
				return;
			}

			const elapsedSec = orchBatchState.endedAt
				? Math.round((orchBatchState.endedAt - orchBatchState.startedAt) / 1000)
				: Math.round((Date.now() - orchBatchState.startedAt) / 1000);

			const lines: string[] = [
				`📊 Batch ${orchBatchState.batchId} — ${orchBatchState.phase}`,
				`   Wave: ${orchBatchState.currentWaveIndex + 1}/${orchBatchState.totalWaves}`,
				`   Tasks: ${orchBatchState.succeededTasks} succeeded, ${orchBatchState.failedTasks} failed, ${orchBatchState.skippedTasks} skipped, ${orchBatchState.blockedTasks} blocked / ${orchBatchState.totalTasks} total`,
				`   Elapsed: ${elapsedSec}s`,
			];

			if (orchBatchState.errors.length > 0) {
				lines.push(`   Errors: ${orchBatchState.errors.length}`);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("orch-pause", {
		description: "Pause batch after current tasks finish",
		handler: async (_args, ctx) => {
			if (orchBatchState.phase === "idle" || orchBatchState.phase === "completed" || orchBatchState.phase === "failed" || orchBatchState.phase === "stopped") {
				ctx.ui.notify(ORCH_MESSAGES.pauseNoBatch(), "warning");
				return;
			}
			if (orchBatchState.phase === "paused" || orchBatchState.pauseSignal.paused) {
				ctx.ui.notify(ORCH_MESSAGES.pauseAlreadyPaused(orchBatchState.batchId), "warning");
				return;
			}
			// Set pause signal — executeLane() checks this between tasks
			orchBatchState.pauseSignal.paused = true;
			ctx.ui.notify(ORCH_MESSAGES.pauseActivated(orchBatchState.batchId), "info");
			updateOrchWidget();
		},
	});

	pi.registerCommand("orch-resume", {
		description: "Resume a paused or interrupted batch",
		handler: async (_args, ctx) => {
			// Prevent resume if a batch is actively running
			if (orchBatchState.phase === "executing" || orchBatchState.phase === "merging" || orchBatchState.phase === "planning") {
				ctx.ui.notify(
					`⚠️ A batch is currently ${orchBatchState.phase} (${orchBatchState.batchId}). Cannot resume.`,
					"warning",
				);
				return;
			}

			// Reset batch state for resume
			orchBatchState = freshOrchBatchState();
			latestMonitorState = null;
			updateOrchWidget();

			await resumeOrchBatch(
				orchConfig,
				runnerConfig,
				ctx.cwd,
				orchBatchState,
				(message, level) => {
					ctx.ui.notify(message, level);
					updateOrchWidget();
				},
				(monState: MonitorState) => {
					latestMonitorState = monState;
					updateOrchWidget();
				},
			);

			// Final widget update
			updateOrchWidget();
		},
	});

	pi.registerCommand("orch-abort", {
		description: "Abort batch: /orch-abort [--hard]",
		handler: async (args, ctx) => {
			const hard = args?.trim() === "--hard";
			const mode: AbortMode = hard ? "hard" : "graceful";
			const prefix = orchConfig.orchestrator.tmux_prefix;
			const gracePeriodMs = orchConfig.orchestrator.abort_grace_period * 1000;

			// Check for active in-memory batch
			const hasActiveBatch = orchBatchState.phase !== "idle" &&
				orchBatchState.phase !== "completed" &&
				orchBatchState.phase !== "failed" &&
				orchBatchState.phase !== "stopped";

			// Also check for persisted state (abort can work on orphaned batches too)
			let persistedState: PersistedBatchState | null = null;
			try {
				persistedState = loadBatchState(ctx.cwd);
			} catch {
				// Ignore — we may still have in-memory state or orphan sessions
			}

			// If no in-memory batch AND no persisted state, check for orphan sessions
			if (!hasActiveBatch && !persistedState) {
				// Last chance: check for orphan sessions
				const sessionNames = parseOrchSessionNames(
					(() => {
						try {
							return execSync('tmux list-sessions -F "#{session_name}"', {
								encoding: "utf-8",
								timeout: 5000,
							});
						} catch {
							return "";
						}
					})(),
					prefix,
				);
				if (sessionNames.length === 0) {
					ctx.ui.notify(ORCH_MESSAGES.abortNoBatch(), "warning");
					return;
				}
				// If orphan sessions exist, proceed with abort (will kill them)
			}

			const batchId = orchBatchState.batchId || persistedState?.batchId || "unknown";

			// Notify user of abort start
			if (mode === "graceful") {
				const sessionCount = orchBatchState.currentLanes.length || persistedState?.tasks.length || 0;
				ctx.ui.notify(ORCH_MESSAGES.abortGracefulStarting(batchId, sessionCount), "info");
				ctx.ui.notify(
					ORCH_MESSAGES.abortGracefulWaiting(batchId, orchConfig.orchestrator.abort_grace_period),
					"info",
				);
			} else {
				const sessionCount = orchBatchState.currentLanes.length || persistedState?.tasks.length || 0;
				ctx.ui.notify(ORCH_MESSAGES.abortHardStarting(batchId, sessionCount), "info");
			}

			// Execute abort
			const result = await executeAbort(
				mode,
				prefix,
				ctx.cwd,
				orchBatchState,
				persistedState,
				gracePeriodMs,
			);

			// Update in-memory batch state
			orchBatchState.phase = "stopped";
			orchBatchState.endedAt = result.durationMs + Date.now() - result.durationMs; // Use actual time
			updateOrchWidget();

			// Notify results
			const durationSec = Math.round(result.durationMs / 1000);
			if (mode === "graceful") {
				const forceKilled = result.sessionsKilled - result.gracefulExits;
				if (forceKilled > 0) {
					ctx.ui.notify(
						ORCH_MESSAGES.abortGracefulForceKill(forceKilled),
						"warning",
					);
				}
				ctx.ui.notify(
					ORCH_MESSAGES.abortGracefulComplete(batchId, result.gracefulExits, forceKilled, durationSec),
					"info",
				);
			} else {
				ctx.ui.notify(
					ORCH_MESSAGES.abortHardComplete(batchId, result.sessionsKilled, durationSec),
					"info",
				);
			}

			// Report errors if any
			if (result.errors.length > 0) {
				const errorDetails = result.errors.map(e => `  • [${e.code}] ${e.message}`).join("\n");
				ctx.ui.notify(
					`${ORCH_MESSAGES.abortPartialFailure(result.errors.length)}\n${errorDetails}`,
					"warning",
				);
			}

			// Final message
			ctx.ui.notify(
				ORCH_MESSAGES.abortComplete(mode, result.sessionsKilled),
				"info",
			);
		},
	});

	pi.registerCommand("orch-deps", {
		description: "Show dependency graph: /orch-deps <areas|paths|all> [--refresh] [--task <id>]",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify(
					"Usage: /orch-deps <areas|paths|all> [--refresh] [--task <id>]\n\n" +
					"Shows the dependency graph for tasks in the specified areas.\n\n" +
					"Options:\n" +
					"  --refresh       Force re-scan of areas (bypass dependency cache)\n" +
					"  --task <id>     Show dependencies for a single task only\n\n" +
					"Examples:\n" +
					"  /orch-deps all\n" +
					"  /orch-deps all --task TO-014\n" +
					"  /orch-deps time-off --refresh\n" +
					"  /orch-deps all --task COMP-006 --refresh",
					"info",
				);
				return;
			}

			// Parse --refresh flag
			const hasRefresh = /--refresh/.test(args);

			// Parse --task <id> flag
			let filterTaskId: string | undefined;
			const taskMatch = args.match(/--task\s+([A-Z]+-\d+)/i);
			if (taskMatch) {
				filterTaskId = taskMatch[1].toUpperCase();
			}

			// Strip flags to get clean area/path arguments
			let cleanArgs = args
				.replace(/--refresh/g, "")
				.replace(/--task\s+[A-Z]+-\d+/gi, "")
				.trim();

			if (!cleanArgs) {
				ctx.ui.notify(
					"Usage: /orch-deps <areas|paths|all> [--refresh] [--task <id>]\n" +
					"Error: target argument required (e.g., 'all', area name, or path)",
					"error",
				);
				return;
			}

			if (hasRefresh) {
				ctx.ui.notify("🔄 Refresh mode: re-scanning all areas (dependency cache bypassed)", "info");
			}

			// Run discovery (no preflight needed for deps view)
			const discovery = runDiscovery(cleanArgs, runnerConfig.task_areas, ctx.cwd, {
				refreshDependencies: hasRefresh,
				dependencySource: orchConfig.dependencies.source,
				useDependencyCache: orchConfig.dependencies.cache,
			});
			ctx.ui.notify(
				formatDiscoveryResults(discovery),
				discovery.errors.length > 0 ? "warning" : "info",
			);

			// Show dependency graph (full or filtered)
			if (discovery.pending.size > 0) {
				ctx.ui.notify(
					formatDependencyGraph(
						discovery.pending,
						discovery.completed,
						filterTaskId,
					),
					"info",
				);
			}
		},
	});

	pi.registerCommand("orch-sessions", {
		description: "List active orchestrator TMUX sessions",
		handler: async (_args, ctx) => {
			const sessions = listOrchSessions(orchConfig.orchestrator.tmux_prefix, orchBatchState);
			ctx.ui.notify(formatOrchSessions(sessions), "info");
		},
	});

	// ── Session Lifecycle ────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		applyExtensionDefaults(import.meta.url, ctx);

		// Load configs
		orchConfig = loadOrchestratorConfig(ctx.cwd);
		runnerConfig = loadTaskRunnerConfig(ctx.cwd);

		// Store widget context for dashboard updates
		orchWidgetCtx = ctx;

		// Set status line
		const areaCount = Object.keys(runnerConfig.task_areas).length;
		ctx.ui.setStatus(
			"task-orchestrator",
			`🔀 Orchestrator · ${areaCount} areas · ${orchConfig.orchestrator.max_lanes} lanes`,
		);

		// Register initial dashboard widget (idle state)
		updateOrchWidget();

		// Notify user of available commands
		ctx.ui.notify(
			"Task Orchestrator ready\n\n" +
			`Config: ${orchConfig.orchestrator.max_lanes} lanes, ` +
			`${orchConfig.orchestrator.spawn_mode} mode, ` +
			`${orchConfig.dependencies.source} deps\n` +
			`Areas: ${areaCount} registered\n\n` +
			"/orch <areas|all>        Start batch execution\n" +
			"/orch-plan <areas|all>   Preview execution plan\n" +
			"/orch-deps <areas|all>   Show dependency graph\n" +
			"/orch-sessions           List TMUX sessions",
			"info",
		);
	});
}

