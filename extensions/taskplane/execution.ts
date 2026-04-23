/**
 * Lane execution, monitoring, wave execution loop
 * @module orch/execution
 */
import { readFileSync, existsSync, statSync, unlinkSync, mkdirSync, writeFileSync, copyFileSync } from "fs";
import { access as fsAccess, readFile as fsReadFile, stat as fsStat } from "fs/promises";
import { join, dirname, basename, resolve, relative, delimiter as pathDelimiter } from "path";
import { userInfo } from "os";

import { DONE_GRACE_MS, EXECUTION_POLL_INTERVAL_MS, ExecutionError, SESSION_SPAWN_RETRY_MAX } from "./types.ts";
import type { AllocatedLane, AllocatedTask, DependencyGraph, LaneExecutionResult, LaneMonitorSnapshot, LaneTaskOutcome, LaneTaskStatus, MonitorState, MtimeTracker, OrchestratorConfig, ParsedTask, TaskMonitorSnapshot, WaveExecutionResult, WorkspaceConfig, ExecutionUnit, PacketPaths, RuntimeAgentId, RuntimeAgentRole, SupervisorAlertCallback, RuntimeLaneSnapshot, RuntimeLaneSubmoduleDiagnostics, RuntimeUnsafeSubmoduleFinding, RuntimeSubmoduleSnapshot } from "./types.ts";
import { resolvePacketPaths, buildRuntimeAgentId, runtimeLaneSnapshotPath } from "./types.ts";
import { readRegistrySnapshot, readLaneSnapshot, isTerminalStatus, isProcessAlive, detectOrphans, markOrphansCrashed, buildRegistrySnapshot, writeRegistrySnapshot, writeLaneSnapshot } from "./process-registry.ts";
import { allocateLanes } from "./waves.ts";
import { resolveOperatorId } from "./naming.ts";
import { captureSubmoduleStatusSnapshot, detectUnsafeSubmoduleStates, runGit, runGitWithEnv } from "./git.ts";
import { resolveTaskplanePackageFile, resolveTaskplaneAgentTemplate } from "./path-resolver.ts";
import { resolvePointer, loadWorkspaceConfig } from "./workspace.ts";

// ── Taskplane Package File Resolution ────────────────────────────────
// getNpmGlobalRoot() and resolveTaskplanePackageFile() consolidated in path-resolver.ts (TP-157)

// ── RPC Wrapper Path Resolution ──────────────────────────────────────

/**
 * Find the rpc-wrapper.mjs path for lane sessions.
 * @see resolveTaskplanePackageFile for resolution order
 */
// resolveRpcWrapperPath removed (TP-120 remediation: legacy session-backend dead code)

// ── Telemetry Helpers ────────────────────────────────────────────────

// resolveTelemOpId removed (TP-120 remediation: only consumer was generateTelemetryPaths)

// sanitizeForFilename + generateTelemetryPaths removed (TP-120 remediation: legacy telemetry dead code)

// generateTelemetryPaths removed (TP-120 remediation: legacy telemetry sidecar dead code)

// ── Execution Helpers ────────────────────────────────────────────────

/**
 * Structured log helper for lane execution.
 *
 * All execution logs go to stderr.
 * Format: [orch] {laneId}/{taskId}: {message}
 * Correlation fields: batchId, laneId, taskId, sessionName.
 * No PII — only IDs and paths.
 */
export function execLog(
	laneId: string,
	taskId: string,
	message: string,
	extra?: Record<string, string | number | boolean>,
): void {
	const prefix = `[orch] ${laneId}/${taskId}`;
	if (extra) {
		const fields = Object.entries(extra)
			.map(([k, v]) => `${k}=${v}`)
			.join(" ");
		console.error(`${prefix}: ${message} (${fields})`);
	} else {
		console.error(`${prefix}: ${message}`);
	}
}

/**
 * TP-112: Check if a V2 agent is alive via process registry.
 * Returns true if the agent's PID is running and status is non-terminal.
 * Returns false if no registry, no entry, terminal status, or dead PID.
 *
 * @param agentIdOrSessionName - Agent ID or session name to look up
 * @param runtimeBackend - Must be "v2" (caller should guard)
 * @returns true if agent is alive
 * @since TP-112
 */
export function isV2AgentAlive(agentIdOrSessionName: string, _runtimeBackend?: RuntimeBackend, laneNumber?: number): boolean {
	// Read the registry from the global state root.
	// Since this is a pure liveness check, we scan for matching agentId
	// patterns: direct match, or lane-session + "-worker" suffix.
	if (!_v2LivenessRegistryCache) return false;
	const agents = _v2LivenessRegistryCache.agents;
	// Direct match
	const manifest = agents[agentIdOrSessionName];
	if (manifest && !isTerminalStatus(manifest.status) && isProcessAlive(manifest.pid)) return true;
	// Try worker suffix (monitor uses lane session name, registry uses agentId)
	const workerManifest = agents[`${agentIdOrSessionName}-worker`];
	if (workerManifest && !isTerminalStatus(workerManifest.status) && isProcessAlive(workerManifest.pid)) return true;
	// TP-148: In workspace mode, laneSessionId includes repoId and uses a local
	// lane number (e.g., "orch-henry-api-lane-1") while the V2 registry uses
	// global lane numbers without repoId (e.g., "orch-henry-lane-3-worker").
	// Fall back to scanning the registry by global lane number when provided.
	if (laneNumber != null) {
		for (const agent of Object.values(agents)) {
			if (agent.laneNumber === laneNumber && agent.role === "worker" &&
				!isTerminalStatus(agent.status) && isProcessAlive(agent.pid)) {
				return true;
			}
		}
	}
	return false;
}

/** Cached registry for V2 liveness checks within a monitor cycle. @since TP-112 */
let _v2LivenessRegistryCache: import("./process-registry.ts").RuntimeRegistry | null = null;

/**
 * Set the V2 liveness registry cache for the current monitor cycle.
 * Called at the start of each monitor poll to avoid re-reading the file per-task.
 * @since TP-112
 */
export function setV2LivenessRegistryCache(registry: import("./process-registry.ts").RuntimeRegistry | null): void {
	_v2LivenessRegistryCache = registry;
}

/**
 * TP-112: Kill V2 lane agents (worker + reviewer) by PID from the registry.
 *
 * Uses the monitor cache when available for hot-path polling, and can
 * optionally read a fresh registry snapshot for cleanup flows outside monitor.
 *
 * @since TP-112
 */
export function killV2LaneAgents(
	sessionName: string,
	options?: { stateRoot?: string; batchId?: string; logContext?: string; laneNumber?: number },
): void {
	const registry = _v2LivenessRegistryCache ?? (
		options?.stateRoot && options?.batchId
			? readRegistrySnapshot(options.stateRoot, options.batchId)
			: null
	);
	if (!registry) return;

	const agents = registry.agents;
	const logContext = options?.logContext ?? "monitor";
	const killedPids = new Set<number>();
	for (const suffix of ["-worker", "-reviewer", ""]) {
		const key = `${sessionName}${suffix}`;
		const manifest = agents[key];
		if (manifest && !isTerminalStatus(manifest.status) && isProcessAlive(manifest.pid) && !killedPids.has(manifest.pid)) {
			try {
				process.kill(manifest.pid, "SIGTERM");
				killedPids.add(manifest.pid);
				execLog(logContext, key, `killed V2 agent (PID ${manifest.pid})`);
			} catch { /* already dead */ }
		}
	}
	// TP-148: Workspace-mode fallback — match by global lane number when
	// session name lookup misses (repoId/local-vs-global lane mismatch).
	if (options?.laneNumber != null) {
		for (const agent of Object.values(agents)) {
			if (agent.laneNumber === options.laneNumber &&
				!isTerminalStatus(agent.status) && isProcessAlive(agent.pid) && !killedPids.has(agent.pid)) {
				try {
					process.kill(agent.pid, "SIGTERM");
					killedPids.add(agent.pid);
					execLog(logContext, agent.agentId, `killed V2 agent by lane number (PID ${agent.pid})`);
				} catch { /* already dead */ }
			}
		}
	}
}

// ── Async File/Status Helpers (TP-070) ───────────────────────────────


/**
 * Async version of readTaskStatusTail — reads STATUS.md tail without
 * blocking the event loop.
 *
 * @param statusPath - Path to STATUS.md
 * @param maxLines - Maximum number of lines to return
 * @param maxChars - Maximum character count
 * @returns Promise resolving to status tail text (empty string if missing/unreadable)
 *
 * @since TP-070
 */
export async function readTaskStatusTailAsync(
	statusPath: string,
	maxLines: number = 40,
	maxChars: number = 1200,
): Promise<string> {
	try {
		await fsAccess(statusPath);
	} catch {
		return "";
	}
	try {
		const raw = (await fsReadFile(statusPath, "utf-8")).replace(/\r\n/g, "\n").trim();
		if (!raw) return "";
		const tail = raw.split("\n").slice(-maxLines).join("\n").trim();
		if (!tail) return "";
		return tail.length > maxChars ? tail.slice(-maxChars) : tail;
	} catch {
		return "";
	}
}

/**
 * Legacy lane environment-variable helper removed in TP-120.
 *
 * Runtime V2 lane execution now runs through lane-runner/agent-host and no
 * longer injects task-runner autostart/session env vars from this module.
 */
// buildLaneEnvVars removed (TP-120 remediation: legacy lane-session env var path, dead code)

function laneSessionIdOf(lane: Pick<AllocatedLane, "laneSessionId">): string {
	return lane.laneSessionId;
}

function appendRepoIdCandidate(
	orderedRepoIds: string[],
	seenRepoIds: Set<string>,
	repoId: string | undefined,
): void {
	if (!repoId || seenRepoIds.has(repoId)) return;
	seenRepoIds.add(repoId);
	orderedRepoIds.push(repoId);
}

export function buildExecutionRepoPaths(
	task: ParsedTask,
	executionRepoId: string,
	packetHomeRepoId: string,
	worktreePath: string,
	repoRoot: string,
	workspaceConfig?: WorkspaceConfig | null,
	repoWorktrees?: Record<string, { path: string }>,
): Record<string, string> {
	const orderedRepoIds: string[] = [];
	const seenRepoIds = new Set<string>();

	for (const repoId of task.participatingRepoIds ?? []) {
		appendRepoIdCandidate(orderedRepoIds, seenRepoIds, repoId);
	}
	for (const repoId of task.promptRepoIds ?? []) {
		appendRepoIdCandidate(orderedRepoIds, seenRepoIds, repoId);
	}
	for (const repoId of task.resolvedRepoIds ?? []) {
		appendRepoIdCandidate(orderedRepoIds, seenRepoIds, repoId);
	}
	for (const repoId of task.explicitSegmentDag?.repoIds ?? []) {
		appendRepoIdCandidate(orderedRepoIds, seenRepoIds, repoId);
	}
	appendRepoIdCandidate(orderedRepoIds, seenRepoIds, task.promptRepoId);
	appendRepoIdCandidate(orderedRepoIds, seenRepoIds, task.resolvedRepoId);
	appendRepoIdCandidate(orderedRepoIds, seenRepoIds, packetHomeRepoId);
	appendRepoIdCandidate(orderedRepoIds, seenRepoIds, executionRepoId);

	const repoPaths: Record<string, string> = {};
	for (const repoId of orderedRepoIds) {
		if (repoId === executionRepoId) {
			repoPaths[repoId] = repoWorktrees?.[repoId]?.path ?? worktreePath;
			continue;
		}
		const laneRepoWorktreePath = repoWorktrees?.[repoId]?.path;
		if (laneRepoWorktreePath) {
			repoPaths[repoId] = laneRepoWorktreePath;
			continue;
		}
		const repoPath = workspaceConfig?.repos.get(repoId)?.path;
		if (repoPath) {
			repoPaths[repoId] = repoPath;
			continue;
		}
		if (!workspaceConfig && repoId === packetHomeRepoId) {
			repoPaths[repoId] = repoRoot;
		}
	}

	if (!repoPaths[executionRepoId]) {
		repoPaths[executionRepoId] = repoWorktrees?.[executionRepoId]?.path ?? worktreePath;
	}

	return repoPaths;
}

/**
 * Resolve the lane session log path for a task execution.
 *
 * Logs are written under the lane worktree to keep per-lane execution
 * artifacts colocated with task state and available after failures.
 */
export function resolveLaneLogPath(
	lane: AllocatedLane,
	task: AllocatedTask,
): string {
	return join(lane.worktreePath, ".pi", "orch-logs", `${laneSessionIdOf(lane)}-${task.taskId}.log`);
}

/**
 * Relative lane log path used by the legacy shell-spawn path.
 *
 * Relative paths avoid Windows drive-letter parsing issues in shell redirection.
 */
export function resolveLaneLogRelativePath(
	lane: AllocatedLane,
	task: AllocatedTask,
): string {
	return join(".pi", "orch-logs", `${laneSessionIdOf(lane)}-${task.taskId}.log`).replace(/\\/g, "/");
}

/**
 * Read a tail snippet from a lane log file for failure diagnostics.
 */
export function readLaneLogTail(
	logPath: string,
	maxLines: number = 40,
	maxChars: number = 1200,
): string {
	if (!existsSync(logPath)) return "";
	try {
		const raw = readFileSync(logPath, "utf-8").replace(/\r\n/g, "\n");
		const tail = raw.split("\n").slice(-maxLines).join("\n").trim();
		if (!tail) return "";
		return tail.length > maxChars ? tail.slice(-maxChars) : tail;
	} catch {
		return "";
	}
}

/**
 * Async version of readLaneLogTail — reads lane log tail without
 * blocking the event loop.
 *
 * @since TP-070
 */
export async function readLaneLogTailAsync(
	logPath: string,
	maxLines: number = 40,
	maxChars: number = 1200,
): Promise<string> {
	try {
		await fsAccess(logPath);
	} catch {
		return "";
	}
	try {
		const raw = (await fsReadFile(logPath, "utf-8")).replace(/\r\n/g, "\n");
		const tail = raw.split("\n").slice(-maxLines).join("\n").trim();
		if (!tail) return "";
		return tail.length > maxChars ? tail.slice(-maxChars) : tail;
	} catch {
		return "";
	}
}

