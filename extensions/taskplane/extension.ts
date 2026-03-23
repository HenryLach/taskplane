import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { execSync, execFileSync } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";

import {
	DEFAULT_ORCHESTRATOR_CONFIG,
	DEFAULT_TASK_RUNNER_CONFIG,
	FATAL_DISCOVERY_CODES,
	ORCH_MESSAGES,
	StateFileError,
	WorkspaceConfigError,
	computeIntegrateCleanupResult,
	computeWaveAssignments,
	createOrchWidget,
	deleteBatchState,
	detectOrphanSessions,
	executeLane,
	executeOrchBatch,
	formatDependencyGraph,
	formatDiscoveryResults,
	formatOrchSessions,
	formatPreflightResults,
	formatWavePlan,
	freshOrchBatchState,
	getCurrentBranch,
	hasConfigFiles,
	resolveConfigRoot,
	listOrchSessions,
	listWorktrees,
	loadBatchState,
	loadOrchestratorConfig,
	loadSupervisorConfig,
	loadTaskRunnerConfig,
	parseOrchSessionNames,
	resolveOperatorId,
	resolveWorktreeBasePath,
	resumeOrchBatch,
	runDiscovery,
	runGit,
	runPreflight,
} from "./index.ts";
import { buildExecutionContext } from "./workspace.ts";
import { openSettingsTui } from "./settings-tui.ts";
import {
	activateSupervisor,
	deactivateSupervisor,
	transitionToRoutingMode,
	freshSupervisorState,
	registerSupervisorPromptHook,
	checkSupervisorLockOnStartup,
	buildTakeoverSummary,
	isProcessAlive,
	isBatchTerminal,
	DEFAULT_SUPERVISOR_CONFIG,
	triggerSupervisorIntegration,
	presentBatchSummary,
	resolveModelFromString,
} from "./supervisor.ts";
import type { SupervisorConfig, SupervisorRoutingContext, IntegrationExecutor, CiDeps, SummaryDeps } from "./supervisor.ts";
import type {
	AbortMode,
	ExecutionContext,
	IntegrateCleanupRepoFindings,
	MonitorState,
	OrchestratorConfig,
	PersistedBatchState,
	TaskRunnerConfig,
} from "./index.ts";

// ── Integrate Args Parsing ────────────────────────────────────────────

export type IntegrateMode = "ff" | "merge" | "pr";

export interface IntegrateArgs {
	mode: IntegrateMode;
	force: boolean;
	orchBranchArg?: string;
}

/**
 * Parse `/orch-integrate` command arguments.
 *
 * Supported flags: --merge, --pr, --force
 * Optional positional: orch branch name (e.g., orch/op-batchid)
 *
 * Returns parsed args or an error string if arguments are invalid.
 */
export function parseIntegrateArgs(raw: string | undefined): IntegrateArgs | { error: string } {
	const input = raw?.trim() ?? "";
	const tokens = input.split(/\s+/).filter(Boolean);

	let mode: IntegrateMode = "ff";
	let force = false;
	const positionals: string[] = [];
	let hasMerge = false;
	let hasPr = false;

	for (const token of tokens) {
		if (token === "--merge") {
			hasMerge = true;
		} else if (token === "--pr") {
			hasPr = true;
		} else if (token === "--force") {
			force = true;
		} else if (token.startsWith("--")) {
			return { error: `Unknown flag: ${token}` };
		} else {
			positionals.push(token);
		}
	}

	// Mutual exclusion: --merge and --pr cannot be used together
	if (hasMerge && hasPr) {
		return { error: "Cannot use --merge and --pr together. Choose one integration mode." };
	}

	if (hasMerge) mode = "merge";
	if (hasPr) mode = "pr";

	if (positionals.length > 1) {
		return { error: `Expected at most one branch argument, got ${positionals.length}: ${positionals.join(", ")}` };
	}

	return {
		mode,
		force,
		orchBranchArg: positionals[0],
	};
}

// ── Resume Args Parsing ───────────────────────────────────────────────

export interface ResumeArgs {
	force: boolean;
}

/**
 * Parse `/orch-resume` command arguments.
 *
 * Supported flags: --force
 * No positional arguments accepted.
 *
 * Returns parsed args or an error string if arguments are invalid.
 */
export function parseResumeArgs(raw: string | undefined): ResumeArgs | { error: string } {
	const input = raw?.trim() ?? "";
	if (!input) return { force: false };

	const tokens = input.split(/\s+/).filter(Boolean);
	let force = false;

	for (const token of tokens) {
		if (token === "--force") {
			force = true;
		} else if (token === "--help") {
			return { error: "Usage: /orch-resume [--force]\n\n  --force   Resume from stopped or failed state (runs pre-resume diagnostics first)" };
		} else if (token.startsWith("--")) {
			return { error: `Unknown flag: ${token}\n\nUsage: /orch-resume [--force]` };
		} else {
			return { error: `Unexpected argument: ${token}\n\nUsage: /orch-resume [--force]` };
		}
	}

	return { force };
}

// ── Integration Context Resolution ────────────────────────────────────

/**
 * Successful result from resolveIntegrationContext.
 */
export interface IntegrationContext {
	orchBranch: string;
	baseBranch: string;
	batchId: string;
	currentBranch: string;
	/** Informational messages generated during resolution (e.g., auto-detect notices) */
	notices: string[];
}

/**
 * Error result from resolveIntegrationContext.
 */
export interface IntegrationContextError {
	error: string;
	/** "info" for non-error states (legacy mode), "error" for real failures */
	severity: "info" | "error";
}

/**
 * Dependencies injected into resolveIntegrationContext for testability.
 */
export interface IntegrationDeps {
	loadBatchState: () => PersistedBatchState | null;
	getCurrentBranch: () => string | null;
	listOrchBranches: () => string[];
	orchBranchExists: (branch: string) => boolean;
}

/**
 * Pure function to resolve all context needed for /orch-integrate.
 *
 * Resolution order:
 * 1. Try loading persisted batch state → extract orchBranch/baseBranch
 * 2. If state unavailable, use positional CLI arg
 * 3. If neither, scan for orch/* branches
 *
 * Also performs: phase gating, legacy mode detection, branch existence check,
 * detached HEAD check, and branch safety validation.
 *
 * Returns either a fully-resolved IntegrationContext or an IntegrationContextError.
 */
export function resolveIntegrationContext(
	parsed: IntegrateArgs,
	deps: IntegrationDeps,
): IntegrationContext | IntegrationContextError {
	let orchBranch = "";
	let baseBranch = "";
	let batchId = "";
	const notices: string[] = [];

	// Source 1: Try loading batch state
	try {
		const state = deps.loadBatchState();
		if (state) {
			orchBranch = state.orchBranch ?? "";
			baseBranch = state.baseBranch ?? "";
			batchId = state.batchId;

			// Phase gate: batch must be completed before integration
			if (state.phase !== "completed") {
				return {
					error:
						`⏳ Batch ${batchId} is currently in "${state.phase}" phase.\n` +
						`Integration requires a completed batch.\n` +
						`Run /orch-status to check progress, or wait for the batch to finish.`,
					severity: "info",
				};
			}

			// Legacy merge mode check
			if (!orchBranch) {
				return {
					error:
						`ℹ️ Batch ${batchId} used legacy merge mode — work was already merged directly into ${baseBranch || "the base branch"}.\n` +
						`There is no separate orch branch to integrate.`,
					severity: "info",
				};
			}
		}
	} catch (err: unknown) {
		// Capture the error but don't return yet — user may have provided a branch arg
		const msg = err instanceof StateFileError
			? (err.code === "STATE_FILE_IO_ERROR"
				? `Could not read batch state file: ${err.message}`
				: err.code === "STATE_FILE_PARSE_ERROR"
					? `Batch state file contains invalid JSON: ${err.message}`
					: `Batch state file has invalid schema: ${err.message}`)
			: `Unexpected error loading batch state: ${(err as Error).message}`;
		if (!parsed.orchBranchArg) {
			return {
				error: `⚠️ ${msg}\nYou can specify the orch branch directly: /orch-integrate <orch-branch>`,
				severity: "error",
			};
		}
		notices.push(`⚠️ ${msg} — using provided branch arg instead.`);
	}

	// Source 2: CLI positional branch arg overrides or fills in
	if (parsed.orchBranchArg) {
		orchBranch = parsed.orchBranchArg;
	}

	// Source 3: Neither state nor arg — scan for orch/* branches
	if (!orchBranch) {
		const candidates = deps.listOrchBranches();
		if (candidates.length === 0) {
			return {
				error:
					"❌ No completed batch found and no orch branches exist.\n" +
					"Run /orch first to create a batch, or specify a branch: /orch-integrate <orch-branch>",
				severity: "error",
			};
		}
		if (candidates.length === 1) {
			orchBranch = candidates[0];
			notices.push(`ℹ️ No batch state found. Auto-detected orch branch: ${orchBranch}`);
		} else {
			return {
				error:
					`❌ No batch state found and multiple orch branches exist:\n` +
					candidates.map(b => `  • ${b}`).join("\n") +
					`\n\nSpecify which branch to integrate: /orch-integrate <orch-branch>`,
				severity: "error",
			};
		}
	}

	// Verify orch branch exists
	if (!deps.orchBranchExists(orchBranch)) {
		return {
			error: `❌ Branch "${orchBranch}" does not exist locally.\nCheck the branch name and try again.`,
			severity: "error",
		};
	}

	// Detached HEAD check
	const currentBranch = deps.getCurrentBranch();
	if (currentBranch === null) {
		return {
			error:
				"❌ HEAD is detached — cannot integrate.\n" +
				"Check out a branch first (e.g., `git checkout main`), then retry.",
			severity: "error",
		};
	}

	// Infer baseBranch from current branch when state is unavailable
	if (!baseBranch) {
		baseBranch = currentBranch;
	}

	// Branch safety: current branch must match baseBranch (unless --force)
	if (currentBranch !== baseBranch && !parsed.force) {
		return {
			error:
				`⚠️ Batch was started from ${baseBranch}, but you're on ${currentBranch}.\n` +
				`Switch to ${baseBranch} first, or use /orch-integrate --force to skip this check.`,
			severity: "error",
		};
	}

	return {
		orchBranch,
		baseBranch,
		batchId,
		currentBranch,
		notices,
	};
}

// ── Integration Execution ─────────────────────────────────────────────

/**
 * Result of an integration attempt.
 */
export interface IntegrationResult {
	/** Whether the integration succeeded overall */
	success: boolean;
	/** True if work was integrated locally (ff/merge) — controls cleanup eligibility */
	integratedLocally: boolean;
	/** Number of commits applied (informational) */
	commitCount: string;
	/** User-facing success message */
	message: string;
	/** User-facing error message (only when success=false) */
	error?: string;
}

/**
 * Dependencies injected into executeIntegration for testability.
 */
export interface IntegrationExecDeps {
	runGit: (args: string[]) => { ok: boolean; stdout: string; stderr: string };
	runCommand: (cmd: string, args: string[]) => { ok: boolean; stdout: string; stderr: string };
	deleteBatchState: () => void;
}

/**
 * Execute the integration operation for the resolved context.
 *
 * Mode-specific behavior:
 * - ff: `git merge --ff-only {orchBranch}`. On failure → suggest --merge/--pr.
 * - merge: `git merge {orchBranch} --no-edit`. On failure → show stderr.
 * - pr: `git push origin {orchBranch}` then `gh pr create`. Never cleans up locally.
 *
 * Cleanup (local branch deletion + state file removal) is gated on integratedLocally === true.
 * Cleanup failures are non-fatal (included as warnings in the message).
 */
