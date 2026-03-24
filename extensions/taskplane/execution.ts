/**
 * Lane execution, monitoring, wave execution loop
 * @module orch/execution
 */
import { readFileSync, existsSync, statSync, unlinkSync, mkdirSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname, resolve, relative, delimiter as pathDelimiter } from "path";
import { tmpdir, userInfo } from "os";

import { DONE_GRACE_MS, EXECUTION_POLL_INTERVAL_MS, ExecutionError, SESSION_SPAWN_RETRY_MAX } from "./types.ts";
import type { AllocatedLane, AllocatedTask, DependencyGraph, LaneExecutionResult, LaneMonitorSnapshot, LaneTaskOutcome, LaneTaskStatus, MonitorState, MtimeTracker, OrchestratorConfig, ParsedTask, TaskMonitorSnapshot, WaveExecutionResult, WorkspaceConfig } from "./types.ts";
import { allocateLanes } from "./waves.ts";
import { runGit } from "./git.ts";

// ── Task Runner Extension Path Resolution ────────────────────────────

/**
 * Find the task-runner extension path for lane sessions.
 *
 * Resolution order:
 *   1. Local project: {repoRoot}/extensions/task-runner.ts (for taskplane dev)
 *   2. Global npm (Windows): {APPDATA}/npm/node_modules/taskplane/extensions/task-runner.ts
 *   3. Global npm (Unix): /usr/local/lib/node_modules/taskplane/extensions/task-runner.ts
 *   4. npm peer: resolve from pi's location
 *
 * @throws ExecutionError if task-runner.ts cannot be found anywhere
 */
function resolveTaskRunnerExtensionPath(repoRoot: string): string {
	const extFile = join("extensions", "task-runner.ts");

	// 1. Local project (taskplane development)
	const localPath = join(resolve(repoRoot), extFile);
	if (existsSync(localPath)) return localPath;

	// 2. Global npm install paths
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const candidates: string[] = [];
	if (process.env.APPDATA) {
		candidates.push(join(process.env.APPDATA, "npm", "node_modules", "taskplane", extFile));
	}
	if (home) {
		candidates.push(join(home, "AppData", "Roaming", "npm", "node_modules", "taskplane", extFile));
		candidates.push(join(home, ".npm-global", "lib", "node_modules", "taskplane", extFile));
	}
	candidates.push(join("/usr", "local", "lib", "node_modules", "taskplane", extFile));

	// 3. Peer of pi's package
	try {
		const piPath = process.argv[1] || "";
		const piPkgDir = resolve(piPath, "..", "..");
		candidates.push(join(piPkgDir, "..", "taskplane", extFile));
	} catch { /* ignore */ }

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	// Fallback: return the local path (will fail at spawn time with a clear error)
	return localPath;
}

// ── RPC Wrapper Path Resolution ──────────────────────────────────────

/**
 * Find the rpc-wrapper.mjs path for lane sessions.
 *
 * Resolution order mirrors resolveTaskRunnerExtensionPath:
 *   1. Local project: {repoRoot}/bin/rpc-wrapper.mjs (for taskplane dev)
 *   2. Global npm (Windows): {APPDATA}/npm/node_modules/taskplane/bin/rpc-wrapper.mjs
 *   3. Global npm (Unix): /usr/local/lib/node_modules/taskplane/bin/rpc-wrapper.mjs
 *   4. npm peer: resolve from pi's location
 *
 * @throws ExecutionError if rpc-wrapper.mjs cannot be found anywhere
 */
export function resolveRpcWrapperPath(repoRoot: string): string {
	const wrapperFile = join("bin", "rpc-wrapper.mjs");

	// 1. Local project (taskplane development)
	const localPath = join(resolve(repoRoot), wrapperFile);
	if (existsSync(localPath)) return localPath;

	// 2. Global npm install paths
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const candidates: string[] = [];
	if (process.env.APPDATA) {
		candidates.push(join(process.env.APPDATA, "npm", "node_modules", "taskplane", wrapperFile));
	}
	if (home) {
		candidates.push(join(home, "AppData", "Roaming", "npm", "node_modules", "taskplane", wrapperFile));
		candidates.push(join(home, ".npm-global", "lib", "node_modules", "taskplane", wrapperFile));
	}
	candidates.push(join("/usr", "local", "lib", "node_modules", "taskplane", wrapperFile));

	// 3. Peer of pi's package
	try {
		const piPath = process.argv[1] || "";
		const piPkgDir = resolve(piPath, "..", "..");
		candidates.push(join(piPkgDir, "..", "taskplane", wrapperFile));
	} catch { /* ignore */ }

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	// Fallback: return the local path (will fail at spawn time with a clear error)
	return localPath;
}

// ── Telemetry Path Generation ────────────────────────────────────────

/**
 * Generate telemetry file paths for a lane session.
 *
 * Naming contract from resilience roadmap:
 *   .pi/telemetry/{opId}-{batchId}-{repoId}[-{taskId}][-lane-{N}]-{role}.{ext}
 *
 * @param sessionName  - TMUX session name (e.g., "orch-lane-1")
 * @param sidecarRoot  - Root dir for sidecar files (e.g., <workspace>/.pi or <repo>/.pi)
 * @param taskId       - Task identifier (e.g., "TP-049")
 * @returns { sidecarPath, exitSummaryPath, telemetryDir }
 */
