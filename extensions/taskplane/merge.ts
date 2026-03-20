/**
 * Merge orchestration, merge agents, merge worktree
 * @module orch/merge
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, copyFileSync, mkdirSync, rmSync } from "fs";
import { execSync, spawnSync } from "child_process";
import { join, dirname } from "path";

import { buildLaneEnvVars, buildTmuxSpawnArgs, execLog, tmuxHasSession, tmuxKillSession, toTmuxPath } from "./execution.ts";
import { resolveOperatorId } from "./naming.ts";
import { MERGE_POLL_INTERVAL_MS, MERGE_RESULT_GRACE_MS, MERGE_RESULT_READ_RETRIES, MERGE_RESULT_READ_RETRY_DELAY_MS, MERGE_SPAWN_RETRY_MAX, MERGE_TIMEOUT_MS, MergeError, VALID_MERGE_STATUSES } from "./types.ts";
import type { AllocatedLane, LaneExecutionResult, MergeLaneResult, MergeResult, MergeResultStatus, MergeWaveResult, OrchestratorConfig, RepoMergeOutcome, TaskRunnerConfig, VerificationBaselineResult, WaveExecutionResult, WorkspaceConfig } from "./types.ts";
import { resolveBaseBranch, resolveRepoRoot } from "./waves.ts";
import { generateMergeWorktreePath, sleepSync } from "./worktree.ts";
import { getCurrentBranch, runGit } from "./git.ts";
import { ORCH_MESSAGES } from "./messages.ts";
import { captureBaseline, diffFingerprints, runVerificationCommands, parseTestOutput, deduplicateFingerprints } from "./verification.ts";
import type { VerificationBaseline, FingerprintDiff, TestFingerprint } from "./verification.ts";

// ── Merge Implementation ─────────────────────────────────────────────

/**
 * Parse and validate a merge result JSON file.
 *
 * Strict validation:
 * - Must be valid JSON
 * - Must have required fields: status, source_branch, verification
 * - status must be a known MergeResultStatus
 * - Unknown status values are mapped to BUILD_FAILURE (fail-safe)
 *
 * Retry-read strategy: if initial parse fails, waits and retries up to
 * MERGE_RESULT_READ_RETRIES times to handle partially-written files.
 *
 * @param resultPath - Absolute path to the merge result JSON file
 * @returns Validated MergeResult
 * @throws MergeError with appropriate code on validation failure
 */
export function parseMergeResult(resultPath: string): MergeResult {
	if (!existsSync(resultPath)) {
		throw new MergeError(
			"MERGE_RESULT_INVALID",
			`Merge result file not found: ${resultPath}`,
		);
	}

	// Retry-read loop for partially-written files
	let lastParseError = "";
	for (let attempt = 1; attempt <= MERGE_RESULT_READ_RETRIES; attempt++) {
		try {
			const raw = readFileSync(resultPath, "utf-8").trim();
			if (!raw) {
				lastParseError = "File is empty";
				if (attempt < MERGE_RESULT_READ_RETRIES) {
					sleepSync(MERGE_RESULT_READ_RETRY_DELAY_MS);
					continue;
				}
				throw new MergeError(
					"MERGE_RESULT_INVALID",
					`Merge result file is empty after ${MERGE_RESULT_READ_RETRIES} attempts: ${resultPath}`,
				);
			}

			const parsed = JSON.parse(raw);

			// Validate required fields
			if (typeof parsed.status !== "string") {
				throw new MergeError(
					"MERGE_RESULT_MISSING_FIELDS",
					`Merge result missing required field "status": ${resultPath}`,
				);
			}
			if (typeof parsed.source_branch !== "string") {
				throw new MergeError(
					"MERGE_RESULT_MISSING_FIELDS",
					`Merge result missing required field "source_branch": ${resultPath}`,
				);
			}
			// Normalize verification: accept either a nested object or flat fields
			if (!parsed.verification || typeof parsed.verification !== "object") {
				// Merge agents may write flat verification_passed/verification_commands fields
				// instead of a nested verification object. Normalize to the expected shape.
				if (typeof parsed.verification_passed === "boolean" || Array.isArray(parsed.verification_commands)) {
					parsed.verification = {
						commands_run: parsed.verification_commands || [],
						all_passed: parsed.verification_passed !== false,
						output: "",
						notes: "",
					};
				} else {
					throw new MergeError(
						"MERGE_RESULT_MISSING_FIELDS",
						`Merge result missing required field "verification": ${resultPath}`,
					);
				}
			}

			// Normalize status to uppercase (merge agents may write lowercase)
			parsed.status = String(parsed.status).toUpperCase();

			// Validate status value
			if (!VALID_MERGE_STATUSES.has(parsed.status)) {
				execLog("merge", "parse", `unknown merge status "${parsed.status}" — treating as BUILD_FAILURE`, {
					resultPath,
				});
				parsed.status = "BUILD_FAILURE";
			}

			// Normalize optional fields with defaults
			return {
				status: parsed.status as MergeResultStatus,
				source_branch: parsed.source_branch,
				target_branch: parsed.target_branch || "",
				merge_commit: parsed.merge_commit || "",
				conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
				verification: {
					ran: !!parsed.verification.ran,
					passed: !!parsed.verification.passed,
					output: typeof parsed.verification.output === "string"
						? parsed.verification.output.slice(0, 2000)
						: "",
				},
			};
		} catch (err: unknown) {
			if (err instanceof MergeError) throw err;

			// JSON parse error — possibly partially written
			lastParseError = err instanceof Error ? err.message : String(err);
			if (attempt < MERGE_RESULT_READ_RETRIES) {
				sleepSync(MERGE_RESULT_READ_RETRY_DELAY_MS);
				continue;
			}
		}
	}

	throw new MergeError(
		"MERGE_RESULT_INVALID",
		`Failed to parse merge result JSON after ${MERGE_RESULT_READ_RETRIES} attempts. ` +
		`Last error: ${lastParseError}. File: ${resultPath}`,
	);
}

/**
 * Determine merge order for completed lanes.
 *
 * Default heuristic: fewest-files-first.
 * - Lanes with fewer files in their file scope merge first
 * - Smaller changes are less likely to conflict, establishing a clean base
 * - Tie-breaker: branch name alphabetically (deterministic)
 *
 * Alternative: sequential (lane number order).
 *
 * @param lanes  - Completed lanes to order
 * @param order  - Ordering strategy from config
 * @returns Lanes sorted in merge order
 */
export function determineMergeOrder(
	lanes: AllocatedLane[],
	order: "fewest-files-first" | "sequential",
): AllocatedLane[] {
	const sorted = [...lanes];

	if (order === "sequential") {
		sorted.sort((a, b) => a.laneNumber - b.laneNumber);
		return sorted;
	}

	// fewest-files-first: count total file scope across all tasks in the lane
	sorted.sort((a, b) => {
		const aFiles = a.tasks.reduce((sum, t) => sum + (t.task.fileScope?.length || 0), 0);
		const bFiles = b.tasks.reduce((sum, t) => sum + (t.task.fileScope?.length || 0), 0);

		if (aFiles !== bFiles) return aFiles - bFiles;

		// Tie-breaker: branch name alphabetically
		return a.branch.localeCompare(b.branch);
	});

	return sorted;
}

/**
 * Build merge request content for the merge agent.
 *
 * The merge request is a structured text document that tells the merge agent:
 * - Which branch to merge (source)
 * - Which branch to merge into (target)
 * - What tasks were completed in this lane
 * - File scope of those tasks
 * - Verification commands to run
 * - Where to write the result file
 *
 * @param lane           - The lane to merge
 * @param targetBranch   - Target branch (typically "develop")
 * @param waveIndex      - Wave number (1-indexed)
 * @param verifyCommands - Verification commands from config
 * @param resultFilePath - Path where the merge agent should write results
 * @returns Formatted merge request text
 */
