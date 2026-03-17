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
import { Container, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { spawn, spawnSync } from "child_process";
import {
	readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join, dirname, basename, resolve } from "path";
import { loadProjectConfig, toTaskConfig } from "./taskplane/config-loader.ts";
import { loadWorkspaceConfig, resolvePointer } from "./taskplane/workspace.ts";
import type { PointerResolution } from "./taskplane/types.ts";


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
	reviewerStatus: "idle" | "running" | "done" | "error";
	reviewerType: string;
	reviewerElapsed: number;
	reviewerLastTool: string;
	reviewerProc: any;
	reviewerTimer: any;
	reviewCounter: number;
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
		reviewerStatus: "idle", reviewerType: "", reviewerElapsed: 0,
		reviewerLastTool: "", reviewerProc: null, reviewerTimer: null,
		reviewCounter: 0, totalIterations: 0, stepStatuses: new Map(),
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
	reviewer: { model: "openai/gpt-5.3-codex", tools: "read,bash,grep,find,ls", thinking: "on" },
	context: {
		worker_context_window: 200000, warn_percent: 70, kill_percent: 85,
		max_worker_iterations: 20, max_review_cycles: 2, no_progress_limit: 3,
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
			reviewerStatus: state.reviewerStatus || "idle",
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
	const match = reviewContent.match(/###?\s*Verdict[:\s]*(APPROVE|REVISE|RETHINK)/i);
	return match ? match[1].toUpperCase() : "UNKNOWN";
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
								const tokens = (usage as any).totalTokens || ((usage as any).input + (usage as any).output) || 0;
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
 *   - Return shape:   identical — { promise, kill }
 *   - Promise result: identical fields — { output, exitCode, elapsed, killed }
 *   - Kill semantics: sets killed=true, terminates session, cleans temp files
 *   - Elapsed calc:   Date.now() - startTime (same pattern)
 *   - Cleanup:        synchronous on all paths (more deterministic than spawnAgent's 1s setTimeout)
 *   - output:         always "" (no JSON stream in TMUX mode)
 *   - exitCode:       0 on normal completion, 1 on poll error (TMUX doesn't forward exit codes)
 *
 * @param opts.sessionName  — TMUX session name (e.g., "orch-lane-1-worker")
 * @param opts.cwd          — Working directory for the TMUX session
 * @param opts.systemPrompt — System prompt content (written to temp file)
 * @param opts.prompt       — User prompt content (written to temp file)
 * @param opts.model        — Model identifier (e.g., "anthropic/claude-sonnet-4-20250514")
 * @param opts.tools        — Comma-separated tool list
 * @param opts.thinking     — Thinking mode ("off", "on", etc.)
 */
function spawnAgentTmux(opts: {
	sessionName: string;
	cwd: string;
	systemPrompt: string;
	prompt: string;
	model: string;
	tools: string;
	thinking: string;
}): { promise: Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }>; kill: () => void } {

	// ── Preflight: verify tmux is available ──────────────────────────
	const tmuxCheck = spawnSync("tmux", ["-V"], { shell: true });
	if (tmuxCheck.status !== 0 && tmuxCheck.status !== null) {
		throw new Error(
			"tmux is not installed or not in PATH. " +
			"Install tmux to use TMUX spawn mode, or set TASK_RUNNER_SPAWN_MODE=subprocess. " +
			`(tmux -V exited with code ${tmuxCheck.status})`
		);
	}

	// ── Write prompts to temp files ─────────────────────────────────
	// Same pattern as spawnAgent() — avoids shell escaping issues with
	// backticks, quotes, and special characters in markdown content.
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const sysTmpFile = join(tmpdir(), `pi-task-sys-${id}.txt`);
	const promptTmpFile = join(tmpdir(), `pi-task-prompt-${id}.txt`);
	writeFileSync(sysTmpFile, opts.systemPrompt);
	writeFileSync(promptTmpFile, opts.prompt);

	const cleanupTmp = () => {
		try { unlinkSync(sysTmpFile); } catch {}
		try { unlinkSync(promptTmpFile); } catch {}
	};

	// ── Build Pi command ─────────────────────────────────────────────
	// Use an array of arguments and quote each one individually to handle
	// paths with spaces (Windows paths, temp dir, etc.). The command is
	// passed as a single string to tmux new-session, so we shell-quote it.
	const quoteArg = (s: string): string => {
		// If the arg contains spaces, quotes, or shell metacharacters, wrap in single quotes.
		// Inside single quotes, escape existing single quotes as '\'' (end quote, escaped quote, restart quote).
		if (/[\s"'`$\\!&|;()<>{}#*?~]/.test(s)) {
			return `'${s.replace(/'/g, "'\\''")}'`;
		}
		return s;
	};

	const piArgs = [
		"pi",
		"-p",  // Non-interactive: process prompt and exit (without this, pi waits for more input)
		"--no-session", "--no-extensions", "--no-skills",
		"--model", quoteArg(opts.model),
		"--tools", quoteArg(opts.tools),
		"--thinking", quoteArg(opts.thinking),
		"--append-system-prompt", quoteArg(sysTmpFile),
		`@${quoteArg(promptTmpFile)}`,
	];
	const piCommand = piArgs.join(" ");

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
	const wrappedCommand = `cd ${quoteArg(tmuxCwd)} && TERM=xterm-256color ${piCommand}`;
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

	const promise = (async (): Promise<{ output: string; exitCode: number; elapsed: number; killed: boolean }> => {
		try {
			while (true) {
				await new Promise(r => setTimeout(r, 2000));
				const result = spawnSync("tmux", ["has-session", "-t", opts.sessionName]);
				if (result.status !== 0) {
					// Session no longer exists — Pi exited, TMUX closed
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

	return { promise, kill };
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

	// ── Execution Engine ─────────────────────────────────────────────

	async function executeTask(ctx: ExtensionContext): Promise<void> {
		if (!state.task || !state.config) return;

		const task = state.task;
		const config = state.config;
		const statusPath = join(task.taskFolder, "STATUS.md");

		updateStatusField(statusPath, "Status", "🟡 In Progress");
		updateStatusField(statusPath, "Last Updated", new Date().toISOString().slice(0, 10));
		logExecution(statusPath, "Task started", "Extension-driven execution");

		// Find first incomplete step
		const status = parseStatusMd(readFileSync(statusPath, "utf-8"));
		let startStep = 0;
		for (const s of status.steps) {
			if (s.status === "complete") startStep = s.number + 1;
			else break;
		}

		for (let i = 0; i < task.steps.length; i++) {
			const step = task.steps[i];
			if (step.number < startStep) continue;
			if (state.phase === "paused") {
				logExecution(statusPath, "Paused", `User paused at Step ${step.number}`);
				ctx.ui.notify(`Task paused at Step ${step.number}`, "info");
				return;
			}

			state.currentStep = step.number;
			updateWidgets();

			await executeStep(step, ctx);

			if (state.phase === "error" || state.phase === "paused") return;
		}

		// All done
		const donePath = join(task.taskFolder, ".DONE");
		writeFileSync(donePath, `Completed: ${new Date().toISOString()}\nTask: ${task.taskId}\n`);
		updateStatusField(statusPath, "Status", "✅ Complete");
		logExecution(statusPath, "Task complete", ".DONE created");

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

	async function executeStep(step: StepInfo, ctx: ExtensionContext): Promise<void> {
		if (!state.task || !state.config) return;

		const task = state.task;
		const config = state.config;
		const statusPath = join(task.taskFolder, "STATUS.md");

		// Capture git HEAD before the step starts so code reviewers can
		// diff the full step's changes (workers commit via checkpoints).
		const stepBaselineCommit = getHeadCommitSha();

		updateStepStatus(statusPath, step.number, "in-progress");
		updateStatusField(statusPath, "Current Step", `Step ${step.number}: ${step.name}`);
		logExecution(statusPath, `Step ${step.number} started`, step.name);
		updateWidgets();

		// Plan review (level ≥ 1)
		if (task.reviewLevel >= 1) {
			const verdict = await doReview("plan", step, ctx, stepBaselineCommit);
			if (verdict === "RETHINK") {
				ctx.ui.notify(`Reviewer: RETHINK on Step ${step.number} plan. Proceeding with caution.`, "warning");
			}
		}

		// Worker loop
		let noProgressCount = 0;
		for (let iter = 0; iter < config.context.max_worker_iterations; iter++) {
			if (state.phase === "paused") return;

			// Re-read STATUS.md
			const currentStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
			const stepStatus = currentStatus.steps.find(s => s.number === step.number);
			if (stepStatus?.status === "complete" || (stepStatus && stepStatus.totalChecked === stepStatus.totalItems && stepStatus.totalItems > 0)) {
				updateStepStatus(statusPath, step.number, "complete");
				break;
			}

			const prevChecked = stepStatus?.totalChecked || 0;
			state.workerIteration = iter + 1;
			state.totalIterations++;
			updateStatusField(statusPath, "Iteration", `${state.totalIterations}`);
			updateWidgets();

			await runWorker(step, ctx);

			// Check progress
			const afterStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
			const afterStep = afterStatus.steps.find(s => s.number === step.number);
			const afterChecked = afterStep?.totalChecked || 0;

			if (afterChecked <= prevChecked) {
				noProgressCount++;
				if (noProgressCount >= config.context.no_progress_limit) {
					logExecution(statusPath, `Step ${step.number} blocked`, `No progress after ${noProgressCount} iterations`);
					ctx.ui.notify(`⚠️ Step ${step.number} blocked — no progress after ${noProgressCount} iterations`, "error");
					state.phase = "error";
					return;
				}
			} else {
				noProgressCount = 0;
			}

			if (afterStep?.status === "complete" || (afterStep && afterStep.totalChecked === afterStep.totalItems && afterStep.totalItems > 0)) {
				updateStepStatus(statusPath, step.number, "complete");
				break;
			}
		}

		// Code review (level ≥ 2)
		if (task.reviewLevel >= 2 && state.phase === "running") {
			const verdict = await doReview("code", step, ctx, stepBaselineCommit);
			if (verdict === "REVISE") {
				ctx.ui.notify(`Reviewer: REVISE on Step ${step.number}. Running worker to fix...`, "warning");
				await runWorker(step, ctx); // One more pass to address issues
			}
		}

		if (state.phase === "running") {
			updateStepStatus(statusPath, step.number, "complete");
			logExecution(statusPath, `Step ${step.number} complete`, step.name);
			// Update local cache
			const refreshed = parseStatusMd(readFileSync(statusPath, "utf-8"));
			for (const s of refreshed.steps) state.stepStatuses.set(s.number, s);
			updateWidgets();
		}
	}

	// ── Worker ───────────────────────────────────────────────────────

	async function runWorker(step: StepInfo, ctx: ExtensionContext): Promise<void> {
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

		const model = config.worker.model
			|| workerDef?.model
			|| (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "anthropic/claude-sonnet-4-20250514");

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

		const prompt = [
			`Execute Step ${step.number}: ${step.name}`,
			``,
			`Task: ${task.taskId} — ${task.taskName}`,
			`Task folder: ${task.taskFolder}/`,
			`PROMPT: ${task.promptPath}`,
			`STATUS: ${statusPath}`,
			``,
			`This is iteration ${state.totalIterations}.`,
			`Read STATUS.md FIRST to find where you left off.`,
			`Work ONLY on Step ${step.number}. Do not proceed to other steps.`,
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

		if (spawnMode === "tmux") {
			// ── TMUX mode ────────────────────────────────────────
			// No JSON stream → no onToolCall/onContextPct callbacks.
			// Kill via wall-clock timeout instead of context-%.
			const sessionName = `${getTmuxPrefix()}-worker`;
			const spawned = spawnAgentTmux({
				sessionName,
				cwd: ctx.cwd,
				systemPrompt,
				prompt,
				model,
				tools: config.worker.tools || workerDef?.tools || "read,write,edit,bash,grep,find,ls",
				thinking: config.worker.thinking || "off",
			});
			promise = spawned.promise;
			kill = spawned.kill;

			// Wall-clock timeout: write wrap-up file at 80% of limit,
			// hard kill at 100%. No context telemetry in TMUX mode.
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
				contextWindow: config.context.worker_context_window,
				warnPct: config.context.warn_percent,
				killPct: config.context.kill_percent,
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
					if (pct >= config.context.warn_percent) {
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

		// Log with mode-appropriate detail: subprocess has context%, TMUX does not
		const killedMsg = spawnMode === "tmux" ? "killed (wall-clock timeout)" : "killed (context limit)";
		const statusMsg = result.killed ? killedMsg : (result.exitCode === 0 ? "done" : `error (code ${result.exitCode})`);
		const ctxDetail = spawnMode === "tmux" ? "" : `, ctx: ${Math.round(state.workerContextPct)}%`;
		logExecution(statusPath, `Worker iter ${state.totalIterations}`,
			`${statusMsg} in ${Math.round(state.workerElapsed / 1000)}s${ctxDetail}, tools: ${state.workerToolCount}`);

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
		const reviewerModel = config.reviewer.model || reviewerDef?.model || "openai/gpt-5.3-codex";
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
		description: "Start executing a task: /task <path/to/PROMPT.md>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
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
		description: "Show current task progress",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
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
		description: "Pause task after current worker finishes",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
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
		description: "Resume a paused task",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
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