/**
 * Async file existence check — non-blocking replacement for existsSync
 * in polling paths.
 *
 * @param filePath - Path to check
 * @returns Promise resolving to true if file exists
 *
 * @since TP-070
 */
export async function fileExistsAsync(filePath: string): Promise<boolean> {
	try {
		await fsAccess(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Read a tail snippet from task STATUS.md for failure diagnostics.
 */
export function readTaskStatusTail(
	statusPath: string,
	maxLines: number = 40,
	maxChars: number = 1200,
): string {
	if (!existsSync(statusPath)) return "";
	try {
		const raw = readFileSync(statusPath, "utf-8").replace(/\r\n/g, "\n").trim();
		if (!raw) return "";
		const tail = raw.split("\n").slice(-maxLines).join("\n").trim();
		if (!tail) return "";
		return tail.length > maxChars ? tail.slice(-maxChars) : tail;
	} catch {
		return "";
	}
}

/**
 * Result of canonical task-folder path resolution.
 *
 * Encapsulates the resolved task folder, .DONE path, and STATUS.md path
 * so callers don't need to re-derive them with inconsistent logic.
 */
export interface ResolvedTaskPaths {
	/** Absolute path to the resolved task folder (may be in worktree or external) */
	taskFolderResolved: string;
	/** Absolute path to the .DONE file */
	donePath: string;
	/** Absolute path to the STATUS.md file */
	statusPath: string;
}

function normalizePortablePath(pathValue: string): string {
	const normalized = pathValue.replace(/\\/g, "/");
	if (/^[A-Za-z]:\//.test(normalized)) {
		return normalized;
	}
	return resolve(normalized).replace(/\\/g, "/");
}

/**
 * Canonical task-folder path resolver.
 *
 * Single source of truth for translating a task folder path (as stored in
 * ParsedTask) into the correct filesystem paths for .DONE and STATUS.md
 * probing. Handles two cases:
 *
 * 1. **Task folder inside repoRoot** (monorepo / repo mode):
 *    Strip the repoRoot prefix to get a relative path, then join with
 *    worktreePath. This is the existing behavior — worktrees mirror the
 *    repo structure so the relative path is the same.
 *
 * 2. **Task folder outside repoRoot** (workspace mode with external tasks root):
 *    The task folder is not inside the execution repo. Use the absolute
 *    task folder path directly — the .DONE and STATUS.md files live in
 *    the canonical task folder, not in any worktree.
 *
 * Both branches include archive fallback: if the primary location doesn't
 * exist, check `<parent>/archive/<taskDirName>/` for relocated task folders.
 *
 * @param taskFolder   - Absolute task folder path (from ParsedTask.taskFolder)
 * @param worktreePath - Absolute path to the lane worktree
 * @param repoRoot     - Absolute path to the main repository root
 * @returns Resolved paths for task folder, .DONE, and STATUS.md
 */
export function resolveCanonicalTaskPaths(
	taskFolder: string,
	worktreePath: string,
	repoRoot: string,
	isWorkspaceMode?: boolean,
): ResolvedTaskPaths {
	const repoRootNorm = normalizePortablePath(repoRoot);
	const folderNorm = normalizePortablePath(taskFolder);
	const worktreeRootNorm = normalizePortablePath(worktreePath);

	let resolvedFolder: string;

	if (isWorkspaceMode) {
		// Workspace mode: use worktree-relative path when the task folder is
		// inside the lane's repo. The worker writes .DONE and STATUS.md in
		// the worktree, so the engine must look there too.
		if (folderNorm.startsWith(repoRootNorm + "/")) {
			const relPath = folderNorm.slice(repoRootNorm.length + 1);
			resolvedFolder = join(worktreeRootNorm, relPath);
		} else {
			// Cross-repo: task files were copied into the worktree under
			// .taskplane-tasks/<taskDirName>/ by buildLaneEnvVars
			const taskDirName = basename(folderNorm);
			resolvedFolder = join(worktreeRootNorm, ".taskplane-tasks", taskDirName);
		}
	} else if (folderNorm.startsWith(repoRootNorm + "/")) {
		// Repo mode: task folder is inside the repo root.
		// Translate to equivalent path in the worktree.
		const relativePath = folderNorm.slice(repoRootNorm.length + 1);
		resolvedFolder = join(worktreeRootNorm, relativePath);
	} else {
		// Fallback: use absolute path directly.
		resolvedFolder = folderNorm;
	}

	// Check primary location
	const primaryDone = join(resolvedFolder, ".DONE");
	const primaryStatus = join(resolvedFolder, "STATUS.md");
	if (existsSync(primaryDone) || existsSync(primaryStatus)) {
		return {
			taskFolderResolved: resolvedFolder,
			donePath: primaryDone,
			statusPath: primaryStatus,
		};
	}

	// Archive fallback: worker may have archived the task folder during the
	// "Documentation & Delivery" step, moving it under `.../archive/TASK-ID/`.
	const resolvedNorm = normalizePortablePath(resolvedFolder);
	const parts = resolvedNorm.split("/");
	const taskDirName = parts[parts.length - 1];
	const parentDir = parts.slice(0, -1).join("/");
	const archiveFolder = join(parentDir, "archive", taskDirName);
	const archiveDone = join(archiveFolder, ".DONE");
	const archiveStatus = join(archiveFolder, "STATUS.md");

	if (existsSync(archiveDone) || existsSync(archiveStatus)) {
		return {
			taskFolderResolved: archiveFolder,
			donePath: archiveDone,
			statusPath: archiveStatus,
		};
	}

	// Return primary paths even if nothing exists yet (caller probes existsSync)
	return {
		taskFolderResolved: resolvedFolder,
		donePath: primaryDone,
		statusPath: primaryStatus,
	};
}

/**
 * Resolve the path to a task's .DONE file inside a worktree.
 *
 * Delegates to `resolveCanonicalTaskPaths` for consistent path resolution
 * across repo mode (task folder inside repo) and workspace mode (external
 * task folder).
 *
 * @param taskFolder   - Absolute task folder path (from main repo)
 * @param worktreePath - Absolute path to the lane worktree
 * @param repoRoot     - Absolute path to the main repository root
 * @returns Absolute path to the .DONE file in the worktree
 */
export function resolveTaskDonePath(
	taskFolder: string,
	worktreePath: string,
	repoRoot: string,
	isWorkspaceMode?: boolean,
): string {
	return resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot, isWorkspaceMode).donePath;
}


/*
 * Removed in TP-120 while decommissioning the legacy session backend.
 *
 * `pollUntilTaskComplete` remains as a test-compatibility stub only.
 * Runtime V2 completion detection now lives in lane-runner + agent-host.
 */
// pollUntilTaskComplete function body removed — was ~170 lines of legacy .DONE polling.
// @ts-ignore — export kept as stub for test compatibility
export async function pollUntilTaskComplete(
	_lane: AllocatedLane,
	_task: AllocatedTask,
	_config: OrchestratorConfig,
	_repoRoot: string,
	_pauseSignal: { paused: boolean },
	_isWorkspaceMode?: boolean,
): Promise<{ status: LaneTaskStatus; exitReason: string; doneFileFound: boolean }> {
	return { status: "failed", exitReason: "Legacy pollUntilTaskComplete removed — use V2 lane-runner", doneFileFound: false };
}

// ── Post-Task Commit ─────────────────────────────────────────────────

/**
 * Commit any uncommitted task artifacts to the lane branch after task completion.
 *
 * The task-runner creates `.DONE` and updates `STATUS.md` via `writeFileSync`,
 * but these changes are never committed to git by the task-runner or the worker.
 * Without this commit, these files are lost when the worktree is reset or removed,
 * and they don't appear in the merge to the base branch.
 *
 * Best-effort: failures are logged but don't fail the task (the work is already done).
 *
 * @param lane   - Allocated lane containing the worktree path
 * @param task   - The task that just completed
 * @param laneId - Lane identifier for logging
 */
function commitTaskArtifacts(
	lane: AllocatedLane,
	task: AllocatedTask,
	laneId: string,
	v2Context?: { stateRoot: string; batchId: string; laneNumber: number; repoId: string },
): void {
	const worktreePath = lane.worktreePath;

	// Check if there are any uncommitted changes in the worktree
	const statusResult = runGit(["status", "--porcelain"], worktreePath);
	if (!statusResult.ok || !statusResult.stdout.trim()) {
		// Worker may have already committed everything. Check for untracked .DONE file.
		// If .DONE exists but is untracked, we must stage+commit it so it survives
		// worktree reset and appears in the main repo after merge.
		const donePath = resolveTaskDonePath(task.task.taskFolder, worktreePath, lane.worktreePath);
		if (existsSync(donePath)) {
			const untrackedResult = runGit(["status", "--porcelain", "--untracked-files=all"], worktreePath);
			const hasUntracked = untrackedResult.ok && untrackedResult.stdout.includes("??");
			if (hasUntracked) {
				// Stage .DONE specifically
				const addResult = runGit(["add", donePath], worktreePath);
				if (!addResult.ok) {
					execLog(laneId, task.taskId, `post-task stage .DONE failed (non-fatal): ${addResult.stderr.slice(0, 200)}`);
				}
				// Commit with task ID for traceability
				const commitResult = runGit(
					["commit", "-m", `checkpoint: ${task.taskId} task artifacts (.DONE, STATUS.md)`],
					worktreePath,
				);
				if (!commitResult.ok && !commitResult.stderr.includes("nothing to commit")) {
					execLog(laneId, task.taskId, `post-task commit .DONE failed (non-fatal): ${commitResult.stderr.slice(0, 200)}`);
				}
				if (commitResult.ok) {
					execLog(laneId, task.taskId, `committed untracked .DONE to lane branch`, {
						commit: commitResult.stdout.trim().split("\n")[0],
					});
				}
				return;
			}
		}
		// Nothing to commit (worker already committed everything, or git error)
		return;
	}

	const unsafeSubmodules = detectUnsafeSubmoduleStates(worktreePath);
	if (unsafeSubmodules.length > 0) {
		const statusSnapshot = captureSubmoduleStatusSnapshot(worktreePath);
		const summary = unsafeSubmodules
			.slice(0, 3)
			.map((finding) =>
				finding.kind === "dirty-worktree"
					? `${finding.path} has uncommitted submodule changes`
					: `${finding.path} points to local commit ${finding.headCommit?.slice(0, 8)} not reachable on ${finding.remoteName ?? "any remote"}`,
			)
			.join("; ");
		const remainder = unsafeSubmodules.length > 3
			? ` (+${unsafeSubmodules.length - 3} more)`
			: "";
		const findingDetails = buildUnsafeSubmoduleFindingDetails(unsafeSubmodules, statusSnapshot);
		recordUnsafeSubmoduleDiagnostics(
			v2Context,
			task.taskId,
			toRuntimeSubmoduleSnapshot(task.taskId, "post-task", statusSnapshot),
			summary,
			remainder,
			findingDetails,
		);
		for (const detail of findingDetails) {
			const preview = detail.statusLines.length > 0
				? detail.statusLines.join(" | ")
				: detail.error
					? `[status unavailable: ${detail.error}]`
					: "[no modified files reported by git status --porcelain]";
			execLog(laneId, task.taskId, `unsafe submodule detail: ${detail.path}: ${detail.summary} :: ${preview}`);
		}
		const message =
			`Unsafe submodule state after task success: ${summary}${remainder}. ` +
			`Taskplane refused to checkpoint a superproject gitlink that could lose or orphan submodule work.`;
		execLog(laneId, task.taskId, message);
		throw new Error(message);
	}

	// Stage all changes in the worktree
	const addResult = runGit(["add", "-A"], worktreePath);
	if (!addResult.ok) {
		execLog(laneId, task.taskId, `post-task stage failed (non-fatal): ${addResult.stderr.slice(0, 200)}`);
		return;
	}

	// Commit with task ID for traceability
	const commitResult = runGit(
		["commit", "-m", `checkpoint: ${task.taskId} task artifacts (.DONE, STATUS.md)`],
		worktreePath,
	);
	if (!commitResult.ok) {
		// "nothing to commit" is not an error — worker may have already committed
		if (!commitResult.stderr.includes("nothing to commit")) {
			execLog(laneId, task.taskId, `post-task commit failed (non-fatal): ${commitResult.stderr.slice(0, 200)}`);
		}
		return;
	}

	execLog(laneId, task.taskId, `committed task artifacts to lane branch`, {
		commit: commitResult.stdout.trim().split("\n")[0],
	});
}

function toRuntimeSubmoduleSnapshot(
	taskId: string,
	phase: "pre-task" | "post-task",
	snapshot: ReturnType<typeof captureSubmoduleStatusSnapshot>,
): RuntimeSubmoduleSnapshot {
	return {
		taskId,
		phase,
		capturedAt: snapshot.capturedAt,
		worktreePath: snapshot.worktreePath,
		totalSubmodules: snapshot.totalSubmodules,
		dirtySubmodules: snapshot.dirtySubmodules,
		entries: snapshot.entries,
	};
}

function buildUnsafeSubmoduleFindingDetails(
	unsafeSubmodules: ReturnType<typeof detectUnsafeSubmoduleStates>,
	snapshot: ReturnType<typeof captureSubmoduleStatusSnapshot>,
): RuntimeUnsafeSubmoduleFinding[] {
	const previewByPath = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
	return unsafeSubmodules.map((finding) => {
		const preview = previewByPath.get(finding.path);
		const summary = finding.kind === "dirty-worktree"
			? `${finding.path} has uncommitted submodule changes`
			: `${finding.path} points to local commit ${finding.headCommit?.slice(0, 8)} not reachable on ${finding.remoteName ?? "any remote"}`;
		return {
			path: finding.path,
			kind: finding.kind,
			summary,
			statusLines: preview?.statusLines ?? [],
			lineCount: preview?.lineCount ?? 0,
			truncated: preview?.truncated ?? false,
			...(preview?.error ? { error: preview.error } : {}),
			...(finding.headCommit ? { headCommit: finding.headCommit } : {}),
			...(finding.indexCommit ? { indexCommit: finding.indexCommit } : {}),
			...(finding.remoteName ? { remoteName: finding.remoteName } : {}),
		};
	});
}

function recordUnsafeSubmoduleDiagnostics(
	v2Context: { stateRoot: string; batchId: string; laneNumber: number; repoId: string } | undefined,
	taskId: string,
	postTaskSnapshot: RuntimeSubmoduleSnapshot,
	summary: string,
	remainder: string,
	findings: RuntimeUnsafeSubmoduleFinding[],
): void {
	if (!v2Context) return;
	const snapshotPath = runtimeLaneSnapshotPath(v2Context.stateRoot, v2Context.batchId, v2Context.laneNumber);

	try {
		const current = existsSync(snapshotPath)
			? JSON.parse(readFileSync(snapshotPath, "utf-8")) as RuntimeLaneSnapshot
			: {
				batchId: v2Context.batchId,
				laneNumber: v2Context.laneNumber,
				laneId: `lane-${v2Context.laneNumber}`,
				repoId: v2Context.repoId,
				taskId,
				segmentId: null,
				status: "failed",
				worker: null,
				reviewer: null,
				progress: null,
				updatedAt: Date.now(),
			} satisfies RuntimeLaneSnapshot;
		const nextDiagnostics: RuntimeLaneSubmoduleDiagnostics = {
			...(current.submoduleDiagnostics ?? {}),
			postTask: postTaskSnapshot,
			unsafeCheckpoint: {
				taskId,
				capturedAt: Date.now(),
				summary: `${summary}${remainder}`,
				findings,
			},
		};
		writeLaneSnapshot(v2Context.stateRoot, v2Context.batchId, v2Context.laneNumber, {
			...(current as Record<string, unknown>),
			submoduleDiagnostics: nextDiagnostics,
			updatedAt: Date.now(),
		});
	} catch {
		// Best effort only: lane snapshots are telemetry, not execution critical.
	}
}




// ── STATUS.md Parsing for Worktree ───────────────────────────────────

/**
 * Normalized result from parsing a STATUS.md file in a worktree.
 *
 * Reuses the same regex patterns as task-runner's parseStatusMd but
 * adapted for monitoring context (no direct import — same file patterns).
 */
export interface ParsedWorktreeStatus {
	/** Parsed step info array */
	steps: {
		number: number;
		name: string;
		status: "not-started" | "in-progress" | "complete";
		totalChecked: number;
		totalItems: number;
	}[];
	/** Review counter from STATUS.md */
	reviewCounter: number;
	/** Iteration number from STATUS.md */
	iteration: number;
	/** Raw Current Step header value from STATUS.md */
	currentStepLabel: string | null;
	/** Normalized current step name derived from the header when possible */
	currentStepName: string | null;
	/** Normalized current step number derived from the header when possible */
	currentStepNumber: number | null;
	/** File modification time (epoch ms) */
	mtime: number;
}

function normalizeCurrentStepHeader(
	rawLabel: string | null,
	steps: ParsedWorktreeStatus["steps"],
): Pick<ParsedWorktreeStatus, "currentStepLabel" | "currentStepName" | "currentStepNumber"> {
	const label = rawLabel?.trim() || null;
	if (!label) {
		return {
			currentStepLabel: null,
			currentStepName: null,
			currentStepNumber: null,
		};
	}

	const numbered = label.match(/^Step\s+(\d+)(?::\s*(.+))?$/i);
	if (numbered) {
		const currentStepNumber = parseInt(numbered[1], 10);
		const namedMatch = numbered[2]?.trim() || null;
		const matchingStep = steps.find((step) => step.number === currentStepNumber) || null;
		return {
			currentStepLabel: label,
			currentStepName: namedMatch || matchingStep?.name || null,
			currentStepNumber,
		};
	}

	const normalized = label.toLowerCase();
	if (
		normalized.includes("all steps complete")
		|| normalized === "complete"
		|| normalized === "done"
	) {
		const last = steps[steps.length - 1] || null;
		return {
			currentStepLabel: label,
			currentStepName: last?.name || null,
			currentStepNumber: last?.number ?? null,
		};
	}

	if (normalized === "not started" || normalized === "none") {
		return {
			currentStepLabel: label,
			currentStepName: null,
			currentStepNumber: null,
		};
	}

	const matchingByName = steps.find((step) => step.name === label) || null;
	return {
		currentStepLabel: label,
		currentStepName: matchingByName?.name || label,
		currentStepNumber: matchingByName?.number ?? null,
	};
}

function parseStatusMdText(text: string, mtime: number): ParsedWorktreeStatus {
	const normalizedText = text.replace(/\r\n/g, "\n");
	const steps: ParsedWorktreeStatus["steps"] = [];
	let currentStep: {
		number: number;
		name: string;
		status: "not-started" | "in-progress" | "complete";
		checkboxes: boolean[];
	} | null = null;
	let reviewCounter = 0;
	let iteration = 0;
	let currentStepLabel: string | null = null;
	let inCodeFence = false;

	for (const line of normalizedText.split("\n")) {
		if (/^```/.test(line.trim())) {
			inCodeFence = !inCodeFence;
			continue;
		}
		const rcMatch = line.match(/\*\*Review Counter:\*\*\s*(\d+)/);
		if (rcMatch) reviewCounter = parseInt(rcMatch[1], 10);
		const itMatch = line.match(/\*\*Iteration:\*\*\s*(\d+)/);
		if (itMatch) iteration = parseInt(itMatch[1], 10);
		const currentStepMatch = line.match(/\*\*Current Step:\*\*\s*(.+)/);
		if (currentStepMatch) currentStepLabel = currentStepMatch[1].trim();
		if (inCodeFence) continue;

		const stepMatch = line.match(/^#{2,6}\s+Step\s+(\d+)(?::\s*|\s+)(.+)$/);
		if (stepMatch) {
			if (currentStep) {
				const totalChecked = currentStep.checkboxes.filter(c => c).length;
				steps.push({
					number: currentStep.number,
					name: currentStep.name,
					status: currentStep.status,
					totalChecked,
					totalItems: currentStep.checkboxes.length,
				});
			}
			currentStep = {
				number: parseInt(stepMatch[1], 10),
				name: stepMatch[2].trim(),
				status: "not-started",
				checkboxes: [],
			};
			continue;
		}
		if (currentStep && /^#{1,6}\s+/.test(line) && !/^####\s+Segment:\s*/.test(line)) {
			const totalChecked = currentStep.checkboxes.filter(c => c).length;
			steps.push({
				number: currentStep.number,
				name: currentStep.name,
				status: currentStep.status,
				totalChecked,
				totalItems: currentStep.checkboxes.length,
			});
			currentStep = null;
			continue;
		}
		if (currentStep) {
			const ss = line.match(/\*\*Status:\*\*\s*(.*)/);
			if (ss) {
				const statusText = ss[1];
				if (statusText.includes("✅") || statusText.toLowerCase().includes("complete")) {
					currentStep.status = "complete";
				} else if (statusText.includes("🟨") || statusText.includes("🟡") || statusText.toLowerCase().includes("progress")) {
					currentStep.status = "in-progress";
				}
			}
			const cb = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
			if (cb) {
				currentStep.checkboxes.push(cb[1].toLowerCase() === "x");
			}
		}
	}
	if (currentStep) {
		const totalChecked = currentStep.checkboxes.filter(c => c).length;
		steps.push({
			number: currentStep.number,
			name: currentStep.name,
			status: currentStep.status,
			totalChecked,
			totalItems: currentStep.checkboxes.length,
		});
	}

	return {
		steps,
		reviewCounter,
		iteration,
		...normalizeCurrentStepHeader(currentStepLabel, steps),
		mtime,
	};
}

/**
 * Parse STATUS.md from a task folder inside a worktree.
 *
 * Reads the STATUS.md file, parses step statuses and checkbox counts
 * using the same regex patterns as task-runner's parseStatusMd.
 *
 * @param taskFolder   - Absolute task folder path (from main repo)
 * @param worktreePath - Absolute path to the lane worktree
 * @param repoRoot     - Absolute path to the main repository root
 * @returns Parsed status or null with reason if unreadable
 */
export function parseWorktreeStatusMd(
	taskFolder: string,
	worktreePath: string,
	repoRoot: string,
	isWorkspaceMode?: boolean,
): { parsed: ParsedWorktreeStatus | null; error: string | null } {
	// Use canonical resolver for consistent path translation
	const resolved = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot, isWorkspaceMode);
	const statusPath = resolved.statusPath;

	if (!existsSync(statusPath)) {
		return { parsed: null, error: `STATUS.md not found at ${statusPath}` };
	}

	let content: string;
	let mtime: number;
	try {
		content = readFileSync(statusPath, "utf-8");
		mtime = statSync(statusPath).mtimeMs;
	} catch (err: unknown) {
		return { parsed: null, error: `Cannot read STATUS.md: ${err instanceof Error ? err.message : String(err)}` };
	}

	return {
		parsed: parseStatusMdText(content, mtime),
		error: null,
	};
}

/**
 * Async version of parseWorktreeStatusMd — reads and parses STATUS.md
 * without blocking the event loop. Used in monitoring poll loops.
 *
 * @since TP-070
 */

/**
 * Parse STATUS.md directly from a known absolute path.
 * Unlike parseWorktreeStatusMdAsync, this does NOT re-resolve the path —
 * it reads exactly the file you point it to. Use this when the caller
 * already has the authoritative statusPath (e.g., from buildExecutionUnit).
 *
 * @since TP-501
 */
export async function parseStatusMdAtPath(
	statusPath: string,
): Promise<{ parsed: ParsedWorktreeStatus | null; error: string | null }> {
	return parseStatusMdContent(statusPath);
}

/**
 * Parse STATUS.md by resolving the path from taskFolder + worktree context.
 * Use parseStatusMdAtPath instead when the caller already has the authoritative path.
 *
 * @since TP-070
 */
export async function parseWorktreeStatusMdAsync(
	taskFolder: string,
	worktreePath: string,
	repoRoot: string,
	isWorkspaceMode?: boolean,
): Promise<{ parsed: ParsedWorktreeStatus | null; error: string | null }> {
	const resolved = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot, isWorkspaceMode);
	return parseStatusMdContent(resolved.statusPath);
}

/** Shared STATUS.md content parser — reads and parses from a known path. Handles file-not-found. */
async function parseStatusMdContent(
	statusPath: string,
): Promise<{ parsed: ParsedWorktreeStatus | null; error: string | null }> {
	if (!(await fileExistsAsync(statusPath))) {
		return { parsed: null, error: `STATUS.md not found at ${statusPath}` };
	}

	let content: string;
	let mtime: number;
	try {
		content = await fsReadFile(statusPath, "utf-8");
		mtime = (await fsStat(statusPath)).mtimeMs;
	} catch (err: unknown) {
		return { parsed: null, error: `Cannot read STATUS.md: ${err instanceof Error ? err.message : String(err)}` };
	}

	return {
		parsed: parseStatusMdText(content, mtime),
		error: null,
	};
}


// ── State Resolution ─────────────────────────────────────────────────

/**
 * Resolve the monitoring state for a single task by combining signals.
 *
 * State-resolution precedence (deterministic):
 * 1. `.DONE` file found → "succeeded" (highest priority, always wins)
 * 2. Stall timeout reached (mtime unchanged for stall_timeout AND session alive) → "stalled"
 * 3. Lane session ended without .DONE → "failed"
 * 4. Session alive + recent mtime (within stall_timeout) → "running"
 * 5. Session alive + stale mtime but within startup grace → "running" (with no stall timer yet)
 * 6. Session alive + no STATUS.md yet but within startup grace → "running"
 * 7. No session, no .DONE, never observed running → "unknown"
 *
 * @param taskId         - Task identifier
 * @param donePath       - Absolute path to the .DONE file in the worktree
 * @param sessionName    - Lane session name for this lane
 * @param statusResult   - Parsed STATUS.md result (may be null)
 * @param tracker        - Mtime tracker for stall detection
 * @param stallTimeoutMs - Stall timeout in milliseconds
 * @param now            - Current timestamp (epoch ms) for deterministic testing
 */
export async function resolveTaskMonitorState(
	taskId: string,
	donePath: string,
	sessionName: string,
	statusResult: { parsed: ParsedWorktreeStatus | null; error: string | null },
	tracker: MtimeTracker,
	stallTimeoutMs: number,
	now: number,
	runtimeBackend?: RuntimeBackend,
	v2Context?: { stateRoot: string; batchId: string; laneNumber: number },
): Promise<TaskMonitorSnapshot> {
	// TP-115/TP-127: Backend-aware liveness check.
	// V2: read the lane snapshot file written by lane-runner every second.
	// If snapshot doesn't exist yet, assume alive (lane-runner startup race).
	// If snapshot belongs to a different task, it's stale transition data from
	// the previous wave/task and should be treated like startup grace (alive).
	// Legacy: check lane-session liveness.
	let sessionAlive: boolean;
	if (runtimeBackend === "v2" && v2Context) {
		const snap = readLaneSnapshot(v2Context.stateRoot, v2Context.batchId, v2Context.laneNumber);
		if (snap == null || snap.taskId !== taskId) {
			// Snapshot not written yet OR snapshot still points to a prior task.
			// Assume alive initially, but if stale for >30s consult the registry
			// to avoid indefinite false "running" if the lane-runner died.
			const staleMs = snap?.updatedAt ? (now - snap.updatedAt) : 0;
			if (staleMs > 30_000) {
				// Snapshot hasn't been updated for 30s+ — check registry as fallback.
				// But also check if the tracker just started (firstObservedAt within
				// last 60s) — wave transitions can leave stale snapshots from the
				// prior wave/task while the new worker is still spawning.
				const trackerAgeMs = now - tracker.firstObservedAt;
				if (trackerAgeMs < 60_000) {
					// New task, stale snapshot — give the worker startup grace period
					sessionAlive = true;
				} else {
					sessionAlive = isV2AgentAlive(sessionName, runtimeBackend, v2Context?.laneNumber);
				}
			} else {
				sessionAlive = true;
			}
		} else {
			// TP-159: Fast-fail path for ghost workers (issue #461).
			// When the snapshot belongs to the current task but the lane-runner
			// has stopped updating it and the agent's PID is confirmed dead,
			// immediately set sessionAlive=false instead of waiting for the full
			// stall timeout. This handles the case where a worker dies silently
			// (OOM, segfault, parent crash) after writing its first snapshot:
			//   snap.status stays "running", stallTimerStart stays null
			//   (STATUS.md never written), so Priority 2 never fires without
			//   this explicit dead-PID check.
			// Conditions:
			//   1. snap.updatedAt is stale beyond stallTimeoutMs/2
			//   2. startup grace has elapsed (trackerAgeMs >= 60s)
			//   3. agent is confirmed dead (registry marked crashed by orphan scan)
			const trackerAgeMs = now - tracker.firstObservedAt;
			if (
				snap.updatedAt &&
				(now - snap.updatedAt) > stallTimeoutMs / 2 &&
				trackerAgeMs >= 60_000 &&
				!isV2AgentAlive(sessionName, runtimeBackend, v2Context?.laneNumber)
			) {
				// Ghost worker confirmed: PID dead, snapshot stale beyond half the stall timeout
				execLog("monitor", taskId, "ghost worker fast-fail — dead PID + stale snapshot", {
					session: sessionName,
					snapStaleMs: now - snap.updatedAt,
					trackerAgeMs,
					halfStallTimeoutMs: stallTimeoutMs / 2,
				});
				sessionAlive = false;
			} else {
				sessionAlive = snap.status === "running";
			}
		}
	} else {
		sessionAlive = isV2AgentAlive(sessionName, "v2", v2Context?.laneNumber);
	}
	const doneFileFound = await fileExistsAsync(donePath);

	// Build base snapshot from parsed status
	let currentStepName: string | null = null;
	let currentStepNumber: number | null = null;
	let totalSteps = 0;
	let totalChecked = 0;
	let totalItems = 0;
	let iteration = 0;
	let reviewCounter = 0;
	let parseError = statusResult.error;

	if (statusResult.parsed) {
		const { steps } = statusResult.parsed;
		totalSteps = steps.length;
		iteration = statusResult.parsed.iteration;
		reviewCounter = statusResult.parsed.reviewCounter;

		for (const step of steps) {
			totalChecked += step.totalChecked;
			totalItems += step.totalItems;
		}

		currentStepName = statusResult.parsed.currentStepName;
		currentStepNumber = statusResult.parsed.currentStepNumber;
		if (!currentStepName) {
			// Fall back to per-step status inference for older STATUS.md variants
			const inProgress = steps.find(s => s.status === "in-progress");
			if (inProgress) {
				currentStepName = inProgress.name;
				currentStepNumber = inProgress.number;
			} else {
				const notStarted = steps.find(s => s.status === "not-started");
				if (notStarted) {
					currentStepName = notStarted.name;
					currentStepNumber = notStarted.number;
				} else if (steps.length > 0) {
					const last = steps[steps.length - 1];
					currentStepName = last.name;
					currentStepNumber = last.number;
				}
			}
		}

		// Update mtime tracker
		if (!tracker.statusFileSeenOnce) {
			tracker.statusFileSeenOnce = true;
			tracker.lastMtime = statusResult.parsed.mtime;
			tracker.stallTimerStart = null; // Reset stall timer on first read
		} else if (statusResult.parsed.mtime !== tracker.lastMtime) {
			// Mtime changed — progress is being made
			tracker.lastMtime = statusResult.parsed.mtime;
			tracker.stallTimerStart = null; // Reset stall timer
		} else {
			// Mtime unchanged — start or continue stall timer
			if (tracker.stallTimerStart === null) {
				tracker.stallTimerStart = now;
			}
		}
	}

	// ── Priority 1: .DONE file found → succeeded ────────────────
	if (doneFileFound) {
		return {
			taskId,
			status: "succeeded",
			currentStepName,
			currentStepNumber,
			totalSteps,
			totalChecked,
			totalItems,
			sessionAlive,
			doneFileFound: true,
			stallReason: null,
			lastHeartbeat: tracker.lastMtime,
			observedAt: now,
			parseError,
			iteration,
			reviewCounter,
		};
	}

	// ── Priority 2: Stall timeout reached ────────────────────────
	if (
		sessionAlive &&
		tracker.statusFileSeenOnce &&
		tracker.stallTimerStart !== null &&
		(now - tracker.stallTimerStart) >= stallTimeoutMs
	) {
		const stallMinutes = Math.round((now - tracker.stallTimerStart) / 60_000);
		const stallReason = `STATUS.md unchanged for ${stallMinutes} minutes (threshold: ${Math.round(stallTimeoutMs / 60_000)} min)`;

		// Kill the agent (backend-aware)
		execLog("monitor", taskId, `stall detected — killing agent`, {
			session: sessionName,
			stallMinutes,
			backend: runtimeBackend ?? "legacy",
		});
		killV2LaneAgents(sessionName, { laneNumber: v2Context?.laneNumber });

		return {
			taskId,
			status: "stalled",
			currentStepName,
			currentStepNumber,
			totalSteps,
			totalChecked,
			totalItems,
			sessionAlive: false, // We just killed it
			doneFileFound: false,
			stallReason,
			lastHeartbeat: tracker.lastMtime,
			observedAt: now,
			parseError,
			iteration,
			reviewCounter,
		};
	}

	// ── Priority 3: Session exited without .DONE → failed ────────
	if (!sessionAlive) {
		return {
			taskId,
			status: "failed",
			currentStepName,
			currentStepNumber,
			totalSteps,
			totalChecked,
			totalItems,
			sessionAlive: false,
			doneFileFound: false,
			stallReason: null,
			lastHeartbeat: tracker.lastMtime,
			observedAt: now,
			parseError,
			iteration,
			reviewCounter,
		};
	}

	// ── Priority 4-6: Session alive → running ────────────────────
	return {
		taskId,
		status: "running",
		currentStepName,
		currentStepNumber,
		totalSteps,
		totalChecked,
		totalItems,
		sessionAlive: true,
		doneFileFound: false,
		stallReason: null,
		lastHeartbeat: tracker.lastMtime,
		observedAt: now,
		parseError,
		iteration,
		reviewCounter,
	};
}


// ── Core Monitor Loop ────────────────────────────────────────────────

/**
 * Callback type for dashboard updates during monitoring.
 */
export type MonitorUpdateCallback = (state: MonitorState) => void;

/**
 * Monitor all lanes in a wave, polling for progress, completion, and stalls.
 *
 * This is the orchestrator's "air traffic control" — it does NOT attach
 * to lane sessions directly. It monitors via filesystem polling:
 * - STATUS.md in each worktree for step/checkbox progress
 * - .DONE files for task completion
 * - backend liveness probes for session state
 * - STATUS.md mtime for stall detection
 *
 * The monitoring loop runs until all lanes reach terminal states
 * (all tasks succeeded/failed/stalled) or the pauseSignal is set.
 *
 * **Important:** This function monitors lanes that are being executed
 * concurrently by `executeLane()` in Step 2. It does NOT spawn sessions —
 * it only observes. Step 4 will coordinate calling both executeLane()
 * and monitorLanes() in parallel.
 *
 * @param lanes         - Allocated lanes being executed
 * @param config        - Orchestrator configuration (poll_interval, stall_timeout)
 * @param repoRoot      - Main repository root
 * @param pauseSignal   - Shared signal for pause/abort
 * @param waveNumber    - Current wave number (for display)
 * @param onUpdate      - Optional callback invoked on each poll cycle
 * @returns Final MonitorState snapshot when monitoring completes
 */
export async function monitorLanes(
	lanes: AllocatedLane[],
	config: OrchestratorConfig,
	repoRoot: string,
	pauseSignal: { paused: boolean },
	waveNumber: number = 1,
	onUpdate?: MonitorUpdateCallback,
	isWorkspaceMode?: boolean,
	runtimeBackend?: RuntimeBackend,
	batchId?: string,
	stateRootForRegistry?: string,
): Promise<MonitorState> {
	const pollIntervalMs = (config.monitoring.poll_interval || 5) * 1000;
	const stallTimeoutMs = (config.failure.stall_timeout || 30) * 60_000;

	// Initialize mtime trackers for each lane's current task
	// We track per-taskId so a lane advancing to the next task gets a fresh tracker
	const mtimeTrackers = new Map<string, MtimeTracker>();

	function getOrCreateTracker(taskId: string, now: number): MtimeTracker {
		let tracker = mtimeTrackers.get(taskId);
		if (!tracker) {
			tracker = {
				taskId,
				firstObservedAt: now,
				statusFileSeenOnce: false,
				lastMtime: null,
				stallTimerStart: null,
			};
			mtimeTrackers.set(taskId, tracker);
		}
		return tracker;
	}

	// Track terminal states per task to avoid re-processing
	const terminalTasks = new Map<string, TaskMonitorSnapshot>();

	// Track which task each lane is currently on
	// (determined by: first task in lane that hasn't reached terminal state)
	const laneTaskIndex = new Map<number, number>();
	for (const lane of lanes) {
		laneTaskIndex.set(lane.laneNumber, 0);
	}

	let pollCount = 0;
	let lastMonitorStateKey = "";

	// Build the total task count
	const tasksTotal = lanes.reduce((sum, lane) => sum + lane.tasks.length, 0);

	execLog("monitor", "ALL", `starting monitoring for ${lanes.length} lane(s), ${tasksTotal} task(s)`, {
		pollIntervalMs,
		stallTimeoutMin: Math.round(stallTimeoutMs / 60_000),
	});

	while (true) {
		const now = Date.now();
		pollCount++;

		// TP-112: Refresh V2 liveness registry cache once per poll cycle
		if (runtimeBackend === "v2" && batchId) {
			try {
				setV2LivenessRegistryCache(readRegistrySnapshot(stateRootForRegistry ?? repoRoot, batchId));
			} catch {
				setV2LivenessRegistryCache(null);
			}
		} else {
			setV2LivenessRegistryCache(null);
		}

		// TP-159: Detect and mark orphaned workers each poll cycle.
		// When a worker subprocess dies silently (OOM kill, segfault, parent
		// crash) without going through the normal completion handshake, its
		// registry manifest stays in a non-terminal status indefinitely.
		// Scanning for dead PIDs here ensures list_active_agents, read_agent_status,
		// and the dashboard all reflect reality within one poll interval.
		if (runtimeBackend === "v2" && batchId) {
			try {
				const registry = readRegistrySnapshot(stateRootForRegistry ?? repoRoot, batchId);
				if (registry) {
					const orphans = detectOrphans(registry);
					if (orphans.length > 0) {
						// Mark individual agent manifests as crashed
						markOrphansCrashed(stateRootForRegistry ?? repoRoot, batchId, orphans);
						// Rebuild and write registry.json from the updated individual manifests.
						// markOrphansCrashed only updates per-agent files; registry.json is a
						// cached aggregate that must be explicitly rebuilt so readRegistrySnapshot()
						// and the dashboard see the crashed status within this poll cycle.
						const freshRegistry = buildRegistrySnapshot(stateRootForRegistry ?? repoRoot, batchId);
						writeRegistrySnapshot(stateRootForRegistry ?? repoRoot, freshRegistry);
						setV2LivenessRegistryCache(freshRegistry);
					}
				}
			} catch {
				// Non-fatal — monitor loop must never throw
			}
		}

		// Check pause signal
		if (pauseSignal.paused) {
			execLog("monitor", "ALL", "pause signal detected — stopping monitoring");
			break;
		}

		const laneSnapshots: LaneMonitorSnapshot[] = [];
		let totalDone = 0;
		let totalFailed = 0;
		let allTerminal = true;

		for (const lane of lanes) {
			const completedTasks: string[] = [];
			const failedTasks: string[] = [];
			const remainingTasks: string[] = [];
			let currentTaskId: string | null = null;
			let currentTaskSnapshot: TaskMonitorSnapshot | null = null;

			// Walk through tasks in order to determine lane state
			for (let i = 0; i < lane.tasks.length; i++) {
				const task = lane.tasks[i];

				// Check if we already know this task is terminal
				const existingTerminal = terminalTasks.get(task.taskId);
				if (existingTerminal) {
					if (existingTerminal.status === "succeeded") {
						completedTasks.push(task.taskId);
						totalDone++;
					} else {
						failedTasks.push(task.taskId);
						totalFailed++;
					}
					continue;
				}

				// This task hasn't reached terminal state yet
				if (currentTaskId === null) {
					// This is the current task being worked on
					currentTaskId = task.taskId;

					const tracker = getOrCreateTracker(task.taskId, now);
						const unit = buildExecutionUnit(lane, task, repoRoot, isWorkspaceMode);
					const donePath = unit.packet.donePath;
					const statusPath = unit.packet.statusPath;
					const statusResult = await parseStatusMdAtPath(statusPath);

					const snapshot = await resolveTaskMonitorState(
						task.taskId,
						donePath,
						laneSessionIdOf(lane),
						statusResult,
						tracker,
						stallTimeoutMs,
						now,
						runtimeBackend,
						(runtimeBackend === "v2" && batchId) ? {
							stateRoot: stateRootForRegistry ?? repoRoot,
							batchId,
							laneNumber: lane.laneNumber,
						} : undefined,
					);

					currentTaskSnapshot = snapshot;

					// Check if this task just became terminal
					if (snapshot.status === "succeeded" || snapshot.status === "failed" || snapshot.status === "stalled") {
						terminalTasks.set(task.taskId, snapshot);
						if (snapshot.status === "succeeded") {
							completedTasks.push(task.taskId);
							totalDone++;
						} else {
							failedTasks.push(task.taskId);
							totalFailed++;
						}
						// Move to next task — clear currentTaskId so next iteration picks up
						currentTaskId = null;
						currentTaskSnapshot = null;
					} else {
						// Task is still running — mark remaining and break
						allTerminal = false;
						// Remaining tasks are everything after this one
						for (let j = i + 1; j < lane.tasks.length; j++) {
							remainingTasks.push(lane.tasks[j].taskId);
						}
						break;
					}
				} else {
					// Shouldn't reach here since we break above, but defensive
					remainingTasks.push(task.taskId);
				}
			}

			// If we processed all tasks and currentTaskId is still null,
			// the lane is fully terminal (all tasks completed/failed)
			if (currentTaskId !== null) {
				allTerminal = false;
			}

			// TP-112: Backend-aware lane liveness for snapshot
			// TP-148: Pass global laneNumber for workspace-mode fallback lookup
			const sessionAlive = isV2AgentAlive(laneSessionIdOf(lane), "v2", lane.laneNumber);

			laneSnapshots.push({
				laneId: lane.laneId,
				laneNumber: lane.laneNumber,
				sessionName: laneSessionIdOf(lane),
				sessionAlive,
				currentTaskId,
				currentTaskSnapshot,
				completedTasks,
				failedTasks,
				remainingTasks,
			});
		}

		const monitorState: MonitorState = {
			lanes: laneSnapshots,
			tasksDone: totalDone,
			tasksFailed: totalFailed,
			tasksTotal,
			waveNumber,
			pollCount,
			lastPollTime: now,
			allTerminal,
		};

		// Invoke the dashboard update callback
		if (onUpdate) {
			try {
				onUpdate(monitorState);
			} catch {
				// Don't let callback errors kill the monitor loop
			}
		}

		// Log summary only on state changes (lane completes or fails) — not every poll
		const currentStateKey = `${totalDone}/${totalFailed}`;
		if (currentStateKey !== lastMonitorStateKey) {
			const activeLanes = laneSnapshots.filter(l => l.currentTaskId !== null);
			execLog("monitor", "ALL", `poll #${pollCount}: ${totalDone}/${tasksTotal} done, ${totalFailed} failed, ${activeLanes.length} active lane(s)`);
			lastMonitorStateKey = currentStateKey;
		}

		// Exit conditions
		if (allTerminal) {
			execLog("monitor", "ALL", `all lanes terminal — monitoring complete`, {
				done: totalDone,
				failed: totalFailed,
				total: tasksTotal,
				polls: pollCount,
			});
			setV2LivenessRegistryCache(null);
			return monitorState;
		}

		// Wait for next poll cycle
		await new Promise(r => setTimeout(r, pollIntervalMs));
	}

	// Reached here due to pause signal — return current state
	const now = Date.now();
	const laneSnapshots: LaneMonitorSnapshot[] = lanes.map(lane => ({
		laneId: lane.laneId,
		laneNumber: lane.laneNumber,
		sessionName: laneSessionIdOf(lane),
		sessionAlive: false, // Best-effort during pause — don't block on extra liveness probes
		currentTaskId: null,
		currentTaskSnapshot: null,
		completedTasks: [],
		failedTasks: [],
		remainingTasks: lane.tasks.map(t => t.taskId),
	}));

	setV2LivenessRegistryCache(null);
	return {
		lanes: laneSnapshots,
		tasksDone: 0,
		tasksFailed: 0,
		tasksTotal,
		waveNumber,
		pollCount,
		lastPollTime: now,
		allTerminal: false,
	};
}


// ── Transitive Dependent Computation ─────────────────────────────────

/**
 * Compute transitive dependents of a set of failed task IDs.
 *
 * Uses BFS through the dependency graph's `dependents` map (task → tasks
 * that depend on it) to find all tasks transitively blocked by the failures.
 *
 * Example: if A failed, B depends on A, and C depends on B, then both B
 * and C are transitively blocked.
 *
 * The failed tasks themselves are NOT included in the output — only their
 * downstream dependents.
 *
 * @param failedTaskIds     - Set of task IDs that failed
 * @param dependencyGraph   - Dependency graph with dependents map
 * @returns Set of task IDs transitively blocked (excludes the failed tasks themselves)
 */
export function computeTransitiveDependents(
	failedTaskIds: Set<string>,
	dependencyGraph: DependencyGraph,
): Set<string> {
	const blocked = new Set<string>();
	const queue = [...failedTaskIds];

	while (queue.length > 0) {
		const current = queue.shift()!;
		const dependents = dependencyGraph.dependents.get(current) || [];

		// Deterministic: sort dependents alphabetically
		const sortedDependents = [...dependents].sort();

		for (const dep of sortedDependents) {
			if (blocked.has(dep)) continue;
			if (failedTaskIds.has(dep)) continue; // Don't re-add failed tasks
			blocked.add(dep);
			queue.push(dep); // Continue BFS for transitive closure
		}
	}

	return blocked;
}


// ── Pre-flight: Commit Untracked Task Files ─────────────────────────

/**
 * Ensure all task files for a wave are committed to git before worktree creation.
 *
 * Git worktrees only contain tracked (committed) files. If a user creates
 * task folders (PROMPT.md, STATUS.md) but doesn't commit them, the worktree
 * won't have those files and the worker will fail with "file not found".
 *
 * This function checks each wave task's folder for untracked or modified files,
 * stages them, and creates a commit on the current branch. This must run BEFORE
 * allocateLanes() so that worktrees (which are based on the batch's base branch)
 * include the task files.
 *
 * Only task-specific folders are staged — no other working tree changes are touched.
 *
 * @param waveTasks  - Task IDs in this wave
 * @param pending    - Full pending task map from discovery
 * @param repoRoot   - Main repository root
 * @param waveIndex  - Wave number for commit message
 */
export function ensureTaskFilesCommitted(
	waveTasks: string[],
	pending: Map<string, ParsedTask>,
	repoRoot: string,
	waveIndex: number,
	orchBranch?: string,
): void {
	// Collect task folder paths for this wave
	const foldersToCheck: { taskId: string; relPath: string }[] = [];
	for (const taskId of waveTasks) {
		const task = pending.get(taskId);
		if (!task) continue;

		const absFolder = resolve(task.taskFolder);
		const relPath = relative(resolve(repoRoot), absFolder).replace(/\\/g, "/");

		// Skip if path escapes the repo (shouldn't happen in normal use)
		if (relPath.startsWith("..")) {
			continue;
		}
		foldersToCheck.push({ taskId, relPath });
	}

	if (foldersToCheck.length === 0) return;

	// Check which folders have untracked or uncommitted files
	const foldersToStage: string[] = [];
	for (const { taskId, relPath } of foldersToCheck) {
		const status = runGit(["status", "--porcelain", "--", relPath], repoRoot);
		if (status.ok && status.stdout.trim()) {
			execLog("wave", `W${waveIndex}`, `task ${taskId} has uncommitted files, staging`, {
				folder: relPath,
				status: status.stdout.trim().split("\n").slice(0, 5).join("; "),
			});
			foldersToStage.push(relPath);
		}
	}

	if (foldersToStage.length === 0) return;

	// TP-169: When an orch branch is provided, commit task files directly on
	// the orch branch using a temporary git index file. This avoids polluting
	// the repo's current branch (e.g. main) with orchestrator-internal staging
	// commits, maintaining proper branch isolation in workspace mode.
	//
	// Approach:
	// 1. Read the orch branch's tree into a temporary index
	// 2. Add new/modified task files to the temporary index
	// 3. Write the combined tree
	// 4. Create a commit on the orch branch
	// 5. Update the orch branch ref
	// 6. Clean up the temporary index
	//
	// Fallback: if orch branch plumbing fails or orchBranch is not provided,
	// fall back to the legacy path of committing on HEAD.
	if (orchBranch) {
		const orchTipRes = runGit(["rev-parse", `refs/heads/${orchBranch}`], repoRoot);
		if (orchTipRes.ok) {
			const orchTip = orchTipRes.stdout.trim();
			const tmpIdx = join(repoRoot, ".git", `tmp-staging-idx-wave-${waveIndex}`);

			try {
				// Read orch branch tree into temporary index
				const readTreeRes = runGitWithEnv(
					["read-tree", orchTip],
					repoRoot,
					{ GIT_INDEX_FILE: tmpIdx },
				);
				if (!readTreeRes.ok) {
					execLog("wave", `W${waveIndex}`, `orch branch staging: read-tree failed, falling back to HEAD commit`, {
						error: readTreeRes.stderr,
					});
					// Fall through to legacy path
				} else {
					// Add task files to temporary index
					let addFailed = false;
					for (const folder of foldersToStage) {
						const addRes = runGitWithEnv(
							["add", "--", folder],
							repoRoot,
							{ GIT_INDEX_FILE: tmpIdx },
						);
						if (!addRes.ok) {
							execLog("wave", `W${waveIndex}`, `orch branch staging: git add failed for ${folder}, falling back`, {
								error: addRes.stderr,
							});
							addFailed = true;
							break;
						}
					}

					if (!addFailed) {
						// Write tree from temporary index
						const writeTreeRes = runGitWithEnv(
							["write-tree"],
							repoRoot,
							{ GIT_INDEX_FILE: tmpIdx },
						);

						if (writeTreeRes.ok) {
							const tree = writeTreeRes.stdout.trim();
							const taskIds = foldersToStage.map(f => f.split("/").pop() || f).join(", ");
							const commitMsg = `chore: stage task files for orchestrator wave ${waveIndex} (${taskIds})`;

							// Create commit directly on orch branch
							const commitTreeRes = runGit(
								["commit-tree", tree, "-p", orchTip, "-m", commitMsg],
								repoRoot,
							);

							if (commitTreeRes.ok) {
								const newCommit = commitTreeRes.stdout.trim();
								const refUpdateRes = runGit(
									["update-ref", `refs/heads/${orchBranch}`, newCommit, orchTip],
									repoRoot,
								);

								if (refUpdateRes.ok) {
									execLog("wave", `W${waveIndex}`, `committed ${foldersToStage.length} task folder(s) directly on orch branch`, {
										orchBranch,
										folders: foldersToStage,
										from: orchTip.slice(0, 8),
										to: newCommit.slice(0, 8),
									});
									// Clean up temp index and return — no need for legacy path
									try { unlinkSync(tmpIdx); } catch { /* best effort */ }
									return;
								}
								execLog("wave", `W${waveIndex}`, `orch branch staging: ref update failed, falling back`, {
									error: refUpdateRes.stderr,
								});
							} else {
								execLog("wave", `W${waveIndex}`, `orch branch staging: commit-tree failed, falling back`, {
									error: commitTreeRes.stderr,
								});
							}
						} else {
							execLog("wave", `W${waveIndex}`, `orch branch staging: write-tree failed, falling back`, {
								error: writeTreeRes.stderr,
							});
						}
					}
				}
			} catch (err: unknown) {
				execLog("wave", `W${waveIndex}`, `orch branch staging: unexpected error, falling back to HEAD commit`, {
					error: err instanceof Error ? err.message : String(err),
				});
			} finally {
				// Always clean up temp index
				try { unlinkSync(tmpIdx); } catch { /* best effort */ }
			}
		}
	}

	// Legacy fallback: commit on HEAD and sync orch branch.
	// This path is used when orchBranch is not provided, or when the
	// plumbing-based approach above failed.

	// Stage only the task folders
	for (const folder of foldersToStage) {
		const addResult = runGit(["add", "--", folder], repoRoot);
		if (!addResult.ok) {
			execLog("wave", `W${waveIndex}`, `failed to stage task files: ${addResult.stderr}`, { folder });
			throw new ExecutionError(
				"EXEC_TASK_STAGE_FAILED",
				`Failed to stage task files in "${folder}": ${addResult.stderr}`,
				"wave",
				folder,
			);
		}
	}

	// Commit
	const taskIds = foldersToStage.map(f => f.split("/").pop() || f).join(", ");
	const commitMsg = `chore: stage task files for orchestrator wave ${waveIndex} (${taskIds})`;
	const commitResult = runGit(["commit", "-m", commitMsg], repoRoot);
	if (!commitResult.ok) {
		execLog("wave", `W${waveIndex}`, `failed to commit task files: ${commitResult.stderr}`);
		throw new ExecutionError(
			"EXEC_TASK_COMMIT_FAILED",
			`Failed to commit task files for wave ${waveIndex}: ${commitResult.stderr}`,
			"wave",
			`W${waveIndex}`,
		);
	}

	execLog("wave", `W${waveIndex}`, `committed ${foldersToStage.length} task folder(s) to ensure worktree visibility`, {
		folders: foldersToStage,
		commit: commitResult.stdout.trim().split("\n")[0],
	});

	// Fast-forward (or merge) the orch branch to include the staging commit so
	// that worktrees—which branch from orchBranch—see the new task files and
	// workers can find their PROMPT.md / STATUS.md without an ENOENT crash.
	if (orchBranch) {
		try {
			const headRes = runGit(["rev-parse", "HEAD"], repoRoot);
			const orchTipRes = runGit(["rev-parse", `refs/heads/${orchBranch}`], repoRoot);

			if (headRes.ok && orchTipRes.ok) {
				const newHead = headRes.stdout.trim();
				const orchTip = orchTipRes.stdout.trim();

				const ancestorCheck = runGit(
					["merge-base", "--is-ancestor", orchTip, newHead],
					repoRoot,
				);

				if (ancestorCheck.ok) {
					const ffResult = runGit(
						["update-ref", `refs/heads/${orchBranch}`, newHead, orchTip],
						repoRoot,
					);
					if (ffResult.ok) {
						execLog("wave", `W${waveIndex}`, `fast-forwarded orch branch to include staging commit`, {
							orchBranch,
							from: orchTip.slice(0, 8),
							to: newHead.slice(0, 8),
						});
					} else {
						execLog("wave", `W${waveIndex}`, `warning: failed to fast-forward orch branch (non-fatal)`, {
							orchBranch,
							error: ffResult.stderr,
						});
					}
				} else {
					const mergeTreeRes = runGit(
						["merge-tree", "--write-tree", orchTip, newHead],
						repoRoot,
					);
					if (mergeTreeRes.ok) {
						const mergedTree = mergeTreeRes.stdout.trim().split("\n")[0];
						if (/^[0-9a-f]{40}$/i.test(mergedTree)) {
							const mergeMsg = `merge: include staged task files for wave ${waveIndex} into orch branch`;
							const commitTreeRes = runGit(
								["commit-tree", mergedTree, "-p", orchTip, "-p", newHead, "-m", mergeMsg],
								repoRoot,
							);
							if (commitTreeRes.ok) {
								const mergeCommitSha = commitTreeRes.stdout.trim();
								const refUpdateRes = runGit(
									["update-ref", `refs/heads/${orchBranch}`, mergeCommitSha, orchTip],
									repoRoot,
								);
								if (refUpdateRes.ok) {
									execLog("wave", `W${waveIndex}`, `merged staging commit into orch branch (non-FF wave)`, {
										orchBranch,
										mergeCommit: mergeCommitSha.slice(0, 8),
									});
								}
							}
						}
					}
				}
			}
		} catch (refErr: unknown) {
			execLog("wave", `W${waveIndex}`, `warning: orch branch ref update threw unexpectedly (non-fatal)`, {
				orchBranch,
				error: refErr instanceof Error ? refErr.message : String(refErr),
			});
		}
	}
}

// ── Wave Execution Core ──────────────────────────────────────────────

/**
 * Execute a single wave: allocate lanes, run tasks in parallel, monitor, apply failure policy.
 *
 * Orchestration flow:
 * 1. Allocate lanes via allocateLanes() (worktree creation + task assignment)
 * 2. Start all lanes in parallel (each lane executes tasks sequentially)
 * 3. Start monitoring as a sibling async loop
 * 4. Wait for all lanes to complete (or policy-triggered early termination)
 * 5. Apply failure handling policy
 * 6. Build and return WaveExecutionResult
 *
 * Failure policy behavior:
 * - **skip-dependents**: In-flight tasks continue. Failed task's transitive
 *   dependents are collected in blockedTaskIds for future wave pruning.
 *   Current wave runs to completion.
 * - **stop-wave**: On first failure, pauseSignal is set. In-flight tasks
 *   finish their current work, remaining tasks in lanes are skipped.
 *   No next wave is started (stoppedEarly=true).
 * - **stop-all**: On first failure, all active lane sessions are killed immediately.
 *   Returns with aborted status.
 *
 * Concurrency model:
 * - Lane execution promises are NOT cancellable (lane sessions run externally)
 * - stop-all kills sessions directly; executeLane() detects session death on next poll
 * - Monitoring stops when all lanes reach terminal state or pauseSignal is set
 *
 * @param waveTasks         - Task IDs in this wave
 * @param waveIndex         - Wave number (1-indexed)
 * @param pending           - Full pending task map from discovery
 * @param config            - Orchestrator configuration
 * @param repoRoot          - Main repository root
 * @param batchId           - Batch ID for naming
 * @param pauseSignal       - Shared pause signal (mutated by stop-wave policy)
 * @param dependencyGraph   - Dependency graph for computing transitive dependents
 * @param orchBranch        - Orch branch to base worktrees on (and to update after staging commits)
 * @param onMonitorUpdate   - Optional callback for dashboard updates during monitoring
 * @param onLanesAllocated  - Optional callback fired after lane allocation succeeds
 * @param workspaceConfig   - Workspace configuration for repo routing (null/undefined = repo mode)
 * @returns WaveExecutionResult with outcomes and blocked task IDs
 */
/**
 * Runtime backend selector for lane execution.
 *
 * - `"legacy"`: Session-backed path (spawnLaneSession, deprecated)
 * - `"v2"`: Direct-child path (lane-runner → agent-host → pi --mode rpc)
 *
 * @since TP-105
 */
export type RuntimeBackend = "legacy" | "v2";

export async function executeWave(
	waveTasks: string[],
	waveIndex: number,
	pending: Map<string, ParsedTask>,
	config: OrchestratorConfig,
	repoRoot: string,
	batchId: string,
	pauseSignal: { paused: boolean },
	dependencyGraph: DependencyGraph,
	orchBranch: string,
	onMonitorUpdate?: MonitorUpdateCallback,
	onLanesAllocated?: (lanes: AllocatedLane[]) => void,
	workspaceConfig?: WorkspaceConfig | null,
	runtimeBackend?: RuntimeBackend,
	onSupervisorAlert?: SupervisorAlertCallback,
	supervisorAutonomy: "interactive" | "supervised" | "autonomous" = "autonomous",
	reviewerConfig?: { model?: string; thinking?: string; tools?: string; excludeExtensions?: string[] },
	workerExcludeExtensions?: string[],
): Promise<WaveExecutionResult> {
	const startedAt = Date.now();
	const policy = config.failure.on_task_failure;

	execLog("wave", `W${waveIndex}`, `starting wave execution`, {
		tasks: waveTasks.length,
		policy,
		batchId,
	});

	// ── Stage 0: Ensure task files are committed ────────────────
	// Task folders may contain untracked files (PROMPT.md, STATUS.md) that
	// won't appear in worktrees unless committed. Stage and commit them now,
	// before worktree creation, so workers can find their task files.
	// Pass orchBranch so the staging commit is reflected in the orch branch
	// before worktrees are allocated from it.
	try {
		ensureTaskFilesCommitted(waveTasks, pending, repoRoot, waveIndex, orchBranch);
	} catch (err: unknown) {
		const errMsg = err instanceof Error ? err.message : String(err);
		execLog("wave", `W${waveIndex}`, `task file commit failed: ${errMsg}`);

		return {
			waveIndex,
			startedAt,
			endedAt: Date.now(),
			laneResults: [],
			policyApplied: policy,
			stoppedEarly: true,
			failedTaskIds: waveTasks,
			skippedTaskIds: [],
			succeededTaskIds: [],
			blockedTaskIds: [...computeTransitiveDependents(new Set(waveTasks), dependencyGraph)],
			laneCount: 0,
			overallStatus: "failed",
			finalMonitorState: null,
			allocatedLanes: [],
		};
	}

	// ── Stage 1: Allocate lanes ──────────────────────────────────
	const allocResult = allocateLanes(waveTasks, pending, config, repoRoot, batchId, orchBranch, workspaceConfig);

	if (!allocResult.success) {
		const errMsg = allocResult.error?.message || "Unknown allocation failure";
		execLog("wave", `W${waveIndex}`, `lane allocation failed: ${errMsg}`);

		return {
			waveIndex,
			startedAt,
			endedAt: Date.now(),
			laneResults: [],
			policyApplied: policy,
			stoppedEarly: true,
			failedTaskIds: waveTasks, // All tasks in the wave are considered failed
			skippedTaskIds: [],
			succeededTaskIds: [],
			blockedTaskIds: [...computeTransitiveDependents(new Set(waveTasks), dependencyGraph)],
			laneCount: 0,
			overallStatus: "failed",
			finalMonitorState: null,
			allocatedLanes: [],
			allocationError: allocResult.error,
		};
	}

	const lanes = allocResult.lanes;
	onLanesAllocated?.(lanes);

	execLog("wave", `W${waveIndex}`, `lanes allocated`, {
		laneCount: lanes.length,
		totalTasks: waveTasks.length,
	});

	// ── Stage 2+3: Start lanes in parallel + monitoring ──────────
	// Create per-wave pause signal that can be triggered by policy
	// while preserving the external pauseSignal from /orch-pause
	const wavePauseSignal = pauseSignal;

	// Start lane execution promises
	// In workspace mode, pass the workspace root so lane sessions can find .pi/ config.
	// configPath is .pi/taskplane-workspace.yaml → parent of parent is workspace root.
	const wsRoot = workspaceConfig ? dirname(dirname(workspaceConfig.configPath)) : undefined;
	const isWsMode = !!workspaceConfig;
	const backend: RuntimeBackend = "v2";
	if (runtimeBackend && runtimeBackend !== "v2") {
		execLog("wave", `W${waveIndex}`, `legacy runtime backend '${runtimeBackend}' requested but ignored; using Runtime V2`);
	}
	execLog("wave", `W${waveIndex}`, "using Runtime V2 backend (executeLaneV2)");

	// Clear stale lane snapshots from prior waves before launching new workers.
	// Without this, the monitor reads a snapshot from wave N-1 (different taskId,
	// staleMs > 30s) and may falsely mark the new task as failed before the
	// worker has time to write its first snapshot.
	const snapshotStateRoot = resolveRuntimeStateRoot(repoRoot, wsRoot);
	for (const lane of lanes) {
		try {
			const snapPath = join(snapshotStateRoot, ".pi", "runtime", batchId, "lanes", `lane-${lane.laneNumber}.json`);
			if (existsSync(snapPath)) unlinkSync(snapPath);
		} catch { /* best effort */ }
	}

	const lanePromises = lanes.map(lane =>
		executeLaneV2(lane, config, repoRoot, wavePauseSignal, wsRoot, isWsMode, {
			ORCH_BATCH_ID: batchId,
			TASKPLANE_SUPERVISOR_AUTONOMY: supervisorAutonomy,
			...buildReviewerEnv(reviewerConfig),
			...buildWorkerExcludeEnv(workerExcludeExtensions),
		}, onSupervisorAlert),
	);

	// Start monitoring as a sibling async loop
	// Monitor runs concurrently and stops when all lanes are terminal or paused
	const monitorStateRoot = resolveRuntimeStateRoot(repoRoot, wsRoot);
	const monitorPromise = monitorLanes(
		lanes,
		config,
		repoRoot,
		wavePauseSignal,
		waveIndex,
		onMonitorUpdate,
		isWsMode,
		backend,
		batchId,
		monitorStateRoot,
	);

	// ── Stage 4: Wait for all lanes + apply policy ───────────────
	// We need to detect the first failure to apply policy.
	// Use Promise.allSettled on lanes, then check results.
	// For stop-all, we also need to react proactively.

	let laneResults: LaneExecutionResult[];
	let finalMonitorState: MonitorState | null = null;

	if (policy === "stop-all") {
		// For stop-all: race detection — as soon as any lane reports failure,
		// kill all sessions immediately.
		laneResults = await executeWithStopAll(lanes, lanePromises, wavePauseSignal, waveIndex);
	} else {
		// For skip-dependents and stop-wave:
		// Let all lanes run to completion (or until pauseSignal stops them).
		// For stop-wave, we set pauseSignal when we detect failure in results.
		const settled = await Promise.allSettled(lanePromises);

		laneResults = settled.map((result, idx) => {
			if (result.status === "fulfilled") {
				return result.value;
			}
			// Rejected promise — shouldn't normally happen (executeLane catches errors)
			const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
			execLog("wave", `W${waveIndex}`, `lane ${lanes[idx].laneId} promise rejected: ${errMsg}`);
			return {
				laneNumber: lanes[idx].laneNumber,
				laneId: lanes[idx].laneId,
				tasks: lanes[idx].tasks.map(t => ({
					taskId: t.taskId,
					status: "failed" as LaneTaskStatus,
					startTime: null,
					endTime: null,
					exitReason: `Lane promise rejected: ${errMsg}`,
					sessionName: laneSessionIdOf(lanes[idx]),
					doneFileFound: false,
					laneNumber: lanes[idx].laneNumber,
				})),
				overallStatus: "failed" as const,
				startTime: startedAt,
				endTime: Date.now(),
			};
		});

		// For stop-wave: if any task failed, set pause to prevent next wave
		if (policy === "stop-wave") {
			const hasFailure = laneResults.some(lr =>
				lr.tasks.some(t => t.status === "failed" || t.status === "stalled"),
			);
			if (hasFailure) {
				wavePauseSignal.paused = true;
				execLog("wave", `W${waveIndex}`, `stop-wave policy triggered — pausing after this wave`);
			}
		}
	}

	// Stop the monitor (it should stop naturally when lanes are terminal,
	// but ensure it's stopped if we triggered pause)
	try {
		finalMonitorState = await monitorPromise;
	} catch {
		// Monitor error is non-fatal
		execLog("wave", `W${waveIndex}`, `monitor promise error (non-fatal)`);
	}

	// ── Stage 5: Build WaveExecutionResult ───────────────────────
	const failedTaskIds: string[] = [];
	const skippedTaskIds: string[] = [];
	const succeededTaskIds: string[] = [];

	for (const lr of laneResults) {
		for (const t of lr.tasks) {
			if (t.status === "succeeded") {
				succeededTaskIds.push(t.taskId);
			} else if (t.status === "failed" || t.status === "stalled") {
				failedTaskIds.push(t.taskId);
			} else if (t.status === "skipped") {
				skippedTaskIds.push(t.taskId);
			}
		}
	}

	// Sort for deterministic output
	failedTaskIds.sort();
	skippedTaskIds.sort();
	succeededTaskIds.sort();

	// Compute blocked tasks for future waves (skip-dependents policy)
	let blockedTaskIds: string[] = [];
	if (policy === "skip-dependents" && failedTaskIds.length > 0) {
		const blocked = computeTransitiveDependents(
			new Set(failedTaskIds),
			dependencyGraph,
		);
		blockedTaskIds = [...blocked].sort();
		if (blockedTaskIds.length > 0) {
			execLog("wave", `W${waveIndex}`, `skip-dependents: ${blockedTaskIds.length} task(s) blocked for future waves`, {
				blocked: blockedTaskIds.join(","),
			});
		}
	}

	// Determine overall wave status
	const stoppedEarly = policy === "stop-all" && failedTaskIds.length > 0
		|| policy === "stop-wave" && failedTaskIds.length > 0;

	let overallStatus: WaveExecutionResult["overallStatus"];
	if (policy === "stop-all" && failedTaskIds.length > 0) {
		overallStatus = "aborted";
	} else if (failedTaskIds.length === 0) {
		overallStatus = "succeeded";
	} else if (succeededTaskIds.length > 0) {
		overallStatus = "partial";
	} else {
		overallStatus = "failed";
	}

	const endedAt = Date.now();
	const elapsedSec = Math.round((endedAt - startedAt) / 1000);

	execLog("wave", `W${waveIndex}`, `wave execution complete: ${overallStatus}`, {
		succeeded: succeededTaskIds.length,
		failed: failedTaskIds.length,
		skipped: skippedTaskIds.length,
		blocked: blockedTaskIds.length,
		elapsed: `${elapsedSec}s`,
		stoppedEarly,
	});

	return {
		waveIndex,
		startedAt,
		endedAt,
		laneResults,
		policyApplied: policy,
		stoppedEarly,
		failedTaskIds,
		skippedTaskIds,
		succeededTaskIds,
		blockedTaskIds,
		laneCount: lanes.length,
		overallStatus,
		finalMonitorState,
		allocatedLanes: lanes,
	};
}

/**
 * Execute lanes with stop-all failure policy.
 *
 * Starts all lanes, then monitors for the first failure.
 * On first failure: kills all active lane sessions immediately and returns.
 *
 * Uses a race pattern: wraps each lane promise to signal on failure,
 * then kills all sessions when first failure is detected.
 *
 * Deterministic tie-break: when multiple failures happen simultaneously,
 * they are ordered by timestamp (startTime), then by task ID alphabetically.
 *
 * @param lanes           - Allocated lanes
 * @param lanePromises    - Already-started lane execution promises
 * @param pauseSignal     - Pause signal to set on abort
 * @param waveIndex       - Wave number for logging
 * @returns Lane execution results (may have aborted tasks)
 */
export async function executeWithStopAll(
	lanes: AllocatedLane[],
	lanePromises: Promise<LaneExecutionResult>[],
	pauseSignal: { paused: boolean },
	waveIndex: number,
): Promise<LaneExecutionResult[]> {
	// Track results as they complete
	const results: (LaneExecutionResult | null)[] = new Array(lanes.length).fill(null);
	let abortTriggered = false;

	// Create a promise that resolves when all lanes are done
	// but also detects first failure
	const wrappedPromises = lanePromises.map(async (promise, idx) => {
		try {
			const result = await promise;
			results[idx] = result;

			// Check if any task failed
			if (!abortTriggered) {
				const hasFailure = result.tasks.some(
					t => t.status === "failed" || t.status === "stalled",
				);
				if (hasFailure) {
					// First failure detected — trigger stop-all
					abortTriggered = true;
					pauseSignal.paused = true;

					// Determine which task failed first for logging
					const firstFailed = result.tasks
						.filter(t => t.status === "failed" || t.status === "stalled")
						.sort((a, b) => {
							// Sort by startTime, then by taskId for deterministic tie-break
							const timeA = a.startTime || 0;
							const timeB = b.startTime || 0;
							if (timeA !== timeB) return timeA - timeB;
							return a.taskId.localeCompare(b.taskId);
						})[0];

					execLog("wave", `W${waveIndex}`, `stop-all triggered by ${firstFailed?.taskId || "unknown"} in ${lanes[idx].laneId}`, {
						session: laneSessionIdOf(lanes[idx]),
					});

					// Kill ALL lane sessions immediately
					for (const lane of lanes) {
						killV2LaneAgents(laneSessionIdOf(lane), { laneNumber: lane.laneNumber });
					}
				}
			}

			return result;
		} catch (err) {
			// Lane promise rejection — should be rare
			const errMsg = err instanceof Error ? err.message : String(err);
			if (!abortTriggered) {
				abortTriggered = true;
				pauseSignal.paused = true;
				execLog("wave", `W${waveIndex}`, `stop-all triggered by lane error in ${lanes[idx].laneId}: ${errMsg}`);
				for (const lane of lanes) {
					killV2LaneAgents(laneSessionIdOf(lane), { laneNumber: lane.laneNumber });
				}
			}

			// Build a failed result for this lane
			const failedResult: LaneExecutionResult = {
				laneNumber: lanes[idx].laneNumber,
				laneId: lanes[idx].laneId,
				tasks: lanes[idx].tasks.map(t => ({
					taskId: t.taskId,
					status: "failed" as LaneTaskStatus,
					startTime: null,
					endTime: null,
					exitReason: `Lane aborted: ${errMsg}`,
					sessionName: laneSessionIdOf(lanes[idx]),
					doneFileFound: false,
					laneNumber: lanes[idx].laneNumber,
				})),
				overallStatus: "failed",
				startTime: Date.now(),
				endTime: Date.now(),
			};
			results[idx] = failedResult;
			return failedResult;
		}
	});

	// Wait for all lanes to settle (they should exit quickly after session kill)
	await Promise.allSettled(wrappedPromises);

	// Fill in any null results (shouldn't happen, but defensive)
	return results.map((r, idx) => r || {
		laneNumber: lanes[idx].laneNumber,
		laneId: lanes[idx].laneId,
		tasks: [],
		overallStatus: "failed" as const,
		startTime: Date.now(),
		endTime: Date.now(),
	});
}

// ── Runtime V2 Bridge Helpers (TP-102) ─────────────────────────────────────
//
// These helpers bridge between existing legacy data structures
// (AllocatedLane, AllocatedTask, resolveCanonicalTaskPaths) and
// Runtime V2 contracts (ExecutionUnit, PacketPaths, RuntimeAgentId).
//
// They are additive — existing code paths continue to work.
// Runtime V2 consumers can start using these to avoid coupling to
// legacy lane-session naming, cwd-derived paths, or extension lifecycle assumptions.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a Runtime V2 ExecutionUnit from existing legacy structures.
 *
 * Translates the current AllocatedLane + AllocatedTask into the new
 * ExecutionUnit contract with explicit packet-path authority.
 *
 * Uses `resolveCanonicalTaskPaths` to derive packet paths through
 * the existing resolution logic (worktree-relative, cross-repo copy,
 * archive fallback). This preserves current behavior while surfacing
 * it through the Runtime V2 contract.
 *
 * **Cross-repo packet authority (TP-109):** In workspace mode, when the
 * task packet home repo differs from the execution repo, the legacy path
 * copies packet files into the worktree under `.taskplane-tasks/`. The
 * resolved `packet` paths here point to that execution-local copy.
 * This is by design: the worker reads/writes STATUS.md and creates .DONE
 * in the worktree, and resume checks both the worktree-relative path and
 * the original discovery path for .DONE detection.
 *
 * `packetHomeRepoId` identifies the source repo that *owns* the task
 * (for discovery and routing), while `packet.taskFolder` is the
 * authoritative *working* location where artifacts are read/written
 * during execution. Resume reconciliation (TP-109) resolves both paths.
 *
 * @param lane - Allocated lane containing worktree and identity info
 * @param task - Allocated task to build an execution unit for
 * @param repoRoot - Main repository root
 * @param isWorkspaceMode - Whether workspace mode is active
 * @returns A fully-resolved ExecutionUnit
 *
 * @since TP-102
 */
export function buildExecutionUnit(
	lane: AllocatedLane,
	task: AllocatedTask,
	repoRoot: string,
	isWorkspaceMode?: boolean,
	workspaceConfig?: WorkspaceConfig | null,
): ExecutionUnit {
	// TP-169: Guard against missing taskFolder. This can happen when
	// reconstructAllocatedLanes creates task stubs from persisted state
	// where taskFolder enrichment failed (e.g., dynamically-expanded
	// segments whose persisted records had empty taskFolder).
	const taskFolder = task.task?.taskFolder;
	if (!taskFolder) {
		throw new ExecutionError(
			"EXEC_MISSING_TASK_FOLDER",
			`Cannot build execution unit for task ${task.taskId}: taskFolder is ${taskFolder === "" ? "empty" : "undefined"}. ` +
			`This typically means the task's persisted record was not enriched with discovery data. ` +
			`Re-run discovery or check that the task exists in the task area.`,
			"execution",
			task.taskId,
		);
	}
	const executionRepoId = lane.repoId ?? "default";
	const executionWorktreePath = lane.repoWorktrees?.[executionRepoId]?.path ?? lane.worktreePath;
	const resolved = resolveCanonicalTaskPaths(
		taskFolder,
		executionWorktreePath,
		repoRoot,
		isWorkspaceMode,
	);

	const packetHomeRepoId = task.task.packetRepoId ?? executionRepoId;
	const repoPaths = buildExecutionRepoPaths(
		task.task,
		executionRepoId,
		packetHomeRepoId,
		executionWorktreePath,
		repoRoot,
		workspaceConfig,
		lane.repoWorktrees,
	);

	// Build a segment-style ID if this is a segment execution,
	// otherwise use the plain task ID.
	const segmentId = task.task.activeSegmentId ?? null;
	const id = segmentId ?? task.taskId;

	// Use absolute packetTaskPath ONLY when the packet home repo differs from
	// the execution repo (cross-repo segment). When they're the same repo,
	// resolve packet paths inside the worktree so .DONE, STATUS.md etc. are
	// written to the worktree (not the original repo outside the worktree).
	const useAbsolutePacketPath = task.task.packetTaskPath
		&& packetHomeRepoId !== executionRepoId;

	const packet = useAbsolutePacketPath
		? resolvePacketPaths(task.task.packetTaskPath!)
		: {
			promptPath: resolved.taskFolderResolved + "/PROMPT.md",
			statusPath: resolved.statusPath,
			donePath: resolved.donePath,
			reviewsDir: resolved.taskFolderResolved + "/.reviews",
			taskFolder: resolved.taskFolderResolved,
		};

	return {
		id,
		taskId: task.taskId,
		segmentId,
		executionRepoId,
		packetHomeRepoId,
		repoPaths,
		worktreePath: executionWorktreePath,
		packet,
		task: task.task,
	};
}

/**
 * Build a RuntimeAgentId for a lane's agent from existing naming.
 *
 * Bridges the current lane-session naming convention into a
 * Runtime V2 stable agent ID. The output is compatible with
 * existing supervisor tools and mailbox addressing.
 *
 * @param lane - Allocated lane with a lane session name
 * @param role - Agent role
 * @param mergeIndex - Merge wave index (only for merge agents)
 * @returns Canonical agent ID
 *
 * @since TP-102
 */
export function buildAgentIdFromLane(
	lane: AllocatedLane,
	role: RuntimeAgentRole,
	mergeIndex?: number,
): RuntimeAgentId {
	// The current laneSessionId is already in the right format
	// (e.g., "orch-henrylach-lane-1"). We derive agent IDs from it
	// by appending the role suffix, matching the existing convention.
	if (role === "merger" && mergeIndex != null) {
		// Merge agents use a different naming pattern
		const prefix = laneSessionIdOf(lane).replace(/-lane-\d+$/, "");
		return `${prefix}-merge-${mergeIndex}`;
	}
	if (role === "lane-runner") {
		return laneSessionIdOf(lane);
	}
	return `${laneSessionIdOf(lane)}-${role}`;
}

/**
 * Resolve the Runtime V2 state root from available context.
 *
 * The state root is where `.pi/runtime/` artifacts live. In workspace
 * mode this is the workspace root; in repo mode it's the repo root.
 *
 * This centralizes the resolution so Runtime V2 code doesn't need
 * to repeat the workspace-vs-repo logic.
 *
 * @param repoRoot - Main repository root
 * @param workspaceRoot - Workspace root (undefined in repo mode)
 * @returns Absolute path to use as the state root for .pi/ artifacts
 *
 * @since TP-102
 */
/**
 * Parse an agent .md file: extract frontmatter and body.
 * Returns null if file doesn't exist or is malformed.
 * @since TP-117
 */
function parseAgentFile(filePath: string): { fm: Record<string, string>; body: string } | null {
	try {
		if (!existsSync(filePath)) return null;
		const raw = readFileSync(filePath, "utf-8");
		const fmEnd = raw.indexOf("---", 4);
		if (fmEnd < 0) return { fm: {}, body: raw.trim() };
		const fmBlock = raw.slice(4, fmEnd).trim();
		const fm: Record<string, string> = {};
		for (const line of fmBlock.split("\n")) {
			const m = line.match(/^([\w-]+)\s*:\s*(.+)/);
			if (m) fm[m[1]] = m[2].trim();
		}
		return { fm, body: raw.slice(fmEnd + 3).trim() };
	} catch { return null; }
}

/**
 * Load the base agent prompt from the taskplane package's templates/ directory.
 * Resolves the package root via well-known npm global paths.
 * @since TP-117
 */
function loadBaseAgentPrompt(agentName: string): string {
	// resolveTaskplaneAgentTemplate handles all npm setups (nvm, Homebrew, volta, Windows, etc.)
	// via npm root -g caching and well-known fallback paths (see path-resolver.ts, TP-157).
	// This avoids silently returning "" which would cause the worker to skip reviews.
	try {
		const resolved = resolveTaskplaneAgentTemplate(agentName);
		if (existsSync(resolved)) {
			const def = parseAgentFile(resolved);
			if (def?.body) return def.body;
		}
	} catch { /* fall through */ }
	return "";
}

/**
 * Load local project agent prompt from .pi/agents/ or agents/ directory.
 * Supports standalone mode (local replaces base entirely).
 * @since TP-117
 */
function loadLocalAgentPrompt(stateRoot: string, agentName: string): string {
	const paths = [
		join(stateRoot, ".pi", "agents", `${agentName}.md`),
		join(stateRoot, "agents", `${agentName}.md`),
	];
	for (const p of paths) {
		const def = parseAgentFile(p);
		if (def) {
			// standalone: true → use local as-is (body only, replaces base)
			if (def.fm.standalone === "true") return def.body;
			// Otherwise return body as project-specific guidance to append
			if (def.body) return def.body;
		}
	}
	return "";
}

// ── Agent Definition Loading ─────────────────────────────────────────

/** Track whether an agent pointer warning has been logged this session (log once). */
let _execPointerWarningLogged = false;

/**
 * Reset agent pointer warning state for testing.
 * @since TP-161
 */
export function resetPointerWarning(): void {
	_execPointerWarningLogged = false;
}

/**
 * Resolve agent files using the workspace pointer (workspace mode only).
 * Returns the agentRoot from the pointer, or null in repo mode / on failure.
 */
function resolveAgentPointerRoot(): string | null {
	const wsRoot = process.env.TASKPLANE_WORKSPACE_ROOT;
	if (!wsRoot) return null;
	try {
		const wsConfig = loadWorkspaceConfig(wsRoot);
		const result = resolvePointer(wsRoot, wsConfig);
		if (result?.warning && !_execPointerWarningLogged) {
			_execPointerWarningLogged = true;
			console.error(`[execution] pointer: ${result.warning}`);
		}
		return result?.agentRoot ?? null;
	} catch {
		return null;
	}
}

/**
 * Load a complete agent definition (systemPrompt + tools + model) by name.
 *
 * Resolution order:
 *   1. cwd/.pi/agents/<name>.md
 *   2. cwd/agents/<name>.md
 *   3. pointer.agentRoot/<name>.md (workspace mode only)
 *   4. Base package templates/agents/<name>.md
 *
 * If a local file has `standalone: true` in frontmatter, it is used as-is
 * (no base composition). Otherwise, base + local are composed.
 *
 * @param cwd - Working directory (project root) to search for local agent files
 * @param name - Agent name (e.g., "task-worker", "task-reviewer")
 * @returns Composed agent definition, or null if no base and no local file found
 * @since TP-161
 */
export function loadAgentDef(cwd: string, name: string): { systemPrompt: string; tools: string; model: string } | null {
	const localPaths = [
		join(cwd, ".pi", "agents", `${name}.md`),
		join(cwd, "agents", `${name}.md`),
	];

	// In workspace mode, add pointer-resolved agent root as fallback
	const agentRoot = resolveAgentPointerRoot();
	if (agentRoot) {
		localPaths.push(join(agentRoot, `${name}.md`));
	}

	// Load base from package
	let baseDef: { fm: Record<string, string>; body: string } | null = null;
	try {
		const basePath = resolveTaskplaneAgentTemplate(name);
		if (existsSync(basePath)) {
			baseDef = parseAgentFile(basePath);
		}
	} catch { /* fall through */ }

	// Load local override (first found wins)
	let localDef: { fm: Record<string, string>; body: string } | null = null;
	for (const p of localPaths) {
		localDef = parseAgentFile(p);
		if (localDef) break;
	}

	// No base and no local → null
	if (!baseDef && !localDef) return null;

	// Local with standalone: true → use local as-is, ignore base
	if (localDef?.fm.standalone === "true") {
		return {
			systemPrompt: localDef.body,
			tools: localDef.fm.tools || "read,grep,find,ls",
			model: localDef.fm.model || "",
		};
	}

	// Compose base + local
	const basePrompt = baseDef?.body || "";
	const localPrompt = localDef?.body || "";
	const composedPrompt = localPrompt
		? basePrompt + "\n\n---\n\n## Project-Specific Guidance\n\n" + localPrompt
		: basePrompt;

	// Local frontmatter overrides base (tools, model)
	const tools = localDef?.fm.tools || baseDef?.fm.tools || "read,grep,find,ls";
	const model = localDef?.fm.model || baseDef?.fm.model || "";

	return { systemPrompt: composedPrompt.trim(), tools, model };
}

export function resolveRuntimeStateRoot(
	repoRoot: string,
	workspaceRoot?: string,
): string {
	return workspaceRoot ?? repoRoot;
}

// ── Runtime V2 Lane Execution (TP-105) ────────────────────────────

import { executeTaskV2, type LaneRunnerConfig, type LaneRunnerTaskResult } from "./lane-runner.ts";

/**
 * Execute a lane using the Runtime V2 headless backend.
 *
 * This replaces the legacy session-backed `executeLane()` for lanes that
 * should run on the new direct-child architecture. It uses the
 * lane-runner module which spawns workers via agent-host.ts instead
 * of terminal-session-backed workers.
 *
 * The function signature is deliberately close to the legacy
 * `executeLane()` to minimize integration churn in the engine.
 * The key difference: no legacy lane sessions are created.
 *
 * @since TP-105
 */

/**
 * Build reviewer env vars from a TaskRunnerConfig or reviewer config object.
 * Used to ensure reviewer config is consistently passed to executeLaneV2
 * across all call sites (initial waves, resume, retries).
 *
 * Returns only the keys that have non-empty values, so that empty/inherit
 * config does not override inherited env vars from the parent process.
 *
 * @since TP-160
 */
/**
 * Parse a JSON string array from an env var value, returning empty array on failure.
 * @since TP-180
 */
function parseJsonArrayEnv(value?: string): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		if (Array.isArray(parsed)) return parsed.filter((v: unknown): v is string => typeof v === "string");
	} catch { /* ignore malformed */ }
	return [];
}