export function buildMergeRequest(
	lane: AllocatedLane,
	targetBranch: string,
	waveIndex: number,
	verifyCommands: string[],
	resultFilePath: string,
): string {
	const taskIds = lane.tasks.map(t => t.taskId).join(", ");
	const fileScopes = lane.tasks
		.flatMap(t => t.task.fileScope || [])
		.filter((f, i, arr) => arr.indexOf(f) === i); // deduplicate

	const mergeMessage = `merge: wave ${waveIndex} lane ${lane.laneNumber} — ${taskIds}`;

	const lines: string[] = [
		"# Merge Request",
		"",
		`## Source Branch`,
		`${lane.branch}`,
		"",
		`## Target Branch`,
		`${targetBranch}`,
		"",
		`## Merge Message`,
		`${mergeMessage}`,
		"",
		`## Tasks Completed`,
		...lane.tasks.map(t => `- ${t.taskId}: ${t.task.taskName}`),
		"",
		`## File Scope`,
		...(fileScopes.length > 0
			? fileScopes.map(f => `- ${f}`)
			: ["- (no file scope declared)"]),
		"",
		`## Verification Commands`,
		...verifyCommands.map(cmd => `\`\`\`bash\n${cmd}\n\`\`\``),
		"",
		`## Result File`,
		`result_file: ${resultFilePath}`,
		`Write your JSON result to: ${resultFilePath}`,
		"",

		"## Important",
		"- You are working in an ISOLATED MERGE WORKTREE (not the user's main repo)",
		"- The correct branch is ALREADY checked out — do NOT checkout any other branch",
		"- Simply merge the source branch into the current HEAD",
		"- Run ALL verification commands after a successful merge",
		"- If verification fails, revert the merge commit before writing the result",
		"- Write the result file LAST, after all git operations are complete",
	];

	return lines.join("\n");
}

/**
 * Spawn a TMUX session for the merge agent.
 *
 * Creates a TMUX session in the main repo directory (not a worktree)
 * that runs pi with the task-merger agent definition and the merge request.
 *
 * Handles:
 * - Stale session cleanup
 * - Retry on transient spawn failures
 * - Structured logging
 *
 * @param sessionName     - TMUX session name (e.g., "orch-merge-1")
 * @param repoRoot        - Main repository root (merge happens here)
 * @param mergeRequestPath - Path to the merge request temp file
 * @param config          - Orchestrator config (for model, tools)
 * @param stateRoot       - Root for state files (batch state, merge results). Stays at workspace root.
 * @param agentRoot       - Root for agent prompts. When pointer is resolved, this is the config repo's agent dir. Falls back to `<stateRoot>/.pi/agents/` or `<repoRoot>/.pi/agents/`.
 * @throws MergeError if spawn fails after retries
 */
