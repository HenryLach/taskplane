/**
 * Task Runner — Autonomous task execution with live dashboard
 *
 * Replaces the Ralph Wiggum bash loop with a Pi extension. Workers are
 * fresh-context subprocesses; STATUS.md is persistent memory. Supports
 * cross-model review (reviewer uses a different model than the worker).
 *
 * Commands:
 *   /task <path/to/PROMPT.md>  — Start executing a task
 *   /task-status               — Re-read and display STATUS.md progress
 *   /task-pause                — Pause after current worker finishes
 *   /task-resume               — Resume a paused task
 *
 * Configuration: .pi/task-runner.yaml (project-specific settings)
 * Agents: .pi/agents/task-worker.md, .pi/agents/task-reviewer.md
 *
 * Usage: pi -e extensions/task-runner.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";
import { Container, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { spawn, spawnSync } from "child_process";
import {
	readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync,
	readdirSync, statSync, openSync, readSync, closeSync,
} from "fs";
import { tmpdir, userInfo } from "os";
import { join, dirname, basename, resolve } from "path";
import { ConfigLoadError, loadProjectConfig, toTaskConfig } from "./taskplane/config-loader.ts";
import { loadWorkspaceConfig, resolvePointer } from "./taskplane/workspace.ts";
import type { PointerResolution } from "./taskplane/types.ts";
import {
	REVIEWER_SHUTDOWN_GRACE_MS,
	REVIEWER_SIGNAL_PREFIX,
	REVIEWER_SHUTDOWN_SIGNAL,
} from "./taskplane/types.ts";
import { classifyExit } from "./taskplane/diagnostics.ts";
import type { TaskExitDiagnostic, ExitSummary } from "./taskplane/diagnostics.ts";
import {
	parsePromptMd as coreParsePromptMd,
	parseStatusMd as coreParseStatusMd,
	generateStatusMd as coreGenerateStatusMd,
	updateStatusField as coreUpdateStatusField,
	updateStepStatus as coreUpdateStepStatus,
	appendTableRow as coreAppendTableRow,
	logExecution as coreLogExecution,
	logReview as coreLogReview,
	sanitizeSteeringContent as coreSanitizeSteeringContent,
	isStepComplete as coreIsStepComplete,
	isLowRiskStep as coreIsLowRiskStep,
	extractVerdict as coreExtractVerdict,
	getHeadCommitSha as coreGetHeadCommitSha,
	findStepBoundaryCommit as coreFindStepBoundaryCommit,
	resolveStandards as coreResolveStandards,
	generateReviewRequest as coreGenerateReviewRequest,
	displayName as coreDisplayName,
	type StepInfo,
	type CoreParsedTask,
	type ParsedStatus,
} from "./taskplane/task-executor-core.ts";
import {
	generateQualityGatePrompt,
	generateFeedbackMd,
	buildFixAgentPrompt,
	readAndEvaluateVerdict,
	VERDICT_FILENAME,
	FEEDBACK_FILENAME,
	applyStatusReconciliation,
	type QualityGateContext,
	type QualityGateResult,
	type ReviewVerdict,
	type VerdictEvaluation,
} from "./taskplane/quality-gate.ts";


// ── Types ────────────────────────────────────────────────────────────

interface TaskConfig {
	project: { name: string; description: string };
	paths: { tasks: string; architecture?: string };
	testing: { commands: Record<string, string> };
	standards: { docs: string[]; rules: string[] };
	standards_overrides: Record<string, { docs?: string[]; rules?: string[] }>;
	task_areas: Record<string, { path: string; [key: string]: any }>;
	worker: {
		model: string;
		tools: string;
		thinking: string;
		spawn_mode?: "subprocess";
	};
	reviewer: { model: string; tools: string; thinking: string };
	context: {
		worker_context_window: number;
		warn_percent: number;
		kill_percent: number;
		max_worker_iterations: number;
		max_review_cycles: number;
		no_progress_limit: number;
		max_worker_minutes?: number;
	};
	quality_gate: {
		enabled: boolean;
		review_model: string;
		max_review_cycles: number;
		max_fix_cycles: number;
		pass_threshold: "no_critical" | "no_important" | "all_clear";
	};
}

interface StepInfo {
	number: number;
	name: string;
	status: "not-started" | "in-progress" | "complete";
	checkboxes: { text: string; checked: boolean }[];
	totalChecked: number;
	totalItems: number;
}

interface ParsedTask {
	taskId: string;
	taskName: string;
	reviewLevel: number;
	size: string;
	steps: StepInfo[];
	contextDocs: string[];
	taskFolder: string;
	promptPath: string;
}

type TaskPhase = "idle" | "running" | "paused" | "complete" | "error";

interface TaskState {
	phase: TaskPhase;
	task: ParsedTask | null;
	config: TaskConfig | null;
	currentStep: number;
	workerIteration: number;
	workerStatus: "idle" | "running" | "done" | "error" | "killed";
	workerElapsed: number;
	workerContextPct: number;
	workerLastTool: string;
	workerToolCount: number;
	workerInputTokens: number;
	workerOutputTokens: number;
	workerCacheReadTokens: number;
	workerCacheWriteTokens: number;
	workerCostUsd: number;
	workerProc: any;
	workerTimer: any;
	workerRetryActive: boolean;
	workerRetryCount: number;
	workerLastRetryError: string;
	/** Structured exit diagnostic from the most recent worker iteration (reserved for compatibility). */
	workerExitDiagnostic: TaskExitDiagnostic | null;
	reviewerStatus: "idle" | "running" | "done" | "error";
	reviewerType: string;
	reviewerStep: number;
	reviewerSessionName: string;
	reviewerElapsed: number;
	reviewerLastTool: string;
	reviewerToolCount: number;
	reviewerInputTokens: number;
	reviewerOutputTokens: number;
	reviewerCacheReadTokens: number;
	reviewerCacheWriteTokens: number;
	reviewerCostUsd: number;
	reviewerContextPct: number;
	reviewerProc: any;
	reviewerTimer: any;
	reviewCounter: number;
	/** Reserved for compatibility with legacy lane-state payloads. */
	persistentReviewerSession: string | null;
	/** Reserved for compatibility with legacy lane-state payloads. */
	persistentReviewerKill: (() => void) | null;
	/** Reserved for compatibility with legacy lane-state payloads. */
	persistentReviewerSignalNum: number;
	/** Reserved for compatibility with legacy lane-state payloads. */
	reviewerRespawnCount: number;
	totalIterations: number;
	stepStatuses: Map<number, StepInfo>;
}

function freshState(): TaskState {
	return {
		phase: "idle", task: null, config: null, currentStep: 0,
		workerIteration: 0, workerStatus: "idle", workerElapsed: 0,
		workerContextPct: 0, workerLastTool: "", workerToolCount: 0,
		workerInputTokens: 0, workerOutputTokens: 0, workerCacheReadTokens: 0, workerCacheWriteTokens: 0, workerCostUsd: 0,
		workerProc: null, workerTimer: null,
		workerRetryActive: false, workerRetryCount: 0, workerLastRetryError: "",
		workerExitDiagnostic: null,
		reviewerStatus: "idle", reviewerType: "", reviewerStep: 0, reviewerSessionName: "",
		reviewerElapsed: 0, reviewerLastTool: "", reviewerToolCount: 0,
		reviewerInputTokens: 0, reviewerOutputTokens: 0, reviewerCacheReadTokens: 0, reviewerCacheWriteTokens: 0,
		reviewerCostUsd: 0, reviewerContextPct: 0, reviewerProc: null, reviewerTimer: null,
		reviewCounter: 0,
		persistentReviewerSession: null, persistentReviewerKill: null, persistentReviewerSignalNum: 0, reviewerRespawnCount: 0,
		totalIterations: 0, stepStatuses: new Map(),
	};
}

// ── Config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TaskConfig = {
	project: { name: "Project", description: "" },
	paths: { tasks: "docs/task-management" },
	testing: { commands: {} },
	standards: { docs: [], rules: [] },
	standards_overrides: {},
	task_areas: {},
	worker: { model: "", tools: "read,write,edit,bash,grep,find,ls", thinking: "off" },
	reviewer: { model: "", tools: "read,bash,grep,find,ls", thinking: "on" },
	context: {
		worker_context_window: 0, warn_percent: 85, kill_percent: 95,
		max_worker_iterations: 20, max_review_cycles: 2, no_progress_limit: 3,
	},
	quality_gate: {
		enabled: false,
		review_model: "",
		max_review_cycles: 2,
		max_fix_cycles: 1,
		pass_threshold: "no_critical",
	},
};

// ── Pointer Resolution (Workspace Mode) ──────────────────────────────

/** Track whether a pointer warning has been logged this session (log once). */
let _pointerWarningLogged = false;

/**
 * Resolve the workspace pointer for config and agent path redirection.
 *
 * In workspace mode (TASKPLANE_WORKSPACE_ROOT set), reads the pointer
 * file and resolves config/agent roots to the config repo. In repo mode,
 * returns null (no pointer resolution needed).
 *
 * All pointer failures are non-fatal: missing, malformed, or invalid
 * pointer files produce a warning and fall back to existing paths.
 * Warning is logged to stderr once per session for operator visibility.
 *
 * @returns PointerResolution with resolved paths, or null in repo mode
 */
function resolveTaskRunnerPointer(): PointerResolution | null {
	const wsRoot = process.env.TASKPLANE_WORKSPACE_ROOT;
	if (!wsRoot) return null; // repo mode — no pointer needed

	try {
		const wsConfig = loadWorkspaceConfig(wsRoot);
		const result = resolvePointer(wsRoot, wsConfig);

		// Surface pointer warnings once per session for operator visibility
		if (result?.warning && !_pointerWarningLogged) {
			_pointerWarningLogged = true;
			console.error(`[task-runner] pointer: ${result.warning}`);
		}

		return result;
	} catch {
		// Workspace config load failure — fall back gracefully
		return null;
	}
}

/** Reset pointer warning state (for testing only). */
export function _resetPointerWarning(): void {
	_pointerWarningLogged = false;
}

/** Expose loadAgentDef for testing (not part of public API). */
export const _loadAgentDef = (cwd: string, name: string) => loadAgentDef(cwd, name);

/**
 * Load task-runner config via the unified config loader.
 *
 * Reads `.pi/taskplane-config.json` first; falls back to YAML files;
 * then defaults. Returns the legacy snake_case TaskConfig shape so all
 * downstream consumers remain unchanged.
 *
 * Config root resolution order (workspace mode with pointer):
 *   1. cwd has config files → use cwd (local override)
 *   2. Pointer-resolved config root has config files → use it
 *   3. TASKPLANE_WORKSPACE_ROOT has config files → use it (legacy fallback)
 *   4. Fall back to cwd (loaders will return defaults)
 *
 * Repo mode: pointer is ignored, existing behavior unchanged.
 */
export function loadConfig(cwd: string): TaskConfig {
	try {
		const pointer = resolveTaskRunnerPointer();
		const unified = loadProjectConfig(cwd, pointer?.configRoot);
		return toTaskConfig(unified);
	} catch (err: unknown) {
		if (err instanceof ConfigLoadError && err.code === "CONFIG_LEGACY_FIELD") {
			// Hard-fail deprecated TMUX-era config/prefs with migration guidance.
			throw err;
		}
		// For malformed/unreadable config, preserve historical fallback behavior.
		return { ...DEFAULT_CONFIG };
	}
}

// ── Runtime Mode Helpers ─────────────────────────────────────────────

/**
 * Detect whether this runner is executing under /orch orchestration.
 *
 * Runtime V2 exposes ORCH_BATCH_ID for lane workers. We also keep
 * TASK_RUNNER_TMUX_PREFIX as a legacy signal so older launchers are still
 * treated as orchestrated mode during migration.
 */
function isOrchestratedMode(): boolean {
	return !!process.env.ORCH_BATCH_ID || !!process.env.TASK_RUNNER_TMUX_PREFIX;
}

/**
 * Returns the lane/session prefix used for sidecar filenames.
 */
function getLanePrefix(): string {
	return process.env.TASKPLANE_LANE_PREFIX
		|| process.env.TASK_RUNNER_TMUX_PREFIX
		|| "task";
}

/**
 * Returns worker wall-clock timeout in minutes.
 *
 * Resolution order: env var → config → default 30 minutes.
 */
