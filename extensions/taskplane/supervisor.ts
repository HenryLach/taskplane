/**
 * Supervisor agent module — activates an interactive LLM agent in the pi
 * session after `/orch` starts a non-blocking batch.
 *
 * The supervisor monitors engine events, handles failures, and keeps the
 * operator informed. It shares the pi session, so the operator can converse
 * naturally ("how's it going?", "fix it", "I'm going to bed") while the
 * batch runs.
 *
 * Key components:
 * - System prompt design (identity, context, capabilities, standing orders)
 * - Activation after engine starts (via pi.sendMessage with triggerTurn)
 * - System prompt persistence across turns (via before_agent_start event)
 * - Model inheritance + config override
 * - Lockfile + heartbeat for session takeover prevention (Step 2)
 * - Startup detection + stale lock takeover with rehydration (Step 2)
 *
 * @module supervisor
 * @since TP-041
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from "fs";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";
import type { OrchBatchRuntimeState, OrchestratorConfig, PersistedBatchState } from "./types.ts";

// ── Supervisor Config Types ──────────────────────────────────────────

/**
 * Autonomy level for the supervisor agent.
 *
 * Controls how much the supervisor does automatically vs. asking the operator.
 *
 * - `interactive`: Ask before any recovery action
 * - `supervised`: Tier 0 patterns auto, novel recovery asks
 * - `autonomous`: Handle everything, pause only when stuck
 *
 * @since TP-041
 */
export type SupervisorAutonomyLevel = "interactive" | "supervised" | "autonomous";

/**
 * Supervisor configuration resolved from project config + user preferences.
 *
 * @since TP-041
 */
export interface SupervisorConfig {
	/** Model to use for supervisor agent. Empty string = inherit session model. */
	model: string;
	/** Autonomy level controlling confirmation behavior. */
	autonomy: SupervisorAutonomyLevel;
}

/** Default supervisor config values. */
export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
	model: "",
	autonomy: "supervised",
};

// ── System Prompt ────────────────────────────────────────────────────

/**
 * Path to the supervisor primer markdown file, resolved relative to this
 * module's directory (extensions/taskplane/).
 */
function resolvePrimerPath(): string {
	try {
		const thisDir = dirname(fileURLToPath(import.meta.url));
		return join(thisDir, "supervisor-primer.md");
	} catch {
		// Fallback for environments where import.meta.url is unavailable
		return join(__dirname, "supervisor-primer.md");
	}
}

/**
 * Build the supervisor system prompt.
 *
 * The prompt establishes:
 * 1. **Identity**: "You are the batch supervisor"
 * 2. **Context**: Batch metadata, file paths, wave plan
 * 3. **Capabilities**: Full tool access for monitoring and recovery
 * 4. **Standing orders**: Monitor events, handle failures, keep operator informed
 * 5. **Primer reference**: Read supervisor-primer.md for detailed operational knowledge
 *
 * The prompt is rebuilt on every LLM turn from the live batchState reference,
 * ensuring it always reflects the latest batch metadata (including batchId,
 * wave counts, and task counts that are populated asynchronously by the engine).
 *
 * @param batchState - Current batch runtime state (live reference)
 * @param config - Orchestrator configuration
 * @param supervisorConfig - Supervisor-specific configuration
 * @param stateRoot - Root path for .pi/ state directory
 * @returns The complete system prompt string
 *
 * @since TP-041
 */