export function executeIntegration(
	mode: IntegrateMode,
	context: IntegrationContext,
	deps: IntegrationExecDeps,
): IntegrationResult {
	const { orchBranch, currentBranch, batchId } = context;

	if (mode === "ff") {
		// Fast-forward merge.
		// Stash any dirty working tree files first — workspace mode leaves
		// STATUS.md modifications in the working tree for dashboard visibility.
		// These would block ff if the orch branch has different versions.
		let stashed = false;
		const statusCheck = deps.runGit(["status", "--porcelain"]);
		if (statusCheck.ok && statusCheck.stdout.trim()) {
			deps.runGit(["stash", "push", "--include-untracked", "-m", `orch-integrate-autostash-${batchId}`]);
			stashed = true;
		}

		const result = deps.runGit(["merge", "--ff-only", orchBranch]);

		// Always pop stash if we stashed, regardless of ff result
		if (stashed) {
			deps.runGit(["stash", "pop"]);
		}

		if (!result.ok) {
			return {
				success: false,
				integratedLocally: false,
				commitCount: "0",
				message: "",
				error:
					`❌ Fast-forward failed — branches have diverged.\n` +
					`${result.stderr}\n\n` +
					`Try:\n` +
					`  /orch-integrate --merge    Create a merge commit\n` +
					`  /orch-integrate --pr       Create a pull request instead`,
			};
		}
		// Count commits that were applied
		const countResult = deps.runGit(["rev-list", "--count", `${orchBranch}..HEAD`]);
		// After ff, HEAD === orchBranch tip so we use a different measurement
		// The rev-list before the merge was computed in the handler; pass commitCount through context
		// Actually, for ff: commits applied = what was ahead before merge.
		// After ff merge HEAD moved forward, so we measure from the merge-base.
		// Simplest: use "merge was successful" and the pre-computed count from the handler.
		return performCleanup(deps, orchBranch, {
			success: true,
			integratedLocally: true,
			commitCount: "?", // Overridden by caller with pre-computed count
			message: `✅ Fast-forwarded ${currentBranch} to ${orchBranch}.`,
		});
	}

	if (mode === "merge") {
		// Stash dirty working tree (same as ff mode — workspace STATUS.md artifacts)
		let mergeStashed = false;
		const mergeStatusCheck = deps.runGit(["status", "--porcelain"]);
		if (mergeStatusCheck.ok && mergeStatusCheck.stdout.trim()) {
			deps.runGit(["stash", "push", "--include-untracked", "-m", `orch-integrate-autostash-${batchId}`]);
			mergeStashed = true;
		}

		const result = deps.runGit(["merge", orchBranch, "--no-edit"]);
		// Pop stash regardless of merge result
		if (mergeStashed) {
			deps.runGit(["stash", "pop"]);
		}

		if (!result.ok) {
			return {
				success: false,
				integratedLocally: false,
				commitCount: "0",
				message: "",
				error:
					`❌ Merge failed — there may be conflicts.\n` +
					`${result.stderr}\n\n` +
					`Resolve conflicts manually, or try:\n` +
					`  /orch-integrate --pr       Create a pull request instead`,
			};
		}
		return performCleanup(deps, orchBranch, {
			success: true,
			integratedLocally: true,
			commitCount: "?",
			message: `✅ Merged ${orchBranch} into ${currentBranch} (merge commit created).`,
		});
	}

	// PR mode
	// Step 1: Push the orch branch to origin
	const pushResult = deps.runGit(["push", "origin", orchBranch]);
	if (!pushResult.ok) {
		return {
			success: false,
			integratedLocally: false,
			commitCount: "0",
			message: "",
			error:
				`❌ Failed to push ${orchBranch} to origin.\n` +
				`${pushResult.stderr}\n\n` +
				`Check your remote configuration and try again.`,
		};
	}

	// Step 2: Create pull request via gh CLI
	const prTitle = batchId
		? `Integrate orch batch ${batchId}`
		: `Integrate ${orchBranch}`;
	const ghResult = deps.runCommand("gh", [
		"pr", "create",
		"--base", currentBranch,
		"--head", orchBranch,
		"--title", prTitle,
		"--fill",
	]);
	if (!ghResult.ok) {
		return {
			success: false,
			integratedLocally: false,
			commitCount: "0",
			message: "",
			error:
				`❌ Branch pushed but PR creation failed.\n` +
				`${ghResult.stderr}\n\n` +
				`The branch ${orchBranch} is on origin — create the PR manually.`,
		};
	}

	const prUrl = ghResult.stdout.trim();
	return {
		success: true,
		integratedLocally: false, // PR mode: branch must survive
		commitCount: "0",
		message:
			`✅ Pull request created for ${orchBranch} → ${currentBranch}.\n` +
			(prUrl ? `   ${prUrl}\n` : "") +
			`\nThe orch branch has been kept (needed for the PR).`,
	};
}

/**
 * Perform post-integration cleanup: delete local orch branch and batch state.
 * Cleanup failures are non-fatal — warnings are appended to the result message.
 */
function performCleanup(
	deps: IntegrationExecDeps,
	orchBranch: string,
	result: IntegrationResult,
): IntegrationResult {
	const warnings: string[] = [];

	// Delete local orch branch
	const branchDelete = deps.runGit(["branch", "-D", orchBranch]);
	if (!branchDelete.ok) {
		warnings.push(`⚠️ Could not delete local branch ${orchBranch}: ${branchDelete.stderr}`);
	}

	// Delete batch state file
	try {
		deps.deleteBatchState();
	} catch (err: unknown) {
		warnings.push(`⚠️ Could not clean up batch state: ${(err as Error).message}`);
	}

	if (warnings.length > 0) {
		result.message += "\n" + warnings.join("\n");
	}

	return result;
}

// ── Post-Integration Cleanup Helpers (TP-029 Step 3) ─────────────────

/**
 * Drop batch-scoped autostash entries from a repo.
 *
 * Targets two stash message patterns created during orchestration:
 * - "orch-integrate-autostash-{batchId}" (from /orch-integrate ff/merge modes)
 * - "merge-agent-autostash-w{N}-{batchId}" (from merge.ts wave ff)
 *
 * Git stash subjects include a branch prefix ("On <branch>: <message>"), so
 * we match with `String.includes()` or a regex test against the full subject.
 *
 * Scans the stash list bottom-to-top so that dropping entries doesn't
 * invalidate remaining indices. Non-matching stashes are never touched.
 */
export function dropBatchAutostash(repoRoot: string, batchId: string): void {
	if (!batchId) return;

	const stashList = runGit(["stash", "list", "--format=%gd %s"], repoRoot);
	if (!stashList.ok || !stashList.stdout.trim()) return;

	// Collect indices to drop (bottom-up order — highest index first)
	const lines = stashList.stdout.trim().split("\n");
	const indicesToDrop: number[] = [];

	// Match patterns within the full stash subject (includes "On <branch>: " prefix)
	const integrateSubstring = `orch-integrate-autostash-${batchId}`;
	const mergePattern = new RegExp(`merge-agent-autostash-w\\d+-${escapeRegexStr(batchId)}`);

	for (const line of lines) {
		// Format: "stash@{N} <subject>"
		const match = line.match(/^stash@\{(\d+)\}\s+(.*)$/);
		if (!match) continue;
		const idx = parseInt(match[1], 10);
		const subject = match[2];
		if (subject.includes(integrateSubstring) || mergePattern.test(subject)) {
			indicesToDrop.push(idx);
		}
	}

	// Sort descending so we drop from bottom up
	indicesToDrop.sort((a, b) => b - a);
	for (const idx of indicesToDrop) {
		runGit(["stash", "drop", `stash@{${idx}}`], repoRoot);
	}
}

/**
 * Escape a string for use in a RegExp.
 */