function getMaxWorkerMinutes(config: TaskConfig): number {
	const envVal = process.env.TASK_RUNNER_MAX_WORKER_MINUTES;
	if (envVal) {
		const parsed = parseInt(envVal, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	const configVal = config.context.max_worker_minutes;
	if (typeof configVal === "number" && configVal > 0) return configVal;
	return 30;
}

// ── Context Window Resolution ─────────────────────────────────────────

/** Default fallback context window when neither config nor model provides a value. */
const FALLBACK_CONTEXT_WINDOW = 200_000;

/**
 * Resolve the effective context window size for worker spawning.
 *
 * Resolution order (first non-zero value wins):
 *   1. Explicit user config (worker_context_window > 0 in config)
 *   2. Auto-detect from pi model registry (ctx.model.contextWindow)
 *   3. Fallback to 200K tokens
 *
 * A config value of 0 signals "auto-detect" — the default when no explicit
 * value is configured. This allows pi's model registry to provide the real
 * context window for the active model.
 *
 * @returns Object with `contextWindow` (resolved size) and `source` (diagnostic label)
 */
function resolveContextWindow(
	config: TaskConfig,
	ctx: ExtensionContext,
): { contextWindow: number; source: string } {
	// 1. Explicit user config — non-zero means the user set it deliberately
	const configVal = config.context.worker_context_window;
	if (configVal > 0) {
		return { contextWindow: configVal, source: "explicit config" };
	}

	// 2. Auto-detect from pi model registry
	const modelWindow = ctx.model?.contextWindow;
	if (modelWindow && modelWindow > 0) {
		const modelId = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		return { contextWindow: modelWindow, source: `auto-detected from ${modelId}` };
	}

	// 3. Fallback
	return { contextWindow: FALLBACK_CONTEXT_WINDOW, source: `fallback ${FALLBACK_CONTEXT_WINDOW}` };
}

// ── Orchestrator Sidecar Files ────────────────────────────────────────

/**
 * Returns the .pi directory path for sidecar files (lane state, conversation logs).
 * In orchestrated mode, the orchestrator passes ORCH_SIDECAR_DIR pointing to the
 * MAIN repo's .pi/ directory (not the worktree's).
 */
function getSidecarDir(): string {
	// Orchestrator provides the main repo .pi path
	const orchDir = process.env.ORCH_SIDECAR_DIR;
	if (orchDir) {
		if (!existsSync(orchDir)) mkdirSync(orchDir, { recursive: true });
		return orchDir;
	}
	// Fallback: walk up from cwd
	let dir = process.cwd();
	for (let i = 0; i < 10; i++) {
		const piDir = join(dir, ".pi");
		if (existsSync(piDir)) return piDir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	const piDir = join(process.cwd(), ".pi");
	if (!existsSync(piDir)) mkdirSync(piDir, { recursive: true });
	return piDir;
}

/**
 * Write lane state sidecar JSON for the web dashboard.
 * Written every second when in orchestrated mode.
 */
function writeLaneState(state: TaskState): void {
	if (!isOrchestratedMode()) return;
	const prefix = getLanePrefix(); // e.g., "orch-lane-1"
	const filePath = join(getSidecarDir(), `lane-state-${prefix}.json`);
	try {
		const data = {
			prefix,
			taskId: state.task?.taskId || null,
			phase: state.phase,
			currentStep: state.currentStep,
			totalIterations: state.totalIterations,
			workerIteration: state.workerIteration,
			workerStatus: state.workerStatus,
			workerElapsed: state.workerElapsed,
			workerContextPct: state.workerContextPct,
			workerLastTool: state.workerLastTool,
			workerToolCount: state.workerToolCount,
			workerInputTokens: state.workerInputTokens,
			workerOutputTokens: state.workerOutputTokens,
			workerCacheReadTokens: state.workerCacheReadTokens,
			workerCacheWriteTokens: state.workerCacheWriteTokens,
			workerCostUsd: state.workerCostUsd,
			workerRetryActive: state.workerRetryActive,
			workerRetryCount: state.workerRetryCount,
			workerLastRetryError: state.workerLastRetryError,
			workerExitDiagnostic: state.workerExitDiagnostic || undefined,
			reviewerStatus: state.reviewerStatus || "idle",
			reviewerSessionName: state.reviewerSessionName || "",
			reviewerType: state.reviewerType || "",
			reviewerStep: state.reviewerStep || 0,
			reviewerElapsed: state.reviewerElapsed || 0,
			reviewerContextPct: state.reviewerContextPct || 0,
			reviewerLastTool: state.reviewerLastTool || "",
			reviewerToolCount: state.reviewerToolCount || 0,
			reviewerCostUsd: state.reviewerCostUsd || 0,
			reviewerInputTokens: state.reviewerInputTokens || 0,
			reviewerOutputTokens: state.reviewerOutputTokens || 0,
			reviewerCacheReadTokens: state.reviewerCacheReadTokens || 0,
			reviewerCacheWriteTokens: state.reviewerCacheWriteTokens || 0,
			batchId: process.env.ORCH_BATCH_ID || null,
			timestamp: Date.now(),
		};
		writeFileSync(filePath, JSON.stringify(data) + "\n");
	} catch {
		// Best effort — don't crash the runner
	}
}

/**
 * Write a context % snapshot at worker iteration boundary (TP-094).
 * Best-effort JSONL append to `.pi/context-snapshots/{batchId}/{sessionName}.jsonl`.
 * Non-fatal on any failure — never blocks execution.
 */
function writeContextSnapshot(state: TaskState, contextWindow: number): void {
	const batchId = process.env.ORCH_BATCH_ID || "standalone";
	const sessionName = isOrchestratedMode() ? `${getLanePrefix()}-worker` : "task-worker";
	try {
		const dir = join(getSidecarDir(), "context-snapshots", batchId);
		mkdirSync(dir, { recursive: true });
		const filePath = join(dir, `${sessionName}.jsonl`);
		const snapshot = {
			iteration: state.totalIterations,
			contextPct: state.workerContextPct,
			tokens: state.workerInputTokens + state.workerOutputTokens + state.workerCacheReadTokens + state.workerCacheWriteTokens,
			contextWindow,
			cost: state.workerCostUsd,
			toolCalls: state.workerToolCount,
			exitReason: state.workerExitDiagnostic?.classification || null,
			timestamp: Date.now(),
		};
		appendFileSync(filePath, JSON.stringify(snapshot) + "\n");
	} catch {
		// Best effort — don't crash the runner
	}
}

/**
 * Append a JSON event to the conversation JSONL log file.
 * Used in orchestrated mode to capture the full worker conversation for the web dashboard.
 */
function appendConversationEvent(prefix: string, event: Record<string, unknown>): void {
	const filePath = join(getSidecarDir(), `worker-conversation-${prefix}.jsonl`);
	try {
		appendFileSync(filePath, JSON.stringify(event) + "\n");
	} catch {
		// Best effort
	}
}

/**
 * Clear the conversation log at the start of a new worker iteration.
 */
function clearConversationLog(prefix: string): void {
	const filePath = join(getSidecarDir(), `worker-conversation-${prefix}.jsonl`);
	try {
		writeFileSync(filePath, "");
	} catch {
		// Best effort
	}
}

// ── Agent Loader ─────────────────────────────────────────────────────

/**
 * Parse a markdown agent file into frontmatter key-value pairs and body content.
 * Returns null if the file doesn't exist or has no frontmatter block.
 */
function parseAgentFile(filePath: string): { fm: Record<string, string>; body: string } | null {
	if (!existsSync(filePath)) return null;
	const raw = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
	const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return null;
	const fm: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
	}
	return { fm, body: match[2].trim() };
}

/** Cached package root — resolved once, reused for all agent file lookups. */
let _packageRoot: string | null = null;

/**
 * Find the taskplane package root directory.
 *
 * Strategy: this file lives at <package-root>/extensions/task-runner.ts.
 * When pi loads it via `-e`, it resolves the full path. We can find the
 * package root by searching for package.json with name "taskplane"
 * starting from known candidate locations.
 */
function findPackageRoot(): string {
	if (_packageRoot !== null) return _packageRoot;

	// Strategy 1: Walk up from this file's location via require.resolve or npm paths
	const candidates: string[] = [];

	// The extension is loaded by pi from the installed package location.
	// Check well-known npm global paths.
	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (home) {
		candidates.push(join(home, "AppData", "Roaming", "npm", "node_modules", "taskplane"));
		candidates.push(join(home, ".npm-global", "lib", "node_modules", "taskplane"));
	}
	candidates.push(join("/usr", "local", "lib", "node_modules", "taskplane"));

	// Strategy 2: resolve from pi's node_modules peer
	try {
		const piPath = process.argv[1] || "";
		const piPkgDir = resolve(piPath, "..", "..");
		candidates.push(join(piPkgDir, "..", "taskplane"));
	} catch { /* ignore */ }

	// Strategy 3: Check TASKPLANE_WORKSPACE_ROOT project-local install
	const wsRoot = process.env.TASKPLANE_WORKSPACE_ROOT;
	if (wsRoot) {
		candidates.push(join(wsRoot, ".pi", "npm", "node_modules", "taskplane"));
		candidates.push(join(wsRoot, "node_modules", "taskplane"));
	}

	for (const dir of candidates) {
		try {
			const pkgPath = join(dir, "package.json");
			if (existsSync(pkgPath)) {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
				if (pkg.name === "taskplane") {
					_packageRoot = dir;
					return dir;
				}
			}
		} catch { /* ignore */ }
	}

	_packageRoot = "";
	return "";
}

/**
 * Resolve the package-shipped base agent file path.
 * Base files live in the package's templates/agents/ directory.
 */
function resolveBaseAgentPath(name: string): string {
	const root = findPackageRoot();
	if (!root) return "";
	return join(root, "templates", "agents", `${name}.md`);
}

/**
 * Resolve the path to rpc-wrapper.mjs from the installed taskplane package.
 *
 * Resolution strategy (first match wins):
 *   1. Package root via findPackageRoot() (covers global npm, workspace, pi peer)
 *   2. Project-local node_modules/taskplane (for non-workspace local installs)
 *   3. Global npm paths (explicit fallback for layouts findPackageRoot may miss)
 *   4. Extension-file-relative: derive package root from the `-e` arg that loaded
 *      this extension (handles dev scenarios where cwd differs from checkout)
 *   5. Development fallback: cwd/bin/rpc-wrapper.mjs (running from taskplane repo)
 *
 * @returns Absolute path to rpc-wrapper.mjs
 * @throws Error if rpc-wrapper.mjs cannot be found
 */
function resolveRpcWrapperPath(): string {
	const wrapperRelPath = join("bin", "rpc-wrapper.mjs");
	const searched: string[] = [];

	const tryPath = (dir: string): string | null => {
		const p = join(dir, wrapperRelPath);
		searched.push(p);
		return existsSync(p) ? p : null;
	};

	// 1. Package root (installed npm package — covers global, workspace, peer)
	const root = findPackageRoot();
	if (root) {
		const found = tryPath(root);
		if (found) return found;
	}

	// 2. Project-local node_modules (non-workspace local installs)
	const cwdLocal = join(process.cwd(), "node_modules", "taskplane");
	if (existsSync(cwdLocal)) {
		const found = tryPath(cwdLocal);
		if (found) return found;
	}

	// 3. Global npm paths (explicit check for layouts findPackageRoot may miss)
	const home = process.env.HOME || process.env.USERPROFILE || "";
	const globalCandidates: string[] = [];
	if (process.env.APPDATA) {
		globalCandidates.push(join(process.env.APPDATA, "npm", "node_modules", "taskplane"));
	}
	if (home) {
		globalCandidates.push(join(home, "AppData", "Roaming", "npm", "node_modules", "taskplane"));
		globalCandidates.push(join(home, ".npm-global", "lib", "node_modules", "taskplane"));
	}
	globalCandidates.push(join("/usr", "local", "lib", "node_modules", "taskplane"));
	for (const dir of globalCandidates) {
		const found = tryPath(dir);
		if (found) return found;
	}

	// 4. Extension-file-relative: derive package root from the -e argument
	//    that loaded this file. This covers dev scenarios where the extension
	//    is loaded from a local checkout but cwd is a different directory
	//    (e.g., a worktree or integration test working directory).
	//    This file lives at <package-root>/extensions/task-runner.ts, so walk up two levels.
	try {
		const args = process.argv;
		for (let i = 0; i < args.length - 1; i++) {
			if (args[i] === "-e" && args[i + 1]?.includes("task-runner")) {
				const extPath = resolve(args[i + 1]);
				const derivedRoot = resolve(extPath, "..", "..");
				const found = tryPath(derivedRoot);
				if (found) return found;
			}
		}
	} catch { /* ignore argv parsing errors */ }

	// 5. Development fallback: running from the taskplane repo directly
	const cwdDev = process.cwd();
	const devFound = tryPath(cwdDev);
	if (devFound) return devFound;

	throw new Error(
		"Cannot find rpc-wrapper.mjs. Ensure taskplane is installed correctly. " +
		`Searched: ${searched.join(", ")}`
	);
}

/**
 * Resolve the path to reviewer-extension.ts from the installed taskplane package.
 * Mirrors resolveRpcWrapperPath() resolution strategy.
 *
 * @returns Absolute path to reviewer-extension.ts, or null if not found
 * @since TP-057
 */
function resolveReviewerExtensionPath(): string | null {
	const extRelPath = join("extensions", "reviewer-extension.ts");

	// 1. Package root
	const root = findPackageRoot();
	if (root) {
		const p = join(root, extRelPath);
		if (existsSync(p)) return p;
	}

	// 2. Extension-file-relative (dev scenario: task-runner.ts is sibling)
	try {
		const args = process.argv;
		for (let i = 0; i < args.length - 1; i++) {
			if (args[i] === "-e" && args[i + 1]?.includes("task-runner")) {
				const extPath = resolve(args[i + 1]);
				const derivedRoot = resolve(extPath, "..", "..");
				const p = join(derivedRoot, extRelPath);
				if (existsSync(p)) return p;
			}
		}
	} catch { /* ignore */ }

	// 3. Development fallback: cwd
	const cwdDev = join(process.cwd(), extRelPath);
	if (existsSync(cwdDev)) return cwdDev;

	return null;
}

/**
 * Load an agent definition with prompt inheritance.
 *
 * Inheritance model (default: compose base + local):
 * 1. Load base agent from the shipped package (templates/agents/{name}.md)
 * 2. Load local agent from .pi/agents/{name}.md (if it exists) — or from
 *    the pointer-resolved agent root in workspace mode
 * 3. If local file has `standalone: true` in frontmatter, use it as-is (no base)
 * 4. Otherwise, compose: base prompt + separator + local content
 * 5. Local frontmatter values (tools, model) override base values
 *
 * Local override resolution order:
 *   1. `<cwd>/.pi/agents/{name}.md` — worktree/repo local override (always first)
 *   2. `<cwd>/agents/{name}.md` — worktree/repo local override (legacy location)
 *   3. `<pointerAgentRoot>/{name}.md` — pointer-resolved config repo agents (workspace mode)
 *   First found wins. If none found, base file is used directly.
 *
 * If no base file exists (e.g., custom agent), local file is used as-is.
 */
function loadAgentDef(cwd: string, name: string): { systemPrompt: string; tools: string; model: string } | null {
	const basePath = resolveBaseAgentPath(name);
	const localPaths = [join(cwd, ".pi", "agents", `${name}.md`), join(cwd, "agents", `${name}.md`)];

	// In workspace mode, add pointer-resolved agent root as fallback
	const pointer = resolveTaskRunnerPointer();
	if (pointer?.agentRoot) {
		localPaths.push(join(pointer.agentRoot, `${name}.md`));
	}

	// Load base from package
	const baseDef = parseAgentFile(basePath);

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

// ── PROMPT.md Parser ─────────────────────────────────────────────────

function parsePromptMd(content: string, promptPath: string): ParsedTask {
	const core = coreParsePromptMd(content, promptPath);
	return { ...core };
}

// ── STATUS.md Parser ─────────────────────────────────────────────────

function parseStatusMd(content: string): { steps: StepInfo[]; reviewCounter: number; iteration: number } {
	return coreParseStatusMd(content);
}

// ── STATUS.md Generator ──────────────────────────────────────────────

function generateStatusMd(task: ParsedTask): string {
	return coreGenerateStatusMd(task);
}

// ── STATUS.md Updaters ───────────────────────────────────────────────

function updateStatusField(statusPath: string, field: string, value: string): void {
	coreUpdateStatusField(statusPath, field, value);
}

function updateStepStatus(statusPath: string, stepNum: number, status: "not-started" | "in-progress" | "complete"): void {
	coreUpdateStepStatus(statusPath, stepNum, status);
}

function appendTableRow(statusPath: string, sectionName: string, row: string): void {
	coreAppendTableRow(statusPath, sectionName, row);
}

function logExecution(statusPath: string, action: string, outcome: string): void {
	coreLogExecution(statusPath, action, outcome);
}

/**
 * TP-090: Sanitize steering message content for safe injection into a markdown table row.
 * Collapses newlines to " / ", escapes pipe characters, and truncates to 200 chars.
 */
function sanitizeSteeringContent(content: string): string {
	return coreSanitizeSteeringContent(content);
}

function logReview(statusPath: string, num: string, type: string, stepNum: number, verdict: string, file: string): void {
	coreLogReview(statusPath, num, type, stepNum, verdict, file);
}

// ── Project Context Builder ──────────────────────────────────────────

function buildProjectContext(config: TaskConfig, taskFolder: string): string {
	const resolved = resolveStandards(config, taskFolder);
	const lines: string[] = [`## Project: ${config.project.name}`];
	if (config.project.description) lines.push(config.project.description);
	lines.push("");
	if (resolved.rules.length > 0) {
		lines.push("## Code Standards");
		for (const r of resolved.rules) lines.push(`- ${r}`);
		lines.push("");
	}
	if (resolved.docs.length > 0) {
		lines.push("## Reference Documentation");
		for (const d of resolved.docs) lines.push(`- ${d}`);
		lines.push("");
	}
	if (Object.keys(config.testing.commands).length > 0) {
		lines.push("## Testing Commands");
		for (const [name, cmd] of Object.entries(config.testing.commands)) lines.push(`- **${name}:** \`${cmd}\``);
		lines.push("");
	}
	lines.push(`## Task Folder\n${taskFolder}`);
	return lines.join("\n");
}

// ── Git Helpers ──────────────────────────────────────────────────────

/**
 * Returns the current HEAD commit SHA (short form).
 * Used to capture baseline before a step starts so code reviews
 * can diff against the correct range instead of just uncommitted changes.
 */
function getHeadCommitSha(): string {
	return coreGetHeadCommitSha();
}

/**
 * Find the git commit SHA where a specific step was completed.
 * Workers commit at step boundaries with messages like:
 *   feat(TP-048): complete Step N — description
 * Returns the commit SHA if found, or empty string.
 */
function findStepBoundaryCommit(stepNumber: number, taskId: string, since?: string): string {
	return coreFindStepBoundaryCommit(stepNumber, taskId, since);
}

// ── Standards Resolution ─────────────────────────────────────────────

/**
 * Resolve which standards apply to a task based on its area.
 *
 * Matches the task's folder path against `task_areas` paths to find the
 * area name, then checks `standards_overrides` for area-specific standards.
 * Falls back to global `standards` if no override exists.
 *
 * This allows TypeScript extension tasks (e.g., task-system area) to use
 * different review standards than Go backend service tasks.
 */
function resolveStandards(config: TaskConfig, taskFolder: string): { docs: string[]; rules: string[] } {
	return coreResolveStandards(config.standards, config.standards_overrides, config.task_areas, taskFolder);
}

// ── Review Request Generator ─────────────────────────────────────────

function generateReviewRequest(
	type: "plan" | "code", stepNum: number, stepName: string,
	task: ParsedTask, config: TaskConfig, outputPath: string,
	stepBaselineCommit?: string,
): string {
	const standards = resolveStandards(config, task.taskFolder);
	return coreGenerateReviewRequest(type, stepNum, stepName, task.promptPath, task.taskFolder, config.project.name, standards, outputPath, stepBaselineCommit);
}

function extractVerdict(reviewContent: string): string {
	return coreExtractVerdict(reviewContent);
}

/**
 * Process a review verdict: extract the verdict from review content, log it,
 * update the status file, and build the result text for the worker.
 *
 * Shared by the persistent reviewer path and the fallback fresh-spawn path
 * in the review_step tool handler.
 */
function processReviewVerdict(
	reviewContent: string | null,
	statusPath: string,
	num: string,
	reviewType: string,
	stepNum: number,
	reviewCounter: number,
	suffix?: string,
): { verdict: string; resultText: string } {
	let verdict = "UNKNOWN";
	let reviseDetails = "";
	if (reviewContent) {
		verdict = extractVerdict(reviewContent);
		if (verdict === "REVISE") {
			const summaryMatch = reviewContent.match(/###?\s*Summary[:\s]*([\s\S]*?)(?=###|$)/i);
			reviseDetails = summaryMatch
				? summaryMatch[1].trim().slice(0, 500)
				: "See review file for details.";
		}
	} else {
		verdict = "UNAVAILABLE";
		const label = suffix ? `${suffix} reviewer` : "reviewer";
		logExecution(statusPath, `Reviewer R${num}`,
			`${reviewType} review — ${label} did not produce output`);
	}

	const reviewFile = `.reviews/R${num}-${reviewType}-step${stepNum}.md`;
	logReview(statusPath, `R${num}`, reviewType, stepNum, verdict, reviewFile);
	const logSuffix = suffix ? ` (${suffix})` : "";
	logExecution(statusPath, `Review R${num}`,
		`${reviewType} Step ${stepNum}: ${verdict}${logSuffix}`);
	updateStatusField(statusPath, "Review Counter", `${reviewCounter}`);

	let resultText: string;
	if (verdict === "APPROVE") {
		resultText = "APPROVE";
	} else if (verdict === "REVISE") {
		resultText = `REVISE: ${reviseDetails}\n\nFull review: ${reviewFile}`;
	} else if (verdict === "RETHINK") {
		resultText = `RETHINK — reconsider your approach. See ${reviewFile}`;
	} else {
		resultText = `UNAVAILABLE — reviewer did not produce a usable verdict.`;
	}

	return { verdict, resultText };
}

// ── Subagent Spawner ─────────────────────────────────────────────────

function spawnAgent(opts: {
	model: string; tools: string; thinking: string;
	systemPrompt: string; prompt: string;
	contextWindow?: number; warnPct?: number; killPct?: number;
	wrapUpFile?: string;
	onToolCall?: (toolName: string, args: any) => void;
	onContextPct?: (pct: number) => void;
	onTokenUpdate?: (tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }) => void;
	onJsonEvent?: (event: Record<string, unknown>) => void;
}): { promise: Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>; kill: () => void } {
	let killFn: () => void = () => {};

	const promise = new Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>((resolve) => {
		// Write system prompt and user prompt to temp files to avoid
		// shell escaping issues (backticks, quotes, etc. in markdown)
		const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const sysTmpFile = join(tmpdir(), `pi-task-sys-${id}.txt`);
		const promptTmpFile = join(tmpdir(), `pi-task-prompt-${id}.txt`);
		writeFileSync(sysTmpFile, opts.systemPrompt);
		writeFileSync(promptTmpFile, opts.prompt);

		const args = [
			"-p", "--mode", "json",
			"--no-session", "--no-extensions", "--no-skills",
			"--model", opts.model,
			"--tools", opts.tools,
			"--thinking", opts.thinking,
			"--append-system-prompt", sysTmpFile,
			`@${promptTmpFile}`,
		];

		const proc = spawn("pi", args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
			shell: true,
		});

		// Clean up temp files after process finishes
		const cleanupTmp = () => {
			setTimeout(() => {
				try { unlinkSync(sysTmpFile); } catch {}
				try { unlinkSync(promptTmpFile); } catch {}
			}, 1000);
		};

		let killed = false;
		const startTime = Date.now();
		const textChunks: string[] = [];
		let buffer = "";

		killFn = () => { killed = true; proc.kill("SIGTERM"); };

		proc.stdout!.setEncoding("utf-8");
		proc.stdout!.on("data", (chunk: string) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line);
					// Tee all events to JSONL log if callback provided
					opts.onJsonEvent?.(event);
					if (event.type === "message_update") {
						const delta = event.assistantMessageEvent;
						if (delta?.type === "text_delta" && delta.delta) {
							textChunks.push(delta.delta);
						}
					} else if (event.type === "tool_execution_start") {
						opts.onToolCall?.(event.toolName, event.args);
					} else if (event.type === "message_end") {
						const usage = event.message?.usage;
						if (usage) {
							// Report per-turn token counts to caller (caller accumulates).
							// Anthropic `input` = uncached new tokens only; `cacheRead`
							// holds bulk of input. `cost.total` = exact dollar cost for turn.
							opts.onTokenUpdate?.({
								input: (usage as any).input || 0,
								output: (usage as any).output || 0,
								cacheRead: (usage as any).cacheRead || 0,
								cacheWrite: (usage as any).cacheWrite || 0,
								cost: (usage as any).cost?.total || 0,
							});
							if (opts.contextWindow) {
								// Use totalTokens (cumulative) — works across providers.
								// Anthropic reports small `input` per-turn but growing `totalTokens`.
								// OpenAI reports growing `input` but also growing `totalTokens`.
								// Include cacheRead: pi's totalTokens excludes cache reads,
								// but cached tokens still consume context window capacity.
								const rawTokens = (usage as any).totalTokens || ((usage as any).input + (usage as any).output) || 0;
								const tokens = rawTokens + ((usage as any).cacheRead || 0);
								if (tokens > 0) {
									const pct = (tokens / opts.contextWindow) * 100;
									opts.onContextPct?.(pct);
									if (opts.warnPct && pct >= opts.warnPct && opts.wrapUpFile && !existsSync(opts.wrapUpFile)) {
										writeFileSync(opts.wrapUpFile, `Wrap up at ${new Date().toISOString()}`);
									}
									if (opts.killPct && pct >= opts.killPct && !killed) {
										killed = true;
										proc.kill("SIGTERM");
									}
								}
							}
						}
					}
				} catch {}
			}
		});

		proc.stderr?.setEncoding("utf-8");
		proc.stderr?.on("data", () => {});

		proc.on("close", (code) => {
			cleanupTmp();
			if (buffer.trim()) {
				try {
					const event = JSON.parse(buffer);
					if (event.type === "message_update") {
						const delta = event.assistantMessageEvent;
						if (delta?.type === "text_delta") textChunks.push(delta.delta || "");
					}
				} catch {}
			}
			resolve({ output: textChunks.join(""), exitCode: code ?? 1, elapsed: Date.now() - startTime, killed });
		});

		proc.on("error", (err) => {
			cleanupTmp();
			resolve({ output: `Error: ${err.message}`, exitCode: 1, elapsed: Date.now() - startTime, killed: false });
		});
	});

	return { promise, kill: () => killFn() };
}