export function buildSupervisorSystemPrompt(
	batchState: OrchBatchRuntimeState,
	config: OrchestratorConfig,
	supervisorConfig: SupervisorConfig,
	stateRoot: string,
): string {
	const primerPath = resolvePrimerPath();
	const batchStatePath = join(stateRoot, ".pi", "batch-state.json");
	const eventsPath = join(stateRoot, ".pi", "supervisor", "events.jsonl");
	const autonomyLabel = supervisorConfig.autonomy;

	// Build wave plan summary
	const waveSummary = batchState.totalWaves > 0
		? `${batchState.currentWaveIndex + 1}/${batchState.totalWaves} waves`
		: "planning";

	const prompt = `# Supervisor Agent

You are the **batch supervisor** — a persistent agent that monitors a Taskplane
orchestration batch, handles failures, and keeps the operator informed.

## Identity

You share this terminal session with the human operator. After \`/orch\` started
a batch, you activated to supervise it. The operator can talk to you naturally
at any time. You are a senior engineer on call for this batch.

## Current Batch Context

- **Batch ID:** ${batchState.batchId || "(initializing — read batch state file)"}
- **Phase:** ${batchState.phase}
- **Base branch:** ${batchState.baseBranch}
- **Orch branch:** ${batchState.orchBranch || "(legacy mode)"}
- **Progress:** ${waveSummary}, ${batchState.totalTasks} total tasks
- **Succeeded:** ${batchState.succeededTasks} | **Failed:** ${batchState.failedTasks} | **Skipped:** ${batchState.skippedTasks} | **Blocked:** ${batchState.blockedTasks}
- **Autonomy:** ${autonomyLabel}

## Key File Paths

- **Batch state:** \`${batchStatePath}\`
- **Engine events:** \`${eventsPath}\`
- **State root:** \`${stateRoot}\`

## Capabilities

You have full tool access: \`read\`, \`write\`, \`edit\`, \`bash\`, \`grep\`, \`find\`, \`ls\`.
Use these to:
- Read batch state, STATUS.md files, merge results, event logs
- Run git commands for diagnostics and manual merge recovery
- Edit batch-state.json for state repairs (when needed)
- Manage tmux sessions (list, kill, attach)
- Run verification commands (tests)

## Standing Orders

1. **Monitor engine events.** Periodically read \`${eventsPath}\` to track
   batch progress. Report significant events to the operator proactively:
   - Wave starts/completions
   - Task failures requiring attention
   - Merge successes/failures
   - Batch completion

2. **Handle failures.** When tasks fail or merges time out, diagnose the
   issue using the patterns in supervisor-primer.md and take appropriate
   recovery action based on your autonomy level (${autonomyLabel}).

3. **Keep the operator informed.** Provide clear, natural status updates.
   When the operator asks "how's it going?" — read batch state and summarize.

4. **Log all recovery actions.** Before any recovery action, document what
   you're doing and why. After, document the outcome.

5. **Respect autonomy level (${autonomyLabel}).**
${autonomyLabel === "interactive" ? `   - ASK before every recovery action. Explain options, let operator decide.` : ""}${autonomyLabel === "supervised" ? `   - Execute known Tier 0 recovery patterns automatically (retries, cleanup).
   - ASK before novel recovery (manual merges, state editing, skipping tasks).` : ""}${autonomyLabel === "autonomous" ? `   - Handle everything you can. Pause and summarize only when genuinely stuck.
   - The operator trusts you to make reasonable decisions.` : ""}

## Operational Knowledge

**IMPORTANT:** Read \`${primerPath}\` for your complete operational runbook.
It contains:
- Architecture details and wave lifecycle
- Common failure patterns and recovery procedures
- Batch state editing guide (safe vs. dangerous edits)
- Git operations reference
- Communication guidelines

Read it now before doing anything else. It is your primary reference.

## What You Must NEVER Do

1. Never \`git push\` to any remote
2. Never delete \`.pi/batch-state.json\` without operator approval
3. Never modify task code (files that workers wrote)
4. Never modify PROMPT.md files
5. Never \`git reset --hard\` with uncommitted changes
6. Never skip tasks/waves without telling the operator
7. Never create PRs or GitHub releases

## Startup Checklist

Now that you've activated:
1. Read the supervisor primer at \`${primerPath}\`
2. Read \`${batchStatePath}\` for full batch metadata
3. Read \`${eventsPath}\` for any events already emitted
4. Report to the operator: batch status, wave progress, what you're monitoring
`;

	return prompt;
}


