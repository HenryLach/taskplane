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
 * - Event tailer: batch-scoped consumption of events.jsonl (Step 3)
 * - Proactive notifications with autonomy-aware verbosity (Step 3)
 * - Task completion digest coalescing (Step 3)
 * - Engine event consumption + proactive notifications (Step 3)
 *
 * @module supervisor
 * @since TP-041
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync, statSync, openSync, readSync, closeSync } from "fs";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";
import type { OrchBatchRuntimeState, OrchestratorConfig, PersistedBatchState, EngineEvent, EngineEventType } from "./types.ts";
import type { Tier0Event, Tier0EventType } from "./persistence.ts";

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

	// ── Event Tailer (Step 3) ──────────────────────────────────────
	/** Event tailer state for consuming engine events */
	eventTailer: EventTailerState;
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
		eventTailer: freshEventTailerState(),
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

	// ── Event tailer (Step 3) ────────────────────────────────────
	// Start tailing events.jsonl for proactive notifications.
	// Initializes byte offset to current file size so we skip stale events.
	// Idempotent — safe even if called from takeover paths that may have
	// started a tailer previously (stopEventTailer is called in deactivate).
	startEventTailer(pi, state.eventTailer, state);

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

	// ── Stop event tailer (Step 3) ───────────────────────────────
	stopEventTailer(state.eventTailer);

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


// ── Engine Event Consumption + Notifications (TP-041 Step 3) ─────────

/**
 * Polling interval for the event tailer (10 seconds).
 *
 * Balances responsiveness (operator sees events quickly) with resource
 * efficiency (avoid excessive file reads). Chosen to be shorter than
 * the heartbeat interval (30s) so the supervisor reports events before
 * the next heartbeat.
 *
 * @since TP-041
 */
export const EVENT_POLL_INTERVAL_MS = 10_000;

/**
 * Coalescing window for task_complete digests (30 seconds).
 *
 * Instead of emitting one notification per task completion, the tailer
 * buffers completions and emits a periodic digest. This prevents turn
 * spam when many tasks complete in quick succession.
 *
 * @since TP-041
 */
export const TASK_DIGEST_INTERVAL_MS = 30_000;

/**
 * All known event types that appear in the unified events.jsonl.
 * Used for type narrowing when parsing lines.
 *
 * @since TP-041
 */
type UnifiedEventType = EngineEventType | Tier0EventType;

/**
 * A parsed event from the unified events.jsonl file.
 *
 * The file contains both EngineEvent and Tier0Event entries; we use
 * a discriminated union on the `type` field. For parsing safety, we
 * use a minimal common shape plus the union type.
 *
 * @since TP-041
 */
interface ParsedEvent {
	timestamp: string;
	type: UnifiedEventType;
	batchId: string;
	waveIndex: number;
	// ── EngineEvent-specific optional fields ─────────────────────
	phase?: string;
	taskIds?: string[];
	laneCount?: number;
	taskId?: string;
	durationMs?: number;
	outcome?: string;
	reason?: string;
	partialProgress?: boolean;
	laneNumber?: number;
	error?: string;
	testCount?: number;
	totalWaves?: number;
	succeededTasks?: number;
	failedTasks?: number;
	skippedTasks?: number;
	blockedTasks?: number;
	batchDurationMs?: number;
	// ── Tier0Event-specific optional fields ──────────────────────
	pattern?: string;
	attempt?: number;
	maxAttempts?: number;
	classification?: string;
	resolution?: string;
	suggestion?: string;
	affectedTaskIds?: string[];
	message?: string;
}

/**
 * Event types that are considered "significant" for proactive notification.
 *
 * - Engine lifecycle: wave_start, merge_success, merge_failed, batch_complete, batch_paused
 * - Tier 0 escalation: tier0_escalation (requires supervisor/operator attention)
 *
 * task_complete and task_failed are coalesced into periodic digests
 * rather than individual notifications.
 *
 * @since TP-041
 */
const SIGNIFICANT_EVENT_TYPES = new Set<UnifiedEventType>([
	"wave_start",
	"merge_start",
	"merge_success",
	"merge_failed",
	"batch_complete",
	"batch_paused",
	"tier0_escalation",
]);

/**
 * Event types that are coalesced into periodic digests.
 *
 * @since TP-041
 */
const DIGEST_EVENT_TYPES = new Set<UnifiedEventType>([
	"task_complete",
	"task_failed",
	"tier0_recovery_attempt",
	"tier0_recovery_success",
	"tier0_recovery_exhausted",
]);

