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
 * - Recovery action classification model (Step 4)
 * - Audit trail logging to actions.jsonl (Step 4)
 * - Autonomy-driven confirmation behavior (Step 4)
 *
 * @module supervisor
 * @since TP-041
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync, mkdirSync, renameSync, statSync, openSync, readSync, closeSync, appendFileSync } from "fs";
import { stat as fsStat, open as fsOpen, readFile as fsReadFile, writeFile as fsWriteFile, rename as fsRename } from "fs/promises";
import { execFileSync } from "child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";
import type { OrchBatchRuntimeState, OrchestratorConfig, PersistedBatchState, EngineEvent, EngineEventType } from "./types.ts";
import type { Tier0Event, Tier0EventType } from "./persistence.ts";

// ── Recovery Action Classification (TP-041 Step 4) ───────────────────

/**
 * Recovery action classification.
 *
 * Determines whether an action requires operator confirmation based
 * on the current autonomy level. From spec §6.3:
 *
 * - **diagnostic**: Reading state, running non-mutating commands.
 *   Always allowed at all autonomy levels.
 * - **tier0_known**: Known recovery patterns (session restart, worktree
 *   cleanup, merge retry). Automatic in supervised/autonomous modes.
 * - **destructive**: State mutations, git operations that alter history,
 *   session kills, batch-state edits. Requires confirmation in
 *   interactive mode, conditional in supervised mode.
 *
 * Decision matrix:
 *
 * | Classification | Interactive | Supervised    | Autonomous |
 * |----------------|-------------|---------------|------------|
 * | diagnostic     | auto        | auto          | auto       |
 * | tier0_known    | ASK         | auto          | auto       |
 * | destructive    | ASK         | ASK           | auto       |
 *
 * @since TP-041
 */
export type RecoveryActionClassification = "diagnostic" | "tier0_known" | "destructive";

/**
 * Determines whether operator confirmation is required for a given
 * action classification at a given autonomy level.
 *
 * @param classification - The action's classification
 * @param autonomy - Current supervisor autonomy level
 * @returns true if the supervisor should ask the operator before executing
 *
 * @since TP-041
 */
export function requiresConfirmation(
	classification: RecoveryActionClassification,
	autonomy: SupervisorAutonomyLevel,
): boolean {
	// Diagnostics never require confirmation
	if (classification === "diagnostic") return false;

	// Autonomous mode never asks
	if (autonomy === "autonomous") return false;

	// Interactive mode asks for everything non-diagnostic
	if (autonomy === "interactive") return true;

	// Supervised mode: auto for tier0_known, ask for destructive
	return classification === "destructive";
}

/**
 * Examples of actions in each classification category.
 *
 * Used by the system prompt to give the supervisor concrete guidance
 * on how to classify its recovery actions.
 *
 * @since TP-041
 */
export const ACTION_CLASSIFICATION_EXAMPLES: Readonly<Record<RecoveryActionClassification, readonly string[]>> = {
	diagnostic: [
		"Reading batch-state.json, STATUS.md, events.jsonl, merge results",
		"Running git status, git log, git diff",
		"Running test suites (node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test ..., etc.)",
		"Inspecting active agents and lane status (list_active_agents, read_agent_status)",
		"Checking worktree health (git worktree list)",
		"Reading any file for diagnostics",
	],
	tier0_known: [
		"Triggering graceful wrap-up/retry flow for a stalled worker lane",
		"Cleaning up stale worktrees for retry",
		"Retrying a timed-out merge",
		"Resetting a session name collision",
		"Clearing a git lock file (.git/index.lock)",
	],
	destructive: [
		"Forcing lane/batch termination paths (for example orch_abort(hard=true))",
		"Editing batch-state.json fields",
		"Running git reset, git merge, git checkout -B",
		"Removing worktrees (git worktree remove)",
		"Modifying STATUS.md or .DONE files",
		"Deleting git branches (git branch -D)",
		"Skipping tasks or waves",
	],
};


// ── Audit Trail (TP-041 Step 4) ──────────────────────────────────────

/**
 * Structured audit trail entry written to `.pi/supervisor/actions.jsonl`.
 *
 * Every supervisor recovery action produces one entry. Destructive actions
 * MUST be logged **before** execution (pre-action entry with result="pending"),
 * then updated with the outcome after execution (result entry).
 *
 * Non-destructive diagnostics may be logged post-execution for completeness,
 * but pre-action logging is not required.
 *
 * Schema contract: these fields are stable for takeover rehydration
 * (buildTakeoverSummary reads this file). Adding new optional fields
 * is safe; removing or renaming existing fields is a breaking change.
 *
 * @since TP-041
 */
export interface AuditTrailEntry {
	/** ISO 8601 timestamp of this log entry */
	ts: string;
	/** Action identifier — what the supervisor did (e.g., "merge_retry", "kill_session", "read_state") */
	action: string;
	/** Recovery action classification */
	classification: RecoveryActionClassification;
	/** Human-readable context — why this action was taken */
	context: string;
	/** Command or operation executed (e.g., "git merge --no-ff task/lane-2", "read batch-state.json") */
	command: string;
	/** Outcome of the action: "pending" (pre-action), "success", "failure", "skipped" */
	result: "pending" | "success" | "failure" | "skipped";
	/** Result detail — error message on failure, summary on success */
	detail: string;
	/** Batch ID for correlation */
	batchId: string;
	/** Optional: wave index if the action is wave-scoped */
	waveIndex?: number;
	/** Optional: lane number if the action is lane-scoped */
	laneNumber?: number;
	/** Optional: task ID if the action is task-scoped */
	taskId?: string;
	/** Optional: duration in milliseconds (populated on result entries) */
	durationMs?: number;
}

/**
 * Resolve the audit trail file path.
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @returns Absolute path to actions.jsonl
 *
 * @since TP-041
 */
export function auditTrailPath(stateRoot: string): string {
	return join(stateRoot, ".pi", "supervisor", "actions.jsonl");
}

/**
 * Append a single audit trail entry to actions.jsonl.
 *
 * Best-effort and non-fatal: logging failures do not crash or block
 * recovery actions. If the file or directory doesn't exist, it is
 * created. If the append fails, the error is silently swallowed.
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @param entry - The audit entry to append
 *
 * @since TP-041
 */
export function appendAuditEntry(stateRoot: string, entry: AuditTrailEntry): void {
	try {
		const dir = join(stateRoot, ".pi", "supervisor");
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const path = auditTrailPath(stateRoot);
		const line = JSON.stringify(entry) + "\n";
		appendFileSync(path, line, "utf-8");
	} catch {
		// Best-effort: logging failures must not crash recovery
	}
}

/**
 * Log a recovery action to the audit trail.
 *
 * Convenience wrapper around appendAuditEntry that fills in timestamp
 * and batchId automatically from the supervisor state.
 *
 * For destructive actions, call this BEFORE execution with result="pending",
 * then call again AFTER execution with the actual result.
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @param batchId - Current batch ID
 * @param fields - Action fields (action, classification, context, command, result, detail, etc.)
 *
 * @since TP-041
 */
export function logRecoveryAction(
	stateRoot: string,
	batchId: string,
	fields: Omit<AuditTrailEntry, "ts" | "batchId">,
): void {
	const entry: AuditTrailEntry = {
		ts: new Date().toISOString(),
		batchId,
		...fields,
	};
	appendAuditEntry(stateRoot, entry);
}

/**
 * Read audit trail entries from actions.jsonl.
 *
 * Returns parsed entries, skipping malformed lines (best-effort).
 * Useful for:
 * - Takeover rehydration (buildTakeoverSummary)
 * - Test verification
 * - Operator "what happened?" queries
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @param options - Optional filters: limit (max entries, from tail), batchId (filter by batch)
 * @returns Array of parsed audit entries (most recent last)
 *
 * @since TP-041
 */
export function readAuditTrail(
	stateRoot: string,
	options?: { limit?: number; batchId?: string },
): AuditTrailEntry[] {
	const path = auditTrailPath(stateRoot);
	if (!existsSync(path)) return [];

	try {
		const raw = readFileSync(path, "utf-8").trim();
		if (!raw) return [];

		const lines = raw.split("\n");
		const entries: AuditTrailEntry[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const parsed = JSON.parse(trimmed) as AuditTrailEntry;
				// Minimal validation: must have ts, action, batchId
				if (typeof parsed.ts !== "string" || typeof parsed.action !== "string") continue;

				// Apply batchId filter if specified
				if (options?.batchId && parsed.batchId !== options.batchId) continue;

				entries.push(parsed);
			} catch {
				// Skip malformed lines
			}
		}

		// Apply tail limit if specified
		if (options?.limit && entries.length > options.limit) {
			return entries.slice(-options.limit);
		}

		return entries;
	} catch {
		return [];
	}
}


// ── Branch Protection Detection (TP-043) ─────────────────────────────

/**
 * Result of branch protection detection.
 *
 * - `protected`: Branch has protection rules enabled (require PRs)
 * - `unprotected`: No protection rules found (direct push/merge OK)
 * - `unknown`: Detection failed (no `gh` CLI, no remote, auth issues, etc.)
 *
 * @since TP-043
 */
export type BranchProtectionStatus = "protected" | "unprotected" | "unknown";

/**
 * Detect whether a branch has protection rules on GitHub.
 *
 * Uses `gh api repos/{owner}/{repo}/branches/{branch}/protection`:
 * - HTTP 200 → protected (rules exist)
 * - HTTP 404 → unprotected (no rules)
 * - Any error → unknown (gh unavailable, no remote, auth issue, etc.)
 *
 * Extracts owner/repo from the git remote URL via `gh repo view`.
 *
 * @param branch - Branch name to check (e.g., "main")
 * @param cwd - Working directory with the git repo
 * @returns Branch protection status
 *
 * @since TP-043
 */
