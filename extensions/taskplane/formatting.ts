/**
 * Output formatting, dashboard widget, wave plan display
 * @module orch/formatting
 */
import { join } from "path";
import { truncateToWidth } from "@mariozechner/pi-tui";

import { parseDependencyReference } from "./discovery.ts";
import type { LaneAssignment, MonitorState, OrchBatchRuntimeState, OrchDashboardViewModel, OrchLaneCardData, OrchSummaryCounts, ParsedTask, WaveComputationResult } from "./types.ts";
import { getTaskDurationMinutes, SIZE_DURATION_MINUTES } from "./types.ts";

// ── Wave Output Formatting ───────────────────────────────────────────

// ── Dependency Graph Formatting ──────────────────────────────────────

/**
 * Format a dependency graph for display.
 *
 * Shows both upstream (what each task depends on) and downstream
 * (what depends on each task) views. Output is deterministic:
 * tasks sorted by ID, edges sorted by target ID.
 *
 * If `filterTaskId` is provided, only shows edges involving that task.
 */
export function formatDependencyGraph(
	pending: Map<string, ParsedTask>,
	completed: Set<string>,
	filterTaskId?: string,
): string {
	const lines: string[] = [];

	// Sort tasks deterministically by ID
	const sortedTasks = [...pending.values()].sort((a, b) =>
		a.taskId.localeCompare(b.taskId),
	);

	// Build downstream index: taskID → tasks that depend on it
	const downstream = new Map<string, string[]>();
	for (const task of sortedTasks) {
		for (const depRaw of task.dependencies) {
			const depId = parseDependencyReference(depRaw).taskId;
			const existing = downstream.get(depId) || [];
			existing.push(task.taskId);
			downstream.set(depId, existing);
		}
	}

	// If filtering to a single task
	if (filterTaskId) {
		const task = pending.get(filterTaskId);
		if (!task) {
			lines.push(`❌ Task "${filterTaskId}" not found in pending tasks.`);
			return lines.join("\n");
		}

		lines.push(`🔗 Dependencies for ${filterTaskId} (${task.taskName}):`);
		lines.push("");

		// Upstream: what this task depends on
		lines.push("  ⬆ Upstream (depends on):");
		if (task.dependencies.length === 0) {
			lines.push("    (none — no dependencies)");
		} else {
			const sortedDeps = [...task.dependencies].sort();
			for (const depRaw of sortedDeps) {
				const depId = parseDependencyReference(depRaw).taskId;
				const status = completed.has(depId)
					? "✅ complete"
					: pending.has(depId)
						? "⏳ pending"
						: "❓ unknown";
				lines.push(`    ${filterTaskId} → ${depRaw} (${status})`);
			}
		}

		// Downstream: what depends on this task
		lines.push("");
		lines.push("  ⬇ Downstream (depended on by):");
		const downstreamTasks = (downstream.get(filterTaskId) || []).sort();
		if (downstreamTasks.length === 0) {
			lines.push("    (none — no tasks depend on this)");
		} else {
			for (const dep of downstreamTasks) {
				lines.push(`    ${dep} → ${filterTaskId}`);
			}
		}

		return lines.join("\n");
	}

	// Full graph view
	lines.push("🔗 Dependency Graph:");
	lines.push("");

	let hasDeps = false;

	// Section 1: Upstream view (what each task depends on)
	lines.push("  ⬆ Upstream (task → depends on):");
	for (const task of sortedTasks) {
		if (task.dependencies.length > 0) {
			hasDeps = true;
			const sortedDeps = [...task.dependencies].sort();
			for (const depRaw of sortedDeps) {
				const depId = parseDependencyReference(depRaw).taskId;
				const status = completed.has(depId)
					? "✅ complete"
					: pending.has(depId)
						? "⏳ pending"
						: "❓ unknown";
				lines.push(`    ${task.taskId} → ${depRaw} (${status})`);
			}
		}
	}
	if (!hasDeps) {
		lines.push("    (none — all tasks are independent)");
	}

	// Section 2: Downstream view (what depends on each task)
	lines.push("");
	lines.push("  ⬇ Downstream (task ← depended on by):");
	let hasDownstream = false;
	const allTargets = new Set<string>();
	for (const task of sortedTasks) {
		for (const depRaw of task.dependencies) {
			allTargets.add(parseDependencyReference(depRaw).taskId);
		}
	}
	const sortedTargets = [...allTargets].sort();
	for (const target of sortedTargets) {
		const dependents = (downstream.get(target) || []).sort();
		if (dependents.length > 0) {
			hasDownstream = true;
			const status = completed.has(target)
				? "✅"
				: pending.has(target)
					? "⏳"
					: "❓";
			lines.push(
				`    ${target} ${status} ← ${dependents.join(", ")}`,
			);
		}
	}
	if (!hasDownstream) {
		lines.push("    (none — no downstream dependencies)");
	}

	// Section 3: Independent tasks (no deps, nothing depends on them)
	const independentTasks = sortedTasks.filter(
		(t) =>
			t.dependencies.length === 0 &&
			!(downstream.get(t.taskId)?.length),
	);
	if (independentTasks.length > 0) {
		lines.push("");
		lines.push("  ○ Independent (no dependencies, nothing depends on them):");
		for (const task of independentTasks) {
			lines.push(`    ${task.taskId} [${task.size}] ${task.taskName}`);
		}
	}

	return lines.join("\n");
}