export function buildReviewerEnv(
	reviewerConfig?: { model?: string; thinking?: string; tools?: string; excludeExtensions?: string[] } | null,
): Record<string, string> {
	const env: Record<string, string> = {};
	if (reviewerConfig?.model) env.TASKPLANE_REVIEWER_MODEL = reviewerConfig.model;
	if (reviewerConfig?.thinking) env.TASKPLANE_REVIEWER_THINKING = reviewerConfig.thinking;
	if (reviewerConfig?.tools) env.TASKPLANE_REVIEWER_TOOLS = reviewerConfig.tools;
	// TP-180: Forward reviewer extension exclusions as JSON array
	if (reviewerConfig?.excludeExtensions && reviewerConfig.excludeExtensions.length > 0) {
		env.TASKPLANE_REVIEWER_EXCLUDE_EXTENSIONS = JSON.stringify(reviewerConfig.excludeExtensions);
	}
	return env;
}

/**
 * Build worker extension exclusion env vars from config.
 * @since TP-180
 */
export function buildWorkerExcludeEnv(
	workerExcludeExtensions?: string[] | null,
): Record<string, string> {
	const env: Record<string, string> = {};
	if (workerExcludeExtensions && workerExcludeExtensions.length > 0) {
		env.TASKPLANE_WORKER_EXCLUDE_EXTENSIONS = JSON.stringify(workerExcludeExtensions);
	}
	return env;
}