/**
 * Buffered task events for digest coalescing.
 *
 * @since TP-041
 */
interface TaskDigestBuffer {
	/** Completed task IDs since last digest */
	completed: string[];
	/** Failed task IDs since last digest */
	failed: string[];
	/** Tier 0 recovery attempts since last digest */
	recoveryAttempts: number;
	/** Tier 0 recovery successes since last digest */
	recoverySuccesses: number;
	/** Tier 0 recovery exhausted since last digest */
	recoveryExhausted: number;
}

/**
 * Event tailer state — tracks the byte offset cursor, digest buffer,
 * and timer handles for the polling loop and digest flush.
 *
 * @since TP-041
 */
export interface EventTailerState {
	/** Whether the tailer is currently running */
	running: boolean;
	/** Byte offset into events.jsonl — only bytes after this are new */
	byteOffset: number;
	/** Partial line buffer (when a read ends mid-line) */
	partialLine: string;
	/** Active batch ID to filter events against */
	batchId: string;
	/** Task digest buffer for coalescing task_complete/task_failed */
	digestBuffer: TaskDigestBuffer;
	/** Polling timer handle */
	pollTimer: ReturnType<typeof setInterval> | null;
	/** Digest flush timer handle */
	digestTimer: ReturnType<typeof setInterval> | null;
}

/**
 * Create a fresh (stopped) event tailer state.
 *
 * @since TP-041
 */
export function freshEventTailerState(): EventTailerState {
	return {
		running: false,
		byteOffset: 0,
		partialLine: "",
		batchId: "",
		digestBuffer: freshDigestBuffer(),
		pollTimer: null,
		digestTimer: null,
	};
}

/**
 * Create a fresh digest buffer.
 *
 * @since TP-041
 */
function freshDigestBuffer(): TaskDigestBuffer {
	return {
		completed: [],
		failed: [],
		recoveryAttempts: 0,
		recoverySuccesses: 0,
		recoveryExhausted: 0,
	};
}

/**
 * Check if a digest buffer has any content worth flushing.
 *
 * @since TP-041
 */
function isDigestEmpty(buf: TaskDigestBuffer): boolean {
	return (
		buf.completed.length === 0 &&
		buf.failed.length === 0 &&
		buf.recoveryAttempts === 0 &&
		buf.recoverySuccesses === 0 &&
		buf.recoveryExhausted === 0
	);
}

/**
 * Read new bytes from the events JSONL file starting at the given offset.
 *
 * Uses low-level file descriptor operations for efficient tailing without
 * reading the entire file. Returns the raw UTF-8 string of new bytes,
 * or empty string if no new data.
 *
 * @param eventsPath - Full path to events.jsonl
 * @param byteOffset - Start reading from this byte offset
 * @returns [newData, newByteOffset] — the new data and the updated offset
 *
 * @since TP-041
 */
export function readNewBytes(eventsPath: string, byteOffset: number): [string, number] {
	if (!existsSync(eventsPath)) return ["", byteOffset];

	let fileSize: number;
	try {
		fileSize = statSync(eventsPath).size;
	} catch {
		return ["", byteOffset];
	}

	if (fileSize <= byteOffset) return ["", byteOffset];

	const bytesToRead = fileSize - byteOffset;
	const buffer = Buffer.alloc(bytesToRead);

	let fd: number | null = null;
	try {
		fd = openSync(eventsPath, "r");
		readSync(fd, buffer, 0, bytesToRead, byteOffset);
	} catch {
		return ["", byteOffset];
	} finally {
		if (fd !== null) {
			try { closeSync(fd); } catch { /* best-effort */ }
		}
	}

	return [buffer.toString("utf-8"), fileSize];
}

/**
 * Parse JSONL lines from raw data, handling partial lines.
 *
 * Returns parsed events and any remaining partial line (incomplete
 * trailing data that doesn't end with a newline).
 *
 * Malformed/partial JSON lines are skipped (best-effort, per R005 suggestion).
 *
 * @param data - Raw string data from the file
 * @param partialLine - Leftover partial line from previous read
 * @returns [parsedEvents, remainingPartialLine]
 *
 * @since TP-041
 */
export function parseJsonlLines(
	data: string,
	partialLine: string,
): [ParsedEvent[], string] {
	const combined = partialLine + data;
	const lines = combined.split("\n");

	// Last element is either empty (if data ended with \n) or a partial line
	const remaining = lines.pop() ?? "";

	const events: ParsedEvent[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue; // Skip empty lines

		try {
			const parsed = JSON.parse(trimmed) as Record<string, unknown>;
			// Minimal validation: must have timestamp, type, batchId
			if (
				typeof parsed.timestamp === "string" &&
				typeof parsed.type === "string" &&
				typeof parsed.batchId === "string"
			) {
				events.push(parsed as unknown as ParsedEvent);
			}
		} catch {
			// Malformed line — skip and continue (R005 suggestion)
		}
	}

	return [events, remaining];
}