// ── Activation ───────────────────────────────────────────────────────

/**
 * Supervisor activation state.
 *
 * Tracks whether the supervisor is active for the current batch,
 * preventing duplicate activations and enabling guard logic for
 * the before_agent_start hook.
 *
 * The prompt is rebuilt dynamically each turn from the live batchState
 * reference, ensuring it always has current metadata (batchId, wave/task
 * counts are populated asynchronously by the engine after planning).
 *
 * @since TP-041
 */
export interface SupervisorState {
	/** Whether the supervisor is currently active */
	active: boolean;
	/** Batch ID the supervisor is monitoring (empty if inactive or pre-planning) */
	batchId: string;
	/** Supervisor configuration */
	config: SupervisorConfig;

	// ── Live references for dynamic prompt rebuild ──────────────────
	/** Live reference to the batch state (for dynamic prompt rebuild) */
	batchStateRef: OrchBatchRuntimeState | null;
	/** Orchestrator config reference (for dynamic prompt rebuild) */
	orchConfigRef: OrchestratorConfig | null;
	/** State root path (for dynamic prompt rebuild) */
	stateRoot: string;

	// ── Model override tracking ────────────────────────────────────
	/** Model that was active before supervisor activation (for restoration) */
	previousModel: Model<Api> | null;
	/** Whether we switched models on activation (determines if we restore) */
	didSwitchModel: boolean;

	// ── Lockfile + Heartbeat (Step 2) ──────────────────────────────
	/** Session ID written to the lockfile (for yield detection) */
	lockSessionId: string;
	/** Heartbeat timer handle (null when not active) */
	heartbeatTimer: ReturnType<typeof setInterval> | null;
}

/**
 * Create fresh (inactive) supervisor state.
 */
export function freshSupervisorState(): SupervisorState {
	return {
		active: false,
		batchId: "",
		config: { ...DEFAULT_SUPERVISOR_CONFIG },
		batchStateRef: null,
		orchConfigRef: null,
		stateRoot: "",
		previousModel: null,
		didSwitchModel: false,
		lockSessionId: "",
		heartbeatTimer: null,
	};
}

/**
 * Resolve a model string (e.g., "anthropic/claude-sonnet-4" or "claude-sonnet-4")
 * to a Model object from the model registry.
 *
 * Format: "provider/modelId" or just "modelId" (searches all providers).
 *
 * @returns The resolved Model, or undefined if not found
 * @since TP-041
 */
function resolveModelFromString(
	modelStr: string,
	ctx: ExtensionContext,
): Model<Api> | undefined {
	if (!modelStr) return undefined;

	// Try "provider/id" format first
	const slashIdx = modelStr.indexOf("/");
	if (slashIdx > 0) {
		const provider = modelStr.substring(0, slashIdx);
		const id = modelStr.substring(slashIdx + 1);
		return ctx.modelRegistry.find(provider, id);
	}

	// No provider prefix — search all models for matching id
	const allModels = ctx.modelRegistry.getAll();
	return allModels.find((m) => m.id === modelStr);
}

/**
 * Activate the supervisor agent in the current pi session.
 *
 * This is called after `startBatchAsync()` in the `/orch` command handler.
 * It:
 * 1. Stores live references to batchState/config for dynamic prompt rebuild
 * 2. Optionally switches model via pi.setModel() if supervisor.model is configured
 * 3. Sends an activation message via pi.sendMessage() with triggerTurn=true
 *    to kick off the supervisor's first turn
 *
 * The system prompt is NOT cached at activation time — it is rebuilt dynamically
 * on every LLM turn by the before_agent_start hook. This ensures the prompt
 * always has current batch metadata, even though batchId/wave/task counts are
 * populated asynchronously by the engine after planning.
 *
 * @param pi - The ExtensionAPI instance
 * @param state - Mutable supervisor state to populate
 * @param batchState - Current batch runtime state (live reference)
 * @param orchConfig - Orchestrator configuration
 * @param supervisorConfig - Supervisor-specific configuration
 * @param stateRoot - Root path for .pi/ state directory
 * @param ctx - Extension context (for model resolution)
 *
 * @since TP-041
 */
