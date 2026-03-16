/**
 * Merge orchestration, merge agents, merge worktree
 * @module orch/merge
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";

import { buildLaneEnvVars, buildTmuxSpawnArgs, execLog, tmuxHasSession, tmuxKillSession, toTmuxPath } from "./execution.ts";
import { resolveOperatorId } from "./naming.ts";
import { MERGE_POLL_INTERVAL_MS, MERGE_RESULT_GRACE_MS, MERGE_RESULT_READ_RETRIES, MERGE_RESULT_READ_RETRY_DELAY_MS, MERGE_SPAWN_RETRY_MAX, MERGE_TIMEOUT_MS, MergeError, VALID_MERGE_STATUSES } from "./types.ts";
import type { AllocatedLane, LaneExecutionResult, MergeLaneResult, MergeResult, MergeResultStatus, MergeWaveResult, OrchestratorConfig, RepoMergeOutcome, WaveExecutionResult, WorkspaceConfig } from "./types.ts";
import { resolveBaseBranch, resolveRepoRoot } from "./waves.ts";
import { sleepSync } from "./worktree.ts";

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
 * @throws MergeError if spawn fails after retries
 */
export function spawnMergeAgent(
	sessionName: string,
	repoRoot: string,
	mergeWorkDir: string,
	mergeRequestPath: string,
	config: OrchestratorConfig,
	stateRoot?: string,
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
		`--append-system-prompt ${shellQuote(join(stateRoot ?? repoRoot, ".pi", "agents", "task-merger.md"))}`,
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
	// Include opId to prevent collisions between concurrent operators.
	const tempBranch = `_merge-temp-${opId}-${batchId}`;
	const mergeWorkDir = join(repoRoot, ".worktrees", `merge-workspace-${opId}`);

	// Clean up stale merge worktree/branch from prior failed attempt
	try {
		if (existsSync(mergeWorkDir)) {
			spawnSync("git", ["worktree", "remove", mergeWorkDir, "--force"], { cwd: repoRoot });
			sleepSync(500);
		}
	} catch { /* best effort */ }
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

	// Sequential merge loop
	let failedLane: number | null = null;
	let failureReason: string | null = null;

	for (const lane of orderedLanes) {
		const laneStart = Date.now();
		const sessionName = `${tmuxPrefix}-${opId}-merge-${lane.laneNumber}`;
		const resultFileName = `merge-result-w${waveIndex}-lane${lane.laneNumber}-${opId}-${batchId}.json`;
		const piDir = stateRoot ?? repoRoot;
		const resultFilePath = join(piDir, ".pi", resultFileName);
		const requestFileName = `merge-request-w${waveIndex}-lane${lane.laneNumber}-${opId}-${batchId}.txt`;
		const requestFilePath = join(piDir, ".pi", requestFileName);

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
			spawnMergeAgent(sessionName, repoRoot, mergeWorkDir, requestFilePath, config, stateRoot);

			// Wait for result
			const mergeResult = waitForMergeResult(resultFilePath, sessionName);

			// Clean up request file (leave result file for debugging)
			try {
				unlinkSync(requestFilePath);
			} catch {
				// Best effort
			}

			// Record lane result
			laneResults.push({
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				sourceBranch: lane.branch,
				targetBranch,
				result: mergeResult,
				error: null,
				durationMs: Date.now() - laneStart,
				repoId: lane.repoId,
			});

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
					execLog("merge", sessionName, "merge failed — verification failed", {
						output: mergeResult.verification.output.slice(0, 200),
					});
					failedLane = lane.laneNumber;
					failureReason = `Post-merge verification failed in lane ${lane.laneNumber}: ` +
						mergeResult.verification.output.slice(0, 500);
					break;
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

	// ── Fast-forward develop and clean up merge worktree ────────────
	const anySuccess = laneResults.some(
		r => r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED",
	);

	if (anySuccess) {
		// Fast-forward the real target branch to the temp merge branch.
		// The main repo may have dirty files (user edits) — stash if needed.
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
	}

	// Clean up merge worktree and temp branch (always, regardless of outcome)
	try {
		spawnSync("git", ["worktree", "remove", mergeWorkDir, "--force"], { cwd: repoRoot });
	} catch { /* best effort */ }
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
		mergedLanes: laneResults.filter(r => r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED").length,
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
		const groupBaseBranch = resolveBaseBranch(group.repoId, groupRepoRoot, baseBranch, workspaceConfig);

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
	const anyLaneSucceeded = allLaneResults.some(
		r => r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED",
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
		mergedLanes: allLaneResults.filter(r => r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED").length,
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