function escapeRegexStr(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Collect cleanup acceptance findings for a single repo.
 *
 * Checks the five acceptance criteria from roadmap 2d:
 * 1. No registered lane worktrees (via listWorktrees)
 * 2. No lane branches (task/{opId}-lane-*)
 * 3. No orch branches (the specific orch branch for this batch)
 * 4. No batch-scoped autostash entries
 * 5. No non-empty .worktrees/ containers
 */
export function collectRepoCleanupFindings(
	repoRoot: string,
	repoId: string | undefined,
	opId: string,
	batchId: string,
	worktreePrefix: string,
	orchBranch: string,
	orchConfig: OrchestratorConfig,
	options?: { skipOrchBranch?: boolean },
): IntegrateCleanupRepoFindings {
	const findings: IntegrateCleanupRepoFindings = {
		repoRoot,
		repoId,
		staleWorktrees: [],
		staleLaneBranches: [],
		staleOrchBranches: [],
		staleAutostashEntries: [],
		nonEmptyWorktreeContainers: [],
	};

	// 1. Stale lane worktrees — check for any worktrees belonging to this operator+batch
	try {
		const wts = listWorktrees(worktreePrefix, repoRoot, opId, batchId);
		findings.staleWorktrees = wts.map(wt => wt.path);
	} catch { /* best effort — git worktree list may fail in unusual states */ }

	// 2. Lane branches — task/{opId}-lane-*
	try {
		const branchResult = runGit(["branch", "--list", `task/${opId}-lane-*`], repoRoot);
		if (branchResult.ok && branchResult.stdout.trim()) {
			findings.staleLaneBranches = branchResult.stdout
				.split("\n")
				.map(b => b.replace(/^\*?\s+/, "").trim())
				.filter(Boolean);
		}
	} catch { /* best effort */ }

	// 3. Orch branch — check if the specific orch branch still exists
	// Skip in PR mode where the orch branch is intentionally preserved for the PR.
	if (!options?.skipOrchBranch) {
		try {
			const orchCheck = runGit(["rev-parse", "--verify", `refs/heads/${orchBranch}`], repoRoot);
			if (orchCheck.ok) {
				findings.staleOrchBranches = [orchBranch];
			}
		} catch { /* best effort */ }
	}

	// 4. Autostash entries — same patterns as dropBatchAutostash
	// Git stash subjects include branch prefix ("On <branch>: <message>"),
	// so we use substring/regex matching against the full subject.
	if (batchId) {
		try {
			const stashList = runGit(["stash", "list", "--format=%gd %s"], repoRoot);
			if (stashList.ok && stashList.stdout.trim()) {
				const integrateSubstring = `orch-integrate-autostash-${batchId}`;
				const mergePattern = new RegExp(`merge-agent-autostash-w\\d+-${escapeRegexStr(batchId)}`);
				for (const line of stashList.stdout.trim().split("\n")) {
					const match = line.match(/^stash@\{(\d+)\}\s+(.*)$/);
					if (!match) continue;
					const subject = match[2];
					if (subject.includes(integrateSubstring) || mergePattern.test(subject)) {
						findings.staleAutostashEntries.push(match[1]); // stash index
					}
				}
			}
		} catch { /* best effort */ }
	}

	// 5. Non-empty .worktrees/ containers (subdirectory mode only)
	if (orchConfig.orchestrator.worktree_location !== "sibling") {
		try {
			const basePath = resolveWorktreeBasePath(repoRoot, orchConfig);
			if (existsSync(basePath)) {
				const entries = readdirSync(basePath);
				if (entries.length > 0) {
					findings.nonEmptyWorktreeContainers = [basePath];
				}
			}
		} catch { /* best effort */ }
	}

	return findings;
}

// ── TP-040: Non-Blocking Engine Launch Helper ───────────────────────

/**
 * Start an engine execution (batch or resume) without blocking the caller.
 *
 * Launches `engineFn` as a fire-and-forget promise — the command handler
 * returns immediately so the pi session stays interactive. All state
 * transitions are communicated via the existing callback mechanism
 * (onNotify, onMonitorUpdate) and engine events.
 *
 * The `.catch()` error boundary handles unexpected rejections from the
 * engine by:
 * 1. Setting the batch state to "failed" with the error
 * 2. Notifying the operator
 * 3. Refreshing the dashboard widget
 *
 * This prevents unhandled promise rejections from crashing the session
 * or leaving batch state inconsistent.
 */

// ── Model Availability Pre-Flight ───────────────────────────────────

/**
 * A single model configuration to validate.
 */
interface ModelCheckEntry {
	/** Role label for display (e.g., "Worker", "Reviewer") */
	role: string;
	/** Model string from config (empty = inherit session model) */
	modelStr: string;
}

/**
 * Result of a single model availability check.
 */
export interface ModelCheckResult {
	role: string;
	modelStr: string;
	status: "inherit" | "found" | "not-found";
	resolvedName?: string;
}

/**
 * Validate that all configured agent models are available in the model registry.
 *
 * Checks worker, reviewer, merger, and supervisor model settings. Models set to
 * empty string ("") or not configured inherit the session model and are always valid.
 *
 * Does NOT validate API keys (that would require side-effectful setModel calls).
 * This catches the most common misconfiguration: specifying a model that isn't
 * registered in pi (wrong name, missing provider, etc.).
 *
 * @param orchConfig - Orchestrator configuration
 * @param runnerConfig - Task runner configuration
 * @param supervisorConfig - Supervisor configuration
 * @param ctx - Extension context with model registry
 * @returns Array of check results (one per role)
 *
 * @since v0.7.2
 */
export function validateModelAvailability(
	orchConfig: OrchestratorConfig,
	runnerConfig: TaskRunnerConfig,
	supervisorConfig: SupervisorConfig,
	ctx: ExtensionContext,
): ModelCheckResult[] {
	const entries: ModelCheckEntry[] = [
		{ role: "Worker", modelStr: runnerConfig.worker?.model ?? "" },
		{ role: "Reviewer", modelStr: runnerConfig.reviewer?.model ?? "" },
		{ role: "Merger", modelStr: orchConfig.merge?.model ?? "" },
		{ role: "Supervisor", modelStr: supervisorConfig.model ?? "" },
	];

	const sessionModel = ctx.model;
	const results: ModelCheckResult[] = [];

	for (const entry of entries) {
		if (!entry.modelStr) {
			// Empty = inherit session model
			results.push({
				role: entry.role,
				modelStr: "(inherit)",
				status: "inherit",
				resolvedName: sessionModel
					? `${(sessionModel as any).provider ?? ""}/${sessionModel.id}`.replace(/^\//, "")
					: "session default",
			});
			continue;
		}

		const resolved = resolveModelFromString(entry.modelStr, ctx);
		if (resolved) {
			results.push({
				role: entry.role,
				modelStr: entry.modelStr,
				status: "found",
				resolvedName: `${(resolved as any).provider ?? ""}/${resolved.id}`.replace(/^\//, ""),
			});
		} else {
			results.push({
				role: entry.role,
				modelStr: entry.modelStr,
				status: "not-found",
			});
		}
	}

	return results;
}

/**
 * Format model validation results for display.
 *
 * @param results - Model check results from validateModelAvailability
 * @returns Formatted string for ctx.ui.notify
 */
export function formatModelValidation(results: ModelCheckResult[]): string {
	const lines: string[] = ["Model Configuration:"];
	let hasFailure = false;

	for (const r of results) {
		if (r.status === "inherit") {
			lines.push(`  ✅ ${r.role.padEnd(12)} inherit → ${r.resolvedName}`);
		} else if (r.status === "found") {
			lines.push(`  ✅ ${r.role.padEnd(12)} ${r.modelStr} → ${r.resolvedName}`);
		} else {
			lines.push(`  ❌ ${r.role.padEnd(12)} ${r.modelStr} — NOT FOUND in model registry`);
			hasFailure = true;
		}
	}

	if (hasFailure) {
		lines.push("");
		lines.push("  Fix: update the model in .pi/taskplane-config.json or /taskplane-settings,");
		lines.push("  or remove the override to inherit the session model.");
	}

	return lines.join("\n");
}

export function startBatchAsync(
	engineFn: () => Promise<void>,
	batchState: import("./types.ts").OrchBatchRuntimeState,
	ctx: ExtensionContext,
	updateWidget: () => void,
	onTerminal?: () => void,
): void {
	// Detach engine start to the next tick so the command handler returns
	// immediately. Without this, the synchronous planning/discovery phase
	// of the engine would block the handler until its first await.
	setTimeout(() => {
		engineFn()
			.then(() => {
				// Engine completed normally — final widget update
				updateWidget();
				// TP-041 R002-3: Deactivate supervisor on all terminal paths
				onTerminal?.();
			})
			.catch((err: unknown) => {
				// Unhandled engine rejection — surface to operator and update state
				const errMsg = err instanceof Error ? err.message : String(err);
				if (batchState.phase !== "completed" && batchState.phase !== "failed") {
					batchState.phase = "failed";
					batchState.endedAt = Date.now();
					batchState.errors.push(`Unhandled engine error: ${errMsg}`);
				}
				ctx.ui.notify(
					`❌ Engine crashed with unhandled error: ${errMsg}\n` +
					`   Batch ${batchState.batchId} marked as failed.`,
					"error",
				);
				updateWidget();
				// TP-041 R002-3: Deactivate supervisor on all terminal paths
				onTerminal?.();
			});
	}, 0);
}

// ── TP-043 R002-2: Integration Executor Builder ─────────────────────

/**
 * Build an integration executor callback for `triggerSupervisorIntegration`.
 *
 * Wraps `executeIntegration` with the appropriate deps (runGit, runCommand,
 * deleteBatchState) so the supervisor module can execute integration without
 * importing from extension.ts (avoiding circular dependencies).
 *
 * The executor ensures the working directory is on the base branch before
 * executing, matching the behavior of `/orch-integrate`.
 *
 * @param repoRoot - Repository root directory for git operations
 * @returns Integration executor callback
 *
 * @since TP-043 R002
 */
export function buildIntegrationExecutor(repoRoot: string): IntegrationExecutor {
	return (mode, context) => {
		// Ensure we're on the base branch before integrating
		const currentBranch = getCurrentBranch(repoRoot);
		if (currentBranch && currentBranch !== context.baseBranch) {
			const checkoutResult = runGit(["checkout", context.baseBranch], repoRoot);
			if (!checkoutResult.ok) {
				return {
					success: false,
					integratedLocally: false,
					commitCount: "0",
					message: "",
					error: `Failed to switch to base branch ${context.baseBranch}: ${checkoutResult.stderr}`,
				};
			}
		}

		// Build deps matching the /orch-integrate handler pattern
		const deps: IntegrationExecDeps = {
			runGit: (gitArgs: string[]) => runGit(gitArgs, repoRoot),
			runCommand: (cmd: string, cmdArgs: string[]) => {
				try {
					const stdout = execFileSync(cmd, cmdArgs, {
						encoding: "utf-8",
						timeout: 60_000,
						cwd: repoRoot,
						stdio: ["pipe", "pipe", "pipe"],
					}).trim();
					return { ok: true, stdout, stderr: "" };
				} catch (err: unknown) {
					const e = err as { stdout?: string; stderr?: string; message?: string };
					return {
						ok: false,
						stdout: (e.stdout ?? "").toString().trim(),
						stderr: (e.stderr ?? e.message ?? "unknown error").toString().trim(),
					};
				}
			},
			deleteBatchState: () => {
				try { deleteBatchState(repoRoot); } catch { /* best effort */ }
			},
		};

		return executeIntegration(mode as IntegrateMode, {
			...context,
			currentBranch: context.baseBranch,
		}, deps);
	};
}

/**
 * Build CI deps for programmatic PR polling and merge (R002-2).
 *
 * Creates the `CiDeps` object needed by `triggerSupervisorIntegration`
 * for auto/PR mode CI status polling and PR merge operations.
 *
 * @param repoRoot - Repository root directory
 * @returns CiDeps with gh CLI and git wrappers
 *
 * @since TP-043
 */
export function buildCiDeps(repoRoot: string): CiDeps {
	return {
		runCommand: (cmd: string, cmdArgs: string[]) => {
			try {
				const stdout = execFileSync(cmd, cmdArgs, {
					encoding: "utf-8",
					timeout: 60_000,
					cwd: repoRoot,
					stdio: ["pipe", "pipe", "pipe"],
				}).trim();
				return { ok: true, stdout, stderr: "" };
			} catch (err: unknown) {
				const e = err as { stdout?: string; stderr?: string; message?: string };
				return {
					ok: false,
					stdout: (e.stdout ?? "").toString().trim(),
					stderr: (e.stderr ?? e.message ?? "unknown error").toString().trim(),
				};
			}
		},
		runGit: (gitArgs: string[]) => runGit(gitArgs, repoRoot),
		deleteBatchState: () => {
			try { deleteBatchState(repoRoot); } catch { /* best effort */ }
		},
	};
}

// ── /orch Routing Logic (TP-042) ─────────────────────────────────────

/**
 * Project state for /orch no-args routing.
 *
 * Evaluated in strict precedence order (R001-3) — the first matching state wins:
 *   1. active-batch    → Batch is running (non-terminal phase) → status report
 *   2. completed-batch → Completed batch + orch branch exists → offer integration
 *   3. no-config       → No taskplane config exists → onboarding flow
 *   4. pending-tasks   → Config exists, pending tasks found → offer to start batch
 *   5. no-tasks        → Config exists, no pending tasks → help create tasks
 *
 * Active batch and completed batch are checked before no-config so that an
 * orphaned batch-state.json or orch branch isn't silently ignored even if
 * the config file was deleted.
 *
 * @since TP-042
 */
export type OrchProjectState =
	| "no-config"
	| "active-batch"
	| "completed-batch"
	| "pending-tasks"
	| "no-tasks";

/**
 * Result of detectOrchState — provides the detected state plus
 * context data for supervisor routing (e.g., batch info, task count).
 *
 * @since TP-042
 */
export interface OrchStateDetection {
	/** The detected project state */
	state: OrchProjectState;
	/** Human-readable context message for the supervisor activation prompt */
	contextMessage: string;
	/** Number of pending tasks (only set for pending-tasks state) */
	pendingTaskCount?: number;
	/** Batch ID (set for active-batch and completed-batch states) */
	batchId?: string;
	/** Batch phase (set for active-batch state) */
	batchPhase?: string;
	/** Orch branch name (set for completed-batch state) */
	orchBranch?: string;
}

/**
 * Dependencies injected into detectOrchState for testability.
 *
 * @since TP-042
 */
export interface OrchStateDetectionDeps {
	/** Check if any taskplane config file exists (JSON or YAML) */
	hasConfig: () => boolean;
	/** Load persisted batch state (null if no state file) */
	loadBatchState: () => PersistedBatchState | null;
	/** List local orch/* branches */
	listOrchBranches: () => string[];
	/** Run task discovery to count pending tasks */
	countPendingTasks: () => number;
}

/**
 * Detect the current project state for /orch no-args routing.
 *
 * Evaluates state in strict precedence order (see OrchProjectState).
 * The first matching condition wins — no further checks are performed.
 *
 * This is a pure function with injected dependencies for testability.
 *
 * @param deps - Injected dependencies for state detection
 * @returns Detection result with state and context message
 *
 * @since TP-042
 */
export function detectOrchState(deps: OrchStateDetectionDeps): OrchStateDetection {
	// Precedence order (R001-3): active batch → completed-needs-integration
	// → no-config → pending tasks → no tasks. Active batch is checked first
	// because an orphaned batch-state.json should be surfaced even if config
	// was deleted. No-config (onboarding) is checked after batch states so
	// an in-progress/completed batch isn't silently ignored.

	// ── 1. Active batch (non-terminal phase) → status report ─────
	try {
		const batchState = deps.loadBatchState();
		if (batchState && !isBatchTerminal(batchState.phase)) {
			const elapsed = batchState.endedAt
				? Math.round((batchState.endedAt - batchState.startedAt) / 1000)
				: Math.round((Date.now() - batchState.startedAt) / 1000);

			return {
				state: "active-batch",
				batchId: batchState.batchId,
				batchPhase: batchState.phase,
				contextMessage:
					`Batch ${batchState.batchId} is currently ${batchState.phase}. ` +
					`Wave ${batchState.currentWaveIndex + 1}/${batchState.totalWaves ?? "?"}, ` +
					`${batchState.succeededTasks ?? 0} succeeded, ` +
					`${batchState.failedTasks ?? 0} failed, ` +
					`${batchState.skippedTasks ?? 0} skipped / ` +
					`${batchState.totalTasks ?? "?"} total. ` +
					`Elapsed: ${elapsed}s.`,
			};
		}

		// ── 2. Completed batch + orch branch → offer integration ───
		// R002-2: Validate that the orch branch still exists in git before
		// offering integration. Stale batch-state can reference a deleted branch.
		if (batchState && batchState.phase === "completed" && batchState.orchBranch) {
			const existingBranches = deps.listOrchBranches();
			const branchExists = existingBranches.includes(batchState.orchBranch);
			if (branchExists) {
				return {
					state: "completed-batch",
					batchId: batchState.batchId,
					orchBranch: batchState.orchBranch,
					contextMessage:
						`Your last batch (${batchState.batchId}) completed — ` +
						`${batchState.succeededTasks ?? 0}/${batchState.totalTasks ?? "?"} tasks succeeded. ` +
						`The orch branch \`${batchState.orchBranch}\` is ready to integrate. ` +
						`Want me to create a PR to ${batchState.baseBranch}, or integrate directly?`,
				};
			}
			// Branch was deleted — fall through to remaining checks
		}
	} catch {
		// Batch state unreadable — fall through to check for orch branches
	}

	// ── 2b. No batch state but orch branches exist → offer integration
	// Covers the case where batch-state.json was deleted but an orch branch remains.
	const orchBranches = deps.listOrchBranches();
	if (orchBranches.length > 0) {
		const branchList = orchBranches.map(b => `\`${b}\``).join(", ");
		return {
			state: "completed-batch",
			orchBranch: orchBranches[0],
			contextMessage:
				orchBranches.length === 1
					? `I found an orch branch (${branchList}) that hasn't been integrated yet. ` +
					  `Want me to integrate it, or would you like to start fresh?`
					: `I found ${orchBranches.length} orch branches (${branchList}) that haven't been integrated. ` +
					  `Would you like to integrate one, or start fresh?`,
		};
	}

	// ── 3. No config exists → onboarding ─────────────────────────
	if (!deps.hasConfig()) {
		return {
			state: "no-config",
			contextMessage:
				"Welcome to Taskplane! I don't see a configuration for this project yet. " +
				"Let me help you get set up. I'll analyze your project structure, help you " +
				"define task areas, check your git branching strategy, and generate the config files.",
		};
	}

	// ── 4. Pending tasks exist → offer to start batch ────────────
	const pendingCount = deps.countPendingTasks();
	if (pendingCount > 0) {
		return {
			state: "pending-tasks",
			pendingTaskCount: pendingCount,
			contextMessage:
				`Welcome back! You have ${pendingCount} pending task${pendingCount === 1 ? "" : "s"} ready to run. ` +
				`Want me to start the batch, or would you like to review the plan first?`,
		};
	}

	// ── 5. No pending tasks → help create tasks ──────────────────
	return {
		state: "no-tasks",
		contextMessage:
			"No pending tasks right now. Here's what I can help with:\n" +
			"• Create tasks from a spec or design doc\n" +
			"• Pull in GitHub Issues\n" +
			"• Write a new spec for something you want to build\n" +
			"• Run a project health check\n" +
			"What interests you?",
	};
}

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let orchBatchState = freshOrchBatchState();
	let orchConfig: OrchestratorConfig = { ...DEFAULT_ORCHESTRATOR_CONFIG };
	let runnerConfig: TaskRunnerConfig = { ...DEFAULT_TASK_RUNNER_CONFIG };
	let orchWidgetCtx: ExtensionContext | undefined;
	let latestMonitorState: MonitorState | null = null;

	// ── Supervisor State (TP-041) ────────────────────────────────────
	let supervisorState = freshSupervisorState();
	let supervisorConfig: SupervisorConfig = { ...DEFAULT_SUPERVISOR_CONFIG };

	// Register supervisor prompt hook: while active, injects supervisor
	// system prompt on every LLM turn. No-op when supervisor is inactive.
	registerSupervisorPromptHook(pi, supervisorState);

	/**
	 * Execution context loaded at session start. Null if startup failed
	 * (e.g., workspace config present but invalid). Commands check this
	 * and return early with a user-facing error when null.
	 */
	let execCtx: ExecutionContext | null = null;

	// ── Widget Rendering ─────────────────────────────────────────────

	function updateOrchWidget() {
		if (!orchWidgetCtx) return;
		const ctx = orchWidgetCtx;
		const prefix = orchConfig.orchestrator.tmux_prefix;

		ctx.ui.setWidget(
			"task-orchestrator",
			createOrchWidget(
				() => orchBatchState,
				() => latestMonitorState,
				prefix,
			),
		);
	}

	// ── Command Guard ────────────────────────────────────────────────

	/**
	 * Guard: returns true if execution context is initialized, false otherwise.
	 * Emits a user-facing error notification when the context is missing.
	 */
	function requireExecCtx(ctx: ExtensionContext): boolean {
		if (execCtx) return true;
		ctx.ui.notify(
			"❌ Orchestrator not initialized. Workspace configuration failed at startup.\n" +
			"Fix the workspace config or remove it to use repo mode, then restart.",
			"error",
		);
		return false;
	}

	// ── Commands ─────────────────────────────────────────────────────

	pi.registerCommand("orch", {
		description: "Start batch execution or supervisor: /orch [<areas|paths|all>]",
		handler: async (args, ctx) => {
			// ── TP-042: No-args → supervisor routing ─────────────────
			// When /orch is called without arguments, detect project state
			// and activate the supervisor with routing context instead of
			// showing usage. The supervisor then guides the operator through
			// the appropriate flow (onboarding, batch planning, etc.).
			if (!args?.trim()) {
				// For "no-config" state we don't need execCtx — just send the
				// routing context. For all other states, we need it.
				// R002-1: Mirror the config loading resolution chain (resolveConfigRoot)
				// so /orch routing detects config in the same location the loader uses.
				// This handles pointer-based workspace setups where config lives at
				// pointer.configRoot, not at the worktree cwd.
				const cwd = execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd;
				const pointerConfigRoot = execCtx?.pointer?.configRoot;
				const resolvedConfigRoot = resolveConfigRoot(cwd, pointerConfigRoot);
				const stateRoot = execCtx?.repoRoot ?? ctx.cwd;
				const repoRoot = execCtx?.repoRoot ?? ctx.cwd;

				// Detect project state with strict precedence order
				const detection = detectOrchState({
					hasConfig: () => hasConfigFiles(resolvedConfigRoot),
					loadBatchState: () => {
						try { return loadBatchState(stateRoot); }
						catch { return null; }
					},
					listOrchBranches: () => {
						const result = runGit(["branch", "--list", "orch/*"], repoRoot);
						return result.ok
							? result.stdout.split("\n").map(b => b.replace(/^\*?\s+/, "").trim()).filter(Boolean)
							: [];
					},
					countPendingTasks: () => {
						if (!execCtx) return 0;
						try {
							const discovery = runDiscovery("all", runnerConfig.task_areas, execCtx.workspaceRoot, {
								dependencySource: orchConfig.dependencies.source,
								useDependencyCache: orchConfig.dependencies.cache,
								workspaceConfig: execCtx.workspaceConfig,
							});
							return discovery.pending.size;
						} catch { return 0; }
					},
				});

				// ── Active batch → show status only (supervisor already running) ─
				if (detection.state === "active-batch") {
					ctx.ui.notify(
						`🔀 ${detection.contextMessage}\n\n` +
						`Use /orch-status for full details, or /orch-pause to pause.`,
						"info",
					);
					return;
				}

				// For non-onboarding states, we need execCtx
				if (detection.state !== "no-config" && !requireExecCtx(ctx)) return;

				// Activate supervisor with routing context.
				// The routingContext parameter skips lockfile/heartbeat/event-tailer
				// (no active batch to monitor) and sends a routing-specific activation
				// message instead of the generic "Batch started" one.
				activateSupervisor(
					pi,
					supervisorState,
					orchBatchState,
					orchConfig,
					supervisorConfig,
					stateRoot,
					ctx,
					{
						routingState: detection.state,
						contextMessage: detection.contextMessage,
					},
				);

				return;
			}

			if (!requireExecCtx(ctx)) return;

			// ── TP-128: Transition from routing-mode supervisor to batch execution ──
			// If the supervisor is active in routing mode (conversational, no batch),
			// deactivate it so the batch can start fresh with monitoring-mode supervisor.
			// This enables the workflow: /orch → conversation → "run the tasks" → /orch all
			// without the operator needing to know about internal mode distinctions.
			if (supervisorState.active && supervisorState.routingContext) {
				await deactivateSupervisor(pi, supervisorState);
			}

			// Prevent concurrent batch execution (merging is an active state)
			if (orchBatchState.phase !== "idle" && orchBatchState.phase !== "completed" && orchBatchState.phase !== "failed" && orchBatchState.phase !== "stopped") {
				ctx.ui.notify(
					`⚠️ A batch is already ${orchBatchState.phase} (${orchBatchState.batchId}). ` +
					`Use /orch-pause to pause or wait for completion.`,
					"warning",
				);
				return;
			}

			// Root references from execution context.
			// Currently all .pi state, orphan detection, batch state, abort signal,
			// and discovery operations use repoRoot for consistency with engine.ts,
			// resume.ts, and execution.ts which all alias cwd → repoRoot.
			// In repo mode workspaceRoot === repoRoot, so this is safe.
			// TODO(workspace-mode): when workspace mode is fully threaded through
			// engine/resume/execution, split state root from git root.
			const { repoRoot } = execCtx!;

			// ── Orphan detection (TS-009 Step 3) ─────────────────────
			const orphanResult = detectOrphanSessions(
				orchConfig.orchestrator.tmux_prefix,
				repoRoot,
			);

			switch (orphanResult.recommendedAction) {
				case "resume": {
					// Safety net: if the persisted phase is not actually resumable (e.g. "failed",
					// "stopped") — which can happen when the batch crashed after writing a terminal
					// phase but before /orch-abort cleaned up — auto-delete the state file and
					// fall through to start fresh rather than blocking the user with a catch-22.
					const resumablePhases = ["paused", "executing", "merging"];
					const phase = orphanResult.loadedState?.phase ?? "";
					const hasOrphans = orphanResult.orphanSessions.length > 0;
					if (!hasOrphans && !resumablePhases.includes(phase)) {
						try { deleteBatchState(repoRoot); } catch { /* best effort */ }
						ctx.ui.notify(
							`🧹 Cleared non-resumable stale batch (${orphanResult.loadedState?.batchId}, phase=${phase}). Starting fresh.`,
							"info",
						);
						break; // fall through to start a new batch
					}
					// Genuinely resumable or has live orphan sessions — prompt user
					ctx.ui.notify(orphanResult.userMessage, "warning");
					return;
				}

				case "abort-orphans":
					// Orphan sessions without usable state
					ctx.ui.notify(orphanResult.userMessage, "warning");
					return;

				case "cleanup-stale":
					// No orphans + stale/completed state file — auto-delete and continue
					try {
						deleteBatchState(repoRoot);
					} catch {
						// Best-effort cleanup — proceed even if delete fails
					}
					if (orphanResult.userMessage) {
						ctx.ui.notify(orphanResult.userMessage, "info");
					}
					break;

				case "paused-corrupt":
					// Corrupt/unreadable state file — do NOT auto-delete.
					// Enter paused phase so operator-visible state reflects the issue,
					// notify user, refresh widget, then stop.
					orchBatchState.phase = "paused";
					orchBatchState.errors.push(orphanResult.userMessage);
					updateOrchWidget();
					ctx.ui.notify(orphanResult.userMessage, "warning");
					return;

				case "start-fresh":
					// No orphans, no state file — proceed normally
					break;
			}

			// ── Model availability pre-flight ────────────────────────
			// Validate that all configured agent models are resolvable in
			// the model registry before starting. Catches misconfigured
			// model names early instead of failing hours into a batch.
			const modelResults = validateModelAvailability(orchConfig, runnerConfig, supervisorConfig, ctx);
			const modelFailures = modelResults.filter(r => r.status === "not-found");
			ctx.ui.notify(formatModelValidation(modelResults), modelFailures.length > 0 ? "error" : "info");
			if (modelFailures.length > 0) {
				ctx.ui.notify(
					`❌ Cannot start batch — ${modelFailures.length} model(s) not found: ` +
					modelFailures.map(f => `${f.role} (${f.modelStr})`).join(", ") +
					`.\n\nFix the model configuration and try again.`,
					"error",
				);
				return;
			}

			// Reset batch state for new execution
			orchBatchState = freshOrchBatchState();
			latestMonitorState = null;

			// ── TP-040: Set launching phase synchronously ────────────
			// Mark as "launching" before the setTimeout detach so that
			// /orch-status, /orch-pause, /orch-abort issued immediately
			// after /orch returns can see that a batch is being started.
			// The engine will transition from "launching" → "planning"
			// on the next tick when it actually begins work.
			orchBatchState.phase = "launching";
			orchBatchState.startedAt = Date.now();
			updateOrchWidget();

			// ── TP-040: Non-blocking engine launch ───────────────────
			// Start the engine without awaiting — the command handler returns
			// immediately so the pi session remains interactive (enables
			// supervisor agent and operator conversation during batch).
			// The .catch() error boundary ensures unhandled rejections from
			// the engine are surfaced to the operator and reflected in state.
			startBatchAsync(
				() => executeOrchBatch(
					args,
					orchConfig,
					runnerConfig,
					repoRoot,
					orchBatchState,
					(message, level) => {
						ctx.ui.notify(message, level);
						updateOrchWidget(); // Refresh widget on every phase message
					},
					(monState: MonitorState) => {
						const changed = !latestMonitorState ||
							latestMonitorState.totalDone !== monState.totalDone ||
							latestMonitorState.totalFailed !== monState.totalFailed ||
							latestMonitorState.lanes.some((l, i) =>
								l.currentTaskId !== monState.lanes[i]?.currentTaskId ||
								l.currentStep !== monState.lanes[i]?.currentStep ||
								l.completedChecks !== monState.lanes[i]?.completedChecks,
							);
						latestMonitorState = monState;
						if (changed) updateOrchWidget(); // Only refresh on actual state change
					},
					execCtx!.workspaceConfig,
					execCtx!.workspaceRoot,
					execCtx!.pointer?.agentRoot,
				),
				orchBatchState,
				ctx,
				updateOrchWidget,
				// TP-043: Deferred supervisor deactivation (R002-1).
				// Integration is ONLY triggered when batch completes successfully
				// (phase === "completed"). For paused/stopped/crash states, the
				// supervisor is deactivated immediately — no integration on partial
				// batches.
				// TP-043 Step 2: Batch summary is generated on all terminal paths
				// before supervisor deactivation.
				() => {
					const mode = orchConfig.orchestrator.integration;
					// TP-043: Build summary deps for all terminal paths
					const opId = resolveOperatorId(orchConfig);
					const sDeps: SummaryDeps = {
						opId,
						diagnostics: orchBatchState.diagnostics ?? null,
						mergeResults: (orchBatchState.mergeResults || []).map(mr => ({
							waveIndex: mr.waveIndex,
							status: mr.status,
							failedLane: mr.failedLane,
							failureReason: mr.failureReason,
						})),
					};
					if (
						orchBatchState.phase === "completed" &&
						(mode === "supervised" || mode === "auto")
					) {
						// Supervisor stays alive — trigger programmatic integration
						// flow. Supervisor deactivates itself after integration
						// completes (or fails) via the callback in
						// triggerSupervisorIntegration. Summary generated there.
						triggerSupervisorIntegration(
							pi,
							supervisorState,
							orchBatchState,
							mode,
							repoRoot,
							buildIntegrationExecutor(repoRoot),
							buildCiDeps(repoRoot),
							sDeps,
						);
						return;
					}
					// Non-completed phase or manual mode — deactivate immediately.
					// Inform operator if integration was expected but skipped.
					if (
						(mode === "supervised" || mode === "auto") &&
						orchBatchState.phase !== "completed"
					) {
						pi.sendMessage(
							{
								customType: "supervisor-integration-skipped",
								content: [{
									type: "text",
									text:
										`📋 **Batch ended** (phase: ${orchBatchState.phase}). ` +
										`Integration skipped — only completed batches are eligible.\n` +
										`Use \`/orch-resume\` to continue or \`/orch-integrate\` manually after resolving issues.`,
								}],
								display: `Integration skipped — batch ${orchBatchState.phase}`,
							},
							{ triggerTurn: false },
						);
					}
					// TP-043: Generate summary before transition
					presentBatchSummary(pi, orchBatchState, execCtx!.workspaceRoot, opId, orchBatchState.diagnostics, sDeps.mergeResults);
					// TP-128: Transition to routing mode instead of deactivating.
					// The operator can continue the conversation (integrate, plan
					// next batch, create tasks) without re-invoking /orch.
					const postBatchContext: SupervisorRoutingContext = orchBatchState.phase === "completed"
						? {
							routingState: "completed-batch",
							contextMessage:
								`Batch **${orchBatchState.batchId}** completed — ` +
								`${orchBatchState.succeededTasks}/${orchBatchState.totalTasks} tasks succeeded.\n\n` +
								`The orch branch \`${orchBatchState.orchBranch}\` is ready to integrate.\n` +
								`Would you like me to integrate it, or would you prefer to review first?\n\n` +
								`You can also:\n` +
								`• Run \`/orch-integrate\` (or \`/orch-integrate --pr\`) to integrate\n` +
								`• Create new tasks for the next batch\n` +
								`• Run a health check`,
						}
						: {
							routingState: "no-tasks",
							contextMessage:
								`Batch **${orchBatchState.batchId}** ended (${orchBatchState.phase}).\n\n` +
								`${orchBatchState.succeededTasks} succeeded, ${orchBatchState.failedTasks} failed, ` +
								`${orchBatchState.skippedTasks} skipped.\n\n` +
								`What would you like to do next?`,
						};
					transitionToRoutingMode(pi, supervisorState, postBatchContext);
				},
			);

			// ── TP-041: Activate supervisor agent ────────────────────
			// After the engine is launched (non-blocking), activate the
			// supervisor in this pi session. The system prompt is rebuilt
			// dynamically on each LLM turn from the live batchState ref,
			// ensuring batch metadata (batchId, wave/task counts) is always
			// current even though the engine populates it asynchronously.
			// Model override is resolved inside activateSupervisor via ctx.
			// Uses workspaceRoot (not repoRoot) so lockfile/events/batch-state
			// all resolve to the same .pi tree the engine writes to (R006-1).
			activateSupervisor(
				pi,
				supervisorState,
				orchBatchState,
				orchConfig,
				supervisorConfig,
				execCtx!.workspaceRoot,
				ctx,
			);
		},
	});

	pi.registerCommand("orch-plan", {
		description: "Preview execution plan: /orch-plan <areas|paths|all> [--refresh]",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify(
					"Usage: /orch-plan <areas|paths|all> [--refresh]\n\n" +
					"Shows the execution plan (tasks, waves, lane assignments)\n" +
					"without actually executing anything.\n\n" +
					"Options:\n" +
					"  --refresh   Force re-scan of areas (bypass dependency cache)\n\n" +
					"Examples:\n" +
					"  /orch-plan all\n" +
					"  /orch-plan time-off notifications\n" +
					"  /orch-plan docs/task-management/domains/time-off/tasks\n" +
					"  /orch-plan all --refresh",
					"info",
				);
				return;
			}

			if (!requireExecCtx(ctx)) return;

			// Parse --refresh flag
			const hasRefresh = /--refresh/.test(args);
			const cleanArgs = args.replace(/--refresh/g, "").trim();
			if (!cleanArgs) {
				ctx.ui.notify(
					"Usage: /orch-plan <areas|paths|all> [--refresh]\n" +
					"Error: target argument required (e.g., 'all', area name, or path)",
					"error",
				);
				return;
			}
			if (hasRefresh) {
				ctx.ui.notify("🔄 Refresh mode: re-scanning all areas (cache bypassed)", "info");
			}

			// ── Section 1: Preflight ─────────────────────────────────
			const preflight = runPreflight(orchConfig, execCtx!.repoRoot);
			ctx.ui.notify(formatPreflightResults(preflight), preflight.passed ? "info" : "error");
			if (!preflight.passed) return;

			// ── Section 2: Discovery ─────────────────────────────────
			// Discovery resolves task area paths relative to workspaceRoot (not repoRoot),
			// because task_areas in task-runner.yaml are workspace-relative paths.
			const discovery = runDiscovery(cleanArgs, runnerConfig.task_areas, execCtx!.workspaceRoot, {
				refreshDependencies: hasRefresh,
				dependencySource: orchConfig.dependencies.source,
				useDependencyCache: orchConfig.dependencies.cache,
				workspaceConfig: execCtx!.workspaceConfig,
			});
			ctx.ui.notify(formatDiscoveryResults(discovery), discovery.errors.length > 0 ? "warning" : "info");

			// Check for fatal errors
			const fatalCodes = new Set<string>(FATAL_DISCOVERY_CODES);
			const fatalErrors = discovery.errors.filter((e) => fatalCodes.has(e.code));
			if (fatalErrors.length > 0) {
				ctx.ui.notify("❌ Cannot compute plan due to discovery errors above.", "error");
				const hasRoutingErrors = fatalErrors.some(
					(e) => e.code === "TASK_REPO_UNRESOLVED" || e.code === "TASK_REPO_UNKNOWN",
				);
				if (hasRoutingErrors) {
					ctx.ui.notify(
						"💡 Check PROMPT Repo: fields, area repo_id config, and routing.default_repo in workspace config.",
						"info",
					);
				}
				const hasStrictErrors = fatalErrors.some(
					(e) => e.code === "TASK_ROUTING_STRICT",
				);
				if (hasStrictErrors) {
					ctx.ui.notify(
						"💡 Strict routing is enabled (routing.strict: true). Every task must declare an explicit execution target.\n" +
						"   Add a `## Execution Target` section with `Repo: <id>` to each task's PROMPT.md.\n" +
						"   To disable strict routing, set `routing.strict: false` in workspace config.",
						"info",
					);
				}
				return;
			}

			if (discovery.pending.size === 0) {
				ctx.ui.notify("No pending tasks found. Nothing to plan.", "info");
				return;
			}

			// ── Section 3: Dependency Graph ──────────────────────────
			ctx.ui.notify(
				formatDependencyGraph(discovery.pending, discovery.completed),
				"info",
			);

			// ── Section 4: Waves + Estimate ──────────────────────────
			// Uses computeWaveAssignments pipeline only — NO re-parsing
			const waveResult = computeWaveAssignments(
				discovery.pending,
				discovery.completed,
				orchConfig,
			);

			ctx.ui.notify(
				formatWavePlan(waveResult, orchConfig.assignment.size_weights),
				waveResult.errors.length > 0 ? "error" : "info",
			);
		},
	});

	pi.registerCommand("orch-status", {
		description: "Show current batch progress",
		handler: async (_args, ctx) => {
			// ── TP-040: Disk fallback for idle in-memory state ────────
			// When in-memory state is idle, try loading from persisted
			// batch-state.json. This covers fresh-session queries (pi
			// restarted while a batch was running in tmux lanes) and
			// post-crash recovery where in-memory state was lost.
			if (orchBatchState.phase === "idle") {
				const stateRoot = execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd;
				let diskState: PersistedBatchState | null = null;
				try {
					diskState = loadBatchState(stateRoot);
				} catch {
					// Ignore errors — fall through to "no batch" message
				}

				if (!diskState) {
					ctx.ui.notify("No batch is running. Use /orch <areas|paths|all> to start.", "info");
					return;
				}

				// Show status from persisted state
				const elapsedSec = diskState.endedAt
					? Math.round((diskState.endedAt - diskState.startedAt) / 1000)
					: Math.round((Date.now() - diskState.startedAt) / 1000);

				const lines: string[] = [
					`📊 Batch ${diskState.batchId} — ${diskState.phase} (from disk)`,
					`   Wave: ${diskState.currentWaveIndex + 1}/${diskState.totalWaves}`,
					`   Tasks: ${diskState.succeededTasks} succeeded, ${diskState.failedTasks} failed, ${diskState.skippedTasks} skipped, ${diskState.blockedTasks} blocked / ${diskState.totalTasks} total`,
					`   Elapsed: ${elapsedSec}s`,
				];

				if (diskState.errors.length > 0) {
					lines.push(`   Errors: ${diskState.errors.length}`);
				}

				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			const elapsedSec = orchBatchState.endedAt
				? Math.round((orchBatchState.endedAt - orchBatchState.startedAt) / 1000)
				: Math.round((Date.now() - orchBatchState.startedAt) / 1000);

			const lines: string[] = [
				`📊 Batch ${orchBatchState.batchId} — ${orchBatchState.phase}`,
				`   Wave: ${orchBatchState.currentWaveIndex + 1}/${orchBatchState.totalWaves}`,
				`   Tasks: ${orchBatchState.succeededTasks} succeeded, ${orchBatchState.failedTasks} failed, ${orchBatchState.skippedTasks} skipped, ${orchBatchState.blockedTasks} blocked / ${orchBatchState.totalTasks} total`,
				`   Elapsed: ${elapsedSec}s`,
			];

			if (orchBatchState.errors.length > 0) {
				lines.push(`   Errors: ${orchBatchState.errors.length}`);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("orch-pause", {
		description: "Pause batch after current tasks finish",
		handler: async (_args, ctx) => {
			if (orchBatchState.phase === "idle" || orchBatchState.phase === "completed" || orchBatchState.phase === "failed" || orchBatchState.phase === "stopped") {
				ctx.ui.notify(ORCH_MESSAGES.pauseNoBatch(), "warning");
				return;
			}
			if (orchBatchState.phase === "paused" || orchBatchState.pauseSignal.paused) {
				ctx.ui.notify(ORCH_MESSAGES.pauseAlreadyPaused(orchBatchState.batchId), "warning");
				return;
			}
			// Set pause signal — executeLane() checks this between tasks
			orchBatchState.pauseSignal.paused = true;
			ctx.ui.notify(ORCH_MESSAGES.pauseActivated(orchBatchState.batchId), "info");
			updateOrchWidget();
		},
	});

	pi.registerCommand("orch-resume", {
		description: "Resume a paused or interrupted batch: /orch-resume [--force]",
		handler: async (args, ctx) => {
			if (!requireExecCtx(ctx)) return;

			// Parse arguments
			const parsed = parseResumeArgs(args);
			if ("error" in parsed) {
				ctx.ui.notify(`❌ ${parsed.error}`, "error");
				return;
			}

			// Prevent resume if a batch is actively running (includes "launching" from non-blocking detach)
			if (orchBatchState.phase === "launching" || orchBatchState.phase === "executing" || orchBatchState.phase === "merging" || orchBatchState.phase === "planning") {
				ctx.ui.notify(
					`⚠️ A batch is currently ${orchBatchState.phase} (${orchBatchState.batchId}). Cannot resume.`,
					"warning",
				);
				return;
			}

			// Reset batch state for resume
			orchBatchState = freshOrchBatchState();
			latestMonitorState = null;

			// ── TP-040: Set launching phase synchronously ────────────
			// Same as /orch — mark as "launching" before setTimeout detach
			// so commands issued immediately see an active batch.
			orchBatchState.phase = "launching";
			orchBatchState.startedAt = Date.now();
			updateOrchWidget();

			// ── TP-040: Non-blocking resume launch ───────────────────
			// Same fire-and-forget pattern as /orch — see startBatchAsync.
			startBatchAsync(
				() => resumeOrchBatch(
					orchConfig,
					runnerConfig,
					execCtx!.repoRoot,
					orchBatchState,
					(message, level) => {
						ctx.ui.notify(message, level);
						updateOrchWidget();
					},
					(monState: MonitorState) => {
						latestMonitorState = monState;
						updateOrchWidget();
					},
					execCtx!.workspaceConfig,
					execCtx!.workspaceRoot,
					execCtx!.pointer?.agentRoot,
					parsed.force,
				),
				orchBatchState,
				ctx,
				updateOrchWidget,
				// TP-043: Deferred supervisor deactivation (R002-1, parity with /orch).
				// Only trigger integration on completed batches.
				// TP-043 Step 2: Batch summary on all terminal paths.
				() => {
					const mode = orchConfig.orchestrator.integration;
					const opId = resolveOperatorId(orchConfig);
					const sDeps: SummaryDeps = {
						opId,
						diagnostics: orchBatchState.diagnostics ?? null,
						mergeResults: (orchBatchState.mergeResults || []).map(mr => ({
							waveIndex: mr.waveIndex,
							status: mr.status,
							failedLane: mr.failedLane,
							failureReason: mr.failureReason,
						})),
					};
					if (
						orchBatchState.phase === "completed" &&
						(mode === "supervised" || mode === "auto")
					) {
						triggerSupervisorIntegration(
							pi,
							supervisorState,
							orchBatchState,
							mode,
							execCtx!.repoRoot,
							buildIntegrationExecutor(execCtx!.repoRoot),
							buildCiDeps(execCtx!.repoRoot),
							sDeps,
						);
						return;
					}
					if (
						(mode === "supervised" || mode === "auto") &&
						orchBatchState.phase !== "completed"
					) {
						pi.sendMessage(
							{
								customType: "supervisor-integration-skipped",
								content: [{
									type: "text",
									text:
										`📋 **Batch ended** (phase: ${orchBatchState.phase}). ` +
										`Integration skipped — only completed batches are eligible.\n` +
										`Use \`/orch-resume\` to continue or \`/orch-integrate\` manually after resolving issues.`,
								}],
								display: `Integration skipped — batch ${orchBatchState.phase}`,
							},
							{ triggerTurn: false },
						);
					}
					// TP-043: Generate summary before transition
					presentBatchSummary(pi, orchBatchState, execCtx!.workspaceRoot, opId, orchBatchState.diagnostics, sDeps.mergeResults);
					// TP-128: Transition to routing mode (same as /orch onTerminal)
					const postBatchContext: SupervisorRoutingContext = orchBatchState.phase === "completed"
						? {
							routingState: "completed-batch",
							contextMessage:
								`Batch **${orchBatchState.batchId}** completed — ` +
								`${orchBatchState.succeededTasks}/${orchBatchState.totalTasks} tasks succeeded.\n\n` +
								`The orch branch \`${orchBatchState.orchBranch}\` is ready to integrate.\n` +
								`Would you like me to integrate it, or would you prefer to review first?`,
						}
						: {
							routingState: "no-tasks",
							contextMessage:
								`Batch **${orchBatchState.batchId}** ended (${orchBatchState.phase}).\n\n` +
								`What would you like to do next?`,
						};
					transitionToRoutingMode(pi, supervisorState, postBatchContext);
				},
			);

			// ── TP-041: Activate supervisor agent on resume ──────────
			// supervisorConfig is loaded at session_start from unified config.
			// Uses workspaceRoot so supervisor state root matches engine (R006-1).
			activateSupervisor(
				pi,
				supervisorState,
				orchBatchState,
				orchConfig,
				supervisorConfig,
				execCtx!.workspaceRoot,
				ctx,
			);
		},
	});

	pi.registerCommand("orch-abort", {
		description: "Abort batch: /orch-abort [--hard]",
		handler: async (args, ctx) => {
			try {
				const hard = args?.trim() === "--hard";
				const mode: AbortMode = hard ? "hard" : "graceful";
				const prefix = orchConfig.orchestrator.tmux_prefix;
				const gracePeriodMs = orchConfig.orchestrator.abort_grace_period * 1000;

				// Abort must work even if execCtx failed to load (safety-critical).
				// Fall back to ctx.cwd if no execution context is available.
				// Uses repoRoot for consistency with engine/resume/execution
				// which all persist state and poll abort signals from repoRoot.
				const stateRoot = execCtx?.repoRoot ?? ctx.cwd;

				ctx.ui.notify(`🛑 Abort requested (${mode} mode, prefix: ${prefix})...`, "info");

				// ── Step 1: Write abort signal file immediately ──────────
				// This is the primary abort mechanism. The orchestrator's polling
				// loop checks for this file on every cycle, so even if this command
				// handler runs concurrently with /orch (or is queued behind it),
				// the signal file will be detected.
				const abortSignalFile = join(stateRoot, ".pi", "orch-abort-signal");
				try {
					mkdirSync(join(stateRoot, ".pi"), { recursive: true });
					writeFileSync(abortSignalFile, `abort requested at ${new Date().toISOString()} (mode: ${mode})`, "utf-8");
					ctx.ui.notify("  ✓ Abort signal file written (.pi/orch-abort-signal)", "info");
				} catch (err) {
					ctx.ui.notify(`  ⚠ Failed to write abort signal file: ${err instanceof Error ? err.message : String(err)}`, "warning");
				}

				// ── Step 2: Set pause signal immediately ─────────────────
				// Belt-and-suspenders: if the /orch polling loop can see this
				// shared object, it will stop on the next iteration.
				if (orchBatchState.pauseSignal) {
					orchBatchState.pauseSignal.paused = true;
					ctx.ui.notify("  ✓ Pause signal set on in-memory batch state", "info");
				}

				// ── Step 3: Check what we're aborting ────────────────────
				const hasActiveBatch = orchBatchState.phase !== "idle" &&
					orchBatchState.phase !== "completed" &&
					orchBatchState.phase !== "failed" &&
					orchBatchState.phase !== "stopped";

				let persistedState: PersistedBatchState | null = null;
				try {
					persistedState = loadBatchState(stateRoot);
				} catch {
					// Ignore — we may still have in-memory state or orphan sessions
				}

				ctx.ui.notify(
					`  Batch state: in-memory=${hasActiveBatch ? orchBatchState.phase : "none"}, ` +
					`persisted=${persistedState ? persistedState.batchId : "none"}`,
					"info",
				);

				// ── Step 4: Scan for tmux sessions ──────────────────────
				let allSessionNames: string[] = [];
				try {
					const tmuxOutput = execSync('tmux list-sessions -F "#{session_name}"', {
						encoding: "utf-8",
						timeout: 5000,
					}).trim();
					const all = tmuxOutput ? tmuxOutput.split("\n").map(s => s.trim()).filter(Boolean) : [];
					allSessionNames = all.filter(name => name.startsWith(`${prefix}-`));
					ctx.ui.notify(`  Found ${allSessionNames.length} session(s) matching prefix "${prefix}-": ${allSessionNames.join(", ") || "(none)"}`, "info");
				} catch {
					ctx.ui.notify("  ⚠ Could not list tmux sessions (tmux not available?)", "warning");
				}

				// If no batch AND no sessions, nothing to abort
				if (!hasActiveBatch && !persistedState && allSessionNames.length === 0) {
					ctx.ui.notify(ORCH_MESSAGES.abortNoBatch(), "warning");
					// Clean up signal file
					try { unlinkSync(abortSignalFile); } catch {}
					return;
				}

				const batchId = orchBatchState.batchId || persistedState?.batchId || "unknown";

				// ── Step 5: Kill sessions directly (fast path) ──────────
				// For hard mode or when sessions are found, kill them immediately
				// rather than waiting through the full executeAbort flow.
				if (allSessionNames.length > 0) {
					ctx.ui.notify(`  Killing ${allSessionNames.length} tmux session(s)...`, "info");
					let killed = 0;
					for (const name of allSessionNames) {
						try {
							// Kill child sessions first (worker, reviewer)
							execSync(`tmux kill-session -t "${name}-worker" 2>/dev/null`, { timeout: 3000 }).toString();
						} catch {}
						try {
							execSync(`tmux kill-session -t "${name}-reviewer" 2>/dev/null`, { timeout: 3000 }).toString();
						} catch {}
						try {
							execSync(`tmux kill-session -t "${name}" 2>/dev/null`, { timeout: 3000 }).toString();
							killed++;
							ctx.ui.notify(`    ✓ Killed: ${name}`, "info");
						} catch {
							// Session may have already exited
							ctx.ui.notify(`    · ${name} (already exited)`, "info");
							killed++;
						}
					}
					ctx.ui.notify(`  ✓ ${killed}/${allSessionNames.length} session(s) terminated`, "info");
				} else {
					ctx.ui.notify("  No tmux sessions to kill", "info");
				}

				// ── Step 6: Clean up batch state ────────────────────────
				// TP-041: Deactivate supervisor on abort
				deactivateSupervisor(pi, supervisorState);

				try {
					orchBatchState.phase = "stopped";
					orchBatchState.endedAt = Date.now();
					updateOrchWidget();
					ctx.ui.notify("  ✓ In-memory batch state set to 'stopped'", "info");
				} catch (err) {
					ctx.ui.notify(`  ⚠ Failed to update in-memory state: ${err instanceof Error ? err.message : String(err)}`, "warning");
				}

				try {
					deleteBatchState(stateRoot);
					ctx.ui.notify("  ✓ Batch state file deleted (.pi/batch-state.json)", "info");
				} catch (err) {
					ctx.ui.notify(`  ⚠ Failed to delete batch state file: ${err instanceof Error ? err.message : String(err)}`, "warning");
				}

				// ── Step 7: Clean up abort signal file ───────────────────
				try { unlinkSync(abortSignalFile); } catch {}

				// ── Done ─────────────────────────────────────────────────
				ctx.ui.notify(
					`✅ Abort complete for batch ${batchId}. Sessions killed, state cleaned up.\n` +
					`   Worktrees and branches are preserved for inspection.`,
					"info",
				);
			} catch (err) {
				// Top-level catch: ensure the user ALWAYS sees something
				ctx.ui.notify(
					`❌ Abort failed with error: ${err instanceof Error ? err.message : String(err)}\n` +
					`   Stack: ${err instanceof Error ? err.stack : "N/A"}\n\n` +
					`   Manual cleanup: tmux kill-server (kills ALL tmux sessions)\n` +
					`   Or: tmux kill-session -t <session-name> for each session`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("orch-deps", {
		description: "Show dependency graph: /orch-deps <areas|paths|all> [--refresh] [--task <id>]",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify(
					"Usage: /orch-deps <areas|paths|all> [--refresh] [--task <id>]\n\n" +
					"Shows the dependency graph for tasks in the specified areas.\n\n" +
					"Options:\n" +
					"  --refresh       Force re-scan of areas (bypass dependency cache)\n" +
					"  --task <id>     Show dependencies for a single task only\n\n" +
					"Examples:\n" +
					"  /orch-deps all\n" +
					"  /orch-deps all --task TO-014\n" +
					"  /orch-deps time-off --refresh\n" +
					"  /orch-deps all --task COMP-006 --refresh",
					"info",
				);
				return;
			}

			if (!requireExecCtx(ctx)) return;

			// Parse --refresh flag
			const hasRefresh = /--refresh/.test(args);

			// Parse --task <id> flag
			let filterTaskId: string | undefined;
			const taskMatch = args.match(/--task\s+([A-Z]+-\d+)/i);
			if (taskMatch) {
				filterTaskId = taskMatch[1].toUpperCase();
			}

			// Strip flags to get clean area/path arguments
			let cleanArgs = args
				.replace(/--refresh/g, "")
				.replace(/--task\s+[A-Z]+-\d+/gi, "")
				.trim();

			if (!cleanArgs) {
				ctx.ui.notify(
					"Usage: /orch-deps <areas|paths|all> [--refresh] [--task <id>]\n" +
					"Error: target argument required (e.g., 'all', area name, or path)",
					"error",
				);
				return;
			}

			if (hasRefresh) {
				ctx.ui.notify("🔄 Refresh mode: re-scanning all areas (dependency cache bypassed)", "info");
			}

			// Run discovery (no preflight needed for deps view).
			// Task area paths are workspace-relative, so use workspaceRoot.
			const discovery = runDiscovery(cleanArgs, runnerConfig.task_areas, execCtx!.workspaceRoot, {
				refreshDependencies: hasRefresh,
				dependencySource: orchConfig.dependencies.source,
				useDependencyCache: orchConfig.dependencies.cache,
				workspaceConfig: execCtx!.workspaceConfig,
			});
			ctx.ui.notify(
				formatDiscoveryResults(discovery),
				discovery.errors.length > 0 ? "warning" : "info",
			);

			// Show dependency graph (full or filtered)
			if (discovery.pending.size > 0) {
				ctx.ui.notify(
					formatDependencyGraph(
						discovery.pending,
						discovery.completed,
						filterTaskId,
					),
					"info",
				);
			}
		},
	});

	pi.registerCommand("orch-sessions", {
		description: "List active orchestrator TMUX sessions",
		handler: async (_args, ctx) => {
			const sessions = listOrchSessions(orchConfig.orchestrator.tmux_prefix, orchBatchState);
			ctx.ui.notify(formatOrchSessions(sessions), "info");
		},
	});

	// ── TP-041 Step 2: /orch-takeover — force supervisor takeover ────
	pi.registerCommand("orch-takeover", {
		description: "Force takeover supervisor from another session: /orch-takeover",
		handler: async (_args, ctx) => {
			// Use workspaceRoot so supervisor state root matches engine (R006-1).
			const stateRoot = execCtx.workspaceRoot;

			// If this session already owns the supervisor, nothing to do.
			if (supervisorState.active) {
				ctx.ui.notify(
					"✅ This session is already the active supervisor.\n\n" +
					`  Session: ${supervisorState.lockSessionId}\n` +
					`  Batch: ${supervisorState.batchId || orchBatchState.batchId}`,
					"info",
				);
				return;
			}

			// Re-check lock state (may have changed since session_start).
			const lockResult = checkSupervisorLockOnStartup(stateRoot, loadBatchState);

			switch (lockResult.status) {
				case "no-active-batch":
					ctx.ui.notify(
						"No active batch to supervise.\n\nStart a batch with /orch first.",
						"info",
					);
					return;

				case "no-lockfile":
				case "corrupt":
				case "stale": {
					// No live lock to take over — just activate normally.
					const batchState = lockResult.batchState;
					const summary = buildTakeoverSummary(stateRoot, batchState);
					const reason =
						lockResult.status === "stale"
							? (isProcessAlive(lockResult.lock.pid)
								? `Previous supervisor (PID ${lockResult.lock.pid}) has a stale heartbeat (last: ${lockResult.lock.heartbeat}).`
								: `Previous supervisor (PID ${lockResult.lock.pid}) process is dead.`)
							: lockResult.status === "corrupt"
								? "Found a corrupt supervisor lockfile."
								: "No supervisor lockfile found.";

					ctx.ui.notify(
						`🔄 **${reason}** Activating supervisor.\n\n` + summary,
						"info",
					);

					// Populate orchBatchState from persisted state
					orchBatchState.batchId = batchState.batchId;
					orchBatchState.phase = batchState.phase as typeof orchBatchState.phase;
					orchBatchState.baseBranch = batchState.baseBranch;
					orchBatchState.orchBranch = batchState.orchBranch ?? "";
					orchBatchState.currentWaveIndex = batchState.currentWaveIndex;
					orchBatchState.totalWaves = batchState.wavePlan?.length ?? batchState.totalWaves ?? 0;
					orchBatchState.totalTasks = batchState.totalTasks ?? 0;
					orchBatchState.succeededTasks = batchState.succeededTasks ?? 0;
					orchBatchState.failedTasks = batchState.failedTasks ?? 0;
					orchBatchState.skippedTasks = batchState.skippedTasks ?? 0;
					orchBatchState.blockedTasks = batchState.blockedTasks ?? 0;
					orchBatchState.startedAt = batchState.startedAt;
					orchBatchState.endedAt = batchState.endedAt ?? null;

					await activateSupervisor(
						pi,
						supervisorState,
						orchBatchState,
						orchConfig,
						supervisorConfig,
						stateRoot,
						ctx,
					);

					updateOrchWidget();
					break;
				}

				case "live": {
					// Force takeover from another live session.
					// Write a new lock — the old session's heartbeat will detect
					// the sessionId mismatch and yield gracefully.
					const lock = lockResult.lock;
					const batchState = lockResult.batchState;
					const summary = buildTakeoverSummary(stateRoot, batchState);

					ctx.ui.notify(
						`⚡ **Forcing supervisor takeover from PID ${lock.pid}.**\n\n` +
						`  Previous session: ${lock.sessionId}\n` +
						`  Previous heartbeat: ${lock.heartbeat}\n\n` +
						`The other session will yield on its next heartbeat check.\n\n` +
						summary,
						"warning",
					);

					// Populate orchBatchState from persisted state
					orchBatchState.batchId = batchState.batchId;
					orchBatchState.phase = batchState.phase as typeof orchBatchState.phase;
					orchBatchState.baseBranch = batchState.baseBranch;
					orchBatchState.orchBranch = batchState.orchBranch ?? "";
					orchBatchState.currentWaveIndex = batchState.currentWaveIndex;
					orchBatchState.totalWaves = batchState.wavePlan?.length ?? batchState.totalWaves ?? 0;
					orchBatchState.totalTasks = batchState.totalTasks ?? 0;
					orchBatchState.succeededTasks = batchState.succeededTasks ?? 0;
					orchBatchState.failedTasks = batchState.failedTasks ?? 0;
					orchBatchState.skippedTasks = batchState.skippedTasks ?? 0;
					orchBatchState.blockedTasks = batchState.blockedTasks ?? 0;
					orchBatchState.startedAt = batchState.startedAt;
					orchBatchState.endedAt = batchState.endedAt ?? null;

					// activateSupervisor writes a new lock with this session's ID.
					// The old session's heartbeat timer will detect the sessionId
					// mismatch and deactivate automatically.
					await activateSupervisor(
						pi,
						supervisorState,
						orchBatchState,
						orchConfig,
						supervisorConfig,
						stateRoot,
						ctx,
					);

					updateOrchWidget();
					break;
				}
			}
		},
	});

	pi.registerCommand("orch-integrate", {
		description: "Integrate completed orch batch into your working branch",
		handler: async (args, ctx) => {
			// Show usage if no args and no active batch state to infer from
			if (args?.trim() === "--help" || args?.trim() === "-h") {
				ctx.ui.notify(
					"Usage: /orch-integrate [<orch-branch>] [--merge] [--pr] [--force]\n\n" +
					"Integrate a completed orch batch into your working branch.\n\n" +
					"Modes:\n" +
					"  (default)   Fast-forward merge (cleanest history)\n" +
					"  --merge     Create a real merge commit\n" +
					"  --pr        Push orch branch and create a pull request\n\n" +
					"Options:\n" +
					"  --force     Skip branch safety check\n" +
					"  <branch>    Orch branch name (auto-detected from batch state if omitted)\n\n" +
					"Examples:\n" +
					"  /orch-integrate                          Auto-detect and fast-forward\n" +
					"  /orch-integrate --merge                  Auto-detect with merge commit\n" +
					"  /orch-integrate orch/op-abc123 --pr      Specific branch, create PR\n" +
					"  /orch-integrate --force                  Skip branch safety check",
					"info",
				);
				return;
			}

			if (!requireExecCtx(ctx)) return;

			// Parse arguments
			const parsed = parseIntegrateArgs(args);
			if ("error" in parsed) {
				ctx.ui.notify(`❌ ${parsed.error}\n\nRun /orch-integrate --help for usage.`, "error");
				return;
			}

			// ── Step 2: Resolve integration context ──────────────────
			const { repoRoot } = execCtx!;
			const resolution = resolveIntegrationContext(parsed, {
				loadBatchState: () => loadBatchState(repoRoot),
				getCurrentBranch: () => getCurrentBranch(repoRoot),
				listOrchBranches: () => {
					const result = runGit(["branch", "--list", "orch/*"], repoRoot);
					return result.ok
						? result.stdout.split("\n").map(b => b.replace(/^\*?\s+/, "").trim()).filter(Boolean)
						: [];
				},
				orchBranchExists: (branch: string) => {
					return runGit(["rev-parse", "--verify", `refs/heads/${branch}`], repoRoot).ok;
				},
			});

			if ("error" in resolution) {
				const severity = (resolution as IntegrationContextError).severity;
				ctx.ui.notify(resolution.error, severity === "info" ? "info" : "error");
				return;
			}

			const { orchBranch, baseBranch, batchId, currentBranch, notices } = resolution as IntegrationContext;

			// Show any notices from resolution (auto-detection messages, warnings)
			for (const notice of notices) {
				ctx.ui.notify(notice, "info");
			}

			// ── Step 2: Pre-integration summary ──────────────────────
			// Count commits ahead
			const revListResult = runGit(
				["rev-list", "--count", `${currentBranch}..${orchBranch}`],
				repoRoot,
			);
			const commitsAhead = revListResult.ok ? revListResult.stdout.trim() : "?";

			// Get diff summary
			const diffStatResult = runGit(
				["diff", "--stat", `${currentBranch}...${orchBranch}`],
				repoRoot,
			);
			const diffSummary = diffStatResult.ok ? diffStatResult.stdout.trim() : "(unable to compute diff)";

			ctx.ui.notify(
				`🔀 Integration Summary\n` +
				`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
				`  Orch branch:  ${orchBranch}\n` +
				`  Target:       ${currentBranch}\n` +
				`  Commits:      ${commitsAhead} ahead\n` +
				`  Mode:         ${parsed.mode === "ff" ? "fast-forward" : parsed.mode === "merge" ? "merge commit" : "pull request"}\n` +
				(batchId ? `  Batch:        ${batchId}\n` : "") +
				(parsed.force ? `  ⚠ Force:      branch safety check skipped\n` : "") +
				`\n` +
				(diffSummary ? `${diffSummary}\n` : "") +
				`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
				"info",
			);

			// ── Step 3: Execute integration mode ─────────────────
			// In workspace mode, integrate in every repo that has the orch branch.
			const resolvedOrchBranch = (resolution as IntegrationContext).orchBranch;
			const wsConfig = execCtx!.workspaceConfig;
			const reposToIntegrate: { id: string; root: string }[] = [];

			if (wsConfig) {
				for (const [repoId, repoConf] of wsConfig.repos) {
					// Check if orch branch exists in this repo
					const branchCheck = runGit(["rev-parse", "--verify", `refs/heads/${resolvedOrchBranch}`], repoConf.path);
					if (branchCheck.ok) {
						reposToIntegrate.push({ id: repoId, root: repoConf.path });
					}
				}
			} else {
				reposToIntegrate.push({ id: "(default)", root: repoRoot });
			}

			let totalCommits = 0;
			let allSucceeded = true;
			const repoMessages: string[] = [];

			for (const repo of reposToIntegrate) {
				// Count commits BEFORE integration (after ff, HEAD === orch tip so count would be 0)
				const preCountResult = runGit(["rev-list", "--count", `HEAD..${resolvedOrchBranch}`], repo.root);
				const repoCommitsBefore = preCountResult.ok ? parseInt(preCountResult.stdout) || 0 : 0;

				const integrationResult = executeIntegration(parsed.mode, resolution as IntegrationContext, {
					runGit: (gitArgs: string[]) => runGit(gitArgs, repo.root),
					runCommand: (cmd: string, cmdArgs: string[]) => {
						try {
							const stdout = execFileSync(cmd, cmdArgs, {
								encoding: "utf-8",
								timeout: 60_000,
								cwd: repo.root,
								stdio: ["pipe", "pipe", "pipe"],
							}).trim();
							return { ok: true, stdout, stderr: "" };
						} catch (err: unknown) {
							const e = err as { stdout?: string; stderr?: string; message?: string };
							return {
								ok: false,
								stdout: (e.stdout ?? "").toString().trim(),
								stderr: (e.stderr ?? e.message ?? "unknown error").toString().trim(),
							};
						}
					},
					deleteBatchState: () => { /* handled once after all repos */ },
				});

				if (!integrationResult.success) {
					ctx.ui.notify(`❌ Integration failed in ${repo.id}:\n${integrationResult.error}`, "error");
					allSucceeded = false;
					break;
				}

				totalCommits += repoCommitsBefore;
				repoMessages.push(`  ${repo.id}: ${integrationResult.message}`);
			}

			if (!allSucceeded) return;

			// ── Step 4: Post-integration cleanup & acceptance ────────
			// Run acceptance checks BEFORE deleting batch state so recovery
			// context is still available if something goes wrong.

			// Resolve all repos to verify (all workspace repos, not just those
			// that had the orch branch — roadmap 2d requires "any workspace repo").
			const allRepos: { id: string; root: string }[] = [];
			if (wsConfig) {
				for (const [repoId, repoConf] of wsConfig.repos) {
					allRepos.push({ id: repoId, root: repoConf.path });
				}
			} else {
				allRepos.push({ id: "(default)", root: repoRoot });
			}

			const opId = resolveOperatorId(orchConfig);
			const orchPrefix = orchConfig.orchestrator.worktree_prefix;

			// Drop batch-scoped autostash entries from all repos.
			// Patterns: "orch-integrate-autostash-{batchId}" (from extension.ts)
			//           "merge-agent-autostash-w*-{batchId}" (from merge.ts)
			for (const repo of allRepos) {
				dropBatchAutostash(repo.root, batchId);
			}

			// Run acceptance checks across all workspace repos.
			// In PR mode, the orch branch is intentionally preserved for the PR,
			// so we skip orch branch detection to avoid contradictory output.
			const skipOrchBranch = parsed.mode === "pr";
			const repoFindings: IntegrateCleanupRepoFindings[] = [];
			for (const repo of allRepos) {
				const findings = collectRepoCleanupFindings(
					repo.root, repo.id === "(default)" ? undefined : repo.id,
					opId, batchId, orchPrefix, resolvedOrchBranch, orchConfig,
					{ skipOrchBranch },
				);
				repoFindings.push(findings);
			}

			const cleanupResult = computeIntegrateCleanupResult(repoFindings);

			// NOW delete batch state (acceptance checks are done)
			try { deleteBatchState(repoRoot); } catch { /* best effort */ }

			const integrationSummary = wsConfig
				? `✅ Integrated ${resolvedOrchBranch} across ${reposToIntegrate.length} repo(s).\n${repoMessages.join("\n")}\n${totalCommits} total commit(s) applied.`
				: `${repoMessages[0] || "✅ Integrated."}\n${commitsAhead} commit(s) applied.`;

			const summary = integrationSummary + "\n" + cleanupResult.report;

			ctx.ui.notify(summary, cleanupResult.notifyLevel);

			// TP-043 R004: If supervisor has a deferred batch summary (supervised mode),
			// present it now that integration is complete, then deactivate.
			if (supervisorState.active && supervisorState.pendingSummaryDeps) {
				const deps = supervisorState.pendingSummaryDeps;
				supervisorState.pendingSummaryDeps = null;
				if (supervisorState.batchStateRef && supervisorState.stateRoot) {
					presentBatchSummary(pi, supervisorState.batchStateRef, supervisorState.stateRoot, deps.opId, deps.diagnostics, deps.mergeResults);
				}
				deactivateSupervisor(pi, supervisorState);
			}
		},
	});

	// ── Settings TUI ─────────────────────────────────────────────────

	pi.registerCommand("taskplane-settings", {
		description: "View and edit taskplane configuration",
		handler: async (_args, ctx) => {
			if (!requireExecCtx(ctx)) return;

			try {
				await openSettingsTui(ctx, execCtx!.workspaceRoot, execCtx!.pointer?.configRoot);
			} catch (err: any) {
				ctx.ui.notify(`❌ Failed to load settings: ${err.message}`, "error");
			}
		},
	});

	// ── Session Lifecycle ────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Store widget context for dashboard updates (needed even if startup fails)
		orchWidgetCtx = ctx;

		// ── Build execution context (config + workspace mode detection) ──
		// Reset execCtx before loading to prevent stale state on re-init
		execCtx = null;
		try {
			execCtx = buildExecutionContext(ctx.cwd, loadOrchestratorConfig, loadTaskRunnerConfig);
		} catch (err: unknown) {
			if (err instanceof WorkspaceConfigError) {
				// Workspace config is present but invalid — fatal startup error.
				// Leave execCtx null; command guard will block all commands except abort.
				ctx.ui.notify(
					`❌ Workspace configuration error [${err.code}]\n\n` +
					`${err.message}\n\n` +
					`Fix the workspace config at .pi/taskplane-workspace.yaml or remove it to use repo mode.\n` +
					`Orchestrator commands are disabled until this is resolved.`,
					"error",
				);
				ctx.ui.setStatus(
					"task-orchestrator",
					"🔀 Orchestrator · ❌ startup failed (workspace config error)",
				);
				return;
			}
			throw err; // Re-throw unexpected errors
		}

		// Populate module-level config refs from the loaded context
		orchConfig = execCtx.orchestratorConfig;
		runnerConfig = execCtx.taskRunnerConfig;

		// TP-041: Load supervisor config from unified config.
		// Uses execCtx.repoRoot (not ctx.cwd) for consistency with the
		// established pattern — all config loading after buildExecutionContext
		// uses the resolved execution context paths.
		try {
			supervisorConfig = loadSupervisorConfig(
				execCtx.repoRoot,
				execCtx.pointer?.configRoot,
			);
		} catch {
			// Non-fatal — use defaults if supervisor config fails to load
			supervisorConfig = { ...DEFAULT_SUPERVISOR_CONFIG };
		}

		// Set status line
		const areaCount = Object.keys(runnerConfig.task_areas).length;
		const modeLabel = execCtx.mode === "workspace" ? "workspace" : "repo";
		ctx.ui.setStatus(
			"task-orchestrator",
			`🔀 Orchestrator · ${modeLabel} mode · ${areaCount} areas · ${orchConfig.orchestrator.max_lanes} lanes`,
		);

		// Register initial dashboard widget (idle state)
		updateOrchWidget();

		// ── TP-041 Step 2: Supervisor startup gate ───────────────────
		// Check for an active batch with an existing lockfile. This covers
		// session reconnection scenarios (pi restarted while a batch runs
		// in tmux lanes) and crashed supervisor recovery.
		// Uses workspaceRoot so supervisor state root matches engine (R006-1).
		{
			const stateRoot = execCtx.workspaceRoot;
			const lockResult = checkSupervisorLockOnStartup(stateRoot, loadBatchState);

			switch (lockResult.status) {
				case "no-active-batch":
					// Nothing to do — normal startup
					break;

				case "no-lockfile":
				case "corrupt":
				case "stale": {
					// Become the supervisor for the existing batch.
					// Stale = previous supervisor crashed (pid dead or heartbeat expired).
					// Corrupt = lockfile malformed (treat as stale per R003).
					// No lockfile = active batch without a supervisor (e.g., engine running
					// from a previous /orch that didn't have supervisor support yet).
					const batchState = lockResult.batchState;
					const summary = buildTakeoverSummary(stateRoot, batchState);
					const reason =
						lockResult.status === "stale"
							? (isProcessAlive(lockResult.lock.pid)
								? `Previous supervisor (PID ${lockResult.lock.pid}) has a stale heartbeat (last: ${lockResult.lock.heartbeat}). Process may be hung.`
								: `Previous supervisor (PID ${lockResult.lock.pid}) process is dead.`)
							: lockResult.status === "corrupt"
								? "Found a corrupt supervisor lockfile (treating as stale)."
								: "No supervisor lockfile found for the active batch.";

					ctx.ui.notify(
						`🔄 **Active batch detected — ${reason}**\n\n` +
						`Taking over supervisor duties for batch ${batchState.batchId}.\n\n` +
						summary,
						"info",
					);

					// Populate orchBatchState from persisted state for the supervisor
					// prompt rebuild. We copy the key fields used by the system prompt.
					orchBatchState.batchId = batchState.batchId;
					orchBatchState.phase = batchState.phase as typeof orchBatchState.phase;
					orchBatchState.baseBranch = batchState.baseBranch;
					orchBatchState.orchBranch = batchState.orchBranch ?? "";
					orchBatchState.currentWaveIndex = batchState.currentWaveIndex;
					orchBatchState.totalWaves = batchState.wavePlan?.length ?? batchState.totalWaves ?? 0;
					orchBatchState.totalTasks = batchState.totalTasks ?? 0;
					orchBatchState.succeededTasks = batchState.succeededTasks ?? 0;
					orchBatchState.failedTasks = batchState.failedTasks ?? 0;
					orchBatchState.skippedTasks = batchState.skippedTasks ?? 0;
					orchBatchState.blockedTasks = batchState.blockedTasks ?? 0;
					orchBatchState.startedAt = batchState.startedAt;
					orchBatchState.endedAt = batchState.endedAt ?? null;

					// Activate supervisor with rehydration context.
					// activateSupervisor writes the lockfile and starts heartbeat.
					activateSupervisor(
						pi,
						supervisorState,
						orchBatchState,
						orchConfig,
						supervisorConfig,
						stateRoot,
						ctx,
					);

					updateOrchWidget();
					break;
				}

				case "live": {
					// Another supervisor is actively running (pid alive, heartbeat fresh).
					// Warn the operator and offer force takeover via /orch-takeover.
					const lock = lockResult.lock;
					const batchState = lockResult.batchState;
					ctx.ui.notify(
						`⚠️ **Another supervisor is already monitoring batch ${batchState.batchId}.**\n\n` +
						`  PID: ${lock.pid}\n` +
						`  Session: ${lock.sessionId}\n` +
						`  Started: ${lock.startedAt}\n` +
						`  Last heartbeat: ${lock.heartbeat}\n\n` +
						`To force takeover, run \`/orch-takeover\`.\n` +
						`The other session will yield on its next heartbeat.\n\n` +
						`Otherwise, use the other terminal or the dashboard to monitor the batch.`,
						"warning",
					);

					// Store the live lock info so the /orch handler can detect it
					// (preventing a second /orch from starting a concurrent batch).
					orchBatchState.batchId = batchState.batchId;
					orchBatchState.phase = batchState.phase as typeof orchBatchState.phase;
					orchBatchState.baseBranch = batchState.baseBranch;
					orchBatchState.orchBranch = batchState.orchBranch ?? "";
					orchBatchState.startedAt = batchState.startedAt;

					updateOrchWidget();
					break;
				}
			}
		}

		// Notify user of available commands
		ctx.ui.notify(
			"Task Orchestrator ready\n\n" +
			`Mode: ${modeLabel}\n` +
			`Config: ${orchConfig.orchestrator.max_lanes} lanes, ` +
			`${orchConfig.orchestrator.spawn_mode} mode, ` +
			`${orchConfig.dependencies.source} deps\n` +
			`Areas: ${areaCount} registered\n\n` +
			"/orch <areas|all>        Start batch execution\n" +
			"/orch-plan <areas|all>   Preview execution plan\n" +
			"/orch-deps <areas|all>   Show dependency graph\n" +
			"/orch-sessions           List TMUX sessions\n" +
			"/orch-takeover           Force supervisor takeover\n" +
			"/orch-integrate          Integrate orch branch into working branch",
			"info",
		);

		// Check for taskplane updates (non-blocking)
		checkForUpdate(ctx);
	});

	// ── Session shutdown cleanup ─────────────────────────────────────
	// Ensure supervisor lockfile/heartbeat are cleaned up on normal session exit.
	// This avoids leaving a live-looking lock when the process exits cleanly.
	pi.on("session_end", async () => {
		try {
			await deactivateSupervisor(pi, supervisorState);
		} catch {
			// Best effort only — session is already ending.
		}
	});
}

// ── Update Check ─────────────────────────────────────────────────────

/**
 * Check npm registry for a newer version of taskplane.
 *
 * Runs asynchronously and never throws — update check failures are
 * silently ignored so they don't interfere with normal operation.
 */
async function checkForUpdate(ctx: ExtensionContext): Promise<void> {
	try {
		// Get installed version from our own package.json
		const { readFileSync: readFS } = await import("fs");
		const { dirname, join: joinPath } = await import("path");
		const { fileURLToPath } = await import("url");

		// Resolve package.json relative to this extension file.
		// In npm install layout: node_modules/taskplane/extensions/taskplane/extension.ts
		// package.json is at:    node_modules/taskplane/package.json
		let pkgJsonPath: string;
		try {
			const thisDir = dirname(fileURLToPath(import.meta.url));
			pkgJsonPath = joinPath(thisDir, "..", "..", "package.json");
		} catch {
			// Fallback for environments where import.meta.url is unavailable
			pkgJsonPath = joinPath(__dirname, "..", "..", "package.json");
		}

		let installedVersion: string;
		try {
			const pkg = JSON.parse(readFS(pkgJsonPath, "utf-8"));
			installedVersion = pkg.version;
		} catch {
			return; // Can't determine installed version — skip check
		}

		// Fetch latest version from npm registry (5s timeout)
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);

		const response = await fetch("https://registry.npmjs.org/taskplane/latest", {
			signal: controller.signal,
			headers: { "Accept": "application/json" },
		});
		clearTimeout(timeout);

		if (!response.ok) return;

		const data = await response.json() as { version?: string };
		const latestVersion = data.version;
		if (!latestVersion) return;

		// Compare versions (simple semver comparison)
		if (latestVersion !== installedVersion && isNewerVersion(latestVersion, installedVersion)) {
			ctx.ui.notify(
				`\n` +
				`  Update Available\n` +
				`  New version ${latestVersion} is available (installed: ${installedVersion}).\n` +
				`  Run: pi update\n`,
				"info",
			);
		}
	} catch {
		// Silently ignore — network errors, offline, etc.
	}
}

/**
 * Compare two semver version strings. Returns true if `a` is newer than `b`.
 */
function isNewerVersion(a: string, b: string): boolean {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = pa[i] || 0;
		const nb = pb[i] || 0;
		if (na > nb) return true;
		if (na < nb) return false;
	}
	return false;
}