export function detectBranchProtection(
	branch: string,
	cwd: string,
): BranchProtectionStatus {
	try {
		// Get owner/repo from gh (handles SSH, HTTPS, and gh-specific remotes)
		const repoInfo = execFileSync("gh", ["repo", "view", "--json", "owner,name", "--jq", ".owner.login + \"/\" + .name"], {
			encoding: "utf-8",
			timeout: 15_000,
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();

		if (!repoInfo || !repoInfo.includes("/")) {
			return "unknown";
		}

		// Check branch protection via GitHub API
		const result = execFileSync("gh", ["api", `repos/${repoInfo}/branches/${branch}/protection`, "--silent"], {
			encoding: "utf-8",
			timeout: 15_000,
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// If we get here (no error), the API returned 200 → branch is protected
		return "protected";
	} catch (err: unknown) {
		const e = err as { stderr?: string; status?: number };
		const stderr = e.stderr || "";

		// gh api returns exit code 1 with "HTTP 404" for unprotected branches
		if (stderr.includes("HTTP 404") || stderr.includes("Not Found")) {
			return "unprotected";
		}

		// Any other error (no gh, no auth, no remote, network, etc.)
		return "unknown";
	}
}


// ── Supervisor-Managed Integration Flow (TP-043) ─────────────────────

/**
 * Integration plan describes the supervisor's proposed integration action.
 *
 * Built after analyzing the batch state, branch relationships, and
 * branch protection status. Presented to the operator in supervised mode;
 * executed directly in auto mode.
 *
 * @since TP-043
 */
export interface IntegrationPlan {
	/** The integration mode to use: ff, merge, or pr */
	mode: "ff" | "merge" | "pr";
	/** Orch branch to integrate from */
	orchBranch: string;
	/** Base branch to integrate into */
	baseBranch: string;
	/** Batch ID for logging/audit */
	batchId: string;
	/** Whether the base branch is protected */
	branchProtection: BranchProtectionStatus;
	/** Human-readable rationale for the chosen mode */
	rationale: string;
	/** Number of succeeded tasks (for summary) */
	succeededTasks: number;
	/** Number of failed tasks (for summary) */
	failedTasks: number;
}

/**
 * Build an integration plan based on the batch state and branch status.
 *
 * Mode selection logic:
 * 1. If base branch is protected → PR mode (can't push directly)
 * 2. If branches have diverged → merge mode (ff not possible)
 * 3. Otherwise → ff mode (cleanest)
 *
 * @param batchState - Runtime batch state (orchBranch, baseBranch, counts)
 * @param cwd - Working directory with the git repo
 * @returns Integration plan, or null if integration is not possible
 *
 * @since TP-043
 */
export function buildIntegrationPlan(
	batchState: OrchBatchRuntimeState,
	cwd: string,
	protectionOverride?: BranchProtectionStatus,
): IntegrationPlan | null {
	if (!batchState.orchBranch || !batchState.baseBranch) {
		return null;
	}

	if (batchState.succeededTasks === 0) {
		return null; // Nothing to integrate
	}

	const orchBranch = batchState.orchBranch;
	const baseBranch = batchState.baseBranch;
	const batchId = batchState.batchId;

	// Step 1: Check branch protection (injectable for testing)
	const protection = protectionOverride ?? detectBranchProtection(baseBranch, cwd);

	if (protection === "protected") {
		return {
			mode: "pr",
			orchBranch,
			baseBranch,
			batchId,
			branchProtection: protection,
			rationale: `Base branch \`${baseBranch}\` is protected — creating a pull request for review.`,
			succeededTasks: batchState.succeededTasks,
			failedTasks: batchState.failedTasks,
		};
	}

	if (protection === "unknown") {
		// Safe fallback: when protection status can't be determined
		// (gh CLI unavailable, no remote, etc.), default to PR mode
		// to avoid accidentally pushing to a protected branch.
		return {
			mode: "pr",
			orchBranch,
			baseBranch,
			batchId,
			branchProtection: protection,
			rationale: `Could not detect branch protection for \`${baseBranch}\` — defaulting to PR mode for safety.`,
			succeededTasks: batchState.succeededTasks,
			failedTasks: batchState.failedTasks,
		};
	}

	// Step 2: Check ff-ability (is baseBranch ancestor of orchBranch?)
	try {
		execFileSync("git", ["merge-base", "--is-ancestor", baseBranch, orchBranch], {
			encoding: "utf-8",
			timeout: 10_000,
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		// If no error, baseBranch is ancestor → ff is possible
		return {
			mode: "ff",
			orchBranch,
			baseBranch,
			batchId,
			branchProtection: protection,
			rationale: `Branches are linear — fast-forward merge (cleanest history).`,
			succeededTasks: batchState.succeededTasks,
			failedTasks: batchState.failedTasks,
		};
	} catch {
		// Branches have diverged — need merge commit
		return {
			mode: "merge",
			orchBranch,
			baseBranch,
			batchId,
			branchProtection: protection,
			rationale: `Branches have diverged — creating a merge commit.`,
			succeededTasks: batchState.succeededTasks,
			failedTasks: batchState.failedTasks,
		};
	}
}

/**
 * Format an integration plan as a human-readable notification.
 *
 * Used in supervised mode to present the plan for operator confirmation.
 *
 * @param plan - The integration plan to format
 * @returns Formatted notification string
 *
 * @since TP-043
 */
export function formatIntegrationPlan(plan: IntegrationPlan): string {
	const modeLabels: Record<string, string> = {
		ff: "fast-forward merge",
		merge: "merge commit",
		pr: "pull request",
	};

	const lines: string[] = [];
	lines.push(`🔀 **Integration Plan**`);
	lines.push(``);
	lines.push(`- **Mode:** ${modeLabels[plan.mode] || plan.mode}`);
	lines.push(`- **From:** \`${plan.orchBranch}\` → \`${plan.baseBranch}\``);
	lines.push(`- **Tasks:** ${plan.succeededTasks} succeeded${plan.failedTasks > 0 ? `, ${plan.failedTasks} failed` : ""}`);
	lines.push(`- **Rationale:** ${plan.rationale}`);

	if (plan.branchProtection === "protected") {
		lines.push(`- **Note:** Branch protection detected — PR mode is required.`);
	}

	return lines.join("\n");
}

/**
 * Format a message describing the integration outcome for the supervisor
 * to present to the operator.
 *
 * @param plan - The integration plan that was executed
 * @param success - Whether the integration succeeded
 * @param detail - Additional detail (PR URL, error message, etc.)
 * @returns Formatted outcome message
 *
 * @since TP-043
 */
export function formatIntegrationOutcome(
	plan: IntegrationPlan,
	success: boolean,
	detail: string,
): string {
	if (success) {
		const modeLabel = plan.mode === "ff" ? "Fast-forwarded" : plan.mode === "merge" ? "Merged" : "Created PR for";
		return `✅ **Integration complete!** ${modeLabel} \`${plan.orchBranch}\` → \`${plan.baseBranch}\`.\n${detail}`;
	}
	return `❌ **Integration failed** (\`${plan.orchBranch}\` → \`${plan.baseBranch}\`).\n${detail}`;
}

/**
 * Integration executor callback type.
 *
 * Wraps `executeIntegration` from extension.ts to avoid circular imports.
 * The callback receives the plan mode and context, and returns the result.
 *
 * @since TP-043 R002
 */
export type IntegrationExecutor = (
	mode: "ff" | "merge" | "pr",
	context: { orchBranch: string; baseBranch: string; batchId: string; currentBranch: string; notices: string[] },
) => { success: boolean; integratedLocally: boolean; commitCount: string; message: string; error?: string };

/**
 * Dependencies for programmatic CI polling and PR merge (R002-2).
 *
 * Injected alongside the IntegrationExecutor to provide gh CLI access
 * for CI status checks and PR merge operations.
 *
 * @since TP-043
 */
export interface CiDeps {
	/** Run an arbitrary command (e.g., gh CLI) in the repo root. */
	runCommand: (cmd: string, args: string[]) => { ok: boolean; stdout: string; stderr: string };
	/** Run a git command in the repo root. */
	runGit: (args: string[]) => { ok: boolean; stdout: string; stderr: string };
	/** Delete the batch state file. */
	deleteBatchState: () => void;
}

/**
 * Poll PR CI status checks programmatically.
 *
 * Polls `gh pr checks <branch> --json name,state,conclusion` up to
 * maxAttempts times with a delay between each poll. Returns a summary
 * of the CI outcome.
 *
 * @param orchBranch - The branch the PR was created from
 * @param deps - CI deps (runCommand for gh CLI)
 * @param maxAttempts - Maximum polling attempts (default: 30 → ~5 min at 10s intervals)
 * @param delayMs - Delay between polls in ms (default: 10_000 → 10s)
 * @returns CI check result
 *
 * @since TP-043
 */
export async function pollPrCiStatus(
	orchBranch: string,
	deps: CiDeps,
	maxAttempts: number = 30,
	delayMs: number = 10_000,
): Promise<{ status: "pass" | "fail" | "timeout" | "no-checks"; detail: string }> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		// Wait before polling (except first attempt — check immediately)
		if (attempt > 1) {
			await new Promise(resolve => setTimeout(resolve, delayMs));
		}

		const result = deps.runCommand("gh", [
			"pr", "checks", orchBranch, "--json", "name,state,conclusion",
		]);

		if (!result.ok) {
			// gh pr checks failed — may be no PR or no checks configured
			if (result.stderr.includes("no checks") || result.stderr.includes("no status checks")) {
				return { status: "no-checks", detail: "No CI checks are configured for this repository." };
			}
			// On first attempt, the PR may not be fully created yet — retry
			if (attempt === 1) continue;
			return { status: "fail", detail: `Failed to query PR checks: ${result.stderr}` };
		}

		// Parse the JSON array of checks
		let checks: Array<{ name: string; state: string; conclusion: string }>;
		try {
			checks = JSON.parse(result.stdout);
		} catch {
			continue; // Malformed output — retry
		}

		if (checks.length === 0) {
			return { status: "no-checks", detail: "No CI checks are configured for this repository." };
		}

		// Check if all checks are complete
		const allComplete = checks.every(c =>
			c.state === "COMPLETED" || c.state === "completed",
		);
		if (!allComplete) continue; // Some still pending — keep polling

		// All complete — check conclusions
		const allPassing = checks.every(c =>
			c.conclusion === "SUCCESS" || c.conclusion === "success" ||
			c.conclusion === "NEUTRAL" || c.conclusion === "neutral" ||
			c.conclusion === "SKIPPED" || c.conclusion === "skipped",
		);

		if (allPassing) {
			return { status: "pass", detail: `All ${checks.length} CI check(s) passed.` };
		}

		// Some checks failed
		const failed = checks.filter(c =>
			c.conclusion !== "SUCCESS" && c.conclusion !== "success" &&
			c.conclusion !== "NEUTRAL" && c.conclusion !== "neutral" &&
			c.conclusion !== "SKIPPED" && c.conclusion !== "skipped",
		);
		const failedNames = failed.map(c => `${c.name}: ${c.conclusion}`).join(", ");
		return { status: "fail", detail: `CI check(s) failed: ${failedNames}` };
	}

	return { status: "timeout", detail: `CI checks did not complete within ${maxAttempts} polling attempts.` };
}

/**
 * Merge a PR via gh CLI after CI passes.
 *
 * Uses regular merge (preserves per-commit history from orch branches).
 * Falls back to squash if regular merge is not allowed by repo rules.
 *
 * Regular merge is preferred because squash collapses all branch commits
 * into one, which loses per-task attribution and can silently drop
 * commits made by other agents between push and merge.
 *
 * @param orchBranch - The branch the PR was created from
 * @param deps - CI deps (runCommand for gh CLI)
 * @returns Merge result
 *
 * @since TP-043
 */
export function mergePr(
	orchBranch: string,
	deps: CiDeps,
): { success: boolean; detail: string } {
	// Try regular merge first (preserves per-commit history)
	const mergeResult = deps.runCommand("gh", [
		"pr", "merge", orchBranch, "--merge", "--delete-branch",
	]);
	if (mergeResult.ok) {
		return { success: true, detail: "PR merged and remote branch deleted." };
	}

	// Regular merge not allowed — try squash as fallback
	const squashResult = deps.runCommand("gh", [
		"pr", "merge", orchBranch, "--squash", "--delete-branch",
	]);
	if (squashResult.ok) {
		return { success: true, detail: "PR merged (squash) and remote branch deleted." };
	}

	return {
		success: false,
		detail: `PR merge failed: ${squashResult.stderr || mergeResult.stderr}`,
	};
}

/**
 * Dependencies for batch summary generation within integration flows.
 *
 * Passed through triggerSupervisorIntegration to ensure summary is
 * generated before supervisor deactivation on all terminal paths.
 *
 * @since TP-043
 */
export interface SummaryDeps {
	/** Operator identifier for file naming */
	opId: string;
	/** Batch diagnostics (taskExits, batchCost) — null if unavailable */
	diagnostics: { taskExits: Record<string, { classification: string; cost: number; durationSec: number }>; batchCost: number } | null;
	/** Merge results for cost breakdown */
	mergeResults: Array<{ waveIndex: number; status: string; failedLane: number | null; failureReason: string | null }>;
}

/**
 * Execute the full PR lifecycle: poll CI, merge on success, clean up.
 *
 * Called after `executeIntegration("pr", ...)` succeeds (PR created).
 * Polls CI status, merges when checks pass, reports failures.
 * Always generates batch summary and deactivates the supervisor at
 * the end (deterministic shutdown).
 *
 * @param plan - Integration plan (for branch/batch info)
 * @param ciDeps - CI deps for gh CLI operations
 * @param pi - ExtensionAPI for messaging
 * @param state - Supervisor state (for deactivation)
 * @param batchState - Runtime batch state (for summary generation)
 * @param summaryDeps - Summary generation dependencies (optional, skipped if null)
 *
 * @since TP-043
 */
async function handlePrLifecycle(
	plan: IntegrationPlan,
	ciDeps: CiDeps,
	pi: ExtensionAPI,
	state: SupervisorState,
	batchState?: OrchBatchRuntimeState,
	summaryDeps?: SummaryDeps | null,
): Promise<void> {
	// Poll CI status
	const ciResult = await pollPrCiStatus(plan.orchBranch, ciDeps);

	if (ciResult.status === "pass" || ciResult.status === "no-checks") {
		// CI passed (or no checks) — merge the PR
		const mergeOutcome = mergePr(plan.orchBranch, ciDeps);
		if (mergeOutcome.success) {
			// Clean up local state after remote merge
			ciDeps.deleteBatchState();
			ciDeps.runGit(["branch", "-D", plan.orchBranch]);
			pi.sendMessage(
				{
					customType: "supervisor-integration-result",
					content: [{
						type: "text",
						text:
							`✅ **Integration complete!** PR merged into \`${plan.baseBranch}\`.\n` +
							`${ciResult.detail}\n${mergeOutcome.detail}`,
					}],
					display: "Integration complete — PR merged",
				},
				{ triggerTurn: false },
			);
		} else {
			pi.sendMessage(
				{
					customType: "supervisor-integration-result",
					content: [{
						type: "text",
						text:
							`⚠️ **CI passed but merge failed.** ${mergeOutcome.detail}\n` +
							`The PR is still open — merge manually on GitHub.`,
					}],
					display: "CI passed but PR merge failed",
				},
				{ triggerTurn: false },
			);
		}
	} else if (ciResult.status === "fail") {
		pi.sendMessage(
			{
				customType: "supervisor-integration-result",
				content: [{
					type: "text",
					text:
						`❌ **CI checks failed.** ${ciResult.detail}\n` +
						`The PR is still open. Fix the issues and merge manually, or close and retry.`,
				}],
				display: "CI checks failed — manual intervention needed",
			},
			{ triggerTurn: false },
		);
	} else {
		// timeout
		pi.sendMessage(
			{
				customType: "supervisor-integration-result",
				content: [{
					type: "text",
					text:
						`⏰ **CI check timeout.** ${ciResult.detail}\n` +
						`The PR is still open. Check CI status manually and merge when ready.`,
				}],
				display: "CI check timeout — check manually",
			},
			{ triggerTurn: false },
		);
	}

	// TP-043: Generate batch summary before deactivation
	if (batchState && summaryDeps && state.stateRoot) {
		presentBatchSummary(pi, batchState, state.stateRoot, summaryDeps.opId, summaryDeps.diagnostics, summaryDeps.mergeResults);
	}

	// Always deactivate after PR lifecycle completes (R002 issue #3)
	deactivateSupervisor(pi, state);
}

/**
 * Trigger the supervisor-managed integration flow after batch completion.
 *
 * Called from the engine's onTerminal callback when integration mode is
 * "supervised" or "auto" and batch phase is "completed" (R002-1).
 *
 * **Auto mode (R002-2):** Executes integration programmatically via the
 * provided executor (which wraps `executeIntegration` from extension.ts).
 * For PR mode, programmatically polls CI status and merges on success.
 * Reports outcome and deactivates supervisor deterministically — no path
 * leaves the supervisor alive without a code-driven shutdown.
 *
 * **Supervised mode:** Presents the integration plan and asks the LLM to
 * confirm with the operator. After confirmation, directs the LLM to run
 * `/orch-integrate --{mode}` which uses the established execution path
 * (resolveIntegrationContext + executeIntegration). This avoids duplicating
 * integration logic via free-form git/gh instructions.
 *
 * If no integration is possible (no orch branch, no succeeded tasks),
 * the supervisor is deactivated immediately.
 *
 * @param pi - ExtensionAPI for sending messages and deactivation
 * @param state - Supervisor state (for deactivation if no integration needed)
 * @param batchState - Runtime batch state
 * @param integrationMode - "supervised" or "auto"
 * @param cwd - Working directory for git operations
 * @param executor - Integration executor callback (wraps executeIntegration to avoid circular imports)
 * @param ciDeps - CI deps for programmatic PR polling and merge (auto/PR mode)
 * @param summaryDeps - Optional summary deps for batch summary generation on all terminal paths
 *
 * @since TP-043
 */
export function triggerSupervisorIntegration(
	pi: ExtensionAPI,
	state: SupervisorState,
	batchState: OrchBatchRuntimeState,
	integrationMode: "supervised" | "auto",
	cwd: string,
	executor?: IntegrationExecutor,
	ciDeps?: CiDeps,
	summaryDeps?: SummaryDeps | null,
): void {
	// TP-043: Helper to generate summary before deactivation
	const summarizeAndDeactivate = () => {
		if (summaryDeps && state.stateRoot) {
			presentBatchSummary(pi, batchState, state.stateRoot, summaryDeps.opId, summaryDeps.diagnostics, summaryDeps.mergeResults);
		}
		deactivateSupervisor(pi, state);
	};

	// Build integration plan
	const plan = buildIntegrationPlan(batchState, cwd);

	if (!plan) {
		// No integration possible — deactivate supervisor
		pi.sendMessage(
			{
				customType: "supervisor-integration",
				content: [{
					type: "text",
					text: `📋 **Batch complete.** No integration needed (no orch branch or no succeeded tasks). Supervisor deactivating.`,
				}],
				display: "No integration needed — supervisor deactivating",
			},
			{ triggerTurn: false },
		);
		summarizeAndDeactivate();
		return;
	}

	// Format the plan for reporting
	const planText = formatIntegrationPlan(plan);

	if (integrationMode === "supervised") {
		// Supervised mode: present plan, ask LLM to confirm with operator,
		// then direct it to /orch-integrate (established execution path).
		const modeFlag = plan.mode === "ff" ? "" : plan.mode === "merge" ? " --merge" : " --pr";
		pi.sendMessage(
			{
				customType: "supervisor-integration",
				content: [{
					type: "text",
					text:
						`🏁 **Batch complete!** Ready to integrate.\n\n` +
						planText + `\n\n` +
						`**Action required:** Ask the operator for confirmation.\n\n` +
						`Say something like: "The batch completed successfully. I'd like to integrate ` +
						`the changes from \`${plan.orchBranch}\` into \`${plan.baseBranch}\` using ` +
						`${plan.mode === "ff" ? "fast-forward" : plan.mode === "merge" ? "a merge commit" : "a pull request"}. ` +
						`${plan.rationale} Shall I proceed?"\n\n` +
						`If the operator confirms, run: \`/orch-integrate${modeFlag}\`\n` +
						`If the operator declines, acknowledge and deactivate.\n` +
						`If the operator wants a different mode, adjust the flag:\n` +
						`  - Fast-forward: \`/orch-integrate\`\n` +
						`  - Merge commit: \`/orch-integrate --merge\`\n` +
						`  - Pull request: \`/orch-integrate --pr\``,
				}],
				display: "Integration plan ready — awaiting operator confirmation",
			},
			{ triggerTurn: true, deliverAs: "nextTurn" },
		);

		// TP-043 R004: Defer summary until after integration completes (or operator declines).
		// Store deps on supervisor state so /orch-integrate completion or deactivateSupervisor
		// can present the summary at the correct time.
		if (summaryDeps) {
			state.pendingSummaryDeps = summaryDeps;
		}
		return;
	}

	// ── Auto mode: execute integration programmatically (R002-2) ──

	if (!executor) {
		// Fallback: no executor provided — instruct operator to use /orch-integrate.
		// This should not happen in normal operation but prevents a crash.
		const modeFlag = plan.mode === "ff" ? "" : plan.mode === "merge" ? " --merge" : " --pr";
		pi.sendMessage(
			{
				customType: "supervisor-integration",
				content: [{
					type: "text",
					text:
						`🏁 **Batch complete!** Integration executor unavailable.\n\n` +
						planText + `\n\n` +
						`Run \`/orch-integrate${modeFlag}\` to integrate manually.`,
				}],
				display: "Auto-integration fallback — run /orch-integrate",
			},
			{ triggerTurn: false },
		);
		summarizeAndDeactivate();
		return;
	}

	// Execute the integration synchronously using the provided executor
	const context = {
		orchBranch: plan.orchBranch,
		baseBranch: plan.baseBranch,
		batchId: plan.batchId,
		currentBranch: plan.baseBranch,
		notices: [],
	};

	let result = executor(plan.mode, context);

	// If ff fails, automatically fall back to merge mode
	if (!result.success && plan.mode === "ff") {
		const fallbackResult = executor("merge", context);
		if (fallbackResult.success) {
			result = fallbackResult;
			result.message = `⚠️ Fast-forward failed (branches diverged). Fell back to merge.\n${result.message}`;
		}
		// If merge also fails, result stays as the merge failure
	}

	if (result.success) {
		const outcomeText = formatIntegrationOutcome(plan, true, result.message);

		if (plan.mode === "pr" || !result.integratedLocally) {
			// PR mode: integration created a PR but didn't merge locally.
			// Programmatically poll CI status and merge (R002-2).
			pi.sendMessage(
				{
					customType: "supervisor-integration-progress",
					content: [{
						type: "text",
						text: `${outcomeText}\n\n⏳ Waiting for CI checks to complete...`,
					}],
					display: "PR created — polling CI status",
				},
				{ triggerTurn: false },
			);

			if (ciDeps) {
				// Fire-and-forget — handlePrLifecycle handles messaging,
				// summary generation, and deterministic deactivation internally.
				handlePrLifecycle(plan, ciDeps, pi, state, batchState, summaryDeps).catch((err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					pi.sendMessage(
						{
							customType: "supervisor-integration-result",
							content: [{
								type: "text",
								text: `❌ **CI monitoring crashed:** ${msg}\nThe PR is still open — check status and merge manually.`,
							}],
							display: "CI monitoring crashed",
						},
						{ triggerTurn: false },
					);
					summarizeAndDeactivate();
				});
			} else {
				// No CI deps — can't poll. Report and deactivate.
				pi.sendMessage(
					{
						customType: "supervisor-integration-result",
						content: [{
							type: "text",
							text: `PR created. CI polling unavailable — check status and merge manually on GitHub.`,
						}],
						display: "PR created — merge manually",
					},
					{ triggerTurn: false },
				);
				summarizeAndDeactivate();
			}
			return;
		}

		// Local integration succeeded (ff or merge) — report and deactivate
		pi.sendMessage(
			{
				customType: "supervisor-integration-result",
				content: [{
					type: "text",
					text: outcomeText,
				}],
				display: `Integration complete (${plan.mode})`,
			},
			{ triggerTurn: false },
		);
		summarizeAndDeactivate();
	} else {
		// Integration failed — report the error and deactivate
		const errorDetail = result.error || result.message || "Unknown integration error";
		const outcomeText = formatIntegrationOutcome(plan, false, errorDetail);

		pi.sendMessage(
			{
				customType: "supervisor-integration-result",
				content: [{
					type: "text",
					text:
						outcomeText + `\n\n` +
						`Run \`/orch-integrate\` manually to retry with a different mode.`,
				}],
				display: "Integration failed — run /orch-integrate manually",
			},
			{ triggerTurn: false },
		);
		summarizeAndDeactivate();
	}
}


// ── Batch Summary Generation (TP-043 Step 2) ────────────────────────

/**
 * Data required to generate a batch summary.
 *
 * Assembled from runtime and persisted state. Pure data — no side effects.
 *
 * @since TP-043
 */
export interface BatchSummaryData {
	/** Batch ID */
	batchId: string;
	/** Batch phase at summary generation time */
	phase: string;
	/** Epoch ms when batch started */
	startedAt: number;
	/** Epoch ms when batch ended (null if still running) */
	endedAt: number | null;
	/** Total tasks in batch */
	totalTasks: number;
	/** Tasks completed successfully */
	succeededTasks: number;
	/** Tasks that failed */
	failedTasks: number;
	/** Tasks skipped */
	skippedTasks: number;
	/** Tasks blocked */
	blockedTasks: number;
	/** Batch cost in USD (from diagnostics) */
	batchCost: number;
	/** Wave plan (array of arrays of task IDs per wave) */
	wavePlan: string[][];
	/** Wave results with timing data */
	waveResults: Array<{
		waveIndex: number;
		startedAt: number;
		endedAt: number;
		succeededTaskIds: string[];
		failedTaskIds: string[];
		skippedTaskIds: string[];
		overallStatus: string;
	}>;
	/** Per-task exit summaries keyed by task ID (from diagnostics) */
	taskExits: Record<string, { classification: string; cost: number; durationSec: number }>;
	/** Merge results per wave */
	mergeResults: Array<{
		waveIndex: number;
		status: string;
		failedLane: number | null;
		failureReason: string | null;
	}>;
	/** Segment-level outcomes (when segment tracking is available). */
	segmentOutcomes: {
		totalSegments: number;
		succeeded: number;
		failed: number;
		stalled: number;
		skipped: number;
		running: number;
		pending: number;
		multiSegmentTasks: Array<{
			taskId: string;
			totalSegments: number;
			terminalSegments: number;
			succeeded: number;
			failed: number;
			stalled: number;
			skipped: number;
			running: number;
			pending: number;
		}>;
	} | null;
	/** Audit trail entries for the batch */
	auditEntries: AuditTrailEntry[];
	/** Tier 0 events from events.jsonl (recovery attempts, successes, exhausted, escalations) */
	tier0Events: Tier0EventSummary[];
	/** Errors accumulated during the batch */
	errors: string[];
}

/**
 * Compact representation of a Tier 0 event for batch summary display.
 *
 * Extracted from events.jsonl, filtered to tier0_* event types and
 * the current batchId.
 *
 * @since TP-043
 */
export interface Tier0EventSummary {
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Event type (tier0_recovery_attempt, tier0_recovery_success, etc.) */
	type: string;
	/** Recovery pattern being applied */
	pattern: string;
	/** Current attempt number (1-based) */
	attempt: number;
	/** Maximum attempts allowed */
	maxAttempts: number;
	/** Affected task ID (if task-scoped) */
	taskId?: string;
	/** Resolution description (for success events) */
	resolution?: string;
	/** Error message (for exhausted events) */
	error?: string;
	/** Suggested remediation (for exhausted events) */
	suggestion?: string;
	/** Affected task IDs (for escalation context) */
	affectedTaskIds?: string[];
}

/**
 * Tier 0 event types relevant to batch summary incidents.
 *
 * @since TP-043
 */
const TIER0_SUMMARY_TYPES = new Set([
	"tier0_recovery_attempt",
	"tier0_recovery_success",
	"tier0_recovery_exhausted",
	"tier0_escalation",
]);

/**
 * Read Tier 0 events from events.jsonl, filtered by batchId.
 *
 * Parses each line as JSON, filters for tier0_* event types matching
 * the given batchId. Returns compact summaries sorted by timestamp.
 *
 * Best-effort: returns empty array if file doesn't exist or parsing fails.
 * Reuses the same parsing pattern as the event tailer (supervisor.ts:2493+).
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @param batchId - Batch ID to filter events
 * @returns Array of Tier 0 event summaries (chronological order)
 *
 * @since TP-043
 */
export function readTier0EventsForBatch(
	stateRoot: string,
	batchId: string,
): Tier0EventSummary[] {
	const eventsPath = join(stateRoot, ".pi", "supervisor", "events.jsonl");
	if (!existsSync(eventsPath)) return [];

	try {
		const raw = readFileSync(eventsPath, "utf-8").trim();
		if (!raw) return [];

		const results: Tier0EventSummary[] = [];

		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const parsed = JSON.parse(trimmed);
				// Must match batchId and be a Tier 0 event type
				if (parsed.batchId !== batchId) continue;
				if (!TIER0_SUMMARY_TYPES.has(parsed.type)) continue;

				results.push({
					timestamp: parsed.timestamp ?? "",
					type: parsed.type,
					pattern: parsed.pattern ?? "unknown",
					attempt: parsed.attempt ?? 0,
					maxAttempts: parsed.maxAttempts ?? 0,
					...(parsed.taskId ? { taskId: parsed.taskId } : {}),
					...(parsed.resolution ? { resolution: parsed.resolution } : {}),
					...(parsed.error ? { error: parsed.error } : {}),
					...(parsed.suggestion ? { suggestion: parsed.suggestion } : {}),
					...(parsed.affectedTaskIds?.length ? { affectedTaskIds: parsed.affectedTaskIds } : {}),
				});
			} catch {
				// Skip malformed lines
			}
		}

		return results;
	} catch {
		return [];
	}
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @since TP-043
 */
function formatDurationMs(ms: number): string {
	if (ms < 0) ms = 0;
	const totalSecs = Math.floor(ms / 1000);
	if (totalSecs < 60) return `${totalSecs}s`;
	const mins = Math.floor(totalSecs / 60);
	const secs = totalSecs % 60;
	if (mins < 60) return `${mins}m${secs > 0 ? ` ${secs}s` : ""}`;
	const hours = Math.floor(mins / 60);
	const remainMins = mins % 60;
	return `${hours}h${remainMins > 0 ? ` ${remainMins}m` : ""}`;
}

/**
 * Collect summary data from runtime batch state.
 *
 * Gathers data from OrchBatchRuntimeState, BatchDiagnostics, merge results,
 * and the audit trail. This function reads state — the formatter
 * (`formatBatchSummary`) is pure.
 *
 * @param batchState - Runtime batch state
 * @param stateRoot - Root path for .pi/ state directory
 * @param diagnostics - Batch diagnostics (taskExits, batchCost) or null
 * @param mergeResults - Persisted merge results or empty array
 * @returns Summary data ready for formatting
 *
 * @since TP-043
 */

/**
 * TP-115: Compute batch cost from V2 lane snapshots.
 * Reads .pi/runtime/{batchId}/lanes/*.json and sums worker + reviewer costUsd.
 * Returns 0 if no V2 data exists.
 * @since TP-115
 */
function computeV2BatchCost(stateRoot: string, batchId: string): number {
	try {
		const lanesDir = join(stateRoot, ".pi", "runtime", batchId, "lanes");
		if (!existsSync(lanesDir)) return 0;
		const files = readdirSync(lanesDir).filter(f => f.startsWith("lane-") && f.endsWith(".json"));
		let total = 0;
		for (const f of files) {
			try {
				const snap = JSON.parse(readFileSync(join(lanesDir, f), "utf-8"));
				total += snap.worker?.costUsd || 0;
				total += snap.reviewer?.costUsd || 0;
			} catch { /* skip */ }
		}
		return total;
	} catch { return 0; }
}

export function collectBatchSummaryData(
	batchState: OrchBatchRuntimeState,
	stateRoot: string,
	diagnostics?: { taskExits: Record<string, { classification: string; cost: number; durationSec: number }>; batchCost: number } | null,
	mergeResults?: Array<{ waveIndex: number; status: string; failedLane: number | null; failureReason: string | null }>,
): BatchSummaryData {
	// Read audit trail for incidents
	const auditEntries = readAuditTrail(stateRoot, { batchId: batchState.batchId });

	// Read Tier 0 events from events.jsonl for recovery/escalation incidents (R003)
	const tier0Events = readTier0EventsForBatch(stateRoot, batchState.batchId);

	// Extract wave results (may not exist if batch failed during planning)
	const waveResults = (batchState.waveResults || []).map(wr => ({
		waveIndex: wr.waveIndex,
		startedAt: wr.startedAt,
		endedAt: wr.endedAt,
		succeededTaskIds: wr.succeededTaskIds || [],
		failedTaskIds: wr.failedTaskIds || [],
		skippedTaskIds: wr.skippedTaskIds || [],
		overallStatus: wr.overallStatus || "unknown",
	}));

	const segmentRecords = batchState.segments || [];
	let segmentOutcomes: BatchSummaryData["segmentOutcomes"] = null;
	if (segmentRecords.length > 0) {
		const byTaskId = new Map<string, typeof segmentRecords>();
		for (const segment of segmentRecords) {
			const existing = byTaskId.get(segment.taskId) || [];
			existing.push(segment);
			byTaskId.set(segment.taskId, existing);
		}

		const multiSegmentTasks: NonNullable<BatchSummaryData["segmentOutcomes"]>["multiSegmentTasks"] = [];
		for (const [taskId, taskSegments] of [...byTaskId.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			if (taskSegments.length <= 1) continue;
			const succeeded = taskSegments.filter((segment) => segment.status === "succeeded").length;
			const failed = taskSegments.filter((segment) => segment.status === "failed").length;
			const stalled = taskSegments.filter((segment) => segment.status === "stalled").length;
			const skipped = taskSegments.filter((segment) => segment.status === "skipped").length;
			const running = taskSegments.filter((segment) => segment.status === "running").length;
			const pending = taskSegments.filter((segment) => segment.status === "pending").length;
			const terminalSegments = succeeded + failed + stalled + skipped;
			multiSegmentTasks.push({
				taskId,
				totalSegments: taskSegments.length,
				terminalSegments,
				succeeded,
				failed,
				stalled,
				skipped,
				running,
				pending,
			});
		}

		segmentOutcomes = {
			totalSegments: segmentRecords.length,
			succeeded: segmentRecords.filter((segment) => segment.status === "succeeded").length,
			failed: segmentRecords.filter((segment) => segment.status === "failed").length,
			stalled: segmentRecords.filter((segment) => segment.status === "stalled").length,
			skipped: segmentRecords.filter((segment) => segment.status === "skipped").length,
			running: segmentRecords.filter((segment) => segment.status === "running").length,
			pending: segmentRecords.filter((segment) => segment.status === "pending").length,
			multiSegmentTasks,
		};
	}

	return {
		batchId: batchState.batchId,
		phase: batchState.phase,
		startedAt: batchState.startedAt,
		endedAt: batchState.endedAt,
		totalTasks: batchState.totalTasks,
		succeededTasks: batchState.succeededTasks,
		failedTasks: batchState.failedTasks,
		skippedTasks: batchState.skippedTasks,
		blockedTasks: batchState.blockedTasks,
		batchCost: (diagnostics?.batchCost ?? 0) > 0
			? diagnostics!.batchCost
			: computeV2BatchCost(stateRoot, batchState.batchId),
		wavePlan: [], // Not directly available on runtime state — use waveResults
		waveResults,
		taskExits: diagnostics?.taskExits ?? {},
		mergeResults: mergeResults ?? [],
		segmentOutcomes,
		auditEntries,
		tier0Events,
		errors: batchState.errors || [],
	};
}

/**
 * Format a batch summary as a structured markdown string.
 *
 * Pure function — no I/O, no side effects. Follows the format specified
 * in spec §9.2: header with duration/cost/result, wave timeline, incidents,
 * recommendations, and cost breakdown by wave.
 *
 * When data is unavailable (no diagnostics, no audit trail, etc.), sections
 * are emitted with "Not available" rather than omitted — ensuring a complete
 * skeleton is always produced.
 *
 * @param data - Collected batch summary data
 * @returns Formatted markdown string
 *
 * @since TP-043
 */
export function formatBatchSummary(data: BatchSummaryData): string {
	const lines: string[] = [];

	// ── Header ───────────────────────────────────────────────────
	lines.push(`# Batch Summary: ${data.batchId}`);
	lines.push("");

	// Duration
	const duration = data.endedAt && data.startedAt
		? formatDurationMs(data.endedAt - data.startedAt)
		: "In progress";
	lines.push(`**Duration:** ${duration}`);

	// Cost
	if (data.batchCost > 0) {
		lines.push(`**Cost:** $${data.batchCost.toFixed(2)}`);
	} else {
		lines.push(`**Cost:** Not available`);
	}

	// Result
	const resultParts: string[] = [];
	resultParts.push(`${data.succeededTasks}/${data.totalTasks} tasks succeeded`);
	if (data.failedTasks > 0) resultParts.push(`${data.failedTasks} failed`);
	if (data.skippedTasks > 0) resultParts.push(`${data.skippedTasks} skipped`);
	if (data.blockedTasks > 0) resultParts.push(`${data.blockedTasks} blocked`);
	lines.push(`**Result:** ${resultParts.join(", ")}`);
	lines.push(`**Phase:** ${data.phase}`);
	lines.push("");

	// ── Wave Timeline ────────────────────────────────────────────
	lines.push("## Wave Timeline");
	lines.push("");

	if (data.waveResults.length === 0) {
		lines.push("No wave data available.");
	} else {
		for (const wave of data.waveResults) {
			const waveNum = wave.waveIndex + 1;
			const taskCount = wave.succeededTaskIds.length + wave.failedTaskIds.length + wave.skippedTaskIds.length;
			const waveDuration = formatDurationMs(wave.endedAt - wave.startedAt);

			// Check for merge result for this wave
			const mergeResult = data.mergeResults.find(mr => mr.waveIndex === wave.waveIndex);
			let mergeInfo = "";
			if (mergeResult) {
				if (mergeResult.status === "succeeded") {
					mergeInfo = " ✅";
				} else if (mergeResult.status === "failed") {
					mergeInfo = ` ❌ (merge failed: ${mergeResult.failureReason || "unknown"})`;
				} else if (mergeResult.status === "partial") {
					mergeInfo = ` ⚠️ (partial merge)`;
				}
			}

			const statusIcon = wave.overallStatus === "succeeded" ? "✅"
				: wave.overallStatus === "failed" ? "❌"
				: wave.overallStatus === "partial" ? "⚠️"
				: wave.overallStatus === "aborted" ? "🛑"
				: "❓";

			lines.push(`- Wave ${waveNum} (${taskCount} tasks): ${waveDuration} ${statusIcon}${mergeInfo}`);

			// Show failed tasks inline
			if (wave.failedTaskIds.length > 0) {
				lines.push(`  - Failed: ${wave.failedTaskIds.join(", ")}`);
			}
		}
	}
	lines.push("");

	// ── Segment Outcomes ─────────────────────────────────────────
	lines.push("## Segment Outcomes");
	lines.push("");
	if (!data.segmentOutcomes) {
		lines.push("Segment data not available.");
	} else if (data.segmentOutcomes.multiSegmentTasks.length === 0) {
		lines.push(`No multi-segment task outcomes recorded (${data.segmentOutcomes.totalSegments} segment record(s) total).`);
	} else {
		const statusParts = [
			`${data.segmentOutcomes.succeeded} succeeded`,
			`${data.segmentOutcomes.failed} failed`,
		];
		if (data.segmentOutcomes.running > 0) statusParts.push(`${data.segmentOutcomes.running} running`);
		if (data.segmentOutcomes.pending > 0) statusParts.push(`${data.segmentOutcomes.pending} pending`);
		if (data.segmentOutcomes.skipped > 0) statusParts.push(`${data.segmentOutcomes.skipped} skipped`);
		if (data.segmentOutcomes.stalled > 0) statusParts.push(`${data.segmentOutcomes.stalled} stalled`);
		lines.push(`- **Tracked segments:** ${data.segmentOutcomes.totalSegments}`);
		lines.push(`- **Status mix:** ${statusParts.join(", ")}`);
		lines.push(`- **Multi-segment tasks:** ${data.segmentOutcomes.multiSegmentTasks.length}`);
		for (const task of data.segmentOutcomes.multiSegmentTasks) {
			const taskParts = [`${task.succeeded}✓`, `${task.failed}✗`];
			if (task.running > 0) taskParts.push(`${task.running} running`);
			if (task.pending > 0) taskParts.push(`${task.pending} pending`);
			if (task.skipped > 0) taskParts.push(`${task.skipped} skipped`);
			if (task.stalled > 0) taskParts.push(`${task.stalled} stalled`);
			lines.push(`  - ${task.taskId}: ${task.terminalSegments}/${task.totalSegments} terminal (${taskParts.join(", ")})`);
		}
	}
	lines.push("");

	// ── Incidents & Recoveries ───────────────────────────────────
	lines.push("## Incidents");
	lines.push("");

	// Extract incidents from audit trail: non-diagnostic actions
	const incidents = data.auditEntries.filter(
		e => e.classification !== "diagnostic" && e.result !== "pending",
	);

	const hasTier0Events = data.tier0Events.length > 0;
	const hasAuditIncidents = incidents.length > 0;
	const hasErrors = data.errors.length > 0;

	if (!hasAuditIncidents && !hasTier0Events && !hasErrors) {
		lines.push("No incidents recorded.");
	} else {
		// ── Tier 0 Recovery Events (from events.jsonl) ───────────
		if (hasTier0Events) {
			lines.push("### Tier 0 Recoveries");
			lines.push("");

			// Group Tier 0 events by pattern for readability
			const byPattern = new Map<string, typeof data.tier0Events>();
			for (const evt of data.tier0Events) {
				const key = evt.pattern;
				if (!byPattern.has(key)) byPattern.set(key, []);
				byPattern.get(key)!.push(evt);
			}

			for (const [pattern, events] of byPattern) {
				const attempts = events.filter(e => e.type === "tier0_recovery_attempt").length;
				const successes = events.filter(e => e.type === "tier0_recovery_success").length;
				const exhausted = events.filter(e => e.type === "tier0_recovery_exhausted").length;
				const escalations = events.filter(e => e.type === "tier0_escalation").length;

				const statusIcon = exhausted > 0 || escalations > 0 ? "❌"
					: successes > 0 ? "✅"
					: "⏳";

				lines.push(`- **${pattern}** ${statusIcon} — ${attempts} attempt(s), ${successes} success(es), ${exhausted} exhausted`);

				// Show affected tasks
				const taskIds = new Set<string>();
				for (const evt of events) {
					if (evt.taskId) taskIds.add(evt.taskId);
					if (evt.affectedTaskIds) {
						for (const tid of evt.affectedTaskIds) taskIds.add(tid);
					}
				}
				if (taskIds.size > 0) {
					lines.push(`  - Affected tasks: ${[...taskIds].join(", ")}`);
				}

				// Show escalation details
				for (const evt of events.filter(e => e.type === "tier0_escalation")) {
					if (evt.suggestion) {
						lines.push(`  - Escalation: ${evt.suggestion}`);
					}
				}

				// Show resolution details
				for (const evt of events.filter(e => e.type === "tier0_recovery_success")) {
					if (evt.resolution) {
						lines.push(`  - Resolution: ${evt.resolution}`);
					}
				}

				// Show error details for exhausted
				for (const evt of events.filter(e => e.type === "tier0_recovery_exhausted")) {
					if (evt.error) {
						lines.push(`  - Error: ${evt.error}`);
					}
				}
			}
			lines.push("");
		}

		// ── Supervisor Actions (from audit trail) ────────────────
		if (hasAuditIncidents) {
			if (hasTier0Events) {
				lines.push("### Supervisor Actions");
				lines.push("");
			}

			let incidentNum = 0;
			for (const entry of incidents) {
				incidentNum++;
				const resultIcon = entry.result === "success" ? "✅"
					: entry.result === "failure" ? "❌"
					: entry.result === "skipped" ? "⏭️"
					: "❓";
				lines.push(`${incidentNum}. **${entry.action}** (${entry.classification}) ${resultIcon}`);
				lines.push(`   ${entry.context}`);
				if (entry.detail && entry.detail !== entry.context) {
					lines.push(`   Result: ${entry.detail}`);
				}
				if (entry.durationMs !== undefined) {
					lines.push(`   Duration: ${formatDurationMs(entry.durationMs)}`);
				}
			}
			lines.push("");
		}

		// Add errors that weren't captured in audit trail
		if (hasErrors) {
			lines.push("### Errors");
			for (const error of data.errors) {
				lines.push(`- ${error}`);
			}
		}
	}
	lines.push("");

	// ── Recommendations ──────────────────────────────────────────
	lines.push("## Recommendations");
	lines.push("");

	const recommendations: string[] = [];

	// Timeout recommendations: look for merge failures in audit trail
	const mergeFailures = data.mergeResults.filter(mr => mr.status === "failed");
	if (mergeFailures.length > 0) {
		recommendations.push("- Consider increasing `merge.timeoutMinutes` — merge failures were detected during this batch.");
	}

	// Failure rate recommendations
	if (data.totalTasks > 0 && data.failedTasks > 0) {
		const failureRate = data.failedTasks / data.totalTasks;
		if (failureRate > 0.3) {
			recommendations.push("- High failure rate (" + Math.round(failureRate * 100) + "%) — consider reducing task scope or adding more context to PROMPT.md files.");
		}
	}

	// Long-running task recommendations
	const longTasks = Object.entries(data.taskExits).filter(([, exit]) => exit.durationSec > 3600);
	if (longTasks.length > 0) {
		const names = longTasks.map(([id]) => id).join(", ");
		recommendations.push(`- Long-running tasks detected (${names}): ${longTasks.length} task(s) exceeded 1 hour — consider splitting into smaller tasks.`);
	}

	// Recovery recommendations — check both audit trail and Tier 0 events
	const recoveryExhaustedAudit = data.auditEntries.filter(e => e.action === "tier0_recovery_exhausted" || (e.classification === "tier0_known" && e.result === "failure"));
	const recoveryExhaustedTier0 = data.tier0Events.filter(e => e.type === "tier0_recovery_exhausted");
	const escalationsTier0 = data.tier0Events.filter(e => e.type === "tier0_escalation");
	if (recoveryExhaustedAudit.length > 0 || recoveryExhaustedTier0.length > 0) {
		recommendations.push("- Recovery budget was exhausted for some issues — review recurring failures and consider addressing root causes.");
	}
	if (escalationsTier0.length > 0) {
		const uniqueSuggestions = [...new Set(escalationsTier0.map(e => e.suggestion).filter(Boolean))];
		if (uniqueSuggestions.length > 0) {
			for (const suggestion of uniqueSuggestions) {
				recommendations.push(`- Tier 0 escalation: ${suggestion}`);
			}
		}
	}

	// Blocked tasks recommendations
	if (data.blockedTasks > 0) {
		recommendations.push(`- ${data.blockedTasks} task(s) were blocked due to upstream failures — fix failed tasks and re-run with \`/orch-resume\`.`);
	}

	if (recommendations.length === 0) {
		lines.push("No recommendations — batch ran smoothly.");
	} else {
		for (const rec of recommendations) {
			lines.push(rec);
		}
	}
	lines.push("");

	// ── Cost Breakdown by Wave ───────────────────────────────────
	lines.push("## Cost Breakdown");
	lines.push("");

	if (Object.keys(data.taskExits).length === 0) {
		lines.push("Cost data not available (no telemetry recorded).");
	} else {
		// Build per-wave cost table
		lines.push("| Wave | Tasks | Cost | Duration |");
		lines.push("|------|-------|------|----------|");

		let totalCost = 0;
		for (const wave of data.waveResults) {
			const waveNum = wave.waveIndex + 1;
			const allTaskIds = [...wave.succeededTaskIds, ...wave.failedTaskIds, ...wave.skippedTaskIds];
			let waveCost = 0;
			let waveDurationSec = 0;

			for (const taskId of allTaskIds) {
				const exit = data.taskExits[taskId];
				if (exit) {
					waveCost += exit.cost;
					waveDurationSec += exit.durationSec;
				}
			}

			totalCost += waveCost;
			const waveDurationStr = formatDurationMs(waveDurationSec * 1000);
			lines.push(`| ${waveNum} | ${allTaskIds.length} | $${waveCost.toFixed(2)} | ${waveDurationStr} |`);
		}

		lines.push(`| **Total** | **${data.totalTasks}** | **$${totalCost.toFixed(2)}** | **${duration}** |`);
	}
	lines.push("");

	// ── Footer ───────────────────────────────────────────────────
	lines.push("---");
	lines.push(`*Generated at ${new Date().toISOString()}*`);

	return lines.join("\n");
}

/**
 * Generate and write the batch summary file.
 *
 * Collects data from the runtime batch state, formats it, and writes to
 * `.pi/supervisor/{opId}-{batchId}-summary.md`.
 *
 * Best-effort and non-fatal: if the file cannot be written, the error is
 * swallowed. The caller should also present the summary in conversation.
 *
 * @param batchState - Runtime batch state
 * @param stateRoot - Root path for .pi/ state directory
 * @param opId - Operator identifier (for file naming)
 * @param diagnostics - Batch diagnostics or null
 * @param mergeResults - Persisted merge results or empty array
 * @returns The formatted summary markdown string (for conversation presentation)
 *
 * @since TP-043
 */
export function generateBatchSummary(
	batchState: OrchBatchRuntimeState,
	stateRoot: string,
	opId: string,
	diagnostics?: { taskExits: Record<string, { classification: string; cost: number; durationSec: number }>; batchCost: number } | null,
	mergeResults?: Array<{ waveIndex: number; status: string; failedLane: number | null; failureReason: string | null }>,
): string {
	const data = collectBatchSummaryData(batchState, stateRoot, diagnostics, mergeResults);
	const markdown = formatBatchSummary(data);

	// Write to file — best-effort, non-fatal
	try {
		const dir = join(stateRoot, ".pi", "supervisor");
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const filename = `${opId}-${batchState.batchId}-summary.md`;
		const filepath = join(dir, filename);
		writeFileSync(filepath, markdown, "utf-8");
	} catch {
		// Best-effort: file write failure must not block summary presentation
	}

	return markdown;
}

/**
 * Present a batch summary to the operator via a supervisor message.
 *
 * Generates the summary file and sends a concise version in conversation.
 * The full summary is available in the written file.
 *
 * @param pi - ExtensionAPI for sending messages
 * @param batchState - Runtime batch state
 * @param stateRoot - Root path for .pi/ state directory
 * @param opId - Operator identifier
 * @param diagnostics - Batch diagnostics or null
 * @param mergeResults - Persisted merge results or empty array
 *
 * @since TP-043
 */
export function presentBatchSummary(
	pi: ExtensionAPI,
	batchState: OrchBatchRuntimeState,
	stateRoot: string,
	opId: string,
	diagnostics?: { taskExits: Record<string, { classification: string; cost: number; durationSec: number }>; batchCost: number } | null,
	mergeResults?: Array<{ waveIndex: number; status: string; failedLane: number | null; failureReason: string | null }>,
): void {
	const summary = generateBatchSummary(batchState, stateRoot, opId, diagnostics, mergeResults);

	// Build a concise conversation message (full details in the file)
	const duration = batchState.endedAt && batchState.startedAt
		? formatDurationMs(batchState.endedAt - batchState.startedAt)
		: "in progress";
	// TP-115: Use V2 lane snapshot cost when diagnostics.batchCost is zero
	const rawCost = (diagnostics?.batchCost ?? 0) > 0
		? diagnostics!.batchCost
		: computeV2BatchCost(stateRoot, batchState.batchId);
	const cost = rawCost > 0 ? `$${rawCost.toFixed(2)}` : "not tracked";
	const filename = `${opId}-${batchState.batchId}-summary.md`;

	const conciseText =
		`📊 **Batch Summary** — ${batchState.batchId}\n\n` +
		`- **Result:** ${batchState.succeededTasks}/${batchState.totalTasks} tasks succeeded\n` +
		`- **Duration:** ${duration}\n` +
		`- **Cost:** ${cost}\n` +
		(batchState.failedTasks > 0 ? `- **Failed:** ${batchState.failedTasks} task(s)\n` : "") +
		`\nFull summary written to \`.pi/supervisor/${filename}\`.`;

	pi.sendMessage(
		{
			customType: "supervisor-batch-summary",
			content: [{ type: "text", text: conciseText }],
			display: `Batch summary: ${batchState.succeededTasks}/${batchState.totalTasks} succeeded`,
		},
		{ triggerTurn: false },
	);
}


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


// ── Template Loading (TP-058) ────────────────────────────────────────

/**
 * Resolve the path to a base supervisor template shipped with the package.
 *
 * Templates live in `<package-root>/templates/agents/`. This function derives
 * the package root from the extension file's location
 * (`<package-root>/extensions/taskplane/supervisor.ts`).
 *
 * @param name - Template filename without extension (e.g. "supervisor", "supervisor-routing")
 * @returns Absolute path to the template file
 *
 * @since TP-058
 */
function resolveBaseTemplatePath(name: string): string {
	try {
		const thisDir = dirname(fileURLToPath(import.meta.url));
		// thisDir = <package-root>/extensions/taskplane/
		return join(thisDir, "..", "..", "templates", "agents", `${name}.md`);
	} catch {
		return join(__dirname, "..", "..", "templates", "agents", `${name}.md`);
	}
}

/**
 * Parse a simple frontmatter+body markdown file.
 * Returns null if the file doesn't exist or has no frontmatter.
 *
 * @since TP-058
 */
function parseSupervisorTemplate(filePath: string): { fm: Record<string, string>; body: string } | null {
	if (!existsSync(filePath)) return null;
	const raw = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
	const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return null;
	const fm: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx > 0) {
			const key = line.slice(0, idx).trim();
			if (!key.startsWith("#")) { // Skip commented-out frontmatter
				fm[key] = line.slice(idx + 1).trim();
			}
		}
	}
	return { fm, body: match[2].trim() };
}

/**
 * Load a supervisor template: base (from package) + local override (from project).
 *
 * Follows the same composition pattern as `loadAgentDef()` in task-runner.ts:
 * - Base template: shipped in `templates/agents/{name}.md`
 * - Local override: `.pi/agents/{name}.md` in the project
 * - If local has `standalone: true`, use it exclusively
 * - Otherwise, compose base + local with a separator
 *
 * @param name - Template name (e.g. "supervisor", "supervisor-routing")
 * @param stateRoot - Root path for .pi/ state directory
 * @returns The composed template body, or null if no template found
 *
 * @since TP-058
 */
export function loadSupervisorTemplate(name: string, stateRoot: string, localName?: string): string | null {
	const basePath = resolveBaseTemplatePath(name);
	const baseDef = parseSupervisorTemplate(basePath);

	// Load local override from .pi/agents/{localName}.md (defaults to base name)
	// This allows routing template (base: "supervisor-routing") to share the
	// same local override as the main supervisor (local: "supervisor").
	const effectiveLocalName = localName || name;
	const localPath = stateRoot ? join(stateRoot, ".pi", "agents", `${effectiveLocalName}.md`) : "";
	const localDef = localPath ? parseSupervisorTemplate(localPath) : null;

	// No base and no local → null (triggers fallback to inline prompt)
	if (!baseDef && !localDef) return null;

	// Local with standalone: true → use local as-is, ignore base
	if (localDef?.fm.standalone === "true") {
		return localDef.body;
	}

	// Compose base + local
	const baseBody = baseDef?.body || "";
	const localBody = localDef?.body || "";
	if (localBody) {
		return baseBody + "\n\n---\n\n## Project-Specific Guidance\n\n" + localBody;
	}
	return baseBody;
}

/**
 * Replace `{{variable}}` placeholders in a template string.
 *
 * @param template - Template string with `{{key}}` placeholders
 * @param vars - Key-value map of variable replacements
 * @returns Template with all known placeholders replaced
 *
 * @since TP-058
 */
function replaceTemplateVars(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		return key in vars ? vars[key] : match;
	});
}