/**
 * Format wave computation results as a readable execution plan.
 *
 * Output sections (fixed order):
 * 1. Wave overview header
 * 2. Per-wave: task count, lane count, parallel/serial indicator
 * 3. Per-lane within wave: tasks with sizes, serial notes, lane weight
 * 4. Per-wave: estimated duration (critical path = max lane duration)
 * 5. Summary: total estimated duration, size-to-duration table
 *
 * Duration calculation:
 * - Per lane: sum of task durations for tasks in that lane
 * - Per wave: max lane duration (parallel bottleneck / critical path)
 * - Total: sum of wave durations (waves run sequentially)
 */
export function formatWavePlan(
	result: WaveComputationResult,
	sizeWeights: Record<string, number>,
): string {
	const lines: string[] = [];

	if (result.errors.length > 0) {
		lines.push("❌ Wave Computation Errors:");
		for (const err of result.errors) {
			lines.push(`  [${err.code}] ${err.message}`);
		}
		return lines.join("\n");
	}

	if (result.waves.length === 0) {
		lines.push("No waves to schedule.");
		return lines.join("\n");
	}

	// Count total tasks
	const totalTasks = result.waves.reduce((sum, w) => sum + w.tasks.length, 0);
	const maxLanesUsed = Math.max(
		...result.waves.map((w) => {
			const lanes = new Set(w.tasks.map((t) => t.lane));
			return lanes.size;
		}),
	);

	lines.push(
		`🌊 Execution Plan: ${result.waves.length} wave(s), ` +
		`${totalTasks} task(s), up to ${maxLanesUsed} lane(s)`,
	);
	lines.push("");

	let totalEstimate = 0;
	for (const wave of result.waves) {
		// Group tasks by lane (deterministic: Map preserves insertion order)
		const laneGroups = new Map<number, LaneAssignment[]>();
		for (const assignment of wave.tasks) {
			const existing = laneGroups.get(assignment.lane) || [];
			existing.push(assignment);
			laneGroups.set(assignment.lane, existing);
		}

		const laneCount = laneGroups.size;
		const taskCount = wave.tasks.length;
		const parallel = laneCount > 1 ? "parallel" : "serial";

		lines.push(
			`  Wave ${wave.waveNumber}: ${taskCount} task(s) across ` +
			`${laneCount} lane(s) [${parallel}]`,
		);

		// Calculate wave duration: critical path = max lane duration
		let maxLaneDuration = 0;

		// Sort lanes deterministically by lane number
		const sortedLanes = [...laneGroups.entries()].sort(
			(a, b) => a[0] - b[0],
		);

		for (const [lane, assignments] of sortedLanes) {
			// Sort tasks within lane by task ID for deterministic output
			const sortedAssignments = [...assignments].sort((a, b) =>
				a.taskId.localeCompare(b.taskId),
			);
			const taskList = sortedAssignments
				.map((a) => `${a.taskId} [${a.task.size}]`)
				.join(", ");
			const laneDuration = sortedAssignments.reduce(
				(sum, a) =>
					sum + getTaskDurationMinutes(a.task.size, sizeWeights),
				0,
			);
			if (laneDuration > maxLaneDuration) maxLaneDuration = laneDuration;
			const serialNote =
				sortedAssignments.length > 1 ? " (serial)" : "";
			lines.push(
				`    Lane ${lane}: ${taskList}${serialNote}  ` +
				`[est. ${laneDuration} min]`,
			);
		}

		// Critical path for this wave
		totalEstimate += maxLaneDuration;
		lines.push(
			`    ⏱  Wave duration: ${maxLaneDuration} min ` +
			`(critical path: longest lane)`,
		);
		lines.push("");
	}

	// Summary with size-to-duration table
	const totalHours = (totalEstimate / 60).toFixed(1);
	lines.push(`📊 Total estimated duration: ${totalEstimate} min (~${totalHours} hours)`);
	lines.push(
		`   Duration model: S=${SIZE_DURATION_MINUTES["S"]}m, ` +
		`M=${SIZE_DURATION_MINUTES["M"]}m, L=${SIZE_DURATION_MINUTES["L"]}m`,
	);
	lines.push(
		"   Critical path: sum of per-wave bottleneck lanes " +
		"(waves sequential, lanes parallel)",
	);

	return lines.join("\n");
}