export async function activateSupervisor(
	pi: ExtensionAPI,
	state: SupervisorState,
	batchState: OrchBatchRuntimeState,
	orchConfig: OrchestratorConfig,
	supervisorConfig: SupervisorConfig,
	stateRoot: string,
	ctx: ExtensionContext,
): Promise<void> {
	// Store live references for dynamic prompt rebuild
	state.active = true;
	state.batchId = batchState.batchId; // May be empty pre-planning — that's OK
	state.config = { ...supervisorConfig };
	state.batchStateRef = batchState;
	state.orchConfigRef = orchConfig;
	state.stateRoot = stateRoot;

	// ── Model override ───────────────────────────────────────────────
	// If supervisor.model is configured, switch to it. Store the previous
	// model for restoration on deactivation.
	state.previousModel = ctx.model ?? null;
	state.didSwitchModel = false;

	if (supervisorConfig.model) {
		const targetModel = resolveModelFromString(supervisorConfig.model, ctx);
		if (targetModel) {
			const success = await pi.setModel(targetModel);
			if (success) {
				state.didSwitchModel = true;
			}
			// If setModel fails (no API key), fall through to session model
		}
		// If model not found in registry, fall through to session model (inheritance)
	}

	// ── Lockfile + Heartbeat (Step 2) ────────────────────────────────
	// Write lockfile to claim supervisor role. Generate a unique session ID
	// for yield detection (if another session force-takes over, our heartbeat
	// will detect the sessionId mismatch and yield).
	const sessionId = `pi-${process.pid}-${Date.now()}`;
	state.lockSessionId = sessionId;

	const lock: SupervisorLockfile = {
		pid: process.pid,
		sessionId,
		batchId: batchState.batchId || "(initializing)",
		startedAt: new Date().toISOString(),
		heartbeat: new Date().toISOString(),
	};
	writeLockfile(stateRoot, lock);

	// Start heartbeat timer — updates lockfile every 30s, detects takeover
	state.heartbeatTimer = startHeartbeat(stateRoot, state, pi);

	// Send activation message to trigger the supervisor's first turn.
	// The content is generic — specific counts may not be available yet
	// since the engine sets batchId/totalWaves/totalTasks asynchronously.
	// The supervisor's first action (per standing orders) is to read the
	// batch state file for full metadata.
	pi.sendMessage(
		{
			customType: "supervisor-activation",
			content: [
				{
					type: "text",
					text:
						`🔀 **Batch started.** ` +
						`Supervisor activated (autonomy: ${supervisorConfig.autonomy}).\n\n` +
						`Read your operational primer and batch state, then report initial status to the operator.`,
				},
			],
			display: "Supervisor activated" + (batchState.batchId ? ` for batch ${batchState.batchId}` : ""),
		},
		{ triggerTurn: true, deliverAs: "nextTurn" },
	);
}

/**
 * Deactivate the supervisor agent.
 *
 * Called when a batch completes, fails terminally, is stopped, or is aborted.
 * Clears the supervisor state so the before_agent_start hook stops
 * injecting the supervisor system prompt. Restores the previous model
 * if one was switched on activation.
 *
 * Safe to call multiple times (idempotent) — subsequent calls are no-ops.
 *
 * @param pi - The ExtensionAPI instance (for model restoration)
 * @param state - Supervisor state to clear
 *
 * @since TP-041
 */