export async function executeLaneV2(
	lane: AllocatedLane,
	config: OrchestratorConfig,
	repoRoot: string,
	pauseSignal: { paused: boolean },
	workspaceRoot?: string,
	isWorkspaceMode?: boolean,
	extraEnvVars?: Record<string, string>,
	onSupervisorAlert?: SupervisorAlertCallback,
): Promise<LaneExecutionResult> {
	const laneId = lane.laneId;
	const laneStartTime = Date.now();
	const outcomes: LaneTaskOutcome[] = [];
	let shouldSkipRemaining = false;

	const stateRoot = resolveRuntimeStateRoot(repoRoot, workspaceRoot);
	const workspaceConfig = (isWorkspaceMode && workspaceRoot)
		? loadWorkspaceConfig(workspaceRoot)
		: null;
	const batchId = config.orchestrator?.batchId || extraEnvVars?.ORCH_BATCH_ID || String(Date.now());

	// Build agent ID prefix — must match the wave planner's naming (TP-115).
	// Uses resolveOperatorId() so agent registry keys align with lane session IDs.
	const sessionPrefix = config.orchestrator?.sessionPrefix ?? "orch";
	const opId = resolveOperatorId(config);
	const agentIdPrefix = `${sessionPrefix}-${opId}`;

	// Load worker agent definition: compose base template + local project guidance.
	// The base template (templates/agents/task-worker.md) contains critical behavioral
	// rules: checkpoint discipline, STATUS.md resume algorithm, review_step instructions.
	// The local file (.pi/agents/task-worker.md) adds project-specific guidance.
	let workerSystemPrompt = "You are a task execution agent. Read STATUS.md first, find unchecked items, work on them, checkpoint after each.";
	let workerSegmentPrompt = "";
	try {
		const basePrompt = loadBaseAgentPrompt("task-worker");
		const localPrompt = loadLocalAgentPrompt(stateRoot, "task-worker");
		if (basePrompt && localPrompt) {
			workerSystemPrompt = basePrompt + "\n\n---\n\n## Project-Specific Guidance\n\n" + localPrompt;
		} else if (basePrompt) {
			workerSystemPrompt = basePrompt;
		} else if (localPrompt) {
			workerSystemPrompt = localPrompt;
		}
		// Load segment-scoped prompt overlay (appended when isSegmentScoped)
		const segPrompt = loadBaseAgentPrompt("task-worker-segment");
		if (segPrompt) workerSegmentPrompt = segPrompt;
	} catch { /* use default */ }

	execLog(laneId, "LANE", `starting Runtime V2 execution of ${lane.tasks.length} task(s)`, {
		worktree: lane.worktreePath,
		agentPrefix: agentIdPrefix,
	});

	for (const task of lane.tasks) {
		const taskSegmentId = task.task.activeSegmentId ?? null;
		if (shouldSkipRemaining || pauseSignal.paused) {
			const reason = pauseSignal.paused ? "Skipped due to pause signal" : "Skipped due to prior task failure in lane";
			outcomes.push({
				taskId: task.taskId,
				status: "skipped",
				segmentId: taskSegmentId,
				startTime: null,
				endTime: null,
				exitReason: reason,
				sessionName: buildRuntimeAgentId(agentIdPrefix, lane.laneNumber, "worker"),
				doneFileFound: false,
				laneNumber: lane.laneNumber,
			});
			continue;
		}

		// Build execution unit
		const unit = buildExecutionUnit(lane, task, repoRoot, isWorkspaceMode, workspaceConfig);

		const rawAutonomy = String(extraEnvVars?.TASKPLANE_SUPERVISOR_AUTONOMY ?? "autonomous").toLowerCase();
		const supervisorAutonomy: LaneRunnerConfig["supervisorAutonomy"] =
			(rawAutonomy === "interactive" || rawAutonomy === "supervised" || rawAutonomy === "autonomous")
				? rawAutonomy as LaneRunnerConfig["supervisorAutonomy"]
				: "autonomous";

		const laneRunnerConfig: LaneRunnerConfig = {
			batchId,
			agentIdPrefix,
			laneNumber: lane.laneNumber,
			worktreePath: lane.worktreePath,
			branch: lane.branch,
			repoId: lane.repoId ?? "default",
			repoPaths: unit.repoPaths,
			stateRoot,
			workerModel: "",
			workerTools: "read,write,edit,bash,grep,find,ls",
			workerThinking: "",
			workerSystemPrompt,
			workerSegmentPrompt,
			reviewerModel: extraEnvVars?.TASKPLANE_REVIEWER_MODEL || "",
			reviewerThinking: extraEnvVars?.TASKPLANE_REVIEWER_THINKING || "",
			reviewerTools: extraEnvVars?.TASKPLANE_REVIEWER_TOOLS || "",
			// TP-180: Extension exclusion lists from config
			workerExcludeExtensions: parseJsonArrayEnv(extraEnvVars?.TASKPLANE_WORKER_EXCLUDE_EXTENSIONS),
			reviewerExcludeExtensions: parseJsonArrayEnv(extraEnvVars?.TASKPLANE_REVIEWER_EXCLUDE_EXTENSIONS),
			supervisorAutonomy,
			projectName: config.project?.name || "project",
			maxIterations: 20,
			noProgressLimit: 3,
			maxWorkerMinutes: config.failure?.maxWorkerMinutes || 120,
			warnPercent: 85,
			killPercent: 95,
			onSupervisorAlert,
		};

		try {
			const result = await executeTaskV2(unit, laneRunnerConfig, pauseSignal);
			const outcome: LaneTaskOutcome = {
				...result.outcome,
				laneNumber: result.outcome.laneNumber ?? lane.laneNumber,
			};

			// Commit artifacts after success (same as legacy path)
			if (outcome.status === "succeeded") {
				try {
					commitTaskArtifacts(lane, task, laneId, { stateRoot, batchId, laneNumber: lane.laneNumber, repoId: lane.repoId ?? "default" });
					// Reset worktree for next task
					if (lane.tasks.indexOf(task) < lane.tasks.length - 1) {
						runGit(["checkout", "--", "."], lane.worktreePath);
						runGit(["clean", "-fd"], lane.worktreePath);
					}
				} catch (err: unknown) {
					const errMsg = err instanceof Error ? err.message : String(err);
					outcome.status = "failed";
					outcome.exitReason = errMsg;
				}
			}

			outcomes.push(outcome);

			if (outcome.status === "failed" || outcome.status === "stalled") {
				shouldSkipRemaining = true;
			}
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			execLog(laneId, task.taskId, `Runtime V2 execution error: ${errMsg}`);
			outcomes.push({
				taskId: task.taskId,
				status: "failed",
				segmentId: taskSegmentId,
				startTime: Date.now(),
				endTime: Date.now(),
				exitReason: `Runtime V2 execution error: ${errMsg}`,
				sessionName: buildRuntimeAgentId(agentIdPrefix, lane.laneNumber, "worker"),
				doneFileFound: false,
				laneNumber: lane.laneNumber,
			});
			shouldSkipRemaining = true;
		}
	}

	const endTime = Date.now();
	const succeeded = outcomes.every(o => o.status === "succeeded");
	const failed = outcomes.some(o => o.status === "failed" || o.status === "stalled");

	return {
		laneNumber: lane.laneNumber,
		laneId,
		tasks: outcomes,
		overallStatus: succeeded ? "succeeded" : failed ? "failed" : "partial",
		startTime: laneStartTime,
		endTime,
	};
}

// ── /orch Command — Full Execution (Step 5) ─────────────────────────