export function generateTelemetryPaths(
	sessionName: string,
	sidecarRoot: string,
	taskId?: string,
): { sidecarPath: string; exitSummaryPath: string; telemetryDir: string } {
	const telemetryTs = Date.now();

	// Resolve opId: same priority chain as naming.ts resolveOperatorId()
	let opId = "op";
	const envOpId = process.env.TASKPLANE_OPERATOR_ID;
	if (envOpId?.trim()) {
		opId = envOpId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "op";
	} else {
		try {
			const username = userInfo().username;
			if (username?.trim()) {
				opId = username.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "op";
			}
		} catch { /* userInfo() can throw on some platforms */ }
	}

	const batchId = String(telemetryTs);
	const repoId = "default";

	// Extract role from sessionName — lane sessions are "worker" role
	const role = "worker";
	const laneMatch = sessionName.match(/lane-(\d+)/);
	const laneSuffix = laneMatch ? `-lane-${laneMatch[1]}` : "";

	// Include taskId when available
	const taskIdSegment = taskId
		? `-${taskId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30)}`
		: "";
	const telemetryBasename = `${opId}-${batchId}-${repoId}${taskIdSegment}${laneSuffix}-${role}`;
	const telemetryDir = join(sidecarRoot, "telemetry");
	if (!existsSync(telemetryDir)) mkdirSync(telemetryDir, { recursive: true });
	const sidecarPath = join(telemetryDir, `${telemetryBasename}.jsonl`);
	const exitSummaryPath = join(telemetryDir, `${telemetryBasename}-exit.json`);

	return { sidecarPath, exitSummaryPath, telemetryDir };
}

// ── Execution Helpers ────────────────────────────────────────────────

/**
 * Structured log helper for lane execution.
 *
 * All execution logs go to stderr (same pattern as task-runner.ts).
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
 * Check if a TMUX session exists (is alive).
 *
 * @param sessionName - TMUX session name to check
 * @returns true if session exists
 */
export function tmuxHasSession(sessionName: string): boolean {
	const result = spawnSync("tmux", ["has-session", "-t", sessionName]);
	return result.status === 0;
}

/**
 * Kill a TMUX session if it exists.
 *
 * Idempotent: returns true if session was killed or was already absent.
 *
 * @param sessionName - TMUX session name to kill
 * @returns true if session is now absent
 */
export function tmuxKillSession(sessionName: string): boolean {
	// Check liveness first so we can distinguish "already gone" from "kill failed".
	const wasAlive = tmuxHasSession(sessionName);
	if (!wasAlive) {
		return true; // Already absent
	}

	spawnSync("tmux", ["kill-session", "-t", sessionName]);

	// Consider success only if the session is now absent.
	return !tmuxHasSession(sessionName);
}

/**
 * Kill a lane session and its child sessions (worker, reviewer).
 *
 * Child session names follow the convention:
 *   - `{sessionName}-worker`
 *   - `{sessionName}-reviewer`
 *
 * @param sessionName - Base lane session name (e.g., "orch-lane-1")
 */
export function killLaneAndChildren(sessionName: string): void {
	// Kill children first (they depend on the parent context)
	tmuxKillSession(`${sessionName}-worker`);
	tmuxKillSession(`${sessionName}-reviewer`);
	// Then kill the parent lane session
	tmuxKillSession(sessionName);
}

/**
 * Build environment variables for a lane task execution.
 *
 * These env vars tell the task-runner extension inside the TMUX session
 * how to behave:
 * - TASK_AUTOSTART: relative path to PROMPT.md from worktree root
 * - TASK_RUNNER_SPAWN_MODE: "tmux" for TMUX-based worker/reviewer spawning
 * - TASK_RUNNER_TMUX_PREFIX: prefix for worker/reviewer session names
 *
 * @param lane      - The allocated lane (provides session name and worktree path)
 * @param taskId    - Task ID for logging
 * @param promptPath - Absolute path to the task's PROMPT.md in the main repo
 * @param repoRoot  - Absolute path to the main repository root
 * @returns Map of env var name → value
 */