export async function deactivateSupervisor(
	pi: ExtensionAPI,
	state: SupervisorState,
): Promise<void> {
	if (!state.active) return; // Already inactive — idempotent guard

	// ── Stop heartbeat timer (Step 2) ────────────────────────────
	if (state.heartbeatTimer) {
		clearInterval(state.heartbeatTimer);
		state.heartbeatTimer = null;
	}

	// ── Remove lockfile (Step 2) ─────────────────────────────────
	// Only remove if we still own it (our sessionId matches).
	// If another session force-took-over, the lockfile belongs to them.
	if (state.stateRoot && state.lockSessionId) {
		const currentLock = readLockfile(state.stateRoot);
		if (!currentLock || currentLock.sessionId === state.lockSessionId) {
			removeLockfile(state.stateRoot);
		}
	}

	// Restore previous model if we switched on activation
	if (state.didSwitchModel && state.previousModel) {
		try {
			await pi.setModel(state.previousModel);
		} catch {
			// Non-fatal — model may no longer be available
		}
	}

	state.active = false;
	state.batchId = "";
	state.batchStateRef = null;
	state.orchConfigRef = null;
	state.stateRoot = "";
	state.previousModel = null;
	state.didSwitchModel = false;
	state.lockSessionId = "";
}

/**
 * Register the before_agent_start hook for persistent system prompt injection.
 *
 * While the supervisor is active, every LLM turn gets the supervisor system
 * prompt injected. The prompt is rebuilt dynamically from the live batchState
 * reference, ensuring it always reflects the latest batch metadata (batchId,
 * wave/task counts populated asynchronously by the engine after planning).
 *
 * When the supervisor is inactive (no batch running), this hook is a no-op
 * and the original system prompt is used unmodified.
 *
 * @param pi - The ExtensionAPI instance
 * @param state - Supervisor state (checked on each turn)
 *
 * @since TP-041
 */
export function registerSupervisorPromptHook(
	pi: ExtensionAPI,
	state: SupervisorState,
): void {
	pi.on("before_agent_start", (_event) => {
		if (!state.active || !state.batchStateRef || !state.orchConfigRef) {
			return undefined; // No-op: don't modify system prompt
		}

		// Rebuild prompt dynamically from live batchState reference.
		// This ensures the prompt always has current metadata, even though
		// batchId/totalWaves/totalTasks are populated asynchronously.
		const systemPrompt = buildSupervisorSystemPrompt(
			state.batchStateRef,
			state.orchConfigRef,
			state.config,
			state.stateRoot,
		);

		return {
			systemPrompt,
		};
	});
}

/**
 * Resolve supervisor configuration from available sources.
 *
 * Resolution order (highest precedence first):
 * 1. User preferences (supervisorModel → orchestrator.supervisor.model)
 * 2. Project config (orchestrator.supervisor section in taskplane-config.json)
 * 3. Defaults (model="" = inherit session model, autonomy="supervised")
 *
 * This function is a convenience wrapper for cases where the full config
 * loading pipeline has already run. For direct config loading, use
 * `loadSupervisorConfig()` from config.ts instead.
 *
 * @param supervisorSection - Pre-loaded supervisor config section (or undefined for defaults)
 * @returns Resolved supervisor configuration
 *
 * @since TP-041
 */
export function resolveSupervisorConfig(
	supervisorSection?: Partial<SupervisorConfig>,
): SupervisorConfig {
	if (!supervisorSection) return { ...DEFAULT_SUPERVISOR_CONFIG };
	return {
		model: supervisorSection.model ?? DEFAULT_SUPERVISOR_CONFIG.model,
		autonomy: supervisorSection.autonomy ?? DEFAULT_SUPERVISOR_CONFIG.autonomy,
	};
}


// ── Lockfile Types + Helpers (TP-041 Step 2) ─────────────────────────

/** Heartbeat interval in milliseconds (30 seconds). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Staleness threshold: if heartbeat is older than this, lock is stale (90s = 3 missed heartbeats). */
export const STALE_LOCK_THRESHOLD_MS = 90_000;

/**
 * Supervisor lockfile shape — written to `.pi/supervisor/lock.json`.
 *
 * The lockfile enforces a 1:1 ratio between supervisors and batches.
 * Only one supervisor session may be active per project at a time.
 *
 * @since TP-041
 */
