/**
 * Lane Runner — Headless per-lane execution for Runtime V2
 *
 * Replaces the legacy TMUX-backed lane execution path with a
 * deterministic Node process that owns:
 *   - worker iteration loops
 *   - STATUS.md progression
 *   - .DONE creation detection
 *   - reviewer orchestration (future)
 *   - lane snapshot emission
 *
 * No Pi extension dependency. No TMUX. No TASK_AUTOSTART.
 *
 * @module taskplane/lane-runner
 * @since TP-105
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from "fs";
import { join, dirname, resolve, basename } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

import {
	parsePromptMd,
	parseStatusMd,
	generateStatusMd,
	updateStatusField,
	updateStepStatus,
	logExecution,
	isStepComplete,
	type StepInfo,
	type CoreParsedTask,
} from "./task-executor-core.ts";

import {
	spawnAgent,
	buildWorkerToolsAllowlist,
	ENGINE_BRIDGE_TOOLS,
	type AgentHostOptions,
	type AgentHostResult,
} from "./agent-host.ts";
import { loadPiSettingsPackages, filterExcludedExtensions } from "./settings-loader.ts";

import { appendAgentEvent, writeLaneSnapshot } from "./process-registry.ts";

import {
	readOutbox,
	readInbox,
	ackMessage,
	sessionInboxDir,
	ackOutboxMessage,
	appendMailboxAuditEvent,
	drainAgentOutbox,
} from "./mailbox.ts";

import {
	resolvePacketPaths,
	buildRuntimeAgentId,
	runtimeAgentEventsPath,
	type ExecutionUnit,
	type RuntimeAgentId,
	type RuntimeLaneSnapshot,
	type RuntimeAgentTelemetrySnapshot,
	type RuntimeTaskProgress,
	type RuntimeAgentStatus,
	type PacketPaths,
	type LaneTaskOutcome,
	type LaneTaskStatus,
	type SupervisorAlertCallback,
	type StepSegmentMapping,
	type SegmentScopeMode,
	type RuntimeAgentEvent,
	type EngineEvent,
	type EngineEventType,
	type ReviewDisposition,
	type ReviewInterventionKind,
	type SupervisorAlert,
} from "./types.ts";
import type { TaskExitDiagnostic } from "./diagnostics.ts";
import {
	parseFindingCounts,
	computeFindingTrend,
	parseReviewLabelFromPath,
	advanceReviewStreak,
	reconstructReviewStreaks,
	freshReviewStreakState,
	shouldFireSpiral,
	shouldFireOrderViolation,
	sanitizeSpiralConfig,
	parseReviewVerdict,
	latestReviewFilesPerGate,
	type ReviewStreakState,
} from "./review-analysis.ts";
// NOTE: emitEngineEvent is NOT statically imported from ./persistence.ts.
// persistence.ts imports execLog from ./execution.ts, and execution.ts imports
// executeTaskV2 from this module — a static import here would form a
// lane-runner → persistence → execution → lane-runner cycle. Beyond being a
// smell, that eager cycle pre-binds execution's executeTaskV2 to the real
// export before tests can mock.module("lane-runner"), defeating the mock. The
// review-event bridge below loads emitEngineEvent lazily (cached) instead.
let cachedEmitEngineEvent: ((stateRoot: string, event: EngineEvent) => void) | null = null;

const LANE_RUNNER_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Interval (ms) for the live worker-outbox poll during a running worker
 * (mail-recognition fix). Surfaces reply/escalate mail to the supervisor
 * mid-run instead of only after the worker exits. 3s balances responsiveness
 * against fs churn; the post-exit final drain catches any last stragglers.
 */
const OUTBOX_LIVE_POLL_INTERVAL_MS = 3_000;

/**
 * #629: how many worker iterations the lane may spend REMEDIATING an
 * outstanding non-APPROVE review gate when all checkboxes are already
 * checked. Without this path, retry+resume after a finalize refusal never
 * spawns a worker (the loop breaks on "no remaining steps") and the gate
 * refuses again immediately — the alert's promised remedy was unreachable.
 * Bounded so an unresolvable REVISE cannot loop forever.
 */
const MAX_REVIEW_REMEDIATION_ITERATIONS = 2;

/** A review gate whose LATEST review file carries a non-APPROVE verdict. */
interface BlockingReviewGate {
	/** `{type}-step{N}` gate key */
	gate: string;
	/** Latest review filename for that gate */
	filename: string;
	verdict: "REVISE" | "RETHINK";
}

/**
 * Scan a reviews directory and return every gate whose latest review file
 * reads REVISE/RETHINK (#626 minimal finalize gate). Unreadable files are
 * never blockers; a scan failure yields an empty list (fail-safe for
 * finalization, which must not be corrupted by an fs hiccup).
 */
function findBlockingReviewGates(reviewsDir: string): BlockingReviewGate[] {
	const blocking: BlockingReviewGate[] = [];
	try {
		if (!existsSync(reviewsDir)) return blocking;
		const latest = latestReviewFilesPerGate(readdirSync(reviewsDir));
		for (const [gate, filename] of latest) {
			try {
				const verdict = parseReviewVerdict(readFileSync(join(reviewsDir, filename), "utf-8"));
				if (verdict === "REVISE" || verdict === "RETHINK") blocking.push({ gate, filename, verdict });
			} catch {
				/* unreadable review file — not a blocker */
			}
		}
	} catch {
		/* best effort */
	}
	return blocking;
}

/** `code-step4` → 4; null when the gate key has no step suffix. */
function parseGateStepNumber(gate: string): number | null {
	const m = /-step(\d+)$/i.exec(gate);
	return m ? Number(m[1]) : null;
}

function formatBlockingGates(gates: BlockingReviewGate[]): string {
	return gates.map((g) => `${g.gate} (${g.filename}: ${g.verdict})`).join("; ");
}

/** Default severity vocabulary when the reviewer config doesn't override it. */
const DEFAULT_SEVERITY_LABELS = ["critical", "important", "minor"];
/** Max recent dispositions retained per step for escalation context. */
const RECENT_DISPOSITIONS_CAP = 6;

/**
 * In-memory per-step review-boundary state = the shared streak model plus
 * live-only escalation cooldown bookkeeping.
 */
interface ReviewStepState extends ReviewStreakState {
	/** Round at which the spiral escalation last fired (for cooldown); null = never. */
	lastEscalationRound: number | null;
	/** Round at which an order-violation last escalated (for cooldown); null = never. */
	lastRefusedRound: number | null;
}

/**
 * Resume reconstruction: seed per-step review streak state by replaying a task's
 * prior review END boundaries from `.pi/supervisor/events.jsonl`. Best-effort
 * (an optimization, not correctness-critical): any read/parse failure leaves the
 * map empty and detection simply starts fresh. Escalation cooldown fields reset
 * to null so an ongoing spiral re-alerts the supervisor after resume.
 */
function seedReviewStateFromHistory(
	target: Map<string, ReviewStepState>,
	stateRoot: string,
	batchId: string,
	taskId: string,
	treatUnavailableAsNonApprove: boolean,
): void {
	try {
		const eventsPath = join(stateRoot, ".pi", "supervisor", "events.jsonl");
		if (!existsSync(eventsPath)) return;
		const raw = readFileSync(eventsPath, "utf-8");
		const events: Array<{
			reviewStep?: number;
			disposition?: string;
			findingCounts?: Record<string, number> | null;
		}> = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const e = JSON.parse(trimmed) as Record<string, unknown>;
				if (
					(e.type === "review_completed" || e.type === "review_failed") &&
					e.batchId === batchId &&
					e.taskId === taskId
				) {
					events.push({
						reviewStep: typeof e.reviewStep === "number" ? e.reviewStep : undefined,
						disposition: typeof e.disposition === "string" ? e.disposition : undefined,
						findingCounts:
							e.findingCounts && typeof e.findingCounts === "object"
								? (e.findingCounts as Record<string, number>)
								: null,
					});
				}
			} catch {
				/* skip malformed line */
			}
		}
		if (events.length === 0) return;
		const streaks = reconstructReviewStreaks(events, {
			treatUnavailableAsNonApprove,
			recentCap: RECENT_DISPOSITIONS_CAP,
		});
		for (const [stepStr, streak] of streaks) {
			target.set(`${taskId}:${stepStr}`, {
				...streak,
				lastEscalationRound: null,
				lastRefusedRound: null,
			});
		}
	} catch {
		/* best effort */
	}
}

// ── Segment Scoping Helpers (Phase A, TP-174) ────────────────────────

/**
 * Get the set of step numbers that have segments for a given repoId.
 *
 * Used to filter the "remaining steps" view so the worker only sees steps
 * that contain work for its repo.
 *
 * @param stepSegmentMap - Parsed step-segment mapping from PROMPT.md
 * @param repoId - Repo ID to filter by
 * @returns Set of step numbers that have at least one segment for this repoId
 * @since TP-174
 */
export function getStepsForRepoId(
	stepSegmentMap: StepSegmentMapping[],
	repoId: string,
): Set<number> {
	const stepNumbers = new Set<number>();
	for (const step of stepSegmentMap) {
		if (step.segments.some((seg) => seg.repoId === repoId)) {
			stepNumbers.add(step.stepNumber);
		}
	}
	return stepNumbers;
}

/**
 * Extract a segment's checkbox block from STATUS.md content for a given step and repoId.
 *
 * Looks for `#### Segment: <repoId>` headers within `### Step N:` sections,
 * then returns the checkbox lines belonging to that segment block.
 *
 * @param statusContent - Raw STATUS.md content
 * @param stepNumber - Step number to look in
 * @param repoId - Repo ID of the segment
 * @returns Object with checked/unchecked counts, or null if no segment block found
 * @since TP-174
 */
