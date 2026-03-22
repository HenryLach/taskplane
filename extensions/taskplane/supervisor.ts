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
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
function resolvePriverPath(): string {
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
 * @param batchState - Current batch runtime state
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
	const primerPath = resolvePriverPath();
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

- **Batch ID:** ${batchState.batchId}
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
 * @since TP-041
 */
export interface SupervisorState {
	/** Whether the supervisor is currently active */
	active: boolean;
	/** Batch ID the supervisor is monitoring (empty if inactive) */
	batchId: string;
	/** The system prompt being injected */
	systemPrompt: string;
	/** Supervisor configuration */
	config: SupervisorConfig;
}

/**
 * Create fresh (inactive) supervisor state.
 */
export function freshSupervisorState(): SupervisorState {
	return {
		active: false,
		batchId: "",
		systemPrompt: "",
		config: { ...DEFAULT_SUPERVISOR_CONFIG },
	};
}

/**
 * Activate the supervisor agent in the current pi session.
 *
 * This is called after `startBatchAsync()` in the `/orch` command handler.
 * It:
 * 1. Builds the supervisor system prompt with batch context
 * 2. Stores the prompt in supervisor state (for before_agent_start injection)
 * 3. Sends an activation message via pi.sendMessage() with triggerTurn=true
 *    to kick off the supervisor's first turn
 *
 * The supervisor model can be configured via `supervisor.model` in settings.
 * If empty, the session's current model is used (inheritance).
 *
 * @param pi - The ExtensionAPI instance
 * @param state - Mutable supervisor state to populate
 * @param batchState - Current batch runtime state
 * @param orchConfig - Orchestrator configuration
 * @param supervisorConfig - Supervisor-specific configuration
 * @param stateRoot - Root path for .pi/ state directory
 *
 * @since TP-041
 */
export function activateSupervisor(
	pi: ExtensionAPI,
	state: SupervisorState,
	batchState: OrchBatchRuntimeState,
	orchConfig: OrchestratorConfig,
	supervisorConfig: SupervisorConfig,
	stateRoot: string,
): void {
	// Build the system prompt
	const systemPrompt = buildSupervisorSystemPrompt(
		batchState,
		orchConfig,
		supervisorConfig,
		stateRoot,
	);

	// Update supervisor state
	state.active = true;
	state.batchId = batchState.batchId;
	state.systemPrompt = systemPrompt;
	state.config = { ...supervisorConfig };

	// Send activation message to trigger the supervisor's first turn.
	// The content tells the LLM what just happened; the system prompt
	// (injected via before_agent_start) provides the full identity/context.
	pi.sendMessage(
		{
			customType: "supervisor-activation",
			content: [
				{
					type: "text",
					text:
						`🔀 **Batch ${batchState.batchId} started.** ` +
						`${batchState.totalTasks} tasks across ${batchState.totalWaves} waves. ` +
						`Supervisor activated (autonomy: ${supervisorConfig.autonomy}).\n\n` +
						`Read your operational primer and batch state, then report initial status to the operator.`,
				},
			],
			display: "Supervisor activated for batch " + batchState.batchId,
		},
		{ triggerTurn: true, deliverAs: "nextTurn" },
	);
}

/**
 * Deactivate the supervisor agent.
 *
 * Called when a batch completes, fails terminally, or is aborted.
 * Clears the supervisor state so the before_agent_start hook stops
 * injecting the supervisor system prompt.
 *
 * @since TP-041
 */
export function deactivateSupervisor(state: SupervisorState): void {
	state.active = false;
	state.batchId = "";
	state.systemPrompt = "";
}

/**
 * Register the before_agent_start hook for persistent system prompt injection.
 *
 * While the supervisor is active, every LLM turn gets the supervisor system
 * prompt injected. This ensures the supervisor identity persists across the
 * entire conversation — even after context compaction or session navigation.
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
		if (!state.active) {
			return undefined; // No-op: don't modify system prompt
		}

		// Return the supervisor system prompt to replace/augment the default.
		// Per the pi API, returning { systemPrompt } replaces the system prompt
		// for this turn. If multiple extensions return this, they are chained.
		return {
			systemPrompt: state.systemPrompt,
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
