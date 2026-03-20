import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { execSync, execFileSync } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";

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
	listOrchSessions,
	listWorktrees,
	loadBatchState,
	loadOrchestratorConfig,
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

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let orchBatchState = freshOrchBatchState();
	let orchConfig: OrchestratorConfig = { ...DEFAULT_ORCHESTRATOR_CONFIG };
	let runnerConfig: TaskRunnerConfig = { ...DEFAULT_TASK_RUNNER_CONFIG };
	let orchWidgetCtx: ExtensionContext | undefined;
	let latestMonitorState: MonitorState | null = null;

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
		description: "Start batch execution: /orch <areas|paths|all>",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify(
					"Usage: /orch <areas|paths|all>\n\n" +
					"Examples:\n" +
					"  /orch all                          Run all pending tasks\n" +
					"  /orch time-off performance-management   Run specific areas\n" +
					"  /orch path/to/tasks                Scan directory\n" +
					"  /orch path/to/PROMPT.md            Single task with isolation",
					"info",
				);
				return;
			}

			if (!requireExecCtx(ctx)) return;

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

			// Reset batch state for new execution
			orchBatchState = freshOrchBatchState();
			latestMonitorState = null;
			updateOrchWidget();

			await executeOrchBatch(
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
			);

			// Final widget update after batch completes
			updateOrchWidget();
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
			if (orchBatchState.phase === "idle") {
				ctx.ui.notify("No batch is running. Use /orch <areas|paths|all> to start.", "info");
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

			// Prevent resume if a batch is actively running
			if (orchBatchState.phase === "executing" || orchBatchState.phase === "merging" || orchBatchState.phase === "planning") {
				ctx.ui.notify(
					`⚠️ A batch is currently ${orchBatchState.phase} (${orchBatchState.batchId}). Cannot resume.`,
					"warning",
				);
				return;
			}

			// Reset batch state for resume
			orchBatchState = freshOrchBatchState();
			latestMonitorState = null;
			updateOrchWidget();

			await resumeOrchBatch(
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
			);

			// Final widget update
			updateOrchWidget();
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

		// Set status line
		const areaCount = Object.keys(runnerConfig.task_areas).length;
		const modeLabel = execCtx.mode === "workspace" ? "workspace" : "repo";
		ctx.ui.setStatus(
			"task-orchestrator",
			`🔀 Orchestrator · ${modeLabel} mode · ${areaCount} areas · ${orchConfig.orchestrator.max_lanes} lanes`,
		);

		// Register initial dashboard widget (idle state)
		updateOrchWidget();

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
			"/orch-integrate          Integrate orch branch into working branch",
			"info",
		);

		// Check for taskplane updates (non-blocking)
		checkForUpdate(ctx);
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

