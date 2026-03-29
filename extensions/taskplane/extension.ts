import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";

import { execSync, execFileSync } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fork, type ChildProcess } from "child_process";

// Direct imports — avoid barrel (index.ts) to prevent loading the entire module graph.
// Each import targets the specific module where the symbol is defined.
import { DEFAULT_ORCHESTRATOR_CONFIG, DEFAULT_TASK_RUNNER_CONFIG, FATAL_DISCOVERY_CODES, StateFileError, WorkspaceConfigError, freshOrchBatchState } from "./types.ts";
import type { AbortMode, ExecutionContext, MonitorState, OrchestratorConfig, PersistedBatchState, TaskRunnerConfig } from "./types.ts";
import { ORCH_MESSAGES, computeIntegrateCleanupResult } from "./messages.ts";
import type { IntegrateCleanupRepoFindings } from "./messages.ts";
import { computeWaveAssignments } from "./waves.ts";
import { createOrchWidget, formatDependencyGraph, formatWavePlan } from "./formatting.ts";
import { deleteBatchState, loadBatchState, saveBatchState, detectOrphanSessions, parseOrchSessionNames } from "./persistence.ts";
import { deleteStaleBranches, listWorktrees, resolveWorktreeBasePath, formatPreflightResults, runPreflight } from "./worktree.ts";
import { computeTransitiveDependents, executeLane, resolveCanonicalTaskPaths, tmuxHasSession } from "./execution.ts";
import { executeOrchBatch } from "./engine.ts";
import { formatDiscoveryResults, runDiscovery } from "./discovery.ts";
import { formatOrchSessions, listOrchSessions } from "./sessions.ts";
import { getCurrentBranch, runGit } from "./git.ts";
import { hasConfigFiles, resolveConfigRoot, loadOrchestratorConfig, loadSupervisorConfig, loadTaskRunnerConfig } from "./config.ts";
import { resolveOperatorId } from "./naming.ts";
import { reconstructAllocatedLanes, resumeOrchBatch } from "./resume.ts";
import { buildExecutionContext } from "./workspace.ts";
import { openSettingsTui } from "./settings-tui.ts";
import { loadProjectConfig } from "./config-loader.ts";
import { runMigrations } from "./migrations.ts";
import { serializeWorkspaceConfig, applySerializedState, deserializeWorkspaceConfig } from "./engine-worker.ts";
import type { EngineWorkerData, WorkerToMainMessage } from "./engine-worker.ts";
import { cleanupPostIntegrate, formatPostIntegrateCleanup, sweepStaleArtifacts, formatPreflightSweep, rotateSupervisorLogs, formatLogRotation } from "./cleanup.ts";
import { writeMailboxMessage } from "./mailbox.ts";
import type { MailboxMessageType } from "./types.ts";
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
			// TP-052: Include branch protection hint when merge fails
			const protectionHint = result.stderr.includes("protected") || result.stderr.includes("permission")
				? `\n\n  💡 If the branch is protected, use --pr to create a pull request.`
				: "";
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
					`  /orch-integrate --pr       Create a pull request instead` +
					protectionHint,
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
			// TP-052: Include branch protection hint when merge fails
			const mergeProtectionHint = result.stderr.includes("protected") || result.stderr.includes("permission")
				? `\n\n  💡 If the branch is protected, use --pr to create a pull request.`
				: "";
			return {
				success: false,
				integratedLocally: false,
				commitCount: "0",
				message: "",
				error:
					`❌ Merge failed — there may be conflicts.\n` +
					`${result.stderr}\n\n` +
					`Resolve conflicts manually, or try:\n` +
					`  /orch-integrate --pr       Create a pull request instead` +
					mergeProtectionHint,
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

	// 2. Lane branches — task/{opId}-lane-* and saved/task/{opId}-lane-*
	try {
		const branchResult = runGit(["branch", "--list", `task/${opId}-lane-*`], repoRoot);
		if (branchResult.ok && branchResult.stdout.trim()) {
			findings.staleLaneBranches = branchResult.stdout
				.split("\n")
				.map(b => b.replace(/^\*?\s+/, "").trim())
				.filter(Boolean);
		}
		// Also detect saved lane branches (preserved refs from worktree removal)
		const savedBranchResult = runGit(["branch", "--list", `saved/task/${opId}-lane-*`], repoRoot);
		if (savedBranchResult.ok && savedBranchResult.stdout.trim()) {
			const savedBranches = savedBranchResult.stdout
				.split("\n")
				.map(b => b.replace(/^\*?\s+/, "").trim())
				.filter(Boolean);
			findings.staleLaneBranches.push(...savedBranches);
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
	agentModels?: { workerModel?: string; reviewerModel?: string },
): ModelCheckResult[] {
	const entries: ModelCheckEntry[] = [
		{ role: "Worker", modelStr: agentModels?.workerModel ?? (runnerConfig as any).worker?.model ?? "" },
		{ role: "Reviewer", modelStr: agentModels?.reviewerModel ?? (runnerConfig as any).reviewer?.model ?? "" },
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

// ── TP-071: Engine Worker Thread ─────────────────────────────────────

/**
 * Resolve the absolute path to engine-worker.ts for Worker thread spawning.
 *
 * Uses import.meta.url to locate the file relative to this extension module.
 * Falls back to __dirname for environments where import.meta.url is unavailable.
 *
 * @since TP-071
 */
function resolveEngineWorkerPath(): string {
	let thisDir: string;
	try {
		thisDir = dirname(fileURLToPath(import.meta.url));
	} catch {
		thisDir = __dirname;
	}
	return join(thisDir, "engine-worker-entry.mjs");
}

/**
 * Launch the engine batch in a worker thread.
 *
 * Replaces `startBatchAsync()` for the worker-thread execution model (TP-071).
 * The engine runs in a separate V8 isolate, keeping the main thread free
 * for TUI interaction and supervisor agent LLM calls.
 *
 * If the worker fails to spawn (e.g., TypeScript not supported in workers),
 * falls back to main-thread execution via `startBatchAsync()`.
 *
 * Communication:
 * - Worker → Main: postMessage for notify, monitor-update, engine-event, state-sync, complete
 * - Main → Worker: postMessage for pause/unpause control
 *
 * Terminal idempotency: a `settled` flag ensures that only the first terminal
 * path (complete message, error event, or non-zero exit) triggers `onTerminal`.
 * This prevents duplicate summary/integration/supervisor flows (R001 §3).
 *
 * @param wkData        Serialized engine configuration and parameters
 * @param batchState    Main thread's batch state (updated via state-sync messages)
 * @param ctx           Extension context for UI notifications
 * @param updateWidget  Widget refresh callback
 * @param onMonitorUpdate  Optional callback for dashboard monitor updates
 * @param onTerminal    Callback when engine reaches terminal state
 * @returns The Worker instance (for pause/abort control), or null if fallback was used
 *
 * @since TP-071
 */
export function startBatchInWorker(
	wkData: EngineWorkerData,
	batchState: import("./types.ts").OrchBatchRuntimeState,
	ctx: ExtensionContext,
	updateWidget: () => void,
	onMonitorUpdate?: (state: import("./types.ts").MonitorState) => void,
	onTerminal?: () => void,
	onSupervisorAlert?: (alert: import("./types.ts").SupervisorAlert) => void,
): ChildProcess | null {
	const workerPath = resolveEngineWorkerPath();

	let child: ChildProcess;
	try {
		// Fork a child process to run the engine in a separate isolate.
		// The entry point is a .mjs file that uses jiti to load .ts files,
		// bypassing Node v25's restriction on .ts in node_modules.
		child = fork(workerPath, [], {
			env: { ...process.env, TASKPLANE_ENGINE_FORK: "1" },
			serialization: "advanced",
		});
	} catch (spawnErr: unknown) {
		const errMsg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
		ctx.ui.notify(
			`⚠️ Engine process spawn failed: ${errMsg}\n   Falling back to main-thread execution.`,
			"warning",
		);
		// Construct fallback engine function from workerData and run on main thread
		const wsConfig = wkData.workspaceConfig
			? deserializeWorkspaceConfig(wkData.workspaceConfig)
			: undefined;
		const fallbackFn = wkData.mode === "resume"
			? () => resumeOrchBatch(
				wkData.orchConfig,
				wkData.runnerConfig,
				wkData.cwd,
				batchState,
				(msg: string, lvl: "info" | "warning" | "error") => { ctx.ui.notify(msg, lvl); updateWidget(); },
				(monState: import("./types.ts").MonitorState) => { onMonitorUpdate?.(monState); },
				wsConfig,
				wkData.workspaceRoot,
				wkData.agentRoot,
				wkData.force ?? false,
				onSupervisorAlert ?? null,
			)
			: () => executeOrchBatch(
				wkData.args ?? "",
				wkData.orchConfig,
				wkData.runnerConfig,
				wkData.cwd,
				batchState,
				(msg: string, lvl: "info" | "warning" | "error") => { ctx.ui.notify(msg, lvl); updateWidget(); },
				(monState: import("./types.ts").MonitorState) => { onMonitorUpdate?.(monState); },
				wsConfig,
				wkData.workspaceRoot,
				wkData.agentRoot,
				null, // onEngineEvent
				onSupervisorAlert ?? null,
			);
		startBatchAsync(fallbackFn, batchState, ctx, updateWidget, onTerminal);
		return null;
	}

	// Send workerData as first IPC message
	child.send({ type: "init", data: wkData });

	// Terminal settlement guard (R001 §3): ensures onTerminal fires at most once.
	let settled = false;
	const settle = () => {
		if (settled) return;
		settled = true;
		onTerminal?.();
	};

	child.on("message", (msg: WorkerToMainMessage) => {
		switch (msg.type) {
			case "notify":
				ctx.ui.notify(msg.msg, msg.level);
				updateWidget();
				break;

			case "monitor-update":
				onMonitorUpdate?.(msg.state);
				break;

			case "engine-event":
				break;

			// ── TP-076: Supervisor alert handling ────────────────
			case "supervisor-alert":
				onSupervisorAlert?.(msg.alert);
				break;

			case "state-sync":
				applySerializedState(batchState, msg.state);
				updateWidget();
				break;

			case "complete":
				applySerializedState(batchState, msg.state);
				updateWidget();
				settle();
				break;

			case "error":
				if (batchState.phase !== "completed" && batchState.phase !== "failed") {
					batchState.phase = "failed";
					batchState.endedAt = Date.now();
					batchState.errors.push(`Unhandled engine error: ${msg.message}`);
				}
				ctx.ui.notify(
					`❌ Engine crashed with unhandled error: ${msg.message}\n` +
					`   Batch ${batchState.batchId} marked as failed.`,
					"error",
				);
				updateWidget();
				break;
		}
	});

	child.on("error", (err: Error) => {
		if (batchState.phase !== "completed" && batchState.phase !== "failed") {
			batchState.phase = "failed";
			batchState.endedAt = Date.now();
			batchState.errors.push(`Engine process error: ${err.message}`);
		}
		ctx.ui.notify(
			`❌ Engine process error: ${err.message}\n` +
			`   Batch ${batchState.batchId} marked as failed.`,
			"error",
		);
		updateWidget();
		// ── TP-076: Alert supervisor about engine process error ──
		onSupervisorAlert?.({
			category: "task-failure",
			summary:
				`🔴 Engine process error — batch ${batchState.batchId} marked as failed\n` +
				`  Error: ${err.message}\n\n` +
				`This is a critical engine failure. The batch cannot continue.\n` +
				`Available actions:\n` +
				`  - orch_status() to inspect state\n` +
				`  - orch_resume(force=true) to retry from last checkpoint`,
			context: {
				batchProgress: batchState.totalTasks > 0 ? {
					succeededTasks: batchState.succeededTasks,
					failedTasks: batchState.failedTasks,
					skippedTasks: batchState.skippedTasks,
					blockedTasks: batchState.blockedTasks,
					totalTasks: batchState.totalTasks,
					currentWave: batchState.currentWaveIndex + 1,
					totalWaves: batchState.totalWaves,
				} : undefined,
			},
		});
		settle();
	});

	child.on("exit", (code: number | null) => {
		if (code !== 0 && !settled) {
			if (batchState.phase !== "completed" && batchState.phase !== "failed") {
				batchState.phase = "failed";
				batchState.endedAt = Date.now();
				batchState.errors.push(`Engine process exited with code ${code}`);
			}
			ctx.ui.notify(
				`❌ Engine process exited unexpectedly (code ${code}).`,
				"error",
			);
			updateWidget();
			// ── TP-076: Alert supervisor about unexpected engine exit ──
			onSupervisorAlert?.({
				category: "task-failure",
				summary:
					`🔴 Engine process died unexpectedly (exit code ${code})\n` +
					`  Batch ${batchState.batchId} marked as failed.\n\n` +
					`This is a critical engine failure. The batch cannot continue.\n` +
					`Available actions:\n` +
					`  - orch_status() to inspect state\n` +
					`  - orch_resume(force=true) to retry from last checkpoint`,
				context: {
					batchProgress: batchState.totalTasks > 0 ? {
						succeededTasks: batchState.succeededTasks,
						failedTasks: batchState.failedTasks,
						skippedTasks: batchState.skippedTasks,
						blockedTasks: batchState.blockedTasks,
						totalTasks: batchState.totalTasks,
						currentWave: batchState.currentWaveIndex + 1,
						totalWaves: batchState.totalWaves,
					} : undefined,
				},
			});
		}
		settle();
	});

	return child;
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
export function buildIntegrationExecutor(repoRoot: string, opId?: string, stateRoot?: string): IntegrationExecutor {
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

		const result = executeIntegration(mode as IntegrateMode, {
			...context,
			currentBranch: context.baseBranch,
		}, deps);

		// TP-051: Clean up stale task/* and saved/* branches after successful integration.
		// This ensures auto-mode integration (supervisor path) gets the same cleanup
		// as the manual /orch-integrate handler.
		if (result.success && result.integratedLocally && context.batchId && opId) {
			try {
				deleteStaleBranches(repoRoot, opId, context.batchId);
				dropBatchAutostash(repoRoot, context.batchId);
			} catch { /* best effort — don't fail integration for cleanup errors */ }

			// TP-065: Post-integrate artifact cleanup (Layer 1).
			// Also runs on the supervisor auto-integration path.
			try {
				cleanupPostIntegrate(stateRoot ?? repoRoot, context.batchId);
			} catch { /* best effort — don't fail integration for cleanup errors */ }
		}

		return result;
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

	// ── TP-071: Active engine child process ──────────────────────────
	// Tracked so pause/abort can send control messages to the engine.
	let activeWorker: ChildProcess | null = null;

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
	/** Last startup error message to surface consistently through command guards. */
	let execCtxInitError: string | null = null;

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

	function getExecCtxInitErrorMessage(): string {
		return execCtxInitError ??
			"❌ Orchestrator not initialized. Startup failed before execution context was created.\nRestart the session after fixing configuration/setup issues.";
	}

	/**
	 * Guard: returns true if execution context is initialized, false otherwise.
	 * Emits a user-facing error notification when the context is missing.
	 */
	function requireExecCtx(ctx: ExtensionContext): boolean {
		if (execCtx) return true;
		ctx.ui.notify(getExecCtxInitErrorMessage(), "error");
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

			// ── TP-061: Delegate to shared helper ────────────────────
			const result = await doOrchStart(args, ctx);
			if (result.error) {
				ctx.ui.notify(result.message, "warning");
			}
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
				{
					workspaceRepoIds: execCtx!.workspaceConfig
						? execCtx!.workspaceConfig.repos.keys()
						: undefined,
				},
			);

			ctx.ui.notify(
				formatWavePlan(waveResult, orchConfig.assignment.size_weights),
				waveResult.errors.length > 0 ? "error" : "info",
			);
		},
	});

	// ── TP-053: Shared helpers for command + tool handlers ────────────
	// Each helper extracts the core logic from its command handler so both
	// the slash command and the registered tool can call the same function.

	/**
	 * Core logic for starting a batch. Used by both `/orch <target>` command
	 * and the `orch_start` tool.
	 *
	 * Performs all pre-start guards (execution context, concurrent batch,
	 * routing-mode transition, orphan detection, model validation), then
	 * launches the engine asynchronously and activates the supervisor.
	 *
	 * Returns an immediate ACK with batch ID, task count, and wave info,
	 * or an error message if the batch cannot be started.
	 *
	 * @since TP-061
	 */
	async function doOrchStart(target: string, ctx: ExtensionContext): Promise<{ message: string; error?: boolean }> {
		// Target validation
		const trimmedTarget = target?.trim();
		if (!trimmedTarget) {
			return {
				message: "❌ Target is required. Use \"all\" to run all pending tasks, or specify a task area name or path.",
				error: true,
			};
		}

		if (!execCtx) {
			return {
				message: getExecCtxInitErrorMessage(),
				error: true,
			};
		}

		// TP-063: Run additive migrations before batch start (primary trigger).
		// Non-fatal — failures warn but never block batch execution.
		try {
			const migrationResult = runMigrations(execCtx.repoRoot, undefined, execCtx.pointer?.configRoot);
			if (migrationResult.messages.length > 0) {
				ctx.ui.notify(migrationResult.messages.join("\n"), "info");
			}
			if (migrationResult.errors.length > 0) {
				ctx.ui.notify(
					`⚠️ Migration warnings:\n${migrationResult.errors.map(e => `  ⚠ ${e.id}: ${e.error}`).join("\n")}`,
					"warning",
				);
			}
		} catch {
			// Swallow — migrations must never block /orch
		}

		// TP-128: Transition from routing-mode supervisor to batch execution
		if (supervisorState.active && supervisorState.routingContext) {
			await deactivateSupervisor(pi, supervisorState);
		}

		// Prevent concurrent batch execution
		if (orchBatchState.phase !== "idle" && orchBatchState.phase !== "completed" && orchBatchState.phase !== "failed" && orchBatchState.phase !== "stopped") {
			return {
				message: `⚠️ A batch is already ${orchBatchState.phase} (${orchBatchState.batchId}). Use /orch-pause to pause or wait for completion.`,
				error: true,
			};
		}

		const { repoRoot } = execCtx;

		// Orphan detection
		const orphanResult = detectOrphanSessions(
			orchConfig.orchestrator.tmux_prefix,
			repoRoot,
		);

		switch (orphanResult.recommendedAction) {
			case "resume": {
				const resumablePhases = ["paused", "executing", "merging"];
				const phase = orphanResult.loadedState?.phase ?? "";
				const hasOrphans = orphanResult.orphanSessions.length > 0;
				if (!hasOrphans && !resumablePhases.includes(phase)) {
					try { deleteBatchState(repoRoot); } catch { /* best effort */ }
					ctx.ui.notify(
						`🧹 Cleared non-resumable stale batch (${orphanResult.loadedState?.batchId}, phase=${phase}). Starting fresh.`,
						"info",
					);
					break;
				}
				return { message: orphanResult.userMessage, error: true };
			}
			case "abort-orphans":
				return { message: orphanResult.userMessage, error: true };
			case "cleanup-stale":
				try { deleteBatchState(repoRoot); } catch { /* best effort */ }
				if (orphanResult.userMessage) {
					ctx.ui.notify(orphanResult.userMessage, "info");
				}
				break;
			case "paused-corrupt":
				orchBatchState.phase = "paused";
				orchBatchState.errors.push(orphanResult.userMessage);
				updateOrchWidget();
				return { message: orphanResult.userMessage, error: true };
			case "start-fresh":
				break;
		}

		// Model availability pre-flight
		let agentModels: { workerModel?: string; reviewerModel?: string } | undefined;
		try {
			const fullConfig = loadProjectConfig(execCtx.repoRoot);
			agentModels = {
				workerModel: fullConfig.taskRunner.worker.model || "",
				reviewerModel: fullConfig.taskRunner.reviewer.model || "",
			};
		} catch { /* fall through */ }
		const modelResults = validateModelAvailability(orchConfig, runnerConfig, supervisorConfig, ctx, agentModels);
		const modelFailures = modelResults.filter(r => r.status === "not-found");
		ctx.ui.notify(formatModelValidation(modelResults), modelFailures.length > 0 ? "error" : "info");
		if (modelFailures.length > 0) {
			return {
				message: `❌ Cannot start batch — ${modelFailures.length} model(s) not found: ` +
					modelFailures.map(f => `${f.role} (${f.modelStr})`).join(", ") +
					`.\n\nFix the model configuration and try again.`,
				error: true,
			};
		}

		// Pre-discovery: count pending tasks for the ACK response.
		// This is a lightweight synchronous check before launching the async engine.
		let pendingTaskCount = 0;
		try {
			const preDiscovery = runDiscovery(trimmedTarget, runnerConfig.task_areas, execCtx.workspaceRoot, {
				dependencySource: orchConfig.dependencies.source,
				useDependencyCache: orchConfig.dependencies.cache,
				workspaceConfig: execCtx.workspaceConfig,
			});
			pendingTaskCount = preDiscovery.pending.size;
			if (pendingTaskCount === 0) {
				return {
					message: `No pending tasks found for target "${trimmedTarget}". Nothing to execute.`,
					error: true,
				};
			}
		} catch {
			// Non-fatal — engine will re-run discovery and handle errors
		}

		// Reset batch state for new execution
		orchBatchState = freshOrchBatchState();
		latestMonitorState = null;

		orchBatchState.phase = "launching";
		orchBatchState.startedAt = Date.now();
		updateOrchWidget();

		// Non-blocking engine launch in worker thread (TP-071)
		activeWorker = startBatchInWorker(
			{
				engineWorker: true,
				mode: "execute",
				args: trimmedTarget,
				orchConfig,
				runnerConfig,
				cwd: repoRoot,
				workspaceConfig: execCtx!.workspaceConfig
					? serializeWorkspaceConfig(execCtx!.workspaceConfig)
					: null,
				workspaceRoot: execCtx!.workspaceRoot,
				agentRoot: execCtx!.pointer?.agentRoot,
			},
			orchBatchState,
			ctx,
			updateOrchWidget,
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
				if (changed) updateOrchWidget();
			},
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
						repoRoot,
						buildIntegrationExecutor(repoRoot, opId, execCtx!.workspaceRoot),
						buildCiDeps(repoRoot),
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
				presentBatchSummary(pi, orchBatchState, execCtx!.workspaceRoot, opId, orchBatchState.diagnostics, sDeps.mergeResults);
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
			// ── TP-076: Supervisor alert handler — injects alerts as user messages ──
			(alert) => {
				if (!supervisorState.active) return; // Don't send orphaned messages
				pi.sendUserMessage(alert.summary, { deliverAs: "followUp" });
			},
		);

		// Activate supervisor agent
		activateSupervisor(
			pi,
			supervisorState,
			orchBatchState,
			orchConfig,
			supervisorConfig,
			execCtx!.workspaceRoot,
			ctx,
		);

		return {
			message: `🚀 Batch launching (target: "${trimmedTarget}", ${pendingTaskCount} pending task${pendingTaskCount === 1 ? "" : "s"}). ` +
				`Batch ID will be assigned during planning. ` +
				`The engine is running asynchronously — use orch_status() to check progress.`,
		};
	}

	/**
	 * Core logic for orch-status. Returns a formatted status string.
	 * Reads in-memory state first, falls back to disk if idle.
	 */
	function doOrchStatus(cwd: string): string {
		if (orchBatchState.phase === "idle") {
			const stateRoot = execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? cwd;
			let diskState: PersistedBatchState | null = null;
			try {
				diskState = loadBatchState(stateRoot);
			} catch {
				// Ignore errors — fall through to "no batch" message
			}

			if (!diskState) {
				return "No batch is running. Use /orch <areas|paths|all> to start.";
			}

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

			return lines.join("\n");
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

		return lines.join("\n");
	}

	/**
	 * Core logic for orch-pause. Returns a status message string.
	 */
	function doOrchPause(): string {
		if (orchBatchState.phase === "idle" || orchBatchState.phase === "completed" || orchBatchState.phase === "failed" || orchBatchState.phase === "stopped") {
			return ORCH_MESSAGES.pauseNoBatch();
		}
		if (orchBatchState.phase === "paused" || orchBatchState.pauseSignal.paused) {
			return ORCH_MESSAGES.pauseAlreadyPaused(orchBatchState.batchId);
		}
		orchBatchState.pauseSignal.paused = true;
		// TP-071: Forward pause to engine process (its pauseSignal is separate)
		activeWorker?.send({ type: "pause" });
		updateOrchWidget();
		return ORCH_MESSAGES.pauseActivated(orchBatchState.batchId);
	}

	/**
	 * Core logic for orch-resume. Returns an immediate status message.
	 * The actual batch resume runs asynchronously via startBatchInWorker (TP-071).
	 * Returns null if execCtx is missing (caller must handle).
	 */
	function doOrchResume(force: boolean, ctx: ExtensionContext): { message: string; error?: boolean } {
		if (!execCtx) {
			return {
				message: getExecCtxInitErrorMessage(),
				error: true,
			};
		}

		// Prevent resume if a batch is actively running
		if (orchBatchState.phase === "launching" || orchBatchState.phase === "executing" || orchBatchState.phase === "merging" || orchBatchState.phase === "planning") {
			return {
				message: `⚠️ A batch is currently ${orchBatchState.phase} (${orchBatchState.batchId}). Cannot resume.`,
				error: true,
			};
		}

		// Reset batch state for resume
		orchBatchState = freshOrchBatchState();
		latestMonitorState = null;

		orchBatchState.phase = "launching";
		orchBatchState.startedAt = Date.now();
		updateOrchWidget();

		// Fire-and-forget resume via worker thread (TP-071)
		activeWorker = startBatchInWorker(
			{
				engineWorker: true,
				mode: "resume",
				args: "",
				orchConfig,
				runnerConfig,
				cwd: execCtx!.repoRoot,
				workspaceConfig: execCtx!.workspaceConfig
					? serializeWorkspaceConfig(execCtx!.workspaceConfig)
					: null,
				workspaceRoot: execCtx!.workspaceRoot,
				agentRoot: execCtx!.pointer?.agentRoot,
				force,
			},
			orchBatchState,
			ctx,
			updateOrchWidget,
			(monState: MonitorState) => {
				latestMonitorState = monState;
				updateOrchWidget();
			},
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
						buildIntegrationExecutor(execCtx!.repoRoot, opId, execCtx!.workspaceRoot),
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
				presentBatchSummary(pi, orchBatchState, execCtx!.workspaceRoot, opId, orchBatchState.diagnostics, sDeps.mergeResults);
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
			// ── TP-076: Supervisor alert handler — injects alerts as user messages ──
			(alert) => {
				if (!supervisorState.active) return; // Don't send orphaned messages
				pi.sendUserMessage(alert.summary, { deliverAs: "followUp" });
			},
		);

		// Activate supervisor agent on resume
		activateSupervisor(
			pi,
			supervisorState,
			orchBatchState,
			orchConfig,
			supervisorConfig,
			execCtx!.workspaceRoot,
			ctx,
		);

		return { message: `🔄 Resume initiated for batch. Phase: launching.` };
	}

	/**
	 * Core logic for orch-abort. Returns accumulated status messages.
	 * Works even without execCtx (safety-critical).
	 */
	function doOrchAbort(hard: boolean, ctx: ExtensionContext): string {
		const mode: AbortMode = hard ? "hard" : "graceful";
		const prefix = orchConfig.orchestrator.tmux_prefix;

		const stateRoot = execCtx?.repoRoot ?? ctx.cwd;
		const messages: string[] = [`🛑 Abort requested (${mode} mode, prefix: ${prefix})...`];

		// Step 1: Write abort signal file
		const abortSignalFile = join(stateRoot, ".pi", "orch-abort-signal");
		try {
			mkdirSync(join(stateRoot, ".pi"), { recursive: true });
			writeFileSync(abortSignalFile, `abort requested at ${new Date().toISOString()} (mode: ${mode})`, "utf-8");
			messages.push("  ✓ Abort signal file written (.pi/orch-abort-signal)");
		} catch (err) {
			messages.push(`  ⚠ Failed to write abort signal file: ${err instanceof Error ? err.message : String(err)}`);
		}

		// Step 2: Set pause signal and forward to worker
		if (orchBatchState.pauseSignal) {
			orchBatchState.pauseSignal.paused = true;
			messages.push("  ✓ Pause signal set on in-memory batch state");
		}
		// TP-071: Forward pause to engine and kill on hard abort
		if (activeWorker) {
			activeWorker.send({ type: "pause" });
			if (hard) {
				activeWorker.kill();
				activeWorker = null;
				messages.push("  ✓ Engine process killed (hard abort)");
			} else {
				messages.push("  ✓ Pause signal forwarded to engine process");
			}
		}

		// Step 3: Check what we're aborting
		const hasActiveBatch = orchBatchState.phase !== "idle" &&
			orchBatchState.phase !== "completed" &&
			orchBatchState.phase !== "failed" &&
			orchBatchState.phase !== "stopped";

		let persistedState: PersistedBatchState | null = null;
		try {
			persistedState = loadBatchState(stateRoot);
		} catch {
			// Ignore
		}

		messages.push(
			`  Batch state: in-memory=${hasActiveBatch ? orchBatchState.phase : "none"}, ` +
			`persisted=${persistedState ? persistedState.batchId : "none"}`,
		);

		// If no batch AND no sessions, nothing to abort
		if (!hasActiveBatch && !persistedState) {
			// Still check for sessions below, but short-circuit if none
			let allSessionNames: string[] = [];
			try {
				const tmuxOutput = execSync('tmux list-sessions -F "#{session_name}"', {
					encoding: "utf-8",
					timeout: 5000,
				}).trim();
				const all = tmuxOutput ? tmuxOutput.split("\n").map(s => s.trim()).filter(Boolean) : [];
				allSessionNames = all.filter(name => name.startsWith(`${prefix}-`));
			} catch {
				// tmux not available
			}
			if (allSessionNames.length === 0) {
				try { unlinkSync(abortSignalFile); } catch {}
				return ORCH_MESSAGES.abortNoBatch();
			}
		}

		const batchId = orchBatchState.batchId || persistedState?.batchId || "unknown";

		// Step 5: Kill sessions
		let allSessionNames: string[] = [];
		try {
			const tmuxOutput = execSync('tmux list-sessions -F "#{session_name}"', {
				encoding: "utf-8",
				timeout: 5000,
			}).trim();
			const all = tmuxOutput ? tmuxOutput.split("\n").map(s => s.trim()).filter(Boolean) : [];
			allSessionNames = all.filter(name => name.startsWith(`${prefix}-`));
			messages.push(`  Found ${allSessionNames.length} session(s) matching prefix "${prefix}-"`);
		} catch {
			messages.push("  ⚠ Could not list tmux sessions (tmux not available?)");
		}

		if (allSessionNames.length > 0) {
			messages.push(`  Killing ${allSessionNames.length} tmux session(s)...`);
			let killed = 0;
			for (const name of allSessionNames) {
				try {
					execSync(`tmux kill-session -t "${name}-worker" 2>/dev/null`, { timeout: 3000 }).toString();
				} catch {}
				try {
					execSync(`tmux kill-session -t "${name}-reviewer" 2>/dev/null`, { timeout: 3000 }).toString();
				} catch {}
				try {
					execSync(`tmux kill-session -t "${name}" 2>/dev/null`, { timeout: 3000 }).toString();
					killed++;
					messages.push(`    ✓ Killed: ${name}`);
				} catch {
					messages.push(`    · ${name} (already exited)`);
					killed++;
				}
			}
			messages.push(`  ✓ ${killed}/${allSessionNames.length} session(s) terminated`);
		} else {
			messages.push("  No tmux sessions to kill");
		}

		// Step 6: Clean up batch state
		deactivateSupervisor(pi, supervisorState);

		try {
			orchBatchState.phase = "stopped";
			orchBatchState.endedAt = Date.now();
			updateOrchWidget();
			messages.push("  ✓ In-memory batch state set to 'stopped'");
		} catch (err) {
			messages.push(`  ⚠ Failed to update in-memory state: ${err instanceof Error ? err.message : String(err)}`);
		}

		try {
			deleteBatchState(stateRoot);
			messages.push("  ✓ Batch state file deleted (.pi/batch-state.json)");
		} catch (err) {
			messages.push(`  ⚠ Failed to delete batch state file: ${err instanceof Error ? err.message : String(err)}`);
		}

		// Step 7: Clean up abort signal file
		try { unlinkSync(abortSignalFile); } catch {}

		messages.push(
			`✅ Abort complete for batch ${batchId}. Sessions killed, state cleaned up.\n` +
			`   Worktrees and branches are preserved for inspection.`,
		);

		return messages.join("\n");
	}

	// ── TP-077: Supervisor Recovery Tools ────────────────────────────

	/**
	 * Core logic for orch_retry_task. Resets a failed task to pending for re-execution.
	 *
	 * Modifies persisted batch state on disk and updates in-memory state.
	 * The engine picks up the state change on its next poll cycle.
	 */
	function doOrchRetryTask(taskId: string, ctx: ExtensionContext): string {
		// TP-077 R001-1: Reject while engine is actively running (no IPC retry path)
		const activePhases = new Set(["launching", "executing", "merging", "planning"]);
		if (activePhases.has(orchBatchState.phase)) {
			return `❌ Cannot retry task while batch is ${orchBatchState.phase}. Pause or wait for the current operation to finish first.`;
		}

		const stateRoot = execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd;

		// Load persisted state
		let state: PersistedBatchState | null = null;
		try {
			state = loadBatchState(stateRoot);
		} catch (err) {
			return `❌ Failed to load batch state: ${err instanceof Error ? err.message : String(err)}`;
		}

		if (!state) {
			return "❌ No batch state found. There is no active or recent batch to modify.";
		}

		// Find the task
		const taskRecord = state.tasks.find(t => t.taskId === taskId);
		if (!taskRecord) {
			const knownIds = state.tasks.map(t => t.taskId).join(", ");
			return `❌ Task "${taskId}" not found in batch ${state.batchId}.\nKnown tasks: ${knownIds || "(none)"}`;
		}

		// Validate: only failed or stalled tasks can be retried
		if (taskRecord.status !== "failed" && taskRecord.status !== "stalled") {
			return `❌ Cannot retry task "${taskId}" — current status is "${taskRecord.status}". Only failed or stalled tasks can be retried.`;
		}

		const prevStatus = taskRecord.status;

		// Reset task to pending
		taskRecord.status = "pending";
		taskRecord.exitReason = "";
		taskRecord.doneFileFound = false;
		taskRecord.startedAt = null;
		taskRecord.endedAt = null;
		taskRecord.exitDiagnostic = undefined;
		taskRecord.partialProgressCommits = undefined;
		taskRecord.partialProgressBranch = undefined;

		// Adjust counters: only decrement failedTasks if the task was in a failure state
		if (prevStatus === "failed" || prevStatus === "stalled") {
			state.failedTasks = Math.max(0, state.failedTasks - 1);
		}

		// Recompute blocked dependents — the retried task is no longer a failure,
		// so tasks that were blocked solely by it should be unblocked.
		const remainingFailures = new Set<string>();
		for (const t of state.tasks) {
			if (t.status === "failed" || t.status === "stalled") {
				remainingFailures.add(t.taskId);
			}
		}
		if (orchBatchState.dependencyGraph && orchBatchState.batchId === state.batchId) {
			const newBlocked = computeTransitiveDependents(remainingFailures, orchBatchState.dependencyGraph);
			state.blockedTaskIds = [...newBlocked].sort();
			state.blockedTasks = newBlocked.size;
		} else if (remainingFailures.size === 0) {
			state.blockedTaskIds = [];
			state.blockedTasks = 0;
		}

		// TP-077 R001-3: Phase transition — terminal "failed" → "stopped" (resumable with force)
		// "stopped" and "paused" are kept as-is (already resumable).
		if (state.phase === "failed") {
			state.phase = "stopped";
		}

		// Update timestamp
		state.updatedAt = Date.now();

		// Persist
		try {
			saveBatchState(JSON.stringify(state, null, 2), stateRoot);
		} catch (err) {
			return `❌ Failed to persist state after retry: ${err instanceof Error ? err.message : String(err)}`;
		}

		// Sync in-memory state if batch IDs match
		if (orchBatchState.batchId === state.batchId) {
			orchBatchState.failedTasks = state.failedTasks;
			orchBatchState.blockedTasks = state.blockedTasks;
			orchBatchState.blockedTaskIds = new Set(state.blockedTaskIds);
			if (state.phase === "stopped" && orchBatchState.phase === "failed") {
				orchBatchState.phase = "stopped";
			}
		}

		updateOrchWidget();

		const resumeHint = state.phase === "stopped"
			? "Use orch_resume(force=true) to re-execute the batch."
			: "Use orch_resume() to re-execute the batch.";
		return `✅ Task "${taskId}" reset to pending for re-execution.\n` +
			`   Previous status: ${prevStatus}\n` +
			`   Batch phase: ${state.phase} | Failed: ${state.failedTasks}/${state.totalTasks}\n` +
			`   ${resumeHint}`;
	}

	/**
	 * Core logic for orch_skip_task. Marks a task as skipped and unblocks dependents.
	 *
	 * Modifies persisted batch state on disk and updates in-memory state.
	 * The engine picks up the state change on its next poll cycle.
	 */
	function doOrchSkipTask(taskId: string, ctx: ExtensionContext): string {
		// TP-077 R001-1: Reject while engine is actively running (no IPC skip path)
		const activePhases = new Set(["launching", "executing", "merging", "planning"]);
		if (activePhases.has(orchBatchState.phase)) {
			return `❌ Cannot skip task while batch is ${orchBatchState.phase}. Pause or wait for the current operation to finish first.`;
		}

		const stateRoot = execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd;

		// Load persisted state
		let state: PersistedBatchState | null = null;
		try {
			state = loadBatchState(stateRoot);
		} catch (err) {
			return `❌ Failed to load batch state: ${err instanceof Error ? err.message : String(err)}`;
		}

		if (!state) {
			return "❌ No batch state found. There is no active or recent batch to modify.";
		}

		// Find the task
		const taskRecord = state.tasks.find(t => t.taskId === taskId);
		if (!taskRecord) {
			const knownIds = state.tasks.map(t => t.taskId).join(", ");
			return `❌ Task "${taskId}" not found in batch ${state.batchId}.\nKnown tasks: ${knownIds || "(none)"}`;
		}

		// Validate: only failed, stalled, or pending tasks can be skipped
		if (taskRecord.status !== "failed" && taskRecord.status !== "stalled" && taskRecord.status !== "pending") {
			return `❌ Cannot skip task "${taskId}" — current status is "${taskRecord.status}". Only failed, stalled, or pending tasks can be skipped.`;
		}

		const prevStatus = taskRecord.status;
		const wasFailed = prevStatus === "failed" || prevStatus === "stalled";

		// Mark as skipped
		taskRecord.status = "skipped";
		taskRecord.exitReason = "Skipped by supervisor";
		taskRecord.endedAt = Date.now();

		// Adjust counters
		state.skippedTasks = (state.skippedTasks ?? 0) + 1;
		if (wasFailed) {
			state.failedTasks = Math.max(0, state.failedTasks - 1);
		}

		// Unblock dependents: recompute which tasks should remain blocked.
		// After skipping this task, collect the set of remaining failures to
		// recompute transitive blocked set from the dependency graph.
		const prevBlocked = new Set(state.blockedTaskIds ?? []);
		const unblockedTasks: string[] = [];

		const remainingFailures = new Set<string>();
		for (const t of state.tasks) {
			if ((t.status === "failed" || t.status === "stalled") && t.taskId !== taskId) {
				remainingFailures.add(t.taskId);
			}
		}

		// Use in-memory dependency graph if available (batch IDs must match)
		if (orchBatchState.dependencyGraph && orchBatchState.batchId === state.batchId) {
			const newBlocked = computeTransitiveDependents(remainingFailures, orchBatchState.dependencyGraph);

			// Find tasks that were blocked but are now unblocked
			for (const id of prevBlocked) {
				if (!newBlocked.has(id)) {
					unblockedTasks.push(id);
				}
			}

			state.blockedTaskIds = [...newBlocked].sort();
			state.blockedTasks = newBlocked.size;
		} else {
			// No dependency graph available — conservatively remove the skipped
			// task from blocked list and let the engine re-evaluate on resume.
			prevBlocked.delete(taskId);
			state.blockedTaskIds = [...prevBlocked];
			state.blockedTasks = prevBlocked.size;
		}

		// TP-077 R001-3: Phase transition — "failed" → "stopped" (resumable with force)
		if (state.phase === "failed") {
			state.phase = "stopped";
		}

		// Update timestamp
		state.updatedAt = Date.now();

		// Persist
		try {
			saveBatchState(JSON.stringify(state, null, 2), stateRoot);
		} catch (err) {
			return `❌ Failed to persist state after skip: ${err instanceof Error ? err.message : String(err)}`;
		}

		// Sync in-memory state if batch IDs match
		if (orchBatchState.batchId === state.batchId) {
			orchBatchState.failedTasks = state.failedTasks;
			orchBatchState.skippedTasks = state.skippedTasks;
			orchBatchState.blockedTasks = state.blockedTasks;
			orchBatchState.blockedTaskIds = new Set(state.blockedTaskIds);
			if (state.phase === "stopped" && orchBatchState.phase === "failed") {
				orchBatchState.phase = "stopped";
			}
		}

		updateOrchWidget();

		const lines = [
			`✅ Task "${taskId}" marked as skipped.`,
			`   Previous status: ${prevStatus}`,
			`   Batch phase: ${state.phase} | Failed: ${state.failedTasks}, Skipped: ${state.skippedTasks}, Blocked: ${state.blockedTasks} / ${state.totalTasks} total`,
		];

		if (unblockedTasks.length > 0) {
			lines.push(`   Unblocked tasks: ${unblockedTasks.join(", ")}`);
		}

		lines.push("   The engine will re-evaluate dependent tasks on next resume cycle.");

		return lines.join("\n");
	}

	// ── TP-078: Force Merge Tool ─────────────────────────────────────

	/**
	 * Core logic for orch_force_merge. Unblocks mixed-outcome merge failures by
	 * skipping failed tasks, clearing the failed merge entry, and pausing so
	 * resume re-attempts the real merge.
	 *
	 * This is the supervisor's escape hatch when a wave merge was rejected because
	 * some lanes had both succeeded and failed tasks (mixed-outcome). The tool:
	 * 1. Validates the batch is paused/stopped/failed and the wave merge status is "partial"
	 * 2. Verifies the partial failure is specifically the mixed-outcome rejection
	 * 3. If skipFailed=true, marks failed/stalled tasks in the wave as "skipped"
	 * 4. Clears the failed merge entry and sets phase to "paused"
	 * 5. `orch_resume()` re-runs the merge using real git merge logic
	 */
	function doOrchForceMerge(waveIndex: number | undefined, skipFailed: boolean, ctx: ExtensionContext): string {
		// Reject while engine is actively running
		const activePhases = new Set(["launching", "executing", "merging", "planning"]);
		if (activePhases.has(orchBatchState.phase)) {
			return `❌ Cannot force merge while batch is ${orchBatchState.phase}. Pause or wait for the current operation to finish first.`;
		}

		const stateRoot = execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd;

		// Load persisted state
		let state: PersistedBatchState | null = null;
		try {
			state = loadBatchState(stateRoot);
		} catch (err) {
			return `❌ Failed to load batch state: ${err instanceof Error ? err.message : String(err)}`;
		}

		if (!state) {
			return "❌ No batch state found. There is no active or recent batch to modify.";
		}

		// Force-merge is a recovery action for non-running failed/paused batches.
		const resumablePhases = new Set(["paused", "stopped", "failed"]);
		if (!resumablePhases.has(state.phase)) {
			return `❌ Cannot force merge when batch phase is "${state.phase}". ` +
				`Force merge is only valid for paused/stopped/failed batches.`;
		}

		// Determine target wave index (0-based). Default to currentWaveIndex.
		const targetWave = waveIndex ?? state.currentWaveIndex;

		// Validate wave index
		if (targetWave < 0 || targetWave >= state.totalWaves) {
			return `❌ Invalid wave index ${targetWave}. Batch has ${state.totalWaves} wave(s) (0-based: 0..${state.totalWaves - 1}).`;
		}

		// Find the merge result for the target wave
		// Walk in reverse to find the latest entry for this wave
		let mergeResultIdx = -1;
		for (let i = state.mergeResults.length - 1; i >= 0; i--) {
			if (state.mergeResults[i].waveIndex === targetWave) {
				mergeResultIdx = i;
				break;
			}
		}

		// Validate: there must be a merge failure (partial or failed) for this wave
		if (mergeResultIdx === -1) {
			return `❌ No merge result found for wave ${targetWave}. Force merge is only needed when a merge failed or was rejected due to mixed-outcome lanes.`;
		}

		const mergeEntry = state.mergeResults[mergeResultIdx];
		if (mergeEntry.status === "succeeded") {
			return `✅ Wave ${targetWave} merge already succeeded. No force merge needed.`;
		}

		// Only allow force merge for mixed-outcome failures (partial status).
		// Other failures (conflicts, build failures, repo divergence) need different resolution.
		if (mergeEntry.status !== "partial") {
			return `❌ Wave ${targetWave} merge failed with status "${mergeEntry.status}": ${mergeEntry.failureReason || "unknown reason"}.\n` +
				`Force merge only applies to mixed-outcome lanes (partial). This failure needs manual resolution.`;
		}

		const failureReason = mergeEntry.failureReason || "";
		const failureReasonLower = failureReason.toLowerCase();
		const isMixedOutcomePartial =
			failureReasonLower.includes("both succeeded and failed tasks") ||
			failureReasonLower.includes("mixed-outcome") ||
			failureReasonLower.includes("automatic partial-branch merge is disabled");
		if (!isMixedOutcomePartial) {
			return `❌ Wave ${targetWave} has partial merge status, but the failure reason does not match mixed-outcome lanes.\n` +
				`Reason: ${failureReason || "unknown"}\n` +
				`Force merge is only valid for the mixed-outcome lane guard. Resolve this merge failure manually.`;
		}

		// Collect tasks in the target wave
		const waveTasks = state.wavePlan[targetWave] ?? [];
		const failedInWave: string[] = [];
		const succeededInWave: string[] = [];

		for (const taskId of waveTasks) {
			const task = state.tasks.find(t => t.taskId === taskId);
			if (!task) continue;
			if (task.status === "failed" || task.status === "stalled") {
				failedInWave.push(taskId);
			} else if (task.status === "succeeded") {
				succeededInWave.push(taskId);
			}
		}

		if (succeededInWave.length === 0) {
			return `❌ No succeeded tasks in wave ${targetWave}. Force merge requires at least one succeeded task whose commits can be merged.`;
		}

		// If skipFailed is true, mark failed/stalled tasks as skipped
		const skippedTasks: string[] = [];
		if (skipFailed && failedInWave.length > 0) {
			for (const taskId of failedInWave) {
				const task = state.tasks.find(t => t.taskId === taskId);
				if (!task) continue;
				const prevStatus = task.status;
				task.status = "skipped";
				task.exitReason = "Skipped by orch_force_merge";
				task.endedAt = Date.now();
				skippedTasks.push(taskId);

				// Adjust counters
				if (prevStatus === "failed" || prevStatus === "stalled") {
					state.failedTasks = Math.max(0, state.failedTasks - 1);
				}
				state.skippedTasks = (state.skippedTasks ?? 0) + 1;
			}

			// Recompute blocked tasks if dependency graph is available
			const remainingFailures = new Set<string>();
			for (const t of state.tasks) {
				if ((t.status === "failed" || t.status === "stalled")) {
					remainingFailures.add(t.taskId);
				}
			}

			if (orchBatchState.dependencyGraph && orchBatchState.batchId === state.batchId) {
				const newBlocked = computeTransitiveDependents(remainingFailures, orchBatchState.dependencyGraph);
				state.blockedTaskIds = [...newBlocked].sort();
				state.blockedTasks = newBlocked.size;
			} else if (remainingFailures.size === 0) {
				// No remaining failures — clear all blocked state
				state.blockedTaskIds = [];
				state.blockedTasks = 0;
			}
		} else if (!skipFailed && failedInWave.length > 0) {
			return `❌ Wave ${targetWave} has ${failedInWave.length} failed task(s): ${failedInWave.join(", ")}.\n` +
				`Use skipFailed=true to skip them, or use orch_skip_task to skip them individually first.`;
		}

		// Clear the failed merge result so resume will re-attempt the merge.
		// With failed tasks now skipped, the merge should succeed (no mixed outcomes).
		state.mergeResults.splice(mergeResultIdx, 1);

		// Phase transition to "paused" so orch_resume will re-run the merge phase.
		// "paused" is the standard resumable state (not "stopped" which needs force).
		state.phase = "paused";

		// Clear merge-related errors
		state.errors = state.errors.filter(e => !e.includes("mixed") && !e.includes("merge") && !e.includes("Merge"));
		state.lastError = null;

		// Update timestamp
		state.updatedAt = Date.now();

		// Persist
		try {
			saveBatchState(JSON.stringify(state, null, 2), stateRoot);
		} catch (err) {
			return `❌ Failed to persist state after force merge: ${err instanceof Error ? err.message : String(err)}`;
		}

		// Sync in-memory state if batch IDs match
		if (orchBatchState.batchId === state.batchId) {
			orchBatchState.failedTasks = state.failedTasks;
			orchBatchState.skippedTasks = state.skippedTasks ?? 0;
			orchBatchState.blockedTasks = state.blockedTasks;
			orchBatchState.blockedTaskIds = new Set(state.blockedTaskIds);
			orchBatchState.phase = "paused";
		}

		updateOrchWidget();

		const lines = [
			`✅ Force merge prepared for wave ${targetWave}.`,
			`   Failed merge result cleared — resume will re-attempt the merge.`,
			`   Succeeded tasks: ${succeededInWave.join(", ")}`,
		];

		if (skippedTasks.length > 0) {
			lines.push(`   Skipped tasks (were failed): ${skippedTasks.join(", ")}`);
		}

		lines.push(`   Batch phase: paused | Failed: ${state.failedTasks}, Skipped: ${state.skippedTasks ?? 0} / ${state.totalTasks} total`);

		const resumeHint = "Use orch_resume() to re-run the merge with failed tasks skipped.";
		lines.push(`   ${resumeHint}`);

		return lines.join("\n");
	}

	/**
	 * Core logic for orch-integrate. Returns a result message string.
	 * On error, returns an object with error flag.
	 */
	async function doOrchIntegrate(
		args: string | undefined,
		ctx: ExtensionContext,
	): Promise<{ message: string; error?: boolean; level?: "info" | "warning" | "error" }> {
		if (!execCtx) {
			return {
				message: getExecCtxInitErrorMessage(),
				error: true,
			};
		}

		// Parse arguments
		const parsed = parseIntegrateArgs(args);
		if ("error" in parsed) {
			return { message: `❌ ${parsed.error}\n\nRun /orch-integrate --help for usage.`, error: true };
		}

		// Resolve integration context
		const { repoRoot } = execCtx!;
		const stateRoot = execCtx!.workspaceRoot;
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
			return { message: resolution.error, error: severity !== "info" };
		}

		const { orchBranch, baseBranch, batchId, currentBranch, notices } = resolution as IntegrationContext;
		const outputLines: string[] = [];
		let hasWarning = false;

		for (const notice of notices) {
			outputLines.push(notice);
		}

		// Branch protection pre-check (TP-052)
		if (parsed.mode !== "pr") {
			const { detectBranchProtection } = await import("./supervisor.ts");
			const protectionStatus = detectBranchProtection(baseBranch, repoRoot);
			if (protectionStatus === "protected") {
				hasWarning = true;
				outputLines.push(
					`⚠️ Branch \`${baseBranch}\` has branch protection rules enabled.\n` +
					`Direct merges may be blocked by your repository settings.\n\n` +
					`Recommended: use \`/orch-integrate --pr\` to create a pull request instead.`,
				);
			}
		}

		// Pre-integration summary
		const revListResult = runGit(
			["rev-list", "--count", `${currentBranch}..${orchBranch}`],
			repoRoot,
		);
		const commitsAhead = revListResult.ok ? revListResult.stdout.trim() : "?";

		const diffStatResult = runGit(
			["diff", "--stat", `${currentBranch}...${orchBranch}`],
			repoRoot,
		);
		const diffSummary = diffStatResult.ok ? diffStatResult.stdout.trim() : "(unable to compute diff)";

		outputLines.push(
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
		);

		// Execute integration
		const resolvedOrchBranch = (resolution as IntegrationContext).orchBranch;
		const wsConfig = execCtx!.workspaceConfig;
		const reposToIntegrate: { id: string; root: string }[] = [];

		if (wsConfig) {
			for (const [repoId, repoConf] of wsConfig.repos) {
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
				return { message: `❌ Integration failed in ${repo.id}:\n${integrationResult.error}`, error: true };
			}

			totalCommits += repoCommitsBefore;
			repoMessages.push(`  ${repo.id}: ${integrationResult.message}`);
		}

		// Post-integration cleanup & acceptance
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

		for (const repo of allRepos) {
			dropBatchAutostash(repo.root, batchId);
		}

		const branchCleanupLines: string[] = [];
		for (const repo of allRepos) {
			const branchCleanup = deleteStaleBranches(repo.root, opId, batchId);
			const totalDeleted = branchCleanup.deletedTaskBranches.length + branchCleanup.deletedSavedBranches.length;
			if (totalDeleted > 0 || branchCleanup.failedDeletes.length > 0) {
				const label = repo.id === "(default)" ? "" : ` (${repo.id})`;
				if (branchCleanup.deletedTaskBranches.length > 0) {
					branchCleanupLines.push(`  🗑️ Deleted ${branchCleanup.deletedTaskBranches.length} task branch(es)${label}`);
				}
				if (branchCleanup.deletedSavedBranches.length > 0) {
					branchCleanupLines.push(`  🗑️ Deleted ${branchCleanup.deletedSavedBranches.length} saved branch(es)${label}`);
				}
				if (branchCleanup.failedDeletes.length > 0) {
					branchCleanupLines.push(`  ⚠️ Failed to delete ${branchCleanup.failedDeletes.length} branch(es)${label}: ${branchCleanup.failedDeletes.join(", ")}`);
				}
			}
		}
		if (branchCleanupLines.length > 0) {
			outputLines.push("Branch cleanup:\n" + branchCleanupLines.join("\n"));
		}

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
		if (cleanupResult.notifyLevel === "warning") {
			hasWarning = true;
		}

		try { deleteBatchState(repoRoot); } catch { /* best effort */ }

		// ── TP-065: Post-integrate artifact cleanup (Layer 1) ────
		// Delete batch-specific telemetry and merge result files.
		// Non-fatal — failures warn but don't block integration.
		if (batchId) {
			try {
				const artifactCleanup = cleanupPostIntegrate(stateRoot, batchId);
				const totalCleaned = artifactCleanup.telemetryFilesDeleted + artifactCleanup.mergeFilesDeleted + artifactCleanup.promptFilesDeleted + artifactCleanup.mailboxDirsDeleted;
				if (totalCleaned > 0) {
					const cleanupParts = [
						`${artifactCleanup.telemetryFilesDeleted} telemetry file(s)`,
						`${artifactCleanup.mergeFilesDeleted} merge result(s)`,
						`${artifactCleanup.promptFilesDeleted} prompt file(s)`,
					];
					if (artifactCleanup.mailboxDirsDeleted > 0) {
						cleanupParts.push(`${artifactCleanup.mailboxDirsDeleted} mailbox dir(s)`);
					}
					outputLines.push(
						`🧹 Cleaned up ${cleanupParts.join(", ")} for batch ${batchId}`,
					);
				}
				if (artifactCleanup.warnings.length > 0) {
					hasWarning = true;
					outputLines.push(`⚠️ Artifact cleanup warnings: ${artifactCleanup.warnings.join("; ")}`);
				}
			} catch {
				// Non-fatal — never block integration for cleanup failures
			}
		}

		const integrationSummary = wsConfig
			? `✅ Integrated ${resolvedOrchBranch} across ${reposToIntegrate.length} repo(s).\n${repoMessages.join("\n")}\n${totalCommits} total commit(s) applied.`
			: `${repoMessages[0] || "✅ Integrated."}\n${commitsAhead} commit(s) applied.`;

		outputLines.push(integrationSummary + "\n" + cleanupResult.report);

		// TP-043 R004: deferred batch summary
		if (supervisorState.active && supervisorState.pendingSummaryDeps) {
			const deps = supervisorState.pendingSummaryDeps;
			supervisorState.pendingSummaryDeps = null;
			if (supervisorState.batchStateRef && supervisorState.stateRoot) {
				presentBatchSummary(pi, supervisorState.batchStateRef, supervisorState.stateRoot, deps.opId, deps.diagnostics, deps.mergeResults);
			}
			deactivateSupervisor(pi, supervisorState);
		}

		return { message: outputLines.join("\n\n"), level: hasWarning ? "warning" : "info" };
	}

	pi.registerCommand("orch-status", {
		description: "Show current batch progress",
		handler: async (_args, ctx) => {
			const result = doOrchStatus(ctx.cwd);
			ctx.ui.notify(result, "info");
		},
	});

	pi.registerCommand("orch-pause", {
		description: "Pause batch after current tasks finish",
		handler: async (_args, ctx) => {
			const result = doOrchPause();
			// Determine notification level from result content
			const level = result.includes("No batch") || result.includes("already paused") ? "warning" : "info";
			ctx.ui.notify(result, level);
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

			const result = doOrchResume(parsed.force, ctx);
			ctx.ui.notify(result.message, result.error ? "warning" : "info");
		},
	});

	pi.registerCommand("orch-abort", {
		description: "Abort batch: /orch-abort [--hard]",
		handler: async (args, ctx) => {
			try {
				const hard = args?.trim() === "--hard";
				const result = doOrchAbort(hard, ctx);
				ctx.ui.notify(result, "info");
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

			const result = await doOrchIntegrate(args, ctx);
			ctx.ui.notify(result.message, result.error ? "error" : (result.level ?? "info"));
		},
	});

	// ── TP-053: Register orchestrator tools for supervisor agent ─────

	pi.registerTool({
		name: "orch_status",
		label: "Orchestrator Status",
		description:
			"Check the current batch status. Returns batch phase, wave progress, " +
			"task counts, and elapsed time. Works even when no batch is running.",
		promptSnippet: "orch_status() — check current batch status",
		promptGuidelines: [
			"Call orch_status to get a snapshot of the current batch.",
			"Use this when the operator asks 'how is the batch going?' or you need to check progress.",
			"If no batch is running, the result will say so.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			try {
				const result = doOrchStatus(ctx.cwd);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error checking status: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	pi.registerTool({
		name: "orch_pause",
		label: "Pause Batch",
		description:
			"Pause the running batch after current tasks finish. " +
			"Tasks already in progress will complete, but no new tasks will start.",
		promptSnippet: "orch_pause() — pause the running batch",
		promptGuidelines: [
			"Call orch_pause to pause a running batch gracefully.",
			"Current tasks will finish, but no new tasks will be launched.",
			"Use this when you need to investigate an issue before more tasks run.",
			"After pausing, use orch_resume to continue.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			try {
				const result = doOrchPause();
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error pausing batch: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	pi.registerTool({
		name: "orch_resume",
		label: "Resume Batch",
		description:
			"Resume a paused or interrupted batch. " +
			"The batch will continue from where it left off. " +
			"Use force=true to resume from a stopped or failed state.",
		promptSnippet: "orch_resume(force?) — resume a paused batch",
		promptGuidelines: [
			"Call orch_resume to continue a paused or interrupted batch.",
			"Set force=true to resume from a stopped or failed state (runs pre-resume diagnostics).",
			"Cannot resume if a batch is already actively running (launching, executing, merging, planning).",
			"The resume happens asynchronously — the tool returns immediately with a status message.",
		],
		parameters: Type.Object({
			force: Type.Optional(Type.Boolean({
				description: "Resume from stopped or failed state (default: false)",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = doOrchResume(params.force ?? false, ctx);
				return { content: [{ type: "text" as const, text: result.message }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error resuming batch: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	pi.registerTool({
		name: "orch_abort",
		label: "Abort Batch",
		description:
			"Abort the running batch. Kills tmux sessions, cleans up state. " +
			"Use hard=true for immediate kill (no grace period). " +
			"Works even without execution context (safety-critical).",
		promptSnippet: "orch_abort(hard?) — abort the running batch",
		promptGuidelines: [
			"Call orch_abort to stop a running batch.",
			"Default (hard=false) is graceful abort — writes signal file and kills sessions.",
			"Set hard=true for immediate termination without grace period.",
			"Use this when a batch is stuck, failing repeatedly, or the operator requests it.",
			"Worktrees and branches are preserved for inspection after abort.",
		],
		parameters: Type.Object({
			hard: Type.Optional(Type.Boolean({
				description: "Hard abort — immediate kill without grace period (default: false)",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = doOrchAbort(params.hard ?? false, ctx);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error aborting batch: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	pi.registerTool({
		name: "orch_integrate",
		label: "Integrate Batch",
		description:
			"Integrate a completed orch batch into the working branch. " +
			"Supports fast-forward (default), merge commit, or pull request modes.",
		promptSnippet: "orch_integrate(mode?, force?, branch?) — integrate completed batch",
		promptGuidelines: [
			"Call orch_integrate after a batch completes to merge changes into the working branch.",
			"mode='fast-forward' (default) — cleanest history, requires linear history.",
			"mode='merge' — creates a merge commit.",
			"mode='pr' — pushes orch branch and creates a pull request (safest for protected branches).",
			"Set force=true to skip branch safety checks.",
			"The branch parameter is optional — auto-detected from batch state if omitted.",
			"If the target branch has protection rules, prefer mode='pr'.",
		],
		parameters: Type.Object({
			mode: Type.Optional(Type.Union(
				[Type.Literal("fast-forward"), Type.Literal("merge"), Type.Literal("pr")],
				{ description: 'Integration mode (default: "fast-forward")' },
			)),
			force: Type.Optional(Type.Boolean({
				description: "Skip branch safety check (default: false)",
			})),
			branch: Type.Optional(Type.String({
				description: "Orch branch name (auto-detected from batch state if omitted)",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				// Build args string from tool parameters to pass to doOrchIntegrate
				const argParts: string[] = [];
				if (params.branch) argParts.push(params.branch);
				const mode = params.mode ?? "fast-forward";
				if (mode === "merge") argParts.push("--merge");
				else if (mode === "pr") argParts.push("--pr");
				if (params.force) argParts.push("--force");

				const argsStr = argParts.length > 0 ? argParts.join(" ") : undefined;
				const result = await doOrchIntegrate(argsStr, ctx);
				return { content: [{ type: "text" as const, text: result.message }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error integrating batch: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	pi.registerTool({
		name: "orch_start",
		label: "Start Batch",
		description:
			"Start a new orchestration batch. Target is \"all\" to run all pending tasks, " +
			"or a specific task area name or path. The batch runs asynchronously — " +
			"use orch_status() to monitor progress.",
		promptSnippet: "orch_start(target) — start a new batch",
		promptGuidelines: [
			"Call orch_start to begin executing pending tasks as a batch.",
			'Use target="all" to run all pending tasks, or specify a task area name or path.',
			"Cannot start if a batch is already running — check orch_status() first.",
			"The batch runs asynchronously. The tool returns immediately with an ACK.",
			"After starting, use orch_status() to track progress.",
		],
		parameters: Type.Object({
			target: Type.String({
				description: 'Target to run: "all" for all pending tasks, or a task area name/path',
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = await doOrchStart(params.target, ctx);
				return { content: [{ type: "text" as const, text: result.message }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error starting batch: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	// ── TP-077: Supervisor Recovery Tools ────────────────────────────

	pi.registerTool({
		name: "orch_retry_task",
		label: "Retry Failed Task",
		description:
			"Retry a specific failed task. Resets the task to pending status so it will " +
			"be re-executed on the next resume cycle. Only works for tasks with 'failed' status.",
		promptSnippet: "orch_retry_task(taskId) — retry a specific failed task",
		promptGuidelines: [
			"Call orch_retry_task to reset a failed task for re-execution.",
			"The task must have 'failed' status — running, succeeded, or pending tasks cannot be retried.",
			"After retrying, use orch_resume(force=true) to re-execute the batch if it's paused.",
			"Use this when a task failed due to a transient issue (context pressure, API error) that may succeed on retry.",
		],
		parameters: Type.Object({
			taskId: Type.String({
				description: "Task ID to retry (e.g., 'TP-003')",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = doOrchRetryTask(params.taskId, ctx);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error retrying task: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	pi.registerTool({
		name: "orch_skip_task",
		label: "Skip Task",
		description:
			"Skip a failed or pending task and unblock its dependents. " +
			"The task is marked as 'skipped' and will not be executed. " +
			"Dependent tasks are unblocked for execution.",
		promptSnippet: "orch_skip_task(taskId) — skip a task and unblock dependents",
		promptGuidelines: [
			"Call orch_skip_task to skip a task and unblock any tasks that depend on it.",
			"The task must have 'failed' or 'pending' status — running or succeeded tasks cannot be skipped.",
			"Use this when a task cannot succeed and you want to continue the batch without it.",
			"Skipping a task removes it from the blocker set, potentially unblocking downstream tasks.",
			"The engine re-evaluates dependencies on the next resume cycle.",
		],
		parameters: Type.Object({
			taskId: Type.String({
				description: "Task ID to skip (e.g., 'TP-003')",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = doOrchSkipTask(params.taskId, ctx);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error skipping task: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	// ── TP-078: Force Merge Tool ─────────────────────────────────────

	pi.registerTool({
		name: "orch_force_merge",
		label: "Force Merge Wave",
		description:
			"Force merge a wave that was rejected due to mixed-outcome lanes (succeeded and failed tasks " +
			"on the same lane). Updates the merge result to 'succeeded' so the batch can continue. " +
			"Optionally skips failed tasks in the wave.",
		promptSnippet: "orch_force_merge(waveIndex?, skipFailed?) — force merge a wave with mixed results",
		promptGuidelines: [
			"Call orch_force_merge when a wave merge was rejected because lanes had both succeeded and failed tasks.",
			"The batch must be paused, stopped, or failed with a 'partial' merge result for the target wave.",
			"Set skipFailed=true to automatically skip all failed tasks in the wave (recommended).",
			"If skipFailed is false and failed tasks exist, you must skip them individually with orch_skip_task first.",
			"After force merging, use orch_resume(force=true) to continue the batch.",
			"waveIndex is 0-based. Omit it to target the current wave.",
		],
		parameters: Type.Object({
			waveIndex: Type.Optional(Type.Number({
				description: "0-based wave index to force merge. Defaults to the current wave.",
			})),
			skipFailed: Type.Optional(Type.Boolean({
				description: "If true, automatically skip all failed tasks in the wave before merging. Defaults to false.",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = doOrchForceMerge(params.waveIndex, params.skipFailed ?? false, ctx);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error force merging: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	// ── TP-089: Agent Mailbox Steering Tool ──────────────────────────

	pi.registerTool({
		name: "send_agent_message",
		label: "Send Agent Message",
		description:
			"Send a steering message to a running agent (worker, reviewer, or merger). " +
			"The message is delivered into the agent's LLM context at the next turn boundary.",
		promptSnippet: "send_agent_message(to, content, type?) — send steering message to a running agent",
		promptGuidelines: [
			"Call send_agent_message to course-correct a running agent (worker, reviewer, or merger).",
			"The 'to' parameter must be a valid agent session name from the current batch.",
			"Use orch_status() to see active session names.",
			"Default type is 'steer' (course correction). Other types: 'query', 'abort', 'info'.",
			"Messages are limited to 4KB. For larger context, write to a file and reference by path.",
		],
		parameters: Type.Object({
			to: Type.String({
				description: "Target agent session name (e.g., 'orch-henrylach-lane-1-worker')",
			}),
			content: Type.String({
				description: "Message content (max 4KB). Concise directive for the agent.",
			}),
			type: Type.Optional(Type.Union(
				[Type.Literal("steer"), Type.Literal("query"), Type.Literal("abort"), Type.Literal("info")],
				{ description: 'Message type (default: "steer")' },
			)),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = doSendAgentMessage(params.to, params.content, params.type ?? "steer", ctx);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error sending message: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	/**
	 * Send a steering message to a running agent via the mailbox system.
	 *
	 * Resolves the target session from batch state, validates it exists,
	 * and writes the message to the agent's inbox.
	 *
	 * @since TP-089
	 */
	function doSendAgentMessage(to: string, content: string, messageType: string, ctx: ExtensionContext): string {
		const stateRoot = resolveToolStateRoot(ctx);

		// Validate message type (outbound allowlist: steer, query, abort, info)
		const validOutboundTypes = new Set(["steer", "query", "abort", "info"]);
		if (!validOutboundTypes.has(messageType)) {
			return `❌ Invalid message type "${messageType}". Valid types: steer, query, abort, info.`;
		}

		// Load batch state
		let state: PersistedBatchState | null = null;
		try {
			state = loadBatchState(stateRoot);
		} catch (err) {
			return `❌ Failed to load batch state: ${err instanceof Error ? err.message : String(err)}`;
		}
		if (!state) {
			return "❌ No batch state found. There is no active or recent batch.";
		}

		// Guard: terminal batches have no running agent sessions to receive messages.
		if (isBatchTerminal(state.phase)) {
			return `❌ Batch ${state.batchId} is in terminal phase (${state.phase}). Start or resume a batch before sending messages.`;
		}

		// Build the set of valid agent session names from batch state
		const validSessions = new Set<string>();
		const orchConfig = execCtx?.orchestratorConfig;
		const tmuxPrefix = orchConfig?.orchestrator?.tmux_prefix ?? "orch";
		const opId = orchConfig ? resolveOperatorId(orchConfig) : "op";

		for (const lane of state.lanes) {
			// Worker and reviewer are derived from lane session name
			validSessions.add(`${lane.tmuxSessionName}-worker`);
			validSessions.add(`${lane.tmuxSessionName}-reviewer`);
			// Merger: {tmuxPrefix}-{opId}-merge-{laneNumber}
			validSessions.add(`${tmuxPrefix}-${opId}-merge-${lane.laneNumber}`);
		}

		// Validate target session
		if (!validSessions.has(to)) {
			const examples = [...validSessions].slice(0, 5).join(", ");
			return `❌ Unknown session "${to}" in batch ${state.batchId}.\nValid targets: ${examples}${validSessions.size > 5 ? ` (${validSessions.size} total)` : ""}`;
		}

		// Guard: ensure the target tmux session is currently alive.
		// Prevents false-positive "message sent" confirmations when the
		// batch is paused/stopped or the agent session has already exited.
		if (!tmuxHasSession(to)) {
			return `❌ Session "${to}" is not currently running. Use orch_status() or orch_resume() before sending messages.`;
		}

		// Write message to inbox
		try {
			const msg = writeMailboxMessage(stateRoot, state.batchId, to, {
				from: "supervisor",
				type: messageType as MailboxMessageType,
				content,
			});
			return `✅ Message sent to \`${to}\` (batch ${state.batchId})\n` +
				`- **ID:** ${msg.id}\n` +
				`- **Type:** ${messageType}\n` +
				`- **Size:** ${Buffer.byteLength(content, "utf8")} bytes\n` +
				`Message will be delivered at the agent's next turn boundary.`;
		} catch (err) {
			return `❌ Failed to write message: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	function resolveToolStateRoot(context: ExtensionContext): string {
		return execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? context.cwd;
	}

	function resolveLaneRepoRootForTools(laneRec: PersistedBatchState["lanes"][number], stateRoot: string): string {
		if (execCtx?.workspaceConfig && laneRec.repoId) {
			const repo = execCtx.workspaceConfig.repos[laneRec.repoId];
			if (repo?.path) return repo.path;
		}
		return execCtx?.repoRoot ?? stateRoot;
	}

	// ── TP-096: Supervisor Recovery Tools ─────────────────────────────────

	pi.registerTool({
		name: "read_agent_status",
		label: "Read Agent Status",
		description:
			"Read STATUS.md and telemetry for a running agent's lane. " +
			"Returns current step, checkbox progress, context %, cost, tool count, and elapsed time. " +
			"If lane is omitted, returns status for all active lanes.",
		promptSnippet: "read_agent_status(lane?) — read STATUS.md + context % + cost from a running agent",
		promptGuidelines: [
			"Call read_agent_status to check on a specific lane's worker progress.",
			"Omit lane to get a summary of all active lanes.",
			"Returns: current step, checked/total items, context %, cost, elapsed.",
		],
		parameters: Type.Object({
			lane: Type.Optional(Type.Number({
				description: "Lane number to check (omit for all lanes)",
			})),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = doReadAgentStatus(params.lane, ctx);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error reading agent status: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	/**
	 * Read agent status from STATUS.md and lane-state sidecar.
	 * @since TP-096
	 */
	function doReadAgentStatus(lane: number | undefined, ctx: ExtensionContext): string {
		const stateRoot = resolveToolStateRoot(ctx);

		// Load batch state
		const state = loadBatchState(stateRoot);
		if (!state) return "❌ No batch state found.";

		const targetLanes = lane != null
			? state.lanes.filter(l => l.laneNumber === lane)
			: state.lanes;

		if (targetLanes.length === 0) {
			return lane != null
				? `❌ Lane ${lane} not found in batch ${state.batchId}.`
				: "❌ No lanes in current batch.";
		}

		const lines: string[] = [];
		lines.push(`📊 **Agent Status** — batch ${state.batchId}\n`);

		for (const laneRec of targetLanes) {
			// Find current task for this lane
			const laneTasks = state.tasks.filter(t => t.laneNumber === laneRec.laneNumber);
			const runningTask = laneTasks.find(t => t.status === "running");
			const currentTask = runningTask || laneTasks[laneTasks.length - 1];

			lines.push(`### Lane ${laneRec.laneNumber} — ${laneRec.tmuxSessionName}`);
			lines.push(`**Branch:** ${laneRec.branch}`);

			if (currentTask) {
				lines.push(`**Task:** ${currentTask.taskId} (${currentTask.status})`);

				// Read STATUS.md from canonical task paths (workspace-safe, cross-repo-safe)
				try {
					const taskFolderAbs = currentTask.taskFolder;
					const worktreePath = laneRec.worktreePath;
					if (taskFolderAbs && worktreePath) {
						const repoRootForLane = resolveLaneRepoRootForTools(laneRec, stateRoot);
						const resolved = resolveCanonicalTaskPaths(
							taskFolderAbs,
							worktreePath,
							repoRootForLane,
							!!execCtx?.workspaceConfig,
						);
						if (existsSync(resolved.statusPath)) {
							const content = readFileSync(resolved.statusPath, "utf-8");
							const stepMatch = content.match(/\*\*Current Step:\*\*\s*(.+)/);
							const statusMatch = content.match(/\*\*Status:\*\*\s*(.+)/);
							const iterMatch = content.match(/\*\*Iteration:\*\*\s*(\d+)/);
							const reviewMatch = content.match(/\*\*Review Counter:\*\*\s*(\d+)/);
							const checked = (content.match(/- \[x\]/gi) || []).length;
							const unchecked = (content.match(/- \[ \]/g) || []).length;
							const total = checked + unchecked;

							if (stepMatch) lines.push(`**Step:** ${stepMatch[1].trim()}`);
							if (statusMatch) lines.push(`**Step Status:** ${statusMatch[1].trim()}`);
							if (total > 0) lines.push(`**Progress:** ${checked}/${total} (${Math.round((checked / total) * 100)}%)`);
							if (iterMatch) lines.push(`**Iteration:** ${iterMatch[1]}`);
							if (reviewMatch && Number.parseInt(reviewMatch[1], 10) > 0) lines.push(`**Reviews:** ${reviewMatch[1]}`);
						}
					}
				} catch {
					// STATUS.md not available in worktree — degrade gracefully
				}
			} else {
				lines.push("**Task:** none assigned");
			}

			// Read lane-state sidecar
			try {
				const lsPath = join(stateRoot, ".pi", `lane-state-${laneRec.tmuxSessionName}.json`);
				if (existsSync(lsPath)) {
					const ls = JSON.parse(readFileSync(lsPath, "utf-8"));
					const parts: string[] = [];
					if (ls.workerContextPct) parts.push(`context: ${Math.round(ls.workerContextPct)}%`);
					if (ls.workerCostUsd) parts.push(`cost: $${ls.workerCostUsd.toFixed(3)}`);
					if (ls.workerToolCount) parts.push(`tools: ${ls.workerToolCount}`);
					if (ls.workerElapsed) parts.push(`elapsed: ${Math.round(ls.workerElapsed / 1000)}s`);
					if (ls.workerStatus) parts.push(`worker: ${ls.workerStatus}`);
					if (ls.reviewerStatus && ls.reviewerStatus !== "idle") parts.push(`reviewer: ${ls.reviewerStatus}`);
					if (parts.length > 0) lines.push(`**Telemetry:** ${parts.join(" · ")}`);
				}
			} catch {
				// Lane state not available — degrade gracefully
			}

			lines.push("");
		}

		return lines.join("\n");
	}

	pi.registerTool({
		name: "trigger_wrap_up",
		label: "Trigger Wrap Up",
		description:
			"Write the .task-wrap-up signal file for a specific lane, telling the worker to finish its current step and exit gracefully.",
		promptSnippet: "trigger_wrap_up(lane) — write .task-wrap-up signal file for a lane",
		promptGuidelines: [
			"Call trigger_wrap_up to gracefully stop a worker on a specific lane.",
			"The worker will finish its current step and exit.",
			"Validates the lane exists and has a running worker.",
		],
		parameters: Type.Object({
			lane: Type.Number({
				description: "Lane number to send wrap-up signal to",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = doTriggerWrapUp(params.lane, ctx);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error triggering wrap-up: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	/**
	 * Write .task-wrap-up signal file for a lane's current task.
	 * @since TP-096
	 */
	function doTriggerWrapUp(lane: number, ctx: ExtensionContext): string {
		const stateRoot = resolveToolStateRoot(ctx);

		const state = loadBatchState(stateRoot);
		if (!state) return "❌ No batch state found.";

		const laneRec = state.lanes.find(l => l.laneNumber === lane);
		if (!laneRec) return `❌ Lane ${lane} not found in batch ${state.batchId}.`;

		// Find running task for this lane
		const runningTask = state.tasks.find(t => t.laneNumber === lane && t.status === "running");
		if (!runningTask) return `❌ No running task on lane ${lane}.`;

		// Resolve task folder in the worktree using canonical path resolver
		const taskFolderAbs = runningTask.taskFolder;
		const worktreePath = laneRec.worktreePath;
		if (!taskFolderAbs || !worktreePath) {
			return `❌ Cannot resolve task folder for lane ${lane}.`;
		}

		const repoRootForLane = resolveLaneRepoRootForTools(laneRec, stateRoot);
		const resolved = resolveCanonicalTaskPaths(
			taskFolderAbs,
			worktreePath,
			repoRootForLane,
			!!execCtx?.workspaceConfig,
		);
		const wrapUpPath = join(resolved.taskFolderResolved, ".task-wrap-up");

		try {
			const dir = dirname(wrapUpPath);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			writeFileSync(wrapUpPath, `wrap-up signal for ${runningTask.taskId}\n`, "utf-8");
			return `✅ Wrap-up signal written for **${runningTask.taskId}** on lane ${lane}.\n` +
				`Path: \`${wrapUpPath}\`\n` +
				`The worker will finish its current step and exit gracefully.`;
		} catch (err) {
			return `❌ Failed to write wrap-up file: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	pi.registerTool({
		name: "read_lane_logs",
		label: "Read Lane Logs",
		description:
			"Read stderr/crash logs for a specific lane from .pi/telemetry/ directory.",
		promptSnippet: "read_lane_logs(lane) — read stderr/crash logs for a lane",
		promptGuidelines: [
			"Call read_lane_logs to read crash/error logs from a lane's stderr capture.",
			"Falls back gracefully when logs don't exist (older batches).",
		],
		parameters: Type.Object({
			lane: Type.Number({
				description: "Lane number to read logs for",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const result = doReadLaneLogs(params.lane, ctx);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error reading lane logs: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	/**
	 * Read stderr/crash logs for a lane.
	 * @since TP-096
	 */
	function doReadLaneLogs(lane: number, ctx: ExtensionContext): string {
		const stateRoot = resolveToolStateRoot(ctx);

		const state = loadBatchState(stateRoot);
		if (!state) return "❌ No batch state found.";

		const laneRec = state.lanes.find(l => l.laneNumber === lane);
		if (!laneRec) return `❌ Lane ${lane} not found in batch ${state.batchId}.`;

		const telemetryDir = join(stateRoot, ".pi", "telemetry");
		let stderrFile: string | null = null;

		// Discover stderr logs by actual telemetry naming:
		// {opId}-{batchId}-{repoId}[-{taskId}]-lane-{N}-worker-stderr.log
		try {
			if (existsSync(telemetryDir)) {
				const allStderr = readdirSync(telemetryDir)
					.filter(f => f.endsWith("-stderr.log"))
					.filter(f => f.includes(`-lane-${lane}-worker`));
				const batchScoped = allStderr.filter(f => f.includes(`-${state.batchId}-`));
				const candidates = (batchScoped.length > 0 ? batchScoped : allStderr)
					.map(name => {
						const absPath = join(telemetryDir, name);
						let mtime = 0;
						try { mtime = statSync(absPath).mtimeMs; } catch {}
						return { name, mtime };
					})
					.sort((a, b) => b.mtime - a.mtime);
				stderrFile = candidates[0]?.name ?? null;
			}
		} catch {
			// Directory not readable — handled below
		}

		// Legacy fallback from older conventions
		if (!stderrFile) {
			const legacy = `${state.batchId}-lane-${lane}-stderr.log`;
			if (existsSync(join(telemetryDir, legacy))) {
				stderrFile = legacy;
			}
		}

		const stderrPath = stderrFile ? join(telemetryDir, stderrFile) : null;

		// Also try to find worker-exit JSON files for crash diagnostics
		const exitFiles: string[] = [];
		try {
			if (existsSync(telemetryDir)) {
				const files = readdirSync(telemetryDir)
					.filter(f => f.endsWith("-worker-exit.json"))
					.filter(f => f.includes(`-lane-${lane}-`));
				const batchScoped = files.filter(f => f.includes(`-${state.batchId}-`));
				exitFiles.push(...(batchScoped.length > 0 ? batchScoped : files));
			}
		} catch { /* directory not readable */ }

		const lines: string[] = [];
		lines.push(`📜 **Lane ${lane} Logs** — batch ${state.batchId}\n`);

		// Read stderr log
		if (stderrPath && existsSync(stderrPath)) {
			try {
				const content = readFileSync(stderrPath, "utf-8");
				const truncated = content.length > 5000
					? "...\n" + content.slice(-5000)
					: content;
				lines.push("### Stderr Log");
				lines.push("```");
				lines.push(truncated.trim());
				lines.push("```");
				lines.push("");
			} catch {
				lines.push("Stderr log found but unreadable.");
			}
		} else {
			lines.push(`No stderr log found for lane ${lane} (pattern: \`*-lane-${lane}-worker-stderr.log\`).`);
		}

		// Read most recent exit diagnostic
		if (exitFiles.length > 0) {
			const latestExit = exitFiles
				.map(name => {
					const absPath = join(telemetryDir, name);
					let mtime = 0;
					try { mtime = statSync(absPath).mtimeMs; } catch {}
					return { name, mtime };
				})
				.sort((a, b) => b.mtime - a.mtime)[0]?.name;
			if (latestExit) {
				try {
					const exitData = JSON.parse(readFileSync(join(telemetryDir, latestExit), "utf-8"));
					lines.push("### Latest Exit Diagnostic");
					if (exitData.classification) lines.push(`**Classification:** ${exitData.classification}`);
					if (exitData.exitCode != null) lines.push(`**Exit Code:** ${exitData.exitCode}`);
					if (exitData.errorMessage) lines.push(`**Error:** ${exitData.errorMessage}`);
					if (exitData.durationSec) lines.push(`**Duration:** ${exitData.durationSec}s`);
					lines.push("");
				} catch { /* skip malformed exit file */ }
			}
		}

		return lines.join("\n");
	}

	pi.registerTool({
		name: "list_active_agents",
		label: "List Active Agents",
		description:
			"List all tmux sessions with their role, lane, task, context %, and elapsed time.",
		promptSnippet: "list_active_agents() — show all tmux sessions with role, lane, task, context %, elapsed",
		promptGuidelines: [
			"Call list_active_agents to see all running agent sessions.",
			"Shows: session name, role (worker/reviewer/merger/supervisor), lane, task, context %, elapsed.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			try {
				const result = doListActiveAgents(ctx);
				return { content: [{ type: "text" as const, text: result }], details: undefined };
			} catch (err) {
				return {
					content: [{ type: "text" as const, text: `Error listing agents: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});

	/**
	 * List all active tmux sessions with agent metadata.
	 * @since TP-096
	 */
	function doListActiveAgents(ctx: ExtensionContext): string {
		const stateRoot = resolveToolStateRoot(ctx);

		// Get tmux sessions
		let sessions: string[] = [];
		try {
			const output = execSync('tmux list-sessions -F "#{session_name}"', {
				encoding: "utf-8",
				timeout: 5000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			sessions = output ? output.split("\n").map(s => s.trim()).filter(Boolean) : [];
		} catch {
			return "❌ tmux not available or no sessions running.";
		}

		if (sessions.length === 0) return "❌ No tmux sessions found.";

		// Load batch state for task/lane mapping
		const state = loadBatchState(stateRoot);

		// Build a map of session name → lane-state data
		const laneStates: Record<string, any> = {};
		try {
			const piDir = join(stateRoot, ".pi");
			if (existsSync(piDir)) {
				const files = readdirSync(piDir).filter(f => f.startsWith("lane-state-") && f.endsWith(".json"));
				for (const file of files) {
					try {
						const data = JSON.parse(readFileSync(join(piDir, file), "utf-8"));
						if (data.prefix) laneStates[data.prefix] = data;
					} catch { continue; }
				}
			}
		} catch { /* .pi dir missing */ }

		const lines: string[] = [];
		lines.push(`👥 **Active Agents** (${sessions.length} sessions)\n`);

		// Parse each session name to extract role, lane, etc.
		for (const sess of sessions) {
			let role = "unknown";
			let laneNum = "";
			let taskId = "";
			let contextPct = "";
			let elapsed = "";
			let costStr = "";

			// Parse session name pattern:
			// Workers/reviewers: orch-{opId}-lane-{N} (or -worker/-reviewer suffix)
			// Mergers: orch-{opId}-merge-{N}
			// Supervisor: pi-supervisor-{...}
			const laneMatch = sess.match(/-lane-(\d+)/);
			const mergeMatch = sess.match(/-merge-(\d+)/);

			if (mergeMatch) {
				role = "merger";
				laneNum = mergeMatch[1];
			} else if (laneMatch) {
				if (sess.includes("-reviewer")) {
					role = "reviewer";
				} else {
					role = "worker";
				}
				laneNum = laneMatch[1];
			} else if (sess.includes("supervisor")) {
				role = "supervisor";
			}

			// Find matching task and lane-state
			if (state && laneNum) {
				const ln = parseInt(laneNum);
				const task = state.tasks.find(t => t.laneNumber === ln && t.status === "running");
				if (task) taskId = task.taskId;

				// Find lane-state prefix (may be the session name or a prefix of it)
				const laneRec = state.lanes.find(l => l.laneNumber === ln);
				const prefix = laneRec?.tmuxSessionName || sess;
				const ls = laneStates[prefix];
				if (ls) {
					if (ls.workerContextPct) contextPct = `${Math.round(ls.workerContextPct)}%`;
					if (ls.workerElapsed) elapsed = `${Math.round(ls.workerElapsed / 1000)}s`;
					if (ls.workerCostUsd) costStr = `$${ls.workerCostUsd.toFixed(3)}`;
				}
			}

			const parts: string[] = [`**${sess}**`];
			parts.push(`role: ${role}`);
			if (laneNum) parts.push(`lane: ${laneNum}`);
			if (taskId) parts.push(`task: ${taskId}`);
			if (contextPct) parts.push(`ctx: ${contextPct}`);
			if (elapsed) parts.push(`elapsed: ${elapsed}`);
			if (costStr) parts.push(`cost: ${costStr}`);
			lines.push(`- ${parts.join(" · ")}`);
		}

		return lines.join("\n");
	}

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
		// Reset startup state before loading to prevent stale errors on re-init.
		execCtx = null;
		execCtxInitError = null;
		try {
			execCtx = buildExecutionContext(ctx.cwd, loadOrchestratorConfig, loadTaskRunnerConfig);
		} catch (err: unknown) {
			if (err instanceof WorkspaceConfigError) {
				// Startup is fatal when workspace config is invalid OR repo-mode setup
				// requirements are not met (non-git cwd without workspace config).
				const setupError = err.code === "WORKSPACE_SETUP_REQUIRED";
				execCtxInitError = setupError
					? (
						`❌ Orchestrator startup blocked [${err.code}]\n\n` +
						`${err.message}\n\n` +
						`Orchestrator commands are disabled until this setup issue is resolved.`
					)
					: (
						`❌ Workspace configuration error [${err.code}]\n\n` +
						`${err.message}\n\n` +
						`Fix the workspace config at .pi/taskplane-workspace.yaml (or taskplane-config.json workspace section), then restart.\n` +
						`Orchestrator commands are disabled until this is resolved.`
					);

				ctx.ui.notify(execCtxInitError, "error");
				ctx.ui.setStatus(
					"task-orchestrator",
					setupError
						? "🔀 Orchestrator · ❌ startup failed (setup required)"
						: "🔀 Orchestrator · ❌ startup failed (workspace config error)",
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

		// TP-063: Run additive migrations on session start (safety net trigger).
		// This ensures migrations run even if the user doesn't invoke /orch.
		// Non-fatal — failures are silently swallowed so startup is never blocked.
		try {
			const migrationResult = runMigrations(execCtx.repoRoot, undefined, execCtx.pointer?.configRoot);
			if (migrationResult.messages.length > 0) {
				ctx.ui.notify(migrationResult.messages.join("\n"), "info");
			}
			// Errors on session_start are silent — avoid noisy warnings at startup
		} catch {
			// Swallow — migrations must never block session startup
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
		// TP-071: Kill engine process on session exit
		if (activeWorker) {
			try {
				activeWorker.kill();
				activeWorker = null;
			} catch {
				// Best effort — process may already be dead
			}
		}
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