/**
 * Build the guardrails section dynamically based on integration mode (TP-043).
 * Extracted as a helper so both the template path and inline fallback can reuse it.
 * @since TP-058
 */
function buildGuardrailsSection(integrationMode: string): string {
	if (integrationMode === "supervised" || integrationMode === "auto") {
		const modeNote = integrationMode === "supervised"
			? `**Supervised mode:** Before executing integration, describe your plan and ask the operator for confirmation.`
			: `**Auto mode:** Execute integration directly. Report the outcome to the operator. Pause only on errors or conflicts.`;
		return `## What You Must NEVER Do

1. Never delete \`.pi/batch-state.json\` without operator approval
2. Never modify task code (files that workers wrote)
3. Never modify PROMPT.md files
4. Never \`git reset --hard\` with uncommitted changes
5. Never skip tasks/waves without telling the operator
6. Never create GitHub releases

## Integration Permissions (mode: ${integrationMode})

You are authorized to perform integration operations after batch completion:
- \`git push origin <orch-branch>\` — push the orch branch for PR creation
- \`gh pr create\` — create pull requests for integration
- \`git merge --ff-only\` or \`git merge --no-edit\` — local branch integration
- \`git branch -D <orch-branch>\` — cleanup after successful integration

${modeNote}`;
	}
	return `## What You Must NEVER Do

1. Never \`git push\` to any remote
2. Never delete \`.pi/batch-state.json\` without operator approval
3. Never modify task code (files that workers wrote)
4. Never modify PROMPT.md files
5. Never \`git reset --hard\` with uncommitted changes
6. Never skip tasks/waves without telling the operator
7. Never create PRs or GitHub releases`;
}