export function spawnMergeAgent(
	sessionName: string,
	repoRoot: string,
	mergeWorkDir: string,
	mergeRequestPath: string,
	config: OrchestratorConfig,
	stateRoot?: string,
	agentRoot?: string,
): void {
	execLog("merge", sessionName, "preparing to spawn merge agent", {
		mergeWorkDir,
		mergeRequestPath,
	});

	// Clean up stale session if exists
	if (tmuxHasSession(sessionName)) {
		execLog("merge", sessionName, "killing stale merge session");
		tmuxKillSession(sessionName);
		sleepSync(500);
	}

	// Build the pi command for the merge agent.
	// Uses --no-session to prevent interactive session management.
	// --append-system-prompt loads the merger agent definition.
	// The merge request file is passed as a prompt via @file syntax.
	const shellQuote = (s: string): string => {
		if (/[\s"'`$\\!&|;()<>{}#*?~]/.test(s)) {
			return `'${s.replace(/'/g, "'\\''")}'`;
		}
		return s;
	};

	// Build model args if specified
	const modelArgs = config.merge.model ? `--model ${shellQuote(config.merge.model)}` : "";

	// Build tools override if specified
	const toolsArgs = config.merge.tools ? `--tools ${shellQuote(config.merge.tools)}` : "";

	const piCommand = [
		"pi --no-session",
		modelArgs,
		toolsArgs,
		`--append-system-prompt ${shellQuote(agentRoot ? join(agentRoot, "task-merger.md") : join(stateRoot ?? repoRoot, ".pi", "agents", "task-merger.md"))}`,
		`@${shellQuote(mergeRequestPath)}`,
	].filter(Boolean).join(" ");

	const tmuxMergeDir = toTmuxPath(mergeWorkDir);
	// Pi's TUI (ink/react) hangs silently with TERM=tmux-256color (tmux default).
	// Force xterm-256color so pi can render and start execution.
	// Same fix as buildTmuxSpawnArgs / buildLaneEnvVars.
	const wrappedCommand = `cd ${shellQuote(tmuxMergeDir)} && TERM=xterm-256color ${piCommand}`;
	const tmuxArgs = [
		"new-session", "-d",
		"-s", sessionName,
		wrappedCommand,
	];

	// Attempt to spawn with retry
	let lastError = "";
	for (let attempt = 1; attempt <= MERGE_SPAWN_RETRY_MAX + 1; attempt++) {
		const result = spawnSync("tmux", tmuxArgs);

		if (result.status === 0) {
			execLog("merge", sessionName, "merge agent session spawned", { attempt });
			return;
		}

		lastError = result.stderr?.toString().trim() || "unknown spawn error";
		execLog("merge", sessionName, `merge spawn attempt ${attempt} failed: ${lastError}`);

		if (attempt <= MERGE_SPAWN_RETRY_MAX) {
			sleepSync(attempt * 1000);
		}
	}

	throw new MergeError(
		"MERGE_SPAWN_FAILED",
		`Failed to create merge TMUX session '${sessionName}' after ` +
		`${MERGE_SPAWN_RETRY_MAX + 1} attempts. Last error: ${lastError}`,
	);
}

/**
 * Wait for merge agent to produce a result file.
 *
 * Polling loop with timeout and session liveness detection:
 * 1. Check if result file exists → parse and return
 * 2. Check if TMUX session is still alive
 * 3. If session died without result → grace period → check again → fail
 * 4. If timeout exceeded → kill session → fail
 *
 * @param resultPath   - Path to the expected result JSON file
 * @param sessionName  - TMUX session name for liveness checking
 * @param timeoutMs    - Maximum wait time (default: MERGE_TIMEOUT_MS)
 * @returns Validated MergeResult
 * @throws MergeError on timeout, session death, or invalid result
 */
export function waitForMergeResult(
	resultPath: string,
	sessionName: string,
	timeoutMs: number = MERGE_TIMEOUT_MS,
): MergeResult {
	const startTime = Date.now();
	let sessionDiedAt: number | null = null;

	execLog("merge", sessionName, "waiting for merge result", {
		resultPath,
		timeoutMs,
	});

	while (true) {
		const elapsed = Date.now() - startTime;

		// Check timeout
		if (elapsed >= timeoutMs) {
			execLog("merge", sessionName, "merge timeout — killing session", {
				elapsed,
				timeoutMs,
			});
			tmuxKillSession(sessionName);

			// One final check for result file (agent may have written it just before timeout)
			if (existsSync(resultPath)) {
				try {
					return parseMergeResult(resultPath);
				} catch {
					// Fall through to timeout error
				}
			}

			throw new MergeError(
				"MERGE_TIMEOUT",
				`Merge agent '${sessionName}' did not produce a result within ` +
				`${Math.round(timeoutMs / 1000)}s. The session has been killed. ` +
				`Check the merge request and agent logs.`,
			);
		}

		// Check if result file exists
		if (existsSync(resultPath)) {
			try {
				const result = parseMergeResult(resultPath);
				execLog("merge", sessionName, "merge result received", {
					status: result.status,
					elapsed,
				});
				// Kill session if still alive (agent should exit, but ensure cleanup)
				if (tmuxHasSession(sessionName)) {
					tmuxKillSession(sessionName);
				}
				return result;
			} catch (err: unknown) {
				// File exists but invalid — might be partially written.
				// parseMergeResult already retries, so if it throws, it's final.
				if (err instanceof MergeError && err.code === "MERGE_RESULT_INVALID") {
					// Wait a bit and try once more (file might still be in flight)
					sleepSync(MERGE_RESULT_READ_RETRY_DELAY_MS);
					if (existsSync(resultPath)) {
						try {
							return parseMergeResult(resultPath);
						} catch {
							// Give up on this file
						}
					}
				}
				// If still failing, continue polling (agent might rewrite)
			}
		}

		// Check session liveness
		const sessionAlive = tmuxHasSession(sessionName);

		if (!sessionAlive) {
			if (sessionDiedAt === null) {
				// First detection of session death — start grace period
				sessionDiedAt = Date.now();
				execLog("merge", sessionName, "session exited — starting grace period", {
					graceMs: MERGE_RESULT_GRACE_MS,
				});
			} else if (Date.now() - sessionDiedAt >= MERGE_RESULT_GRACE_MS) {
				// Grace period expired — no result file
				// One final check
				if (existsSync(resultPath)) {
					try {
						return parseMergeResult(resultPath);
					} catch {
						// Fall through to session died error
					}
				}

				throw new MergeError(
					"MERGE_SESSION_DIED",
					`Merge agent session '${sessionName}' exited without writing ` +
					`a result file to '${resultPath}'. The merge may have crashed. ` +
					`Check the session output: tmux capture-pane is unavailable ` +
					`after session exit.`,
				);
			}
			// Within grace period — continue polling
		}

		// Poll interval
		sleepSync(MERGE_POLL_INTERVAL_MS);
	}
}

/**
 * Force-remove a merge worktree directory and prune stale git references.
 *
 * TP-029: Applies the same forceCleanupWorktree pattern used for lane
 * worktrees. Tries `git worktree remove --force` first, then falls back
 * to `rm -rf` + `git worktree prune` if the initial removal fails.
 *
 * Used in both stale-prep cleanup (before creating a fresh merge worktree)
 * and end-of-wave cleanup (after merge completes).
 *
 * @param mergeWorkDir - Absolute path to the merge worktree directory
 * @param repoRoot     - Main repository root for git operations
 * @param context      - Logging context (e.g., "W1" for wave 1)
 */
function forceRemoveMergeWorktree(
	mergeWorkDir: string,
	repoRoot: string,
	context: string,
): void {
	if (!existsSync(mergeWorkDir)) return;

	// Try git worktree remove --force first
	const removeResult = spawnSync("git", ["worktree", "remove", mergeWorkDir, "--force"], { cwd: repoRoot });
	if (removeResult.status === 0) {
		return;
	}

	// Fallback: force-remove the directory and prune git worktree state
	const stderr = removeResult.stderr?.toString().trim() || "";
	execLog("merge", context, `git worktree remove failed for merge worktree, applying force cleanup`, {
		error: stderr.slice(0, 200),
		path: mergeWorkDir,
	});

	try {
		rmSync(mergeWorkDir, { recursive: true, force: true });
		execLog("merge", context, `force-removed merge worktree directory`, { path: mergeWorkDir });
	} catch (rmErr: unknown) {
		// Node's rmSync may fail on Windows reserved-name files — try OS-level removal
		const rmMsg = rmErr instanceof Error ? rmErr.message : String(rmErr);
		execLog("merge", context, `rmSync failed for merge worktree, trying OS-level removal`, { error: rmMsg });
		try {
			if (process.platform === "win32") {
				execSync(`rd /s /q "${mergeWorkDir}"`, { stdio: "pipe", timeout: 30_000 });
			} else {
				execSync(`rm -rf "${mergeWorkDir}"`, { stdio: "pipe", timeout: 30_000 });
			}
			execLog("merge", context, `OS-level removal of merge worktree succeeded`, { path: mergeWorkDir });
		} catch (osErr: unknown) {
			const osMsg = osErr instanceof Error ? osErr.message : String(osErr);
			execLog("merge", context, `OS-level removal also failed — manual cleanup needed`, {
				path: mergeWorkDir,
				error: osMsg,
			});
		}
	}

	// Prune stale worktree references
	runGit(["worktree", "prune"], repoRoot);
}

// ── Orchestrator-Side Verification (TP-032) ──────────────────────────

/**
 * Run post-merge verification and compare against baseline.
 *
 * Captures fingerprints from the merge worktree after a successful merge,
 * diffs against the pre-merge baseline, and classifies the result:
 * - "pass": no new failures (only pre-existing or fixed)
 * - "verification_new_failure": genuinely new failures detected
 * - "flaky_suspected": new failures disappeared on re-run (warning only)
 *
 * Flaky handling: when new failures are detected, only the commands that
 * produced new failures are re-run once. If the failures disappear on
 * re-run, the result is reclassified as "flaky_suspected".
 *
 * @param testingCommands - Named verification commands (from testing.commands config)
 * @param mergeWorkDir    - Merge worktree path (post-merge state)
 * @param baseline        - Pre-merge baseline to compare against
 * @param laneNumber      - Lane number (for logging/persistence)
 * @param waveIndex       - Wave index (for persistence naming)
 * @param batchId         - Batch ID (for persistence naming)
 * @param opId            - Operator ID (for persistence naming)
 * @param sessionName     - Session name for structured logging
 * @param stateRoot       - State root for persistence (workspace root or repo root)
 * @param repoId          - Repository ID for workspace-mode artifact naming (optional)
 * @param flakyReruns     - Number of flaky re-runs (0 = disabled, default 1)
 * @returns VerificationBaselineResult with classification and details
 */
function runPostMergeVerification(
	testingCommands: Record<string, string>,
	mergeWorkDir: string,
	baseline: VerificationBaseline,
	laneNumber: number,
	waveIndex: number,
	batchId: string,
	opId: string,
	sessionName: string,
	stateRoot: string,
	repoId?: string,
	flakyReruns: number = 1,
): VerificationBaselineResult {
	execLog("merge", sessionName, "capturing post-merge verification fingerprints");

	// Capture post-merge fingerprints
	const postMerge = captureBaseline(testingCommands, mergeWorkDir);

	// Persist post-merge snapshot for debugging
	try {
		const verifyDir = join(stateRoot, ".pi", "verification", opId);
		mkdirSync(verifyDir, { recursive: true });
		// TP-032 R006-1: Include repoId in filename to prevent overwrites
		// when mergeWaveByRepo() calls mergeWave() once per repo group.
		const repoSuffix = repoId ? `-repo-${repoId.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
		const postFileName = `post-b${batchId}-w${waveIndex}${repoSuffix}-lane${laneNumber}.json`;
		writeFileSync(
			join(verifyDir, postFileName),
			JSON.stringify(postMerge, null, 2),
			"utf-8",
		);
	} catch {
		// Best effort — persistence failure doesn't block verification
	}

	// Diff fingerprints
	const diff = diffFingerprints(baseline.fingerprints, postMerge.fingerprints);

	execLog("merge", sessionName, "verification diff computed", {
		newFailures: diff.newFailures.length,
		preExisting: diff.preExisting.length,
		fixed: diff.fixed.length,
	});

	// No new failures — pass
	if (diff.newFailures.length === 0) {
		return {
			performed: true,
			newFailureCount: 0,
			preExistingCount: diff.preExisting.length,
			fixedCount: diff.fixed.length,
			classification: "pass",
			newFailureSummary: "",
			flakyRerunPerformed: false,
		};
	}

	// ── Flaky re-run: re-run only the commands that produced new failures ──
	// Only when flakyReruns > 0 (0 = disabled — any new failure immediately blocks)
	if (flakyReruns > 0) {
		// Identify which commandIds produced new failures
		const failedCommandIds = new Set(diff.newFailures.map(fp => fp.commandId));
		const rerunCommands: Record<string, string> = {};
		for (const cmdId of failedCommandIds) {
			if (testingCommands[cmdId]) {
				rerunCommands[cmdId] = testingCommands[cmdId];
			}
		}

		// Re-run up to flakyReruns times; break early if failures clear
		let clearedOnRerun = false;
		for (let attempt = 0; attempt < flakyReruns; attempt++) {
			execLog("merge", sessionName, `new failures detected — running flaky re-run ${attempt + 1}/${flakyReruns}`, {
				failedCommands: [...failedCommandIds].join(", "),
				rerunCount: Object.keys(rerunCommands).length,
			});

			const rerunResults = runVerificationCommands(rerunCommands, mergeWorkDir);

			// Parse re-run fingerprints
			const rerunFingerprints: TestFingerprint[] = [];
			for (const result of rerunResults) {
				const fps = parseTestOutput(result);
				rerunFingerprints.push(...fps);
			}
			const dedupedRerun = deduplicateFingerprints(rerunFingerprints);

			// Re-diff: compare baseline against re-run results for the failed commands only
			// Filter baseline fingerprints to only the commands we re-ran
			const baselineForRerun = baseline.fingerprints.filter(fp => failedCommandIds.has(fp.commandId));
			const rerunDiff = diffFingerprints(baselineForRerun, dedupedRerun);

			if (rerunDiff.newFailures.length === 0) {
				// Failures disappeared on re-run — flaky suspected
				execLog("merge", sessionName, `flaky re-run ${attempt + 1} cleared all new failures — classifying as flaky_suspected`);
				clearedOnRerun = true;
				break;
			}

			// If this is the last attempt and failures persist, return failure
			if (attempt === flakyReruns - 1) {
				const summary = rerunDiff.newFailures
					.slice(0, 5)
					.map(fp => `${fp.commandId}:${fp.file}:${fp.case} (${fp.kind})`)
					.join("; ");
				const truncated = rerunDiff.newFailures.length > 5
					? ` ... and ${rerunDiff.newFailures.length - 5} more`
					: "";

				return {
					performed: true,
					newFailureCount: rerunDiff.newFailures.length,
					preExistingCount: diff.preExisting.length,
					fixedCount: diff.fixed.length,
					classification: "verification_new_failure",
					newFailureSummary: summary + truncated,
					flakyRerunPerformed: true,
				};
			}
		}

		if (clearedOnRerun) {
			return {
				performed: true,
				newFailureCount: 0,
				preExistingCount: diff.preExisting.length,
				fixedCount: diff.fixed.length,
				classification: "flaky_suspected",
				newFailureSummary: `Flaky: ${diff.newFailures.length} failure(s) disappeared on re-run`,
				flakyRerunPerformed: true,
			};
		}
	}

	// flakyReruns === 0 or fallthrough: new failures block immediately
	const summary = diff.newFailures
		.slice(0, 5)
		.map(fp => `${fp.commandId}:${fp.file}:${fp.case} (${fp.kind})`)
		.join("; ");
	const truncated = diff.newFailures.length > 5
		? ` ... and ${diff.newFailures.length - 5} more`
		: "";

	return {
		performed: true,
		newFailureCount: diff.newFailures.length,
		preExistingCount: diff.preExisting.length,
		fixedCount: diff.fixed.length,
		classification: "verification_new_failure",
		newFailureSummary: summary + truncated,
		flakyRerunPerformed: flakyReruns > 0,
	};
}

/**
 * Merge a completed wave's lane branches into the base branch.
 *
 * Orchestration flow:
 * 1. Filter to only succeeded lanes (failed lanes are not merged)
 * 2. Determine merge order (fewest-files-first or sequential)
 * 3. For each lane, sequentially:
 *    a. Build merge request content
 *    b. Write merge request to temp file
 *    c. Spawn merge agent in TMUX session (in main repo)
 *    d. Wait for merge result
 *    e. Handle result (continue, log, or pause)
 * 4. Return MergeWaveResult
 *
 * Sequential execution is mandatory — the base branch is a shared
 * resource, and each merge must see the prior merge's result.
 *
 * On CONFLICT_UNRESOLVED or BUILD_FAILURE: stops merging remaining lanes
 * and returns with failure status.
 *
 * Temp file cleanup: merge request files are cleaned up after each lane,
 * regardless of outcome. Result files are left for debugging.
 *
 * @param completedLanes   - Lanes that completed execution (from wave result)
 * @param waveResult       - The wave execution result (for lane status filtering)
 * @param waveIndex        - Wave number (1-indexed)
 * @param config           - Orchestrator configuration
 * @param repoRoot         - Main repository root
 * @param batchId          - Batch ID for session naming
 * @param baseBranch       - Branch to merge into (captured at batch start)
 * @returns MergeWaveResult with per-lane outcomes
 */
export function mergeWave(
	completedLanes: AllocatedLane[],
	waveResult: WaveExecutionResult,
	waveIndex: number,
	config: OrchestratorConfig,
	repoRoot: string,
	batchId: string,
	baseBranch: string,
	stateRoot?: string,
	agentRoot?: string,
	testingCommands?: Record<string, string>,
	repoId?: string,
): MergeWaveResult {
	const startTime = Date.now();
	const tmuxPrefix = config.orchestrator.tmux_prefix;
	const opId = resolveOperatorId(config);
	const targetBranch = baseBranch;
	const laneResults: MergeLaneResult[] = [];

	// Build lane outcome lookup for merge eligibility checks.
	const laneOutcomeByNumber = new Map<number, LaneExecutionResult>();
	for (const laneOutcome of waveResult.laneResults) {
		laneOutcomeByNumber.set(laneOutcome.laneNumber, laneOutcome);
	}

	// A lane is mergeable if:
	// - It has at least one succeeded task, AND
	// - It has no hard failures (failed/stalled).
	//
	// This allows succeeded+skipped lanes (e.g., stop-wave skip of remaining tasks)
	// to merge their committed work, while excluding mixed succeeded+failed lanes.
	const mergeableLanes = completedLanes.filter(lane => {
		const outcome = laneOutcomeByNumber.get(lane.laneNumber);
		if (!outcome) return false;

		const hasSucceeded = outcome.tasks.some(t => t.status === "succeeded");
		const hasHardFailure = outcome.tasks.some(
			t => t.status === "failed" || t.status === "stalled",
		);

		return hasSucceeded && !hasHardFailure;
	});

	if (mergeableLanes.length === 0) {
		execLog("merge", `W${waveIndex}`, "no mergeable lanes (all failed or empty)");
		return {
			waveIndex,
			status: "succeeded", // vacuous success — nothing to merge
			laneResults: [],
			failedLane: null,
			failureReason: null,
			totalDurationMs: Date.now() - startTime,
		};
	}

	// Determine merge order
	const orderedLanes = determineMergeOrder(mergeableLanes, config.merge.order);

	execLog("merge", `W${waveIndex}`, `merging ${orderedLanes.length} lane(s)`, {
		order: config.merge.order,
		lanes: orderedLanes.map(l => l.laneNumber).join(","),
	});

	// ── Create isolated merge worktree ──────────────────────────────
	// Merging in a dedicated worktree prevents dirty-worktree failures
	// caused by user edits or orchestrator-generated files in the main repo.
	// The merge worktree lives inside the batch container alongside lane worktrees:
	// {basePath}/{opId}-{batchId}/merge
	const tempBranch = `_merge-temp-${opId}-${batchId}`;
	const mergeWorkDir = generateMergeWorktreePath(repoRoot, opId, batchId, config);

	// Clean up stale merge worktree/branch from prior failed attempt.
	// TP-029: Apply forceRemoveMergeWorktree fallback so stale merge worktrees
	// from prior failed attempts don't block new merge creation.
	forceRemoveMergeWorktree(mergeWorkDir, repoRoot, `W${waveIndex}`);
	if (existsSync(mergeWorkDir)) {
		// Force cleanup didn't fully remove — wait and retry once
		sleepSync(500);
		forceRemoveMergeWorktree(mergeWorkDir, repoRoot, `W${waveIndex}`);
	}
	try {
		spawnSync("git", ["branch", "-D", tempBranch], { cwd: repoRoot });
	} catch { /* branch may not exist */ }

	// Create temp branch at target branch HEAD, then worktree
	const branchResult = spawnSync("git", ["branch", tempBranch, targetBranch], { cwd: repoRoot });
	if (branchResult.status !== 0) {
		const err = branchResult.stderr?.toString().trim() || "unknown error";
		execLog("merge", `W${waveIndex}`, `failed to create temp branch: ${err}`);
		return {
			waveIndex, status: "failed", laneResults: [],
			failedLane: null, failureReason: `Failed to create merge temp branch: ${err}`,
			totalDurationMs: Date.now() - startTime,
		};
	}

	const wtResult = spawnSync("git", ["worktree", "add", mergeWorkDir, tempBranch], { cwd: repoRoot });
	if (wtResult.status !== 0) {
		const err = wtResult.stderr?.toString().trim() || "unknown error";
		execLog("merge", `W${waveIndex}`, `failed to create merge worktree: ${err}`);
		spawnSync("git", ["branch", "-D", tempBranch], { cwd: repoRoot });
		return {
			waveIndex, status: "failed", laneResults: [],
			failedLane: null, failureReason: `Failed to create merge worktree: ${err}`,
			totalDurationMs: Date.now() - startTime,
		};
	}

	execLog("merge", `W${waveIndex}`, `merge worktree created`, {
		worktree: mergeWorkDir,
		tempBranch,
	});

	// ── Orchestrator-side baseline capture (TP-032) ────────────────
	// Capture verification fingerprints on the pre-merge state of the merge
	// worktree. This baseline is compared against post-merge fingerprints
	// for each lane to detect genuinely new failures vs pre-existing ones.
	// Only runs when verification.enabled === true AND testing.commands present.
	let baseline: VerificationBaseline | null = null;
	const hasTestingCommands = testingCommands && Object.keys(testingCommands).length > 0;
	const verificationEnabled = config.verification.enabled;
	const verificationMode = config.verification.mode;
	const flakyReruns = config.verification.flaky_reruns;

	if (verificationEnabled && !hasTestingCommands) {
		// Verification is enabled but no testing commands configured — treat as
		// baseline-unavailable. Strict/permissive handling below.
		if (verificationMode === "strict") {
			execLog("merge", `W${waveIndex}`, "verification enabled but no testing commands configured — strict mode: failing merge");
			// Clean up worktree and temp branch before returning failure
			forceRemoveMergeWorktree(mergeWorkDir, repoRoot, `W${waveIndex}`);
			try { spawnSync("git", ["branch", "-D", tempBranch], { cwd: repoRoot }); } catch { /* best effort */ }
			return {
				waveIndex, status: "failed", laneResults: [],
				failedLane: null,
				failureReason: "Verification enabled (strict mode) but no testing commands configured in taskRunner.testing.commands",
				totalDurationMs: Date.now() - startTime,
			};
		} else {
			execLog("merge", `W${waveIndex}`, "verification enabled but no testing commands configured — permissive mode: continuing without verification");
		}
	}

	if (verificationEnabled && hasTestingCommands) {
		execLog("merge", `W${waveIndex}`, "capturing verification baseline on pre-merge state", {
			commandCount: Object.keys(testingCommands).length,
			commands: Object.keys(testingCommands).join(", "),
		});

		try {
			baseline = captureBaseline(testingCommands, mergeWorkDir);

			// Persist baseline for debugging/auditability
			const piDir = stateRoot ?? repoRoot;
			const verifyDir = join(piDir, ".pi", "verification", opId);
			mkdirSync(verifyDir, { recursive: true });
			// TP-032 R006-1: Include repoId in filename to prevent overwrites
			// when mergeWaveByRepo() calls mergeWave() once per repo group.
			const repoSuffix = repoId ? `-repo-${repoId.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
			const baselineFileName = `baseline-b${batchId}-w${waveIndex}${repoSuffix}.json`;
			writeFileSync(
				join(verifyDir, baselineFileName),
				JSON.stringify(baseline, null, 2),
				"utf-8",
			);

			execLog("merge", `W${waveIndex}`, "verification baseline captured", {
				fingerprints: baseline.fingerprints.length,
				preExistingFailures: baseline.fingerprints.length,
				storedAt: join(verifyDir, baselineFileName),
			});
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			if (verificationMode === "strict") {
				execLog("merge", `W${waveIndex}`, `baseline capture failed — strict mode: failing merge`, {
					error: errMsg,
				});
				// Clean up worktree and temp branch before returning failure
				forceRemoveMergeWorktree(mergeWorkDir, repoRoot, `W${waveIndex}`);
				try { spawnSync("git", ["branch", "-D", tempBranch], { cwd: repoRoot }); } catch { /* best effort */ }
				return {
					waveIndex, status: "failed", laneResults: [],
					failedLane: null,
					failureReason: `Verification baseline capture failed (strict mode): ${errMsg}`,
					totalDurationMs: Date.now() - startTime,
				};
			}
			execLog("merge", `W${waveIndex}`, `baseline capture failed — permissive mode: continuing without baseline verification`, {
				error: errMsg,
			});
			// Permissive: baseline capture failure is non-fatal — merge proceeds without
			// orchestrator-side verification. Merge-agent verification (merge.verify)
			// still applies independently.
			baseline = null;
		}
	}

	// Sequential merge loop
	let failedLane: number | null = null;
	let failureReason: string | null = null;
	// TP-032 R006-2: When verification rollback fails, the temp branch still contains
	// the bad merge commit. Branch advancement MUST be blocked entirely — not just for
	// the verification-blocked lane, but for all lanes, because the temp branch HEAD
	// includes the unverified commit and any prior successful merges built on top of it.
	let blockAdvancement = false;

	for (const lane of orderedLanes) {
		const laneStart = Date.now();
		const sessionName = `${tmuxPrefix}-${opId}-merge-${lane.laneNumber}`;
		const resultFileName = `merge-result-w${waveIndex}-lane${lane.laneNumber}-${opId}-${batchId}.json`;
		const piDir = stateRoot ?? repoRoot;
		const resultFilePath = join(piDir, ".pi", resultFileName);
		const requestFileName = `merge-request-w${waveIndex}-lane${lane.laneNumber}-${opId}-${batchId}.txt`;
		const requestFilePath = join(piDir, ".pi", requestFileName);

		// ── TP-032: Capture pre-lane HEAD for rollback on verification failure ──
		// If baseline is available and post-merge verification detects new failures,
		// we reset the temp branch to this commit to undo the lane's merge commit.
		let preLaneHead = "";
		if (baseline) {
			const headResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: mergeWorkDir, encoding: "utf-8" });
			if (headResult.status === 0) {
				preLaneHead = headResult.stdout.trim();
			}
		}

		execLog("merge", sessionName, `starting merge for lane ${lane.laneNumber}`, {
			sourceBranch: lane.branch,
			targetBranch,
		});

		try {
			// Clean up any stale result file from prior attempt
			if (existsSync(resultFilePath)) {
				try {
					unlinkSync(resultFilePath);
				} catch {
					// Best effort
				}
			}

			// Build merge request content
			// TP-032 R006-3: Preserve merge.verify commands independently of baseline
			// fingerprinting. The orchestrator-side baseline comparison (testing.commands)
			// is additive — it does NOT replace the merge agent's own verification
			// (merge.verify). Agents may run build checks or other non-fingerprintable
			// commands via merge.verify that must not be silently suppressed.
			const mergeRequestContent = buildMergeRequest(
				lane,
				targetBranch,
				waveIndex,
				config.merge.verify,
				resultFilePath,
			);

			// Write merge request to temp file
			writeFileSync(requestFilePath, mergeRequestContent, "utf-8");

			// Spawn merge agent in the isolated merge worktree
			spawnMergeAgent(sessionName, repoRoot, mergeWorkDir, requestFilePath, config, stateRoot, agentRoot);

			// Wait for result — use configured timeout (default 10 min, was 5 min)
			const timeoutMs = (config.merge.timeout_minutes ?? 10) * 60 * 1000;
			const mergeResult = waitForMergeResult(resultFilePath, sessionName, timeoutMs);

			// Clean up request file (leave result file for debugging)
			try {
				unlinkSync(requestFilePath);
			} catch {
				// Best effort
			}

			// Record lane result (verificationBaseline populated below if applicable)
			const laneResult: MergeLaneResult = {
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				sourceBranch: lane.branch,
				targetBranch,
				result: mergeResult,
				error: null,
				durationMs: Date.now() - laneStart,
				repoId: lane.repoId,
			};
			laneResults.push(laneResult);

			// Handle merge outcome
			switch (mergeResult.status) {
				case "SUCCESS":
					execLog("merge", sessionName, "merge succeeded", {
						mergeCommit: mergeResult.merge_commit.slice(0, 8),
						duration: `${Math.round((Date.now() - laneStart) / 1000)}s`,
					});
					break;

				case "CONFLICT_RESOLVED":
					execLog("merge", sessionName, "merge succeeded with resolved conflicts", {
						mergeCommit: mergeResult.merge_commit.slice(0, 8),
						conflictCount: mergeResult.conflicts.length,
						duration: `${Math.round((Date.now() - laneStart) / 1000)}s`,
					});
					break;

				case "CONFLICT_UNRESOLVED":
					execLog("merge", sessionName, "merge failed — unresolved conflicts", {
						conflictCount: mergeResult.conflicts.length,
						files: mergeResult.conflicts.map(c => c.file).join(", "),
					});
					failedLane = lane.laneNumber;
					failureReason = `Unresolved merge conflicts in lane ${lane.laneNumber}: ` +
						mergeResult.conflicts.map(c => c.file).join(", ");
					break;

				case "BUILD_FAILURE":
					// TP-032: When baseline is active, BUILD_FAILURE from the merge agent
					// should not normally occur (we suppress verify commands). But if it does
					// (e.g., agent detected build failure independently), log and proceed as
					// a regular failure — the orchestrator-side verification below will not
					// run because the agent already reverted the merge commit.
					execLog("merge", sessionName, "merge failed — verification failed", {
						output: mergeResult.verification.output.slice(0, 200),
						baselineActive: !!baseline,
					});
					failedLane = lane.laneNumber;
					failureReason = `Post-merge verification failed in lane ${lane.laneNumber}: ` +
						mergeResult.verification.output.slice(0, 500);
					break;
			}

			// ── Orchestrator-side post-merge verification (TP-032) ──────
			// After a successful merge (SUCCESS/CONFLICT_RESOLVED), capture
			// post-merge fingerprints and diff against baseline. New failures
			// that weren't in the baseline block merge advancement.
			if (
				baseline !== null &&
				hasTestingCommands &&
				verificationEnabled &&
				failedLane === null &&
				(mergeResult.status === "SUCCESS" || mergeResult.status === "CONFLICT_RESOLVED")
			) {
				const verificationResult = runPostMergeVerification(
					testingCommands!,
					mergeWorkDir,
					baseline,
					lane.laneNumber,
					waveIndex,
					batchId,
					opId,
					sessionName,
					stateRoot ?? repoRoot,
					repoId,
					flakyReruns,
				);

				// Attach verification result to the lane result
				laneResult.verificationBaseline = verificationResult;

				if (verificationResult.classification === "verification_new_failure") {
					execLog("merge", sessionName, "orchestrator-side verification detected new failures", {
						newFailures: verificationResult.newFailureCount,
						preExisting: verificationResult.preExistingCount,
						summary: verificationResult.newFailureSummary.slice(0, 200),
					});

					// ── TP-032: Rollback merge commit on verification_new_failure ──
					// Reset the temp branch to pre-lane HEAD so the failed lane's
					// merge commit doesn't get included in branch advancement.
					// TP-032 R006-2: Mark lane as errored so it's excluded from success
					// counters and branch advancement (R006-3).
					laneResult.error = `verification_new_failure: ${verificationResult.newFailureCount} new failure(s)`;

					if (preLaneHead) {
						execLog("merge", sessionName, "rolling back temp branch to pre-lane HEAD", {
							preLaneHead: preLaneHead.slice(0, 8),
						});
						const resetResult = spawnSync("git", ["reset", "--hard", preLaneHead], { cwd: mergeWorkDir });
						if (resetResult.status === 0) {
							execLog("merge", sessionName, "temp branch rolled back successfully");
						} else {
							// TP-032 R006-2: Rollback failure is merge-fatal for this wave.
							// The temp branch still contains the failing merge commit — target
							// ref advancement MUST NOT proceed for ANY lane, because the temp
							// branch HEAD includes the unverified commit.
							const resetErr = resetResult.stderr?.toString().trim() || "unknown error";
							laneResult.error = `verification_new_failure: rollback reset failed (${resetErr}) — ` +
								`temp branch may contain failing merge commit, advancement blocked`;
							blockAdvancement = true;
							execLog("merge", sessionName, `CRITICAL: rollback reset failed: ${resetErr} — ALL branch advancement blocked`, {
								preLaneHead: preLaneHead.slice(0, 8),
							});
						}
					} else {
						// TP-032 R006-2: No pre-lane HEAD captured — cannot roll back.
						// Block advancement since the bad commit cannot be removed.
						laneResult.error = `verification_new_failure: no pre-lane HEAD available for rollback — ` +
							`advancement blocked`;
						blockAdvancement = true;
						execLog("merge", sessionName, "CRITICAL: no pre-lane HEAD — cannot roll back, ALL branch advancement blocked");
					}

					failedLane = lane.laneNumber;
					failureReason = `Verification baseline comparison detected ${verificationResult.newFailureCount} new failure(s) ` +
						`in lane ${lane.laneNumber} (${verificationResult.preExistingCount} pre-existing). ` +
						verificationResult.newFailureSummary.slice(0, 300);
				} else if (verificationResult.classification === "flaky_suspected") {
					execLog("merge", sessionName, "flaky test suspected — failures disappeared on re-run (warning only)", {
						newFailures: verificationResult.newFailureCount,
						flakyRerun: true,
					});
					// Warning only — does not block merge advancement
				} else {
					execLog("merge", sessionName, "orchestrator-side verification passed", {
						preExisting: verificationResult.preExistingCount,
						fixed: verificationResult.fixedCount,
					});
				}
			}

			// Stop merging if this lane failed
			if (failedLane !== null) break;

		} catch (err: unknown) {
			// Clean up request file on error
			try {
				if (existsSync(requestFilePath)) unlinkSync(requestFilePath);
			} catch {
				// Best effort
			}

			// Kill merge session if still alive
			if (tmuxHasSession(sessionName)) {
				tmuxKillSession(sessionName);
			}

			const errMsg = err instanceof Error ? err.message : String(err);
			const errCode = err instanceof MergeError ? err.code : "UNKNOWN";

			execLog("merge", sessionName, `merge error: ${errMsg}`, { code: errCode });

			laneResults.push({
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				sourceBranch: lane.branch,
				targetBranch,
				result: null,
				error: errMsg,
				durationMs: Date.now() - laneStart,
				repoId: lane.repoId,
			});

			failedLane = lane.laneNumber;
			failureReason = `Merge error in lane ${lane.laneNumber}: ${errMsg}`;
			break;
		}
	}

	// ── Stage workspace task artifacts into merge worktree ──────────
	// In workspace mode, workers write .DONE and STATUS.md to the canonical
	// task folder (e.g., shared-libs/task-management/...) which is the repo's
	// checked-out working tree (develop). These files need to be on the orch
	// branch, not develop. Copy them into the merge worktree (which is on the
	// orch branch's temp) and commit, so they're included in the update-ref.
	if (mergeWorkDir) {
		const statusResult = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf-8" });
		if (statusResult.status === 0 && statusResult.stdout) {
			const lines = statusResult.stdout.split("\n").filter((l: string) => l.trim());
			const artifactFiles = lines
				.map((l: string) => l.slice(3).trim())
				.filter((f: string) =>
					(f.endsWith(".DONE") || f.endsWith("STATUS.md")) &&
					!f.includes(".worktrees/"),  // Never stage worktree internals
				);

			if (artifactFiles.length > 0) {
				let staged = 0;
				for (const file of artifactFiles) {
					const srcPath = join(repoRoot, file);
					const destPath = join(mergeWorkDir, file);
					try {
						if (existsSync(srcPath)) {
							mkdirSync(dirname(destPath), { recursive: true });
							copyFileSync(srcPath, destPath);
							spawnSync("git", ["add", file], { cwd: mergeWorkDir });
							staged++;
						}
					} catch { /* best effort */ }
				}
				if (staged > 0) {
					spawnSync("git", ["commit", "-m", `checkpoint: wave ${waveIndex} task artifacts (.DONE, STATUS.md)`], { cwd: mergeWorkDir });
					execLog("merge", `W${waveIndex}`, `committed ${staged} task artifact(s) to merge worktree`);

					// Keep both .DONE and STATUS.md in develop's working tree:
					// - STATUS.md: dashboard reads current progress from canonical path
					// - .DONE: harmless untracked files, cleaned up by /orch-integrate stash
					// Previous approach of deleting .DONE caused them to be missing
					// after ff integration (git couldn't reliably restore them).
				}
			}
		}
	}

	// ── Update target branch ref and clean up merge worktree ────────
	// TP-032 R006-2: blockAdvancement overrides all success determination.
	// When verification rollback fails, the temp branch contains a bad merge commit
	// that would be included in branch advancement — so we block entirely.
	// Also exclude verification_new_failure lanes (with successful rollback) from
	// success accounting: they have laneResult.error set, so !r.error filters them.
	const anySuccess = !blockAdvancement && laneResults.some(
		r => !r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED"),
	);

	if (blockAdvancement) {
		execLog("merge", `W${waveIndex}`, "branch advancement BLOCKED due to verification rollback failure — " +
			"temp branch may contain unverified merge commit");
	}

	if (anySuccess) {
		// Get the temp branch HEAD commit — this is the merged result.
		const revParseResult = spawnSync("git", ["rev-parse", tempBranch], { cwd: repoRoot });

		if (revParseResult.status !== 0) {
			const err = revParseResult.stderr?.toString().trim() || "unknown error";
			execLog("merge", `W${waveIndex}`, `failed to resolve temp branch HEAD: ${err}`, { tempBranch });
			failedLane = failedLane ?? -1;
			failureReason = `Failed to resolve merge temp branch HEAD (${tempBranch}): ${err}`;
		} else {
			const tempBranchHead = revParseResult.stdout.toString().trim();

			// Gate advancement strategy:
			// - If targetBranch is NOT checked out in repoRoot, use update-ref
			//   (safe, does not touch the working tree). This is the common case
			//   for the orch branch in repo mode.
			// - If targetBranch IS checked out in repoRoot (workspace mode, where
			//   resolveBaseBranch returns the repo's current branch), use
			//   git merge --ff-only to advance HEAD+index+worktree together.
			const checkedOutBranch = getCurrentBranch(repoRoot);
			const targetIsCheckedOut = checkedOutBranch === targetBranch;

			if (targetIsCheckedOut) {
				// Checked-out branch — must use ff-only to keep HEAD/index/worktree in sync.
				// Dirty working tree may block ff — stash if needed.
				const ffResult = spawnSync("git", ["merge", "--ff-only", tempBranch], { cwd: repoRoot });

				if (ffResult.status !== 0) {
					// Dirty working tree may block ff — try stash + ff + pop
					execLog("merge", `W${waveIndex}`, "fast-forward blocked — stashing user changes");
					const stashMsg = `merge-agent-autostash-w${waveIndex}-${batchId}`;
					spawnSync("git", ["stash", "push", "--include-untracked", "-m", stashMsg], { cwd: repoRoot });

					const ffRetry = spawnSync("git", ["merge", "--ff-only", tempBranch], { cwd: repoRoot });

					// Always pop stash, regardless of ff result
					spawnSync("git", ["stash", "pop"], { cwd: repoRoot });

					if (ffRetry.status !== 0) {
						const err = ffRetry.stderr?.toString().trim() || "unknown error";
						execLog("merge", `W${waveIndex}`, `fast-forward failed even after stash: ${err}`);
						failedLane = failedLane ?? -1;
						failureReason = `Fast-forward of ${targetBranch} failed: ${err}`;
					} else {
						execLog("merge", `W${waveIndex}`, "fast-forward succeeded after stash/pop");
					}
				} else {
					execLog("merge", `W${waveIndex}`, `fast-forwarded ${targetBranch} to merge result`);
				}
			} else {
				// Not checked out — safe to use update-ref without touching the worktree.
				// Use compare-and-swap (3-arg form) to guard against concurrent branch movement.
				const oldRefResult = spawnSync("git", ["rev-parse", `refs/heads/${targetBranch}`], { cwd: repoRoot });
				const oldRef = oldRefResult.status === 0 ? oldRefResult.stdout.toString().trim() : "";

				const updateRefArgs = oldRef
					? ["update-ref", `refs/heads/${targetBranch}`, tempBranchHead, oldRef]
					: ["update-ref", `refs/heads/${targetBranch}`, tempBranchHead];

				const updateRefResult = spawnSync("git", updateRefArgs, { cwd: repoRoot });

				if (updateRefResult.status !== 0) {
					const err = updateRefResult.stderr?.toString().trim() || "unknown error";
					execLog("merge", `W${waveIndex}`, `update-ref failed for ${targetBranch}: ${err}`, {
						targetBranch,
						tempBranchHead: tempBranchHead.slice(0, 8),
					});
					failedLane = failedLane ?? -1;
					failureReason = `update-ref of ${targetBranch} to ${tempBranchHead.slice(0, 8)} failed: ${err}`;
				} else {
					execLog("merge", `W${waveIndex}`, `updated ${targetBranch} ref to merge result`, {
						targetBranch,
						commit: tempBranchHead.slice(0, 8),
					});
				}
			}
		}
	}

	// Clean up merge worktree and temp branch (always, regardless of outcome).
	// TP-029: Apply forceRemoveMergeWorktree fallback so locked/corrupted
	// merge worktrees don't persist between attempts.
	forceRemoveMergeWorktree(mergeWorkDir, repoRoot, `W${waveIndex}`);
	try {
		// Small delay to ensure worktree lock is released
		sleepSync(500);
		spawnSync("git", ["branch", "-D", tempBranch], { cwd: repoRoot });
	} catch { /* best effort */ }

	// Determine overall status
	let status: MergeWaveResult["status"];
	if (failedLane === null) {
		status = "succeeded";
	} else if (anySuccess) {
		status = "partial";
	} else {
		status = "failed";
	}

	const totalDurationMs = Date.now() - startTime;

	execLog("merge", `W${waveIndex}`, `wave merge complete: ${status}`, {
		mergedLanes: laneResults.filter(r => !r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED")).length,
		failedLane: failedLane ?? 0,
		duration: `${Math.round(totalDurationMs / 1000)}s`,
	});

	return {
		waveIndex,
		status,
		laneResults,
		failedLane,
		failureReason,
		totalDurationMs,
	};
}


