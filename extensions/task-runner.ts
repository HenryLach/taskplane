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
import { loadProjectConfig, toTaskConfig } from "./taskplane/config-loader.ts";
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
		spawn_mode?: "subprocess" | "tmux";
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
	/** Structured exit diagnostic from the most recent tmux worker iteration (null in subprocess mode or before first completion). */
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
	/** TP-057: Persistent reviewer session — tracks the long-lived reviewer tmux session. */
	persistentReviewerSession: string | null;
	/** TP-057: Kill function for the persistent reviewer (to stop sidecar polling). */
	persistentReviewerKill: (() => void) | null;
	/** TP-057: Signal counter for the persistent reviewer (monotonically increasing). */
	persistentReviewerSignalNum: number;
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
		persistentReviewerSession: null, persistentReviewerKill: null, persistentReviewerSignalNum: 0,
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
	} catch {
		// If config loading fails (e.g., malformed JSON), fall back to defaults
		return { ...DEFAULT_CONFIG };
	}
}

// ── Spawn Mode Resolution ────────────────────────────────────────────

/**
 * Determines whether workers/reviewers spawn as headless subprocesses
 * (existing behavior) or as TMUX sessions (parallel orchestrator mode).
 *
 * Resolution order: env var → config → default "subprocess".
 * The orchestrator sets TASK_RUNNER_SPAWN_MODE=tmux per-lane.
 */
function getSpawnMode(config: TaskConfig): "subprocess" | "tmux" {
	const envMode = process.env.TASK_RUNNER_SPAWN_MODE;
	if (envMode === "tmux" || envMode === "subprocess") return envMode;
	if (config.worker.spawn_mode === "tmux" || config.worker.spawn_mode === "subprocess") {
		return config.worker.spawn_mode;
	}
	return "subprocess";
}

/**
 * Returns the TMUX session name prefix for worker/reviewer sessions.
 * The orchestrator sets TASK_RUNNER_TMUX_PREFIX per-lane (e.g., "orch-lane-1").
 * Worker sessions become "{prefix}-worker", reviewer sessions "{prefix}-reviewer".
 */
function getTmuxPrefix(): string {
	return process.env.TASK_RUNNER_TMUX_PREFIX || "task";
}

/**
 * Detects whether this task runner is executing inside the parallel orchestrator.
 *
 * TASK_RUNNER_TMUX_PREFIX is only ever set by the orchestrator (via execution.ts
 * buildLaneEnv). Its presence — regardless of value — indicates orchestrated mode.
 * The prefix can be any user-configured value (e.g., "orch-lane-1", "penster-lane-1").
 *
 * When true, certain worker behaviors are suppressed — most notably, workers
 * must NOT archive task folders because the orchestrator polls for .DONE files
 * at the original path.
 */
function isOrchestratedMode(): boolean {
	return !!process.env.TASK_RUNNER_TMUX_PREFIX;
}

/**
 * Returns the wall-clock timeout for TMUX worker sessions in minutes.
 * Used instead of context-% based kill (no JSON stream in TMUX mode).
 *
 * Resolution order: env var → config → default 30 minutes.
 * Reviewers do NOT use this timeout — they run to session completion.
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
	const prefix = getTmuxPrefix(); // e.g., "orch-lane-1"
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
			timestamp: Date.now(),
		};
		writeFileSync(filePath, JSON.stringify(data) + "\n");
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
	const text = content.replace(/\r\n/g, "\n");
	const taskFolder = dirname(resolve(promptPath));

	// Task ID and name
	let taskId = "", taskName = "";
	const titleMatch = text.match(/^#\s+(?:Task:\s*)?(\S+-\d+)\s*[-–:]\s*(.+)/m);
	if (titleMatch) { taskId = titleMatch[1]; taskName = titleMatch[2].trim(); }
	else { taskId = basename(taskFolder); taskName = taskId; }

	// Review level
	let reviewLevel = 0;
	const rlMatch = text.match(/##\s+Review Level[:\s]*(\d)/);
	if (rlMatch) reviewLevel = parseInt(rlMatch[1]);

	// Size
	let size = "M";
	const sizeMatch = text.match(/\*\*Size:\*\*\s*(\w+)/);
	if (sizeMatch) size = sizeMatch[1];

	// Steps
	const steps: StepInfo[] = [];
	const stepRegex = /###\s+Step\s+(\d+):\s*(.+)/g;
	const positions: { number: number; name: string; start: number }[] = [];
	let m;
	while ((m = stepRegex.exec(text)) !== null) {
		positions.push({ number: parseInt(m[1]), name: m[2].trim(), start: m.index });
	}
	for (let i = 0; i < positions.length; i++) {
		const section = text.slice(positions[i].start, i + 1 < positions.length ? positions[i + 1].start : text.length);
		const checkboxes: { text: string; checked: boolean }[] = [];
		const cbRegex = /^\s*-\s*\[([ xX])\]\s*(.*)/gm;
		let cb;
		while ((cb = cbRegex.exec(section)) !== null) {
			checkboxes.push({ text: cb[2].trim(), checked: cb[1].toLowerCase() === "x" });
		}
		steps.push({
			number: positions[i].number, name: positions[i].name,
			status: "not-started", checkboxes,
			totalChecked: checkboxes.filter(c => c.checked).length,
			totalItems: checkboxes.length,
		});
	}

	// Context docs
	const contextDocs: string[] = [];
	const ctxMatch = text.match(/##\s+Context to Read First\s*\n+([\s\S]*?)(?=\n##\s|$)/);
	if (ctxMatch) {
		const pathRegex = /`([^\s`]+\.(?:md|yaml|json|go|ts|js))`/g;
		let pm;
		while ((pm = pathRegex.exec(ctxMatch[1])) !== null) contextDocs.push(pm[1]);
	}

	return { taskId, taskName, reviewLevel, size, steps, contextDocs, taskFolder, promptPath };
}

// ── STATUS.md Parser ─────────────────────────────────────────────────

function parseStatusMd(content: string): { steps: StepInfo[]; reviewCounter: number; iteration: number } {
	const text = content.replace(/\r\n/g, "\n");
	const steps: StepInfo[] = [];
	let currentStep: StepInfo | null = null;
	let reviewCounter = 0, iteration = 0;

	for (const line of text.split("\n")) {
		const rcMatch = line.match(/\*\*Review Counter:\*\*\s*(\d+)/);
		if (rcMatch) reviewCounter = parseInt(rcMatch[1]);
		const itMatch = line.match(/\*\*Iteration:\*\*\s*(\d+)/);
		if (itMatch) iteration = parseInt(itMatch[1]);

		const stepMatch = line.match(/^###\s+Step\s+(\d+):\s*(.+)/);
		if (stepMatch) {
			if (currentStep) {
				currentStep.totalChecked = currentStep.checkboxes.filter(c => c.checked).length;
				currentStep.totalItems = currentStep.checkboxes.length;
				steps.push(currentStep);
			}
			currentStep = { number: parseInt(stepMatch[1]), name: stepMatch[2].trim(), status: "not-started", checkboxes: [], totalChecked: 0, totalItems: 0 };
			continue;
		}
		if (currentStep) {
			const ss = line.match(/\*\*Status:\*\*\s*(.*)/);
			if (ss) {
				const s = ss[1];
				if (s.includes("✅") || s.toLowerCase().includes("complete")) currentStep.status = "complete";
				else if (s.includes("🟨") || s.toLowerCase().includes("progress")) currentStep.status = "in-progress";
			}
			const cb = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
			if (cb) currentStep.checkboxes.push({ text: cb[2].trim(), checked: cb[1].toLowerCase() === "x" });
		}
	}
	if (currentStep) {
		currentStep.totalChecked = currentStep.checkboxes.filter(c => c.checked).length;
		currentStep.totalItems = currentStep.checkboxes.length;
		steps.push(currentStep);
	}
	return { steps, reviewCounter, iteration };
}

// ── STATUS.md Generator ──────────────────────────────────────────────

function generateStatusMd(task: ParsedTask): string {
	const now = new Date().toISOString().slice(0, 10);
	const lines: string[] = [
		`# ${task.taskId}: ${task.taskName} — Status`, "",
		`**Current Step:** Not Started`,
		`**Status:** 🔵 Ready for Execution`,
		`**Last Updated:** ${now}`,
		`**Review Level:** ${task.reviewLevel}`,
		`**Review Counter:** 0`,
		`**Iteration:** 0`,
		`**Size:** ${task.size}`, "", "---", "",
	];
	for (const step of task.steps) {
		lines.push(`### Step ${step.number}: ${step.name}`, `**Status:** ⬜ Not Started`, "");
		for (const cb of step.checkboxes) lines.push(`- [ ] ${cb.text}`);
		lines.push("", "---", "");
	}
	lines.push(
		"## Reviews", "", "| # | Type | Step | Verdict | File |", "|---|------|------|---------|------|", "", "---", "",
		"## Discoveries", "", "| Discovery | Disposition | Location |", "|-----------|-------------|----------|", "", "---", "",
		"## Execution Log", "", "| Timestamp | Action | Outcome |", "|-----------|--------|---------|",
		`| ${now} | Task staged | STATUS.md auto-generated by task-runner |`, "", "---", "",
		"## Blockers", "", "*None*", "", "---", "", "## Notes", "", "*Reserved for execution notes*",
	);
	return lines.join("\n");
}

// ── STATUS.md Updaters ───────────────────────────────────────────────

function updateStatusField(statusPath: string, field: string, value: string): void {
	let content = readFileSync(statusPath, "utf-8").replace(/\r\n/g, "\n");
	const pattern = new RegExp(`(\\*\\*${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\*\\*\\s*)(.+)`);
	if (pattern.test(content)) {
		content = content.replace(pattern, `$1${value}`);
	} else {
		// Append after last ** field
		content = content.replace(/(\*\*[^*]+:\*\*\s*.+\n)/, `$1**${field}:** ${value}\n`);
	}
	writeFileSync(statusPath, content);
}

function updateStepStatus(statusPath: string, stepNum: number, status: "not-started" | "in-progress" | "complete"): void {
	let content = readFileSync(statusPath, "utf-8").replace(/\r\n/g, "\n");
	const emoji = status === "complete" ? "✅ Complete" : status === "in-progress" ? "🟨 In Progress" : "⬜ Not Started";
	const lines = content.split("\n");
	let inTarget = false;
	for (let i = 0; i < lines.length; i++) {
		const sm = lines[i].match(/^###\s+Step\s+(\d+):/);
		if (sm) inTarget = parseInt(sm[1]) === stepNum;
		if (inTarget && lines[i].match(/^\*\*Status:\*\*/)) {
			lines[i] = `**Status:** ${emoji}`;
			break;
		}
	}
	writeFileSync(statusPath, lines.join("\n"));
}

