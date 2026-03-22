/**
 * Supervisor agent module — activates an interactive LLM agent in the pi
 * session after `/orch` starts a non-blocking batch.
 *
 * The supervisor monitors engine events, handles failures, and keeps the
 * operator informed. It shares the pi session, so the operator can converse
 * naturally ("how's it going?", "fix it", "I'm going to bed") while the
 * batch runs.
 *
 * Key components (this step — Step 1):
 * - System prompt design (identity, context, capabilities, standing orders)
 * - Activation after engine starts (via pi.sendMessage with triggerTurn)
 * - System prompt persistence across turns (via before_agent_start event)
 * - Model inheritance + config override
 *
 * @module supervisor
 * @since TP-041
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";
import type { OrchBatchRuntimeState, OrchestratorConfig } from "./types.ts";

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