// ── Repo-Scoped Merge ────────────────────────────────────────────────

/**
 * Group mergeable lanes by their `repoId`.
 *
 * Returns groups sorted deterministically by repoId (undefined/repo-mode
 * group sorts first as empty string). Lanes within each group preserve
 * the input order.
 *
 * @param lanes - Lanes to group (already filtered for mergeability)
 * @returns Array of { repoId, lanes } groups in deterministic order
 */
export function groupLanesByRepo(
	lanes: AllocatedLane[],
): Array<{ repoId: string | undefined; lanes: AllocatedLane[] }> {
	const groupMap = new Map<string, AllocatedLane[]>();

	for (const lane of lanes) {
		const key = lane.repoId ?? "";
		const existing = groupMap.get(key) || [];
		existing.push(lane);
		groupMap.set(key, existing);
	}

	const sortedKeys = [...groupMap.keys()].sort();
	return sortedKeys.map(key => ({
		repoId: key || undefined,
		lanes: groupMap.get(key)!,
	}));
}

/**
 * Merge a wave's lanes partitioned by repository.
 *
 * In repo mode (all lanes have repoId=undefined), this produces a single
 * repo group and delegates to `mergeWave()` exactly once — a no-op
 * regression case that preserves existing behavior.
 *
 * In workspace mode, lanes are grouped by `repoId`. Each repo group gets:
 * - Its own repo root (via `resolveRepoRoot()`)
 * - Its own base branch (via `resolveBaseBranch()`)
 * - An independent `mergeWave()` call with those repo-scoped parameters
 *
 * Repo groups are processed in deterministic order (sorted by repoId).
 * Per-repo results are aggregated into a single `MergeWaveResult` for
 * the existing wave-level failure policy handling in `engine.ts`.
 *
 * Failure semantics:
 * - A failure in one repo does NOT stop merging in other repos.
 * - The aggregate status is "succeeded" only if all repos succeeded.
 * - If any repo failed and any succeeded, status is "partial".
 * - `repoResults` field carries per-repo attribution for downstream
 *   reporting (Step 1 will use this for explicit partial-success summaries).
 *
 * @param completedLanes   - Lanes that completed execution (from wave result)
 * @param waveResult       - The wave execution result (for lane status filtering)
 * @param waveIndex        - Wave number (1-indexed)
 * @param config           - Orchestrator configuration
 * @param repoRoot         - Default repository root (used in repo mode)
 * @param batchId          - Batch ID for session naming
 * @param baseBranch       - Default branch to merge into (captured at batch start)
 * @param workspaceConfig  - Workspace configuration (null in repo mode)
 * @returns MergeWaveResult with per-lane and per-repo outcomes
 */