export interface SupervisorLockfile {
	/** Process ID of the supervisor session */
	pid: number;
	/** Unique session identifier (from pi session) */
	sessionId: string;
	/** Batch ID being supervised */
	batchId: string;
	/** ISO 8601 timestamp when this supervisor started */
	startedAt: string;
	/** ISO 8601 timestamp of most recent heartbeat */
	heartbeat: string;
}

/**
 * Result of checking the supervisor lockfile on startup.
 *
 * @since TP-041
 */
export type LockfileCheckResult =
	| { status: "no-active-batch" }
	| { status: "no-lockfile"; batchState: PersistedBatchState }
	| { status: "stale"; lock: SupervisorLockfile; batchState: PersistedBatchState }
	| { status: "live"; lock: SupervisorLockfile; batchState: PersistedBatchState }
	| { status: "corrupt"; batchState: PersistedBatchState };

/**
 * Resolve the lockfile path for a given state root.
 */
export function lockfilePath(stateRoot: string): string {
	return join(stateRoot, ".pi", "supervisor", "lock.json");
}

/**
 * Read and parse the supervisor lockfile.
 *
 * Returns null if the file doesn't exist. If the file is corrupt/malformed,
 * returns null (treat as stale per R003 suggestion — caller should rewrite).
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @returns Parsed lockfile or null
 *
 * @since TP-041
 */
export function readLockfile(stateRoot: string): SupervisorLockfile | null {
	const path = lockfilePath(stateRoot);
	if (!existsSync(path)) return null;

	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;

		// Validate required fields
		if (
			typeof parsed.pid !== "number" ||
			typeof parsed.sessionId !== "string" ||
			typeof parsed.batchId !== "string" ||
			typeof parsed.startedAt !== "string" ||
			typeof parsed.heartbeat !== "string"
		) {
			return null; // Malformed — treat as stale/absent
		}

		return parsed as unknown as SupervisorLockfile;
	} catch {
		return null; // Corrupt JSON — treat as stale/absent
	}
}

/**
 * Write the supervisor lockfile atomically (temp file + rename).
 *
 * Creates the `.pi/supervisor/` directory if it doesn't exist.
 * Uses temp+rename to prevent partial writes from corrupting the file.
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @param lock - Lockfile data to write
 *
 * @since TP-041
 */
export function writeLockfile(stateRoot: string, lock: SupervisorLockfile): void {
	const dir = join(stateRoot, ".pi", "supervisor");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const finalPath = lockfilePath(stateRoot);
	const tmpPath = finalPath + ".tmp";
	const json = JSON.stringify(lock, null, 2) + "\n";

	writeFileSync(tmpPath, json, "utf-8");
	renameSync(tmpPath, finalPath);
}

/**
 * Remove the supervisor lockfile.
 *
 * Safe to call when the file doesn't exist (no-op).
 *
 * @param stateRoot - Root path for .pi/ state directory
 *
 * @since TP-041
 */
export function removeLockfile(stateRoot: string): void {
	const path = lockfilePath(stateRoot);
	try {
		if (existsSync(path)) {
			unlinkSync(path);
		}
	} catch {
		// Best-effort — if we can't remove it, it'll be detected as stale on next startup
	}
}

/**
 * Check whether a process with the given PID is alive.
 *
 * Uses `process.kill(pid, 0)` which sends signal 0 (no-op) — throws
 * if the process doesn't exist, returns true if it does.
 *
 * @param pid - Process ID to check
 * @returns true if the process is alive
 *
 * @since TP-041
 */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Check whether a lockfile's heartbeat is stale.
 *
 * A heartbeat is stale if it's older than STALE_LOCK_THRESHOLD_MS (90s).
 * This accounts for 3 missed 30-second heartbeat intervals.
 *
 * @param lock - Lockfile to check
 * @returns true if the heartbeat is stale
 *
 * @since TP-041
 */
export function isLockStale(lock: SupervisorLockfile): boolean {
	const heartbeatTime = new Date(lock.heartbeat).getTime();
	if (isNaN(heartbeatTime)) return true; // Invalid date — treat as stale
	return Date.now() - heartbeatTime > STALE_LOCK_THRESHOLD_MS;
}