/**
 * Format a significant event into an operator-facing notification string.
 *
 * The notification style varies by event type and autonomy level.
 *
 * @param event - The parsed event to format
 * @param autonomy - Current autonomy level
 * @returns Formatted notification string
 *
 * @since TP-041
 */
export function formatEventNotification(
	event: ParsedEvent,
	autonomy: SupervisorAutonomyLevel,
): string {
	const waveNum = event.waveIndex >= 0 ? event.waveIndex + 1 : "?";

	switch (event.type) {
		case "wave_start": {
			const taskCount = event.taskIds?.length ?? 0;
			const laneInfo = event.laneCount ? ` across ${event.laneCount} lanes` : "";
			return `🌊 **Wave ${waveNum} starting** with ${taskCount} task(s)${laneInfo}.`;
		}
		case "merge_start": {
			return `🔀 Wave ${waveNum} merge starting...`;
		}
		case "merge_success": {
			const waveProg = event.totalWaves
				? ` (${waveNum}/${event.totalWaves})`
				: "";
			const testInfo = event.testCount ? ` Tests pass (${event.testCount}).` : " Tests pass.";
			return `✅ **Wave ${waveNum} merged successfully**${waveProg}.${testInfo}`;
		}
		case "merge_failed": {
			const reason = event.reason || event.error || "unknown reason";
			const laneInfo = event.laneNumber !== undefined ? ` (lane ${event.laneNumber})` : "";
			if (autonomy === "autonomous") {
				return `⚠️ Wave ${waveNum} merge failed${laneInfo}: ${reason}. Attempting recovery...`;
			}
			return `⚠️ **Wave ${waveNum} merge failed**${laneInfo}: ${reason}.\n` +
				`   Recovery may be needed. Check the merge logs for details.`;
		}
		case "batch_complete": {
			const parts: string[] = [];
			if (event.succeededTasks !== undefined) parts.push(`${event.succeededTasks} succeeded`);
			if (event.failedTasks !== undefined && event.failedTasks > 0) parts.push(`${event.failedTasks} failed`);
			if (event.skippedTasks !== undefined && event.skippedTasks > 0) parts.push(`${event.skippedTasks} skipped`);
			if (event.blockedTasks !== undefined && event.blockedTasks > 0) parts.push(`${event.blockedTasks} blocked`);
			const summary = parts.length > 0 ? parts.join(", ") : "all tasks processed";
			const duration = event.batchDurationMs
				? ` in ${formatDuration(event.batchDurationMs)}`
				: "";
			return `🏁 **Batch complete!** ${summary}${duration}.`;
		}
		case "batch_paused": {
			const reason = event.reason || "unknown reason";
			if (autonomy === "interactive") {
				return `⏸️ **Batch paused:** ${reason}\n` +
					`   What would you like to do? Options: fix the issue, skip the task, or abort.`;
			}
			return `⏸️ **Batch paused:** ${reason}`;
		}
		case "tier0_escalation": {
			const pattern = event.pattern || "unknown";
			const suggestion = event.suggestion || "Manual intervention needed.";
			if (autonomy === "autonomous") {
				return `⚡ **Tier 0 escalation** (${pattern}): Investigating automatically. ${suggestion}`;
			}
			if (autonomy === "interactive") {
				return `❌ **Tier 0 escalation** (${pattern}): ${suggestion}\n` +
					`   Need your input on how to proceed.`;
			}
			// supervised
			return `⚡ **Tier 0 escalation** (${pattern}): ${suggestion}\n` +
				`   Diagnosing — will ask if novel recovery is needed.`;
		}
		default:
			return `📌 Event: ${event.type} (wave ${waveNum})`;
	}
}

/**
 * Format a task digest buffer into a summary notification.
 *
 * @param buf - Digest buffer to format
 * @param autonomy - Current autonomy level
 * @returns Formatted digest string, or null if buffer is empty
 *
 * @since TP-041
 */