// ── Summary Helpers ──────────────────────────────────────────────────

/**
 * Compute summary counts from batch state + optional monitor state.
 *
 * Pure function — no side effects, deterministic output.
 */
export function computeOrchSummaryCounts(
	batchState: OrchBatchRuntimeState,
	monitorState?: MonitorState | null,
): OrchSummaryCounts {
	let running = 0;
	let stalled = 0;

	// If we have live monitor data, count running/stalled from it
	if (monitorState) {
		for (const lane of monitorState.lanes) {
			if (lane.currentTaskSnapshot) {
				if (lane.currentTaskSnapshot.status === "stalled") {
					stalled++;
				} else if (lane.currentTaskSnapshot.status === "running") {
					running++;
				}
			}
		}
	}

	const completed = batchState.succeededTasks;
	const failed = batchState.failedTasks;
	const blocked = batchState.blockedTasks;
	const total = batchState.totalTasks;
	const queued = Math.max(0, total - completed - failed - blocked - stalled - running - batchState.skippedTasks);

	return { completed, running, queued, failed, blocked, stalled, total };
}

/**
 * Format elapsed time from start/end timestamps.
 *
 * @param startMs - Start epoch ms
 * @param endMs   - End epoch ms (null = use current time)
 * @returns Human-readable string, e.g., "2m 14s" or "1h 5m 30s"
 */