// ── Sidecar JSONL Tailing ────────────────────────────────────────────

/**
 * Mutable state for incremental byte-offset sidecar JSONL reading.
 * One instance per sidecar file, persists across poll ticks within a session.
 */
interface SidecarTailState {
	/** Byte offset of the next unread position in the sidecar file */
	offset: number;
	/** Partial trailing line from the last read (incomplete JSONL line) */
	partial: string;
	/** Whether a retry is currently active (persisted across ticks) */
	retryActive: boolean;
}

function createSidecarTailState(): SidecarTailState {
	return { offset: 0, partial: "", retryActive: false };
}

/**
 * Parsed telemetry accumulated from sidecar JSONL events.
 * Returned by tailSidecarJsonl() on each tick.
 */
interface SidecarTelemetryDelta {
	/** Per-turn input tokens (sum of new message_end events in this tick) */
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** Incremental cost from new message_end events */
	cost: number;
	/** Most recent totalTokens from message_end usage (cumulative, for context %) */
	latestTotalTokens: number;
	/** Tool calls observed in this tick */
	toolCalls: number;
	/** Last tool description from tool_execution_start */
	lastTool: string;
	/** Whether a retry is currently active (persisted across ticks via SidecarTailState) */
	retryActive: boolean;
	/** Total retries started in this tick */
	retriesStarted: number;
	/** Error message from the most recent auto_retry_start */
	lastRetryError: string;
	/** Whether any sidecar events were parsed in this tick (used for callback gating) */
	hadEvents: boolean;
	/** Authoritative context usage from pi get_session_stats (pi ≥ 0.63.0, null if unavailable) */
	contextUsage: { percent: number; totalTokens: number; maxTokens: number } | null;
	/** True when a get_session_stats response was seen but lacked contextUsage (older pi) */
	sawStatsResponseWithoutContextUsage: boolean;
}

/**
 * Incrementally read new lines from a sidecar JSONL file and parse telemetry events.
 *
 * O(new) per call — only reads bytes after the previous offset. Handles:
 * - File not yet created (returns zero delta)
 * - Empty reads (no new data since last tick)
 * - Partial trailing lines (buffered for next call)
 * - Malformed JSON lines (skipped with stderr warning, does not break iteration)
 *
 * The caller (poll loop) accumulates the returned deltas into TaskState.
 */