export function mergeWaveByRepo(
	completedLanes: AllocatedLane[],
	waveResult: WaveExecutionResult,
	waveIndex: number,
	config: OrchestratorConfig,
	repoRoot: string,
	batchId: string,
	baseBranch: string,
	workspaceConfig?: WorkspaceConfig | null,
	stateRoot?: string,
	agentRoot?: string,
	testingCommands?: Record<string, string>,
): MergeWaveResult {
	const startTime = Date.now();

	// Build lane outcome lookup for merge eligibility (same logic as mergeWave).
	const laneOutcomeByNumber = new Map<number, LaneExecutionResult>();
	for (const laneOutcome of waveResult.laneResults) {
		laneOutcomeByNumber.set(laneOutcome.laneNumber, laneOutcome);
	}

	// Filter to mergeable lanes (same criteria as mergeWave).
	const mergeableLanes = completedLanes.filter(lane => {
		const outcome = laneOutcomeByNumber.get(lane.laneNumber);
		if (!outcome) return false;
		const hasSucceeded = outcome.tasks.some(t => t.status === "succeeded");
		const hasHardFailure = outcome.tasks.some(
			t => t.status === "failed" || t.status === "stalled",
		);
		return hasSucceeded && !hasHardFailure;
	});

	if (mergeableLanes.length === 0) {
		execLog("merge", `W${waveIndex}`, "no mergeable lanes (all failed or empty)");
		return {
			waveIndex,
			status: "succeeded",
			laneResults: [],
			failedLane: null,
			failureReason: null,
			totalDurationMs: Date.now() - startTime,
			repoResults: [],
		};
	}

	// Group lanes by repo
	const repoGroups = groupLanesByRepo(mergeableLanes);

	execLog("merge", `W${waveIndex}`, `merging across ${repoGroups.length} repo group(s)`, {
		repos: repoGroups.map(g => g.repoId ?? "(default)").join(", "),
		totalLanes: mergeableLanes.length,
	});

	// In repo mode (single group with repoId=undefined), delegate directly
	// to mergeWave() for zero-overhead backward compatibility.
	if (repoGroups.length === 1 && repoGroups[0].repoId === undefined) {
		const result = mergeWave(
			completedLanes,
			waveResult,
			waveIndex,
			config,
			repoRoot,
			batchId,
			baseBranch,
			stateRoot,
			agentRoot,
			testingCommands,
		);
		// Attach empty repoResults for consistent shape
		return { ...result, repoResults: [] };
	}

	// ── Workspace mode: per-repo merge loops ─────────────────────
	const allLaneResults: MergeLaneResult[] = [];
	const repoOutcomes: RepoMergeOutcome[] = [];
	let firstFailedLane: number | null = null;
	let firstFailureReason: string | null = null;
	// Track repo-level failures independently of lane-level failures.
	// mergeWave() can return status="failed" with failedLane=null for
	// pre-lane setup errors (temp branch creation, worktree creation).
	// We must detect these to avoid misclassifying the aggregate as "succeeded".
	let anyRepoFailed = false;

	for (const group of repoGroups) {
		const groupRepoRoot = resolveRepoRoot(group.repoId, repoRoot, workspaceConfig);
		// In workspace mode with orch branch, always merge into the orch branch
		// (passed as baseBranch from engine.ts). Do NOT use resolveBaseBranch()
		// which returns the repo's current branch (e.g., develop), bypassing
		// the orch branch model entirely.
		const groupBaseBranch = baseBranch;

		execLog("merge", `W${waveIndex}`, `merging repo group: ${group.repoId ?? "(default)"}`, {
			repoRoot: groupRepoRoot,
			baseBranch: groupBaseBranch,
			laneCount: group.lanes.length,
			lanes: group.lanes.map(l => l.laneNumber).join(","),
		});

		// Build a filtered WaveExecutionResult containing only this group's lanes.
		const groupLaneNumbers = new Set(group.lanes.map(l => l.laneNumber));
		const filteredWaveResult: WaveExecutionResult = {
			...waveResult,
			laneResults: waveResult.laneResults.filter(lr => groupLaneNumbers.has(lr.laneNumber)),
			allocatedLanes: waveResult.allocatedLanes.filter(l => groupLaneNumbers.has(l.laneNumber)),
		};

		const groupResult = mergeWave(
			group.lanes,
			filteredWaveResult,
			waveIndex,
			config,
			groupRepoRoot,
			batchId,
			groupBaseBranch,
			stateRoot,
			agentRoot,
			testingCommands,
			group.repoId,
		);

		// Accumulate lane results
		allLaneResults.push(...groupResult.laneResults);

		// Build per-repo outcome
		const repoOutcome: RepoMergeOutcome = {
			repoId: group.repoId,
			status: groupResult.status,
			laneResults: groupResult.laneResults,
			failedLane: groupResult.failedLane,
			failureReason: groupResult.failureReason,
		};
		repoOutcomes.push(repoOutcome);

		// Track failures across repos (but continue to merge other repos).
		// Check groupResult.status (not just failedLane) to catch setup failures
		// where mergeWave() returns status="failed" with failedLane=null
		// (e.g., temp branch creation or worktree creation failure).
		if (groupResult.status !== "succeeded") {
			anyRepoFailed = true;

			if (firstFailureReason === null) {
				firstFailedLane = groupResult.failedLane;
				firstFailureReason = groupResult.failureReason
					? `[repo:${group.repoId ?? "default"}] ${groupResult.failureReason}`
					: `[repo:${group.repoId ?? "default"}] Merge failed (setup error)`;
			}
		}
	}

	// ── Aggregate status ─────────────────────────────────────────
	// Use both lane-level and repo-level evidence for correct classification:
	// - anyLaneSucceeded: at least one lane merged successfully across all repos
	// - anyRepoFailed: at least one repo had a non-succeeded status (includes
	//   both lane-level failures AND repo setup failures with failedLane=null)
	// TP-032 R006-3: Exclude verification_new_failure lanes from success determination
	const anyLaneSucceeded = allLaneResults.some(
		r => !r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED"),
	);

	let status: MergeWaveResult["status"];
	if (!anyRepoFailed) {
		status = "succeeded";
	} else if (anyLaneSucceeded) {
		status = "partial";
	} else {
		status = "failed";
	}

	const totalDurationMs = Date.now() - startTime;

	execLog("merge", `W${waveIndex}`, `repo-scoped wave merge complete: ${status}`, {
		repoCount: repoOutcomes.length,
		repoStatuses: repoOutcomes.map(r => `${r.repoId ?? "default"}:${r.status}`).join(", "),
		mergedLanes: allLaneResults.filter(r => !r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED")).length,
		duration: `${Math.round(totalDurationMs / 1000)}s`,
	});

	return {
		waveIndex,
		status,
		laneResults: allLaneResults,
		failedLane: firstFailedLane,
		failureReason: firstFailureReason,
		totalDurationMs,
		repoResults: repoOutcomes,
	};
}

// ── Auto-Integration ─────────────────────────────────────────────────

/**
 * Attempt to fast-forward baseBranch to orchBranch in the main repo.
 *
 * Shared by engine.ts (fresh batch) and resume.ts (resumed batch).
 * The `logCategory` parameter distinguishes the calling context in execLog.
 *
 * Failure matrix — all failures are warnings, never batch-fatal:
 * - **Diverged**: baseBranch has commits not in orchBranch (not fast-forwardable)
 * - **Detached HEAD / missing base**: baseBranch not resolvable
 * - **Dirty worktree**: baseBranch is checked out with uncommitted changes
 * - **Branch not checked out**: baseBranch is not the current branch;
 *   use update-ref (no worktree impact) with compare-and-swap
 *
 * @param orchBranch  - The orch branch to integrate from
 * @param baseBranch  - The user's branch to advance
 * @param repoRoot    - Absolute path to the primary repo root
 * @param batchId     - Batch identifier for logging
 * @param logCategory - execLog category ("batch" for engine, "resume" for resume)
 * @param onNotify    - Notification callback
 * @returns true if integration succeeded, false otherwise
 */
export function attemptAutoIntegration(
	orchBranch: string,
	baseBranch: string,
	repoRoot: string,
	batchId: string,
	logCategory: string,
	onNotify: (message: string, level: "info" | "warning" | "error") => void,
): boolean {
	// 1. Verify orchBranch exists
	const orchExists = runGit(["rev-parse", "--verify", `refs/heads/${orchBranch}`], repoRoot);
	if (!orchExists.ok) {
		const reason = `orch branch '${orchBranch}' not found`;
		execLog(logCategory, batchId, `auto-integration skipped: ${reason}`);
		onNotify(ORCH_MESSAGES.orchIntegrationAutoFailed(orchBranch, baseBranch, reason), "warning");
		return false;
	}

	// 2. Verify baseBranch exists
	const baseExists = runGit(["rev-parse", "--verify", `refs/heads/${baseBranch}`], repoRoot);
	if (!baseExists.ok) {
		const reason = `base branch '${baseBranch}' not found`;
		execLog(logCategory, batchId, `auto-integration skipped: ${reason}`);
		onNotify(ORCH_MESSAGES.orchIntegrationAutoFailed(orchBranch, baseBranch, reason), "warning");
		return false;
	}

	// 3. Check fast-forwardability: baseBranch must be an ancestor of orchBranch
	const isAncestor = runGit(["merge-base", "--is-ancestor", baseBranch, orchBranch], repoRoot);
	if (!isAncestor.ok) {
		const reason = `branches have diverged (${baseBranch} is not an ancestor of ${orchBranch})`;
		execLog(logCategory, batchId, `auto-integration skipped: ${reason}`);
		onNotify(ORCH_MESSAGES.orchIntegrationAutoFailed(orchBranch, baseBranch, reason), "warning");
		return false;
	}

	// 4. Gate on whether baseBranch is checked out (same pattern as merge advancement)
	const checkedOutBranch = getCurrentBranch(repoRoot);
	const baseIsCheckedOut = checkedOutBranch === baseBranch;

	const orchHead = runGit(["rev-parse", orchBranch], repoRoot).stdout.trim();

	if (baseIsCheckedOut) {
		// baseBranch is checked out — use merge --ff-only (updates worktree)
		// Check for dirty worktree first
		const statusCheck = runGit(["status", "--porcelain"], repoRoot);
		if (statusCheck.ok && statusCheck.stdout.trim()) {
			const reason = `working tree is dirty (${baseBranch} is checked out with uncommitted changes)`;
			execLog(logCategory, batchId, `auto-integration skipped: ${reason}`);
			onNotify(ORCH_MESSAGES.orchIntegrationAutoFailed(orchBranch, baseBranch, reason), "warning");
			return false;
		}

		const ffResult = runGit(["merge", "--ff-only", orchBranch], repoRoot);
		if (!ffResult.ok) {
			const reason = `fast-forward failed: ${ffResult.stderr || ffResult.stdout || "unknown"}`;
			execLog(logCategory, batchId, `auto-integration failed: ${reason}`);
			onNotify(ORCH_MESSAGES.orchIntegrationAutoFailed(orchBranch, baseBranch, reason), "warning");
			return false;
		}
	} else {
		// baseBranch is NOT checked out — use update-ref with compare-and-swap
		const baseOldRef = runGit(["rev-parse", baseBranch], repoRoot).stdout.trim();
		const updateResult = runGit(
			["update-ref", `refs/heads/${baseBranch}`, orchHead, baseOldRef],
			repoRoot,
		);
		if (!updateResult.ok) {
			const reason = `update-ref failed: ${updateResult.stderr || updateResult.stdout || "unknown"}`;
			execLog(logCategory, batchId, `auto-integration failed: ${reason}`);
			onNotify(ORCH_MESSAGES.orchIntegrationAutoFailed(orchBranch, baseBranch, reason), "warning");
			return false;
		}
	}

	execLog(logCategory, batchId, `auto-integrated: ${baseBranch} advanced to ${orchBranch}`, { orchHead });
	onNotify(ORCH_MESSAGES.orchIntegrationAutoSuccess(orchBranch, baseBranch), "info");
	return true;
}