/**
 * Build the autonomy level description for the current autonomy setting.
 * @since TP-058
 */
function buildAutonomyDescription(autonomyLabel: string): string {
	switch (autonomyLabel) {
		case "interactive":
			return `**Your current level is INTERACTIVE.** ASK the operator before any Tier 0 Known or Destructive action. Explain what you want to do, why, and what the alternatives are. Let the operator decide.`;
		case "supervised":
			return `**Your current level is SUPERVISED.** Execute Tier 0 Known patterns automatically (retries, cleanup, session restarts). ASK before Destructive actions (manual merges, state editing, skipping tasks, killing sessions). Always explain what you did and why.`;
		case "autonomous":
			return `**Your current level is AUTONOMOUS.** Execute all recovery actions automatically. Pause and summarize only when you're genuinely stuck and cannot resolve the issue. The operator trusts you to make reasonable decisions.`;
		default:
			return "";
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

	const actionsPath = auditTrailPath(stateRoot);
	const integrationMode = config.orchestrator.integration;

	// Build dynamic sections
	const guardrailsSection = buildGuardrailsSection(integrationMode);
	const autonomyGuidance = buildAutonomyDescription(autonomyLabel);

	// TP-058: Try template-based prompt first, fall back to inline prompt.
	const template = loadSupervisorTemplate("supervisor", stateRoot);
	if (template) {
		const vars: Record<string, string> = {
			batchId: batchState.batchId || "(initializing — read batch state file)",
			phase: batchState.phase,
			baseBranch: batchState.baseBranch,
			orchBranch: batchState.orchBranch || "(legacy mode)",
			waveSummary,
			totalTasks: String(batchState.totalTasks),
			succeededTasks: String(batchState.succeededTasks),
			failedTasks: String(batchState.failedTasks),
			skippedTasks: String(batchState.skippedTasks),
			blockedTasks: String(batchState.blockedTasks),
			autonomy: autonomyLabel,
			batchStatePath,
			eventsPath,
			actionsPath,
			stateRoot,
			primerPath,
			guardrailsSection,
			autonomyGuidance,
		};
		return replaceTemplateVars(template, vars);
	}

	// ── Fallback: inline prompt (backward compatibility when template missing) ──
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
- **Audit trail:** \`${actionsPath}\`
- **State root:** \`${stateRoot}\`

## Capabilities

You have full tool access: \`read\`, \`write\`, \`edit\`, \`bash\`, \`grep\`, \`find\`, \`ls\`.
Use these to:
- Read batch state, STATUS.md files, merge results, event logs
- Run git commands for diagnostics and manual merge recovery
- Edit batch-state.json for state repairs (when needed)
- Manage worker lane execution state (agent status, wrap-up, diagnostics)
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

4. **Log all recovery actions** to the audit trail (see Audit Trail section below).

5. **Respect your autonomy level** (see Recovery Action Classification below).

## Recovery Action Classification

Every action you take falls into one of three categories:

### Diagnostic (always allowed — no confirmation needed)
- Reading batch-state.json, STATUS.md, events.jsonl, merge results
- Running \`git status\`, \`git log\`, \`git diff\`
- Running test suites (\`node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test ...\`, etc.)
- Inspecting active agents and lane status (\`list_active_agents\`, \`read_agent_status\`)
- Checking worktree health (\`git worktree list\`)
- Reading any file for diagnostics

### Tier 0 Known (known recovery patterns)
- Triggering graceful wrap-up/retry flow for a stalled worker lane
- Cleaning up stale worktrees for retry
- Retrying a timed-out merge
- Resetting a session name collision
- Clearing a git lock file (\`.git/index.lock\`)

### Destructive (state mutations, irreversible operations)
- Forcing lane/batch termination paths (for example \`orch_abort(hard=true)\`)
- Editing batch-state.json fields
- Running \`git reset\`, \`git merge\`, \`git checkout -B\`
- Removing worktrees (\`git worktree remove\`)
- Modifying STATUS.md or .DONE files
- Deleting git branches (\`git branch -D\`)
- Skipping tasks or waves

### Autonomy Decision Table (current level: ${autonomyLabel})

| Classification | Interactive | Supervised | Autonomous |
|----------------|-------------|------------|------------|
| Diagnostic     | ✅ auto     | ✅ auto    | ✅ auto    |
| Tier 0 Known   | ❓ ASK      | ✅ auto    | ✅ auto    |
| Destructive    | ❓ ASK      | ❓ ASK     | ✅ auto    |

${autonomyGuidance}

## Audit Trail

Log every recovery action to \`${actionsPath}\` as a single-line JSON entry.

**Format** (one JSON object per line):
\`\`\`json
{"ts":"<ISO 8601>","action":"<action_name>","classification":"<diagnostic|tier0_known|destructive>","context":"<why>","command":"<what>","result":"<pending|success|failure|skipped>","detail":"<outcome>","batchId":"${batchState.batchId || "BATCH_ID"}"}
\`\`\`

**Rules:**
1. For **destructive** actions: write a "pending" entry BEFORE executing, then
   write a result entry AFTER with "success" or "failure" and detail.
2. For **diagnostic** and **tier0_known** actions: write a single result entry
   AFTER execution.
3. Include optional fields when relevant: \`waveIndex\`, \`laneNumber\`, \`taskId\`, \`durationMs\`.
4. Use the \`bash\` tool to append entries. Example:
   \`echo '{"ts":"...","action":"merge_retry","classification":"tier0_known","context":"merge timeout on wave 2","command":"git merge --no-ff task/lane-2","result":"success","detail":"merged with 0 conflicts","batchId":"..."}' >> ${actionsPath}\`

**Why this matters:** When you're taken over by another session or the operator
asks "what did you do?", the audit trail is the definitive record.

## Operational Knowledge

**IMPORTANT:** Read \`${primerPath}\` for your complete operational runbook.
It contains:
- Architecture details and wave lifecycle
- Common failure patterns and recovery procedures
- Batch state editing guide (safe vs. dangerous edits)
- Git operations reference
- Communication guidelines

Read it now before doing anything else. It is your primary reference.

${guardrailsSection}

## Available Orchestrator Tools

You can invoke these tools directly — no need to ask the operator or use slash commands:

- **orch_start(target)** — Start a new batch. Target is \`"all"\` for all pending tasks, or a task area name/path.
- **orch_status()** — Check current batch status (phase, wave progress, task counts, elapsed time)
- **orch_pause()** — Pause the running batch (current tasks finish, no new tasks start)
- **orch_resume(force?)** — Resume a paused or interrupted batch. Use \`force=true\` for stuck batches.
- **orch_abort(hard?)** — Abort the running batch. Use \`hard=true\` for immediate kill.
- **orch_integrate(mode?, force?, branch?)** — Integrate completed batch into working branch.
  Modes: \`"fast-forward"\` (default), \`"merge"\`, \`"pr"\`.

### When to Use These Tools

Use tools **proactively** when the situation calls for it:
- Operator asks to run tasks or start a batch → call \`orch_start(target="all")\` (or a specific area)
- Operator asks "how's it going?" → call \`orch_status()\` first, then summarize
- Batch paused due to a failure you diagnosed and fixed → call \`orch_resume()\`
- Batch completed successfully → offer to call \`orch_integrate(mode="pr")\` or the operator's preferred mode
- Batch is stuck or failing repeatedly → call \`orch_status()\` to diagnose, then \`orch_abort()\` if needed
- Need to investigate before more tasks launch → call \`orch_pause()\` first

These tools are preferred over reading batch-state.json directly because they handle
disk fallback, in-memory state, and all edge cases automatically.

## Startup Checklist

Now that you've activated:
1. Read the supervisor primer at \`${primerPath}\`
2. Read \`${batchStatePath}\` for full batch metadata
3. Read \`${eventsPath}\` for any events already emitted
4. Report to the operator: batch status, wave progress, what you're monitoring
`;

	return prompt;
}


// ── Routing System Prompt (TP-042) ───────────────────────────────────

/**
 * Build the supervisor system prompt for routing mode (no active batch).
 *
 * Used when `/orch` is called with no arguments and the supervisor is activated
 * to guide the operator through onboarding, batch planning, or other
 * conversational flows. The prompt includes:
 *
 * 1. **Identity**: "You are the project supervisor"
 * 2. **Routing state**: What was detected (no-config, pending-tasks, etc.)
 * 3. **Script guidance**: Which onboarding/returning-user script to follow
 * 4. **Primer reference**: Read supervisor-primer.md for detailed scripts
 * 5. **Capabilities**: Full tool access for project analysis and config generation
 *
 * The prompt directs the supervisor to the correct script in the primer based
 * on the routing state, implementing the Script 1/2/3 trigger discrimination
 * from spec §14.4.
 *
 * @param routingContext - The routing context from /orch no-args detection
 * @param stateRoot - Root path for .pi/ state directory (may be empty for no-config)
 * @returns The complete system prompt string
 *
 * @since TP-042
 */
export function buildRoutingSystemPrompt(
	routingContext: SupervisorRoutingContext,
	stateRoot: string,
): string {
	const primerPath = resolvePrimerPath();

	// Map routing state to the appropriate script section in the primer
	const scriptGuidance = buildRoutingScriptGuidance(routingContext.routingState, primerPath);

	// TP-058: Try template-based prompt first, fall back to inline prompt.
	const template = loadSupervisorTemplate("supervisor-routing", stateRoot, "supervisor");
	if (template) {
		const vars: Record<string, string> = {
			routingState: routingContext.routingState,
			contextMessage: routingContext.contextMessage,
			scriptGuidance,
			primerPath,
		};
		return replaceTemplateVars(template, vars);
	}

	// ── Fallback: inline prompt (backward compatibility when template missing) ──
	return buildRoutingInlinePrompt(routingContext, primerPath, scriptGuidance);
}

/**
 * Build the script guidance section for routing prompts.
 * Contains the per-state instructions that guide the supervisor's behavior.
 *
 * @since TP-058
 */
function buildRoutingScriptGuidance(routingState: string, primerPath: string): string {
	let scriptGuidance: string;
	switch (routingState) {
		case "no-config":
			scriptGuidance = `## Your Mission: Onboarding

This project has no Taskplane configuration. You need to determine which
onboarding script to follow from the primer's "Onboarding Scripts" section:

1. **Read the primer** at \`${primerPath}\` — specifically the "Onboarding Scripts" section
2. **Analyze the project** to determine its maturity:
   - No \`.pi/\` directory AND minimal code → **Script 1: First Time Ever** or **Script 2: New/Empty Project**
   - No \`.pi/\` directory AND substantial code → **Script 3: Established Project**
   - The scripts describe specific triggers and exploration steps
3. **Follow the matched script** — it guides the conversation, exploration,
   and artifact generation
4. **Delegate to Script 4** (Task Area Design) and **Script 5** (Git Branching)
   as sub-flows during onboarding — the main scripts tell you when

### Key Onboarding Artifacts to Create

When the conversation reaches the config generation phase, create ALL of these
(idempotent — create only if they don't already exist):

- \`.pi/taskplane-config.json\` — project configuration (task areas, lanes, review level, etc.)
- \`{task_area}/CONTEXT.md\` — one per task area, describing scope and conventions
- \`.pi/agents/task-worker.md\` — worker prompt overrides (can start empty with a brief comment)
- \`.pi/agents/task-reviewer.md\` — reviewer prompt overrides (can start empty with a brief comment)
- \`.pi/agents/task-merger.md\` — merger prompt overrides (can start empty with a brief comment)
- \`.pi/agents/supervisor.md\` — supervisor prompt overrides (can start empty with a brief comment)
- \`.gitignore\` entries — add Taskplane working file patterns if not already present

Use conservative creation: check if each file exists before writing. If files
already exist (partial setup), read and merge rather than overwrite.

### CRITICAL: Task Area Registration

**Every task folder MUST be registered in \`.pi/taskplane-config.json\` under
\`taskRunner.taskAreas\`.** Without registration, \`/orch all\` will fail with
"no task areas configured" — even if the folders and tasks physically exist.

When creating a task folder (e.g., \`taskplane-tasks/\`):
1. Create the folder and its \`CONTEXT.md\`
2. Register it in \`.pi/taskplane-config.json\`:
   \`\`\`json
   {
     "taskRunner": {
       "taskAreas": {
         "general": {
           "path": "taskplane-tasks",
           "prefix": "TP",
           "context": "taskplane-tasks/CONTEXT.md"
         }
       }
     }
   }
   \`\`\`
3. **Verify** by reading the config back to confirm the area is registered

When creating tasks inside an area, check that the area is registered first.
If it's not (e.g., operator created the folder manually), register it before
proceeding.

This also applies when creating tasks later in the conversation — always verify
the task area is registered in the config before offering to run \`/orch all\`.`;
			break;

		case "pending-tasks":
			scriptGuidance = `## Your Mission: Batch Planning

This project has Taskplane configured and has pending tasks ready to execute.
Follow the primer's **"Script 6: Batch Planning"** section (pending-tasks path).

1. **Read the primer** at \`${primerPath}\` — specifically Script 6's exploration
   phase and "pending tasks exist" conversation flow
2. **Review pending tasks** — scan task areas for folders without \`.DONE\` files,
   read each PROMPT.md header for size/deps/title, list them for the operator
3. **Explain dependencies and wave structure** if tasks have dependency chains
4. **Offer to plan and start a batch** — suggest \`/orch-plan all\` to preview
   wave breakdown, or \`/orch all\` to start directly
5. **Surface supplementary items** — check CONTEXT.md tech debt sections and
   GitHub Issues (\`gh issue list\` if available) for additional work to include
6. **Offer a health check** (Script 7) if the operator wants to verify project
   state before starting`;
			break;

		case "no-tasks":
			scriptGuidance = `## Your Mission: Task Creation Guidance

This project has Taskplane configured but no pending tasks.
Follow the primer's **"Script 6: Batch Planning"** section
(specifically the "no pending tasks" conversation flow).

1. **Read the primer** at \`${primerPath}\` — specifically Script 6's exploration
   phase and "no pending tasks" conversation flow
2. **Run the exploration phase** — scan CONTEXT.md tech debt sections, check
   GitHub Issues (\`gh issue list\` if available), grep for TODO/FIXME comments
3. **Present a source inventory** — group potential work items by source
   (GitHub Issues, tech debt, TODOs) with counts
4. **Help the operator create tasks** — offer to generate task packets from
   GitHub Issues, tech debt items, or a new spec described in conversation
5. **Offer a health check** (Script 7) if the operator prefers to assess
   project state rather than create tasks
6. **Graceful fallback**: If \`gh\` CLI is unavailable, skip GitHub checks and
   mention it to the operator — continue with CONTEXT.md and TODO scanning

### Important: Task Area Verification

Before creating any tasks, verify that the target task area folder is registered
in \`.pi/taskplane-config.json\` under \`taskRunner.taskAreas\`. If it's missing
(e.g., the folder exists but was never registered), register it first. Without
registration, \`/orch all\` will fail with "no task areas configured."`;
			break;

		case "completed-batch":
			scriptGuidance = `## Your Mission: Integration & Retrospective

A completed batch exists that hasn't been integrated yet.

1. **Read the primer** at \`${primerPath}\` — specifically Script 8 (Post-Batch Retrospective)
   and Script 7 (Health Check) sections
2. **Explain the orch branch model** — work is on the orch branch, not yet on the working branch
3. **Guide the operator** toward \`/orch-integrate\` to bring the batch's work into their branch
4. **Offer to run a health check** (Script 7) if they want to verify state first
5. **Run a retrospective** (Script 8) — read batch-state.json and the audit
   trail (\`.pi/supervisor/actions.jsonl\`) to summarize batch outcomes, highlight
   incidents, and recommend improvements. Present this either before or after
   integration based on what the operator prefers.
6. **Surface next steps** — check for pending tasks and offer to plan the next batch`;
			break;

		default:
			scriptGuidance = `## Your Mission: Project Assistance

Detected state: ${routingState}

1. **Read the primer** at \`${primerPath}\`
2. **Assess the situation** and help the operator with their next step
3. **Offer relevant guidance** based on what you discover`;
			break;
	}

	return scriptGuidance;
}

/**
 * Inline fallback for the routing system prompt.
 * Used when the base template file cannot be found.
 *
 * @since TP-058
 */
function buildRoutingInlinePrompt(
	routingContext: SupervisorRoutingContext,
	primerPath: string,
	scriptGuidance: string,
): string {
	const prompt = `# Project Supervisor

You are the **project supervisor** — a conversational agent that helps operators
set up, plan, and manage their Taskplane project. You were activated because the
operator typed \`/orch\` without arguments, and I detected the project state.

## Identity

You share this terminal session with the human operator. You are a senior
engineer helping them get the most out of Taskplane. Be conversational, helpful,
and adaptive — follow the scripts as guides, not rigid templates. If the
operator wants to skip ahead or go minimal, respect that.

## Detected State

**Routing state:** ${routingContext.routingState}
**Context:** ${routingContext.contextMessage}

${scriptGuidance}

## Capabilities

You have full tool access: \`read\`, \`write\`, \`edit\`, \`bash\`, \`grep\`, \`find\`, \`ls\`.
Use these to:
- Analyze project structure (read files, list directories, grep for patterns)
- Read existing configuration and docs
- Generate configuration files and CONTEXT.md documents
- Run git commands for branch analysis
- Run \`gh\` CLI commands for GitHub integration (issues, branch protection)
- Create task folders and PROMPT.md files

### Orchestrator Tools

You also have orchestrator tools available for batch management:
- **orch_start(target)** — Start a new batch (target: "all" or a task area name/path)
- **orch_status()** — Check batch status
- **orch_resume(force?)** — Resume a paused batch
- **orch_integrate(mode?, force?, branch?)** — Integrate completed batch (modes: "fast-forward", "merge", "pr")
- **orch_pause()** — Pause running batch
- **orch_abort(hard?)** — Abort running batch

Use these when the conversation leads to batch operations (e.g., starting a batch, integrating a completed batch).

## Operational Knowledge

**IMPORTANT:** Read \`${primerPath}\` for your complete operational runbook.
It contains:
- Onboarding scripts (Scripts 1-5) with detailed conversation guides
- Returning user scripts (Scripts 6-8) for batch planning, health checks, and retrospectives
- Project detection heuristics and exploration checklists
- Config generation templates and conventions

Read the relevant script section now before starting the conversation.

## Communication Style

- Be conversational, not robotic — you're having a dialog, not running a wizard
- Show what you discover as you explore ("I can see you have a TypeScript project with...")
- Ask questions when choices matter, propose defaults when they don't
- Summarize what you'll create before writing files — let the operator confirm
- If the operator says "just give me defaults", do it and move on

## Starting a Batch

When the operator wants to run pending tasks, use the \`/orch all\` command.
You can invoke it directly — it will seamlessly transition you from conversational
mode to batch monitoring mode. Examples of operator intent:

- "run the open tasks" → respond with a brief confirmation, then invoke \`/orch all\`
- "start the batch" → invoke \`/orch all\`
- "run just the platform tasks" → invoke \`/orch platform\` (with the area name)

Before starting, you may optionally:
- Show a quick summary of pending tasks and wave plan (\`/orch-plan all\`)
- Ask for confirmation if the operator's intent was ambiguous

After \`/orch all\` starts, your system prompt will automatically switch to
batch monitoring mode. You'll have full visibility into wave progress, task
outcomes, and can handle failures.

## What You Must NEVER Do

1. Never modify existing code files (only create config/scaffolding)
2. Never \`git push\` to any remote
3. Never overwrite existing config files without asking
4. Never make assumptions about project conventions — detect them
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

	// ── Routing Context (TP-042) ───────────────────────────────────
	/** When non-null, supervisor is in routing mode (onboarding / returning-user flows) */
	routingContext: SupervisorRoutingContext | null;

	// ── Deferred Summary (TP-043 R004) ─────────────────────────────
	/**
	 * When non-null, a batch summary is pending presentation. Used in supervised
	 * mode where summary must wait until /orch-integrate completes (or operator
	 * declines and supervisor deactivates).
	 */
	pendingSummaryDeps: SummaryDeps | null;
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
		routingContext: null,
		pendingSummaryDeps: null,
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
export function resolveModelFromString(
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
 * Optional routing context for /orch no-args activation.
 *
 * When provided, the supervisor is activated in "routing mode" — it handles
 * onboarding, batch planning, or other conversational flows instead of
 * batch monitoring. Lockfile/heartbeat/event-tailer are skipped because
 * there's no active batch to monitor.
 *
 * @since TP-042
 */
export interface SupervisorRoutingContext {
	/** The detected project state (e.g., "no-config", "pending-tasks") */
	routingState: string;
	/** Human-readable context message for the supervisor's first turn */
	contextMessage: string;
}

/**
 * Activate the supervisor agent in the current pi session.
 *
 * This is called after `startBatchInWorker()` in the `/orch` command handler,
 * or directly by the `/orch` no-args routing logic (TP-042).
 *
 * It:
 * 1. Stores live references to batchState/config for dynamic prompt rebuild
 * 2. Optionally switches model via pi.setModel() if supervisor.model is configured
 * 3. Sends an activation message via pi.sendMessage() with triggerTurn=true
 *    to kick off the supervisor's first turn
 *
 * When `routingContext` is provided (TP-042 no-args routing), lockfile/heartbeat
 * and event tailer are skipped — there's no active batch to monitor. The
 * activation message uses the routing context instead of batch metadata.
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
 * @param routingContext - Optional routing context for /orch no-args (TP-042)
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
	routingContext?: SupervisorRoutingContext,
): Promise<void> {
	// Store live references for dynamic prompt rebuild
	state.active = true;
	state.batchId = batchState.batchId; // May be empty pre-planning — that's OK
	state.config = { ...supervisorConfig };
	state.batchStateRef = batchState;
	state.orchConfigRef = orchConfig;
	state.stateRoot = stateRoot;

	// ── TP-042 R004: Clear routing context on non-routing activation ──
	// If a previous activation set routingContext (onboarding/returning-user),
	// clear it now so the before_agent_start hook switches to batch-monitoring
	// prompt instead of keeping the stale routing prompt.
	state.routingContext = routingContext ?? null;

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

	// ── TP-042: Routing mode — skip batch monitoring infrastructure ──
	// When activated via /orch no-args routing, there's no active batch.
	// Skip lockfile/heartbeat/event-tailer and send routing context message.
	// routingContext was already stored above (via routingContext ?? null).
	if (routingContext) {
		pi.sendMessage(
			{
				customType: "supervisor-routing",
				content: [
					{
						type: "text",
						text:
							`🔀 **Supervisor activated** (${routingContext.routingState}).\n\n` +
							routingContext.contextMessage,
					},
				],
				display: `Supervisor activated — ${routingContext.routingState}`,
			},
			{ triggerTurn: true, deliverAs: "nextTurn" },
		);
		return;
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
	startEventTailer(pi, state.eventTailer, state, (key, text) => {
		try { ctx.ui.setStatus(key, text); } catch { /* non-fatal */ }
	});

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

	// ── TP-043 R004: Present deferred batch summary ─────────────
	// If a batch summary was deferred (supervised mode awaiting integration
	// confirmation), present it now — before we clear state refs.
	if (state.pendingSummaryDeps && state.batchStateRef && state.stateRoot) {
		const deps = state.pendingSummaryDeps;
		presentBatchSummary(pi, state.batchStateRef, state.stateRoot, deps.opId, deps.diagnostics, deps.mergeResults);
		state.pendingSummaryDeps = null;
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
	state.routingContext = null;
	state.pendingSummaryDeps = null;
}

/**
 * Transition the supervisor from batch-monitoring mode back to routing mode.
 *
 * Called after a batch completes (or fails/pauses) instead of fully deactivating.
 * Tears down batch-monitoring infrastructure (lockfile, heartbeat, event tailer)
 * but keeps the supervisor active with a routing context — so the operator can
 * continue the conversation (plan next batch, create tasks, integrate, etc.)
 * without needing to re-invoke `/orch`.
 *
 * This enables the continuous workflow:
 *   /orch → conversation → "run the tasks" → batch runs → batch completes →
 *   conversation continues → "create more tasks" → "run them" → repeat
 *
 * @param pi - The ExtensionAPI instance
 * @param state - Supervisor state to transition
 * @param routingContext - The routing context for the new conversational mode
 *
 * @since TP-128
 */
export async function transitionToRoutingMode(
	pi: ExtensionAPI,
	state: SupervisorState,
	routingContext: SupervisorRoutingContext,
): Promise<void> {
	if (!state.active) return;

	// Tear down batch-monitoring infrastructure
	stopEventTailer(state.eventTailer);

	if (state.heartbeatTimer) {
		clearInterval(state.heartbeatTimer);
		state.heartbeatTimer = null;
	}

	// Remove lockfile (no active batch to protect)
	if (state.stateRoot && state.lockSessionId) {
		const currentLock = readLockfile(state.stateRoot);
		if (!currentLock || currentLock.sessionId === state.lockSessionId) {
			removeLockfile(state.stateRoot);
		}
	}
	state.lockSessionId = "";

	// Present deferred batch summary if any
	if (state.pendingSummaryDeps && state.batchStateRef && state.stateRoot) {
		const deps = state.pendingSummaryDeps;
		presentBatchSummary(pi, state.batchStateRef, state.stateRoot, deps.opId, deps.diagnostics, deps.mergeResults);
		state.pendingSummaryDeps = null;
	}

	// Switch to routing mode — keep supervisor active with new context
	state.routingContext = routingContext;
	state.batchId = "";
	// Keep batchStateRef/orchConfigRef/stateRoot — routing prompt may need them
	// Keep model override — don't switch models mid-conversation

	// TP-052: Send a prominent conversational message that clearly signals
	// the supervisor is ready for input. Uses triggerTurn to force an LLM
	// response, which ensures the pi TUI redraws and shows the input prompt.
	pi.sendMessage(
		{
			customType: "supervisor-routing-transition",
			content: [{
				type: "text",
				text:
					`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
					`🔀 **Ready for your input.**\n\n` +
					routingContext.contextMessage +
					`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
			}],
			display: `Supervisor — ${routingContext.routingState}`,
		},
		{ triggerTurn: true, deliverAs: "nextTurn" },
	);
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
		if (!state.active) {
			return undefined; // No-op: don't modify system prompt
		}

		// ── TP-042: Routing mode — use onboarding/returning-user prompt ──
		// When routingContext is set, we're in a conversational flow (onboarding,
		// batch planning, etc.), not batch monitoring. Use the routing prompt
		// which includes script guidance from the primer.
		if (state.routingContext) {
			const systemPrompt = buildRoutingSystemPrompt(
				state.routingContext,
				state.stateRoot,
			);
			return { systemPrompt };
		}

		// ── Batch monitoring mode — use standard supervisor prompt ──
		if (!state.batchStateRef || !state.orchConfigRef) {
			return undefined; // No-op: missing batch state for prompt rebuild
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
 * Async version of readLockfile — reads lockfile without blocking the event loop.
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @returns Parsed lockfile or null
 *
 * @since TP-070
 */
export async function readLockfileAsync(stateRoot: string): Promise<SupervisorLockfile | null> {
	const path = lockfilePath(stateRoot);

	try {
		const raw = await fsReadFile(path, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;

		if (
			typeof parsed.pid !== "number" ||
			typeof parsed.sessionId !== "string" ||
			typeof parsed.batchId !== "string" ||
			typeof parsed.startedAt !== "string" ||
			typeof parsed.heartbeat !== "string"
		) {
			return null;
		}

		return parsed as unknown as SupervisorLockfile;
	} catch {
		return null;
	}
}

/**
 * Async version of writeLockfile — writes lockfile without blocking the event loop.
 *
 * Creates the `.pi/supervisor/` directory if it doesn't exist.
 * Uses temp+rename for atomicity.
 *
 * @param stateRoot - Root path for .pi/ state directory
 * @param lock - Lockfile data to write
 *
 * @since TP-070
 */
export async function writeLockfileAsync(stateRoot: string, lock: SupervisorLockfile): Promise<void> {
	const dir = join(stateRoot, ".pi", "supervisor");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const finalPath = lockfilePath(stateRoot);
	const tmpPath = finalPath + ".tmp";
	const json = JSON.stringify(lock, null, 2) + "\n";

	await fsWriteFile(tmpPath, json, "utf-8");
	await fsRename(tmpPath, finalPath);
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

	// Recent actions from audit trail (using readAuditTrail helper)
	const recentActions = readAuditTrail(stateRoot, { limit: 5 });
	if (recentActions.length > 0) {
		lines.push("");
		lines.push(`**Previous supervisor actions** (last ${recentActions.length}):`);
		for (const action of recentActions) {
			lines.push(`  - ${action.action ?? "unknown"}: ${action.context ?? ""}`);
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
	let heartbeatInProgress = false; // Overlap guard (TP-070)

	const timer = setInterval(async () => {
		if (!state.active) {
			clearInterval(timer);
			return;
		}

		if (heartbeatInProgress) return; // Overlap guard (TP-070)
		heartbeatInProgress = true;

		try {
			// Read current lockfile to detect force takeover — async (TP-070)
			const currentLock = await readLockfileAsync(stateRoot);
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

			// Update heartbeat (and refresh batchId if it was initially unknown)
			try {
				const lock = await readLockfileAsync(stateRoot);
				if (lock && lock.sessionId === sessionId) {
					lock.heartbeat = new Date().toISOString();
					// TP-130: batchId may have been "(initializing)" at lock creation
					// because the batch hadn't started yet. Refresh from live state ref.
					if (state.batchStateRef?.batchId && lock.batchId !== state.batchStateRef.batchId) {
						lock.batchId = state.batchStateRef.batchId;
					}
					await writeLockfileAsync(stateRoot, lock);
				}
			} catch {
				// Best-effort heartbeat — don't crash the supervisor
			}
		} finally {
			heartbeatInProgress = false;
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
	// ── Merge health monitoring fields (TP-056) ─────────────────
	sessionName?: string;
	healthStatus?: string;
	stalledMinutes?: number;
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
	"merge_health_warning",
	"merge_health_dead",
	"merge_health_stuck",
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
 * Async version of readNewBytes — reads new bytes without blocking the event loop.
 *
 * Uses `fs/promises` for non-blocking stat and read operations.
 *
 * @param eventsPath - Full path to events.jsonl
 * @param byteOffset - Start reading from this byte offset
 * @returns [newData, newByteOffset]
 *
 * @since TP-070
 */
export async function readNewBytesAsync(eventsPath: string, byteOffset: number): Promise<[string, number]> {
	try {
		const stats = await fsStat(eventsPath);
		const fileSize = stats.size;
		if (fileSize <= byteOffset) return ["", byteOffset];

		const bytesToRead = fileSize - byteOffset;
		const buffer = Buffer.alloc(bytesToRead);

		const fh = await fsOpen(eventsPath, "r");
		try {
			await fh.read(buffer, 0, bytesToRead, byteOffset);
		} finally {
			await fh.close();
		}

		return [buffer.toString("utf-8"), fileSize];
	} catch {
		return ["", byteOffset];
	}
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
		case "merge_health_warning": {
			const lane = event.laneNumber !== undefined ? event.laneNumber : "?";
			const mins = event.stalledMinutes ?? "?";
			return `⚠️ Merge agent on lane ${lane} may be stalled (no output for ${mins} min)`;
		}
		case "merge_health_dead": {
			const lane = event.laneNumber !== undefined ? event.laneNumber : "?";
			return `💀 Merge agent on lane ${lane} session died — triggering early retry`;
		}
		case "merge_health_stuck": {
			const lane = event.laneNumber !== undefined ? event.laneNumber : "?";
			const mins = event.stalledMinutes ?? "?";
			return `🔒 Merge agent on lane ${lane} appears stuck (no output for ${mins} min). Consider killing and retrying.`;
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
		eventType === "merge_health_dead" ||
		eventType === "merge_health_stuck" ||
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
 * @param onBatchComplete - Optional callback fired when batch_complete event is detected (TP-043)
 *
 * @since TP-041
 */
export function processEvents(
	events: ParsedEvent[],
	tailer: EventTailerState,
	autonomy: SupervisorAutonomyLevel,
	notify: (text: string) => void,
	onBatchComplete?: (event: ParsedEvent) => void,
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

		// ── TP-043: Trigger integration flow on batch_complete ──
		if (event.type === "batch_complete" && onBatchComplete) {
			onBatchComplete(event);
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
	/** Optional callback to update footer status immediately (bypasses sendMessage queue). @since TP-068/214 */
	setStatus?: (key: string, text: string) => void,
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

		// TP-068/214: Update footer status immediately for visibility.
		// setStatus renders in the TUI footer without waiting for user input,
		// unlike sendMessage which queues until next turn.
		if (setStatus) {
			const statusText = text.replace(/\*\*/g, "").replace(/\n.*/s, "").substring(0, 120);
			setStatus("supervisor", `🔀 ${statusText}`);
		}

		pi.sendMessage(
			{
				customType: "supervisor-event",
				content: [{ type: "text", text }],
				display: text.replace(/\*\*/g, "").substring(0, 80),
			},
			{ triggerTurn: true, deliverAs: "nextTurn" },
		);
	};

	// ── TP-043: Integration is triggered by triggerSupervisorIntegration() ──
	// called from the onTerminal callback in startBatchInWorker (extension.ts),
	// gated on phase === "completed" (R002-1). For auto mode, integration is
	// executed programmatically via the executor callback (R002-2). The event
	// tailer does NOT duplicate the integration trigger — batch_complete events
	// are handled via the normal notification path (formatEventNotification).

	// ── Poll timer (async, TP-070) ───────────────────────────────
	let tailerPollInProgress = false; // Overlap guard (TP-070)
	tailer.pollTimer = setInterval(async () => {
		if (!supervisorState.active || !tailer.running) {
			stopEventTailer(tailer);
			return;
		}

		if (tailerPollInProgress) return; // Overlap guard (TP-070)
		tailerPollInProgress = true;

		try {
			const [newData, newOffset] = await readNewBytesAsync(eventsPath, tailer.byteOffset);
			if (!newData) return; // No new data

			tailer.byteOffset = newOffset;
			const [events, remaining] = parseJsonlLines(newData, tailer.partialLine);
			tailer.partialLine = remaining;

			processEvents(events, tailer, autonomy, notify);
		} finally {
			tailerPollInProgress = false;
		}
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