function tailSidecarJsonl(filePath: string, tailState: SidecarTailState): SidecarTelemetryDelta {
	const delta: SidecarTelemetryDelta = {
		inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
		cost: 0, latestTotalTokens: 0, toolCalls: 0, lastTool: "",
		retryActive: tailState.retryActive, retriesStarted: 0, lastRetryError: "",
		hadEvents: false, contextUsage: null, sawStatsResponseWithoutContextUsage: false,
	};

	// Gracefully handle missing file (wrapper hasn't written yet)
	let fileSize: number;
	try {
		fileSize = statSync(filePath).size;
	} catch {
		return delta; // File doesn't exist yet — no-op
	}

	if (fileSize <= tailState.offset) {
		return delta; // No new data
	}

	// Read new bytes from offset to end of file
	const bytesToRead = fileSize - tailState.offset;
	const buf = Buffer.alloc(bytesToRead);
	let fd: number;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return delta; // File became inaccessible between stat and open
	}
	try {
		readSync(fd, buf, 0, bytesToRead, tailState.offset);
	} catch {
		closeSync(fd);
		return delta; // Read error — try again next tick
	}
	closeSync(fd);
	tailState.offset = fileSize;

	// Split into lines, preserving any partial trailing line
	const chunk = tailState.partial + buf.toString("utf-8");
	const lines = chunk.split("\n");
	// Last element is either "" (if chunk ended with \n) or a partial line
	tailState.partial = lines.pop() || "";

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let event: any;
		try {
			event = JSON.parse(trimmed);
		} catch {
			// Malformed JSON — skip silently (concurrent write race, truncated line)
			continue;
		}

		if (!event || !event.type) continue;

		delta.hadEvents = true;

		switch (event.type) {
			case "message_end": {
				const usage = event.message?.usage;
				if (usage) {
					delta.inputTokens += usage.input || 0;
					delta.outputTokens += usage.output || 0;
					delta.cacheReadTokens += usage.cacheRead || 0;
					delta.cacheWriteTokens += usage.cacheWrite || 0;
					if (usage.cost) {
						delta.cost += typeof usage.cost === "object"
							? (usage.cost.total || 0)
							: (typeof usage.cost === "number" ? usage.cost : 0);
					}
					// totalTokens is cumulative (grows each turn) — use latest value.
					// Include cacheRead tokens: pi's totalTokens and the
					// input+output fallback both exclude cache reads, but cached
					// tokens still consume context window capacity.
					const rawTotal = usage.totalTokens
						|| ((usage.input || 0) + (usage.output || 0));
					const totalTokens = rawTotal + (usage.cacheRead || 0);
					if (totalTokens > delta.latestTotalTokens) {
						delta.latestTotalTokens = totalTokens;
					}
				}
				break;
			}

			case "tool_execution_start": {
				delta.toolCalls++;
				const toolDesc = event.toolName || "unknown";
				let argPreview = "";
				if (event.args) {
					if (typeof event.args === "string") {
						argPreview = event.args.slice(0, 80);
					} else if (typeof event.args === "object") {
						const firstVal = Object.values(event.args)[0];
						if (typeof firstVal === "string") {
							argPreview = (firstVal as string).slice(0, 80);
						}
					}
				}
				delta.lastTool = argPreview ? `${toolDesc} ${argPreview}` : toolDesc;
				break;
			}

			case "auto_retry_start": {
				delta.retriesStarted++;
				delta.lastRetryError = event.errorMessage || event.error || "unknown";
				tailState.retryActive = true;
				break;
			}

			case "auto_retry_end": {
				tailState.retryActive = false;
				break;
			}

			case "response": {
				// get_session_stats response from pi ≥ 0.63.0 — authoritative context usage
				if (event.success === true && event.data?.contextUsage) {
					const cu = event.data.contextUsage;
					// pi sends `percent` (pi ≥ 0.63.0); accept `percentUsed` as legacy fallback
					const pctValue = cu.percent ?? cu.percentUsed;
					if (typeof pctValue === "number") {
						delta.contextUsage = {
							percent: pctValue,
							totalTokens: cu.totalTokens || 0,
							maxTokens: cu.maxTokens || 0,
						};
					}
				} else if (event.success === true && event.data && !event.data.contextUsage) {
					// Successful get_session_stats response but no contextUsage — older pi
					delta.sawStatsResponseWithoutContextUsage = true;
				}
				break;
			}
		}
	}

	// Reflect persisted retry state into the delta for the caller
	delta.retryActive = tailState.retryActive;
	return delta;
}

/** Expose sidecar tailing internals for testing (not part of public API). */
export const _tailSidecarJsonl = tailSidecarJsonl;
export const _createSidecarTailState = createSidecarTailState;
export const _getSidecarDir = getSidecarDir;
export const _resolveContextWindow = resolveContextWindow;
export const _FALLBACK_CONTEXT_WINDOW = FALLBACK_CONTEXT_WINDOW;
export type { SidecarTailState, SidecarTelemetryDelta };

/**
 * Determine whether a step is "low-risk" and should skip reviews.
 * Low-risk steps: Step 0 (Preflight) and the final step (Delivery/Docs).
 */
export function isLowRiskStep(stepNumber: number, totalSteps: number): boolean {
	return coreIsLowRiskStep(stepNumber, totalSteps);
}

// ── Display Helpers ──────────────────────────────────────────────────