// ── Terminal Phase Detection ─────────────────────────────────────────

/**
 * Phases that indicate a batch is terminal (no longer active).
 * If batch-state.json has one of these phases, there's no active batch
 * and no lockfile arbitration is needed.
 */
const TERMINAL_PHASES = new Set<string>([
	"idle", "completed", "failed", "stopped",
]);

/**
 * Check whether a batch phase is terminal (no active batch).
 *
 * @since TP-041
 */
export function isBatchTerminal(phase: string): boolean {
	return TERMINAL_PHASES.has(phase);
}

// ── Startup Detection (Section 13.10) ────────────────────────────────

/**
 * Check startup state: is there an active batch and an existing lockfile?
 *
 * Implements the startup gate from spec Section 13.10:
 * 1. Check for active batch (.pi/batch-state.json with non-terminal phase)
 * 2. If no active batch, return early (no lockfile arbitration needed)
 * 3. If active batch, check lockfile state (absent, stale, live, corrupt)
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @param loadBatchStateFn - Function to load batch state (injectable for testing)
 * @returns LockfileCheckResult describing the current state
 *
 * @since TP-041
 */
export function checkSupervisorLockOnStartup(
	stateRoot: string,
	loadBatchStateFn: (root: string) => PersistedBatchState | null,
): LockfileCheckResult {
	// ── Step 1: Check for active batch ───────────────────────────
	let batchState: PersistedBatchState | null;
	try {
		batchState = loadBatchStateFn(stateRoot);
	} catch {
		// Batch state unreadable — no active batch to supervise
		return { status: "no-active-batch" };
	}

	if (!batchState || isBatchTerminal(batchState.phase)) {
		return { status: "no-active-batch" };
	}

	// ── Step 2: Active batch exists — check lockfile ─────────────
	const lock = readLockfile(stateRoot);

	if (!lock) {
		// No lockfile (or corrupt) — check if the file exists but was corrupt
		const lockPath = lockfilePath(stateRoot);
		if (existsSync(lockPath)) {
			// File exists but couldn't be parsed — corrupt
			return { status: "corrupt", batchState };
		}
		// No lockfile at all — become the supervisor
		return { status: "no-lockfile", batchState };
	}

	// ── Step 3: Lockfile exists — live or stale? ─────────────────
	if (!isProcessAlive(lock.pid) || isLockStale(lock)) {
		return { status: "stale", lock, batchState };
	}

	return { status: "live", lock, batchState };
}

// ── Rehydration Summary ──────────────────────────────────────────────

/**
 * Build a rehydration summary for the operator after a takeover.
 *
 * Reads:
 * 1. Batch state for current wave, task statuses, phase
 * 2. `.pi/supervisor/actions.jsonl` for what the previous supervisor did
 * 3. `.pi/supervisor/events.jsonl` for recent engine events
 *
 * Returns a human-readable summary string.
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @param batchState - Current batch state
 * @returns Summary string for the operator
 *
 * @since TP-041
 */