export function formatTaskDigest(
	buf: TaskDigestBuffer,
	autonomy: SupervisorAutonomyLevel,
): string | null {
	if (isDigestEmpty(buf)) return null;

	const parts: string[] = [];

	if (buf.completed.length > 0) {
		if (autonomy === "interactive") {
			// Show individual task IDs in interactive mode
			parts.push(`✓ ${buf.completed.length} task(s) completed: ${buf.completed.join(", ")}`);
		} else {
			parts.push(`✓ ${buf.completed.length} task(s) completed`);
		}
	}

	if (buf.failed.length > 0) {
		// Always show failed task IDs — they need attention
		parts.push(`✗ ${buf.failed.length} task(s) failed: ${buf.failed.join(", ")}`);
	}

	if (buf.recoveryAttempts > 0 && autonomy !== "autonomous") {
		const successRate = buf.recoverySuccesses > 0
			? ` (${buf.recoverySuccesses} succeeded)`
			: "";
		parts.push(`🔄 ${buf.recoveryAttempts} recovery attempt(s)${successRate}`);
	}

	if (buf.recoveryExhausted > 0) {
		parts.push(`⚠️ ${buf.recoveryExhausted} recovery budget(s) exhausted`);
	}

	if (parts.length === 0) return null;

	return `📊 **Progress update:**\n   ${parts.join("\n   ")}`;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @since TP-041
 */
function formatDuration(ms: number): string {
	const secs = Math.floor(ms / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	const remainSecs = secs % 60;
	if (mins < 60) return `${mins}m${remainSecs > 0 ? ` ${remainSecs}s` : ""}`;
	const hours = Math.floor(mins / 60);
	const remainMins = mins % 60;
	return `${hours}h${remainMins > 0 ? ` ${remainMins}m` : ""}`;
}

/**
 * Should a notification for this event type be sent at the given autonomy level?
 *
 * Controls notification frequency:
 * - **interactive**: all significant events + verbose digests
 * - **supervised**: all significant events + concise digests
 * - **autonomous**: only failures, escalations, and batch completion; skip routine
 *
 * @since TP-041
 */
export function shouldNotify(
	eventType: UnifiedEventType,
	autonomy: SupervisorAutonomyLevel,
): boolean {
	// Always notify for terminal/failure events regardless of autonomy
	if (
		eventType === "batch_complete" ||
		eventType === "batch_paused" ||
		eventType === "merge_failed" ||
		eventType === "tier0_escalation"
	) {
		return true;
	}

	// Autonomous mode: skip routine progress events
	if (autonomy === "autonomous") {
		return false;
	}

	// Interactive and supervised: notify for all significant events
	return SIGNIFICANT_EVENT_TYPES.has(eventType);
}

/**
 * Process a batch of parsed events: filter to active batch, classify,
 * and emit notifications or buffer for digest.
 *
 * @param events - Parsed events from the JSONL file
 * @param tailer - Event tailer state (for batchId filter + digest buffer)
 * @param autonomy - Current autonomy level
 * @param notify - Callback to emit a notification to the operator
 *
 * @since TP-041
 */
export function processEvents(
	events: ParsedEvent[],
	tailer: EventTailerState,
	autonomy: SupervisorAutonomyLevel,
	notify: (text: string) => void,
): void {
	for (const event of events) {
		// ── Batch-scoped filter (R005-1) ─────────────────────────
		// Skip events from other batches. When batchId is empty
		// (pre-planning), accept all events — we'll get the real
		// batchId on the first event.
		if (tailer.batchId && event.batchId && event.batchId !== tailer.batchId) {
			continue;
		}

		// Update batchId if we were waiting for it (pre-planning)
		if (!tailer.batchId && event.batchId) {
			tailer.batchId = event.batchId;
		}

		// ── Classify: significant (immediate) vs digest (buffered) ──
		if (DIGEST_EVENT_TYPES.has(event.type)) {
			// Buffer for digest coalescing
			bufferDigestEvent(event, tailer.digestBuffer);
		} else if (shouldNotify(event.type, autonomy)) {
			// Emit immediate notification
			const text = formatEventNotification(event, autonomy);
			notify(text);
		}
		// Other event types (merge_start in autonomous mode, etc.) are silently consumed
	}
}

/**
 * Buffer a digest-class event into the digest buffer.
 *
 * @since TP-041
 */
function bufferDigestEvent(event: ParsedEvent, buf: TaskDigestBuffer): void {
	switch (event.type) {
		case "task_complete":
			if (event.taskId) buf.completed.push(event.taskId);
			break;
		case "task_failed":
			if (event.taskId) buf.failed.push(event.taskId);
			break;
		case "tier0_recovery_attempt":
			buf.recoveryAttempts++;
			break;
		case "tier0_recovery_success":
			buf.recoverySuccesses++;
			break;
		case "tier0_recovery_exhausted":
			buf.recoveryExhausted++;
			break;
	}
}

/**
 * Start the event tailer — polls events.jsonl for new events and
 * emits proactive notifications to the operator.
 *
 * The tailer:
 * 1. Polls at EVENT_POLL_INTERVAL_MS for new bytes in events.jsonl
 * 2. Parses new JSONL lines, filtering to active batchId
 * 3. Significant events → immediate notification via pi.sendMessage
 * 4. task_complete/task_failed → buffered into periodic digests
 *
 * Idempotent: safe to call when already running (no-op).
 *
 * @param pi - ExtensionAPI for sending notifications
 * @param tailer - Event tailer state (mutated)
 * @param supervisorState - Supervisor state (for config + stateRoot)
 *
 * @since TP-041
 */
export function startEventTailer(
	pi: ExtensionAPI,
	tailer: EventTailerState,
	supervisorState: SupervisorState,
): void {
	if (tailer.running) return; // Idempotent guard (R005-2)

	const stateRoot = supervisorState.stateRoot;
	const eventsPath = join(stateRoot, ".pi", "supervisor", "events.jsonl");
	const autonomy = supervisorState.config.autonomy;

	tailer.running = true;
	tailer.batchId = supervisorState.batchId;

	// Initialize byte offset to current file size so we only process
	// events emitted after activation (not stale events from previous batches).
	// For takeover paths, the activation message's standing orders tell the
	// supervisor to read the full events file manually for context.
	if (existsSync(eventsPath)) {
		try {
			tailer.byteOffset = statSync(eventsPath).size;
		} catch {
			tailer.byteOffset = 0;
		}
	} else {
		tailer.byteOffset = 0;
	}

	// Notification callback — sends as a supervisor event message
	const notify = (text: string) => {
		if (!supervisorState.active) return; // Guard: don't notify after deactivation
		pi.sendMessage(
			{
				customType: "supervisor-event",
				content: [{ type: "text", text }],
				display: text.replace(/\*\*/g, "").substring(0, 80),
			},
			{ triggerTurn: true, deliverAs: "nextTurn" },
		);
	};

	// ── Poll timer ───────────────────────────────────────────────
	tailer.pollTimer = setInterval(() => {
		if (!supervisorState.active || !tailer.running) {
			stopEventTailer(tailer);
			return;
		}

		const [newData, newOffset] = readNewBytes(eventsPath, tailer.byteOffset);
		if (!newData) return; // No new data

		tailer.byteOffset = newOffset;
		const [events, remaining] = parseJsonlLines(newData, tailer.partialLine);
		tailer.partialLine = remaining;

		processEvents(events, tailer, autonomy, notify);
	}, EVENT_POLL_INTERVAL_MS);

	// ── Digest flush timer ───────────────────────────────────────
	tailer.digestTimer = setInterval(() => {
		if (!supervisorState.active || !tailer.running) {
			stopEventTailer(tailer);
			return;
		}

		if (isDigestEmpty(tailer.digestBuffer)) return;

		const digest = formatTaskDigest(tailer.digestBuffer, autonomy);
		if (digest) {
			notify(digest);
		}

		// Reset buffer
		tailer.digestBuffer = freshDigestBuffer();
	}, TASK_DIGEST_INTERVAL_MS);

	// Unref timers so they don't prevent Node.js exit
	if (tailer.pollTimer && typeof tailer.pollTimer === "object" && "unref" in tailer.pollTimer) {
		tailer.pollTimer.unref();
	}
	if (tailer.digestTimer && typeof tailer.digestTimer === "object" && "unref" in tailer.digestTimer) {
		tailer.digestTimer.unref();
	}
}

/**
 * Stop the event tailer.
 *
 * Clears timers and flushes any remaining digest buffer (best-effort,
 * the final digest is not sent — it would be stale).
 *
 * Idempotent: safe to call when already stopped (no-op).
 *
 * @param tailer - Event tailer state (mutated)
 *
 * @since TP-041
 */
export function stopEventTailer(tailer: EventTailerState): void {
	if (!tailer.running) return; // Idempotent guard

	if (tailer.pollTimer) {
		clearInterval(tailer.pollTimer);
		tailer.pollTimer = null;
	}

	if (tailer.digestTimer) {
		clearInterval(tailer.digestTimer);
		tailer.digestTimer = null;
	}

	tailer.running = false;
	tailer.partialLine = "";
	tailer.digestBuffer = freshDigestBuffer();
}