function displayName(name: string): string {
	return coreDisplayName(name);
}

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let state = freshState();
	let widgetCtx: ExtensionContext | undefined;

	// ── Widget Rendering ─────────────────────────────────────────────

	function renderStepCard(step: StepInfo, colWidth: number, theme: any): string[] {
		const w = colWidth - 2;
		const trunc = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + "..." : s;

		const isRunning = state.currentStep === step.number && state.phase === "running";
		const statusColor = step.status === "complete" ? "success"
			: step.status === "in-progress" ? "accent" : "dim";
		const statusIcon = step.status === "complete" ? "✓"
			: step.status === "in-progress" ? "●" : "○";

		const nameStr = theme.fg("accent", theme.bold(trunc(`Step ${step.number}`, w)));
		const nameVis = Math.min(`Step ${step.number}`.length, w);

		const statusStr = `${statusIcon} ${trunc(step.name, w - 4)}`;
		const statusLine = theme.fg(statusColor, statusStr);
		const statusVis = Math.min(statusStr.length, w);

		const progress = `${step.totalChecked}/${step.totalItems} ✓`;
		const progressLine = theme.fg(step.totalChecked === step.totalItems && step.totalItems > 0 ? "success" : "muted", progress);
		const progressVis = progress.length;

		let extraStr = "";
		let extraVis = 0;
		if (isRunning && state.workerStatus === "running") {
			extraStr = theme.fg("accent", `iter ${state.workerIteration}`) + theme.fg("dim", ` ctx:${Math.round(state.workerContextPct)}%`);
			extraVis = `iter ${state.workerIteration} ctx:${Math.round(state.workerContextPct)}%`.length;
		} else if (isRunning && state.reviewerStatus === "running") {
			extraStr = theme.fg("warning", `reviewing...`);
			extraVis = "reviewing...".length;
		}

		const top = "┌" + "─".repeat(w) + "┐";
		const bot = "└" + "─".repeat(w) + "┘";
		const border = (content: string, vis: number) =>
			theme.fg("dim", "│") + content + " ".repeat(Math.max(0, w - vis)) + theme.fg("dim", "│");

		return [
			theme.fg("dim", top),
			border(" " + nameStr, 1 + nameVis),
			border(" " + statusLine, 1 + statusVis),
			border(" " + progressLine, 1 + progressVis),
			border(extraStr ? " " + extraStr : "", extraVis ? 1 + extraVis : 0),
			theme.fg("dim", bot),
		];
	}

	function updateWidgets() {
		// Write sidecar state for web dashboard (orchestrated mode)
		writeLaneState(state);

		if (!widgetCtx) return;
		const ctx = widgetCtx;

		// Refresh step statuses from STATUS.md if task is active
		if (state.task) {
			const statusPath = join(state.task.taskFolder, "STATUS.md");
			if (existsSync(statusPath)) {
				try {
					const parsed = parseStatusMd(readFileSync(statusPath, "utf-8"));
					for (const s of parsed.steps) state.stepStatuses.set(s.number, s);
				} catch {}
			}
		}

		ctx.ui.setWidget("task-runner", (_tui: any, theme: any) => {
			return {
				render(width: number): string[] {
					if (!state.task) {
						return [];
					}

					const task = state.task;
					const lines: string[] = [""];

					// Header
					const phaseIcon = state.phase === "running" ? "●"
						: state.phase === "paused" ? "⏸"
						: state.phase === "complete" ? "✓"
						: state.phase === "error" ? "✗" : "○";
					const phaseColor = state.phase === "running" ? "accent"
						: state.phase === "complete" ? "success"
						: state.phase === "error" ? "error" : "dim";

					const header =
						theme.fg(phaseColor, ` ${phaseIcon} `) +
						theme.fg("accent", theme.bold(task.taskId)) +
						theme.fg("dim", ": ") +
						theme.fg("muted", task.taskName) +
						theme.fg("dim", "  ") +
						theme.fg("warning", `L${task.reviewLevel}`) +
						theme.fg("dim", " · ") +
						theme.fg("muted", task.size) +
						theme.fg("dim", " · ") +
						theme.fg("success", `iter ${state.totalIterations}`);
					lines.push(truncateToWidth(header, width));

					// Progress bar
					const allSteps = task.steps.map(s => state.stepStatuses.get(s.number) || s);
					const totalCb = allSteps.reduce((a, s) => a + s.totalItems, 0);
					const doneCb = allSteps.reduce((a, s) => a + s.totalChecked, 0);
					const pct = totalCb > 0 ? Math.round((doneCb / totalCb) * 100) : 0;
					const barWidth = Math.min(30, width - 20);
					const filled = Math.round((pct / 100) * barWidth);
					const progressBar =
						theme.fg("dim", "  ") +
						theme.fg("warning", "[") +
						theme.fg("success", "█".repeat(filled)) +
						theme.fg("dim", "░".repeat(barWidth - filled)) +
						theme.fg("warning", "]") +
						theme.fg("dim", " ") +
						theme.fg("accent", `${doneCb}/${totalCb}`) +
						theme.fg("dim", ` (${pct}%)`);
					lines.push(truncateToWidth(progressBar, width));
					lines.push("");

					// Step cards — fit as many as the terminal allows, wrap to rows
					const steps = allSteps;
					const arrowWidth = 3;
					// Calculate how many cards fit in one row
					const minCardWidth = 16;
					const maxCols = Math.max(1, Math.floor((width + arrowWidth) / (minCardWidth + arrowWidth)));
					const cols = Math.min(steps.length, maxCols);
					const colWidth = Math.max(minCardWidth, Math.floor((width - arrowWidth * (cols - 1)) / cols));

					// Render in rows of `cols` cards
					for (let rowStart = 0; rowStart < steps.length; rowStart += cols) {
						const rowSteps = steps.slice(rowStart, rowStart + cols);
						const cards = rowSteps.map(s => renderStepCard(s, colWidth, theme));

						if (cards.length > 0) {
							const cardHeight = cards[0].length;
							const arrowRow = 2;
							for (let line = 0; line < cardHeight; line++) {
								let row = cards[0][line];
								for (let c = 1; c < cards.length; c++) {
									row += line === arrowRow ? theme.fg("dim", " → ") : "   ";
									row += cards[c][line];
								}
								lines.push(truncateToWidth(row, width));
							}
						}
					}

					// Worker status line
					if (state.workerStatus === "running") {
						lines.push("");
						lines.push(truncateToWidth(
							theme.fg("accent", "  ● Worker: ") +
							theme.fg("dim", `${Math.round(state.workerElapsed / 1000)}s · `) +
							theme.fg("dim", `🔧${state.workerToolCount}`) +
							(state.workerLastTool
								? theme.fg("dim", " · ") + theme.fg("muted", state.workerLastTool)
								: ""),
							width,
						));
					} else if (state.reviewerStatus === "running") {
						lines.push("");
						lines.push(truncateToWidth(
							theme.fg("warning", "  ◉ Reviewer: ") +
							theme.fg("dim", `${state.reviewerType} · ${Math.round(state.reviewerElapsed / 1000)}s`) +
							(state.reviewerLastTool
								? theme.fg("dim", " · ") + theme.fg("muted", state.reviewerLastTool)
								: ""),
							width,
						));
					}

					return lines;
				},
				invalidate() {},
			};
		});
	}

	// ── review_step Tool (orchestrated mode only) ───────────────────

	/** Per-step code review cycle counter. Reset after code review completion. */
	const stepCodeReviewCounts = new Map<number, number>();

	function clearReviewerState(): void {
		state.reviewerStatus = "idle";
		state.reviewerType = "";
		state.reviewerStep = 0;
		state.reviewerSessionName = "";
		state.reviewerElapsed = 0;
		state.reviewerLastTool = "";
		state.reviewerToolCount = 0;
		state.reviewerInputTokens = 0;
		state.reviewerOutputTokens = 0;
		state.reviewerCacheReadTokens = 0;
		state.reviewerCacheWriteTokens = 0;
		state.reviewerCostUsd = 0;
		state.reviewerContextPct = 0;
		state.reviewerProc = null;
		if (state.reviewerTimer) clearInterval(state.reviewerTimer);
		state.reviewerTimer = null;
	}

	async function shutdownPersistentReviewer(reason: string): Promise<void> {
		state.persistentReviewerSession = null;
		state.persistentReviewerKill = null;
		state.persistentReviewerSignalNum = 0;
		state.reviewerRespawnCount = 0;
		clearReviewerState();
		writeLaneState(state);
		if (state.task) {
			const statusPath = join(state.task.taskFolder, "STATUS.md");
			logExecution(statusPath, "Reviewer cleanup", `No persistent reviewer active (${reason})`);
		}
	}

	if (isOrchestratedMode()) {
		pi.registerTool({
			name: "review_step",
			label: "Review Step",
			description:
				"Spawn a reviewer agent to evaluate your work on a step. " +
				"Returns APPROVE, REVISE, RETHINK, or UNAVAILABLE. " +
				"Use at step boundaries based on the task's review level.",
			promptSnippet: "review_step(step, type) — spawn reviewer for a step (plan/code review)",
			promptGuidelines: [
				"Call review_step at step boundaries based on the task's Review Level (from STATUS.md header).",
				"Review Level 0: skip all reviews. Level 1: plan review before implementing. Level 2: plan + code review. Level 3: plan + code + test review.",
				"Skip reviews for Step 0 (Preflight) and the final documentation/delivery step.",
				"For code reviews: before starting a step, capture the current HEAD commit with `git rev-parse HEAD` and pass it as the `baseline` parameter.",
				"On REVISE: read the review file in .reviews/ for detailed feedback, address the issues, commit fixes, then proceed.",
				"On RETHINK: reconsider your plan approach, adjust, then implement.",
				"On UNAVAILABLE: reviewer failed — proceed with caution.",
			],
			parameters: Type.Object({
				step: Type.Number({ description: "Step number to review" }),
				type: Type.Union(
					[Type.Literal("plan"), Type.Literal("code")],
					{ description: 'Review type: "plan" or "code"' },
				),
				baseline: Type.Optional(Type.String({
					description: "Git commit SHA to use as the diff baseline for code reviews.",
				})),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const { step: stepNum, type: reviewType, baseline } = params;
				if (!state.task || !state.config) {
					return { content: [{ type: "text" as const, text: "UNAVAILABLE — no task loaded" }], details: undefined };
				}

				const task = state.task;
				const config = state.config;
				const statusPath = join(task.taskFolder, "STATUS.md");
				const reviewsDir = join(task.taskFolder, ".reviews");
				if (!existsSync(reviewsDir)) mkdirSync(reviewsDir, { recursive: true });

				if (reviewType === "code") {
					const codeCount = (stepCodeReviewCounts.get(stepNum) || 0) + 1;
					stepCodeReviewCounts.set(stepNum, codeCount);
					const maxCycles = config.context.max_review_cycles || 2;
					if (codeCount > maxCycles) {
						logExecution(statusPath, "Skip code review", `Step ${stepNum} code review cycle limit reached (${codeCount}/${maxCycles}) — auto-approving`);
						stepCodeReviewCounts.delete(stepNum);
						return {
							content: [{ type: "text" as const, text: `APPROVE — Code review cycle limit reached (${maxCycles}). Auto-approved to prevent context exhaustion.` }],
							details: undefined,
						};
					}
				}

				if (isLowRiskStep(stepNum, task.steps.length)) {
					const label = stepNum === 0 ? "Preflight" : "final step";
					logExecution(statusPath, `Skip ${reviewType} review`, `Step ${stepNum} (${label}) — low-risk`);
					return {
						content: [{ type: "text" as const, text: `APPROVE — Step ${stepNum} is low-risk (${label}), review skipped` }],
						details: undefined,
					};
				}

				state.reviewCounter++;
				const num = String(state.reviewCounter).padStart(3, "0");
				const requestPath = join(reviewsDir, `request-R${num}.md`);
				const outputPath = join(reviewsDir, `R${num}-${reviewType}-step${stepNum}.md`);
				const stepBaselineCommit: string | undefined = reviewType === "code" ? (baseline || undefined) : undefined;
				const stepInfo = task.steps.find(s => s.number === stepNum);
				const stepName = stepInfo?.name || `Step ${stepNum}`;
				const request = generateReviewRequest(reviewType, stepNum, stepName, task, config, outputPath, stepBaselineCommit);
				writeFileSync(requestPath, request);

				const reviewerDef = loadAgentDef(ctx.cwd, "task-reviewer");
				const reviewerModelFallback = process.env.TASKPLANE_MODEL_FALLBACK === "1";
				const reviewerModel = reviewerModelFallback
					? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514")
					: (config.reviewer.model || reviewerDef?.model || (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514"));
				const reviewerPrompt = reviewerDef?.systemPrompt || "You are a code reviewer. Read the request and write your review to the specified output file.";
				const systemPrompt = reviewerPrompt + "\n\n" + buildProjectContext(config, task.taskFolder);
				const promptContent = readFileSync(requestPath, "utf-8");

				state.reviewerStatus = "running";
				state.reviewerType = `${reviewType} review`;
				state.reviewerStep = stepNum;
				state.reviewerSessionName = "reviewer-subprocess";
				state.reviewerElapsed = 0;
				state.reviewerLastTool = "";
				state.reviewerToolCount = 0;
				updateWidgets();

				const startTime = Date.now();
				state.reviewerTimer = setInterval(() => {
					state.reviewerElapsed = Date.now() - startTime;
					updateWidgets();
				}, 1000);

				const spawned = spawnAgent({
					model: reviewerModel,
					tools: config.reviewer.tools || reviewerDef?.tools || "read,write,bash,grep,find,ls",
					thinking: config.reviewer.thinking || "on",
					systemPrompt,
					prompt: promptContent,
					onToolCall: (toolName, args) => {
						state.reviewerToolCount++;
						const path = args?.path || args?.command || "";
						const shortPath = typeof path === "string" && path.length > 60 ? "..." + path.slice(-57) : path;
						state.reviewerLastTool = `${toolName} ${shortPath}`.trim();
						updateWidgets();
					},
					onTokenUpdate: (tokens) => {
						state.reviewerInputTokens += tokens.input;
						state.reviewerOutputTokens += tokens.output;
						state.reviewerCacheReadTokens += tokens.cacheRead;
						state.reviewerCacheWriteTokens += tokens.cacheWrite;
						state.reviewerCostUsd += tokens.cost;
						updateWidgets();
					},
					onContextPct: (pct) => {
						state.reviewerContextPct = pct;
						updateWidgets();
					},
				});
				state.reviewerProc = { kill: spawned.kill };

				try {
					await spawned.promise;
					const reviewContent = existsSync(outputPath) ? readFileSync(outputPath, "utf-8") : null;
					const { resultText, verdict } = processReviewVerdict(
						reviewContent, statusPath, num, reviewType, stepNum, state.reviewCounter,
					);
					if (reviewType === "code" && (verdict === "APPROVE" || verdict === "UNAVAILABLE")) {
						stepCodeReviewCounts.delete(stepNum);
					}
					clearReviewerState();
					writeLaneState(state);
					updateWidgets();
					return { content: [{ type: "text" as const, text: resultText }], details: undefined };
				} catch (err: any) {
					clearReviewerState();
					state.reviewerStatus = "error";
					writeLaneState(state);
					updateWidgets();
					const msg = `UNAVAILABLE — reviewer failed: ${err?.message || err}`;
					logExecution(statusPath, `Reviewer R${num}`, msg);
					return { content: [{ type: "text" as const, text: msg }], details: undefined };
				}
			},
		});
	}

	// ── Execution Engine ─────────────────────────────────────────────

	async function executeTask(ctx: ExtensionContext): Promise<void> {
		if (!state.task || !state.config) return;

		const task = state.task;
		const config = state.config;
		const statusPath = join(task.taskFolder, "STATUS.md");

		updateStatusField(statusPath, "Status", "🟡 In Progress");
		updateStatusField(statusPath, "Last Updated", new Date().toISOString().slice(0, 10));

		// TP-098: Distinguish first start from restart/resume to prevent
		// duplicate "Task started" entries in the execution log (#348).
		if (state.totalIterations === 0) {
			logExecution(statusPath, "Task started", "Extension-driven execution");
		} else {
			logExecution(statusPath, "Task resumed", `Resuming from iteration ${state.totalIterations}`);
		}

		// ── Per-task worker loop ─────────────────────────────────────
		// Spawn one worker per iteration; each worker handles ALL remaining
		// steps.  The worker drives reviews inline via the review_step tool
		// (in orchestrated mode) — no deferred reviews after worker exit.
		// If context limit is hit mid-task, the next iteration picks up from
		// the first incomplete step via STATUS.md — same recovery mechanism.

		// Mark only the first incomplete step as in-progress
		{
			const currentStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
			let foundFirstIncomplete = false;
			for (const step of task.steps) {
				const ss = currentStatus.steps.find(s => s.number === step.number);
				if (ss?.status === "complete") continue;

					if (!foundFirstIncomplete) {
					// Mark the first incomplete step as in-progress
					// TP-098: Only log "Step N started" if the step was not already
					// in-progress, preventing duplicate entries on restart (#348).
					if (ss?.status !== "in-progress") {
						updateStepStatus(statusPath, step.number, "in-progress");
						logExecution(statusPath, `Step ${step.number} started`, step.name);
					}
					foundFirstIncomplete = true;
				} else {
					// Ensure future steps show as not-started, not in-progress
					if (ss?.status === "in-progress") {
						updateStepStatus(statusPath, step.number, "not-started");
					}
				}
			}
		}

		// Helper: determine if a parsed step is complete.
		function isStepComplete(ss: StepInfo | undefined): boolean {
			if (!ss) return false;
			if (ss.status === "complete") return true;
			// Fallback: infer from checkboxes (covers "in-progress" and "not-started")
			return ss.totalChecked === ss.totalItems && ss.totalItems > 0;
		}


		let noProgressCount = 0;
		for (let iter = 0; iter < config.context.max_worker_iterations; iter++) {
			if (state.phase === "paused") {
				logExecution(statusPath, "Paused", `User paused at iteration ${state.totalIterations}`);
				ctx.ui.notify(`Task paused at iteration ${state.totalIterations}`, "info");
				await shutdownPersistentReviewer("task paused");
				return;
			}

			// Determine remaining (incomplete) steps
			const currentStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
			const remainingSteps: StepInfo[] = [];
			for (const step of task.steps) {
				const ss = currentStatus.steps.find(s => s.number === step.number);
				if (!isStepComplete(ss)) remainingSteps.push(step);
			}

			if (remainingSteps.length === 0) break; // All steps done

			state.currentStep = remainingSteps[0].number;
			updateStatusField(statusPath, "Current Step", `Step ${remainingSteps[0].number}: ${remainingSteps[0].name}`);
			state.workerIteration = iter + 1;
			state.totalIterations++;
			updateStatusField(statusPath, "Iteration", `${state.totalIterations}`);
			updateWidgets();

			// Count total checked checkboxes across all steps BEFORE worker runs
			const prevTotalChecked = currentStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);

			// Track which steps are complete before the worker runs
			const completedBefore = new Set<number>();
			for (const ss of currentStatus.steps) {
				if (isStepComplete(ss)) completedBefore.add(ss.number);
			}

			// ── TP-095: Reset stale lane-state fields before new worker spawn (#333) ──
			// When a worker crashes and restarts, the lane-state JSON retains stale
			// values (workerStatus: "done", phase: "error", workerExitDiagnostic from
			// the crash). Reset STATUS fields BEFORE the new worker spawns so the
			// dashboard immediately reflects the new running state.
			// IMPORTANT: Do NOT reset telemetry counters (tokens, cost) here — they
			// accumulate across worker iterations via += in onTelemetry (#334).
			if (state.totalIterations > 1) {
				state.phase = "running";
				state.workerStatus = "idle"; // Will be set to "running" by runWorker()
				state.workerExitDiagnostic = null;
				state.workerElapsed = 0;
				state.workerContextPct = 0;
				state.workerLastTool = "";
				state.workerRetryActive = false;
				state.workerRetryCount = 0;
				state.workerLastRetryError = "";
				// Note: workerToolCount, workerInputTokens, workerOutputTokens,
				// workerCacheReadTokens, workerCacheWriteTokens, workerCostUsd
				// are intentionally NOT reset — they persist across iterations.
				writeLaneState(state);
			}

			await runWorker(remainingSteps, ctx);

			// Write context % snapshot at iteration boundary (TP-094)
			const { contextWindow: snapshotContextWindow } = resolveContextWindow(config, ctx);
			writeContextSnapshot(state, snapshotContextWindow);

			// ── TP-090: Annotate STATUS.md with delivered steering messages ──
			// Check for .steering-pending JSONL flag written by rpc-wrapper.
			// Must happen BEFORE the error-return so messages are not dropped.
			const steeringFlagPath = join(task.taskFolder, ".steering-pending");
			try {
				if (existsSync(steeringFlagPath)) {
					const raw = readFileSync(steeringFlagPath, "utf-8");
					const lines = raw.split("\n").filter(l => l.trim());
					for (const line of lines) {
						try {
							const entry = JSON.parse(line) as { ts: number; content: string; id: string };
							const sanitized = sanitizeSteeringContent(entry.content);
							// Use the delivered message timestamp, not current time
							const ts = new Date(entry.ts).toISOString().slice(0, 16).replace("T", " ");
							appendTableRow(statusPath, "Execution Log", `| ${ts} | \u26a0\ufe0f Steering | ${sanitized} |`);
							console.error(`[task-runner] steering message annotated: ${entry.id}`);
						} catch {
							// Skip malformed JSONL lines
						}
					}
					unlinkSync(steeringFlagPath);
				}
			} catch (err: any) {
				// Non-fatal: steering annotation is supplementary
				console.error(`[task-runner] steering-pending annotation error: ${err?.message || err}`);
			}

			if (state.phase === "error") {
				await shutdownPersistentReviewer("worker error");
				return;
			}

			// ── Post-worker: determine which steps were newly completed ──
			const afterStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
			const afterTotalChecked = afterStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);

			// Progress tracking: compare total checked across ALL steps
			const progressDelta = afterTotalChecked - prevTotalChecked;
			if (progressDelta <= 0) {
				noProgressCount++;
				// TP-098: Use state.totalIterations (global) instead of iter+1
				// (loop-local) to avoid label collision across restarts (#348).
				logExecution(statusPath, "No progress", `Iteration ${state.totalIterations}: 0 new checkboxes (${noProgressCount}/${config.context.no_progress_limit} stall limit)`);
				ctx.ui.notify(`⚠️ No progress in iteration ${state.totalIterations} (${noProgressCount}/${config.context.no_progress_limit})`, "warning");
				if (noProgressCount >= config.context.no_progress_limit) {
					logExecution(statusPath, "Task blocked", `No progress after ${noProgressCount} iterations`);
					ctx.ui.notify(`⚠️ Task blocked — no progress after ${noProgressCount} iterations`, "error");
					state.phase = "error";
					await shutdownPersistentReviewer("task stalled");
					return;
				}
			} else {
				noProgressCount = 0;
			}

			// Find newly completed steps.
			const newlyCompleted: StepInfo[] = [];
			for (const step of task.steps) {
				if (completedBefore.has(step.number)) continue;
				const ss = afterStatus.steps.find(s => s.number === step.number);
				if (isStepComplete(ss)) {
					updateStepStatus(statusPath, step.number, "complete");
					logExecution(statusPath, `Step ${step.number} complete`, step.name);
					newlyCompleted.push(step);
				}
			}

			// ── Step transition: kill persistent reviewer for fresh context ──
			// When a step completes, the reviewer's context from that step is stale.
			// Kill it so the next step gets a clean reviewer session.
			if (newlyCompleted.length > 0 && state.persistentReviewerSession) {
				console.error(`[task-runner] step(s) completed — killing reviewer for fresh context`);
				logExecution(statusPath, "Reviewer cleanup",
					`killing persistent reviewer on step transition (${newlyCompleted.map(s => `Step ${s.number}`).join(", ")} completed)`);
				if (state.persistentReviewerKill) {
					try { state.persistentReviewerKill(); } catch {}
				}
				state.persistentReviewerSession = null;
				state.persistentReviewerKill = null;
				state.persistentReviewerSignalNum = 0;
				state.reviewerRespawnCount = 0;
				// Reset per-step code review counters for completed steps
				for (const step of newlyCompleted) {
					stepCodeReviewCounts.delete(step.number);
				}
			}

			// Log iteration summary with progress delta and completed steps
			const completedNames = newlyCompleted.map(s => `Step ${s.number}`).join(", ");
			if (newlyCompleted.length > 0) {
				// TP-098: Use state.totalIterations (global) instead of iter+1
				// (loop-local) to avoid label collision across restarts (#348).
				logExecution(statusPath, `Iteration ${state.totalIterations} summary`, `+${progressDelta} checkboxes, completed: ${completedNames}`);
				ctx.ui.notify(`Iteration ${state.totalIterations}: completed ${completedNames} (+${progressDelta} checkboxes)`, "info");
			} else if (progressDelta > 0) {
				logExecution(statusPath, `Iteration ${state.totalIterations} summary`, `+${progressDelta} checkboxes, no steps fully completed`);
				ctx.ui.notify(`Iteration ${state.totalIterations}: +${progressDelta} checkboxes (no steps fully completed)`, "info");
			}

			// Reviews are now driven inline by the worker via the review_step
			// tool (orchestrated mode). No deferred review logic here.

			// Update local cache
			const refreshed = parseStatusMd(readFileSync(statusPath, "utf-8"));
			for (const s of refreshed.steps) state.stepStatuses.set(s.number, s);
			updateWidgets();

			// Check if all steps are now complete
			const allComplete = task.steps.every(step => {
				const ss = refreshed.steps.find(s => s.number === step.number);
				return isStepComplete(ss);
			});
			if (allComplete) break;
		}

		// ── Post-loop safety check: ensure all steps are actually complete ──
		// If the iteration cap was hit without completing all steps, fail explicitly
		// rather than falling through to quality gate / .DONE creation.
		if (state.phase === "running") {
			const finalStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
			const allStepsComplete = task.steps.every(step => {
				const ss = finalStatus.steps.find(s => s.number === step.number);
				return isStepComplete(ss);
			});
			if (!allStepsComplete) {
				const incomplete = task.steps
					.filter(step => {
						const ss = finalStatus.steps.find(s => s.number === step.number);
						return !isStepComplete(ss);
					})
					.map(s => `Step ${s.number}`)
					.join(", ");
				logExecution(statusPath, "Task incomplete", `Max iterations (${config.context.max_worker_iterations}) reached with incomplete steps: ${incomplete}`);
				ctx.ui.notify(`⚠️ Task incomplete — max iterations reached. Incomplete: ${incomplete}`, "error");
				state.phase = "error";
				await shutdownPersistentReviewer("max iterations reached");
				return;
			}
		}

		// ── TP-057: Shutdown persistent reviewer ────────────────────────
		await shutdownPersistentReviewer("task complete");

		// All steps done — run quality gate if enabled, then create .DONE
		if (config.quality_gate.enabled) {
			// ── Quality Gate Enabled ─────────────────────────────────
			// Run structured review cycles with remediation. .DONE only
			// created after PASS verdict — never delete/recreate.
			const maxReviewCycles = config.quality_gate.max_review_cycles;
			const maxFixCycles = config.quality_gate.max_fix_cycles;
			let reviewCycle = 0;
			let fixCyclesUsed = 0;
			let gatePassed = false;
			let lastVerdict: ReviewVerdict | null = null;

			const gateContext: QualityGateContext = {
				taskFolder: task.taskFolder,
				promptPath: task.promptPath,
				taskId: task.taskId,
				projectName: config.project.name,
				passThreshold: config.quality_gate.pass_threshold,
			};

			logExecution(statusPath, "Quality gate", `Enabled (threshold: ${config.quality_gate.pass_threshold}, max reviews: ${maxReviewCycles}, max fixes: ${maxFixCycles})`);

			while (reviewCycle < maxReviewCycles) {
				reviewCycle++;
				const result = await doQualityGateReview(ctx, reviewCycle);
				lastVerdict = result.verdict;

				if (result.passed) {
					gatePassed = true;
					break;
				}

				// NEEDS_FIXES — check if we can still do a fix cycle
				if (reviewCycle >= maxReviewCycles) {
					// No more review cycles left — terminal failure
					logExecution(statusPath, "Quality gate", `Max review cycles (${maxReviewCycles}) exhausted — no more reviews allowed`);
					break;
				}

				if (fixCyclesUsed >= maxFixCycles) {
					// No more fix cycles allowed
					logExecution(statusPath, "Quality gate", `Max fix cycles (${maxFixCycles}) exhausted — cannot remediate`);
					break;
				}

				// ── Remediation: write feedback, spawn fix agent ─────
				fixCyclesUsed++;

				// Write REVIEW_FEEDBACK.md with blocking findings
				const feedbackContent = generateFeedbackMd(result.verdict, reviewCycle, maxReviewCycles, config.quality_gate.pass_threshold);
				const feedbackPath = join(task.taskFolder, FEEDBACK_FILENAME);
				try {
					writeFileSync(feedbackPath, feedbackContent);
					logExecution(statusPath, "Quality gate", `Wrote ${FEEDBACK_FILENAME} (fix cycle ${fixCyclesUsed}/${maxFixCycles})`);
				} catch (err: any) {
					logExecution(statusPath, "Quality gate", `Failed to write ${FEEDBACK_FILENAME}: ${err?.message} — skipping remediation`);
					break;
				}

				// Build fix agent prompt
				const fixPrompt = buildFixAgentPrompt(gateContext, feedbackContent, fixCyclesUsed);

				// Spawn fix agent (reuses worker spawn pattern)
				const fixResult = await doQualityGateFixAgent(ctx, fixPrompt, fixCyclesUsed);

				if (fixResult.timedOut) {
					// Fix agent hit wall-clock timeout — budget consumed deterministically
					logExecution(statusPath, "Quality gate", `Fix agent timed out (cycle ${fixCyclesUsed}, ${Math.round(fixResult.elapsed / 1000)}s) — budget consumed, proceeding to re-review`);
				} else if (fixResult.exitCode !== 0) {
					// Fix agent abnormal exit — consumes fix budget, log and continue to re-review
					logExecution(statusPath, "Quality gate", `Fix agent exited with code ${fixResult.exitCode} (cycle ${fixCyclesUsed}) — budget consumed, proceeding to re-review`);
				} else {
					logExecution(statusPath, "Quality gate", `Fix agent completed (cycle ${fixCyclesUsed}, ${Math.round(fixResult.elapsed / 1000)}s) — proceeding to re-review`);
				}

				// Loop back to the top for re-review
			}

			if (gatePassed) {
				// PASS → create .DONE
				const donePath = join(task.taskFolder, ".DONE");
				writeFileSync(donePath, `Completed: ${new Date().toISOString()}\nTask: ${task.taskId}\nQuality gate: PASS (cycle ${reviewCycle})\n`);
				updateStatusField(statusPath, "Status", "✅ Complete");
				logExecution(statusPath, "Task complete", `.DONE created (quality gate PASS, cycle ${reviewCycle})`);
			} else {
				// Gate failed — do NOT create .DONE
				// Persist blocking findings summary for operator visibility
				if (lastVerdict) {
					const criticals = lastVerdict.findings.filter(f => f.severity === "critical");
					const importants = lastVerdict.findings.filter(f => f.severity === "important");
					const suggestions = lastVerdict.findings.filter(f => f.severity === "suggestion");
					const summaryParts = [
						criticals.length > 0 ? `${criticals.length} critical` : "",
						importants.length > 0 ? `${importants.length} important` : "",
						// Include suggestion counts when they are blocking (all_clear threshold)
						(config.quality_gate.pass_threshold === "all_clear" && suggestions.length > 0)
							? `${suggestions.length} suggestion` : "",
					].filter(Boolean);
					const findingsSummary = summaryParts.join(", ");
					logExecution(statusPath, "Quality gate failed",
						`${reviewCycle} review cycle(s), ${fixCyclesUsed} fix cycle(s). ` +
						`Blocking findings: ${findingsSummary || "none extracted"}. ` +
						`Summary: ${lastVerdict.summary}`);
				} else {
					logExecution(statusPath, "Quality gate failed", `Task did not pass after ${reviewCycle} review cycle(s)`);
				}

				state.phase = "error";
				updateStatusField(statusPath, "Status", "❌ Quality gate failed");
				ctx.ui.notify(`❌ Quality gate failed after ${reviewCycle} review cycle(s), ${fixCyclesUsed} fix cycle(s). .DONE not created.`, "error");
				updateWidgets();
				return;
			}
		} else {
			// ── Empty completion guard ────────────────────────────────
			// Detect tasks where the worker checked off STATUS.md without
			// modifying any source files. This catches "shortcut" completions
			// where the worker concludes work is "already done" without
			// implementing anything.
			if (isOrchestratedMode()) {
				try {
					const diffResult = spawnSync("git", ["diff", "--name-only", "HEAD"], {
						cwd: task.taskFolder, encoding: "utf-8", timeout: 10_000,
					});
					const changedFiles = (diffResult.stdout || "").split("\n").filter(Boolean);
					const sourceChanges = changedFiles.filter(f =>
						!f.endsWith("STATUS.md") && !f.endsWith(".DONE") &&
						!f.includes(".reviews/") && !f.endsWith("dependencies.json")
					);
					if (sourceChanges.length === 0) {
						logExecution(statusPath, "⚠️ Empty completion",
							"Worker marked all steps complete but no source files were modified. " +
							"Only STATUS.md changes detected. This may indicate the worker shortcut " +
							"the task without implementing. .DONE will still be created, but this " +
							"should be investigated.");
						console.error(`[task-runner] WARNING: Task ${task.taskId} completed with zero source file changes`);
					}
				} catch {
					// Best effort — don't block .DONE creation on git check failure
				}
			}

			// Create .DONE
			const donePath = join(task.taskFolder, ".DONE");
			writeFileSync(donePath, `Completed: ${new Date().toISOString()}\nTask: ${task.taskId}\n`);
			updateStatusField(statusPath, "Status", "✅ Complete");
			logExecution(statusPath, "Task complete", ".DONE created");
		}

		// Auto-archive: move task folder to tasks/archive/.
		// In orchestrated runs, do NOT archive here — the orchestrator polls
		// .DONE at the original path and handles post-merge archival itself.
		if (!isOrchestratedMode()) {
			const tasksDir = dirname(task.taskFolder);
			const archiveDir = join(tasksDir, "archive");
			const archiveDest = join(archiveDir, basename(task.taskFolder));
			try {
				if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });
				const { renameSync } = require("fs");
				renameSync(task.taskFolder, archiveDest);
				logExecution(join(archiveDest, "STATUS.md"), "Archived", `Moved to ${archiveDest}`);
				ctx.ui.notify(`📦 Archived to ${archiveDest}`, "info");
			} catch (err: any) {
				ctx.ui.notify(`Archive failed (move manually): ${err?.message}`, "warning");
			}
		} else {
			ctx.ui.notify("ℹ️ Orchestrated run: skipping auto-archive (orchestrator handles archival)", "info");
		}

		state.phase = "complete";
		updateWidgets();
		ctx.ui.notify(`✅ Task ${task.taskId} complete!`, "success");
	}

	// ── Worker ───────────────────────────────────────────────────────


	async function runWorker(
		remainingSteps: StepInfo[],
		ctx: ExtensionContext,
	): Promise<void> {
		if (!state.task || !state.config) return;

		const task = state.task;
		const config = state.config;
		const statusPath = join(task.taskFolder, "STATUS.md");
		const wrapUpFile = join(task.taskFolder, ".task-wrap-up");

		const clearWrapUpSignals = () => {
			if (existsSync(wrapUpFile)) try { unlinkSync(wrapUpFile); } catch {}
		};

		const writeWrapUpSignal = (reason: string) => {
			const msg = `${reason} at ${new Date().toISOString()}`;
			if (!existsSync(wrapUpFile)) writeFileSync(wrapUpFile, msg);
		};

		clearWrapUpSignals();

		const workerDef = loadAgentDef(ctx.cwd, "task-worker");
		const basePrompt = workerDef?.systemPrompt || "You are a task execution agent. Read STATUS.md first, find unchecked items, work on them, checkpoint after each.";
		const systemPrompt = basePrompt + "\n\n" + buildProjectContext(config, task.taskFolder);

		const modelFallbackActive = process.env.TASKPLANE_MODEL_FALLBACK === "1";
		const model = modelFallbackActive
			? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514")
			: (config.worker.model
				|| workerDef?.model
				|| (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514"));

		const promptLines = [
			`Read your task instructions at: ${task.promptPath}`,
			`Read your execution state at: ${statusPath}`,
			``,
			`Task: ${task.taskId}`,
			`Task folder: ${task.taskFolder}/`,
			`Iteration: ${state.totalIterations}`,
			`Wrap-up signal file: ${wrapUpFile}`,
		];

		if (isOrchestratedMode()) {
			promptLines.push(``, `⚠️ ORCHESTRATED RUN: Do NOT archive or move the task folder. The orchestrator handles post-merge archival.`);
		}

		if (state.totalIterations > 1 && remainingSteps.length > 0) {
			const remainingSet = new Set(remainingSteps.map(s => s.number));
			const completedSteps = task.steps.filter(s => !remainingSet.has(s.number));
			const completedList = completedSteps.length > 0
				? completedSteps.map(s => `Step ${s.number}: ${s.name}`).join(", ")
				: "(none)";
			const remainingList = remainingSteps.map(s => `Step ${s.number}: ${s.name}`).join(", ");
			promptLines.push(
				``,
				`IMPORTANT: You exited previously without completing all steps.`,
				`Completed (do not redo): ${completedList}`,
				`Remaining (focus here): ${remainingList}`,
			);
		}

		const prompt = promptLines.join("\n");

		state.workerStatus = "running";
		state.workerElapsed = 0;
		state.workerContextPct = 0;
		state.workerLastTool = "";
		state.workerRetryActive = false;
		state.workerRetryCount = 0;
		state.workerLastRetryError = "";
		updateWidgets();

		const startTime = Date.now();
		state.workerTimer = setInterval(() => {
			state.workerElapsed = Date.now() - startTime;
			updateWidgets();
		}, 1000);

		const { contextWindow, source: contextWindowSource } = resolveContextWindow(config, ctx);
		const warnPct = config.context.warn_percent;
		const killPct = config.context.kill_percent;
		console.error(`[task-runner] worker context window: ${contextWindow} (${contextWindowSource})`);

		const conversationPrefix = isOrchestratedMode() ? getLanePrefix() : null;
		if (conversationPrefix) clearConversationLog(conversationPrefix);

		const spawned = spawnAgent({
			model,
			tools: config.worker.tools || workerDef?.tools || "read,write,edit,bash,grep,find,ls",
			thinking: config.worker.thinking || "off",
			systemPrompt,
			prompt,
			contextWindow,
			warnPct,
			killPct,
			wrapUpFile,
			onToolCall: (toolName, args) => {
				state.workerToolCount++;
				const path = args?.path || args?.command || "";
				const shortPath = typeof path === "string" && path.length > 80
					? "..." + path.slice(-77) : path;
				state.workerLastTool = `${toolName} ${shortPath}`.trim();
				if (conversationPrefix) {
					appendConversationEvent(conversationPrefix, {
						type: "tool_call", toolName, args, timestamp: Date.now(),
					});
				}
				updateWidgets();
			},
			onTokenUpdate: (tokens) => {
				state.workerInputTokens += tokens.input;
				state.workerOutputTokens += tokens.output;
				state.workerCacheReadTokens += tokens.cacheRead;
				state.workerCacheWriteTokens += tokens.cacheWrite;
				state.workerCostUsd += tokens.cost;
				updateWidgets();
			},
			onContextPct: (pct) => {
				state.workerContextPct = pct;
				if (pct >= warnPct) {
					writeWrapUpSignal(`Wrap up (context ${Math.round(pct)}%)`);
				}
				updateWidgets();
			},
			onJsonEvent: conversationPrefix
				? (event: Record<string, unknown>) => appendConversationEvent(conversationPrefix, event)
				: undefined,
		});

		state.workerProc = { kill: spawned.kill };
		const result = await spawned.promise;

		clearInterval(state.workerTimer);
		state.workerElapsed = Date.now() - startTime;
		state.workerStatus = result.killed ? "killed" : (result.exitCode === 0 ? "done" : "error");
		state.workerProc = null;
		clearWrapUpSignals();

		const statusMsg = result.killed
			? "killed (context limit)"
			: (result.exitCode === 0 ? "done" : `error (code ${result.exitCode})`);
		logExecution(statusPath, `Worker iter ${state.totalIterations}`,
			`${statusMsg} in ${Math.round(state.workerElapsed / 1000)}s, ctx: ${Math.round(state.workerContextPct)}%, tools: ${state.workerToolCount}`);

		updateWidgets();
	}

	// ── Reviewer ─────────────────────────────────────────────────────

	async function doReview(type: "plan" | "code", step: StepInfo, ctx: ExtensionContext, stepBaselineCommit?: string): Promise<string> {
		if (!state.task || !state.config) return "UNKNOWN";

		const task = state.task;
		const config = state.config;
		const statusPath = join(task.taskFolder, "STATUS.md");
		const reviewsDir = join(task.taskFolder, ".reviews");
		if (!existsSync(reviewsDir)) mkdirSync(reviewsDir, { recursive: true });

		state.reviewCounter++;
		const num = String(state.reviewCounter).padStart(3, "0");
		const requestPath = join(reviewsDir, `request-R${num}.md`);
		const outputPath = join(reviewsDir, `R${num}-${type}-step${step.number}.md`);

		const request = generateReviewRequest(type, step.number, step.name, task, config, outputPath, stepBaselineCommit);
		writeFileSync(requestPath, request);

		const reviewerDef = loadAgentDef(ctx.cwd, "task-reviewer");
		const reviewerModelFallback2 = process.env.TASKPLANE_MODEL_FALLBACK === "1";
		const reviewerModel = reviewerModelFallback2
			? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514")
			: (config.reviewer.model || reviewerDef?.model || (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514"));
		const reviewerPrompt = reviewerDef?.systemPrompt || "You are a code reviewer. Read the request and write your review to the specified output file.";
		const systemPrompt = reviewerPrompt + "\n\n" + buildProjectContext(config, task.taskFolder);

		state.reviewerStatus = "running";
		state.reviewerType = `${type} review`;
		state.reviewerElapsed = 0;
		state.reviewerLastTool = "";
		updateWidgets();

		const startTime = Date.now();
		state.reviewerTimer = setInterval(() => {
			state.reviewerElapsed = Date.now() - startTime;
			updateWidgets();
		}, 1000);

		const promptContent = readFileSync(requestPath, "utf-8");
		const spawned = spawnAgent({
			model: reviewerModel,
			tools: config.reviewer.tools || reviewerDef?.tools || "read,write,bash,grep,find,ls",
			thinking: config.reviewer.thinking || "on",
			systemPrompt,
			prompt: promptContent,
			onToolCall: (toolName, args) => {
				const path = args?.path || args?.command || "";
				const shortPath = typeof path === "string" && path.length > 40
					? "..." + path.slice(-37) : path;
				state.reviewerLastTool = `${toolName} ${shortPath}`.trim();
				updateWidgets();
			},
		});
		state.reviewerProc = { kill: spawned.kill };

		const result = await spawned.promise;

		clearInterval(state.reviewerTimer);
		state.reviewerElapsed = Date.now() - startTime;
		state.reviewerStatus = result.exitCode === 0 ? "done" : "error";
		state.reviewerProc = null;
		updateWidgets();

		let verdict = "UNKNOWN";
		if (existsSync(outputPath)) {
			const review = readFileSync(outputPath, "utf-8");
			verdict = extractVerdict(review);
		} else {
			verdict = "UNAVAILABLE";
			logExecution(statusPath, `Reviewer R${num}`, `${type} review — reviewer did not produce output`);
		}

		logReview(statusPath, `R${num}`, type, step.number, verdict, `.reviews/R${num}-${type}-step${step.number}.md`);
		logExecution(statusPath, `Review R${num}`, `${type} Step ${step.number}: ${verdict}`);
		updateStatusField(statusPath, "Review Counter", `${state.reviewCounter}`);

		ctx.ui.notify(`Review R${num} (${type} Step ${step.number}): ${verdict}`, verdict === "APPROVE" ? "success" : "warning");
		return verdict;
	}

	// ── Quality Gate ─────────────────────────────────────────────────

	/**
	 * Run a single quality gate review cycle.
	 *
	 * Spawns a review agent with a structured prompt that includes task evidence
	 * (PROMPT.md, STATUS.md, git diff, file list). The agent writes a JSON verdict
	 * to REVIEW_VERDICT.json in the task folder. This function reads/parses that
	 * file and applies verdict rules.
	 *
	 * Fail-open on all error paths:
	 * - Agent crash / non-zero exit → synthetic PASS
	 * - Missing verdict file → synthetic PASS
	 * - Malformed JSON → synthetic PASS
	 *
	 * @param ctx - Extension context
	 * @param cycleNum - Current review cycle number (1-based)
	 * @returns Quality gate result with pass/fail, verdict, and evaluation
	 */
	async function doQualityGateReview(ctx: ExtensionContext, cycleNum: number): Promise<QualityGateResult> {
		if (!state.task || !state.config) {
			return {
				passed: true, skipped: true, cyclesUsed: cycleNum,
				verdict: { verdict: "PASS", confidence: "low", summary: "No task/config — skipped", findings: [], statusReconciliation: [] },
				evaluation: { pass: true, failReasons: [] },
			};
		}

		const task = state.task;
		const config = state.config;
		const statusPath = join(task.taskFolder, "STATUS.md");

		const verdictPath = join(task.taskFolder, VERDICT_FILENAME);
		try { if (existsSync(verdictPath)) unlinkSync(verdictPath); } catch {}

		const gateContext: QualityGateContext = {
			taskFolder: task.taskFolder,
			promptPath: task.promptPath,
			taskId: task.taskId,
			projectName: config.project.name,
			passThreshold: config.quality_gate.pass_threshold,
		};

		const prompt = generateQualityGatePrompt(gateContext, ctx.cwd);
		const reviewerDef = loadAgentDef(ctx.cwd, "task-reviewer");
		const qgModelFallback = process.env.TASKPLANE_MODEL_FALLBACK === "1";
		const reviewModel = qgModelFallback
			? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514")
			: (config.quality_gate.review_model
				|| config.reviewer.model
				|| reviewerDef?.model
				|| (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514"));

		const reviewerPrompt = reviewerDef?.systemPrompt
			|| "You are a quality gate reviewer. Read the review request and write your JSON verdict to the specified file.";
		const systemPrompt = reviewerPrompt + "\n\n" + buildProjectContext(config, task.taskFolder);

		state.reviewerStatus = "running";
		state.reviewerType = `quality-gate cycle ${cycleNum}`;
		state.reviewerElapsed = 0;
		state.reviewerLastTool = "";
		updateWidgets();

		const startTime = Date.now();
		state.reviewerTimer = setInterval(() => {
			state.reviewerElapsed = Date.now() - startTime;
			updateWidgets();
		}, 1000);

		logExecution(statusPath, `Quality gate`, `Starting review cycle ${cycleNum}`);

		try {
			const spawned = spawnAgent({
				model: reviewModel,
				tools: config.reviewer.tools || reviewerDef?.tools || "read,write,bash,grep,find,ls",
				thinking: config.reviewer.thinking || "on",
				systemPrompt,
				prompt,
				onToolCall: (toolName, args) => {
					const path = args?.path || args?.command || "";
					const shortPath = typeof path === "string" && path.length > 40
						? "..." + path.slice(-37) : path;
					state.reviewerLastTool = `${toolName} ${shortPath}`.trim();
					updateWidgets();
				},
			});
			state.reviewerProc = { kill: spawned.kill };

			const result = await spawned.promise;

			clearInterval(state.reviewerTimer);
			state.reviewerElapsed = Date.now() - startTime;
			state.reviewerStatus = result.exitCode === 0 ? "done" : "error";
			state.reviewerProc = null;
			updateWidgets();

			if (result.exitCode !== 0) {
				logExecution(statusPath, `Quality gate`, `Review agent exited with code ${result.exitCode} — fail-open → PASS`);
				ctx.ui.notify(`Quality gate: review agent error (exit ${result.exitCode}) — fail-open PASS`, "warning");
				return {
					passed: true, skipped: false, cyclesUsed: cycleNum,
					verdict: { verdict: "PASS", confidence: "low", summary: `Review agent exited with code ${result.exitCode} — fail-open`, findings: [], statusReconciliation: [] },
					evaluation: { pass: true, failReasons: [] },
				};
			}
		} catch (err: any) {
			clearInterval(state.reviewerTimer);
			state.reviewerStatus = "error";
			state.reviewerProc = null;
			updateWidgets();
			logExecution(statusPath, `Quality gate`, `Review agent crashed: ${err?.message || err} — fail-open → PASS`);
			ctx.ui.notify(`Quality gate: review agent crashed — fail-open PASS`, "warning");
			return {
				passed: true, skipped: false, cyclesUsed: cycleNum,
				verdict: { verdict: "PASS", confidence: "low", summary: `Review agent crashed — fail-open`, findings: [], statusReconciliation: [] },
				evaluation: { pass: true, failReasons: [] },
			};
		}

		const { verdict, evaluation } = readAndEvaluateVerdict(
			task.taskFolder,
			config.quality_gate.pass_threshold,
		);

		if (verdict.statusReconciliation.length > 0) {
			const reconResult = applyStatusReconciliation(statusPath, verdict.statusReconciliation);
			if (reconResult.changed > 0 || reconResult.unmatched > 0) {
				logExecution(statusPath, `Reconciliation`,
					`${reconResult.changed} changed, ${reconResult.alreadyCorrect} already correct, ${reconResult.unmatched} unmatched`);
			}
		}

		const passed = evaluation.pass;
		const verdictLabel = passed ? "PASS" : "NEEDS_FIXES";
		const findingsSummary = verdict.findings.length > 0
			? ` (${verdict.findings.length} findings: ${verdict.findings.filter(f => f.severity === "critical").length}C/${verdict.findings.filter(f => f.severity === "important").length}I/${verdict.findings.filter(f => f.severity === "suggestion").length}S)`
			: "";

		logExecution(statusPath, `Quality gate`, `Cycle ${cycleNum}: ${verdictLabel}${findingsSummary}`);
		ctx.ui.notify(
			`Quality gate cycle ${cycleNum}: ${verdictLabel}${findingsSummary}`,
			passed ? "success" : "warning",
		);

		return {
			passed,
			skipped: false,
			cyclesUsed: cycleNum,
			verdict,
			evaluation,
		};
	}

	// ── Quality Gate Fix Agent ───────────────────────────────────────

	/** Default wall-clock timeout for fix agents (15 minutes). */
	const FIX_AGENT_TIMEOUT_MS = 15 * 60 * 1000;

	/**
	 * Spawn a fix agent to address quality gate findings.
	 *
	 * Reuses the standard worker subprocess spawn pattern. The fix agent
	 * receives REVIEW_FEEDBACK.md content and makes targeted code fixes.
	 *
	 * Handles abnormal exits deterministically:
	 * - Agent crash → returns non-zero exit code (caller consumes fix budget)
	 * - Agent timeout → kills agent, returns non-zero (caller consumes fix budget)
	 * - Agent exits normally but makes no changes → still returns 0 (re-review will catch)
	 *
	 * Wall-clock timeout: 15 minutes (or getMaxWorkerMinutes if configured).
	 * This prevents a hung fix agent from stalling the task permanently.
	 *
	 * @param ctx - Extension context
	 * @param fixPrompt - Prompt for the fix agent (includes REVIEW_FEEDBACK.md)
	 * @param fixCycleNum - Current fix cycle number (1-based)
	 * @returns Exit code, elapsed time, and whether timeout was hit
	 */
	async function doQualityGateFixAgent(
		ctx: ExtensionContext,
		fixPrompt: string,
		fixCycleNum: number,
	): Promise<{ exitCode: number; elapsed: number; timedOut: boolean }> {
		if (!state.task || !state.config) {
			return { exitCode: 1, elapsed: 0, timedOut: false };
		}

		const task = state.task;
		const config = state.config;
		const statusPath = join(task.taskFolder, "STATUS.md");

		const workerDef = loadAgentDef(ctx.cwd, "task-worker");
		const fixModelFallback = process.env.TASKPLANE_MODEL_FALLBACK === "1";
		const fixModel = fixModelFallback
			? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514")
			: (config.worker.model || workerDef?.model || "anthropic/claude-sonnet-4-20250514");

		const basePrompt = workerDef?.systemPrompt
			|| "You are a fix agent addressing quality gate findings. Read the feedback and make targeted code fixes.";
		const systemPrompt = basePrompt + "\n\n" + buildProjectContext(config, task.taskFolder);

		const workerMinutes = getMaxWorkerMinutes(config);
		const timeoutMs = Math.max(FIX_AGENT_TIMEOUT_MS, Math.floor(workerMinutes / 2) * 60 * 1000);

		state.workerStatus = "running";
		state.workerElapsed = 0;
		state.workerContextPct = 0;
		state.workerLastTool = "";
		state.workerToolCount = 0;
		state.workerRetryActive = false;
		state.workerRetryCount = 0;
		state.workerLastRetryError = "";
		updateWidgets();

		const startTime = Date.now();
		state.workerTimer = setInterval(() => {
			state.workerElapsed = Date.now() - startTime;
			updateWidgets();
		}, 1000);

		logExecution(statusPath, "Quality gate", `Starting fix agent (cycle ${fixCycleNum}, timeout: ${Math.round(timeoutMs / 60000)}min)`);

		let killFn: (() => void) | null = null;

		try {
			const spawned = spawnAgent({
				model: fixModel,
				tools: config.worker.tools || workerDef?.tools || "read,write,edit,bash,grep,find,ls",
				thinking: config.worker.thinking || "off",
				systemPrompt,
				prompt: fixPrompt,
				onToolCall: (toolName, args) => {
					state.workerToolCount++;
					const path = args?.path || args?.command || "";
					const shortPath = typeof path === "string" && path.length > 80
						? "..." + path.slice(-77) : path;
					state.workerLastTool = `${toolName} ${shortPath}`.trim();
					updateWidgets();
				},
			});
			killFn = spawned.kill;
			state.workerProc = { kill: spawned.kill };

			let timedOut = false;
			const timeoutPromise = new Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>((resolve) => {
				const timer = setTimeout(() => {
					timedOut = true;
					logExecution(statusPath, "Quality gate", `Fix agent wall-clock timeout (${Math.round(timeoutMs / 60000)}min) — killing agent`);
					if (killFn) killFn();
					setTimeout(() => {
						resolve({ output: "timeout", exitCode: 1, elapsed: Date.now() - startTime, killed: true });
					}, 5000);
				}, timeoutMs);
				spawned.promise.then(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
			});

			const result = await Promise.race([spawned.promise, timeoutPromise]);

			clearInterval(state.workerTimer);
			state.workerElapsed = Date.now() - startTime;
			state.workerStatus = (result.exitCode === 0 && !timedOut) ? "done" : "error";
			state.workerProc = null;
			updateWidgets();

			return { exitCode: timedOut ? 1 : result.exitCode, elapsed: Date.now() - startTime, timedOut };
		} catch (err: any) {
			clearInterval(state.workerTimer);
			state.workerStatus = "error";
			state.workerProc = null;
			updateWidgets();
			logExecution(statusPath, "Quality gate", `Fix agent crashed: ${err?.message || err} — fix cycle ${fixCycleNum} consumed`);
			return { exitCode: 1, elapsed: Date.now() - startTime, timedOut: false };
		}
	}

	// ── Commands ─────────────────────────────────────────────────────

	// ── Shared Task Initialization ───────────────────────────────────
	//
	// Extracts the core init logic used by both the `/task` command and
	// TASK_AUTOSTART so that they share a single code path. Returns true
	// if the task was started successfully.

	function startTaskFromPath(ctx: ExtensionContext, fullPath: string): boolean {
		if (state.phase === "running") {
			ctx.ui.notify("A task is already running. Use /task-pause first.", "warning");
			return false;
		}

		// Parse PROMPT.md
		let parsed: ParsedTask;
		try {
			const content = readFileSync(fullPath, "utf-8");
			parsed = parsePromptMd(content, fullPath);
		} catch (err: any) {
			ctx.ui.notify(`Failed to parse PROMPT.md: ${err?.message || err}`, "error");
			return false;
		}

		state = freshState();
		state.task = parsed;
		state.config = loadConfig(ctx.cwd);
		state.phase = "running";
		widgetCtx = ctx;

		// Generate STATUS.md if missing
		const statusPath = join(state.task.taskFolder, "STATUS.md");
		if (!existsSync(statusPath)) {
			writeFileSync(statusPath, generateStatusMd(state.task));
			ctx.ui.notify("Generated STATUS.md from PROMPT.md", "info");
		} else {
			// Sync review counter and iteration from existing STATUS
			const existing = parseStatusMd(readFileSync(statusPath, "utf-8"));
			state.reviewCounter = existing.reviewCounter;
			state.totalIterations = existing.iteration;
			for (const s of existing.steps) state.stepStatuses.set(s.number, s);
		}

		// Create .reviews/ if missing
		const reviewsDir = join(state.task.taskFolder, ".reviews");
		if (!existsSync(reviewsDir)) mkdirSync(reviewsDir, { recursive: true });

		updateWidgets();
		ctx.ui.notify(
			`Starting: ${state.task.taskId} — ${state.task.taskName}\n` +
			`Review Level: ${state.task.reviewLevel} · Size: ${state.task.size} · Steps: ${state.task.steps.length}\n` +
			`Worker model: ${state.config.worker.model || "inherit"} · Reviewer: ${state.config.reviewer.model}`,
			"info",
		);

		// Fire-and-forget
		executeTask(ctx).catch(err => {
			state.phase = "error";
			ctx.ui.notify(`Task error: ${err?.message || err}`, "error");
			updateWidgets();
		});

		return true;
	}

	pi.registerCommand("task", {
		description: "⚠️ [Deprecated] Start executing a task: /task <path/to/PROMPT.md>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			ctx.ui.notify(
				"⚠️ /task is deprecated. Use /orch instead — it provides worktree isolation, " +
				"dashboard, inline reviews, and supervisor monitoring. " +
				"/task will be removed in a future major version.",
				"warning",
			);
			const promptPath = args?.trim();
			if (!promptPath) {
				ctx.ui.notify("Usage: /task <path/to/PROMPT.md>", "error");
				return;
			}

			const fullPath = resolve(ctx.cwd, promptPath);
			if (!existsSync(fullPath)) {
				ctx.ui.notify(`File not found: ${promptPath}`, "error");
				return;
			}

			startTaskFromPath(ctx, fullPath);
		},
	});

	pi.registerCommand("task-status", {
		description: "⚠️ [Deprecated] Show current task progress",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			ctx.ui.notify(
				"⚠️ /task-status is deprecated. Use the dashboard (`taskplane dashboard`) or `/orch-status` instead.",
				"warning",
			);
			if (!state.task) {
				ctx.ui.notify("No task loaded. Use /task <path/to/PROMPT.md>", "info");
				return;
			}

			const statusPath = join(state.task.taskFolder, "STATUS.md");
			if (!existsSync(statusPath)) {
				ctx.ui.notify("STATUS.md not found", "error");
				return;
			}

			const parsed = parseStatusMd(readFileSync(statusPath, "utf-8"));
			const lines = parsed.steps.map(s => {
				const icon = s.status === "complete" ? "✅" : s.status === "in-progress" ? "🟨" : "⬜";
				return `${icon} Step ${s.number}: ${s.name} (${s.totalChecked}/${s.totalItems})`;
			});

			ctx.ui.notify(
				`${state.task.taskId}: ${state.task.taskName}\n` +
				`Phase: ${state.phase} · Iteration: ${state.totalIterations} · Reviews: ${state.reviewCounter}\n\n` +
				lines.join("\n"),
				"info",
			);

			// Refresh widget
			for (const s of parsed.steps) state.stepStatuses.set(s.number, s);
			updateWidgets();
		},
	});

	pi.registerCommand("task-pause", {
		description: "⚠️ [Deprecated] Pause task after current worker finishes",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			ctx.ui.notify(
				"⚠️ /task-pause is deprecated. Use `/orch-pause` instead.",
				"warning",
			);
			if (state.phase !== "running") {
				ctx.ui.notify("No task is running", "warning");
				return;
			}
			state.phase = "paused";
			ctx.ui.notify("Task will pause after current worker finishes", "info");
			updateWidgets();
		},
	});

	pi.registerCommand("task-resume", {
		description: "⚠️ [Deprecated] Resume a paused task",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			ctx.ui.notify(
				"⚠️ /task-resume is deprecated. Use `/orch-resume` instead.",
				"warning",
			);
			if (state.phase !== "paused") {
				ctx.ui.notify("Task is not paused", "warning");
				return;
			}
			if (!state.task) {
				ctx.ui.notify("No task loaded", "error");
				return;
			}

			state.phase = "running";
			ctx.ui.notify(`Resuming ${state.task.taskId}...`, "info");
			updateWidgets();

			executeTask(ctx).catch(err => {
				state.phase = "error";
				ctx.ui.notify(`Task error: ${err?.message || err}`, "error");
				updateWidgets();
			});
		},
	});

	// ── Session Lifecycle ────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		widgetCtx = ctx;

		// Kill any running subprocesses
		if (state.workerProc) try { state.workerProc.kill(); } catch {}
		if (state.reviewerProc) try { state.reviewerProc.kill(); } catch {}
		// TP-057: Kill persistent reviewer session if alive
		if (state.persistentReviewerKill) try { state.persistentReviewerKill(); } catch {}
		state.persistentReviewerSession = null;
		state.persistentReviewerKill = null;
		state.persistentReviewerSignalNum = 0;
		if (state.workerTimer) clearInterval(state.workerTimer);
		if (state.reviewerTimer) clearInterval(state.reviewerTimer);

		// Keep task state if resuming, but reset runtime state
		const hadTask = state.task;
		if (hadTask) {
			state.phase = "paused";
			state.workerStatus = "idle";
			state.reviewerStatus = "idle";
			state.workerProc = null;
			state.reviewerProc = null;
			// Refresh from STATUS.md
			const statusPath = join(hadTask.taskFolder, "STATUS.md");
			if (existsSync(statusPath)) {
				const parsed = parseStatusMd(readFileSync(statusPath, "utf-8"));
				state.reviewCounter = parsed.reviewCounter;
				state.totalIterations = parsed.iteration;
				for (const s of parsed.steps) state.stepStatuses.set(s.number, s);
			}
		}

		updateWidgets();

		const config = loadConfig(ctx.cwd);
		ctx.ui.setStatus("task-runner", `📋 ${config.project.name}`);

		if (hadTask) {
			ctx.ui.notify(`Task ${hadTask.taskId} loaded (paused). Use /task-resume to continue.`, "info");
		} else if (process.env.TASK_AUTOSTART) {
			// ── TASK_AUTOSTART ────────────────────────────────────────
			// When set, automatically start a task as if the user typed
			// `/task <path>`. Used by the orchestrator to launch
			// workers automatically without manual command entry timing issues.
			const autoPath = process.env.TASK_AUTOSTART;
			const fullPath = resolve(ctx.cwd, autoPath);
			if (!existsSync(fullPath)) {
				ctx.ui.notify(`TASK_AUTOSTART: file not found — ${fullPath}`, "error");
			} else {
				ctx.ui.notify(`TASK_AUTOSTART: ${fullPath}`, "info");
				startTaskFromPath(ctx, fullPath);
			}
		} else {
			ctx.ui.notify(
				`Task Runner ready — ${config.project.name}\n\n` +
				`/task <path/to/PROMPT.md>  Start a task\n` +
				`/task-status               Show progress\n` +
				`/task-pause                Pause execution\n` +
				`/task-resume               Resume execution`,
				"info",
			);
		}
	});
}