export function getSegmentCheckboxes(
	statusContent: string,
	stepNumber: number,
	repoId: string,
): { checked: number; unchecked: number; total: number; uncheckedTexts: string[] } | null {
	const text = statusContent.replace(/\r\n/g, "\n");

	// Find the step section
	const stepHeaderPattern = new RegExp(`^###\\s+Step\\s+${stepNumber}:`, "m");
	const stepMatch = text.match(stepHeaderPattern);
	if (!stepMatch || stepMatch.index === undefined) return null;

	// Find the end of this step section (next ### or end of file)
	const afterStep = text.slice(stepMatch.index + stepMatch[0].length);
	const nextStepMatch = afterStep.search(/^###\s+Step\s+\d+:/m);
	const stepContent = nextStepMatch !== -1 ? afterStep.slice(0, nextStepMatch) : afterStep;

	// Find the segment header within this step
	const segHeaderPattern = new RegExp(
		`^####\\s+Segment:\\s*${repoId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
		"m",
	);
	const segMatch = stepContent.match(segHeaderPattern);
	if (!segMatch || segMatch.index === undefined) return null;

	// Extract content from segment header to next #### header or ### header or ---
	const afterSeg = stepContent.slice(segMatch.index + segMatch[0].length);
	const nextSectionMatch = afterSeg.search(/^(?:####\s|###\s|---)/m);
	const segContent = nextSectionMatch !== -1 ? afterSeg.slice(0, nextSectionMatch) : afterSeg;

	// Count checkboxes
	let checked = 0;
	let unchecked = 0;
	const uncheckedTexts: string[] = [];
	const cbRegex = /^\s*-\s*\[([ xX])\]\s*(.*)/gm;
	let m: RegExpExecArray | null;
	while ((m = cbRegex.exec(segContent)) !== null) {
		if (m[1].toLowerCase() === "x") {
			checked++;
		} else {
			unchecked++;
			uncheckedTexts.push(m[2].trim());
		}
	}

	return { checked, unchecked, total: checked + unchecked, uncheckedTexts };
}

/**
 * Check if all checkboxes in a segment block are checked.
 *
 * @param statusContent - Raw STATUS.md content
 * @param stepNumber - Step number to check
 * @param repoId - Repo ID of the segment
 * @returns true when all checkboxes in the segment block are checked
 * @since TP-174
 */
export function isSegmentComplete(
	statusContent: string,
	stepNumber: number,
	repoId: string,
): boolean {
	const result = getSegmentCheckboxes(statusContent, stepNumber, repoId);
	if (!result) return false;
	if (result.total === 0) return false;
	return result.unchecked === 0;
}

/**
 * Compute the authoritative `SegmentScopeMode` for one worker iteration.
 *
 * This is the single source of truth for the FULL_TASK vs SEGMENT_SCOPED
 * decision (TP-196 / #502). All segment-related side-effects (env vars,
 * system-prompt overlay, prompt content, tool registration) should derive
 * their behaviour from this mode rather than re-evaluating the underlying
 * boolean conditions in isolation, which is what created the drift risk
 * documented in #502.
 *
 * Returns `SEGMENT_SCOPED` iff ALL of the following hold:
 *  - The task has a non-empty `stepSegmentMap` (parsed from PROMPT.md markers).
 *  - The lane has an associated `currentRepoId` (segmentId set, so we know
 *    which repo this lane is iterating).
 *  - The (legacy-fallback-filtered) `repoStepNumbers` set is non-null (the
 *    repo has at least one step with explicit segment markers).
 *  - A `currentStepNumber` is provided (there is a step to evaluate).
 *  - The current step's segment mapping contains an entry for `currentRepoId`
 *    (the worker actually has segment-scoped work in the current step).
 *
 * In any other case the mode is `FULL_TASK`.
 *
 * @since TP-196
 */
export function computeSegmentScopeMode(
	stepSegmentMap: StepSegmentMapping[] | undefined | null,
	repoStepNumbers: Set<number> | null,
	currentRepoId: string | null,
	currentStepNumber: number | null,
): SegmentScopeMode {
	if (!stepSegmentMap || !currentRepoId || !repoStepNumbers) return "FULL_TASK";
	if (currentStepNumber === null) return "FULL_TASK";
	const currentStepMapping = stepSegmentMap.find((s) => s.stepNumber === currentStepNumber);
	if (!currentStepMapping) return "FULL_TASK";
	const mySegment = currentStepMapping.segments.find((seg) => seg.repoId === currentRepoId);
	return mySegment ? "SEGMENT_SCOPED" : "FULL_TASK";
}

/**
 * Pre-spawn segment-completion check (TP-196 / #508).
 *
 * Returns `true` when the lane-runner iteration loop should SKIP spawning
 * a worker because all of the segment's checkboxes for this repo are
 * already complete. The lane should `break` out of its iteration loop and
 * fall through to post-loop completion handling.
 *
 * Contract:
 *  - Returns `false` for FULL_TASK iterations (`currentRepoId === null` or
 *    `repoStepNumbers === null` or empty). Those rely on the existing
 *    `remainingSteps.length === 0` exit, not this check.
 *  - Returns `true` iff EVERY step in `repoStepNumbers` is
 *    `isSegmentComplete(statusContent, stepNum, currentRepoId)`.
 *
 * Pure function: no filesystem access, no global state. The caller reads
 * the STATUS.md content once per iteration and passes it in.
 *
 * @since TP-196
 */
export function shouldSkipSpawnForCompleteSegment(
	statusContent: string,
	repoStepNumbers: Set<number> | null,
	currentRepoId: string | null,
): boolean {
	if (!repoStepNumbers || !currentRepoId || repoStepNumbers.size === 0) return false;
	return [...repoStepNumbers].every((stepNum) =>
		isSegmentComplete(statusContent, stepNum, currentRepoId),
	);
}

// ── Types ────────────────────────────────────────────────────────────

/**
 * Configuration for a lane-runner execution.
 *
 * @since TP-105
 */
export interface LaneRunnerConfig {
	/** Batch ID */
	batchId: string;
	/** Operator prefix for agent IDs (e.g., "orch-henrylach") */
	agentIdPrefix: string;
	/** Lane number (1-indexed) */
	laneNumber: number;
	/** Absolute path to the lane worktree */
	worktreePath: string;
	/** Git branch checked out in the worktree */
	branch: string;
	/** Repo ID */
	repoId: string;
	/** State root for runtime artifacts (workspace root or repo root) */
	stateRoot: string;
	/** Worker model (empty string = inherit from session) */
	workerModel: string;
	/** Worker tools */
	workerTools: string;
	/** Worker thinking mode */
	workerThinking: string;
	/** Worker system prompt (full-task mode) */
	workerSystemPrompt: string;
	/** Worker system prompt for segment-scoped mode (appended to base) */
	workerSegmentPrompt: string;
	/**
	 * Reviewer model (empty string = inherit session default).
	 * Set from TASKPLANE_REVIEWER_MODEL env var, sourced from runnerConfig.reviewer.model.
	 * @since TP-160
	 */
	reviewerModel: string;
	/**
	 * Reviewer thinking mode (empty string = inherit).
	 * @since TP-160
	 */
	reviewerThinking: string;
	/**
	 * Reviewer tool allowlist (comma-separated).
	 * @since TP-160
	 */
	reviewerTools: string;
	/**
	 * Ordered severity vocabulary for review finding-count analysis (review-boundary
	 * notifications). Undefined → lane-runner default (critical/important/minor).
	 */
	reviewSeverityLabels?: string[];
	/** Revision-spiral detection tuning. Undefined → lane-runner defaults. */
	reviewSpiral?: import("./config-schema.ts").ReviewSpiralConfig;
	/** Supervisor autonomy level for bridge-tool guards. */
	supervisorAutonomy?: "interactive" | "supervised" | "autonomous";
	/** Project name (for review request context) */
	projectName?: string;
	/** Package specifiers to exclude from worker extension forwarding (exact match). @since TP-180 */
	workerExcludeExtensions?: string[];
	/** Package specifiers to exclude from reviewer extension forwarding (exact match). @since TP-180 */
	reviewerExcludeExtensions?: string[];
	/** Max worker iterations before giving up */
	maxIterations: number;
	/** No-progress stall limit */
	noProgressLimit: number;
	/** Max worker time in minutes per iteration */
	maxWorkerMinutes: number;
	/** Context pressure warn threshold (0-100) */
	warnPercent: number;
	/** Context pressure kill threshold (0-100) */
	killPercent: number;
	/** Optional callback for surfacing runtime mailbox replies/escalations to supervisor */
	onSupervisorAlert?: SupervisorAlertCallback;
	/**
	 * Optional callback fired when the lane reaches a terminal state (no-progress
	 * kill or hard-fail). The supervisor process uses this to suppress any
	 * subsequent zombie alerts queued for the now-dead lane.
	 *
	 * @since TP-187 (#538)
	 */
	onLaneTerminated?: (info: import("./types.ts").LaneTerminatedInfo) => void;
}

/**
 * Result of executing one task through the lane-runner.
 *
 * @since TP-105
 */
export interface LaneRunnerTaskResult {
	/** Standard lane task outcome compatible with the engine */
	outcome: LaneTaskOutcome;
	/** Total worker iterations consumed */
	iterations: number;
	/** Cumulative worker cost in USD */
	costUsd: number;
	/** Total tokens used */
	totalTokens: number;
}

// ── Core Execution ───────────────────────────────────────────────────

/**
 * Execute a single task in a lane using the Runtime V2 headless backend.
 *
 * This is the core function that replaces the legacy TMUX-backed
 * `executeLane()` → `spawnLaneSession()` → `task-runner TASK_AUTOSTART`
 * path with direct child-process hosting.
 *
 * Execution loop:
 *   1. Parse task and ensure STATUS.md exists
 *   2. For each iteration:
 *      a. Determine remaining steps
 *      b. Spawn worker agent via agent-host
 *      c. Wait for worker to exit
 *      d. Check progress (checkboxes)
 *      e. If all steps complete → success
 *      f. If no progress → increment stall counter
 *      g. If stall limit or iteration limit hit → fail
 *   3. If all steps complete, check for .DONE
 *   4. Return LaneTaskOutcome
 *
 * @since TP-105
 */
export async function executeTaskV2(
	unit: ExecutionUnit,
	config: LaneRunnerConfig,
	pauseSignal: { paused: boolean },
): Promise<LaneRunnerTaskResult> {
	const startTime = Date.now();
	const statusPath = unit.packet.statusPath;
	const donePath = unit.packet.donePath;
	const promptPath = unit.packet.promptPath;
	const taskFolder = unit.packet.taskFolder;
	const reviewerStatePath = join(taskFolder, ".reviewer-state.json");
	const taskId = unit.taskId;
	const segmentId = unit.segmentId;
	const workerAgentId = buildRuntimeAgentId(config.agentIdPrefix, config.laneNumber, "worker");

	// ── Live outbox surfacing (mail-recognition fix) ─────────────────
	// Worker reply/escalate mail (notify_supervisor / escalate_to_supervisor
	// → *.msg.json) must reach the supervisor WHILE the worker is still
	// running — e.g. a worker asking for help to break a review spiral. The
	// original code only read the outbox AFTER the worker subprocess exited
	// (post-exit block below), so mid-run mail sat unread until exit and the
	// supervisor "woke up" too late. This helper surfaces + acks each pending
	// reply/escalate message; it runs on a live timer during the worker run
	// (see the interval around `await spawned.promise`) AND once more after
	// exit as a final drain. Acking (ackOutboxMessage) moves each message to
	// processed/, so the live timer and the post-exit drain never
	// double-surface the same message. Re-entrancy guarded so a slow cycle
	// can't overlap the next tick.
	let outboxDraining = false;
	const drainAndSurfaceOutbox = (): void => {
		if (outboxDraining) return;
		outboxDraining = true;
		try {
			const outboxMessages = readOutbox(config.stateRoot, config.batchId, workerAgentId);
			for (const msg of outboxMessages) {
				const sanitized = msg.content.replace(/\r?\n/g, " / ").slice(0, 200);
				logExecution(statusPath, `Agent ${msg.type}`, sanitized);

				if (msg.type === "reply" || msg.type === "escalate") {
					appendAgentEvent(config.stateRoot, config.batchId, workerAgentId, {
						batchId: config.batchId,
						agentId: workerAgentId,
						role: "worker",
						laneNumber: config.laneNumber,
						taskId,
						repoId: config.repoId,
						ts: Date.now(),
						type: msg.type === "reply" ? "reply_sent" : "escalation_sent",
						payload: {
							messageId: msg.id,
							replyTo: msg.replyTo ?? null,
							content: sanitized,
						},
					});

					appendMailboxAuditEvent(config.stateRoot, config.batchId, {
						type: msg.type === "reply" ? "message_replied" : "message_escalated",
						from: workerAgentId,
						to: "supervisor",
						messageId: msg.id,
						messageType: msg.type,
						contentPreview: sanitized,
					});

					if (config.onSupervisorAlert) {
						const isEscalation = msg.type === "escalate";
						try {
							config.onSupervisorAlert({
								category: "agent-message",
								summary:
									`${isEscalation ? "\uD83D\uDEA8" : "\uD83D\uDCE8"} Agent ${isEscalation ? "escalation" : "reply"} from ${workerAgentId}\n` +
									`  Task: ${taskId}\n` +
									`  Lane: lane-${config.laneNumber}\n` +
									`  Message: ${sanitized}`,
								context: {
									taskId,
									laneId: `lane-${config.laneNumber}`,
									laneNumber: config.laneNumber,
									agentId: workerAgentId,
									messageId: msg.id,
									exitReason: `${isEscalation ? "agent_escalation" : "agent_reply"}: ${sanitized}`,
								},
							});
						} catch {
							/* best effort */
						}
					}
				}

				// Consume outbox message to prevent duplicate processing by the
				// next live tick or the post-exit final drain.
				ackOutboxMessage(config.stateRoot, config.batchId, workerAgentId, msg.id);
			}
		} catch {
			/* best effort */
		} finally {
			outboxDraining = false;
		}
	};

	// ── Review-boundary bridge + spiral detection (supervisor notifications) ──
	// agent-host emits per-agent RuntimeAgentEvents review_requested /
	// review_completed / review_failed as the worker calls the review_step tool.
	// This handler: (1) bridges every boundary to the supervisor's live
	// events.jsonl stream (emitEngineEvent) enriched with finding counts + trend
	// + round, so the supervisor adjudicates each review case-by-case; and
	// (2) tracks per-step spiral state and fires an actionable escalation
	// (review-intervention-needed) when a step's reviews circle without
	// converging, or when the worker trips the order-of-operations guard (REFUSED).
	const reviewSeverityLabels =
		config.reviewSeverityLabels && config.reviewSeverityLabels.length > 0
			? config.reviewSeverityLabels
			: DEFAULT_SEVERITY_LABELS;
	// Sanitize (clamp threshold/cooldown >= 1, coerce booleans) so malformed
	// config threaded via env can't cause escalate-every-review or nag-every-round.
	// NOTE: `enabled` is the master switch for BOTH spiral and order-violation
	// STEER escalations. When disabled, REFUSED/spiral still appear as ordinary
	// per-boundary notifications (formatEventNotification) — just not as urgent
	// steer interrupts.
	const spiralCfg = sanitizeSpiralConfig(config.reviewSpiral);
	const reviewStateByStep = new Map<string, ReviewStepState>();
	// Resume reconstruction ("maintain the truth"): rebuild per-step streak state
	// by replaying this task's prior review boundaries from events.jsonl, so a
	// spiral in progress before a pause/resume isn't silently reset to zero.
	seedReviewStateFromHistory(
		reviewStateByStep,
		config.stateRoot,
		config.batchId,
		taskId,
		spiralCfg.treatUnavailableAsNonApprove,
	);
	const getReviewState = (stepKey: string): ReviewStepState => {
		let st = reviewStateByStep.get(stepKey);
		if (!st) {
			st = { ...freshReviewStreakState(), lastEscalationRound: null, lastRefusedRound: null };
			reviewStateByStep.set(stepKey, st);
		}
		return st;
	};
	// Read + parse finding counts from the exact review file agent-host referenced.
	// Read the exact review file agent-host referenced (best-effort). Reused for
	// both the authoritative verdict (#624) and the severity finding counts.
	const readReviewFile = (reviewPath?: string): string | null => {
		if (!reviewPath) return null;
		try {
			const abs = join(unit.packet.reviewsDir, basename(reviewPath));
			if (!existsSync(abs)) return null;
			return readFileSync(abs, "utf-8");
		} catch {
			return null;
		}
	};
	// Fire an actionable review-intervention escalation. Delivery is set to steer
	// (urgent) by category in the IPC handler (extension.ts).
	const fireIntervention = (
		kind: ReviewInterventionKind,
		stepNum: number | undefined,
		reviewType: string | undefined,
		state: ReviewStepState,
		ev: EngineEvent,
	): void => {
		if (!config.onSupervisorAlert) return;
		const loc = `${taskId}${stepNum !== undefined ? ` step ${stepNum}` : ""} (lane ${config.laneNumber})`;
		const label = ev.reviewLabel ? ` [${ev.reviewLabel}]` : "";
		const countsStr = ev.findingCounts
			? Object.entries(ev.findingCounts)
					.map(([k, v]) => `${k}:${v}`)
					.join(" ")
			: "n/a";
		const summary =
			kind === "revision-spiral"
				? `🌀 **Review spiral** — ${loc}${label}: ${state.consecutiveNonApprove} consecutive ` +
					`non-approve reviews (latest ${ev.disposition ?? "?"}). Findings: ${countsStr}; ` +
					`severity trend ${ev.findingTrend ?? "?"}${ev.findingMixed ? " (mixed)" : ""}.\n` +
					`Adjudicate: steer the worker to a resolution — implement the remaining legitimate ` +
					`findings, or if the reviews are circling the same class, tell it to stop and log a blocker.`
				: `⛔ **Review order violation** — ${loc}${label}: the worker marked the step complete ` +
					`before code review ran (REFUSED). Steer it to revert the premature completion and ` +
					`re-review, or log a blocker.`;
		const alert: SupervisorAlert = {
			category: "review-intervention-needed",
			summary,
			context: {
				taskId,
				laneId: `lane-${config.laneNumber}`,
				laneNumber: config.laneNumber,
				agentId: workerAgentId,
				reviewInterventionKind: kind,
				reviewStep: stepNum,
				reviewType,
				reviewRound: ev.reviewRound,
				reviewLabel: ev.reviewLabel,
				disposition: ev.disposition,
				recentDispositions: [...state.recentDispositions],
				consecutiveNonApprove: state.consecutiveNonApprove,
				findingCounts: ev.findingCounts,
				findingTrend: ev.findingTrend,
				findingDeltas: ev.findingDeltas,
				findingMixed: ev.findingMixed,
			},
		};
		try {
			config.onSupervisorAlert(alert);
		} catch {
			/* best effort */
		}
	};

	const bridgeReviewEvent = (evt: RuntimeAgentEvent): void => {
		if (
			evt.type !== "review_requested" &&
			evt.type !== "review_completed" &&
			evt.type !== "review_failed"
		) {
			return;
		}
		const payload = (evt.payload ?? {}) as {
			step?: unknown;
			reviewType?: unknown;
			disposition?: unknown;
			reviewPath?: unknown;
		};
		const stepNum = typeof payload.step === "number" ? payload.step : undefined;
		const reviewType = typeof payload.reviewType === "string" ? payload.reviewType : undefined;
		const payloadDisposition =
			typeof payload.disposition === "string" ? (payload.disposition as ReviewDisposition) : undefined;
		const reviewPath = typeof payload.reviewPath === "string" ? payload.reviewPath : undefined;
		const isEnd = evt.type !== "review_requested";

		// #624: the review FILE's `## Verdict:` is the authoritative disposition,
		// overriding the upstream tool-return parse (which can miss on structured
		// results). Read the file ONCE here; reused for finding counts below.
		const reviewMd = isEnd ? readReviewFile(reviewPath) : null;
		const fileVerdict = parseReviewVerdict(reviewMd);
		const disposition = fileVerdict ?? payloadDisposition;

		// Classify by the RESOLVED disposition: only a genuine UNAVAILABLE / total
		// parse-miss (no verdict in the tool return AND none on disk) is
		// review_failed. A real verdict — including one recovered from the file — is
		// review_completed. This is what prevents the spurious "Reviewer
		// unavailable" on every successful review (#624).
		const engineType: EngineEventType = !isEnd
			? "review_started"
			: disposition === "UNAVAILABLE" || disposition === "UNKNOWN" || disposition === undefined
				? "review_failed"
				: "review_completed";

		const engineEvent: EngineEvent = {
			timestamp: new Date().toISOString(),
			type: engineType,
			batchId: config.batchId,
			waveIndex: -1,
			phase: "executing",
			taskId,
			laneNumber: config.laneNumber,
			agentId: workerAgentId,
			reviewStep: stepNum,
			reviewType,
			disposition,
			reviewPath,
		};

		// Detection + enrichment on END boundaries (completed/failed) with a step.
		if (isEnd && stepNum !== undefined) {
			const state = getReviewState(`${taskId}:${stepNum}`);
			const counts = reviewMd ? parseFindingCounts(reviewMd, reviewSeverityLabels) : {};
			const hasCounts = Object.keys(counts).length > 0;
			// Trend compares the PRIOR round's counts to this round's, so compute it
			// BEFORE advancing the streak (which overwrites lastCounts). Semantics:
			// a countless round (e.g. APPROVE, or an unparseable review) preserves the
			// prior lastCounts, so the NEXT counted round trends vs the last COUNTED
			// round — intentional, so a single missing review file doesn't blank the
			// severity trend the supervisor relies on.
			const trendRes = computeFindingTrend(state.lastCounts, counts, reviewSeverityLabels);
			// Shared streak transition (round++, lastCounts, recentDispositions,
			// consecutiveNonApprove) — identical to resume reconstruction.
			advanceReviewStreak(state, {
				disposition,
				counts: hasCounts ? counts : null,
				treatUnavailableAsNonApprove: spiralCfg.treatUnavailableAsNonApprove,
				recentCap: RECENT_DISPOSITIONS_CAP,
			});
			engineEvent.reviewRound = state.round;
			engineEvent.reviewLabel = parseReviewLabelFromPath(reviewPath);
			if (hasCounts) {
				engineEvent.findingCounts = counts;
				engineEvent.findingTrend = trendRes.trend;
				engineEvent.findingDeltas = trendRes.deltas;
				engineEvent.findingMixed = trendRes.mixed;
			}

			// Live-only escalation (the streak counter was already advanced above).
			if (disposition === "APPROVE") {
				state.lastEscalationRound = null; // a fresh streak may escalate again
			} else if (
				disposition === "REVISE" ||
				disposition === "RETHINK" ||
				(disposition === "UNAVAILABLE" && spiralCfg.treatUnavailableAsNonApprove)
			) {
				maybeFireSpiral(stepNum, reviewType, state, engineEvent);
			} else if (disposition === "REFUSED") {
				// Orthogonal failure mode: does NOT touch the REVISE/RETHINK streak.
				maybeFireOrderViolation(stepNum, reviewType, state, engineEvent);
			}
			// UNAVAILABLE (not counted) / UNKNOWN → no counter change.
		}

		const emit = (fn: (stateRoot: string, event: EngineEvent) => void): void => {
			try {
				fn(config.stateRoot, engineEvent);
			} catch {
				/* best effort — a bridge failure must never break the worker run */
			}
		};
		// Cached lazy import (see the import-cycle note at the top of this file).
		if (cachedEmitEngineEvent) {
			emit(cachedEmitEngineEvent);
		} else {
			void import("./persistence.ts")
				.then((m) => {
					cachedEmitEngineEvent = m.emitEngineEvent;
					emit(m.emitEngineEvent);
				})
				.catch(() => {
					/* best effort */
				});
		}
	};

	// Spiral escalation: first fire at threshold; re-fire only if NOT converging
	// (trend flat/rising) and the cooldown spacing has elapsed.
	function maybeFireSpiral(
		stepNum: number | undefined,
		reviewType: string | undefined,
		state: ReviewStepState,
		ev: EngineEvent,
	): void {
		if (shouldFireSpiral(state, spiralCfg, ev.findingTrend)) {
			fireIntervention("revision-spiral", stepNum, reviewType, state, ev);
			state.lastEscalationRound = state.round;
		}
	}

	// Order-violation escalation: actionable each occurrence, throttled by cooldown.
	function maybeFireOrderViolation(
		stepNum: number | undefined,
		reviewType: string | undefined,
		state: ReviewStepState,
		ev: EngineEvent,
	): void {
		if (shouldFireOrderViolation(state, spiralCfg)) {
			fireIntervention("order-violation", stepNum, reviewType, state, ev);
			state.lastRefusedRound = state.round;
		}
	}

	// ── 1. Ensure STATUS.md exists ──────────────────────────────────
	if (!existsSync(statusPath)) {
		const content = readFileSync(promptPath, "utf-8");
		const parsed = parsePromptMd(content, promptPath);
		writeFileSync(statusPath, generateStatusMd(parsed));
	}

	updateStatusField(statusPath, "Status", "🟡 In Progress");
	updateStatusField(statusPath, "Last Updated", new Date().toISOString().slice(0, 10));
	logExecution(statusPath, "Task started", "Runtime V2 lane-runner execution");

	// Pre-segment guard: remove any stale .DONE from a prior segment or prior run.
	// This closes the race window where the monitor sees .DONE before lane-runner
	// can suppress it at segment end. For non-final segments, .DONE must not exist
	// at any point during execution.
	const isNonFinalAtStart =
		segmentId != null &&
		Array.isArray(unit.task.segmentIds) &&
		unit.task.segmentIds.length > 1 &&
		unit.task.segmentIds[unit.task.segmentIds.length - 1] !== segmentId;
	if (isNonFinalAtStart && existsSync(donePath)) {
		try {
			unlinkSync(donePath);
		} catch {
			/* best effort */
		}
		logExecution(
			statusPath,
			"Segment start",
			`Removed stale .DONE before non-final segment ${segmentId}`,
		);
	}

	// ── 2. Iteration loop ───────────────────────────────────────────
	let noProgressCount = 0;
	// TP-145: Is this a non-final segment of a multi-segment task? If more
	// segments follow, .DONE creation is suppressed after the loop so the engine
	// can advance the segment frontier. Loop-invariant; also consulted by the
	// #629 remediation spawn (the finalize gate never applies to a non-final
	// segment).
	const isNonFinalSegment =
		segmentId != null &&
		Array.isArray(unit.task.segmentIds) &&
		unit.task.segmentIds.length > 1 &&
		unit.task.segmentIds[unit.task.segmentIds.length - 1] !== segmentId;
	/** #629: review-gate remediation iterations spent (bounded). */
	let remediationIterations = 0;
	/** #629: gates the CURRENT iteration was spawned to remediate (empty = normal iteration). */
	let remediationGates: BlockingReviewGate[] = [];
	let totalIterations = 0;
	let cumulativeCostUsd = 0;
	let cumulativeTokens = 0;
	// TP-115: carry latest worker telemetry across iterations and into post-loop terminal snapshots
	let lastTelemetry: Partial<AgentHostResult> = {};

	// TP-174: Build segment context once for emitSnapshot calls.
	// Available outside the loop so it can be passed to makeResult too.
	const snapshotSegmentCtx: { stepSegmentMap: StepSegmentMapping[]; repoId: string } | null =
		segmentId && unit.task.stepSegmentMap && config.repoId
			? (() => {
					const repoSteps = getStepsForRepoId(unit.task.stepSegmentMap!, config.repoId);
					return repoSteps.size > 0
						? { stepSegmentMap: unit.task.stepSegmentMap!, repoId: config.repoId }
						: null;
				})()
			: null;

	for (let iter = 0; iter < config.maxIterations; iter++) {
		if (pauseSignal.paused) {
			logExecution(statusPath, "Paused", `User paused at iteration ${totalIterations}`);
			return makeResult(
				taskId,
				segmentId,
				workerAgentId,
				"skipped",
				startTime,
				"Paused by user",
				false,
				totalIterations,
				cumulativeCostUsd,
				cumulativeTokens,
				config,
				statusPath,
				reviewerStatePath,
				undefined,
				snapshotSegmentCtx,
			);
		}

		// Determine remaining steps
		const currentStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
		const parsed = parsePromptMd(readFileSync(promptPath, "utf-8"), promptPath);

		// TP-174: Resolve segment-scoped step filtering.
		// Use config.repoId (structured identity) instead of parsing opaque segmentId.
		const stepSegmentMap = unit.task.stepSegmentMap;
		const currentRepoId = segmentId ? config.repoId : null;
		const rawRepoStepNumbers =
			stepSegmentMap && currentRepoId ? getStepsForRepoId(stepSegmentMap, currentRepoId) : null;
		// TP-174 legacy fallback: If no steps have segments for this repoId
		// (multi-segment task without explicit markers, where all checkboxes
		// are assigned to the fallback/packet repo), disable segment filtering.
		const repoStepNumbers =
			rawRepoStepNumbers && rawRepoStepNumbers.size > 0 ? rawRepoStepNumbers : null;

		// TP-174: Read STATUS.md content once for segment-scoped checks
		const iterStatusContent = readFileSync(statusPath, "utf-8");

		let remainingSteps = parsed.steps.filter((step) => {
			// TP-174: When segment-scoped, only show steps that have work for this repoId
			if (repoStepNumbers && !repoStepNumbers.has(step.number)) return false;
			// TP-174: Use segment-scoped completion check in segment mode
			if (repoStepNumbers && currentRepoId) {
				return !isSegmentComplete(iterStatusContent, step.number, currentRepoId);
			}
			const ss = currentStatus.steps.find((s) => s.number === step.number);
			return !isStepComplete(ss);
		});

		// ── #629: review-gate remediation spawn ─────────────────────
		// All checkboxes checked, but would the finalize gate refuse? If a gate's
		// latest review is REVISE/RETHINK, breaking here means retry+resume never
		// launches a worker and the refusal simply repeats. Spawn a bounded
		// remediation iteration instead: the worker addresses the findings and
		// re-runs review_step to obtain an APPROVE. Segment-scoped iterations
		// (non-final segments) never finalize, so the gate does not apply there.
		remediationGates = [];
		if (remainingSteps.length === 0) {
			const isFinalizingIteration = !isNonFinalSegment;
			const blocking = isFinalizingIteration ? findBlockingReviewGates(unit.packet.reviewsDir) : [];
			if (blocking.length === 0) break; // All done
			if (remediationIterations >= MAX_REVIEW_REMEDIATION_ITERATIONS) {
				logExecution(
					statusPath,
					"Review remediation exhausted",
					`${remediationIterations} remediation iteration(s) did not clear: ${formatBlockingGates(blocking)}`,
				);
				break; // fall through to the finalize gate, which refuses with the alert
			}
			remediationIterations++;
			remediationGates = blocking;
			// Give the iteration an explicit focus step — the step of the first
			// blocking gate (falling back to the last step) — so every downstream
			// `remainingSteps[0]` consumer (Current Step field, prompt, checkbox
			// counting) has a real step to point at. The step is NOT re-marked
			// in-progress and its checkboxes are untouched.
			const focusStepNumber = parseGateStepNumber(blocking[0].gate);
			const focusStep =
				parsed.steps.find((st) => st.number === focusStepNumber) ??
				parsed.steps[parsed.steps.length - 1];
			remainingSteps = focusStep ? [focusStep] : [];
			if (remainingSteps.length === 0) break; // task has no parseable steps — nothing to remediate
			logExecution(
				statusPath,
				"Review remediation",
				`all checkboxes complete but latest review is not APPROVE — spawning remediation iteration ${remediationIterations}/${MAX_REVIEW_REMEDIATION_ITERATIONS}: ${formatBlockingGates(blocking)}`,
			);
		}

		// TP-196 / #508: Pre-spawn segment-completion check.
		//
		// When the lane is iterating a segment-scoped task, verify that NOT ALL
		// `repoStepNumbers` are segment-complete before incurring the cost of
		// spawning a worker. The `remainingSteps` filter above already enforces
		// this implicitly (via `isSegmentComplete`), but expressing the check
		// explicitly at the spawn boundary:
		//   1. Makes the wasted-iteration prevention contract visible.
		//   2. Provides a defensive backstop for cases where `parsed.steps` and
		//      `repoStepNumbers` diverge (e.g., legacy/partial-marker tasks).
		//   3. Gives behavioural tests a clean assertion target (via the pure
		//      helper `shouldSkipSpawnForCompleteSegment`).
		if (
			remediationGates.length === 0 &&
			shouldSkipSpawnForCompleteSegment(iterStatusContent, repoStepNumbers, currentRepoId)
		) {
			logExecution(
				statusPath,
				"Pre-spawn segment-completion check",
				`all segment checkboxes already complete for repo '${currentRepoId}' — skipping worker spawn (#508)`,
			);
			break;
		}

		totalIterations++;
		updateStatusField(
			statusPath,
			"Current Step",
			remediationGates.length > 0
				? `Review remediation — Step ${remainingSteps[0].number}: ${remainingSteps[0].name}`
				: `Step ${remainingSteps[0].number}: ${remainingSteps[0].name}`,
		);
		updateStatusField(statusPath, "Iteration", `${totalIterations}`);

		// Mark first incomplete step as in-progress (not during remediation: the
		// focus step is already complete; its checkboxes/status stay untouched)
		const firstStep = remainingSteps[0];
		const firstStepStatus = currentStatus.steps.find((s) => s.number === firstStep.number);
		if (remediationGates.length === 0 && firstStepStatus?.status !== "in-progress") {
			updateStepStatus(statusPath, firstStep.number, "in-progress");
			logExecution(statusPath, `Step ${firstStep.number} started`, firstStep.name);
		}

		// Count checkboxes before worker runs
		// TP-174: When segment-scoped, count only this segment's checkboxes
		let prevTotalChecked: number;
		if (repoStepNumbers && currentRepoId) {
			const preStatusContent = readFileSync(statusPath, "utf-8");
			const segCbs = getSegmentCheckboxes(preStatusContent, firstStep.number, currentRepoId);
			prevTotalChecked = segCbs ? segCbs.checked : 0;
		} else {
			prevTotalChecked = currentStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);
		}

		// ── Build worker prompt ─────────────────────────────────────
		const wrapUpFile = join(taskFolder, ".task-wrap-up");
		if (existsSync(wrapUpFile))
			try {
				unlinkSync(wrapUpFile);
			} catch {
				/* ignore */
			}

		// TP-174/TP-501/TP-196: Compute segment scope mode BEFORE building prompt.
		// `segmentScopeMode` is the authoritative TP-196 flag; `isSegmentScoped` is
		// preserved as a boolean alias for ergonomics at the many existing call sites.
		const segmentScopeMode: SegmentScopeMode = computeSegmentScopeMode(
			stepSegmentMap,
			repoStepNumbers,
			currentRepoId,
			remainingSteps.length > 0 ? remainingSteps[0].number : null,
		);
		const isSegmentScoped = segmentScopeMode === "SEGMENT_SCOPED";

		const promptLines = [
			`Read your task instructions at: ${promptPath}`,
			`Read your execution state at: ${statusPath}`,
			``,
			`Task: ${taskId}`,
			`Task folder: ${taskFolder}/`,
			`Iteration: ${totalIterations}`,
			`Wrap-up signal file: ${wrapUpFile}`,
			``,
			`Execution repo context:`,
			`- Execution repo ID: ${unit.executionRepoId}`,
			`- Execution worktree (worker cwd): ${unit.worktreePath}`,
			`- Lane repo ID: ${config.repoId}`,
			// Only show segment ID when segment-scoped. For FULL_TASK, omit to avoid
			// workers incorrectly self-scoping based on segment metadata.
			...(isSegmentScoped ? [`- Active segment ID: ${segmentId}`] : []),
			``,
			`Packet home context:`,
			`- Packet home repo ID: ${unit.packetHomeRepoId}`,
			`- Packet task folder: ${taskFolder}`,
			`- Packet PROMPT path: ${promptPath}`,
			`- Packet STATUS path: ${statusPath}`,
			`- Packet .DONE path: ${donePath}`,
			`- Packet .reviews path: ${unit.packet.reviewsDir}`,
			``,
			`⚠️ ORCHESTRATED RUN: Do NOT archive or move the task folder. The orchestrator handles post-merge archival.`,
			``,
			`⚠️ CHECKPOINT RULE: After completing EACH checkbox item, immediately edit STATUS.md to check it off (- [ ] → - [x]) BEFORE starting the next item. Do NOT batch checkbox updates at the end of a step.`,
		];

		// Only show segment DAG in segment-scoped mode
		const segmentDag = isSegmentScoped ? unit.task.explicitSegmentDag : null;
		if (segmentDag && segmentDag.repoIds.length > 0) {
			const edgeSummary =
				segmentDag.edges.length > 0
					? segmentDag.edges.map((edge) => `${edge.fromRepoId}->${edge.toRepoId}`).join(", ")
					: "(no explicit edges)";
			promptLines.push(
				``,
				`Segment DAG context (from PROMPT metadata):`,
				`- Repos: ${segmentDag.repoIds.join(", ")}`,
				`- Edges: ${edgeSummary}`,
			);
		}

		// Segment scope mode is determined by which system prompt was loaded.
		// No SegmentScopeMode line needed — the prompt IS the mode.

		// TP-174/TP-196: Segment-scoped prompt — show only this segment's checkboxes.
		// Gated on the authoritative `isSegmentScoped` (derived from `segmentScopeMode`)
		// rather than the raw composite condition, so the prompt branch can't drift
		// from the mode decision (TP-196 / #502).
		if (isSegmentScoped) {
			const currentStepNum = remainingSteps[0].number;
			// Defensive guards: when `isSegmentScoped === true`, `computeSegmentScopeMode`
			// has already verified `stepSegmentMap`, `currentRepoId`, and that the
			// current step's mapping contains an entry for the active repo. We re-fetch
			// the structures here for clarity. If any are missing we log and skip the
			// segment block (defense-in-depth — should never trip in practice).
			const currentStepMapping = stepSegmentMap?.find((s) => s.stepNumber === currentStepNum);
			const mySegment = currentStepMapping?.segments.find((seg) => seg.repoId === currentRepoId);

			if (!currentStepMapping || !mySegment) {
				logExecution(
					statusPath,
					"WARN",
					`segmentScopeMode === SEGMENT_SCOPED but current step mapping missing — skipping segment prompt block (currentRepoId=${currentRepoId}, stepNum=${currentStepNum})`,
				);
			} else {
				const otherSegments = currentStepMapping.segments.filter((seg) => seg.repoId !== currentRepoId);

				// Count total segments for this repo across all steps
				const totalStepsForRepo = repoStepNumbers ? repoStepNumbers.size : 0;
				const segmentIndexInStep =
					currentStepMapping.segments.findIndex((seg) => seg.repoId === currentRepoId) + 1;
				const totalSegmentsInStep = currentStepMapping.segments.length;

				promptLines.push(
					``,
					`Segment-scoped context (Phase A):`,
					`Active segment: ${segmentId} (Step ${currentStepNum}, segment ${segmentIndexInStep} of ${totalSegmentsInStep})`,
					`Your repo: ${currentRepoId}`,
					``,
				);

				if (mySegment && mySegment.checkboxes.length > 0) {
					promptLines.push(`Your checkboxes for this step:`);
					for (const cb of mySegment.checkboxes) {
						promptLines.push(`  ${cb}`);
					}
				}

				if (otherSegments.length > 0) {
					promptLines.push(``);
					promptLines.push(`Other segments in this step (NOT yours — do not attempt):`);
					for (const seg of otherSegments) {
						promptLines.push(
							`  - ${seg.repoId}: ${seg.checkboxes.length} checkbox(es) (will run in a separate segment)`,
						);
					}
				}

				// List completed steps for this repo
				const completedForRepo = parsed.steps.filter((step) => {
					if (!repoStepNumbers || !repoStepNumbers.has(step.number)) return false;
					const ss = currentStatus.steps.find((s) => s.number === step.number);
					return isStepComplete(ss);
				});
				if (completedForRepo.length > 0) {
					promptLines.push(``);
					promptLines.push(
						`Prior steps completed: ${completedForRepo.map((s) => `Step ${s.number} (${s.name})`).join(", ")}`,
					);
				}

				promptLines.push(
					``,
					`When all YOUR checkboxes are checked, your segment is done — exit successfully.`,
					`Do NOT attempt work in other repos.`,
				);
			}
		}

		if (remediationGates.length > 0) {
			promptLines.push(
				``,
				`⛔ REVIEW GATE OUTSTANDING — this task cannot finalize yet.`,
				`All step checkboxes are checked, but the LATEST review for the following gate(s) is not APPROVE:`,
				...remediationGates.map(
					(g) =>
						`  - ${g.gate}: ${g.filename} → ${g.verdict} (see ${join(unit.packet.reviewsDir, g.filename)})`,
				),
				``,
				`Your job in this iteration: read each listed review file, address EVERY finding it raises`,
				`(fix code, update docs/tests as required), commit, then call review_step for that step again`,
				`to obtain a fresh review. Repeat until the latest review for each gate is APPROVE.`,
				`Do NOT write .DONE and do NOT declare the task complete while any gate's latest verdict`,
				`is REVISE or RETHINK — the runtime will refuse to finalize. Do NOT un-check or re-check`,
				`step checkboxes. If a finding cannot be addressed, escalate_to_supervisor with specifics.`,
			);
		}

		if (remediationGates.length === 0 && totalIterations > 1 && remainingSteps.length > 0) {
			const remainingSet = new Set(remainingSteps.map((s) => s.number));
			const completedSteps = parsed.steps.filter((s) => !remainingSet.has(s.number));
			promptLines.push(
				``,
				`IMPORTANT: You exited previously without completing all steps.`,
				`Completed (do not redo): ${completedSteps.map((s) => `Step ${s.number}: ${s.name}`).join(", ") || "(none)"}`,
				`Remaining (focus here): ${remainingSteps.map((s) => `Step ${s.number}: ${s.name}`).join(", ")}`,
			);

			// If the worker exited without checking any boxes, add a corrective directive
			if (noProgressCount > 0) {
				promptLines.push(
					``,
					`🚨 CRITICAL: You have exited ${noProgressCount} time(s) without completing work.`,
					`Your previous exit was premature. You said something like "Now let me fix this"`,
					`and then STOPPED instead of actually making the edit.`,
					``,
					`DO NOT DO THIS AGAIN. When you know what to edit, call the edit tool IMMEDIATELY.`,
					`Do not produce a text message describing what you plan to do. Just do it.`,
					`Work continuously through ALL remaining checkboxes until the task is DONE.`,
					`Do not exit between checkboxes or steps.`,
				);
			}
		}

		// ── Spawn worker ────────────────────────────────────────────
		const eventsPath = runtimeAgentEventsPath(config.stateRoot, config.batchId, workerAgentId);

		const mailboxDir = join(config.stateRoot, ".pi", "mailbox", config.batchId, workerAgentId);
		mkdirSync(join(mailboxDir, "inbox"), { recursive: true });

		const steeringPendingPath = join(taskFolder, ".steering-pending");

		// TP-106: Bridge extension wiring for agent-side reply/escalate tools
		const outboxDir = join(
			config.stateRoot,
			".pi",
			"mailbox",
			config.batchId,
			workerAgentId,
			"outbox",
		);
		const bridgeExtensionPath = join(LANE_RUNNER_DIR, "agent-bridge-extension.ts");

		// TP-180: Forward user-installed extensions to worker agent
		const allPackages = loadPiSettingsPackages(config.stateRoot);
		const workerPackages = filterExcludedExtensions(
			allPackages,
			config.workerExcludeExtensions ?? [],
		);

		const hostOpts: AgentHostOptions = {
			agentId: workerAgentId,
			role: "worker",
			batchId: config.batchId,
			laneNumber: config.laneNumber,
			taskId,
			repoId: config.repoId,
			cwd: unit.worktreePath,
			prompt: promptLines.join("\n"),
			systemPrompt:
				(isSegmentScoped && config.workerSegmentPrompt
					? config.workerSystemPrompt + "\n\n---\n\n" + config.workerSegmentPrompt
					: config.workerSystemPrompt) || undefined,
			model: config.workerModel || undefined,
			// TP-184: buildWorkerToolsAllowlist always appends ENGINE_BRIDGE_TOOLS
			// (review_step, notify_supervisor, request_segment_expansion) so that
			// engine-internal coordination tools are present regardless of what the
			// user configured for taskRunner.worker.tools. See issue #530.
			tools: buildWorkerToolsAllowlist(config.workerTools),
			thinking: config.workerThinking || undefined,
			mailboxDir,
			steeringPendingPath,
			eventsPath,
			exitSummaryPath: eventsPath.replace(/\.jsonl$/, "-exit.json"),
			timeoutMs: config.maxWorkerMinutes * 60_000,
			stateRoot: config.stateRoot,
			packet: unit.packet,
			extensions: [bridgeExtensionPath, ...workerPackages],
			env: {
				TASKPLANE_OUTBOX_DIR: outboxDir,
				TASKPLANE_AGENT_ID: workerAgentId,
				TASKPLANE_TASK_FOLDER: taskFolder,
				TASKPLANE_STATUS_PATH: statusPath,
				TASKPLANE_PROMPT_PATH: promptPath,
				TASKPLANE_REVIEWS_DIR: unit.packet.reviewsDir,
				TASKPLANE_REVIEWER_STATE_PATH: reviewerStatePath,
				TASKPLANE_PROJECT_NAME: config.projectName || "project",
				TASKPLANE_TASK_ID: taskId,
				// Hard-set segment env vars based on mode. In FULL_TASK mode,
				// explicitly clear them to prevent env inheritance leaking segment cues.
				TASKPLANE_ACTIVE_SEGMENT_ID: isSegmentScoped ? (segmentId ?? "") : "",
				TASKPLANE_SEGMENT_ID: isSegmentScoped ? (segmentId ?? "") : "",
				TASKPLANE_SUPERVISOR_AUTONOMY: config.supervisorAutonomy || "autonomous",
				ORCH_BATCH_ID: config.batchId,
				...(config.reviewerModel ? { TASKPLANE_REVIEWER_MODEL: config.reviewerModel } : {}),
				...(config.reviewerThinking ? { TASKPLANE_REVIEWER_THINKING: config.reviewerThinking } : {}),
				...(config.reviewerTools ? { TASKPLANE_REVIEWER_TOOLS: config.reviewerTools } : {}),
				// TP-180: Pass state root and reviewer exclusions for extension forwarding
				TASKPLANE_STATE_ROOT: config.stateRoot,
				...(config.reviewerExcludeExtensions && config.reviewerExcludeExtensions.length > 0
					? { TASKPLANE_REVIEWER_EXCLUDE_EXTENSIONS: JSON.stringify(config.reviewerExcludeExtensions) }
					: {}),
			},
			// TP-172: Exit interception callback — escalate to supervisor when worker
			// exits without making visible progress (no checkboxes, no blocker logged).
			onPrematureExit: config.onSupervisorAlert
				? async (assistantMessage: string): Promise<string | null> => {
						// Check if the worker made visible progress during this turn:
						// 1. Checkbox progress (more items checked)
						// 2. Blocker logged (non-empty Blockers section)
						try {
							const statusContent = readFileSync(statusPath, "utf-8");
							// TP-174: Use same scope as prevTotalChecked (segment or global)
							let midTotalChecked: number;
							if (repoStepNumbers && currentRepoId) {
								const segCbs = getSegmentCheckboxes(statusContent, firstStep.number, currentRepoId);
								midTotalChecked = segCbs ? segCbs.checked : 0;
							} else {
								const midStatus = parseStatusMd(statusContent);
								midTotalChecked = midStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);
							}
							if (midTotalChecked > prevTotalChecked) {
								// Worker checked off checkboxes — let it exit normally
								return null;
							}
							// Check for blocker entries: extract Blockers section and see if non-empty
							const blockerMatch = statusContent.match(/## Blockers\s*\n([\s\S]*?)(?:\n---|-$)/i);
							if (blockerMatch) {
								const blockerContent = blockerMatch[1].trim();
								// If blockers section has real content (not just "*None*" or empty)
								if (blockerContent && blockerContent !== "*None*") {
									// Worker logged a blocker — let it exit normally
									return null;
								}
							}
						} catch {
							/* If we can't read STATUS.md, proceed with escalation */
						}

						// No visible progress — compose escalation message.
						// TP-187 (#540): when the worker exits silently, fall back to the most
						// recent `assistant_message` event in events.jsonl so the supervisor
						// has SOMETHING to act on instead of `Worker said: ""`.
						let workerSaid = (assistantMessage ?? "").trim();
						let workerSaidSource: "current-turn" | "events-jsonl-fallback" | "empty-sentinel" =
							"current-turn";
						if (!workerSaid) {
							workerSaidSource = "empty-sentinel";
							try {
								const raw = readFileSync(eventsPath, "utf-8");
								const lines = raw.split("\n");
								// Walk backward to find the most recent assistant_message with non-empty text.
								for (let i = lines.length - 1; i >= 0; i--) {
									const line = lines[i].trim();
									if (!line) continue;
									try {
										const evt = JSON.parse(line) as Record<string, unknown>;
										if (evt.type === "assistant_message") {
											const payload = evt.payload as Record<string, unknown> | undefined;
											const text = typeof payload?.text === "string" ? payload.text.trim() : "";
											if (text) {
												workerSaid = text;
												workerSaidSource = "events-jsonl-fallback";
												break;
											}
										}
									} catch {
										/* skip malformed line */
									}
								}
							} catch {
								/* events.jsonl unreadable; sentinel will be used */
							}
						}
						if (!workerSaid) {
							workerSaid =
								"(no assistant message captured — worker exited without producing visible output)";
							workerSaidSource = "empty-sentinel";
						}
						const truncatedMsg = workerSaid.slice(0, 500);
						const uncheckedItems: string[] = [];
						try {
							const statusContent = readFileSync(statusPath, "utf-8");
							// TP-174: When segment-scoped, report only this segment's unchecked items
							if (repoStepNumbers && currentRepoId) {
								const segCbs = getSegmentCheckboxes(statusContent, firstStep.number, currentRepoId);
								if (segCbs) {
									for (const text of segCbs.uncheckedTexts.slice(0, 5)) {
										uncheckedItems.push(text);
									}
								}
							} else {
								const uncheckedMatches = statusContent.match(/^- \[ \] .+$/gm);
								if (uncheckedMatches) {
									for (const item of uncheckedMatches.slice(0, 5)) {
										uncheckedItems.push(item.replace(/^- \[ \] /, "").trim());
									}
								}
							}
						} catch {
							/* best effort */
						}

						const currentStepInfo =
							remainingSteps.length > 0
								? `Step ${remainingSteps[0].number}: ${remainingSteps[0].name}`
								: "Unknown";

						// Fire supervisor alert
						try {
							config.onSupervisorAlert!({
								category: "worker-exit-intercept",
								summary:
									`🔄 Worker on lane ${config.laneNumber} wants to exit with no progress.\n` +
									`  Task: ${taskId}\n` +
									`  Current step: ${currentStepInfo}\n` +
									`  Iteration: ${totalIterations}, No-progress count: ${noProgressCount + 1}\n` +
									`  Unchecked items: ${uncheckedItems.length > 0 ? uncheckedItems.join("; ") : "(none found)"}\n` +
									`  Worker said: "${truncatedMsg}"` +
									(workerSaidSource === "events-jsonl-fallback"
										? `   (fallback: most-recent assistant_message from events.jsonl)\n`
										: workerSaidSource === "empty-sentinel"
											? `   (no assistant message captured this iteration)\n`
											: "\n") +
									`\nSend a steering message to ${workerAgentId} with targeted instructions,` +
									` or reply "skip" / "let it fail" to close the session.`,
								context: {
									taskId,
									laneId: `lane-${config.laneNumber}`,
									laneNumber: config.laneNumber,
									agentId: workerAgentId,
									exitReason: `worker_exit_no_progress: ${truncatedMsg.slice(0, 200)}`,
								},
							});
						} catch {
							/* best effort — don't block on alert failure */
						}

						// Poll worker mailbox inbox for supervisor reply (60s timeout)
						const SUPERVISOR_REPLY_TIMEOUT_MS = 60_000;
						const POLL_INTERVAL_MS = 2_000;
						const escalationTimestamp = Date.now();
						const inboxDir = sessionInboxDir(config.stateRoot, config.batchId, workerAgentId);

						const supervisorReply = await new Promise<string | null>((resolve) => {
							const deadline = Date.now() + SUPERVISOR_REPLY_TIMEOUT_MS;
							const poll = () => {
								if (Date.now() >= deadline) {
									resolve(null); // Timeout — fall back to corrective re-spawn
									return;
								}
								try {
									const messages = readInbox(inboxDir, config.batchId);
									// Only accept messages newer than escalation timestamp
									for (const { filename, message } of messages) {
										if (message.timestamp >= escalationTimestamp && message.from === "supervisor") {
											// Consume the message
											const ackDir = join(dirname(inboxDir), "ack");
											try {
												ackMessage(inboxDir, filename);
											} catch {
												/* best effort */
											}
											resolve(message.content);
											return;
										}
									}
								} catch {
									/* inbox not ready yet */
								}
								setTimeout(poll, POLL_INTERVAL_MS);
							};
							poll();
						});

						if (!supervisorReply) {
							// Timeout — let the session close, corrective re-spawn will handle it
							logExecution(
								statusPath,
								"Exit intercept timeout",
								`Supervisor did not respond within ${SUPERVISOR_REPLY_TIMEOUT_MS / 1000}s — closing session`,
							);
							return null;
						}

						// Interpret supervisor reply: close directives vs instructional content
						const normalizedReply = supervisorReply.trim().toLowerCase();
						const CLOSE_DIRECTIVES = ["skip", "let it fail", "close", "abort", "stop"];
						// Only short messages (< 30 chars) can be close directives.
						// Longer messages are always instructions even if they start with "stop".
						const isShortEnoughForDirective = normalizedReply.length < 30;
						if (
							isShortEnoughForDirective &&
							CLOSE_DIRECTIVES.some(
								(d) =>
									normalizedReply === d ||
									normalizedReply.startsWith(d + ":") ||
									normalizedReply.startsWith(d + " ") ||
									normalizedReply.startsWith(d + ".") ||
									normalizedReply.startsWith(d + " -"),
							)
						) {
							logExecution(
								statusPath,
								"Exit intercept close",
								`Supervisor directed session close: "${supervisorReply.slice(0, 100)}"`,
							);
							return null;
						}

						// Instructional reply — return as new prompt for the worker
						logExecution(
							statusPath,
							"Exit intercept reprompt",
							`Supervisor provided instructions (${supervisorReply.length} chars) — reprompting worker`,
						);
						return supervisorReply;
					}
				: undefined,
		};

		// TP-184: Defense-in-depth sanity check. Under normal operation,
		// `buildWorkerToolsAllowlist()` guarantees ENGINE_BRIDGE_TOOLS are
		// present in the allowlist. Warn (do NOT throw or block spawn) if any
		// is missing — this catches future helper bugs or accidental bypasses.
		// See issue #530 for what silently breaks when bridge tools are missing.
		const toolsList = (hostOpts.tools ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		for (const bridgeTool of ENGINE_BRIDGE_TOOLS) {
			if (!toolsList.includes(bridgeTool)) {
				logExecution(
					statusPath,
					"WARN",
					`workerTools allowlist missing engine bridge tool '${bridgeTool}'; review/coordination features will silently no-op`,
				);
			}
		}

		// Context pressure: write wrap-up signal before kill
		let workerKillReason: "context" | "timer" | null = null;
		let iterationTelemetry: Partial<AgentHostResult> = {};

		const spawned = spawnAgent(hostOpts, bridgeReviewEvent, (telemetry) => {
			try {
				// Context pressure check
				if (telemetry.contextUsage) {
					const pct = telemetry.contextUsage.percent;
					if (pct >= config.warnPercent) {
						const msg = `Wrap up (context ${Math.round(pct)}%)`;
						if (!existsSync(wrapUpFile)) writeFileSync(wrapUpFile, msg);
					}
					if (pct >= config.killPercent) {
						workerKillReason = "context";
						spawned.kill();
					}
				}

				iterationTelemetry = telemetry;
				lastTelemetry = telemetry;
				// Emit lane snapshot
				emitSnapshot(
					config,
					taskId,
					segmentId,
					"running",
					telemetry,
					statusPath,
					reviewerStatePath,
					snapshotSegmentCtx,
				);
			} catch {
				/* non-fatal: telemetry callback must never crash the engine */
			}
		});

		// Reviewer telemetry is written by the worker bridge during review_step.
		// Poll snapshot refresh independently from worker message_end cadence so
		// the dashboard sees reviewer activity while tool calls are in-flight.
		let reviewerSnapshotFailures = 0;
		const reviewerRefreshFailureThreshold = 5;
		const reviewerRefresh = setInterval(() => {
			const ok = emitSnapshot(
				config,
				taskId,
				segmentId,
				"running",
				iterationTelemetry,
				statusPath,
				reviewerStatePath,
				snapshotSegmentCtx,
			);
			if (ok) {
				reviewerSnapshotFailures = 0;
				return;
			}

			reviewerSnapshotFailures += 1;
			if (reviewerSnapshotFailures >= reviewerRefreshFailureThreshold) {
				clearInterval(reviewerRefresh);
				logExecution(
					statusPath,
					"Snapshot refresh disabled",
					`Lane ${config.laneNumber}, task ${taskId}: ${reviewerSnapshotFailures} consecutive emitSnapshot failures`,
				);
			}
		}, 1000);

		// Live outbox surfacing during the worker run (mail-recognition fix):
		// poll the worker's outbox on a timer so reply/escalate mail reaches the
		// supervisor mid-run, not only after the worker exits.
		const outboxLivePoll = setInterval(drainAndSurfaceOutbox, OUTBOX_LIVE_POLL_INTERVAL_MS);

		let workerResult: AgentHostResult;
		try {
			workerResult = await spawned.promise;
		} finally {
			clearInterval(reviewerRefresh);
			clearInterval(outboxLivePoll);
		}

		// TP-115: Update lastTelemetry with definitive final values from AgentHostResult
		lastTelemetry = workerResult;

		// Clean up wrap-up signal
		if (existsSync(wrapUpFile))
			try {
				unlinkSync(wrapUpFile);
			} catch {
				/* ignore */
			}

		// Accumulate costs
		cumulativeCostUsd += workerResult.costUsd;
		cumulativeTokens +=
			workerResult.inputTokens +
			workerResult.outputTokens +
			workerResult.cacheReadTokens +
			workerResult.cacheWriteTokens;

		// ── TP-106 / mail-recognition: final outbox drain ────────────
		// Surface any reply/escalate mail written between the last live poll and
		// worker exit. Live-surfaced messages were already acked, so this never
		// double-surfaces them.
		drainAndSurfaceOutbox();

		// ── Steering annotation ─────────────────────────────────────
		try {
			if (existsSync(steeringPendingPath)) {
				const raw = readFileSync(steeringPendingPath, "utf-8");
				for (const line of raw.split("\n").filter((l) => l.trim())) {
					try {
						const entry = JSON.parse(line) as { ts: number; content: string; id: string };
						const sanitized = entry.content.replace(/\r?\n/g, " / ").replace(/\|/g, "\\|").slice(0, 200);
						const ts = new Date(entry.ts).toISOString().slice(0, 16).replace("T", " ");
						logExecution(statusPath, "⚠️ Steering", sanitized);
					} catch {
						/* skip malformed */
					}
				}
				unlinkSync(steeringPendingPath);
			}
		} catch {
			/* non-fatal */
		}

		// Log iteration result
		const statusMsg = workerResult.killed
			? `killed (${workerKillReason === "context" ? "context limit" : "wall-clock timeout"})`
			: workerResult.exitCode === 0
				? "done"
				: `error (code ${workerResult.exitCode})`;
		logExecution(
			statusPath,
			`Worker iter ${totalIterations}`,
			`${statusMsg} in ${Math.round(workerResult.durationMs / 1000)}s, tools: ${workerResult.toolCalls}`,
		);

		// ── Check progress ──────────────────────────────────────────
		const afterStatusContent = readFileSync(statusPath, "utf-8");
		const afterStatus = parseStatusMd(afterStatusContent);
		// TP-174: Segment-scoped progress delta
		let afterTotalChecked: number;
		if (repoStepNumbers && currentRepoId) {
			const segCbs = getSegmentCheckboxes(afterStatusContent, firstStep.number, currentRepoId);
			afterTotalChecked = segCbs ? segCbs.checked : 0;
		} else {
			afterTotalChecked = afterStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);
		}
		const progressDelta = afterTotalChecked - prevTotalChecked;

		if (progressDelta <= 0) {
			// Check for soft progress: uncommitted changes in the worktree
			// indicate the worker is actively editing code even if no checkbox
			// was checked yet. This avoids false stall detection on complex
			// steps where analysis + editing spans multiple tool calls.
			let hasSoftProgress = false;
			try {
				const diffOutput = execSync("git diff --stat HEAD", {
					cwd: unit.worktreePath,
					timeout: 5000,
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
				}).trim();
				// Only count source file changes as soft progress, not just STATUS.md
				const changedFiles = diffOutput.split("\n").filter((l) => l.includes("|"));
				const sourceChanges = changedFiles.filter(
					(l) => !l.includes("STATUS.md") && !l.includes(".steering"),
				);
				hasSoftProgress = sourceChanges.length > 0;
			} catch {
				/* git not available or timeout — treat as no soft progress */
			}

			if (hasSoftProgress) {
				// Worker has uncommitted code changes — don't count toward stall.
				// Reset the counter since the worker is actively editing.
				logExecution(
					statusPath,
					"Soft progress",
					`Iteration ${totalIterations}: 0 new checkboxes but uncommitted source changes detected — not counting as stall`,
				);
				noProgressCount = 0;
			} else if (remediationGates.length > 0) {
				// #629: a review-remediation iteration checks 0 new boxes BY DESIGN
				// (its output is a fresh review file, not a checkbox). It is bounded
				// separately by MAX_REVIEW_REMEDIATION_ITERATIONS — do not count it
				// toward the no-progress stall limit.
				logExecution(
					statusPath,
					"Remediation iteration",
					`Iteration ${totalIterations}: review-gate remediation — not counted toward stall`,
				);
			} else {
				noProgressCount++;
				logExecution(
					statusPath,
					"No progress",
					`Iteration ${totalIterations}: 0 new checkboxes (${noProgressCount}/${config.noProgressLimit} stall limit)`,
				);
				if (noProgressCount >= config.noProgressLimit) {
					logExecution(statusPath, "Task blocked", `No progress after ${noProgressCount} iterations`);
					// TP-187 (#538): synchronous outbox drain at lane-termination decision
					// point. Purges any pending escalations/replies/segment-expansions the
					// worker emitted just before termination so they are not later re-
					// discovered and re-forwarded as zombie supervisor alerts.
					try {
						const drained = drainAgentOutbox(config.stateRoot, config.batchId, workerAgentId);
						if (drained > 0) {
							logExecution(
								statusPath,
								"Outbox drained",
								`No-progress kill: drained ${drained} pending outbox entr${drained === 1 ? "y" : "ies"} for ${workerAgentId}`,
							);
						}
					} catch {
						/* best effort — do not block termination */
					}
					// TP-187 (#538): notify the supervisor process so it can suppress any
					// further alerts queued for this lane (zombie-alert filter).
					if (config.onLaneTerminated) {
						try {
							config.onLaneTerminated({
								laneNumber: config.laneNumber,
								agentId: workerAgentId,
								batchId: config.batchId,
								terminatedAt: Date.now(),
								reason: "no-progress-kill",
							});
						} catch {
							/* best effort */
						}
					}
					return makeResult(
						taskId,
						segmentId,
						workerAgentId,
						"failed",
						startTime,
						`No progress after ${noProgressCount} iterations`,
						false,
						totalIterations,
						cumulativeCostUsd,
						cumulativeTokens,
						config,
						statusPath,
						reviewerStatePath,
						lastTelemetry,
						snapshotSegmentCtx,
					);
				}
			}
		} else {
			noProgressCount = 0;
		}

		// Mark completed steps
		// TP-174: When segment-scoped, mark step complete when the segment's
		// checkboxes are all checked (not the full step which may have other segments).
		if (repoStepNumbers && currentRepoId) {
			for (const stepNum of repoStepNumbers) {
				if (isSegmentComplete(afterStatusContent, stepNum, currentRepoId)) {
					// Only mark step complete in STATUS.md if ALL segments in that step
					// are complete (not just ours). But for loop exit, we only care about ours.
					const ss = afterStatus.steps.find((s) => s.number === stepNum);
					if (isStepComplete(ss)) {
						updateStepStatus(statusPath, stepNum, "complete");
					}
				}
			}
		} else {
			for (const step of parsed.steps) {
				const ss = afterStatus.steps.find((s) => s.number === step.number);
				if (isStepComplete(ss)) {
					updateStepStatus(statusPath, step.number, "complete");
				}
			}
		}

		// Check if all steps are now complete
		// TP-174: When segment-scoped, exit when all steps for this repoId
		// have their segment checkboxes complete.
		let allComplete: boolean;
		if (repoStepNumbers && currentRepoId) {
			allComplete = [...repoStepNumbers].every((stepNum) =>
				isSegmentComplete(afterStatusContent, stepNum, currentRepoId),
			);
		} else {
			allComplete = parsed.steps.every((step) => {
				const ss = afterStatus.steps.find((s) => s.number === step.number);
				return isStepComplete(ss);
			});
		}
		if (allComplete) {
			// #629: all boxes checked — but if a finalizing task still has an
			// outstanding non-APPROVE gate and remediation budget remains, loop
			// back so the top-of-loop check spawns a remediation iteration
			// instead of falling straight into the finalize refusal.
			// (The top-of-loop check owns the budget decision and the
			// "exhausted" log, so defer to it whenever a gate is outstanding.)
			if (!isNonFinalSegment && findBlockingReviewGates(unit.packet.reviewsDir).length > 0) {
				continue;
			}
			break;
		}
	}

	// ── 3. Post-loop completion check ───────────────────────────────
	const finalStatusContent = readFileSync(statusPath, "utf-8");
	const finalStatus = parseStatusMd(finalStatusContent);
	const parsed = parsePromptMd(readFileSync(promptPath, "utf-8"), promptPath);

	// TP-174: Segment-scoped post-loop check. Re-derive repo scoping since
	// the iteration loop variables are out of scope here.
	const postLoopRepoId = segmentId ? config.repoId : null;
	const postLoopStepSegMap = unit.task.stepSegmentMap;
	const postLoopRepoSteps =
		postLoopStepSegMap && postLoopRepoId
			? getStepsForRepoId(postLoopStepSegMap, postLoopRepoId)
			: null;
	const effectivePostLoopRepoSteps =
		postLoopRepoSteps && postLoopRepoSteps.size > 0 ? postLoopRepoSteps : null;

	let allStepsComplete: boolean;
	if (effectivePostLoopRepoSteps && postLoopRepoId) {
		allStepsComplete = [...effectivePostLoopRepoSteps].every((stepNum) =>
			isSegmentComplete(finalStatusContent, stepNum, postLoopRepoId),
		);
	} else {
		allStepsComplete = parsed.steps.every((step) => {
			const ss = finalStatus.steps.find((s) => s.number === step.number);
			return isStepComplete(ss);
		});
	}

	if (!allStepsComplete) {
		let incomplete: string;
		if (effectivePostLoopRepoSteps && postLoopRepoId) {
			incomplete = [...effectivePostLoopRepoSteps]
				.filter((stepNum) => !isSegmentComplete(finalStatusContent, stepNum, postLoopRepoId))
				.map((n) => `Step ${n}`)
				.join(", ");
		} else {
			incomplete = parsed.steps
				.filter((step) => {
					const ss = finalStatus.steps.find((s) => s.number === step.number);
					return !isStepComplete(ss);
				})
				.map((s) => `Step ${s.number}`)
				.join(", ");
		}
		logExecution(statusPath, "Task incomplete", `Max iterations reached. Incomplete: ${incomplete}`);
		return makeResult(
			taskId,
			segmentId,
			workerAgentId,
			"failed",
			startTime,
			`Max iterations (${config.maxIterations}) reached with incomplete steps: ${incomplete}`,
			false,
			totalIterations,
			cumulativeCostUsd,
			cumulativeTokens,
			config,
			statusPath,
			reviewerStatePath,
			lastTelemetry,
			snapshotSegmentCtx,
		);
	}

	// TP-145: `isNonFinalSegment` (hoisted above the iteration loop) — if more
	// segments remain after this one, suppress .DONE creation so the engine can
	// advance the segment frontier. .DONE must only exist when ALL segments of
	// a multi-segment task are complete.

	// TP-165: Check for pending expansion requests in the worker's outbox.
	// If the worker filed expansion requests, more segments may be added by the
	// engine at the segment boundary — .DONE must not be created even if this
	// appears to be the final segment based on the static segmentIds list.
	const hasPendingExpansionRequests =
		segmentId != null &&
		hasPendingExpansionRequestFiles(config.stateRoot, config.batchId, workerAgentId);

	if (isNonFinalSegment || hasPendingExpansionRequests) {
		// Segment succeeded but more segments remain — suppress .DONE and "✅ Complete" status.
		// The engine will advance the frontier and dispatch the next segment.
		// Also delete any .DONE the worker may have created directly (workers have
		// write access and sometimes create .DONE on their own, bypassing this gate).
		if (existsSync(donePath)) {
			let deleted = false;
			try {
				unlinkSync(donePath);
				deleted = true;
			} catch {
				/* best effort */
			}
			if (deleted) {
				logExecution(
					statusPath,
					"Segment complete",
					`Segment ${segmentId} succeeded (non-final — removed premature worker-created .DONE)`,
				);
			} else {
				logExecution(
					statusPath,
					"Segment complete",
					`⚠️ Segment ${segmentId} succeeded but FAILED to remove premature .DONE — downstream segments may be skipped`,
				);
			}
		} else {
			logExecution(
				statusPath,
				"Segment complete",
				`Segment ${segmentId} succeeded (not final — .DONE suppressed)`,
			);
		}
		const suppressionReason = isNonFinalSegment ? "non-final" : "pending expansion requests";
		return makeResult(
			taskId,
			segmentId,
			workerAgentId,
			"succeeded",
			startTime,
			`Segment completed (${suppressionReason} — .DONE suppressed)`,
			false,
			totalIterations,
			cumulativeCostUsd,
			cumulativeTokens,
			config,
			statusPath,
			reviewerStatePath,
			lastTelemetry,
			snapshotSegmentCtx,
		);
	}

	// ── #626 minimal finalize gate: no .DONE over an outstanding REVISE ───
	// Two live incidents merged unreviewed code: a worker self-released past a
	// REVISE cap and wrote .DONE (TP-2037), and this very checkbox heuristic
	// wrote .DONE for a correctly-holding worker (TP-2039). The gate: for each
	// review gate ({type}-step{N}), the LATEST review file's verdict must not be
	// REVISE/RETHINK. A re-review (higher R number) with APPROVE — or an
	// operator ratification recorded as the next R-numbered review file — clears
	// it. Steps with no reviews at all are not blocked here (full coverage gate
	// is #626's designed follow-up).
	const blockingGates = findBlockingReviewGates(unit.packet.reviewsDir);

	if (blockingGates.length > 0) {
		// Remove any worker-written .DONE (precedent: premature-.DONE removal in
		// the non-final-segment path above).
		if (existsSync(donePath)) {
			try {
				unlinkSync(donePath);
			} catch {
				/* best effort */
			}
		}
		const gateList = formatBlockingGates(blockingGates);
		logExecution(
			statusPath,
			"Finalize refused",
			`Review gate: latest verdict is not APPROVE — ${gateList}`,
		);
		if (config.onSupervisorAlert) {
			try {
				config.onSupervisorAlert({
					category: "review-intervention-needed",
					summary:
						`⛔ **Finalize refused** — ${taskId} (lane ${config.laneNumber}) attempted to ` +
						`complete with an outstanding non-APPROVE review: ${gateList}.\n` +
						`The task is marked failed instead of finalizing over the unresolved verdict. ` +
						`Adjudicate: have the worker address the findings and re-run review_step ` +
						`(orch_retry_task + orch_resume), or record an operator ratification as the ` +
						`next R-numbered review file with an explicit APPROVE verdict.`,
					context: {
						taskId,
						laneId: `lane-${config.laneNumber}`,
						laneNumber: config.laneNumber,
						agentId: workerAgentId,
						reviewInterventionKind: "unresolved-verdict",
						exitReason: `finalize refused: ${gateList}`,
					},
				});
			} catch {
				/* best effort */
			}
		}
		const refusal = makeResult(
			taskId,
			segmentId,
			workerAgentId,
			"failed",
			startTime,
			`Review gate: cannot finalize — latest review verdict is not APPROVE (${gateList})`,
			false,
			totalIterations,
			cumulativeCostUsd,
			cumulativeTokens,
			config,
			statusPath,
			reviewerStatePath,
			lastTelemetry,
			snapshotSegmentCtx,
		);
		// #629 side-effect 1: a governance refusal is NOT a crash. Attach a
		// structured diagnostic so tier-0 auto-retry, reports and the dashboard
		// can tell it apart (the worker exited cleanly; the review file must
		// change before a retry can succeed).
		const refusalDiagnostic: TaskExitDiagnostic = {
			classification: "review_gate_refusal",
			exitCode: 0,
			errorMessage: `finalize refused: ${gateList}`,
			tokensUsed: null,
			contextPct: null,
			partialProgressCommits: 0,
			partialProgressBranch: null,
			durationSec: Math.round((Date.now() - startTime) / 1000),
			lastKnownStep: null,
			lastKnownCheckbox: null,
			repoId: config.repoId ?? "default",
		};
		refusal.outcome.exitDiagnostic = refusalDiagnostic;
		return refusal;
	}

	// Create .DONE if not already present (final segment or single-segment/whole-task execution)
	if (!existsSync(donePath)) {
		writeFileSync(donePath, `Completed: ${new Date().toISOString()}\nTask: ${taskId}\n`);
	}
	updateStatusField(statusPath, "Status", "✅ Complete");
	logExecution(statusPath, "Task complete", ".DONE created");

	return makeResult(
		taskId,
		segmentId,
		workerAgentId,
		"succeeded",
		startTime,
		".DONE file created by lane-runner",
		true,
		totalIterations,
		cumulativeCostUsd,
		cumulativeTokens,
		config,
		statusPath,
		reviewerStatePath,
		lastTelemetry,
		snapshotSegmentCtx,
	);
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * TP-165: Check if the worker's outbox contains pending segment expansion requests.
 *
 * Pending expansion request files match `segment-expansion-*.json` (not renamed
 * to `.processed`, `.rejected`, etc.). If any exist, the engine will process them
 * at the segment boundary — and may add more segments to the task.
 *
 * @returns true if at least one pending expansion request file exists
 */
export function hasPendingExpansionRequestFiles(
	stateRoot: string,
	batchId: string,
	agentId: string,
): boolean {
	const outboxDir = join(stateRoot, ".pi", "mailbox", batchId, agentId, "outbox");
	if (!existsSync(outboxDir)) return false;
	try {
		const entries = readdirSync(outboxDir);
		return entries.some((entry) => /^segment-expansion-.+\.json$/.test(entry));
	} catch {
		return false;
	}
}

export function mapLaneTaskStatusToTerminalSnapshotStatus(
	status: LaneTaskStatus,
): "idle" | "complete" | "failed" {
	if (status === "succeeded") return "complete";
	if (status === "skipped") return "idle";
	return "failed";
}

export function mapLaneSnapshotStatusToWorkerStatus(
	status: "running" | "idle" | "complete" | "failed",
): RuntimeAgentStatus {
	if (status === "running") return "running";
	if (status === "complete") return "exited";
	if (status === "idle") return "wrapping_up";
	return "crashed";
}

function makeResult(
	taskId: string,
	segmentId: string | null,
	sessionName: string,
	status: LaneTaskStatus,
	startTime: number,
	exitReason: string,
	doneFileFound: boolean,
	iterations: number,
	costUsd: number,
	totalTokens: number,
	config?: LaneRunnerConfig,
	statusPath?: string,
	reviewerStatePath?: string,
	finalTelemetry?: Partial<AgentHostResult>,
	/** TP-174: Segment context for segment-scoped snapshot progress */
	segmentCtx?: { stepSegmentMap: StepSegmentMapping[]; repoId: string } | null,
): LaneRunnerTaskResult {
	const telemetry =
		status === "skipped"
			? undefined
			: {
					inputTokens: finalTelemetry?.inputTokens ?? 0,
					outputTokens: finalTelemetry?.outputTokens ?? 0,
					cacheReadTokens: finalTelemetry?.cacheReadTokens ?? 0,
					cacheWriteTokens: finalTelemetry?.cacheWriteTokens ?? 0,
					costUsd: finalTelemetry?.costUsd ?? 0,
					toolCalls: finalTelemetry?.toolCalls ?? 0,
					durationMs: finalTelemetry?.durationMs ?? 0,
				};

	const result: LaneRunnerTaskResult = {
		outcome: {
			taskId,
			status,
			segmentId,
			startTime,
			endTime: Date.now(),
			exitReason,
			sessionName,
			doneFileFound,
			laneNumber: config?.laneNumber,
			telemetry,
		},
		iterations,
		costUsd,
		totalTokens,
	};

	// TP-115: Emit terminal snapshot with real telemetry from agent-host result
	if (config && statusPath && reviewerStatePath) {
		const terminalStatus = mapLaneTaskStatusToTerminalSnapshotStatus(status);
		emitSnapshot(
			config,
			taskId,
			segmentId,
			terminalStatus,
			finalTelemetry ?? {},
			statusPath,
			reviewerStatePath,
			segmentCtx,
		);
	}

	return result;
}

/** Max age for reviewer state file before it's considered stale (2 minutes). */
const REVIEWER_STATE_STALE_MS = 120_000;

export function readReviewerTelemetrySnapshot(
	config: LaneRunnerConfig,
	reviewerStatePathOrStatusPath: string,
): (RuntimeAgentTelemetrySnapshot & { reviewType?: string; reviewStep?: number }) | null {
	const reviewerPath =
		basename(reviewerStatePathOrStatusPath).toLowerCase() === "status.md"
			? join(dirname(reviewerStatePathOrStatusPath), ".reviewer-state.json")
			: reviewerStatePathOrStatusPath;
	if (!existsSync(reviewerPath)) return null;

	try {
		const raw = readFileSync(reviewerPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<{
			status: string;
			elapsedMs: number;
			toolCalls: number;
			contextPct: number;
			costUsd: number;
			lastTool: string;
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens: number;
			cacheWriteTokens: number;
			updatedAt: number;
			reviewType: string;
			reviewStep: number;
		}>;

		if (parsed.status !== "running") return null;

		// Stale guard: if updatedAt is present and older than threshold, ignore
		if (parsed.updatedAt && Date.now() - parsed.updatedAt > REVIEWER_STATE_STALE_MS) return null;

		return {
			agentId: buildRuntimeAgentId(config.agentIdPrefix, config.laneNumber, "reviewer"),
			status: "running",
			elapsedMs: Number.isFinite(parsed.elapsedMs) ? Number(parsed.elapsedMs) : 0,
			toolCalls: Number.isFinite(parsed.toolCalls) ? Number(parsed.toolCalls) : 0,
			contextPct: Number.isFinite(parsed.contextPct) ? Number(parsed.contextPct) : 0,
			costUsd: Number.isFinite(parsed.costUsd) ? Number(parsed.costUsd) : 0,
			lastTool: typeof parsed.lastTool === "string" ? parsed.lastTool : "",
			inputTokens: Number.isFinite(parsed.inputTokens) ? Number(parsed.inputTokens) : 0,
			outputTokens: Number.isFinite(parsed.outputTokens) ? Number(parsed.outputTokens) : 0,
			cacheReadTokens: Number.isFinite(parsed.cacheReadTokens) ? Number(parsed.cacheReadTokens) : 0,
			cacheWriteTokens: Number.isFinite(parsed.cacheWriteTokens) ? Number(parsed.cacheWriteTokens) : 0,
			reviewType: typeof parsed.reviewType === "string" ? parsed.reviewType : undefined,
			reviewStep: Number.isFinite(parsed.reviewStep) ? Number(parsed.reviewStep) : undefined,
		};
	} catch {
		return null;
	}
}

/**
 * Emit a lane snapshot to disk. NON-THROWING by contract — all errors are
 * caught and logged. This function is called from setInterval callbacks
 * and onTelemetry callbacks where an unhandled throw would trigger
 * uncaughtException and crash the engine-worker process.
 *
 * @returns true when snapshot write succeeds, false when it fails.
 */
function emitSnapshot(
	config: LaneRunnerConfig,
	taskId: string,
	segmentId: string | null,
	status: "running" | "idle" | "complete" | "failed",
	telemetry: Partial<AgentHostResult>,
	statusPath: string,
	reviewerStatePath: string,
	/** TP-174: Optional segment context for segment-scoped progress reporting */
	segmentContext?: { stepSegmentMap: StepSegmentMapping[]; repoId: string } | null,
): boolean {
	try {
		// Parse progress from STATUS.md
		let progress: RuntimeTaskProgress | null = null;
		try {
			const content = readFileSync(statusPath, "utf-8");
			const parsed = parseStatusMd(content);
			const currentStepMatch = content.match(/\*\*Current Step:\*\*\s*(.+)/);

			// TP-174: Segment-scoped progress when segment markers are present.
			// Only count checkboxes from steps that belong to this segment's repoId.
			let checked: number;
			let total: number;
			if (segmentContext) {
				const { stepSegmentMap, repoId } = segmentContext;
				const repoSteps = getStepsForRepoId(stepSegmentMap, repoId);
				let segChecked = 0;
				let segTotal = 0;
				for (const stepNum of repoSteps) {
					const segCbs = getSegmentCheckboxes(content, stepNum, repoId);
					if (segCbs) {
						segChecked += segCbs.checked;
						segTotal += segCbs.total;
					}
				}
				checked = segChecked;
				total = segTotal;
			} else {
				checked = parsed.steps.reduce((sum, s) => sum + s.totalChecked, 0);
				total = parsed.steps.reduce((sum, s) => sum + s.totalItems, 0);
			}

			progress = {
				currentStep: currentStepMatch?.[1]?.trim() || "Unknown",
				checked,
				total,
				iteration: parsed.iteration,
				reviews: parsed.reviewCounter,
			};
		} catch {
			/* best effort */
		}

		const reviewerSnapshot = readReviewerTelemetrySnapshot(config, reviewerStatePath);

		const snapshot: RuntimeLaneSnapshot = {
			batchId: config.batchId,
			laneNumber: config.laneNumber,
			laneId: `lane-${config.laneNumber}`,
			repoId: config.repoId,
			taskId,
			segmentId,
			status,
			worker: {
				agentId: buildRuntimeAgentId(config.agentIdPrefix, config.laneNumber, "worker"),
				status: mapLaneSnapshotStatusToWorkerStatus(status),
				elapsedMs: telemetry.durationMs ?? 0,
				toolCalls: telemetry.toolCalls ?? 0,
				contextPct: telemetry.contextUsage?.percent ?? 0,
				costUsd: telemetry.costUsd ?? 0,
				lastTool: telemetry.lastTool ?? "",
				inputTokens: telemetry.inputTokens ?? 0,
				outputTokens: telemetry.outputTokens ?? 0,
				cacheReadTokens: telemetry.cacheReadTokens ?? 0,
				cacheWriteTokens: telemetry.cacheWriteTokens ?? 0,
			},
			reviewer: reviewerSnapshot,
			progress,
			updatedAt: Date.now(),
		};

		writeLaneSnapshot(config.stateRoot, config.batchId, config.laneNumber, snapshot as any);
		return true;
	} catch {
		// Non-fatal: snapshot is telemetry, not execution-critical.
		// Swallow to prevent uncaughtException crash in setInterval/callback contexts.
		return false;
	}
}