export function buildLaneEnvVars(
	lane: AllocatedLane,
	promptPath: string,
	repoRoot: string,
	workspaceRoot?: string,
): Record<string, string> {
	// TASK_AUTOSTART: resolve the prompt path for the lane session.
	//
	// In workspace mode, tasks may live in a different repo than the lane's
	// worktree (e.g., task PROMPT.md in shared-libs, worker runs in api-service).
	// Always use the absolute path — task-runner's resolve(cwd, autoPath) handles
	// absolute paths correctly, and this avoids broken relative paths when the
	// task folder is outside the lane's repo.
	//
	// In repo mode (no workspace), we still use relative paths from repoRoot
	// because the worktree mirrors the repo structure and the task folder is
	// inside the repo.
	const repoRootNorm = resolve(repoRoot).replace(/\\/g, "/");
	const promptNorm = resolve(promptPath).replace(/\\/g, "/");

	let relativePath: string;
	if (workspaceRoot) {
		// Workspace mode: always use absolute path for cross-repo safety
		relativePath = resolve(promptPath);
	} else if (promptNorm.startsWith(repoRootNorm + "/")) {
		// Repo mode: relative path from repo root (mirrors into worktree)
		relativePath = promptNorm.slice(repoRootNorm.length + 1);
	} else {
		// Fallback: absolute path
		relativePath = resolve(promptPath);
	}

	const nodePathEntries: string[] = [join(repoRoot, "node_modules")];
	if (process.env.NODE_PATH) {
		nodePathEntries.push(...process.env.NODE_PATH.split(pathDelimiter).filter(Boolean));
	}
	const nodePath = [...new Set(nodePathEntries)].join(pathDelimiter);

	const vars: Record<string, string> = {
		TASK_AUTOSTART: relativePath,
		TASK_RUNNER_SPAWN_MODE: "subprocess",
		TASK_RUNNER_TMUX_PREFIX: lane.tmuxSessionName,
		ORCH_SIDECAR_DIR: join(workspaceRoot || repoRoot, ".pi"),
		NODE_PATH: nodePath,
		// Pi's TUI (ink/react) hangs silently with TERM=tmux-256color (tmux default).
		// Force xterm-256color so pi can render and start execution.
		TERM: "xterm-256color",
	};

	// In workspace mode, the worktree cwd is inside a repo — not the workspace root.
	// The task-runner needs TASKPLANE_WORKSPACE_ROOT to find .pi/ config
	// and resolve task area paths from the correct base directory.
	// Always set when workspaceRoot is provided (workspace mode), regardless of
	// whether it equals repoRoot (it often does — cwd is the workspace root).
	if (workspaceRoot) {
		vars.TASKPLANE_WORKSPACE_ROOT = workspaceRoot;
	}

	return vars;
}

/**
 * Convert a Windows absolute path to a tmux-friendly POSIX-style path.
 *
 * tmux `-c` expects POSIX paths when running under Git Bash/MSYS.
 * Passing `C:\...` can silently fall back to HOME, causing TASK_AUTOSTART
 * path resolution failures.
 */
export function toTmuxPath(pathValue: string): string {
	const normalized = resolve(pathValue).replace(/\\/g, "/");
	const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
	if (driveMatch) {
		return `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
	}
	return normalized;
}

/**
 * Build the tmux new-session command for spawning a lane.
 *
 * Constructs a properly escaped command that:
 * 1. Sets env vars (TASK_AUTOSTART, TASK_RUNNER_SPAWN_MODE, TASK_RUNNER_TMUX_PREFIX)
 * 2. Runs `node rpc-wrapper.mjs` to spawn pi with the task-runner extension,
 *    producing structured telemetry (sidecar JSONL + exit summary JSON).
 *
 * The RPC wrapper spawns pi in RPC mode with the task-runner extension loaded.
 * The extension's TASK_AUTOSTART env var triggers task execution on init.
 * A minimal prompt file is created to satisfy the wrapper's --prompt-file requirement.
 *
 * Shell escaping: env var values are single-quoted to prevent expansion.
 * Path args are single-quoted to handle spaces and special characters.
 *
 * @param sessionName  - TMUX session name (e.g., "orch-lane-1")
 * @param worktreePath - Absolute path to the lane worktree
 * @param repoRoot     - Absolute path to main repo (for extension absolute path)
 * @param envVars      - Environment variables to set
 * @param laneLogPath  - Optional path to write lane session stdout/stderr
 * @param sidecarPath  - Path for RPC telemetry sidecar JSONL file
 * @param exitSummaryPath - Path for RPC telemetry exit summary JSON file
 * @returns Array of arguments for spawnSync("tmux", args)
 */
export function buildTmuxSpawnArgs(
	sessionName: string,
	worktreePath: string,
	repoRoot: string,
	envVars: Record<string, string>,
	laneLogPath?: string,
	sidecarPath?: string,
	exitSummaryPath?: string,
): string[] {
	// Shell-quote a value for safe embedding in a command string.
	// Wraps in single quotes, escaping any internal single quotes.
	const shellQuote = (s: string): string => {
		if (/[\s"'`$\\!&|;()<>{}#*?~]/.test(s)) {
			return `'${s.replace(/'/g, "'\\''")}'`;
		}
		return s;
	};

	// Build the command string that runs inside the TMUX session.
	const envParts = Object.entries(envVars)
		.map(([key, val]) => `${key}=${shellQuote(val)}`)
		.join(" ");

	const taskRunnerExtPath = resolveTaskRunnerExtensionPath(repoRoot);

	let piCommand: string;

	if (sidecarPath && exitSummaryPath) {
		// ── RPC Wrapper mode: structured telemetry ──────────────
		// Spawn `node rpc-wrapper.mjs` instead of `pi` directly.
		// The wrapper runs pi in RPC mode, captures telemetry to
		// sidecar JSONL, and writes exit summary on process exit.
		const rpcWrapperPath = resolveRpcWrapperPath(repoRoot);

		// Create a minimal prompt file for the RPC wrapper.
		// The task-runner extension handles execution via TASK_AUTOSTART;
		// this prompt satisfies the wrapper's --prompt-file requirement.
		const promptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const promptTmpFile = join(tmpdir(), `pi-lane-prompt-${promptId}.txt`);
		writeFileSync(promptTmpFile, "Execute the task as configured by the task-runner extension.");

		piCommand = [
			envParts,
			"node", shellQuote(rpcWrapperPath),
			"--sidecar-path", shellQuote(sidecarPath),
			"--exit-summary-path", shellQuote(exitSummaryPath),
			"--prompt-file", shellQuote(promptTmpFile),
			"--extensions", shellQuote(taskRunnerExtPath),
		].filter(Boolean).join(" ");
	} else {
		// ── Legacy mode: direct pi spawn (no telemetry) ─────────
		piCommand = `${envParts} pi --no-session -e ${shellQuote(taskRunnerExtPath)}`;
	}

	// NOTE: Do not redirect lane output here. Shell redirection has proven
	// fragile across Windows + tmux environments and can prevent session spawn.
	// Diagnostics use tmux pane capture + STATUS tail in pollUntilTaskComplete().

	const tmuxWorktreePath = toTmuxPath(worktreePath);
	const wrappedCommand = `cd ${shellQuote(tmuxWorktreePath)} && ${piCommand}`;

	return [
		"new-session", "-d",
		"-s", sessionName,
		wrappedCommand,
	];
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
	return join(lane.worktreePath, ".pi", "orch-logs", `${lane.tmuxSessionName}-${task.taskId}.log`);
}