export function buildTakeoverSummary(
	stateRoot: string,
	batchState: PersistedBatchState,
): string {
	const lines: string[] = [];

	lines.push(`📋 **Taking over batch ${batchState.batchId}**`);
	lines.push("");
	lines.push(`**Phase:** ${batchState.phase}`);
	lines.push(`**Wave:** ${batchState.currentWaveIndex + 1}/${batchState.wavePlan?.length ?? batchState.totalWaves ?? "?"}`);
	lines.push(`**Base branch:** ${batchState.baseBranch}`);

	// Task summary from persisted state
	const tasks = batchState.tasks ?? [];
	const succeeded = tasks.filter((t) => t.status === "succeeded").length;
	const failed = tasks.filter((t) => t.status === "failed").length;
	const running = tasks.filter((t) => t.status === "running").length;
	const pending = tasks.filter((t) => t.status === "pending").length;
	lines.push(`**Tasks:** ${succeeded} succeeded, ${failed} failed, ${running} running, ${pending} pending`);

	// Recent actions from audit trail
	const actionsPath = join(stateRoot, ".pi", "supervisor", "actions.jsonl");
	if (existsSync(actionsPath)) {
		try {
			const actionsRaw = readFileSync(actionsPath, "utf-8").trim();
			if (actionsRaw) {
				const actionLines = actionsRaw.split("\n");
				const recentActions = actionLines.slice(-5); // Last 5 actions
				lines.push("");
				lines.push(`**Previous supervisor actions** (last ${recentActions.length}):`);
				for (const line of recentActions) {
					try {
						const action = JSON.parse(line) as Record<string, unknown>;
						lines.push(`  - ${action.action ?? "unknown"}: ${action.context ?? ""}`);
					} catch {
						lines.push(`  - (unparseable entry)`);
					}
				}
			}
		} catch {
			// Best-effort — actions file may not exist
		}
	}

	// Recent engine events
	const eventsPath = join(stateRoot, ".pi", "supervisor", "events.jsonl");
	if (existsSync(eventsPath)) {
		try {
			const eventsRaw = readFileSync(eventsPath, "utf-8").trim();
			if (eventsRaw) {
				const eventLines = eventsRaw.split("\n");
				const recentEvents = eventLines.slice(-5); // Last 5 events
				lines.push("");
				lines.push(`**Recent engine events** (last ${recentEvents.length}):`);
				for (const line of recentEvents) {
					try {
						const event = JSON.parse(line) as Record<string, unknown>;
						lines.push(`  - [${event.type ?? "?"}] ${event.message ?? event.taskId ?? ""}`);
					} catch {
						lines.push(`  - (unparseable event)`);
					}
				}
			}
		} catch {
			// Best-effort — events file may not exist
		}
	}

	return lines.join("\n");
}

// ── Heartbeat Timer ──────────────────────────────────────────────────

/**
 * Start the heartbeat timer for the supervisor lockfile.
 *
 * Updates the lockfile's `heartbeat` field every HEARTBEAT_INTERVAL_MS.
 * Also checks if the lockfile has been taken over by another session
 * (force takeover detection) — if the sessionId no longer matches,
 * the previous session yields gracefully.
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @param state - Supervisor state (used for yield detection)
 * @param pi - ExtensionAPI for deactivation on yield
 * @returns Timer handle (for cleanup via clearInterval)
 *
 * @since TP-041
 */
export function startHeartbeat(
	stateRoot: string,
	state: SupervisorState,
	pi: ExtensionAPI,
): ReturnType<typeof setInterval> {
	const sessionId = state.lockSessionId;

	const timer = setInterval(() => {
		if (!state.active) {
			clearInterval(timer);
			return;
		}

		// Read current lockfile to detect force takeover
		const currentLock = readLockfile(stateRoot);
		if (currentLock && currentLock.sessionId !== sessionId) {
			// Another session has taken over — yield gracefully
			clearInterval(timer);
			pi.sendMessage(
				{
					customType: "supervisor-yield",
					content: [{
						type: "text",
						text: "⚡ Another session has taken over supervisor duties. Yielding.",
					}],
					display: "Supervisor yielded to another session",
				},
				{ triggerTurn: false },
			);
			deactivateSupervisor(pi, state);
			return;
		}

		// Update heartbeat
		try {
			const lock = readLockfile(stateRoot);
			if (lock && lock.sessionId === sessionId) {
				lock.heartbeat = new Date().toISOString();
				writeLockfile(stateRoot, lock);
			}
		} catch {
			// Best-effort heartbeat — don't crash the supervisor
		}
	}, HEARTBEAT_INTERVAL_MS);

	// Unref the timer so it doesn't prevent Node.js from exiting
	if (timer && typeof timer === "object" && "unref" in timer) {
		timer.unref();
	}

	return timer;
}