export function formatElapsedTime(startMs: number, endMs?: number | null): string {
	if (startMs <= 0) return "0s";
	const elapsed = (endMs ?? Date.now()) - startMs;
	if (elapsed < 0) return "0s";

	const totalSec = Math.floor(elapsed / 1000);
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	const seconds = totalSec % 60;

	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

/**
 * Build the dashboard view-model from runtime state.
 *
 * Pure function — deterministic mapping from OrchBatchRuntimeState +
 * optional MonitorState to render-ready OrchDashboardViewModel.
 *
 * Fallback behavior:
 * - No batch → idle view with zeroed counts
 * - No monitor data → empty lane cards, counts from batch state only
 * - Missing STATUS.md → "no data" in lane card
 */
export function buildDashboardViewModel(
	batchState: OrchBatchRuntimeState,
	monitorState?: MonitorState | null,
): OrchDashboardViewModel {
	const summary = computeOrchSummaryCounts(batchState, monitorState);
	const elapsed = formatElapsedTime(batchState.startedAt, batchState.endedAt);

	const waveProgress = batchState.totalWaves > 0
		? `${Math.max(0, batchState.currentWaveIndex + 1)}/${batchState.totalWaves}`
		: "0/0";

	// Build lane cards from monitor state (if available) or current lanes
	const laneCards: OrchLaneCardData[] = [];

	if (monitorState && monitorState.lanes.length > 0) {
		// Sort lanes by laneNumber (deterministic)
		const sortedLanes = [...monitorState.lanes].sort((a, b) => a.laneNumber - b.laneNumber);

		for (const lane of sortedLanes) {
			const snap = lane.currentTaskSnapshot;
			let status: OrchLaneCardData["status"] = "idle";
			if (lane.failedTasks.length > 0) status = "failed";
			else if (snap?.status === "stalled") status = "stalled";
			else if (snap?.status === "running") status = "running";
			else if (lane.completedTasks.length > 0 && lane.remainingTasks.length === 0 && !lane.currentTaskId) status = "succeeded";

			laneCards.push({
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				sessionName: lane.sessionName,
				sessionAlive: lane.sessionAlive,
				currentTaskId: lane.currentTaskId,
				currentStepName: snap?.currentStepName || null,
				totalChecked: snap?.totalChecked || 0,
				totalItems: snap?.totalItems || 0,
				completedTasks: lane.completedTasks.length,
				totalLaneTasks: lane.completedTasks.length + lane.failedTasks.length + lane.remainingTasks.length + (lane.currentTaskId ? 1 : 0),
				status,
				stallReason: snap?.stallReason || null,
			});
		}
	} else if (batchState.currentLanes.length > 0) {
		// No monitor data yet — show lanes from allocation
		const sortedLanes = [...batchState.currentLanes].sort((a, b) => a.laneNumber - b.laneNumber);
		for (const lane of sortedLanes) {
			laneCards.push({
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				sessionName: lane.laneSessionId,
				sessionAlive: true, // assumed alive during allocation
				currentTaskId: lane.tasks.length > 0 ? lane.tasks[0].taskId : null,
				currentStepName: null,
				totalChecked: 0,
				totalItems: 0,
				completedTasks: 0,
				totalLaneTasks: lane.tasks.length,
				status: "running",
				stallReason: null,
			});
		}
	}

	// Determine attach hint
	let attachHint = "";
	const aliveLane = laneCards.find(l => l.sessionAlive && l.status === "running");
	if (aliveLane) {
		attachHint = `tmux attach -t ${aliveLane.sessionName}`;
	} else if (laneCards.length > 0) {
		attachHint = "/orch-sessions for session list";
	}

	// Determine failure policy if batch was stopped
	let failurePolicy: string | null = null;
	if (batchState.phase === "stopped" && batchState.waveResults.length > 0) {
		const lastWave = batchState.waveResults[batchState.waveResults.length - 1];
		if (lastWave.stoppedEarly && lastWave.policyApplied) {
			failurePolicy = lastWave.policyApplied;
		}
	}

	return {
		phase: batchState.phase,
		batchId: batchState.batchId,
		orchBranch: batchState.orchBranch || batchState.baseBranch || "",
		waveProgress,
		elapsed,
		summary,
		laneCards,
		attachHint,
		errors: batchState.errors,
		failurePolicy,
	};
}

// ── Lane Card Rendering ──────────────────────────────────────────────

/**
 * Render a single lane card for the dashboard.
 *
 * Follows the task-runner `renderStepCard` pattern:
 * bordered box with lane info, status icon, task progress.
 *
 * @param card     - Lane card data from view-model
 * @param colWidth - Available width for the card (including borders)
 * @param theme    - Pi theme object for color styling
 * @returns Array of styled string lines (one per card row)
 */
export function renderLaneCard(card: OrchLaneCardData, colWidth: number, theme: any): string[] {
	const w = colWidth - 2; // inner width (excluding │ borders)
	const trunc = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + "..." : s;

	// Status icon and color
	const statusIcon = card.status === "succeeded" ? "✓"
		: card.status === "running" ? "●"
		: card.status === "failed" ? "✗"
		: card.status === "stalled" ? "⚠"
		: "○";
	const statusColor = card.status === "succeeded" ? "success"
		: card.status === "running" ? "accent"
		: card.status === "failed" ? "error"
		: card.status === "stalled" ? "warning"
		: "dim";

	// Line 1: Session name (e.g., "⎡orch-lane-1⎤")
	const sessionLabel = `⎡${card.sessionName}⎤`;
	const sessionStr = theme.fg("accent", theme.bold(trunc(sessionLabel, w)));
	const sessionVis = Math.min(sessionLabel.length, w);

	// Line 2: Status + current task
	const taskInfo = card.currentTaskId
		? `${statusIcon} ${card.currentTaskId}`
		: card.status === "succeeded" ? `${statusIcon} done`
		: card.status === "failed" ? `${statusIcon} failed`
		: `${statusIcon} idle`;
	const taskStr = theme.fg(statusColor, trunc(taskInfo, w));
	const taskVis = Math.min(taskInfo.length, w);

	// Line 3: Step progress
	let stepInfo = "";
	if (card.currentStepName) {
		stepInfo = trunc(card.currentStepName, w - 2);
	} else if (card.currentTaskId && card.totalItems === 0) {
		stepInfo = "waiting for data...";
	} else if (!card.currentTaskId && card.status !== "idle") {
		stepInfo = `${card.completedTasks}/${card.totalLaneTasks} tasks`;
	}
	const stepStr = theme.fg("muted", trunc(stepInfo, w));
	const stepVis = Math.min(stepInfo.length, w);

	// Line 4: Checkbox progress or stall reason
	let extraInfo = "";
	let extraColor = "dim";
	if (card.stallReason) {
		extraInfo = `⚠ ${trunc(card.stallReason, w - 4)}`;
		extraColor = "warning";
	} else if (card.totalItems > 0) {
		extraInfo = `${card.totalChecked}/${card.totalItems} ✓`;
		extraColor = card.totalChecked === card.totalItems ? "success" : "muted";
	} else if (!card.sessionAlive && card.status === "running") {
		extraInfo = "session dead";
		extraColor = "error";
	}
	const extraStr = theme.fg(extraColor, trunc(extraInfo, w));
	const extraVis = Math.min(extraInfo.length, w);

	// Build bordered card
	const top = "┌" + "─".repeat(w) + "┐";
	const bot = "└" + "─".repeat(w) + "┘";
	const border = (content: string, vis: number) =>
		theme.fg("dim", "│") + content + " ".repeat(Math.max(0, w - vis)) + theme.fg("dim", "│");

	return [
		theme.fg("dim", top),
		border(" " + sessionStr, 1 + sessionVis),
		border(" " + taskStr, 1 + taskVis),
		border(" " + stepStr, 1 + stepVis),
		border(extraInfo ? " " + extraStr : "", extraVis ? 1 + extraVis : 0),
		theme.fg("dim", bot),
	];
}

// ── Core Widget ──────────────────────────────────────────────────────

/**
 * Create the widget registration callback for the orchestrator dashboard.
 *
 * This is the main entry point for the dashboard widget. It captures
 * batchState and monitorState references and returns a widget that
 * re-renders on each paint cycle using the latest state.
 *
 * @param getBatchState   - Getter for current batch state
 * @param getMonitorState - Getter for current monitor state (may be null)
 * @param sessionPrefix   - Session prefix for lane identification
 */
export function createOrchWidget(
	getBatchState: () => OrchBatchRuntimeState,
	getMonitorState: () => MonitorState | null,
	sessionPrefix: string,
): (_tui: any, theme: any) => { render(width: number): string[]; invalidate(): void } {
	return (_tui: any, theme: any) => {
		return {
			render(width: number): string[] {
				const batchState = getBatchState();
				const monitorState = getMonitorState();
				const vm = buildDashboardViewModel(batchState, monitorState);

				// ── Idle state ─────────────────────────────────
				if (vm.phase === "idle") {
					return [];
				}

				const lines: string[] = [""];

				// ── Phase-specific rendering ──────────────────
				const phaseIcon =
					vm.phase === "launching" ? "◌"
					: vm.phase === "planning" ? "◌"
					: vm.phase === "executing" ? "●"
					: vm.phase === "merging" ? "🔀"
					: vm.phase === "paused" ? "⏸"
					: vm.phase === "stopped" ? "⛔"
					: vm.phase === "completed" ? "✓"
					: vm.phase === "failed" ? "✗"
					: "○";
				const phaseColor =
					vm.phase === "executing" ? "accent"
					: vm.phase === "merging" ? "accent"
					: vm.phase === "completed" ? "success"
					: vm.phase === "failed" || vm.phase === "stopped" ? "error"
					: vm.phase === "paused" ? "warning"
					: "dim";

				// Header: phase icon + batch ID + wave + elapsed
				const header =
					theme.fg(phaseColor, ` ${phaseIcon} `) +
					theme.fg("accent", theme.bold(vm.batchId || "—")) +
					theme.fg("dim", "  ") +
					theme.fg("warning", `W${vm.waveProgress}`) +
					theme.fg("dim", " · ") +
					theme.fg("muted", vm.elapsed);
				lines.push(truncateToWidth(header, width));

				// ── Planning state ────────────────────────────
				if (vm.phase === "planning") {
					lines.push(truncateToWidth(
						theme.fg("dim", "  ◌ Planning batch..."),
						width,
					));
					return lines;
				}

				// ── Progress bar ──────────────────────────────
				const { completed, failed, total } = vm.summary;
				const done = completed + failed;
				const pct = total > 0 ? Math.round((done / total) * 100) : 0;
				const barWidth = Math.min(30, width - 20);
				const filled = Math.round((pct / 100) * barWidth);
				const progressBar =
					theme.fg("dim", "  ") +
					theme.fg("warning", "[") +
					theme.fg("success", "█".repeat(filled)) +
					theme.fg("dim", "░".repeat(Math.max(0, barWidth - filled))) +
					theme.fg("warning", "]") +
					theme.fg("dim", " ") +
					theme.fg("accent", `${done}/${total}`) +
					theme.fg("dim", ` (${pct}%)`);
				lines.push(truncateToWidth(progressBar, width));

				// ── Summary counts line ───────────────────────
				const countParts: string[] = [];
				if (vm.summary.completed > 0) countParts.push(theme.fg("success", `${vm.summary.completed} ✓`));
				if (vm.summary.running > 0) countParts.push(theme.fg("accent", `${vm.summary.running} running`));
				if (vm.summary.queued > 0) countParts.push(theme.fg("dim", `${vm.summary.queued} queued`));
				if (vm.summary.failed > 0) countParts.push(theme.fg("error", `${vm.summary.failed} ✗`));
				if (vm.summary.blocked > 0) countParts.push(theme.fg("warning", `${vm.summary.blocked} blocked`));
				if (vm.summary.stalled > 0) countParts.push(theme.fg("warning", `${vm.summary.stalled} stalled`));
				if (countParts.length > 0) {
					lines.push(truncateToWidth("  " + countParts.join(theme.fg("dim", " · ")), width));
				}
				lines.push("");

				// ── Lane cards ─────────────────────────────────
				if (vm.laneCards.length > 0 && (vm.phase === "executing" || vm.phase === "merging" || vm.phase === "paused")) {
					const arrowWidth = 3;
					const minCardWidth = 18;
					const maxCols = Math.max(1, Math.floor((width + arrowWidth) / (minCardWidth + arrowWidth)));
					const cols = Math.min(vm.laneCards.length, maxCols);
					const colWidth = Math.max(minCardWidth, Math.floor((width - arrowWidth * (cols - 1)) / cols));

					for (let rowStart = 0; rowStart < vm.laneCards.length; rowStart += cols) {
						const rowCards = vm.laneCards.slice(rowStart, rowStart + cols);
						const rendered = rowCards.map(c => renderLaneCard(c, colWidth, theme));

						if (rendered.length > 0) {
							const cardHeight = rendered[0].length;
							for (let line = 0; line < cardHeight; line++) {
								let row = rendered[0][line];
								for (let c = 1; c < rendered.length; c++) {
									row += "   "; // spacer between cards
									row += rendered[c][line];
								}
								lines.push(truncateToWidth(row, width));
							}
						}
					}
				}

				// ── Terminal states (completed/failed/stopped) ──
				if (vm.phase === "completed") {
					lines.push(truncateToWidth(
						theme.fg("success", "  ✅ Batch complete"),
						width,
					));
				} else if (vm.phase === "failed") {
					lines.push(truncateToWidth(
						theme.fg("error", "  ❌ Batch failed"),
						width,
					));
					for (const err of vm.errors.slice(0, 3)) {
						lines.push(truncateToWidth(
							theme.fg("error", `     ${err.slice(0, 80)}`),
							width,
						));
					}
				} else if (vm.phase === "stopped") {
					lines.push(truncateToWidth(
						theme.fg("error", `  ⛔ Stopped by ${vm.failurePolicy || "policy"}`),
						width,
					));
				} else if (vm.phase === "merging") {
					lines.push("");
					lines.push(truncateToWidth(
						theme.fg("accent", `  🔀 Merging lane branches into ${vm.orchBranch || "orch branch"}...`),
						width,
					));
				} else if (vm.phase === "paused") {
					lines.push("");
					lines.push(truncateToWidth(
						theme.fg("warning", "  ⏸ Batch paused — lanes will stop after current tasks"),
						width,
					));
				}

				// ── Footer: attach hint ───────────────────────
				if (vm.attachHint && (vm.phase === "executing" || vm.phase === "merging" || vm.phase === "paused")) {
					lines.push("");
					lines.push(truncateToWidth(
						theme.fg("dim", `  💡 ${vm.attachHint}`),
						width,
					));
				}

				return lines;
			},
			invalidate() {},
		};
	};
}