/**
 * Relative lane log path used inside the tmux shell command.
 *
 * Relative paths avoid Windows drive-letter parsing issues in shell redirection.
 */
export function resolveLaneLogRelativePath(
	lane: AllocatedLane,
	task: AllocatedTask,
): string {
	return join(".pi", "orch-logs", `${lane.tmuxSessionName}-${task.taskId}.log`).replace(/\\/g, "/");
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
 * Capture tail output from a live TMUX pane for diagnostics.
 *
 * Works even when lane log redirection is disabled (Windows-safe fallback).
 */
export function captureTmuxPaneTail(
	sessionName: string,
	maxLines: number = 40,
	maxChars: number = 1200,
): string {
	const result = spawnSync("tmux", ["capture-pane", "-p", "-t", sessionName], {
		encoding: "utf-8",
		timeout: 3000,
	});
	if (result.status !== 0) return "";
	const raw = (result.stdout || "").replace(/\r\n/g, "\n").trim();
	if (!raw) return "";
	const tail = raw.split("\n").slice(-maxLines).join("\n").trim();
	if (!tail) return "";
	return tail.length > maxChars ? tail.slice(-maxChars) : tail;
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
	const repoRootNorm = resolve(repoRoot).replace(/\\/g, "/");
	const folderNorm = resolve(taskFolder).replace(/\\/g, "/");

	let resolvedFolder: string;

	if (isWorkspaceMode) {
		// Workspace mode: task folder may live in a different repo than
		// the lane's worktree. Always use the absolute canonical path —
		// .DONE and STATUS.md are written by workers to the original
		// task folder (via absolute TASK_AUTOSTART path), not to the worktree.
		resolvedFolder = resolve(taskFolder);
	} else if (folderNorm.startsWith(repoRootNorm + "/")) {
		// Repo mode: task folder is inside the repo root.
		// Translate to equivalent path in the worktree.
		const relativePath = folderNorm.slice(repoRootNorm.length + 1);
		resolvedFolder = join(worktreePath, relativePath);
	} else {
		// Fallback: use absolute path directly.
		resolvedFolder = resolve(taskFolder);
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
	const resolvedNorm = resolve(resolvedFolder).replace(/\\/g, "/");
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

/**
 * Spawn a TMUX session for a task in a lane.
 *
 * Handles:
 * - Stale session cleanup (kill if session name already exists)
 * - Retry on transient spawn failures (up to SESSION_SPAWN_RETRY_MAX)
 * - Structured logging
 *
 * @param lane     - Allocated lane with worktree and session info
 * @param task     - Task to execute
 * @param config   - Orchestrator configuration
 * @param repoRoot - Main repository root
 * @throws ExecutionError if spawn fails after retries
 */
export function spawnLaneSession(
	lane: AllocatedLane,
	task: AllocatedTask,
	config: OrchestratorConfig,
	repoRoot: string,
	workspaceRoot?: string,
): void {
	const sessionName = lane.tmuxSessionName;
	const laneId = lane.laneId;

	execLog(laneId, task.taskId, "preparing to spawn TMUX session", {
		session: sessionName,
		worktree: lane.worktreePath,
		worktreeTmuxPath: toTmuxPath(lane.worktreePath),
		logPath: resolveLaneLogPath(lane, task),
	});

	// Pre-check: worktree exists
	if (!existsSync(lane.worktreePath)) {
		throw new ExecutionError(
			"EXEC_WORKTREE_MISSING",
			`Worktree path does not exist: ${lane.worktreePath}`,
			laneId,
			task.taskId,
		);
	}

	// Build env vars
	const envVars = buildLaneEnvVars(lane, task.task.promptPath, repoRoot, workspaceRoot);

	// Prepare per-task lane log path for post-mortem diagnostics
	const laneLogPath = resolveLaneLogPath(lane, task);
	const laneLogRelativePath = resolveLaneLogRelativePath(lane, task);
	try {
		mkdirSync(dirname(laneLogPath), { recursive: true });
		if (existsSync(laneLogPath)) {
			unlinkSync(laneLogPath); // fresh log per task attempt
		}
	} catch {
		// Best effort — session can still run without log file setup
	}

	// Generate telemetry file paths for RPC wrapper sidecar
	const sidecarRoot = join(workspaceRoot || repoRoot, ".pi");
	const telemetry = generateTelemetryPaths(sessionName, sidecarRoot, task.taskId);
	execLog(laneId, task.taskId, "telemetry paths generated", {
		sidecar: telemetry.sidecarPath,
		exitSummary: telemetry.exitSummaryPath,
	});

	// Build tmux args (with RPC wrapper telemetry)
	const tmuxArgs = buildTmuxSpawnArgs(sessionName, lane.worktreePath, repoRoot, envVars, laneLogRelativePath, telemetry.sidecarPath, telemetry.exitSummaryPath);

	// Clean up stale session if exists
	if (tmuxHasSession(sessionName)) {
		execLog(laneId, task.taskId, "killing stale TMUX session", { session: sessionName });
		killLaneAndChildren(sessionName);
		// Brief pause to let tmux clean up
		spawnSync("sleep", ["0.5"], { shell: true, timeout: 3000 });
	}

	// Attempt to spawn with retry
	let lastError = "";
	for (let attempt = 1; attempt <= SESSION_SPAWN_RETRY_MAX + 1; attempt++) {
		const result = spawnSync("tmux", tmuxArgs);

		if (result.status === 0) {
			execLog(laneId, task.taskId, "TMUX session spawned successfully", {
				session: sessionName,
				attempt,
			});
			return;
		}

		lastError = result.stderr?.toString().trim() || "unknown spawn error";
		execLog(laneId, task.taskId, `spawn attempt ${attempt} failed: ${lastError}`, {
			session: sessionName,
		});

		if (attempt <= SESSION_SPAWN_RETRY_MAX) {
			// Wait before retry (1s, 2s)
			const delayMs = attempt * 1000;
			spawnSync("sleep", [`${delayMs / 1000}`], { shell: true, timeout: delayMs + 2000 });
		}
	}

	throw new ExecutionError(
		"EXEC_SPAWN_FAILED",
		`Failed to create TMUX session '${sessionName}' after ${SESSION_SPAWN_RETRY_MAX + 1} attempts. Last error: ${lastError}`,
		laneId,
		task.taskId,
	);
}

/**
 * Poll until a task completes (or fails).
 *
 * Completion detection logic:
 * 1. Check for .DONE file → task succeeded (highest priority)
 * 2. Check TMUX session liveness via `tmux has-session`
 * 3. If session exits without .DONE → wait DONE_GRACE_MS (slow disk flush)
 * 4. After grace period, if still no .DONE → task failed
 *
 * Terminal-state precedence: .DONE found at any point = success,
 * regardless of session state.
 *
 * @param lane        - Allocated lane
 * @param task        - Task being executed
 * @param config      - Orchestrator configuration
 * @param repoRoot    - Main repository root
 * @param pauseSignal - Checked each poll cycle; if true, returns early with "skipped"
 * @returns LaneTaskStatus indicating the final state
 */
export async function pollUntilTaskComplete(
	lane: AllocatedLane,
	task: AllocatedTask,
	config: OrchestratorConfig,
	repoRoot: string,
	pauseSignal: { paused: boolean },
	isWorkspaceMode?: boolean,
): Promise<{ status: LaneTaskStatus; exitReason: string; doneFileFound: boolean }> {
	const sessionName = lane.tmuxSessionName;
	const laneId = lane.laneId;
	const resolved = resolveCanonicalTaskPaths(task.task.taskFolder, lane.worktreePath, repoRoot, isWorkspaceMode);
	const donePath = resolved.donePath;
	const statusPath = resolved.statusPath;
	const laneLogPath = resolveLaneLogPath(lane, task);

	execLog(laneId, task.taskId, "polling for completion", {
		session: sessionName,
		donePath,
		statusPath,
		logPath: laneLogPath,
	});

	let lastPaneTail = "";

	// Abort signal file path — checked each poll cycle.
	// Any process can create this file to trigger abort (belt-and-suspenders
	// alongside the in-memory pauseSignal, since /orch-abort may not be able
	// to run concurrently with the /orch command handler).
	const abortSignalFile = join(repoRoot, ".pi", "orch-abort-signal");

	// Main polling loop
	while (true) {
		// Check pause signal
		if (pauseSignal.paused) {
			execLog(laneId, task.taskId, "pause signal detected during poll");
			// Don't kill the session — let the current task-runner checkpoint
			// The calling code will handle marking as skipped
			return {
				status: "skipped",
				exitReason: "Paused by user (/orch-pause)",
				doneFileFound: false,
			};
		}

		// Check file-based abort signal
		if (existsSync(abortSignalFile)) {
			execLog(laneId, task.taskId, "abort signal file detected — killing session and aborting");
			tmuxKillSession(sessionName);
			// Also kill child sessions (worker, reviewer)
			tmuxKillSession(`${sessionName}-worker`);
			tmuxKillSession(`${sessionName}-reviewer`);
			return {
				status: "failed",
				exitReason: "Aborted by signal file (.pi/orch-abort-signal)",
				doneFileFound: false,
			};
		}

		// Capture live pane output for diagnostics (best effort).
		const paneTail = captureTmuxPaneTail(sessionName);
		if (paneTail) {
			lastPaneTail = paneTail;
		}

		// Priority 1: Check for .DONE file
		if (existsSync(donePath)) {
			execLog(laneId, task.taskId, ".DONE file found — task succeeded", {
				session: sessionName,
			});
			return {
				status: "succeeded",
				exitReason: ".DONE file created by task-runner",
				doneFileFound: true,
			};
		}

		// Priority 2: Check if TMUX session is still alive
		if (!tmuxHasSession(sessionName)) {
			// Session exited — start grace period for .DONE file
			execLog(laneId, task.taskId, "TMUX session exited, entering grace period", {
				session: sessionName,
				graceMs: DONE_GRACE_MS,
			});

			// Grace period: poll .DONE file at short intervals
			const graceStart = Date.now();
			while (Date.now() - graceStart < DONE_GRACE_MS) {
				await new Promise((r) => setTimeout(r, 500));

				if (existsSync(donePath)) {
					execLog(laneId, task.taskId, ".DONE file found during grace period — task succeeded", {
						session: sessionName,
					});
					return {
						status: "succeeded",
						exitReason: ".DONE file created (found during grace period)",
						doneFileFound: true,
					};
				}
			}

			// Grace period expired without .DONE → task failed
			const logTail = readLaneLogTail(laneLogPath);
			execLog(laneId, task.taskId, "grace period expired without .DONE — task failed", {
				session: sessionName,
				logPath: laneLogPath,
			});
			if (logTail) {
				execLog(laneId, task.taskId, `lane session output (tail):\n${logTail}`);
			}
			const statusTail = readTaskStatusTail(statusPath);
			const hasLogFile = existsSync(laneLogPath);
			const outputForHint = logTail || lastPaneTail || statusTail;
			const logHint = outputForHint
				? ` Last output: ${outputForHint.replace(/\s+/g, " ").slice(-300)}`
				: "";
			const logLocation = hasLogFile ? ` Lane log: ${laneLogPath}.` : "";
			if (!logTail && lastPaneTail) {
				execLog(laneId, task.taskId, `lane session output from TMUX pane (tail):\n${lastPaneTail}`);
			}
			if (statusTail) {
				execLog(laneId, task.taskId, `task STATUS tail:\n${statusTail}`);
			}
			return {
				status: "failed",
				exitReason:
					`TMUX session '${sessionName}' exited without creating .DONE file ` +
					`(grace period ${DONE_GRACE_MS}ms expired).` +
					`${logLocation}${logHint}`,
				doneFileFound: false,
			};
		}

		// Session alive, no .DONE yet — keep polling
		await new Promise((r) => setTimeout(r, EXECUTION_POLL_INTERVAL_MS));
	}
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
): void {
	const worktreePath = lane.worktreePath;

	// Check if there are any uncommitted changes in the worktree
	const statusResult = runGit(["status", "--porcelain"], worktreePath);
	if (!statusResult.ok || !statusResult.stdout.trim()) {
		// Nothing to commit (worker already committed everything, or git error)
		return;
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


/**
 * Execute all tasks in a lane sequentially.
 *
 * For each task in the lane (in order):
 * 1. Spawn a TMUX session with TASK_AUTOSTART pointing to the task's PROMPT.md
 * 2. Poll until the task completes (or fails)
 * 3. Commit any uncommitted task artifacts (.DONE, STATUS.md) to the lane branch
 * 4. Record the outcome
 * 5. If the task failed, skip remaining tasks in the lane
 *
 * The lane reuses the same worktree and TMUX session name across tasks.
 * Each new task gets a fresh TMUX session (the previous one has exited).
 *
 * Cleanup policy:
 * - On success: session exits naturally, no cleanup needed
 * - On failure: session may have exited already; if alive, leave for debugging
 * - On pause: stop after current task, mark remaining as skipped
 * - On stall: handled by Step 3 (monitoring) — this function just polls
 *
 * @param lane        - Fully allocated lane from Step 1
 * @param config      - Orchestrator configuration
 * @param repoRoot    - Main repository root
 * @param pauseSignal - Shared signal for pause/abort (checked between tasks)
 * @returns LaneExecutionResult with per-task outcomes
 */
export async function executeLane(
	lane: AllocatedLane,
	config: OrchestratorConfig,
	repoRoot: string,
	pauseSignal: { paused: boolean },
	workspaceRoot?: string,
	isWorkspaceMode?: boolean,
): Promise<LaneExecutionResult> {
	const laneId = lane.laneId;
	const laneStartTime = Date.now();
	const outcomes: LaneTaskOutcome[] = [];
	let shouldSkipRemaining = false;

	execLog(laneId, "LANE", `starting execution of ${lane.tasks.length} task(s)`, {
		worktree: lane.worktreePath,
		session: lane.tmuxSessionName,
	});

	for (const task of lane.tasks) {
		// Check if remaining tasks should be skipped (prior failure or pause)
		if (shouldSkipRemaining || pauseSignal.paused) {
			const reason = pauseSignal.paused
				? "Skipped due to pause signal"
				: "Skipped due to prior task failure in lane";
			execLog(laneId, task.taskId, reason);
			outcomes.push({
				taskId: task.taskId,
				status: "skipped",
				startTime: null,
				endTime: null,
				exitReason: reason,
				sessionName: lane.tmuxSessionName,
				doneFileFound: false,
			});
			continue;
		}

		// Execute this task
		const taskStartTime = Date.now();
		let taskOutcome: LaneTaskOutcome;

		try {
			// Spawn TMUX session
			spawnLaneSession(lane, task, config, repoRoot, workspaceRoot);

			// Poll until completion
			const pollResult = await pollUntilTaskComplete(
				lane,
				task,
				config,
				repoRoot,
				pauseSignal,
				isWorkspaceMode,
			);

			taskOutcome = {
				taskId: task.taskId,
				status: pollResult.status,
				startTime: taskStartTime,
				endTime: Date.now(),
				exitReason: pollResult.exitReason,
				sessionName: lane.tmuxSessionName,
				doneFileFound: pollResult.doneFileFound,
			};

			// After task succeeds, commit any uncommitted artifacts (.DONE, final
			// STATUS.md update) to the lane branch so they survive the merge.
			// The task-runner writes .DONE via writeFileSync but never commits it.
			if (pollResult.status === "succeeded") {
				commitTaskArtifacts(lane, task, laneId);
			}

			// If task failed or was paused, skip remaining tasks
			if (pollResult.status === "failed" || pollResult.status === "stalled") {
				shouldSkipRemaining = true;
			}
			if (pollResult.status === "skipped") {
				// Pause was signaled during poll — mark remaining as skipped too
				shouldSkipRemaining = true;
			}
		} catch (err: unknown) {
			// Spawn or polling error
			const errMsg = err instanceof Error ? err.message : String(err);
			execLog(laneId, task.taskId, `execution error: ${errMsg}`);

			taskOutcome = {
				taskId: task.taskId,
				status: "failed",
				startTime: taskStartTime,
				endTime: Date.now(),
				exitReason: errMsg,
				sessionName: lane.tmuxSessionName,
				doneFileFound: false,
			};

			shouldSkipRemaining = true;
		}

		const elapsed = Math.round(((taskOutcome.endTime || Date.now()) - taskStartTime) / 1000);
		execLog(laneId, task.taskId, `task ${taskOutcome.status}`, {
			elapsed: `${elapsed}s`,
			doneFile: taskOutcome.doneFileFound,
		});

		outcomes.push(taskOutcome);
	}

	const laneEndTime = Date.now();
	const succeededCount = outcomes.filter((o) => o.status === "succeeded").length;
	const failedCount = outcomes.filter((o) => o.status === "failed" || o.status === "stalled").length;

	let overallStatus: LaneExecutionResult["overallStatus"];
	if (failedCount === 0 && succeededCount === lane.tasks.length) {
		overallStatus = "succeeded";
	} else if (failedCount > 0 && succeededCount > 0) {
		overallStatus = "partial";
	} else {
		overallStatus = "failed";
	}

	const totalElapsed = Math.round((laneEndTime - laneStartTime) / 1000);
	execLog(laneId, "LANE", `execution complete: ${overallStatus}`, {
		succeeded: succeededCount,
		failed: failedCount,
		skipped: outcomes.filter((o) => o.status === "skipped").length,
		elapsed: `${totalElapsed}s`,
	});

	return {
		laneNumber: lane.laneNumber,
		laneId: lane.laneId,
		tasks: outcomes,
		overallStatus,
		startTime: laneStartTime,
		endTime: laneEndTime,
	};
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
	/** File modification time (epoch ms) */
	mtime: number;
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

	// Parse using same regex patterns as task-runner's parseStatusMd
	const text = content.replace(/\r\n/g, "\n");
	const steps: ParsedWorktreeStatus["steps"] = [];
	let currentStep: {
		number: number;
		name: string;
		status: "not-started" | "in-progress" | "complete";
		checkboxes: boolean[];
	} | null = null;
	let reviewCounter = 0;
	let iteration = 0;

	for (const line of text.split("\n")) {
		const rcMatch = line.match(/\*\*Review Counter:\*\*\s*(\d+)/);
		if (rcMatch) reviewCounter = parseInt(rcMatch[1]);
		const itMatch = line.match(/\*\*Iteration:\*\*\s*(\d+)/);
		if (itMatch) iteration = parseInt(itMatch[1]);

		const stepMatch = line.match(/^###\s+Step\s+(\d+):\s*(.+)/);
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
				number: parseInt(stepMatch[1]),
				name: stepMatch[2].trim(),
				status: "not-started",
				checkboxes: [],
			};
			continue;
		}
		if (currentStep) {
			const ss = line.match(/\*\*Status:\*\*\s*(.*)/);
			if (ss) {
				const s = ss[1];
				if (s.includes("✅") || s.toLowerCase().includes("complete")) {
					currentStep.status = "complete";
				} else if (s.includes("🟨") || s.includes("🟡") || s.toLowerCase().includes("progress")) {
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
		parsed: { steps, reviewCounter, iteration, mtime },
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
 * 3. TMUX session exited without .DONE → "failed"
 * 4. Session alive + recent mtime (within stall_timeout) → "running"
 * 5. Session alive + stale mtime but within startup grace → "running" (with no stall timer yet)
 * 6. Session alive + no STATUS.md yet but within startup grace → "running"
 * 7. No session, no .DONE, never observed running → "unknown"
 *
 * @param taskId         - Task identifier
 * @param donePath       - Absolute path to the .DONE file in the worktree
 * @param sessionName    - TMUX session name for this lane
 * @param statusResult   - Parsed STATUS.md result (may be null)
 * @param tracker        - Mtime tracker for stall detection
 * @param stallTimeoutMs - Stall timeout in milliseconds
 * @param now            - Current timestamp (epoch ms) for deterministic testing
 */
export function resolveTaskMonitorState(
	taskId: string,
	donePath: string,
	sessionName: string,
	statusResult: { parsed: ParsedWorktreeStatus | null; error: string | null },
	tracker: MtimeTracker,
	stallTimeoutMs: number,
	now: number,
): TaskMonitorSnapshot {
	const sessionAlive = tmuxHasSession(sessionName);
	const doneFileFound = existsSync(donePath);

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

		// Find the current step (first in-progress, or first not-started after last complete)
		const inProgress = steps.find(s => s.status === "in-progress");
		if (inProgress) {
			currentStepName = inProgress.name;
			currentStepNumber = inProgress.number;
		} else {
			// Find first not-started step
			const notStarted = steps.find(s => s.status === "not-started");
			if (notStarted) {
				currentStepName = notStarted.name;
				currentStepNumber = notStarted.number;
			} else if (steps.length > 0) {
				// All complete
				const last = steps[steps.length - 1];
				currentStepName = last.name;
				currentStepNumber = last.number;
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

		// Kill the session and children
		execLog("monitor", taskId, `stall detected — killing session`, {
			session: sessionName,
			stallMinutes,
		});
		killLaneAndChildren(sessionName);

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
 * to TMUX sessions. It monitors via filesystem polling:
 * - STATUS.md in each worktree for step/checkbox progress
 * - .DONE files for task completion
 * - `tmux has-session` for session liveness
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
					const donePath = resolveTaskDonePath(task.task.taskFolder, lane.worktreePath, repoRoot, isWorkspaceMode);
					const statusResult = parseWorktreeStatusMd(task.task.taskFolder, lane.worktreePath, repoRoot, isWorkspaceMode);

					const snapshot = resolveTaskMonitorState(
						task.taskId,
						donePath,
						lane.tmuxSessionName,
						statusResult,
						tracker,
						stallTimeoutMs,
						now,
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

			const sessionAlive = tmuxHasSession(lane.tmuxSessionName);

			laneSnapshots.push({
				laneId: lane.laneId,
				laneNumber: lane.laneNumber,
				sessionName: lane.tmuxSessionName,
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
		sessionName: lane.tmuxSessionName,
		sessionAlive: tmuxHasSession(lane.tmuxSessionName),
		currentTaskId: null,
		currentTaskSnapshot: null,
		completedTasks: [],
		failedTasks: [],
		remainingTasks: lane.tasks.map(t => t.taskId),
	}));

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
 * won't have those files and TASK_AUTOSTART will fail with "file not found".
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
 * - **stop-all**: On first failure, all TMUX sessions are killed immediately.
 *   Returns with aborted status.
 *
 * Concurrency model:
 * - Lane execution promises are NOT cancellable (tmux sessions run externally)
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
 * @param baseBranch        - Branch to base worktrees on (captured at batch start)
 * @param onMonitorUpdate   - Optional callback for dashboard updates during monitoring
 * @param onLanesAllocated  - Optional callback fired after lane allocation succeeds
 * @param workspaceConfig   - Workspace configuration for repo routing (null/undefined = repo mode)
 * @returns WaveExecutionResult with outcomes and blocked task IDs
 */
export async function executeWave(
	waveTasks: string[],
	waveIndex: number,
	pending: Map<string, ParsedTask>,
	config: OrchestratorConfig,
	repoRoot: string,
	batchId: string,
	pauseSignal: { paused: boolean },
	dependencyGraph: DependencyGraph,
	baseBranch: string,
	onMonitorUpdate?: MonitorUpdateCallback,
	onLanesAllocated?: (lanes: AllocatedLane[]) => void,
	workspaceConfig?: WorkspaceConfig | null,
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
	// before worktree creation, so workers can find their TASK_AUTOSTART paths.
	try {
		ensureTaskFilesCommitted(waveTasks, pending, repoRoot, waveIndex);
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
	const allocResult = allocateLanes(waveTasks, pending, config, repoRoot, batchId, baseBranch, workspaceConfig);

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
	const lanePromises = lanes.map(lane =>
		executeLane(lane, config, repoRoot, wavePauseSignal, wsRoot, isWsMode),
	);

	// Start monitoring as a sibling async loop
	// Monitor runs concurrently and stops when all lanes are terminal or paused
	const monitorPromise = monitorLanes(
		lanes,
		config,
		repoRoot,
		wavePauseSignal,
		waveIndex,
		onMonitorUpdate,
		isWsMode,
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
					sessionName: lanes[idx].tmuxSessionName,
					doneFileFound: false,
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
 * On first failure: kills all TMUX sessions immediately and returns.
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
						session: lanes[idx].tmuxSessionName,
					});

					// Kill ALL lane sessions immediately
					for (const lane of lanes) {
						killLaneAndChildren(lane.tmuxSessionName);
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
					killLaneAndChildren(lane.tmuxSessionName);
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
					sessionName: lanes[idx].tmuxSessionName,
					doneFileFound: false,
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

// ── /orch Command — Full Execution (Step 5) ─────────────────────────