function appendTableRow(statusPath: string, sectionName: string, row: string): void {
	let content = readFileSync(statusPath, "utf-8").replace(/\r\n/g, "\n");
	const lines = content.split("\n");
	let insertIdx = -1, inSection = false, lastTableRow = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].match(new RegExp(`^##\\s+${sectionName}`))) {
			inSection = true;
			continue;
		}
		if (inSection) {
			// End of section — hit another ## heading or ---
			if (lines[i].match(/^##\s/) || lines[i].trim() === "---") {
				insertIdx = lastTableRow >= 0 ? lastTableRow + 1 : i;
				break;
			}
			// Track last table data row (skip header separator |---|)
			if (lines[i].startsWith("|") && !lines[i].match(/^\|[\s-|]+\|$/)) {
				lastTableRow = i;
			}
		}
	}
	if (insertIdx === -1) {
		insertIdx = lastTableRow >= 0 ? lastTableRow + 1 : lines.length;
	}
	lines.splice(insertIdx, 0, row);
	writeFileSync(statusPath, lines.join("\n"));
}

function logExecution(statusPath: string, action: string, outcome: string): void {
	const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
	appendTableRow(statusPath, "Execution Log", `| ${ts} | ${action} | ${outcome} |`);
}

function logReview(statusPath: string, num: string, type: string, stepNum: number, verdict: string, file: string): void {
	appendTableRow(statusPath, "Reviews", `| ${num} | ${type} | Step ${stepNum} | ${verdict} | ${file} |`);
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
	try {
		const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
			encoding: "utf-8",
			timeout: 5000,
		});
		return result.status === 0 ? (result.stdout || "").trim() : "";
	} catch {
		return "";
	}
}

/**
 * Find the git commit SHA where a specific step was completed.
 * Workers commit at step boundaries with messages like:
 *   feat(TP-048): complete Step N — description
 * Returns the commit SHA if found, or empty string.
 */
function findStepBoundaryCommit(stepNumber: number, taskId: string, since?: string): string {
	try {
		// Search git log for the step completion commit
		const args = ["log", "--oneline", "--grep", `complete Step ${stepNumber}`, "--grep", taskId, "--all-match", "-1", "--format=%H"];
		if (since) args.push(`${since}..HEAD`);
		const result = spawnSync("git", args, {
			encoding: "utf-8",
			timeout: 5000,
		});
		return result.status === 0 ? (result.stdout || "").trim() : "";
	} catch {
		return "";
	}
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
	const normalizedFolder = taskFolder.replace(/\\/g, "/");

	// Find which area this task belongs to
	for (const [areaName, areaCfg] of Object.entries(config.task_areas)) {
		const areaPath = areaCfg.path.replace(/\\/g, "/");
		if (normalizedFolder.includes(areaPath)) {
			const override = config.standards_overrides[areaName];
			if (override) {
				return {
					docs: override.docs ?? config.standards.docs,
					rules: override.rules ?? config.standards.rules,
				};
			}
			break; // Area found but no override — use global
		}
	}

	return { docs: config.standards.docs, rules: config.standards.rules };
}

// ── Review Request Generator ─────────────────────────────────────────

function generateReviewRequest(
	type: "plan" | "code", stepNum: number, stepName: string,
	task: ParsedTask, config: TaskConfig, outputPath: string,
	stepBaselineCommit?: string,
): string {
	const resolved = resolveStandards(config, task.taskFolder);
	const standardsDocs = resolved.docs.map(d => `   - ${d}`).join("\n");
	const standardsRules = resolved.rules.map(r => `- ${r}`).join("\n");

	if (type === "plan") {
		return [
			`# Review Request: Plan Review`, "",
			`You are reviewing an implementation plan for a ${config.project.name} task.`,
			`You have full tool access — use \`read\` to examine files and \`bash\` to run commands.`, "",
			`## Task Context`, "",
			`- **Task PROMPT:** ${task.promptPath}`,
			`- **Task STATUS:** ${join(task.taskFolder, "STATUS.md")}`,
			`- **Step being planned:** Step ${stepNum}: ${stepName}`, "",
			`## Instructions`, "",
			`1. Read the PROMPT.md for full requirements`,
			`2. Read STATUS.md for progress so far`,
			`3. Check relevant source files for existing patterns:`,
			standardsDocs, "",
			`## Project Standards`, "", standardsRules, "",
			`## Output`, "",
			`Write your review to: \`${outputPath}\``,
		].join("\n");
	} else {
		// For code reviews, provide the baseline commit so the reviewer can
		// diff the full step's changes — not just uncommitted changes.
		// Workers commit via checkpoints, so `git diff` alone sees nothing.
		const diffCmd = stepBaselineCommit
			? `git diff ${stepBaselineCommit}..HEAD --name-only`
			: `git diff --name-only`;
		const diffFullCmd = stepBaselineCommit
			? `git diff ${stepBaselineCommit}..HEAD`
			: `git diff`;

		return [
			`# Review Request: Code Review`, "",
			`You are reviewing code changes for a ${config.project.name} task.`,
			`You have full tool access — use \`read\` to examine files and \`bash\` to run commands.`, "",
			`## Task Context`, "",
			`- **Task PROMPT:** ${task.promptPath}`,
			`- **Task STATUS:** ${join(task.taskFolder, "STATUS.md")}`,
			`- **Step reviewed:** Step ${stepNum}: ${stepName}`,
			...(stepBaselineCommit ? [`- **Step baseline commit:** ${stepBaselineCommit}`] : []),
			"",
			`## Instructions`, "",
			`1. Run \`${diffCmd}\` to see files changed in this step`,
			`   Then \`${diffFullCmd}\` for the full diff`,
			`   **Important:** The worker commits code via checkpoints, so plain \`git diff\` may show nothing.`,
			`   Always use the baseline commit range above to see all step changes.`,
			`2. Read changed files in full for context`,
			`3. Check neighboring files for pattern consistency`,
			`4. Check standards:`,
			standardsDocs, "",
			`## Project Standards`, "", standardsRules, "",
			`## Output`, "",
			`Write your review to: \`${outputPath}\``,
		].join("\n");
	}
}

function extractVerdict(reviewContent: string): string {
	// Primary: standard format "### Verdict: APPROVE|REVISE|RETHINK"
	const match = reviewContent.match(/###?\s*Verdict[:\s]*(APPROVE|REVISE|RETHINK)/i);
	if (match) return match[1].toUpperCase();

	// TP-068: Tolerate non-standard verdict formats from models that don't
	// follow the exact template (e.g., "Changes requested", "Needs revision").
	const lower = reviewContent.toLowerCase();
	if (/\b(changes?\s+requested|needs?\s+revision|please\s+revise|must\s+revise)\b/.test(lower)) {
		return "REVISE";
	}
	if (/\b(looks?\s+good|no\s+issues?\s+found|approved?)\b/.test(lower)) {
		return "APPROVE";
	}
	if (/\b(fundamentally\s+wrong|rethink|reconsider\s+the\s+approach)\b/.test(lower)) {
		return "RETHINK";
	}

	return "UNKNOWN";
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
	contextUsage: { percentUsed: number; totalTokens: number; maxTokens: number } | null;
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
		hadEvents: false, contextUsage: null,
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
					if (typeof cu.percentUsed === "number") {
						delta.contextUsage = {
							percentUsed: cu.percentUsed,
							totalTokens: cu.totalTokens || 0,
							maxTokens: cu.maxTokens || 0,
						};
					}
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

// ── Exit Summary & Diagnostic ────────────────────────────────────────

/**
 * Read the exit summary JSON file written by rpc-wrapper.mjs.
 *
 * Returns null if the file is missing (session vanished) or malformed
 * (wrapper crashed mid-write). Logs a warning on parse failure but
 * never throws — the caller should treat null as "session_vanished".
 */
function readExitSummary(exitSummaryPath: string): ExitSummary | null {
	try {
		if (!existsSync(exitSummaryPath)) {
			return null;
		}
		const raw = readFileSync(exitSummaryPath, "utf-8").trim();
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		// Minimal shape validation: must be a plain object (not array, not null)
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			console.error(`[task-runner] exit summary is not a plain object: ${exitSummaryPath}`);
			return null;
		}
		return parsed as ExitSummary;
	} catch (err: any) {
		console.error(`[task-runner] failed to read exit summary: ${err.message}`);
		return null;
	}
}

/**
 * Input parameters for `buildExitDiagnostic()`.
 *
 * Bridges the task-runner's runtime state into `classifyExit()` input
 * and populates the full `TaskExitDiagnostic` with progress metadata.
 */
interface BuildExitDiagnosticInput {
	/** Exit summary from rpc-wrapper.mjs (null if file missing) */
	exitSummary: ExitSummary | null;
	/** Whether .DONE file was found */
	doneFileFound: boolean;
	/** Whether the wall-clock timer killed the session */
	timerKilled: boolean;
	/** Whether the context-limit kill was triggered */
	contextKilled: boolean;
	/** Whether the user manually killed the session */
	userKilled: boolean;
	/** Estimated context utilization % from sidecar tailing (0-100) */
	contextPct: number;
	/** Wall-clock duration in seconds */
	durationSec: number;
	/** Repo identifier ("default" in repo mode, repo key in workspace mode) */
	repoId: string;
	/** Last known step number from STATUS.md (null if not parsed) */
	lastKnownStep: number | null;
	/** Last known checkbox text from STATUS.md (null if not parsed) */
	lastKnownCheckbox: string | null;
	/** Number of commits representing partial progress (0 if none) */
	partialProgressCommits: number;
	/** Branch name holding partial progress (null if no branch) */
	partialProgressBranch: string | null;
}

/**
 * Build a structured `TaskExitDiagnostic` from task-runner runtime state.
 *
 * Calls `classifyExit()` with the appropriate signal mapping, then
 * enriches the result with progress metadata (commits, step, repo).
 *
 * Signal mapping:
 * - `stallDetected` in ExitClassificationInput ← not directly available in
 *   task-runner's tmux mode (stall detection is orchestrator-level), so
 *   always false here. Stall classification may still occur via orchestrator.
 * - `contextKilled` ← when the task-runner explicitly kills the session
 *   due to context limit. Passed to classifyExit() so it can produce
 *   `context_overflow` even when exit summary is missing or lacks
 *   compaction events (e.g., wrapper crashed before writing summary).
 */
function buildExitDiagnostic(input: BuildExitDiagnosticInput): TaskExitDiagnostic {
	const classification = classifyExit({
		exitSummary: input.exitSummary,
		doneFileFound: input.doneFileFound,
		timerKilled: input.timerKilled,
		contextKilled: input.contextKilled,
		stallDetected: false, // Stall detection is orchestrator-level, not available in /task mode
		userKilled: input.userKilled,
		contextPct: input.contextPct,
	});

	return {
		classification,
		exitCode: input.exitSummary?.exitCode ?? null,
		errorMessage: input.exitSummary?.error ?? null,
		tokensUsed: input.exitSummary?.tokens ?? null,
		contextPct: input.contextPct,
		partialProgressCommits: input.partialProgressCommits,
		partialProgressBranch: input.partialProgressBranch,
		durationSec: input.durationSec,
		lastKnownStep: input.lastKnownStep,
		lastKnownCheckbox: input.lastKnownCheckbox,
		repoId: input.repoId,
	};
}

/** Expose exit summary/diagnostic helpers for testing. */
export const _readExitSummary = readExitSummary;
export const _buildExitDiagnostic = buildExitDiagnostic;
export type { BuildExitDiagnosticInput };

/**
 * Determine whether a step is "low-risk" and should skip reviews.
 * Low-risk steps: Step 0 (Preflight) and the final step (Delivery/Docs).
 *
 * @param stepNumber  The 0-based step number being evaluated
 * @param totalSteps  Total number of steps in the task
 * @returns true if the step should skip plan and code reviews
 */
export function isLowRiskStep(stepNumber: number, totalSteps: number): boolean {
	if (totalSteps <= 0) return false;
	const lastStepIndex = totalSteps - 1;
	return stepNumber === 0 || stepNumber === lastStepIndex;
}

// ── TMUX Agent Spawner ───────────────────────────────────────────────

/**
 * Spawns a Pi agent in a named TMUX session instead of a headless subprocess.
 * Returns the same interface shape as `spawnAgent()` for drop-in compatibility.
 *
 * Differences from subprocess mode:
 *   - No JSON event stream → no onToolCall/onContextPct callbacks
 *   - No captured output    → output is always ""
 *   - Completion detected via `tmux has-session` polling (2s interval)
 *   - Kill via `tmux kill-session`
 *   - User can `tmux attach -t {sessionName}` for full visibility
 *
 * Temp files are cleaned up on all exit paths:
 *   - Normal completion (session ends, polling detects it)
 *   - Kill (explicit kill-session call)
 *   - TMUX not installed (throws with actionable message)
 *   - Session creation failure (throws after cleanup)
 *
 * Parity with spawnAgent():
 *   - Return shape:   extended — { promise, kill, sidecarPath, exitSummaryPath }
 *     (promise and kill are drop-in compatible; sidecarPath and exitSummaryPath
 *     are additions for RPC telemetry consumption in Steps 2/3)
 *   - Promise result: identical fields — { output, exitCode, elapsed, killed }
 *   - Kill semantics: sets killed=true, terminates session, cleans temp files
 *   - Elapsed calc:   Date.now() - startTime (same pattern)
 *   - Cleanup:        synchronous on all paths (more deterministic than spawnAgent's 1s setTimeout)
 *   - output:         always "" (no JSON stream in TMUX mode)
 *   - exitCode:       0 on normal completion, 1 on poll error (TMUX doesn't forward exit codes)
 *
 * RPC Wrapper Integration (TP-026):
 * Instead of spawning `pi -p` directly, this function now spawns `rpc-wrapper.mjs`
 * which runs pi in RPC mode and produces:
 *   - Sidecar JSONL file with real-time telemetry (tokens, cost, tool calls, retries)
 *   - Exit summary JSON with structured exit data for classification
 *
 * The telemetry file paths are returned alongside the promise/kill handles so that
 * Steps 2 (sidecar tailing) and 3 (exit diagnostic) can read them.
 *
 * @param opts.sessionName  — TMUX session name (e.g., "orch-lane-1-worker")
 * @param opts.cwd          — Working directory for the TMUX session
 * @param opts.systemPrompt — System prompt content (written to temp file)
 * @param opts.prompt       — User prompt content (written to temp file)
 * @param opts.model        — Model identifier (e.g., "anthropic/claude-sonnet-4-20250514")
 * @param opts.tools        — Comma-separated tool list
 * @param opts.thinking     — Thinking mode ("off", "on", etc.)
 * @param opts.taskId       — Optional task ID for telemetry filename enrichment (e.g., "TP-026")
 */
function spawnAgentTmux(opts: {
	sessionName: string;
	cwd: string;
	systemPrompt: string;
	prompt: string;
	model: string;
	tools: string;
	thinking: string;
	taskId?: string;
	/** Optional extension paths to load in the spawned pi session (via rpc-wrapper --extensions).
	 *  When provided, --no-extensions is NOT passed to pi (would conflict). */
	extensions?: string[];
	/** Optional extra environment variables to set in the spawned tmux session.
	 *  Injected as `KEY=VALUE` prefixes in the shell command. @since TP-057 */
	env?: Record<string, string>;
	/** Called on each poll tick with accumulated telemetry from the sidecar JSONL.
	 *  Enables the tmux poll loop to update TaskState (tokens, cost, context%, tools, retries)
	 *  with the same signals that subprocess mode gets from onTokenUpdate/onContextPct/onToolCall. */
	onTelemetry?: (delta: SidecarTelemetryDelta) => void;
}): {
	promise: Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>;
	kill: () => void;
	sidecarPath: string;
	exitSummaryPath: string;
} {

	// ── Preflight: verify tmux is available ──────────────────────────
	const tmuxCheck = spawnSync("tmux", ["-V"], { shell: true });
	if (tmuxCheck.status !== 0 && tmuxCheck.status !== null) {
		throw new Error(
			"tmux is not installed or not in PATH. " +
			"Install tmux to use TMUX spawn mode, or set TASK_RUNNER_SPAWN_MODE=subprocess. " +
			`(tmux -V exited with code ${tmuxCheck.status})`
		);
	}

	// ── Generate telemetry file paths ───────────────────────────────
	// Naming contract from resilience roadmap:
	//   .pi/telemetry/{opId}-{batchId}-{repoId}[-{taskId}][-lane-{N}]-{role}.{ext}
	//
	// In standalone /task mode (no orchestrator):
	//   opId    → TASKPLANE_OPERATOR_ID env, or OS username, or "op"
	//   batchId → timestamp (no batch concept in standalone mode)
	//   repoId  → "default" (single-repo mode)
	//   taskId  → from opts.taskId when provided (e.g., "tp-026"), omitted if absent
	//   lane    → omitted (no lanes)
	//   role    → derived from sessionName suffix (worker/reviewer)
	//
	// getSidecarDir() respects ORCH_SIDECAR_DIR for workspace mode.
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

	// Extract role (worker/reviewer) from sessionName, and optional lane component
	// sessionName patterns: "task-worker", "task-reviewer", "orch-lane-1-worker"
	const role = opts.sessionName.endsWith("-reviewer") ? "reviewer" : "worker";
	const laneMatch = opts.sessionName.match(/lane-(\d+)/);
	const laneSuffix = laneMatch ? `-lane-${laneMatch[1]}` : "";

	// Include taskId when available — sanitize to filesystem-safe characters.
	// Pattern: {opId}-{batchId}-{repoId}[-{taskId}][-lane-{N}]-{role}
	const taskIdSegment = opts.taskId
		? `-${opts.taskId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30)}`
		: "";
	const telemetryBasename = `${opId}-${batchId}-${repoId}${taskIdSegment}${laneSuffix}-${role}`;
	const telemetryDir = join(getSidecarDir(), "telemetry");
	if (!existsSync(telemetryDir)) mkdirSync(telemetryDir, { recursive: true });
	const sidecarPath = join(telemetryDir, `${telemetryBasename}.jsonl`);
	const exitSummaryPath = join(telemetryDir, `${telemetryBasename}-exit.json`);

	// ── Write prompts to temp files ─────────────────────────────────
	// Same pattern as spawnAgent() — avoids shell escaping issues with
	// backticks, quotes, and special characters in markdown content.
	const id = `${telemetryTs}-${Math.random().toString(36).slice(2, 8)}`;
	const sysTmpFile = join(tmpdir(), `pi-task-sys-${id}.txt`);
	const promptTmpFile = join(tmpdir(), `pi-task-prompt-${id}.txt`);
	writeFileSync(sysTmpFile, opts.systemPrompt);
	writeFileSync(promptTmpFile, opts.prompt);

	const cleanupTmp = () => {
		try { unlinkSync(sysTmpFile); } catch {}
		try { unlinkSync(promptTmpFile); } catch {}
	};

	// ── Build RPC Wrapper command ────────────────────────────────────
	// Spawns `node rpc-wrapper.mjs` instead of `pi -p`. The wrapper runs
	// pi in RPC mode, captures telemetry to the sidecar JSONL, and writes
	// a structured exit summary JSON on process exit.
	//
	// Shell quoting: use quoteArg() for all path arguments — same quoting
	// guarantees as the previous `pi -p` command since both execute as a
	// single shell string via tmux new-session.
	const quoteArg = (s: string): string => {
		// If the arg contains spaces, quotes, or shell metacharacters, wrap in single quotes.
		// Inside single quotes, escape existing single quotes as '\'' (end quote, escaped quote, restart quote).
		if (/[\s"'`$\\!&|;()<>{}#*?~]/.test(s)) {
			return `'${s.replace(/'/g, "'\\''")}'`;
		}
		return s;
	};

	// Resolve rpc-wrapper.mjs path from the installed package
	const rpcWrapperPath = resolveRpcWrapperPath();

	const wrapperArgs = [
		"node", quoteArg(rpcWrapperPath),
		"--sidecar-path", quoteArg(sidecarPath),
		"--exit-summary-path", quoteArg(exitSummaryPath),
		"--model", quoteArg(opts.model),
		"--system-prompt-file", quoteArg(sysTmpFile),
		"--prompt-file", quoteArg(promptTmpFile),
		"--tools", quoteArg(opts.tools),
	];
	// When extensions are provided, pass them to rpc-wrapper (which translates to `pi -e`)
	// and do NOT pass --no-extensions (would conflict).
	if (opts.extensions && opts.extensions.length > 0) {
		wrapperArgs.push("--extensions", quoteArg(opts.extensions.join(",")));
	}
	// Passthrough pi args: flags forwarded to the underlying pi --mode rpc process.
	// Note: --no-session is NOT passed here — rpc-wrapper.mjs already injects it.
	wrapperArgs.push("--");
	wrapperArgs.push("--thinking", quoteArg(opts.thinking));
	if (!opts.extensions || opts.extensions.length === 0) {
		wrapperArgs.push("--no-extensions");
	}
	wrapperArgs.push("--no-skills");
	const wrapperCommand = wrapperArgs.join(" ");

	// ── Handle stale session ─────────────────────────────────────────
	// Session names are fixed per role (e.g., "orch-lane-1-worker").
	// If a stale session from a previous iteration exists, kill it first.
	const staleCheck = spawnSync("tmux", ["has-session", "-t", opts.sessionName]);
	if (staleCheck.status === 0) {
		console.error(`[task-runner] tmux: killing stale session '${opts.sessionName}'`);
		spawnSync("tmux", ["kill-session", "-t", opts.sessionName]);
	}

	// ── Create TMUX session ─────────────────────────────────────────
	// Use `cd <path> && TERM=xterm-256color <cmd>` wrapper instead of tmux `-c`
	// because `-c` with Windows paths silently fails in MSYS2/Git Bash tmux.
	// Pi's ink/react TUI hangs with TERM=tmux-256color (tmux default), so we
	// force xterm-256color.
	const tmuxCwd = opts.cwd.replace(/^([A-Za-z]):\\/, (_, d: string) => `/${d.toLowerCase()}/`).replace(/\\/g, "/");
	// Build extra env var prefix (TP-057: e.g., REVIEWER_SIGNAL_DIR for persistent reviewer)
	const extraEnv = opts.env
		? Object.entries(opts.env).map(([k, v]) => `${k}=${quoteArg(v)}`).join(" ") + " "
		: "";
	const wrappedCommand = `cd ${quoteArg(tmuxCwd)} && ${extraEnv}TERM=xterm-256color ${wrapperCommand}`;
	const createResult = spawnSync("tmux", [
		"new-session", "-d",
		"-s", opts.sessionName,
		wrappedCommand,
	]);

	if (createResult.status !== 0) {
		cleanupTmp();
		const stderr = createResult.stderr?.toString().trim() || "unknown error";
		console.error(`[task-runner] tmux: session '${opts.sessionName}' creation failed: ${stderr}`);
		throw new Error(
			`Failed to create TMUX session '${opts.sessionName}': ${stderr}. ` +
			`Verify tmux is running and the session name is valid.`
		);
	}

	console.error(`[task-runner] tmux: session '${opts.sessionName}' created (cwd: ${opts.cwd})`);


	// ── Poll until session ends ─────────────────────────────────────
	let killed = false;
	const startTime = Date.now();
	const tailState = createSidecarTailState();

	const promise = (async (): Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }> => {
		try {
			while (true) {
				await new Promise(r => setTimeout(r, 2000));

				// Tail sidecar JSONL for telemetry updates on each tick
				if (opts.onTelemetry) {
					const delta = tailSidecarJsonl(sidecarPath, tailState);
					// Call back whenever events were parsed (including retry state transitions)
					if (delta.hadEvents) {
						opts.onTelemetry(delta);
					}
				}

				const result = spawnSync("tmux", ["has-session", "-t", opts.sessionName]);
				if (result.status !== 0) {
					// Session no longer exists — Pi exited, TMUX closed
					// Final tail to catch any events written since last tick
					if (opts.onTelemetry) {
						const finalDelta = tailSidecarJsonl(sidecarPath, tailState);
						if (finalDelta.hadEvents) {
							opts.onTelemetry(finalDelta);
						}
					}
					break;
				}
			}
		} catch (pollErr: any) {
			// Polling failure — clean up and report
			console.error(`[task-runner] tmux: polling error for '${opts.sessionName}': ${pollErr?.message || pollErr}`);
			cleanupTmp();
			console.error(`[task-runner] tmux: cleanup done for '${opts.sessionName}' (poll-fail)`);
			return {
				output: `Polling error: ${pollErr?.message || pollErr}`,
				exitCode: 1,
				elapsed: Date.now() - startTime,
				killed: false,
			};
		}

		// Normal completion — clean up temp files
		const elapsed = Date.now() - startTime;
		console.error(`[task-runner] tmux: session '${opts.sessionName}' ended after ${Math.round(elapsed / 1000)}s${killed ? " (killed)" : ""}`);
		cleanupTmp();
		console.error(`[task-runner] tmux: cleanup done for '${opts.sessionName}'`);
		return {
			output: "",      // No captured output in TMUX mode
			exitCode: 0,     // TMUX session exit is best-effort success
			elapsed,
			killed,
		};
	})();

	// ── Kill function ───────────────────────────────────────────────
	const kill = () => {
		killed = true;
		console.error(`[task-runner] tmux: killing session '${opts.sessionName}'`);
		const killResult = spawnSync("tmux", ["kill-session", "-t", opts.sessionName]);
		if (killResult.status !== 0) {
			// Session may have already exited — not an error
			console.error(`[task-runner] tmux: session '${opts.sessionName}' already exited (kill was no-op)`);
		}
		cleanupTmp();
		console.error(`[task-runner] tmux: cleanup done for '${opts.sessionName}' (killed)`);
	};

	return { promise, kill, sidecarPath, exitSummaryPath };
}

// ── Display Helpers ──────────────────────────────────────────────────

function displayName(name: string): string {
	return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
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

	/**
	 * Reset reviewer telemetry fields on state to idle/zero.
	 * Called after a review completes to clear dashboard metrics.
	 */
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

	/**
	 * TP-057: Remove stale signal and shutdown files from .reviews/ directory.
	 * Called before spawning a new persistent reviewer to prevent the reviewer
	 * from consuming old signals or immediately seeing a stale shutdown marker.
	 */
	function cleanStaleReviewerSignals(reviewsDir: string): void {
		try {
			const files = readdirSync(reviewsDir);
			for (const f of files) {
				if (f.startsWith(REVIEWER_SIGNAL_PREFIX) || f === REVIEWER_SHUTDOWN_SIGNAL) {
					try { unlinkSync(join(reviewsDir, f)); } catch {}
				}
			}
		} catch {
			// Directory may not exist yet — not an error
		}
	}

	/**
	 * TP-057: Shut down the persistent reviewer session cleanly.
	 * Writes shutdown signal, waits for clean exit within grace period,
	 * then force-kills the session if still alive.
	 *
	 * Called from all executeTask exit paths (success, pause, error, stall)
	 * to prevent orphan tmux sessions.
	 *
	 * @param reason - Why the reviewer is being shut down (for logging)
	 */
	async function shutdownPersistentReviewer(reason: string): Promise<void> {
		if (!state.persistentReviewerSession) return;

		const sessionName = state.persistentReviewerSession;
		console.error(`[task-runner] persistent reviewer: shutting down (${reason})`);

		// Write shutdown signal so the reviewer exits cleanly
		if (state.task) {
			const reviewsDir = join(state.task.taskFolder, ".reviews");
			const shutdownPath = join(reviewsDir, REVIEWER_SHUTDOWN_SIGNAL);
			try {
				if (!existsSync(reviewsDir)) mkdirSync(reviewsDir, { recursive: true });
				writeFileSync(shutdownPath, "shutdown");
			} catch (err: any) {
				console.error(`[task-runner] persistent reviewer: failed to write shutdown signal: ${err?.message}`);
			}
		}

		// Poll for session death within grace period
		const graceStart = Date.now();
		while (Date.now() - graceStart < REVIEWER_SHUTDOWN_GRACE_MS) {
			const alive = spawnSync("tmux", ["has-session", "-t", sessionName]);
			if (alive.status !== 0) break;
			await new Promise(r => setTimeout(r, 1000));
		}

		// Force kill if still alive after grace period
		const finalCheck = spawnSync("tmux", ["has-session", "-t", sessionName]);
		if (finalCheck.status === 0) {
			console.error(`[task-runner] persistent reviewer: killing session after grace period`);
			spawnSync("tmux", ["kill-session", "-t", sessionName]);
		}

		// Reset state
		state.persistentReviewerSession = null;
		state.persistentReviewerKill = null;
		state.persistentReviewerSignalNum = 0;
		clearReviewerState();
		writeLaneState(state);

		if (state.task) {
			const statusPath = join(state.task.taskFolder, "STATUS.md");
			logExecution(statusPath, "Persistent reviewer", `Shutdown complete (${reason})`);
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
				"For code reviews: before starting a step, capture the current HEAD commit with `git rev-parse HEAD` and pass it as the `baseline` parameter. This lets the reviewer see only that step's changes.",
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
					description: "Git commit SHA to use as the diff baseline for code reviews. " +
						"Capture HEAD before starting a step and pass it here so the reviewer " +
						"sees only that step's changes. If omitted, the reviewer sees the full diff against HEAD.",
				})),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const { step: stepNum, type: reviewType, baseline } = params;

				if (!state.task || !state.config) {
					return {
						content: [{ type: "text" as const, text: "UNAVAILABLE — no task loaded" }],
						details: undefined,
					};
				}

				const task = state.task;
				const config = state.config;
				const statusPath = join(task.taskFolder, "STATUS.md");
				const reviewsDir = join(task.taskFolder, ".reviews");
				if (!existsSync(reviewsDir)) mkdirSync(reviewsDir, { recursive: true });

				// Low-risk step check (safety net — worker template also skips)
				if (isLowRiskStep(stepNum, task.steps.length)) {
					const label = stepNum === 0 ? "Preflight" : "final step";
					logExecution(statusPath, `Skip ${reviewType} review`, `Step ${stepNum} (${label}) — low-risk`);
					return {
						content: [{ type: "text" as const, text: `APPROVE — Step ${stepNum} is low-risk (${label}), review skipped` }],
						details: undefined,
					};
				}

				// Increment review counter
				state.reviewCounter++;
				const num = String(state.reviewCounter).padStart(3, "0");
				const requestPath = join(reviewsDir, `request-R${num}.md`);
				const outputPath = join(reviewsDir, `R${num}-${reviewType}-step${stepNum}.md`);

				// Resolve step baseline commit for code reviews.
				const stepBaselineCommit: string | undefined =
					reviewType === "code" ? (baseline || undefined) : undefined;

				// Find step info for the name
				const stepInfo = task.steps.find(s => s.number === stepNum);
				const stepName = stepInfo?.name || `Step ${stepNum}`;

				// Generate review request
				const request = generateReviewRequest(
					reviewType, stepNum, stepName, task, config, outputPath, stepBaselineCommit,
				);
				writeFileSync(requestPath, request);

				// Load reviewer agent definition
				const reviewerDef = loadAgentDef(ctx.cwd, "task-reviewer");
				// TP-055: model fallback — use session model when TASKPLANE_MODEL_FALLBACK=1
				const reviewerModelFallback = process.env.TASKPLANE_MODEL_FALLBACK === "1";
				const reviewerModel = reviewerModelFallback
					? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514")
					: (config.reviewer.model
						|| reviewerDef?.model
						|| (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514"));
				const reviewerPrompt = reviewerDef?.systemPrompt
					|| "You are a code reviewer. Read the request and write your review to the specified output file.";
				const systemPrompt = reviewerPrompt + "\n\n" + buildProjectContext(config, task.taskFolder);

				// Update state for dashboard visibility
				const sessionName = `${getTmuxPrefix()}-reviewer`;
				state.reviewerStatus = "running";
				state.reviewerType = `${reviewType} review`;
				state.reviewerStep = stepNum;
				state.reviewerSessionName = sessionName;
				state.reviewerElapsed = 0;
				state.reviewerLastTool = "";
				state.reviewerToolCount = 0;
				// Don't reset cumulative token counts for persistent reviewer — they accumulate
				if (!state.persistentReviewerSession) {
					state.reviewerInputTokens = 0;
					state.reviewerOutputTokens = 0;
					state.reviewerCacheReadTokens = 0;
					state.reviewerCacheWriteTokens = 0;
					state.reviewerCostUsd = 0;
					state.reviewerContextPct = 0;
				}
				updateWidgets();

				const startTime = Date.now();
				state.reviewerTimer = setInterval(() => {
					state.reviewerElapsed = Date.now() - startTime;
					updateWidgets();
				}, 1000);

				// Resolve context window for reviewer context% calculation
				const { contextWindow } = resolveContextWindow(config, ctx);

				// ── TP-057: Persistent Reviewer Session ─────────────────
				// On the first review_step call, spawn a persistent reviewer
				// that stays alive via the wait_for_review tool. On subsequent
				// calls, reuse the existing session by writing signal files.
				// Fall back to fresh-spawn if the persistent session dies.

				/**
				 * Check if the persistent reviewer tmux session is still alive.
				 */
				function isPersistentReviewerAlive(): boolean {
					if (!state.persistentReviewerSession) return false;
					const result = spawnSync("tmux", ["has-session", "-t", state.persistentReviewerSession]);
					return result.status === 0;
				}

				/**
				 * Spawn a persistent reviewer session with the reviewer-extension
				 * loaded, so the reviewer can use wait_for_review to receive requests.
				 */
				function spawnPersistentReviewer(): void {
					const reviewerExtPath = resolveReviewerExtensionPath();
					if (!reviewerExtPath) {
						throw new Error("Cannot find reviewer-extension.ts. Ensure taskplane is installed correctly.");
					}

					// Clean stale signal/shutdown files before spawning
					cleanStaleReviewerSignals(reviewsDir);

					// Initial prompt tells the reviewer to call wait_for_review
					const initialPrompt =
						"You are a persistent reviewer for this task. " +
						"Use the `wait_for_review` tool now to receive your first review request. " +
						"IMPORTANT: `wait_for_review` is a REGISTERED EXTENSION TOOL — call it " +
						"the same way you call `read`, `write`, `edit`, or `grep`. " +
						"Do NOT run it via `bash` or any shell command. " +
						"After writing each review, use `wait_for_review` again for the next one.";

					const spawned = spawnAgentTmux({
						sessionName,
						cwd: ctx.cwd,
						systemPrompt,
						prompt: initialPrompt,
						model: reviewerModel,
						tools: config.reviewer.tools || reviewerDef?.tools || "read,write,bash,grep,find,ls",
						thinking: config.reviewer.thinking || "on",
						taskId: task.taskId,
						extensions: [reviewerExtPath],
						env: { REVIEWER_SIGNAL_DIR: reviewsDir },
						onTelemetry: (delta) => {
							// Accumulate tokens and cost
							state.reviewerInputTokens += delta.inputTokens;
							state.reviewerOutputTokens += delta.outputTokens;
							state.reviewerCacheReadTokens += delta.cacheReadTokens;
							state.reviewerCacheWriteTokens += delta.cacheWriteTokens;
							state.reviewerCostUsd += delta.cost;

							// Tool tracking
							state.reviewerToolCount += delta.toolCalls;
							if (delta.lastTool) {
								state.reviewerLastTool = delta.lastTool;
							}

							// Context % — prefer authoritative contextUsage (pi ≥ 0.63.0)
							if (delta.contextUsage) {
								state.reviewerContextPct = delta.contextUsage.percentUsed;
							} else if (delta.latestTotalTokens > 0 && contextWindow > 0) {
								state.reviewerContextPct = (delta.latestTotalTokens / contextWindow) * 100;
							}

							writeLaneState(state);
							updateWidgets();
						},
					});

					// Store persistent session state
					state.persistentReviewerSession = sessionName;
					state.persistentReviewerKill = spawned.kill;
					state.persistentReviewerSignalNum = 0;
					state.reviewerProc = { kill: spawned.kill };

					// Don't await spawned.promise — the session stays alive across reviews.
					// Handle session death via isPersistentReviewerAlive() checks.
					spawned.promise.then(() => {
						// Session ended (reviewer exited or was killed)
						console.error(`[task-runner] persistent reviewer session '${sessionName}' ended`);
					}).catch((err: any) => {
						console.error(`[task-runner] persistent reviewer session error: ${err?.message || err}`);
					});
				}

				/**
				 * Write signal file to notify the persistent reviewer of a new request.
				 * Returns the signal number used.
				 */
				function signalPersistentReviewer(): number {
					state.persistentReviewerSignalNum++;
					const sigNum = String(state.persistentReviewerSignalNum).padStart(3, "0");
					const signalPath = join(reviewsDir, `${REVIEWER_SIGNAL_PREFIX}${sigNum}`);
					// Write the request filename so the reviewer can find it
					// (signal num and review counter may diverge after respawns)
					writeFileSync(signalPath, `request-R${num}.md`);
					return state.persistentReviewerSignalNum;
				}

				/**
				 * Poll for the verdict file to appear (written by the reviewer).
				 * Same pattern as the original review_step handler.
				 *
				 * Early-exit detection (TP-068): If the reviewer exits within 30s
				 * of spawn without producing a verdict, it likely failed to use the
				 * wait_for_review tool correctly (e.g., called it via bash). This
				 * triggers a faster fallback instead of waiting 30 minutes.
				 */
				async function pollForVerdict(spawnTime?: number): Promise<string> {
					const EARLY_EXIT_THRESHOLD_MS = 30_000; // 30 seconds
					const verdictTimeout = 30 * 60 * 1000; // 30 minutes
					const pollStart = Date.now();
					while (Date.now() - pollStart < verdictTimeout) {
						if (existsSync(outputPath)) {
							return readFileSync(outputPath, "utf-8");
						}
						// Also check if persistent reviewer died while we're waiting
						if (state.persistentReviewerSession && !isPersistentReviewerAlive()) {
							// TP-068: Detect early exit as tool compatibility failure
							if (spawnTime && (Date.now() - spawnTime) < EARLY_EXIT_THRESHOLD_MS) {
								throw new Error(
									"Persistent reviewer exited within 30s of spawn without producing a verdict — " +
									"wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool)"
								);
							}
							throw new Error("Persistent reviewer session died while waiting for verdict");
						}
						await new Promise(r => setTimeout(r, 2000));
					}
					throw new Error("Reviewer verdict timeout — no output file after 30 minutes");
				}

				try {
					// ── Persistent reviewer: spawn or reuse ─────────────
					const needsSpawn = !state.persistentReviewerSession || !isPersistentReviewerAlive();

					if (needsSpawn && state.persistentReviewerSession) {
						// Session was previously active but died — log fallback
						console.error(`[task-runner] persistent reviewer session dead — respawning`);
						logExecution(statusPath, `Reviewer R${num}`,
							`persistent reviewer dead — respawning for ${reviewType} review`);
						state.persistentReviewerSession = null;
						state.persistentReviewerKill = null;
						state.persistentReviewerSignalNum = 0;
					}

					// Track spawn time for early-exit detection (TP-068)
					let spawnTime: number | undefined;
					if (needsSpawn) {
						spawnTime = Date.now();
						spawnPersistentReviewer();
						// Give the reviewer a moment to start and call wait_for_review
						await new Promise(r => setTimeout(r, 5000));
					}

					// Signal the reviewer with the new request
					signalPersistentReviewer();

					// Poll for the verdict file (pass spawnTime for early-exit detection)
					const reviewContent = await pollForVerdict(spawnTime);

					// Stop the per-review timer
					if (state.reviewerTimer) clearInterval(state.reviewerTimer);
					state.reviewerElapsed = Date.now() - startTime;
					state.reviewerStatus = "done";
					writeLaneState(state);
					updateWidgets();

					// Extract verdict and build result
					const { resultText } = processReviewVerdict(
						reviewContent, statusPath, num, reviewType, stepNum, state.reviewCounter,
					);

					// Set reviewer to idle (NOT clear — persistent session stays alive)
					state.reviewerStatus = "idle";
					state.reviewerType = "";
					state.reviewerStep = 0;
					if (state.reviewerTimer) clearInterval(state.reviewerTimer);
					state.reviewerTimer = null;
					writeLaneState(state);
					updateWidgets();

					return {
						content: [{ type: "text" as const, text: resultText }],
						details: undefined,
					};
				} catch (err: any) {
					// ── Fallback: kill persistent session, try fresh spawn ──
					console.error(`[task-runner] persistent reviewer error: ${err?.message || err}`);
					logExecution(statusPath, `Reviewer R${num}`,
						`persistent reviewer failed — falling back to fresh spawn: ${err?.message || err}`);

					// Kill the dead/broken persistent session
					if (state.persistentReviewerKill) {
						try { state.persistentReviewerKill(); } catch {}
					}
					state.persistentReviewerSession = null;
					state.persistentReviewerKill = null;
					state.persistentReviewerSignalNum = 0;

					// ── Fresh spawn fallback (original behavior) ────────
					try {
						const promptContent = readFileSync(requestPath, "utf-8");
						const spawned = spawnAgentTmux({
							sessionName,
							cwd: ctx.cwd,
							systemPrompt,
							prompt: promptContent,
							model: reviewerModel,
							tools: config.reviewer.tools || reviewerDef?.tools || "read,write,bash,grep,find,ls",
							thinking: config.reviewer.thinking || "on",
							taskId: task.taskId,
							onTelemetry: (delta) => {
								state.reviewerInputTokens += delta.inputTokens;
								state.reviewerOutputTokens += delta.outputTokens;
								state.reviewerCacheReadTokens += delta.cacheReadTokens;
								state.reviewerCacheWriteTokens += delta.cacheWriteTokens;
								state.reviewerCostUsd += delta.cost;
								state.reviewerToolCount += delta.toolCalls;
								if (delta.lastTool) state.reviewerLastTool = delta.lastTool;
								// Context % — prefer authoritative contextUsage (pi ≥ 0.63.0)
								if (delta.contextUsage) {
									state.reviewerContextPct = delta.contextUsage.percentUsed;
								} else if (delta.latestTotalTokens > 0 && contextWindow > 0) {
									state.reviewerContextPct = (delta.latestTotalTokens / contextWindow) * 100;
								}
								writeLaneState(state);
								updateWidgets();
							},
						});

						state.reviewerProc = { kill: spawned.kill };
						const result = await spawned.promise;

						clearInterval(state.reviewerTimer);
						state.reviewerElapsed = Date.now() - startTime;
						state.reviewerStatus = result.exitCode === 0 ? "done" : "error";
						state.reviewerProc = null;
						writeLaneState(state);
						updateWidgets();

						// Extract verdict from fallback review
						const fallbackContent = existsSync(outputPath)
							? readFileSync(outputPath, "utf-8")
							: null;
						const { resultText } = processReviewVerdict(
							fallbackContent, statusPath, num, reviewType, stepNum, state.reviewCounter, "fallback",
						);

						clearReviewerState();
						writeLaneState(state);
						updateWidgets();

						return {
							content: [{ type: "text" as const, text: resultText }],
							details: undefined,
						};
					} catch (fallbackErr: any) {
						// Both persistent and fallback failed — TP-068: clear logging
						clearInterval(state.reviewerTimer);
						clearReviewerState();
						state.reviewerStatus = "error";
						writeLaneState(state);
						updateWidgets();

						const skipMsg = `⚠️ Reviews skipped for Step ${stepNum} — reviewer model could not process ${reviewType} review request. Both persistent and fallback modes failed.`;
						console.error(`[task-runner] ${skipMsg}`);
						logExecution(statusPath, `Reviewer R${num}`,
							`${skipMsg} Error: ${fallbackErr?.message || fallbackErr}`);

						// TP-068: Ensure shutdown signal is written even on double failure
						try {
							const shutdownPath = join(reviewsDir, REVIEWER_SHUTDOWN_SIGNAL);
							if (!existsSync(reviewsDir)) mkdirSync(reviewsDir, { recursive: true });
							writeFileSync(shutdownPath, "shutdown");
						} catch {}

						return {
							content: [{ type: "text" as const, text: `UNAVAILABLE — ${skipMsg}` }],
							details: undefined,
						};
					}
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
		logExecution(statusPath, "Task started", "Extension-driven execution");

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
					updateStepStatus(statusPath, step.number, "in-progress");
					logExecution(statusPath, `Step ${step.number} started`, step.name);
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
				logExecution(statusPath, "Paused", `User paused at iteration ${iter + 1}`);
				ctx.ui.notify(`Task paused at iteration ${iter + 1}`, "info");
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

			await runWorker(remainingSteps, ctx);

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
				logExecution(statusPath, "No progress", `Iteration ${iter + 1}: 0 new checkboxes (${noProgressCount}/${config.context.no_progress_limit} stall limit)`);
				ctx.ui.notify(`⚠️ No progress in iteration ${iter + 1} (${noProgressCount}/${config.context.no_progress_limit})`, "warning");
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

			// Log iteration summary with progress delta and completed steps
			const completedNames = newlyCompleted.map(s => `Step ${s.number}`).join(", ");
			if (newlyCompleted.length > 0) {
				logExecution(statusPath, `Iteration ${iter + 1} summary`, `+${progressDelta} checkboxes, completed: ${completedNames}`);
				ctx.ui.notify(`Iteration ${iter + 1}: completed ${completedNames} (+${progressDelta} checkboxes)`, "info");
			} else if (progressDelta > 0) {
				logExecution(statusPath, `Iteration ${iter + 1} summary`, `+${progressDelta} checkboxes, no steps fully completed`);
				ctx.ui.notify(`Iteration ${iter + 1}: +${progressDelta} checkboxes (no steps fully completed)`, "info");
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
			// ── Quality Gate Disabled (default) ──────────────────────
			// Unchanged behavior — create .DONE immediately.
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

	async function runWorker(remainingSteps: StepInfo[], ctx: ExtensionContext): Promise<void> {
		if (!state.task || !state.config) return;

		const task = state.task;
		const config = state.config;
		const statusPath = join(task.taskFolder, "STATUS.md");
		const wrapUpFile = join(task.taskFolder, ".task-wrap-up");
		const legacyWrapUpFile = join(task.taskFolder, ".wiggum-wrap-up");

		const clearWrapUpSignals = () => {
			if (existsSync(wrapUpFile)) try { unlinkSync(wrapUpFile); } catch {}
			if (existsSync(legacyWrapUpFile)) try { unlinkSync(legacyWrapUpFile); } catch {}
		};

		const writeWrapUpSignal = (reason: string) => {
			const msg = `${reason} at ${new Date().toISOString()}`;
			if (!existsSync(wrapUpFile)) writeFileSync(wrapUpFile, msg);
			// Backward compatibility: write legacy signal too until all workers migrate.
			if (!existsSync(legacyWrapUpFile)) writeFileSync(legacyWrapUpFile, msg);
		};

		clearWrapUpSignals();

		const workerDef = loadAgentDef(ctx.cwd, "task-worker");
		const basePrompt = workerDef?.systemPrompt || "You are a task execution agent. Read STATUS.md first, find unchecked items, work on them, checkpoint after each.";
		const systemPrompt = basePrompt + "\n\n" + buildProjectContext(config, task.taskFolder);

		// TP-055: When TASKPLANE_MODEL_FALLBACK=1 is set, skip configured model
		// and fall back to the session model. This is set by the orchestrator's
		// model fallback retry when the configured model becomes unavailable.
		const modelFallbackActive = process.env.TASKPLANE_MODEL_FALLBACK === "1";
		const model = modelFallbackActive
			? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514")
			: (config.worker.model
				|| workerDef?.model
				|| (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514"));

		const contextDocsList = task.contextDocs.length > 0
			? "\n\nContext docs to read if needed:\n" + task.contextDocs.map(d => `- ${d}`).join("\n")
			: "";

		// When running under the parallel orchestrator, workers must NOT
		// archive or move the task folder — the orchestrator polls for .DONE
		// at the original path and handles post-merge archival itself.
		const archiveSuppression = isOrchestratedMode()
			? "\n\n⚠️ ORCHESTRATED RUN: Do NOT archive or move the task folder. " +
			  "Do NOT rename, relocate, or reorganize the task folder path. " +
			  "The orchestrator handles post-merge archival. " +
			  "Just create the .DONE file in the task folder when complete."
			: "";

		// Build step listing for the worker prompt — show ALL steps with status
		const remainingSet = new Set(remainingSteps.map(s => s.number));
		const stepListing = task.steps.map(s =>
			remainingSet.has(s.number)
				? `  - Step ${s.number}: ${s.name}`
				: `  - Step ${s.number}: ${s.name}  [already complete — skip]`
		).join("\n");

		// TP-073: Build nudge for subsequent iterations (iter > 0)
		// When the worker exited without completing all steps, the next iteration
		// gets an explicit nudge listing completed/remaining steps and a warning
		// not to exit prematurely again.
		let iterationNudge = "";
		if (state.totalIterations > 1 && remainingSteps.length > 0) {
			const completedSteps = task.steps.filter(s => !remainingSet.has(s.number));
			const completedList = completedSteps.length > 0
				? completedSteps.map(s => `Step ${s.number}: ${s.name}`).join(", ")
				: "(none)";
			const remainingList = remainingSteps.map(s => `Step ${s.number}: ${s.name}`).join(", ");
			iterationNudge = [
				``,
				`IMPORTANT: You exited on your previous iteration without completing all steps.`,
				`Do NOT repeat this — you must complete all remaining steps before stopping.`,
				``,
				`Completed steps (do not redo): ${completedList}`,
				`Remaining steps (focus here): ${remainingList}`,
				``,
				`Your final action MUST be a tool call (update STATUS.md). Do NOT produce a`,
				`text-only response — that will terminate your session prematurely.`,
				``,
			].join("\n");
		}

		const prompt = [
			`Execute all remaining steps for task ${task.taskId}.`,
			``,
			`Task: ${task.taskId} — ${task.taskName}`,
			`Task folder: ${task.taskFolder}/`,
			`PROMPT: ${task.promptPath}`,
			`STATUS: ${statusPath}`,
			``,
			`This is iteration ${state.totalIterations}.`,
			`Read STATUS.md FIRST to find where you left off.`,
			iterationNudge,
			`Steps:`,
			stepListing,
			``,
			`Work through these steps in order. For each step:`,
			`1. Read STATUS.md to find unchecked items for that step`,
			`2. Complete all items for the step`,
			`3. Update STATUS.md step status to "complete"`,
			`4. Commit your changes: feat(${task.taskId}): complete Step N — description`,
			`5. Check for wrap-up signal files before starting the next step`,
			`6. Proceed to the next incomplete step`,
			``,
			`Wrap-up signal files: ${wrapUpFile} (primary), ${legacyWrapUpFile} (legacy)`,
			`Check for either file after each checkpoint. If one exists, stop.`,
			archiveSuppression,
			contextDocsList,
		].join("\n");

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

		const spawnMode = getSpawnMode(config);
		let promise: Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>;
		let kill: () => void;
		let wallClockWarnTimer: ReturnType<typeof setTimeout> | null = null;
		let wallClockKillTimer: ReturnType<typeof setTimeout> | null = null;
		// Track why the session was killed for exit classification.
		// "timer" = wall-clock timeout, "context" = context % limit, "user" = manual kill.
		let killReason: "timer" | "context" | "user" | null = null;
		// Exit summary path — set only in tmux mode (rpc-wrapper produces this file).
		let exitSummaryPath: string | null = null;

		// Resolve context window: explicit config → model registry → 200K fallback
		const { contextWindow, source: contextWindowSource } = resolveContextWindow(config, ctx);
		const warnPct = config.context.warn_percent;
		const killPct = config.context.kill_percent;
		console.error(`[task-runner] worker context window: ${contextWindow} (${contextWindowSource})`);

		if (spawnMode === "tmux") {
			// ── TMUX mode ────────────────────────────────────────
			// Sidecar JSONL provides telemetry parity: tokens, cost, context%,
			// tool calls, and retry events — same signals as subprocess mode.
			// Kill via wall-clock timeout (context-% wrap-up also available via sidecar).
			const sessionName = `${getTmuxPrefix()}-worker`;

			const spawned = spawnAgentTmux({
				sessionName,
				cwd: ctx.cwd,
				systemPrompt,
				prompt,
				model,
				tools: config.worker.tools || workerDef?.tools || "read,write,edit,bash,grep,find,ls",
				thinking: config.worker.thinking || "off",
				taskId: task.taskId,
				onTelemetry: (delta) => {
					// Accumulate tokens and cost (same as subprocess onTokenUpdate)
					state.workerInputTokens += delta.inputTokens;
					state.workerOutputTokens += delta.outputTokens;
					state.workerCacheReadTokens += delta.cacheReadTokens;
					state.workerCacheWriteTokens += delta.cacheWriteTokens;
					state.workerCostUsd += delta.cost;

					// Tool tracking (same as subprocess onToolCall)
					state.workerToolCount += delta.toolCalls;
					if (delta.lastTool) {
						state.workerLastTool = delta.lastTool;
					}

					// Retry tracking
					state.workerRetryCount += delta.retriesStarted;
					state.workerRetryActive = delta.retryActive;
					if (delta.lastRetryError) {
						state.workerLastRetryError = delta.lastRetryError;
					}

					// Context % — prefer authoritative contextUsage from pi ≥ 0.63.0,
					// fall back to manual calculation from totalTokens + cacheRead.
					{
						const pct = delta.contextUsage
							? delta.contextUsage.percentUsed
							: (delta.latestTotalTokens > 0 && contextWindow > 0)
								? (delta.latestTotalTokens / contextWindow) * 100
								: 0;
						if (pct > 0) {
							state.workerContextPct = pct;
							if (pct >= warnPct) {
								writeWrapUpSignal(`Wrap up (context ${Math.round(pct)}%)`);
							}
							if (pct >= killPct && state.workerStatus === "running") {
								console.error(`[task-runner] tmux worker: context limit (${Math.round(pct)}%) — killing session '${sessionName}'`);
								killReason = "context";
								spawned.kill();
							}
						}
					}

					updateWidgets();
				},
			});
			promise = spawned.promise;
			kill = spawned.kill;
			exitSummaryPath = spawned.exitSummaryPath;

			// Wall-clock timeout: write wrap-up file at 80% of limit,
			// hard kill at 100%. Context-% based wrap-up/kill is also active
			// via sidecar telemetry (above), providing dual safety nets.
			const maxMinutes = getMaxWorkerMinutes(config);
			const warnMs = Math.round(maxMinutes * 0.8 * 60_000);
			const killMs = maxMinutes * 60_000;
			const iterationMarker = state.totalIterations;

			// Wrap-up warning at 80% of wall-clock limit
			wallClockWarnTimer = setTimeout(() => {
				if (
					state.workerStatus === "running" &&
					state.totalIterations === iterationMarker
				) {
					writeWrapUpSignal(`Wrap up (wall-clock ${maxMinutes}min limit)`);
				}
			}, warnMs);

			// Hard kill at 100% of wall-clock limit
			wallClockKillTimer = setTimeout(() => {
				if (state.workerStatus === "running" && state.totalIterations === iterationMarker) {
					console.error(`[task-runner] tmux worker: wall-clock timeout (${maxMinutes}min) — killing session '${sessionName}'`);
					killReason = "timer";
					kill();
				}
			}, killMs);
		} else {
			// ── Subprocess mode (default, unchanged) ─────────────
			// In orchestrated mode, tee conversation events to JSONL for web dashboard
			const conversationPrefix = isOrchestratedMode() ? getTmuxPrefix() : null;
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
					// Build a short summary of what the tool is doing
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
					// Accumulate across turns — each message_end reports per-turn values.
					// Anthropic's `input` is only uncached new tokens; cacheRead holds
					// the bulk of input processing. We sum all four independently so the
					// dashboard can show the full picture.
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
			promise = spawned.promise;
			kill = spawned.kill;
		}

		state.workerProc = { kill };

		const result = await promise;

		// Clean up wall-clock timers if they haven't fired yet
		if (wallClockWarnTimer) clearTimeout(wallClockWarnTimer);
		if (wallClockKillTimer) clearTimeout(wallClockKillTimer);

		clearInterval(state.workerTimer);
		state.workerElapsed = Date.now() - startTime;
		state.workerStatus = result.killed ? "killed" : (result.exitCode === 0 ? "done" : "error");
		state.workerProc = null;

		clearWrapUpSignals();

		// ── Exit Diagnostic (tmux mode only) ─────────────────────
		// Read the exit summary JSON written by rpc-wrapper.mjs, classify
		// the exit, and build a structured diagnostic for persistence.
		// Subprocess mode doesn't produce exit summaries (it uses JSON
		// event stream directly), so this path is tmux-only.
		if (spawnMode === "tmux" && exitSummaryPath) {
			const exitSummary = readExitSummary(exitSummaryPath);
			const donePath = join(task.taskFolder, ".DONE");
			const doneFileFound = existsSync(donePath);

			// Determine userKilled: killed is true but not by timer or context
			const userKilled = result.killed && killReason === null;

			const diagnostic = buildExitDiagnostic({
				exitSummary,
				doneFileFound,
				timerKilled: killReason === "timer",
				contextKilled: killReason === "context",
				userKilled,
				contextPct: state.workerContextPct,
				durationSec: Math.round(state.workerElapsed / 1000),
				repoId: process.env.TASKPLANE_REPO_ID || "default",
				lastKnownStep: state.currentStep || null,
				lastKnownCheckbox: null, // Not parsed in task-runner; available via STATUS.md
				partialProgressCommits: 0, // Computed by orchestrator after commit
				partialProgressBranch: null,
			});

			// Store diagnostic on state for lane-state sidecar and logging
			state.workerExitDiagnostic = diagnostic;

			console.error(`[task-runner] exit diagnostic: ${diagnostic.classification}` +
				(diagnostic.exitCode !== null ? ` (exit ${diagnostic.exitCode})` : "") +
				(exitSummary ? `` : " (no exit summary)"));

			// Log telemetry file paths for operator visibility (files preserved for dashboard)
			const sidecarPath = exitSummaryPath.replace(/-exit\.json$/, ".jsonl");
			console.error(`[task-runner] telemetry files preserved:` +
				`\n  sidecar: ${sidecarPath}` +
				`\n  exit summary: ${exitSummaryPath}`);
		}

		// Log with telemetry detail — both subprocess and TMUX now have context%
		const killedMsg = result.killed
			? (spawnMode === "tmux"
				? `killed (${killReason === "context" ? "context limit" : killReason === "timer" ? "wall-clock timeout" : "user"})`
				: "killed (context limit)")
			: "";
		const statusMsg = killedMsg || (result.exitCode === 0 ? "done" : `error (code ${result.exitCode})`);
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
		// TP-055: model fallback — use session model when TASKPLANE_MODEL_FALLBACK=1
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

		// Read the request file content as the prompt
		const promptContent = readFileSync(requestPath, "utf-8");

		const spawnMode = getSpawnMode(config);
		let reviewPromise: Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>;

		if (spawnMode === "tmux") {
			// ── TMUX mode ────────────────────────────────────────
			// No JSON stream → no onToolCall callback.
			// No timeout — reviewer runs to session completion.
			const sessionName = `${getTmuxPrefix()}-reviewer`;
			const spawned = spawnAgentTmux({
				sessionName,
				cwd: ctx.cwd,
				systemPrompt,
				prompt: promptContent,
				model: reviewerModel,
				tools: config.reviewer.tools || reviewerDef?.tools || "read,write,bash,grep,find,ls",
				thinking: config.reviewer.thinking || "on",
				taskId: state.task?.taskId,
			});
			reviewPromise = spawned.promise;
			state.reviewerProc = { kill: spawned.kill };
		} else {
			// ── Subprocess mode (default, unchanged) ─────────────
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
			reviewPromise = spawned.promise;
			state.reviewerProc = { kill: spawned.kill };
		}

		const result = await reviewPromise;

		clearInterval(state.reviewerTimer);
		state.reviewerElapsed = Date.now() - startTime;
		state.reviewerStatus = result.exitCode === 0 ? "done" : "error";
		state.reviewerProc = null;
		updateWidgets();

		// Read verdict
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

		// Delete any previous verdict file so we can detect agent failure
		const verdictPath = join(task.taskFolder, VERDICT_FILENAME);
		try { if (existsSync(verdictPath)) unlinkSync(verdictPath); } catch { /* ignore */ }

		// Build the quality gate context and prompt
		const gateContext: QualityGateContext = {
			taskFolder: task.taskFolder,
			promptPath: task.promptPath,
			taskId: task.taskId,
			projectName: config.project.name,
			passThreshold: config.quality_gate.pass_threshold,
		};

		const prompt = generateQualityGatePrompt(gateContext, ctx.cwd);

		// Determine review model with fallback chain:
		// quality_gate.review_model → reviewer.model → agent def → default
		const reviewerDef = loadAgentDef(ctx.cwd, "task-reviewer");
		// TP-055: model fallback — use session model when TASKPLANE_MODEL_FALLBACK=1
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

		// Update UI state
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

		const spawnMode = getSpawnMode(config);
		let reviewPromise: Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>;

		try {
			if (spawnMode === "tmux") {
				const sessionName = `${getTmuxPrefix()}-qg-reviewer`;
				const spawned = spawnAgentTmux({
					sessionName,
					cwd: ctx.cwd,
					systemPrompt,
					prompt,
					model: reviewModel,
					tools: config.reviewer.tools || reviewerDef?.tools || "read,write,bash,grep,find,ls",
					thinking: config.reviewer.thinking || "on",
					taskId: task.taskId,
				});
				reviewPromise = spawned.promise;
				state.reviewerProc = { kill: spawned.kill };
			} else {
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
				reviewPromise = spawned.promise;
				state.reviewerProc = { kill: spawned.kill };
			}

			const result = await reviewPromise;

			clearInterval(state.reviewerTimer);
			state.reviewerElapsed = Date.now() - startTime;
			state.reviewerStatus = result.exitCode === 0 ? "done" : "error";
			state.reviewerProc = null;
			updateWidgets();

			// If agent exited non-zero, fail-open
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
			// Agent crash — fail-open
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

		// Read and evaluate the verdict file
		const { verdict, evaluation } = readAndEvaluateVerdict(
			task.taskFolder,
			config.quality_gate.pass_threshold,
		);

		// Apply STATUS.md reconciliation if verdict has entries
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
	 * Reuses the worker spawn pattern (subprocess or tmux). The fix agent
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

		// Use worker model and tools for fix agent (it needs to edit code)
		const workerDef = loadAgentDef(ctx.cwd, "task-worker");
		// TP-055: model fallback — use session model when TASKPLANE_MODEL_FALLBACK=1
		const fixModelFallback = process.env.TASKPLANE_MODEL_FALLBACK === "1";
		const fixModel = fixModelFallback
			? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514")
			: (config.worker.model
				|| workerDef?.model
				|| "anthropic/claude-sonnet-4-20250514");

		const basePrompt = workerDef?.systemPrompt
			|| "You are a fix agent addressing quality gate findings. Read the feedback and make targeted code fixes.";
		const systemPrompt = basePrompt + "\n\n" + buildProjectContext(config, task.taskFolder);

		// Wall-clock timeout: use half of worker limit (fix agents should be quick),
		// with a floor of 15 minutes.
		const workerMinutes = getMaxWorkerMinutes(config);
		const timeoutMs = Math.max(FIX_AGENT_TIMEOUT_MS, Math.floor(workerMinutes / 2) * 60 * 1000);

		// Update UI state
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

		const spawnMode = getSpawnMode(config);
		let fixPromise: Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>;
		let killFn: (() => void) | null = null;
		let tmuxExitSummaryPath: string | null = null;

		try {
			if (spawnMode === "tmux") {
				const sessionName = `${getTmuxPrefix()}-qg-fix`;
				const spawned = spawnAgentTmux({
					sessionName,
					cwd: ctx.cwd,
					systemPrompt,
					prompt: fixPrompt,
					model: fixModel,
					tools: config.worker.tools || workerDef?.tools || "read,write,edit,bash,grep,find,ls",
					thinking: config.worker.thinking || "off",
					taskId: task.taskId,
				});
				fixPromise = spawned.promise;
				killFn = spawned.kill;
				tmuxExitSummaryPath = spawned.exitSummaryPath;
				state.workerProc = { kill: spawned.kill };
			} else {
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
				fixPromise = spawned.promise;
				killFn = spawned.kill;
				state.workerProc = { kill: spawned.kill };
			}

			// Race the agent against a wall-clock timeout
			let timedOut = false;
			const timeoutPromise = new Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>((resolve) => {
				const timer = setTimeout(() => {
					timedOut = true;
					logExecution(statusPath, "Quality gate", `Fix agent wall-clock timeout (${Math.round(timeoutMs / 60000)}min) — killing agent`);
					if (killFn) killFn();
					// Resolve after a brief delay to allow kill to take effect
					setTimeout(() => {
						resolve({ output: "timeout", exitCode: 1, elapsed: Date.now() - startTime, killed: true });
					}, 5000);
				}, timeoutMs);
				// Clean up timer if agent finishes first
				fixPromise.then(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
			});

			const result = await Promise.race([fixPromise, timeoutPromise]);

			// ── TMUX exit classification ─────────────────────────
			// spawnAgentTmux always reports exitCode: 0 on session end.
			// Read the exit summary written by rpc-wrapper to get the
			// real Pi process exit code (same pattern as worker flow).
			let effectiveExitCode = result.exitCode;
			if (spawnMode === "tmux" && tmuxExitSummaryPath && !timedOut) {
				const exitSummary = readExitSummary(tmuxExitSummaryPath);
				if (exitSummary && typeof exitSummary.exitCode === "number") {
					effectiveExitCode = exitSummary.exitCode;
					if (effectiveExitCode !== 0) {
						console.error(`[task-runner] qg-fix: tmux exit summary reports exit code ${effectiveExitCode}`);
					}
				}
				// If no exit summary exists, keep the tmux-reported code (0).
				// This is fail-open: missing exit summary ≠ crash.
			}

			clearInterval(state.workerTimer);
			state.workerElapsed = Date.now() - startTime;
			state.workerStatus = (effectiveExitCode === 0 && !timedOut) ? "done" : "error";
			state.workerProc = null;
			updateWidgets();

			return { exitCode: timedOut ? 1 : effectiveExitCode, elapsed: Date.now() - startTime, timedOut };
		} catch (err: any) {
			// Fix agent crashed — return non-zero to consume fix budget
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
			// `/task <path>`. Used by the parallel orchestrator to launch
			// workers in TMUX sessions without send-keys timing issues.
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
