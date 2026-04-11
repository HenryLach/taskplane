/**
 * Main batch execution engine
 * @module orch/engine
 */
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from "fs";
import { join, resolve } from "path";

import { formatDiscoveryResults, runDiscovery } from "./discovery.ts";
import { buildReviewerEnv, computeTransitiveDependents, execLog, executeLaneV2, executeWave, killV2LaneAgents } from "./execution.ts";
import type { RuntimeBackend } from "./execution.ts";
import type { MonitorUpdateCallback } from "./execution.ts";
// classifyExit no longer called directly — Tier 0 uses exitDiagnostic.classification
// from the diagnostic-reports pipeline (populated by assembleDiagnosticInput).
import { getCurrentBranch, runGit } from "./git.ts";
import { killAllMergeAgentsV2, mergeWaveByRepo, MergeHealthMonitor } from "./merge.ts";
import { applyMergeRetryLoop, computeCleanupGatePolicy, computeMergeFailurePolicy, extractFailedRepoId, formatRepoMergeSummary, ORCH_MESSAGES } from "./messages.ts";
import type { CleanupGateRepoFailure } from "./messages.ts";
import { assembleDiagnosticInput, emitDiagnosticReports } from "./diagnostic-reports.ts";
import { resolveOperatorId } from "./naming.ts";
import { applyPartialProgressToOutcomes, buildTier0EventBase, deleteBatchState, emitEngineEvent, emitTier0Event, loadBatchHistory, loadBatchState, persistRuntimeState, saveBatchHistory, seedPendingOutcomesForAllocatedLanes, syncTaskOutcomesFromMonitor, upsertTaskOutcome } from "./persistence.ts";
import { readRegistrySnapshot, isTerminalStatus, isProcessAlive as registryIsProcessAlive } from "./process-registry.ts";
import { buildBatchProgressSnapshot, buildEngineEventBase, buildSegmentId, buildSupervisorSegmentFrontierSnapshot, defaultResilienceState, FATAL_DISCOVERY_CODES, generateBatchId, TIER0_RETRYABLE_CLASSIFICATIONS, TIER0_RETRY_BUDGETS, tier0ScopeKey, tier0WaveScopeKey } from "./types.ts";
import type { AllocatedLane, AllocatedTask, BatchHistorySummary, BatchTaskSummary, BatchWaveSummary, DiscoveryResult, EngineEventCallback, EscalationContext, LaneExecutionResult, LaneTaskOutcome, MergeWaveResult, OrchBatchPhase, OrchBatchRuntimeState, OrchestratorConfig, ParsedTask, PersistedSegmentRecord, SegmentExpansionRequest, SupervisorAlert, SupervisorAlertCallback, TaskRunnerConfig, TaskSegmentPlan, TaskSegmentPlanMap, TaskSegmentNode, Tier0EscalationPattern, Tier0RecoveryPattern, TokenCounts, WaveExecutionResult, WorkspaceConfig } from "./types.ts";
import { buildDependencyGraph, computeWaveAssignments, resolveBaseBranch, resolveRepoRoot, validateGraph } from "./waves.ts";
import { deleteBranchBestEffort, forceCleanupWorktree, formatPreflightResults, listWorktrees, preserveFailedLaneProgress, preserveSkippedLaneProgress, removeAllWorktrees, removeWorktree, runPreflight, safeResetWorktree, sleepSync } from "./worktree.ts";
import { runPreflightCleanup, formatPreflightCleanup } from "./cleanup.ts";

// ── Tier 0: Automatic Recovery Helpers (TP-039) ─────────────────────

/**
 * Emit a `tier0_escalation` event with a typed `EscalationContext` payload.
 *
 * Called at every exhaustion path alongside the existing `tier0_recovery_exhausted`
 * event.  The escalation event carries a structured payload for the future
 * supervisor agent (TP-041).  In Tier 0, no automated action is taken on the
 * escalation — the engine falls through to its existing pause behaviour.
 *
 * @since TP-039
 */
function emitTier0Escalation(
	stateRoot: string,
	batchId: string,
	waveIndex: number,
	pattern: Tier0EscalationPattern,
	attempts: number,
	maxAttempts: number,
	lastError: string,
	affectedTasks: string[],
	suggestion: string,
	extra?: Partial<Pick<import("./persistence.ts").Tier0Event, "taskId" | "laneNumber" | "repoId" | "classification" | "scopeKey">>,
): void {
	const escalation: EscalationContext = {
		pattern,
		attempts,
		maxAttempts,
		lastError,
		affectedTasks,
		suggestion,
	};
	emitTier0Event(stateRoot, {
		...buildTier0EventBase("tier0_escalation", batchId, waveIndex, pattern, attempts, maxAttempts),
		...extra,
		escalation,
	});
}

/** Zero-token sentinel used for task/wave/batch aggregation. */
const ZERO_TOKENS: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };

/** Map embedded outcome telemetry to the batch-history TokenCounts shape. */
export function taskTokensFromOutcomeTelemetry(outcome: LaneTaskOutcome): TokenCounts {
	const telemetry = outcome.telemetry;
	if (!telemetry) return { ...ZERO_TOKENS };
	return {
		input: telemetry.inputTokens,
		output: telemetry.outputTokens,
		cacheRead: telemetry.cacheReadTokens,
		cacheWrite: telemetry.cacheWriteTokens,
		costUsd: telemetry.costUsd,
	};
}

/**
 * Resolve per-task token counts for batch history.
 *
 * Priority:
 * 1) Embedded `LaneTaskOutcome.telemetry` (authoritative Runtime V2 path)
 * 2) V2 lane snapshot fallback by numeric laneNumber (legacy outcomes)
 * 3) Legacy lane-state sidecar keys by sessionName prefix
 * 4) Zero tokens
 */
export function resolveBatchHistoryTaskTokens(
	outcome: LaneTaskOutcome,
	laneNumber: number,
	v2LaneTokensByNumber: Map<number, TokenCounts>,
	legacyLaneTokensByKey: Map<string, TokenCounts>,
): TokenCounts {
	// Skipped tasks did not run an agent process.
	if (outcome.status === "skipped") return { ...ZERO_TOKENS };

	if (outcome.telemetry) {
		return taskTokensFromOutcomeTelemetry(outcome);
	}

	if (laneNumber > 0) {
		const v2 = v2LaneTokensByNumber.get(laneNumber);
		if (v2) return v2;
	}

	const bySession = legacyLaneTokensByKey.get(outcome.sessionName)
		|| legacyLaneTokensByKey.get(outcome.sessionName?.replace(/-(?:worker|reviewer)$/, ""));
	if (bySession) return bySession;

	if (laneNumber > 0) {
		const byLaneKey = legacyLaneTokensByKey.get(`lane-${laneNumber}`);
		if (byLaneKey) return byLaneKey;
	}

	return { ...ZERO_TOKENS };
}

// ── Segment Frontier Helpers (TP-133) ───────────────────────────────

type SegmentLifecycleStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

interface SegmentFrontierTaskState {
	taskId: string;
	orderedSegments: TaskSegmentNode[];
	nextSegmentIndex: number;
	statusBySegmentId: Map<string, SegmentLifecycleStatus>;
	dependsOnBySegmentId: Map<string, string[]>;
	terminalStatus: "pending" | "succeeded" | "failed" | "skipped";
}

function buildSegmentDependencyMap(plan: TaskSegmentPlan): Map<string, string[]> {
	const depsBySegmentId = new Map<string, string[]>();
	for (const segment of plan.segments) {
		depsBySegmentId.set(segment.segmentId, []);
	}
	for (const edge of plan.edges) {
		if (!depsBySegmentId.has(edge.toSegmentId)) continue;
		depsBySegmentId.get(edge.toSegmentId)!.push(edge.fromSegmentId);
	}
	for (const [segmentId, deps] of depsBySegmentId.entries()) {
		depsBySegmentId.set(segmentId, [...new Set(deps)].sort((a, b) => a.localeCompare(b)));
	}
	return depsBySegmentId;
}

function resolveTaskWorkerAgentId(
	taskId: string,
	allTaskOutcomes: LaneTaskOutcome[],
	laneByTaskId: Map<string, AllocatedLane>,
): string | null {
	const outcome = allTaskOutcomes.find((candidate) => candidate.taskId === taskId);
	if (outcome?.sessionName) {
		return outcome.sessionName;
	}
	const lane = laneByTaskId.get(taskId);
	return lane?.laneSessionId ?? null;
}

function listPendingSegmentExpansionRequestFiles(stateRoot: string, batchId: string, agentId: string): string[] {
	const outboxDir = join(stateRoot, ".pi", "mailbox", batchId, agentId, "outbox");
	if (!existsSync(outboxDir)) return [];
	let entries: string[] = [];
	try {
		entries = readdirSync(outboxDir);
	} catch {
		return [];
	}
	return entries
		.filter((entry) => /^segment-expansion-.+\.json$/.test(entry))
		.sort((a, b) => a.localeCompare(b))
		.map((entry) => join(outboxDir, entry));
}

interface PendingSegmentExpansionRequest {
	filePath: string;
	request: SegmentExpansionRequest;
}

interface SegmentExpansionParseFailure {
	filePath: string;
	reason: string;
}

function parseSegmentExpansionRequestPayload(payload: unknown): SegmentExpansionRequest | null {
	if (!payload || typeof payload !== "object") return null;
	const candidate = payload as Record<string, unknown>;
	if (typeof candidate.requestId !== "string" || !candidate.requestId.trim()) return null;
	if (typeof candidate.taskId !== "string" || !candidate.taskId.trim()) return null;
	if (typeof candidate.fromSegmentId !== "string" || !candidate.fromSegmentId.trim()) return null;
	if (!Array.isArray(candidate.requestedRepoIds) || candidate.requestedRepoIds.length === 0 || candidate.requestedRepoIds.some((repoId) => typeof repoId !== "string" || !repoId.trim())) return null;
	if (typeof candidate.rationale !== "string") return null;
	if (candidate.placement !== "after-current" && candidate.placement !== "end") return null;
	if (!Array.isArray(candidate.edges)) return null;
	for (const edge of candidate.edges) {
		if (!edge || typeof edge !== "object") return null;
		const typedEdge = edge as Record<string, unknown>;
		if (typeof typedEdge.from !== "string" || !typedEdge.from.trim()) return null;
		if (typeof typedEdge.to !== "string" || !typedEdge.to.trim()) return null;
	}
	if (typeof candidate.timestamp !== "number" || !Number.isFinite(candidate.timestamp)) return null;
	return {
		requestId: candidate.requestId,
		taskId: candidate.taskId,
		fromSegmentId: candidate.fromSegmentId as SegmentExpansionRequest["fromSegmentId"],
		requestedRepoIds: candidate.requestedRepoIds as string[],
		rationale: candidate.rationale,
		placement: candidate.placement,
		edges: candidate.edges as SegmentExpansionRequest["edges"],
		timestamp: candidate.timestamp,
	};
}

function parseSegmentExpansionRequests(filePaths: string[]): {
	valid: PendingSegmentExpansionRequest[];
	malformed: SegmentExpansionParseFailure[];
} {
	const valid: PendingSegmentExpansionRequest[] = [];
	const malformed: SegmentExpansionParseFailure[] = [];

	for (const filePath of filePaths) {
		let raw = "";
		try {
			raw = readFileSync(filePath, "utf-8");
		} catch (err) {
			malformed.push({
				filePath,
				reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
			});
			continue;
		}

		let payload: unknown;
		try {
			payload = JSON.parse(raw);
		} catch (err) {
			malformed.push({
				filePath,
				reason: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
			});
			continue;
		}

		const parsed = parseSegmentExpansionRequestPayload(payload);
		if (!parsed) {
			malformed.push({
				filePath,
				reason: "schema validation failed",
			});
			continue;
		}

		valid.push({
			filePath,
			request: parsed,
		});
	}

	return { valid, malformed };
}

function markSegmentExpansionRequestFile(filePath: string, stateSuffix: "invalid" | "discarded" | "rejected" | "processed"): boolean {
	try {
		renameSync(filePath, `${filePath}.${stateSuffix}`);
		return true;
	} catch {
		return false;
	}
}

export function expansionRequestHasCycle(request: SegmentExpansionRequest): boolean {
	const requestedRepoIds = [...new Set(request.requestedRepoIds)];
	const indegree = new Map<string, number>();
	const outgoing = new Map<string, string[]>();
	for (const repoId of requestedRepoIds) {
		indegree.set(repoId, 0);
		outgoing.set(repoId, []);
	}
	for (const edge of request.edges) {
		if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
		outgoing.get(edge.from)!.push(edge.to);
		indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
	}

	const ready = [...requestedRepoIds]
		.filter((repoId) => (indegree.get(repoId) ?? 0) === 0)
		.sort((a, b) => a.localeCompare(b));
	let visited = 0;
	while (ready.length > 0) {
		const next = ready.shift()!;
		visited += 1;
		for (const dep of outgoing.get(next) ?? []) {
			const count = (indegree.get(dep) ?? 0) - 1;
			indegree.set(dep, count);
			if (count === 0) {
				ready.push(dep);
				ready.sort((a, b) => a.localeCompare(b));
			}
		}
	}

	return visited !== requestedRepoIds.length;
}

export function validateSegmentExpansionRequestAtBoundary(
	requestFile: PendingSegmentExpansionRequest,
	taskId: string,
	segmentId: string,
	segmentState: SegmentFrontierTaskState,
	workspaceConfig: WorkspaceConfig | null | undefined,
	knownRequestIds: ReadonlySet<string>,
): string | null {
	const request = requestFile.request;
	if (request.taskId !== taskId || request.fromSegmentId !== segmentId) {
		return "request does not match the active segment boundary";
	}
	if (segmentState.terminalStatus !== "pending") {
		return "task is already in terminal state";
	}
	if (request.placement !== "after-current" && request.placement !== "end") {
		return `unsupported placement \"${request.placement}\"`;
	}

	if (knownRequestIds.has(request.requestId)) {
		return `requestId \"${request.requestId}\" already processed`;
	}

	if (workspaceConfig) {
		for (const repoId of request.requestedRepoIds) {
			if (!workspaceConfig.repos.has(repoId)) {
				return `unknown repoId \"${repoId}\"`;
			}
		}
	} else {
		for (const repoId of request.requestedRepoIds) {
			if (repoId !== "default") {
				return `repo expansion requires workspace mode (unknown repoId \"${repoId}\")`;
			}
		}
	}

	const requestedRepoSet = new Set(request.requestedRepoIds);
	if (requestedRepoSet.size !== request.requestedRepoIds.length) {
		return "duplicate repoIds in requestedRepoIds";
	}

	// TP-145: Build a set of known repo IDs that edge endpoints may reference.
	// This includes all requestedRepoIds plus the anchor segment's repo and
	// any already-completed segments' repos. Workers commonly reference the
	// anchor repo in edges (e.g., { from: "shared-libs", to: "web-client" })
	// which is valid — the dependency is implicit for after-current placement.
	const knownEdgeRepoIds = new Set(requestedRepoSet);
	const orderedSegments = segmentState.orderedSegments ?? [];
	const anchorSegment = orderedSegments.find((seg) => seg.segmentId === segmentId);
	if (anchorSegment) {
		knownEdgeRepoIds.add(anchorSegment.repoId);
	}
	for (const seg of orderedSegments) {
		const status = segmentState.statusBySegmentId?.get(seg.segmentId);
		if (status === "succeeded" || status === "failed" || status === "skipped") {
			knownEdgeRepoIds.add(seg.repoId);
		}
	}

	for (const edge of request.edges) {
		if (!knownEdgeRepoIds.has(edge.from) || !knownEdgeRepoIds.has(edge.to)) {
			return "edge references a repo outside requestedRepoIds and known segments";
		}
	}

	if (expansionRequestHasCycle(request)) {
		return "expansion request introduces a cycle in requested edges";
	}

	return null;
}

export function processSegmentExpansionRequestAtBoundary(
	batchId: string,
	taskId: string,
	segmentId: string,
	agentId: string,
	requestFile: PendingSegmentExpansionRequest,
	segmentState: SegmentFrontierTaskState,
	workspaceConfig: WorkspaceConfig | null | undefined,
	knownRequestIds: Set<string>,
): { ok: true } | { ok: false; reason: string } {
	const validationFailure = validateSegmentExpansionRequestAtBoundary(
		requestFile,
		taskId,
		segmentId,
		segmentState,
		workspaceConfig,
		knownRequestIds,
	);
	if (validationFailure) {
		return { ok: false, reason: validationFailure };
	}

	knownRequestIds.add(requestFile.request.requestId);
	execLog("batch", batchId, "segment expansion request handed off for graph mutation", {
		taskId,
		segmentId,
		agentId,
		requestId: requestFile.request.requestId,
		placement: requestFile.request.placement,
		requestedRepoIds: requestFile.request.requestedRepoIds.join(","),
		requestFile: requestFile.filePath,
	});
	return { ok: true };
}

function buildOutgoingBySegmentId(dependsOnBySegmentId: Map<string, string[]>): Map<string, string[]> {
	const outgoingBySegmentId = new Map<string, string[]>();
	for (const segmentId of dependsOnBySegmentId.keys()) {
		outgoingBySegmentId.set(segmentId, []);
	}
	for (const [segmentId, deps] of dependsOnBySegmentId.entries()) {
		for (const dep of deps) {
			const outgoing = outgoingBySegmentId.get(dep) ?? [];
			outgoing.push(segmentId);
			outgoingBySegmentId.set(dep, outgoing);
		}
	}
	for (const [segmentId, outgoing] of outgoingBySegmentId.entries()) {
		outgoingBySegmentId.set(segmentId, [...new Set(outgoing)].sort((a, b) => a.localeCompare(b)));
	}
	return outgoingBySegmentId;
}

function addDependency(dependencyMap: Map<string, string[]>, segmentId: string, depSegmentId: string): void {
	const deps = dependencyMap.get(segmentId) ?? [];
	if (!deps.includes(depSegmentId)) {
		deps.push(depSegmentId);
		deps.sort((a, b) => a.localeCompare(b));
		dependencyMap.set(segmentId, deps);
	}
}

function removeDependency(dependencyMap: Map<string, string[]>, segmentId: string, depSegmentId: string): void {
	const deps = dependencyMap.get(segmentId) ?? [];
	const filtered = deps.filter((dep) => dep !== depSegmentId);
	dependencyMap.set(segmentId, filtered);
}

function recomputeNextPendingSegmentIndex(segmentState: SegmentFrontierTaskState): void {
	const nextPendingIndex = segmentState.orderedSegments.findIndex((segment) => {
		return segmentState.statusBySegmentId.get(segment.segmentId) === "pending";
	});
	segmentState.nextSegmentIndex = nextPendingIndex >= 0
		? nextPendingIndex
		: segmentState.orderedSegments.length;
}

function hasTaskInFutureSegmentRounds(segmentRounds: string[][], fromIndex: number, taskId: string): boolean {
	for (let idx = fromIndex; idx < segmentRounds.length; idx++) {
		if (segmentRounds[idx]?.includes(taskId)) {
			return true;
		}
	}
	return false;
}

/**
 * Insert one deterministic continuation segment round immediately after the
 * current wave when expansion creates executable pending work beyond planned rounds.
 */
export function scheduleContinuationSegmentRound(
	segmentRounds: string[][],
	currentWaveIndex: number,
	taskIds: Iterable<string>,
): string[] {
	const continuationWave = [...new Set(taskIds)].sort((a, b) => a.localeCompare(b));
	if (continuationWave.length === 0) {
		return [];
	}
	segmentRounds.splice(currentWaveIndex + 1, 0, continuationWave);
	return continuationWave;
}

function buildRepoMaxSequenceByRepo(
	orderedSegments: TaskSegmentNode[],
	taskId: string,
): Map<string, number> {
	const maxSequenceByRepo = new Map<string, number>();
	for (const segment of orderedSegments) {
		const repoId = segment.repoId;
		const basePrefix = `${taskId}::${repoId}`;
		let sequence = 1;
		if (segment.segmentId.startsWith(`${basePrefix}::`)) {
			const suffix = segment.segmentId.slice(`${basePrefix}::`.length);
			const parsed = Number.parseInt(suffix, 10);
			if (Number.isFinite(parsed) && parsed >= 2) {
				sequence = parsed;
			}
		}
		const currentMax = maxSequenceByRepo.get(repoId) ?? 0;
		maxSequenceByRepo.set(repoId, Math.max(currentMax, sequence));
	}
	return maxSequenceByRepo;
}

/**
 * Apply one approved segment-expansion request to a task frontier DAG.
 *
 * Implements after-current/end rewiring, repeat-repo segment ID disambiguation,
 * deterministic topological reordering, and pending-state insertion.
 */
export function applySegmentExpansionMutation(
	segmentState: SegmentFrontierTaskState,
	request: SegmentExpansionRequest,
	anchorSegmentId: string,
): { insertedSegmentIds: string[] } {
	const existingNodeById = new Map<string, TaskSegmentNode>();
	for (const segment of segmentState.orderedSegments) {
		existingNodeById.set(segment.segmentId, segment);
	}

	const dependencyMap = new Map<string, string[]>();
	for (const [segmentId, deps] of segmentState.dependsOnBySegmentId.entries()) {
		dependencyMap.set(segmentId, [...new Set(deps)].sort((a, b) => a.localeCompare(b)));
	}
	for (const segmentId of existingNodeById.keys()) {
		if (!dependencyMap.has(segmentId)) {
			dependencyMap.set(segmentId, []);
		}
	}

	// Snapshot original state for rollback on topo-sort failure
	const originalOrderedSegments = [...segmentState.orderedSegments];
	const originalDeps = new Map<string, string[]>();
	for (const [k, v] of dependencyMap) originalDeps.set(k, [...v]);

	const outgoingBeforeMutation = buildOutgoingBySegmentId(dependencyMap);
	const anchorSuccessors = outgoingBeforeMutation.get(anchorSegmentId) ?? [];
	const maxOrder = segmentState.orderedSegments.reduce((max, segment) => Math.max(max, segment.order), -1);
	const repoMaxSequenceByRepo = buildRepoMaxSequenceByRepo(segmentState.orderedSegments, request.taskId);

	const newNodes: TaskSegmentNode[] = [];
	const segmentIdByRequestedRepoId = new Map<string, string>();
	for (const [idx, repoId] of request.requestedRepoIds.entries()) {
		const nextSequence = (repoMaxSequenceByRepo.get(repoId) ?? 0) + 1;
		repoMaxSequenceByRepo.set(repoId, nextSequence);
		const segmentId = buildSegmentId(request.taskId, repoId, nextSequence);
		segmentIdByRequestedRepoId.set(repoId, segmentId);
		const node: TaskSegmentNode = {
			segmentId,
			taskId: request.taskId,
			repoId,
			order: maxOrder + idx + 1,
		};
		newNodes.push(node);
		existingNodeById.set(node.segmentId, node);
		dependencyMap.set(node.segmentId, []);
	}

	for (const edge of request.edges) {
		const fromSegmentId = segmentIdByRequestedRepoId.get(edge.from);
		const toSegmentId = segmentIdByRequestedRepoId.get(edge.to);
		if (!fromSegmentId || !toSegmentId) continue;
		addDependency(dependencyMap, toSegmentId, fromSegmentId);
	}

	const internalIncomingCounts = new Map<string, number>();
	const internalOutgoingCounts = new Map<string, number>();
	for (const node of newNodes) {
		internalIncomingCounts.set(node.segmentId, 0);
		internalOutgoingCounts.set(node.segmentId, 0);
	}
	for (const edge of request.edges) {
		const fromSegmentId = segmentIdByRequestedRepoId.get(edge.from);
		const toSegmentId = segmentIdByRequestedRepoId.get(edge.to);
		if (!fromSegmentId || !toSegmentId) continue;
		internalOutgoingCounts.set(fromSegmentId, (internalOutgoingCounts.get(fromSegmentId) ?? 0) + 1);
		internalIncomingCounts.set(toSegmentId, (internalIncomingCounts.get(toSegmentId) ?? 0) + 1);
	}

	const roots = newNodes
		.filter((node) => (internalIncomingCounts.get(node.segmentId) ?? 0) === 0)
		.map((node) => node.segmentId)
		.sort((a, b) => a.localeCompare(b));
	const sinks = newNodes
		.filter((node) => (internalOutgoingCounts.get(node.segmentId) ?? 0) === 0)
		.map((node) => node.segmentId)
		.sort((a, b) => a.localeCompare(b));

	if (request.placement === "after-current") {
		for (const root of roots) {
			addDependency(dependencyMap, root, anchorSegmentId);
		}
		for (const successor of anchorSuccessors) {
			removeDependency(dependencyMap, successor, anchorSegmentId);
			for (const sink of sinks) {
				addDependency(dependencyMap, successor, sink);
			}
		}
	} else {
		const terminals = segmentState.orderedSegments
			.map((segment) => segment.segmentId)
			.filter((segmentId) => (outgoingBeforeMutation.get(segmentId) ?? []).length === 0)
			.sort((a, b) => a.localeCompare(b));
		for (const root of roots) {
			for (const terminal of terminals) {
				if (terminal === root) continue;
				addDependency(dependencyMap, root, terminal);
			}
		}
	}

	const priorityBySegmentId = new Map<string, number>();
	for (const [idx, segment] of segmentState.orderedSegments.entries()) {
		priorityBySegmentId.set(segment.segmentId, idx);
	}
	for (const [idx, node] of newNodes.entries()) {
		priorityBySegmentId.set(node.segmentId, segmentState.orderedSegments.length + idx);
	}

	const outgoing = buildOutgoingBySegmentId(dependencyMap);
	const indegree = new Map<string, number>();
	for (const [segmentId, deps] of dependencyMap.entries()) {
		indegree.set(segmentId, deps.length);
	}
	const ready = [...dependencyMap.keys()]
		.filter((segmentId) => (indegree.get(segmentId) ?? 0) === 0)
		.sort((a, b) => {
			const aPriority = priorityBySegmentId.get(a) ?? Number.MAX_SAFE_INTEGER;
			const bPriority = priorityBySegmentId.get(b) ?? Number.MAX_SAFE_INTEGER;
			if (aPriority !== bPriority) return aPriority - bPriority;
			return a.localeCompare(b);
		});

	const nextOrderedSegmentIds: string[] = [];
	while (ready.length > 0) {
		const nextSegmentId = ready.shift()!;
		nextOrderedSegmentIds.push(nextSegmentId);
		for (const depSegmentId of outgoing.get(nextSegmentId) ?? []) {
			const count = (indegree.get(depSegmentId) ?? 0) - 1;
			indegree.set(depSegmentId, count);
			if (count === 0) {
				ready.push(depSegmentId);
				ready.sort((a, b) => {
					const aPriority = priorityBySegmentId.get(a) ?? Number.MAX_SAFE_INTEGER;
					const bPriority = priorityBySegmentId.get(b) ?? Number.MAX_SAFE_INTEGER;
					if (aPriority !== bPriority) return aPriority - bPriority;
					return a.localeCompare(b);
				});
			}
		}
	}

	if (nextOrderedSegmentIds.length !== dependencyMap.size) {
		// Topological sort failed to cover all nodes — likely a cycle introduced
		// by the expansion. Reject the mutation entirely and restore original state.
		execLog("batch", request.taskId, "segment expansion rejected: topological sort failed (possible cycle)", {
			expected: dependencyMap.size,
			covered: nextOrderedSegmentIds.length,
		});
		// Full rollback to pre-mutation state
		for (const node of newNodes) {
			segmentState.statusBySegmentId.delete(node.segmentId);
		}
		segmentState.orderedSegments = originalOrderedSegments;
		segmentState.dependsOnBySegmentId = originalDeps;
		return { insertedSegmentIds: [] };
	}
	const finalOrderedSegmentIds = nextOrderedSegmentIds;

	const nextOrderedSegments = finalOrderedSegmentIds
		.map((segmentId, idx) => {
			const segment = existingNodeById.get(segmentId);
			if (!segment) return null;
			return {
				...segment,
				order: idx,
			};
		})
		.filter((segment): segment is TaskSegmentNode => segment !== null);

	segmentState.orderedSegments = nextOrderedSegments;
	segmentState.dependsOnBySegmentId = dependencyMap;
	for (const node of newNodes) {
		segmentState.statusBySegmentId.set(node.segmentId, "pending");
	}
	recomputeNextPendingSegmentIndex(segmentState);

	return {
		insertedSegmentIds: newNodes.map((node) => node.segmentId),
	};
}

function handoffSegmentExpansionToMutation(
	batchId: string,
	taskId: string,
	segmentId: string,
	agentId: string,
	requestFile: PendingSegmentExpansionRequest,
	segmentState: SegmentFrontierTaskState,
): { insertedSegmentIds: string[] } {
	const mutation = applySegmentExpansionMutation(segmentState, requestFile.request, segmentId);
	execLog("batch", batchId, "segment expansion request accepted for mutation path", {
		taskId,
		segmentId,
		agentId,
		requestId: requestFile.request.requestId,
		placement: requestFile.request.placement,
		requestedRepoIds: requestFile.request.requestedRepoIds.join(","),
		insertedSegments: mutation.insertedSegmentIds.join(","),
	});
	return mutation;
}

function ensureSegmentRecords(batchState: OrchBatchRuntimeState): PersistedSegmentRecord[] {
	if (!batchState.segments) {
		batchState.segments = [];
	}
	return batchState.segments;
}

/**
 * Persist pending segment records for an approved expansion and resync dependency
 * metadata for existing pending records touched by subsequent rewires.
 */
export function upsertPendingExpandedSegmentRecords(
	batchState: OrchBatchRuntimeState,
	task: ParsedTask,
	segmentState: SegmentFrontierTaskState,
	insertedSegmentIds: string[],
	expandedFrom: string,
	expansionRequestId: string,
	fallbackBranch: string,
): boolean {
	const insertedSegmentIdSet = new Set(insertedSegmentIds);
	const pendingSegmentIds = segmentState.orderedSegments
		.filter((segment) => segmentState.statusBySegmentId.get(segment.segmentId) === "pending")
		.map((segment) => segment.segmentId);
	if (pendingSegmentIds.length === 0) return false;

	const segmentRecords = ensureSegmentRecords(batchState);
	let changed = false;

	for (const segmentId of pendingSegmentIds) {
		const segment = segmentState.orderedSegments.find((candidate) => candidate.segmentId === segmentId);
		if (!segment) continue;
		const existing = segmentRecords.find((record) => record.segmentId === segmentId);
		if (!existing && !insertedSegmentIdSet.has(segmentId)) {
			continue;
		}

		const dependsOnSegmentIds = segmentState.dependsOnBySegmentId.get(segmentId) ?? [];
		const nextExpandedFrom = insertedSegmentIdSet.has(segmentId)
			? expandedFrom
			: existing?.expandedFrom;
		const nextExpansionRequestId = insertedSegmentIdSet.has(segmentId)
			? expansionRequestId
			: existing?.expansionRequestId;
		const next: PersistedSegmentRecord = {
			segmentId,
			taskId: task.taskId,
			repoId: segment.repoId,
			status: "pending",
			laneId: existing?.laneId ?? "",
			sessionName: existing?.sessionName ?? "",
			worktreePath: existing?.worktreePath ?? "",
			branch: existing?.branch ?? fallbackBranch,
			startedAt: null,
			endedAt: null,
			retries: existing?.retries ?? 0,
			exitReason: existing?.exitReason ?? "Segment pending",
			dependsOnSegmentIds,
			expandedFrom: nextExpandedFrom,
			expansionRequestId: nextExpansionRequestId,
		};

		if (!existing) {
			segmentRecords.push(next);
			changed = true;
			continue;
		}

		const recordChanged =
			existing.taskId !== next.taskId
			|| existing.repoId !== next.repoId
			|| existing.status !== next.status
			|| existing.laneId !== next.laneId
			|| existing.sessionName !== next.sessionName
			|| existing.worktreePath !== next.worktreePath
			|| existing.branch !== next.branch
			|| existing.startedAt !== next.startedAt
			|| existing.endedAt !== next.endedAt
			|| existing.retries !== next.retries
			|| existing.exitReason !== next.exitReason
			|| existing.dependsOnSegmentIds.length !== next.dependsOnSegmentIds.length
			|| existing.dependsOnSegmentIds.some((depSegmentId, idx) => depSegmentId !== next.dependsOnSegmentIds[idx])
			|| existing.expandedFrom !== next.expandedFrom
			|| existing.expansionRequestId !== next.expansionRequestId;

		if (recordChanged) {
			Object.assign(existing, next);
			changed = true;
		}
	}

	return changed;
}

/**
 * Rebuild the in-memory idempotency set from persisted resilience repair history.
 * Used on start/resume to prevent replay of already-processed expansion requests.
 */
export function collectProcessedSegmentExpansionRequestIds(
	batchState: Pick<OrchBatchRuntimeState, "resilience">,
): Set<string> {
	return new Set<string>(
		(batchState.resilience?.repairHistory ?? [])
			.filter((entry) => entry.strategy === "segment-expansion-request")
			.map((entry) => entry.id),
	);
}

function recordProcessedSegmentExpansionRequestId(
	batchState: OrchBatchRuntimeState,
	requestId: string,
	status: "succeeded" | "failed" | "skipped",
): boolean {
	if (!batchState.resilience) {
		batchState.resilience = defaultResilienceState();
	}
	const history = batchState.resilience.repairHistory;
	if (history.some((entry) => entry.strategy === "segment-expansion-request" && entry.id === requestId)) {
		return false;
	}
	const now = Date.now();
	history.push({
		id: requestId,
		strategy: "segment-expansion-request",
		status,
		startedAt: now,
		endedAt: now,
	});
	return true;
}

function upsertRunningSegmentRecord(
	batchState: OrchBatchRuntimeState,
	task: ParsedTask,
	segmentState: SegmentFrontierTaskState,
	lane: AllocatedLane,
): boolean {
	const activeSegmentId = task.activeSegmentId;
	if (!activeSegmentId) return false;

	const activeSegment = segmentState.orderedSegments.find((segment) => segment.segmentId === activeSegmentId);
	if (!activeSegment) return false;

	const segmentRecords = ensureSegmentRecords(batchState);
	const dependsOnSegmentIds = segmentState.dependsOnBySegmentId.get(activeSegmentId) ?? [];
	const existing = segmentRecords.find((record) => record.segmentId === activeSegmentId);
	const now = Date.now();

	const restarted = !!existing
		&& existing.status !== "running"
		&& existing.startedAt !== null;

	const next: PersistedSegmentRecord = {
		segmentId: activeSegmentId,
		taskId: task.taskId,
		repoId: activeSegment.repoId,
		status: "running",
		laneId: lane.laneId,
		sessionName: lane.laneSessionId,
		worktreePath: lane.worktreePath,
		branch: lane.branch,
		startedAt: existing?.status === "running"
			? existing.startedAt
			: (existing?.startedAt ?? now),
		endedAt: null,
		retries: existing
			? existing.retries + (restarted ? 1 : 0)
			: 0,
		exitReason: existing?.status === "running"
			? existing.exitReason
			: "Segment running",
		dependsOnSegmentIds,
		exitDiagnostic: existing?.status === "running"
			? existing.exitDiagnostic
			: undefined,
		expandedFrom: existing?.expandedFrom,
		expansionRequestId: existing?.expansionRequestId,
	};

	if (!existing) {
		segmentRecords.push(next);
		return true;
	}

	const changed =
		existing.taskId !== next.taskId
		|| existing.repoId !== next.repoId
		|| existing.status !== next.status
		|| existing.laneId !== next.laneId
		|| existing.sessionName !== next.sessionName
		|| existing.worktreePath !== next.worktreePath
		|| existing.branch !== next.branch
		|| existing.startedAt !== next.startedAt
		|| existing.endedAt !== next.endedAt
		|| existing.retries !== next.retries
		|| existing.exitReason !== next.exitReason
		|| existing.dependsOnSegmentIds.length !== next.dependsOnSegmentIds.length
		|| existing.dependsOnSegmentIds.some((segmentId, idx) => segmentId !== next.dependsOnSegmentIds[idx])
		|| existing.exitDiagnostic !== next.exitDiagnostic
		|| existing.expandedFrom !== next.expandedFrom
		|| existing.expansionRequestId !== next.expansionRequestId;

	if (changed) {
		Object.assign(existing, next);
	}
	return changed;
}

function upsertTerminalSegmentRecord(
	batchState: OrchBatchRuntimeState,
	task: ParsedTask,
	segmentState: SegmentFrontierTaskState,
	segmentId: string,
	status: "succeeded" | "failed" | "skipped",
	outcome: LaneTaskOutcome | undefined,
	lane: AllocatedLane | undefined,
): boolean {
	const segment = segmentState.orderedSegments.find((candidate) => candidate.segmentId === segmentId);
	if (!segment) return false;

	const segmentRecords = ensureSegmentRecords(batchState);
	const existing = segmentRecords.find((record) => record.segmentId === segmentId);
	const now = Date.now();
	const dependsOnSegmentIds = segmentState.dependsOnBySegmentId.get(segmentId) ?? [];
	const nextExitDiagnostic = status === "failed"
		? (outcome?.exitDiagnostic ?? existing?.exitDiagnostic)
		: undefined;

	const next: PersistedSegmentRecord = {
		segmentId,
		taskId: task.taskId,
		repoId: segment.repoId,
		status,
		laneId: lane?.laneId ?? existing?.laneId ?? "",
		sessionName: lane?.laneSessionId ?? existing?.sessionName ?? "",
		worktreePath: lane?.worktreePath ?? existing?.worktreePath ?? "",
		branch: lane?.branch ?? existing?.branch ?? "",
		startedAt: existing?.startedAt ?? outcome?.startTime ?? now,
		endedAt: outcome?.endTime ?? now,
		retries: existing?.retries ?? 0,
		exitReason: outcome?.exitReason ?? (status === "succeeded"
			? "Segment completed"
			: status === "failed"
			? "Segment failed"
			: "Segment skipped"),
		dependsOnSegmentIds,
		exitDiagnostic: nextExitDiagnostic,
		expandedFrom: existing?.expandedFrom,
		expansionRequestId: existing?.expansionRequestId,
	};

	if (!existing) {
		segmentRecords.push(next);
		return true;
	}

	const changed =
		existing.taskId !== next.taskId
		|| existing.repoId !== next.repoId
		|| existing.status !== next.status
		|| existing.laneId !== next.laneId
		|| existing.sessionName !== next.sessionName
		|| existing.worktreePath !== next.worktreePath
		|| existing.branch !== next.branch
		|| existing.startedAt !== next.startedAt
		|| existing.endedAt !== next.endedAt
		|| existing.retries !== next.retries
		|| existing.exitReason !== next.exitReason
		|| existing.dependsOnSegmentIds.length !== next.dependsOnSegmentIds.length
		|| existing.dependsOnSegmentIds.some((depSegmentId, idx) => depSegmentId !== next.dependsOnSegmentIds[idx])
		|| existing.exitDiagnostic !== next.exitDiagnostic
		|| existing.expandedFrom !== next.expandedFrom
		|| existing.expansionRequestId !== next.expansionRequestId;

	if (changed) {
		Object.assign(existing, next);
	}
	return changed;
}

function buildFallbackSegmentPlan(taskId: string, task: ParsedTask): TaskSegmentPlan {
	const repoId = (task.resolvedRepoId && task.resolvedRepoId.trim()) || "default";
	return {
		taskId,
		mode: "repo-singleton",
		segments: [
			{
				segmentId: `${taskId}::${repoId}`,
				taskId,
				repoId,
				order: 0,
			},
		],
		edges: [],
	};
}

/**
 * Deterministically linearize one task's segment DAG into a sequential order.
 *
 * Runtime V2 executes one segment per task at a time, so even explicit DAGs
 * are consumed through a deterministic topological order.
 */
export function linearizeTaskSegmentPlan(plan: TaskSegmentPlan): TaskSegmentNode[] {
	const nodeById = new Map<string, TaskSegmentNode>();
	for (const segment of plan.segments) {
		nodeById.set(segment.segmentId, segment);
	}

	const indegree = new Map<string, number>();
	const outgoing = new Map<string, string[]>();
	for (const segment of plan.segments) {
		indegree.set(segment.segmentId, 0);
		outgoing.set(segment.segmentId, []);
	}

	for (const edge of plan.edges) {
		if (!nodeById.has(edge.fromSegmentId) || !nodeById.has(edge.toSegmentId)) {
			continue;
		}
		outgoing.get(edge.fromSegmentId)!.push(edge.toSegmentId);
		indegree.set(edge.toSegmentId, (indegree.get(edge.toSegmentId) ?? 0) + 1);
	}

	for (const list of outgoing.values()) {
		list.sort((a, b) => a.localeCompare(b));
	}

	const ready: TaskSegmentNode[] = plan.segments
		.filter((segment) => (indegree.get(segment.segmentId) ?? 0) === 0)
		.sort((a, b) => (a.order - b.order) || a.segmentId.localeCompare(b.segmentId));

	const ordered: TaskSegmentNode[] = [];
	while (ready.length > 0) {
		const next = ready.shift()!;
		ordered.push(next);
		for (const dep of outgoing.get(next.segmentId) ?? []) {
			const count = (indegree.get(dep) ?? 0) - 1;
			indegree.set(dep, count);
			if (count === 0) {
				const depNode = nodeById.get(dep);
				if (depNode) {
					ready.push(depNode);
					ready.sort((a, b) => (a.order - b.order) || a.segmentId.localeCompare(b.segmentId));
				}
			}
		}
	}

	// Defensive fallback: malformed/cyclic plans retain deterministic segment order.
	if (ordered.length !== plan.segments.length) {
		return [...plan.segments].sort((a, b) => (a.order - b.order) || a.segmentId.localeCompare(b.segmentId));
	}

	return ordered;
}

/**
 * Expand task waves into segment-frontier rounds.
 *
 * Each original task-wave becomes N rounds where N is the max segment count
 * among tasks in that wave. A task with fewer segments simply drops out once
 * its segment list is exhausted.
 */
export function buildSegmentFrontierWaves(
	baseTaskWaves: string[][],
	pending: Map<string, ParsedTask>,
	segmentPlans?: TaskSegmentPlanMap,
	packetRepoId?: string,
	workspaceRoot?: string,
): { waves: string[][]; taskStateById: Map<string, SegmentFrontierTaskState> } {
	const taskStateById = new Map<string, SegmentFrontierTaskState>();

	for (const [taskId, task] of pending.entries()) {
		const plan = segmentPlans?.get(taskId) ?? buildFallbackSegmentPlan(taskId, task);
		const orderedSegments = linearizeTaskSegmentPlan(plan);
		const dependsOnBySegmentId = buildSegmentDependencyMap(plan);
		task.segmentIds = orderedSegments.map((segment) => segment.segmentId);
		task.activeSegmentId = null;
		if (packetRepoId) {
			task.packetRepoId = packetRepoId;
			// Resolve packetTaskPath to absolute so it works from any repo's worktree.
			// task.taskFolder is relative to workspace root (e.g., "shared-libs/task-management/.../TP-004").
			// When a segment executes in a different repo, the lane worktree won't contain this path.
			task.packetTaskPath = workspaceRoot
				? resolve(workspaceRoot, task.taskFolder)
				: task.taskFolder;
		}

		taskStateById.set(taskId, {
			taskId,
			orderedSegments,
			nextSegmentIndex: 0,
			statusBySegmentId: new Map(orderedSegments.map((segment) => [segment.segmentId, "pending" as SegmentLifecycleStatus])),
			dependsOnBySegmentId,
			terminalStatus: "pending",
		});
	}

	const expanded: string[][] = [];
	for (const waveTasks of baseTaskWaves) {
		let maxSegmentsInWave = 0;
		for (const taskId of waveTasks) {
			const state = taskStateById.get(taskId);
			if (!state) continue;
			maxSegmentsInWave = Math.max(maxSegmentsInWave, state.orderedSegments.length);
		}

		for (let segmentIndex = 0; segmentIndex < maxSegmentsInWave; segmentIndex++) {
			const segmentRound: string[] = [];
			for (const taskId of waveTasks) {
				const state = taskStateById.get(taskId);
				if (!state) continue;
				if (segmentIndex < state.orderedSegments.length) {
					segmentRound.push(taskId);
				}
			}
			if (segmentRound.length > 0) {
				expanded.push(segmentRound);
			}
		}
	}

	return {
		waves: expanded,
		taskStateById,
	};
}

/**
 * Attempt automatic retry for failed tasks with retryable exit classifications.
 *
 * After a wave completes, this function inspects each failed task's canonical
 * `exitDiagnostic.classification` and re-executes the task if:
 * - The classification is in TIER0_RETRYABLE_CLASSIFICATIONS (api_error, process_crash, session_vanished)
 * - The retry budget for this scope has not been exhausted
 *
 * Partial progress is preserved before retry. On success, the task is moved from
 * failedTaskIds to succeededTaskIds and the waveResult counts are updated in-place.
 *
 * @returns Object with retried count and updated task outcomes
 */
async function attemptWorkerCrashRetry(
	waveResult: WaveExecutionResult,
	waveIdx: number,
	batchState: OrchBatchRuntimeState,
	orchConfig: OrchestratorConfig,
	repoRoot: string,
	workspaceConfig: WorkspaceConfig | null | undefined,
	allTaskOutcomes: LaneTaskOutcome[],
	onNotify: (message: string, level: "info" | "warning" | "error") => void,
	stateRoot: string,
	runnerConfig?: TaskRunnerConfig,
	runtimeBackend?: RuntimeBackend,
): Promise<{ retriedCount: number; succeededRetries: string[]; failedRetries: string[] }> {
	if (!batchState.resilience) {
		batchState.resilience = defaultResilienceState();
	}

	const budget = TIER0_RETRY_BUDGETS.worker_crash;
	const succeededRetries: string[] = [];
	const failedRetries: string[] = [];
	let retriedCount = 0;

	// Build a map from taskId → lane for re-execution
	const taskToLane = new Map<string, AllocatedLane>();
	for (const lane of waveResult.allocatedLanes) {
		for (const task of lane.tasks) {
			taskToLane.set(task.taskId, lane);
		}
	}

	// Check each failed task for retryability
	for (const taskId of [...waveResult.failedTaskIds]) {
		const lane = taskToLane.get(taskId);
		if (!lane) continue;

		// Find the task outcome to get exit info
		const outcome = allTaskOutcomes.find(o => o.taskId === taskId);
		if (!outcome) continue;

		// Use the canonical exit diagnostic classification when available.
		// If exitDiagnostic is not populated (executeLane doesn't set it),
		// we conservatively skip auto-retry rather than synthesizing a
		// classification from incomplete data — which could incorrectly
		// retry non-retryable failures (e.g., deterministic task errors).
		const classification = outcome.exitDiagnostic?.classification;

		if (!classification) {
			execLog("batch", batchState.batchId,
				`tier0: task ${taskId} has no exit diagnostic classification — skipping auto-retry (conservative)`,
			);
			continue;
		}

		// Check if retryable
		if (!TIER0_RETRYABLE_CLASSIFICATIONS.has(classification)) {
			execLog("batch", batchState.batchId,
				`tier0: task ${taskId} exit classification "${classification}" is not retryable — skipping`,
			);
			continue;
		}

		// model_access_error is handled by attemptModelFallbackRetry() — skip here
		if (classification === "model_access_error") {
			execLog("batch", batchState.batchId,
				`tier0: task ${taskId} classified as model_access_error — deferring to model fallback handler`,
			);
			continue;
		}

		// Check retry budget
		const scopeKey = tier0ScopeKey("worker_crash", taskId, waveIdx);
		const currentCount = batchState.resilience.retryCountByScope[scopeKey] ?? 0;
		if (currentCount >= budget.maxRetries) {
			execLog("batch", batchState.batchId,
				`tier0: task ${taskId} retry budget exhausted (${currentCount}/${budget.maxRetries}) — skipping`,
				{ scopeKey },
			);
			// Emit exhausted event
			emitTier0Event(stateRoot, {
				...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "worker_crash", currentCount, budget.maxRetries),
				taskId,
				laneNumber: lane.laneNumber,
				repoId: lane.repoId ?? null,
				classification,
				error: `Retry budget exhausted for task ${taskId} (${classification})`,
				scopeKey,
				affectedTaskIds: [taskId],
				suggestion: `Task ${taskId} failed with ${classification} and exhausted ${budget.maxRetries} retry attempt(s). Consider investigating the root cause or manually re-running the task.`,
			});
			emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "worker_crash", currentCount, budget.maxRetries,
				`Retry budget exhausted for task ${taskId} (${classification})`, [taskId],
				`Task ${taskId} failed with ${classification} and exhausted ${budget.maxRetries} retry attempt(s). Consider investigating the root cause or manually re-running the task.`,
				{ taskId, laneNumber: lane.laneNumber, repoId: lane.repoId ?? null, classification, scopeKey },
			);
			continue;
		}

		// Increment retry counter
		batchState.resilience.retryCountByScope[scopeKey] = currentCount + 1;
		retriedCount++;

		execLog("batch", batchState.batchId,
			`tier0: retrying task ${taskId} (worker_crash, attempt ${currentCount + 1}/${budget.maxRetries}, classification=${classification})`,
			{ scopeKey, classification },
		);
		onNotify(
			`🔄 Tier 0: Retrying task ${taskId} (${classification}, attempt ${currentCount + 1}/${budget.maxRetries})`,
			"info",
		);

		// Emit attempt event
		emitTier0Event(stateRoot, {
			...buildTier0EventBase("tier0_recovery_attempt", batchState.batchId, waveIdx, "worker_crash", currentCount + 1, budget.maxRetries),
			taskId,
			laneNumber: lane.laneNumber,
			repoId: lane.repoId ?? null,
			classification,
			cooldownMs: budget.cooldownMs,
			scopeKey,
		});

		// Cooldown before retry
		if (budget.cooldownMs > 0) {
			sleepSync(budget.cooldownMs);
		}

		// Find the specific AllocatedTask
		const allocatedTask = lane.tasks.find(t => t.taskId === taskId);
		if (!allocatedTask) continue;

		// Re-execute: create a single-task lane config for executeLane
		const retryLane: AllocatedLane = {
			...lane,
			tasks: [allocatedTask],
		};

		const isWsMode = !!workspaceConfig;
		const wsRoot = workspaceConfig
			? resolve(workspaceConfig.configPath, "..", "..")
			: undefined;

		try {
			// Use a fresh pause signal for the retry — the batch pauseSignal
			// may be paused due to stop-wave policy, but Tier 0 retry should
			// attempt recovery before the stop decision takes effect (R002-4).
			const retryPauseSignal = { paused: false };
			const retryResult = await executeLaneV2(
				retryLane,
				orchConfig,
				repoRoot,
				retryPauseSignal,
				wsRoot,
				isWsMode,
				{ ORCH_BATCH_ID: batchState.batchId, ...buildReviewerEnv(runnerConfig?.reviewer) }, // TP-089: ensure mailbox works for retries
			);

			const retryOutcome = retryResult.tasks[0];
			if (retryOutcome && retryOutcome.status === "succeeded") {
				succeededRetries.push(taskId);

				// Update waveResult: move from failed to succeeded
				const failIdx = waveResult.failedTaskIds.indexOf(taskId);
				if (failIdx !== -1) waveResult.failedTaskIds.splice(failIdx, 1);
				waveResult.succeededTaskIds.push(taskId);

				// Update lane results — replace the failed task outcome
				for (const lr of waveResult.laneResults) {
					const taskIdx = lr.tasks.findIndex(t => t.taskId === taskId);
					if (taskIdx !== -1) {
						lr.tasks[taskIdx] = retryOutcome;
						break;
					}
				}

				// Update allTaskOutcomes
				upsertTaskOutcome(allTaskOutcomes, retryOutcome);

				execLog("batch", batchState.batchId,
					`tier0: task ${taskId} retry succeeded`,
					{ scopeKey },
				);
				onNotify(
					`✅ Tier 0: Task ${taskId} retry succeeded`,
					"info",
				);

				// Emit success event
				emitTier0Event(stateRoot, {
					...buildTier0EventBase("tier0_recovery_success", batchState.batchId, waveIdx, "worker_crash", currentCount + 1, budget.maxRetries),
					taskId,
					laneNumber: lane.laneNumber,
					repoId: lane.repoId ?? null,
					classification,
					resolution: `Task ${taskId} succeeded on retry attempt ${currentCount + 1}`,
					scopeKey,
				});
			} else {
				failedRetries.push(taskId);
				if (retryOutcome) {
					upsertTaskOutcome(allTaskOutcomes, retryOutcome);
				}
				execLog("batch", batchState.batchId,
					`tier0: task ${taskId} retry failed again`,
					{ scopeKey, exitReason: retryOutcome?.exitReason },
				);

				// Emit exhausted event (retry failed and budget now consumed)
				const retryFailError = retryOutcome?.exitReason ?? `Task ${taskId} retry failed again`;
				const retryFailSuggestion = `Task ${taskId} failed again after retry (${classification}). The failure may be persistent — investigate task logs.`;
				emitTier0Event(stateRoot, {
					...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "worker_crash", currentCount + 1, budget.maxRetries),
					taskId,
					laneNumber: lane.laneNumber,
					repoId: lane.repoId ?? null,
					classification,
					error: retryFailError,
					scopeKey,
					affectedTaskIds: [taskId],
					suggestion: retryFailSuggestion,
				});
				emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "worker_crash", currentCount + 1, budget.maxRetries,
					retryFailError, [taskId], retryFailSuggestion,
					{ taskId, laneNumber: lane.laneNumber, repoId: lane.repoId ?? null, classification, scopeKey },
				);
			}
		} catch (err: unknown) {
			failedRetries.push(taskId);
			const errMsg = err instanceof Error ? err.message : String(err);
			execLog("batch", batchState.batchId,
				`tier0: task ${taskId} retry threw error: ${errMsg}`,
				{ scopeKey },
			);

			// Emit exhausted event for exception during retry
			const exceptionSuggestion = `Task ${taskId} retry threw an exception: ${errMsg}. Investigate the execution environment.`;
			emitTier0Event(stateRoot, {
				...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "worker_crash", currentCount + 1, budget.maxRetries),
				taskId,
				laneNumber: lane.laneNumber,
				repoId: lane.repoId ?? null,
				classification,
				error: errMsg,
				scopeKey,
				affectedTaskIds: [taskId],
				suggestion: exceptionSuggestion,
			});
			emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "worker_crash", currentCount + 1, budget.maxRetries,
				errMsg, [taskId], exceptionSuggestion,
				{ taskId, laneNumber: lane.laneNumber, repoId: lane.repoId ?? null, classification, scopeKey },
			);
		}
	}

	// Recalculate wave-level status if retries changed outcomes.
	// NOTE: Batch-level counters (succeededTasks, failedTasks) are NOT updated
	// here — the caller accumulates them from waveResult AFTER retry so that
	// counts are only applied once (R002-2 fix).
	if (succeededRetries.length > 0) {
		if (waveResult.failedTaskIds.length === 0) {
			waveResult.overallStatus = "succeeded";
			waveResult.stoppedEarly = false;
		} else if (waveResult.succeededTaskIds.length > 0) {
			waveResult.overallStatus = "partial";
		}
	}

	return { retriedCount, succeededRetries, failedRetries };
}

/**
 * Attempt model fallback retry for tasks that failed with `model_access_error`.
 *
 * When a configured agent model becomes unavailable mid-batch (API key expired,
 * rate limit, model deprecated, provider outage), this function retries the task
 * with the session model by setting `TASKPLANE_MODEL_FALLBACK=1` env var. The
 * task-runner reads this var and omits the explicit `--model` flag, causing pi
 * to use the session's default model.
 *
 * Only runs when `runnerConfig.model_fallback === "inherit"` (the default). When
 * set to `"fail"`, model access errors fall through to normal failure handling.
 *
 * Separate from `attemptWorkerCrashRetry()` because:
 * - Uses a different recovery pattern (`model_fallback` vs `worker_crash`)
 * - Requires env var injection to change the model behavior
 * - Has its own retry budget
 *
 * @since TP-055
 */
async function attemptModelFallbackRetry(
	waveResult: WaveExecutionResult,
	waveIdx: number,
	batchState: OrchBatchRuntimeState,
	orchConfig: OrchestratorConfig,
	repoRoot: string,
	workspaceConfig: WorkspaceConfig | null | undefined,
	allTaskOutcomes: LaneTaskOutcome[],
	onNotify: (message: string, level: "info" | "warning" | "error") => void,
	stateRoot: string,
	runnerConfig?: TaskRunnerConfig,
	runtimeBackend?: RuntimeBackend,
): Promise<{ retriedCount: number; succeededRetries: string[]; failedRetries: string[] }> {
	// Short-circuit: if model fallback is disabled, skip entirely
	const modelFallbackMode = runnerConfig?.model_fallback ?? "inherit";
	if (modelFallbackMode !== "inherit") {
		return { retriedCount: 0, succeededRetries: [], failedRetries: [] };
	}

	if (!batchState.resilience) {
		batchState.resilience = defaultResilienceState();
	}

	const budget = TIER0_RETRY_BUDGETS.model_fallback;
	const succeededRetries: string[] = [];
	const failedRetries: string[] = [];
	let retriedCount = 0;

	// Build a map from taskId → lane for re-execution
	const taskToLane = new Map<string, AllocatedLane>();
	for (const lane of waveResult.allocatedLanes) {
		for (const task of lane.tasks) {
			taskToLane.set(task.taskId, lane);
		}
	}

	// Process only model_access_error tasks
	for (const taskId of [...waveResult.failedTaskIds]) {
		const lane = taskToLane.get(taskId);
		if (!lane) continue;

		const outcome = allTaskOutcomes.find(o => o.taskId === taskId);
		if (!outcome) continue;

		const classification = outcome.exitDiagnostic?.classification;
		if (classification !== "model_access_error") continue;

		// Check retry budget
		const scopeKey = tier0ScopeKey("model_fallback", taskId, waveIdx);
		const currentCount = batchState.resilience.retryCountByScope[scopeKey] ?? 0;
		if (currentCount >= budget.maxRetries) {
			execLog("batch", batchState.batchId,
				`tier0: task ${taskId} model fallback retry budget exhausted (${currentCount}/${budget.maxRetries})`,
				{ scopeKey },
			);
			emitTier0Event(stateRoot, {
				...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "model_fallback", currentCount, budget.maxRetries),
				taskId,
				laneNumber: lane.laneNumber,
				repoId: lane.repoId ?? null,
				classification,
				error: `Model fallback retry budget exhausted for task ${taskId}`,
				scopeKey,
				affectedTaskIds: [taskId],
				suggestion: `Task ${taskId} failed with model_access_error and model fallback retry exhausted. Check API key validity and model availability.`,
			});
			emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "model_fallback", currentCount, budget.maxRetries,
				`Model fallback retry budget exhausted for task ${taskId}`, [taskId],
				`Task ${taskId} failed with model_access_error and model fallback retry exhausted. Check API key validity and model availability.`,
				{ taskId, laneNumber: lane.laneNumber, repoId: lane.repoId ?? null, classification, scopeKey },
			);
			continue;
		}

		// Increment retry counter
		batchState.resilience.retryCountByScope[scopeKey] = currentCount + 1;
		retriedCount++;

		const failedModel = outcome.exitDiagnostic?.errorMessage || "configured model";
		execLog("batch", batchState.batchId,
			`tier0: model fallback — retrying task ${taskId} without explicit model (${failedModel} unavailable)`,
			{ scopeKey, classification },
		);
		onNotify(
			`🔄 Model fallback: Retrying task ${taskId} with session model (${failedModel} unavailable)`,
			"info",
		);

		// Emit attempt event
		emitTier0Event(stateRoot, {
			...buildTier0EventBase("tier0_recovery_attempt", batchState.batchId, waveIdx, "model_fallback", currentCount + 1, budget.maxRetries),
			taskId,
			laneNumber: lane.laneNumber,
			repoId: lane.repoId ?? null,
			classification,
			cooldownMs: budget.cooldownMs,
			scopeKey,
		});

		// Cooldown before retry
		if (budget.cooldownMs > 0) {
			sleepSync(budget.cooldownMs);
		}

		// Find the specific AllocatedTask
		const allocatedTask = lane.tasks.find(t => t.taskId === taskId);
		if (!allocatedTask) continue;

		// Re-execute with model fallback env var
		const retryLane: AllocatedLane = {
			...lane,
			tasks: [allocatedTask],
		};

		const isWsMode = !!workspaceConfig;
		const wsRoot = workspaceConfig
			? resolve(workspaceConfig.configPath, "..", "..")
			: undefined;

		try {
			const retryPauseSignal = { paused: false };
			// Pass TASKPLANE_MODEL_FALLBACK=1 as extra env var to signal
			// the task-runner to use the session model instead of configured model.
			// TP-089: Also include ORCH_BATCH_ID so mailbox steering works for retries.
			const modelFallbackEnv = { TASKPLANE_MODEL_FALLBACK: "1", ORCH_BATCH_ID: batchState.batchId, ...buildReviewerEnv(runnerConfig?.reviewer) };
			const retryResult = await executeLaneV2(
				retryLane,
				orchConfig,
				repoRoot,
				retryPauseSignal,
				wsRoot,
				isWsMode,
				modelFallbackEnv,
			);

			const retryOutcome = retryResult.tasks[0];
			if (retryOutcome && retryOutcome.status === "succeeded") {
				succeededRetries.push(taskId);

				// Update waveResult: move from failed to succeeded
				const failIdx = waveResult.failedTaskIds.indexOf(taskId);
				if (failIdx !== -1) waveResult.failedTaskIds.splice(failIdx, 1);
				waveResult.succeededTaskIds.push(taskId);

				// Update lane results
				for (const lr of waveResult.laneResults) {
					const taskIdx = lr.tasks.findIndex(t => t.taskId === taskId);
					if (taskIdx !== -1) {
						lr.tasks[taskIdx] = retryOutcome;
						break;
					}
				}

				upsertTaskOutcome(allTaskOutcomes, retryOutcome);

				execLog("batch", batchState.batchId,
					`tier0: task ${taskId} model fallback retry succeeded`,
					{ scopeKey },
				);
				onNotify(
					`✅ Model fallback: Task ${taskId} succeeded with session model`,
					"info",
				);

				emitTier0Event(stateRoot, {
					...buildTier0EventBase("tier0_recovery_success", batchState.batchId, waveIdx, "model_fallback", currentCount + 1, budget.maxRetries),
					taskId,
					laneNumber: lane.laneNumber,
					repoId: lane.repoId ?? null,
					classification,
					resolution: `Task ${taskId} succeeded after falling back to session model`,
					scopeKey,
				});
			} else {
				failedRetries.push(taskId);
				if (retryOutcome) {
					upsertTaskOutcome(allTaskOutcomes, retryOutcome);
				}
				execLog("batch", batchState.batchId,
					`tier0: task ${taskId} model fallback retry failed`,
					{ scopeKey, exitReason: retryOutcome?.exitReason },
				);

				const retryFailError = retryOutcome?.exitReason ?? `Task ${taskId} model fallback retry failed`;
				emitTier0Event(stateRoot, {
					...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "model_fallback", currentCount + 1, budget.maxRetries),
					taskId,
					laneNumber: lane.laneNumber,
					repoId: lane.repoId ?? null,
					classification,
					error: retryFailError,
					scopeKey,
					affectedTaskIds: [taskId],
					suggestion: `Task ${taskId} failed even with session model fallback. Investigate task logs.`,
				});
				emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "model_fallback", currentCount + 1, budget.maxRetries,
					retryFailError, [taskId],
					`Task ${taskId} failed even with session model fallback. Investigate task logs.`,
					{ taskId, laneNumber: lane.laneNumber, repoId: lane.repoId ?? null, classification, scopeKey },
				);
			}
		} catch (err: unknown) {
			failedRetries.push(taskId);
			const errMsg = err instanceof Error ? err.message : String(err);
			execLog("batch", batchState.batchId,
				`tier0: task ${taskId} model fallback retry threw error: ${errMsg}`,
				{ scopeKey },
			);
			emitTier0Event(stateRoot, {
				...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "model_fallback", currentCount + 1, budget.maxRetries),
				taskId,
				laneNumber: lane.laneNumber,
				repoId: lane.repoId ?? null,
				classification,
				error: errMsg,
				scopeKey,
				affectedTaskIds: [taskId],
				suggestion: `Model fallback retry for task ${taskId} threw an exception: ${errMsg}`,
			});
			emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "model_fallback", currentCount + 1, budget.maxRetries,
				errMsg, [taskId],
				`Model fallback retry for task ${taskId} threw an exception: ${errMsg}`,
				{ taskId, laneNumber: lane.laneNumber, repoId: lane.repoId ?? null, classification, scopeKey },
			);
		}
	}

	// Recalculate wave-level status if retries changed outcomes
	if (succeededRetries.length > 0) {
		if (waveResult.failedTaskIds.length === 0) {
			waveResult.overallStatus = "succeeded";
			waveResult.stoppedEarly = false;
		} else if (waveResult.succeededTaskIds.length > 0) {
			waveResult.overallStatus = "partial";
		}
	}

	return { retriedCount, succeededRetries, failedRetries };
}

/**
 * Attempt stale worktree recovery when lane allocation fails with ALLOC_WORKTREE_FAILED.
 *
 * Forces cleanup of all matching worktrees, prunes git state, then retries
 * the wave execution.
 *
 * @returns The retry waveResult, or null if recovery was not attempted
 */
async function attemptStaleWorktreeRecovery(
	waveResult: WaveExecutionResult,
	waveTasks: string[],
	waveIdx: number,
	discovery: DiscoveryResult,
	orchConfig: OrchestratorConfig,
	repoRoot: string,
	batchState: OrchBatchRuntimeState,
	depGraph: ReturnType<typeof buildDependencyGraph>,
	workspaceConfig: WorkspaceConfig | null | undefined,
	onMonitorUpdate: MonitorUpdateCallback | undefined,
	onLanesAllocated: (lanes: AllocatedLane[]) => void,
	stateRoot: string,
	runtimeBackend?: RuntimeBackend,
	onSupervisorAlert?: SupervisorAlertCallback,
	supervisorAutonomy: "interactive" | "supervised" | "autonomous" = "autonomous",
	runnerConfig?: TaskRunnerConfig,
): Promise<WaveExecutionResult | null> {
	// Only attempt recovery for ALLOC_WORKTREE_FAILED
	if (!waveResult.allocationError || waveResult.allocationError.code !== "ALLOC_WORKTREE_FAILED") {
		return null;
	}

	if (!batchState.resilience) {
		batchState.resilience = defaultResilienceState();
	}

	const budget = TIER0_RETRY_BUDGETS.stale_worktree;
	const scopeKey = tier0WaveScopeKey("stale_worktree", waveIdx);
	const currentCount = batchState.resilience.retryCountByScope[scopeKey] ?? 0;

	if (currentCount >= budget.maxRetries) {
		execLog("batch", batchState.batchId,
			`tier0: stale worktree retry budget exhausted (${currentCount}/${budget.maxRetries})`,
			{ scopeKey },
		);
		const staleExhaustedError = waveResult.allocationError.message;
		const staleExhaustedSuggestion = `Stale worktree cleanup exhausted ${budget.maxRetries} retry(s). Manually remove worktrees and prune git state.`;
		emitTier0Event(stateRoot, {
			...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "stale_worktree", currentCount, budget.maxRetries),
			repoId: null, // wave-scoped
			error: staleExhaustedError,
			scopeKey,
			affectedTaskIds: waveTasks,
			suggestion: staleExhaustedSuggestion,
		});
		emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "stale_worktree", currentCount, budget.maxRetries,
			staleExhaustedError, waveTasks, staleExhaustedSuggestion,
			{ repoId: null, scopeKey },
		);
		return null;
	}

	batchState.resilience.retryCountByScope[scopeKey] = currentCount + 1;

	execLog("batch", batchState.batchId,
		`tier0: attempting stale worktree recovery (attempt ${currentCount + 1}/${budget.maxRetries})`,
		{ scopeKey, allocationError: waveResult.allocationError.message },
	);

	// Emit attempt event
	emitTier0Event(stateRoot, {
		...buildTier0EventBase("tier0_recovery_attempt", batchState.batchId, waveIdx, "stale_worktree", currentCount + 1, budget.maxRetries),
		repoId: null, // wave-scoped: allocation failure may span multiple repos
		classification: waveResult.allocationError.code,
		cooldownMs: budget.cooldownMs,
		scopeKey,
	});

	// Force cleanup: remove all worktrees for this batch and prune.
	// In workspace mode, iterate ALL workspace repos — allocation failures
	// can come from non-default repos (R002-3 fix).
	const prefix = orchConfig.orchestrator.worktree_prefix;
	const opId = resolveOperatorId(orchConfig);

	const repoRootsToClean: string[] = [repoRoot];
	if (workspaceConfig) {
		for (const [, repoConf] of workspaceConfig.repos) {
			if (repoConf.path !== repoRoot && !repoRootsToClean.includes(repoConf.path)) {
				repoRootsToClean.push(repoConf.path);
			}
		}
	}

	for (const cleanRoot of repoRootsToClean) {
		const existingWorktrees = listWorktrees(prefix, cleanRoot, opId, batchState.batchId);
		for (const wt of existingWorktrees) {
			forceCleanupWorktree(wt, cleanRoot, batchState.batchId);
		}
		// Also prune git worktree state in case of orphaned references
		runGit(["worktree", "prune"], cleanRoot);
	}

	// Cooldown before retry
	if (budget.cooldownMs > 0) {
		sleepSync(budget.cooldownMs);
	}

	// Retry the wave execution
	execLog("batch", batchState.batchId,
		`tier0: retrying wave ${waveIdx + 1} after stale worktree cleanup`,
	);

	const retryResult = await executeWave(
		waveTasks,
		waveIdx + 1,
		discovery.pending,
		orchConfig,
		repoRoot,
		batchState.batchId,
		batchState.pauseSignal,
		depGraph,
		batchState.orchBranch,
		onMonitorUpdate,
		onLanesAllocated,
		workspaceConfig,
		runtimeBackend,
		onSupervisorAlert,
		supervisorAutonomy,
		{
			model: runnerConfig?.reviewer?.model || "",
			thinking: runnerConfig?.reviewer?.thinking || "",
			tools: runnerConfig?.reviewer?.tools || "",
		},
	);

	return retryResult;
}


export interface RuntimeBackendSelection {
	backend: RuntimeBackend;
	isSingleTask: boolean;
	isRepoMode: boolean;
	isDirectPromptTarget: boolean;
}

/**
 * Select execution backend for a batch under the TP-105 scope guard.
 *
 * Runtime V2 is enabled only for a single-task batch in repo mode when
 * the original target is exactly one direct PROMPT.md path.
 */
export function selectRuntimeBackend(
	args: string,
	rawWaves: string[][],
	workspaceConfig?: WorkspaceConfig | null,
): RuntimeBackendSelection {
	const isSingleTask = rawWaves.length === 1 && rawWaves[0]?.length === 1;
	const isRepoMode = !workspaceConfig;
	const argTokens = args.trim().split(/\s+/).filter(Boolean);
	const isDirectPromptTarget =
		argTokens.length === 1 && /PROMPT\.md$/i.test(argTokens[0]);

	// TP-108: Runtime V2 for all repo-mode batches.
	// TP-109: Workspace mode also uses V2 now that packet-home paths are
	// threaded through execution and resume (worktree-relative .DONE check).
	const backend: RuntimeBackend = "v2";

	return {
		backend,
		isSingleTask,
		isRepoMode,
		isDirectPromptTarget,
	};
}

// ── /orch Execution Engine ───────────────────────────────────────────

/**
 * Execute the full /orch batch: discover → plan → execute waves → cleanup.
 *
 * This is the core orchestration loop that ties together all prior steps.
 *
 * @param args        - User arguments (areas/paths/all)
 * @param orchConfig  - Orchestrator configuration
 * @param runnerConfig - Task runner configuration
 * @param cwd         - Current working directory (repo root)
 * @param batchState  - Mutable batch state (updated throughout execution)
 * @param onNotify    - Callback for user-facing messages
 * @param onMonitorUpdate - Optional callback for dashboard updates
 * @param workspaceConfig - Workspace configuration for repo routing (null = repo mode)
 * @param workspaceRoot - Workspace root for resolving task area paths (defaults to cwd)
 * @param agentRoot   - Agent root for config resolution
 * @param onEngineEvent - Optional callback for engine lifecycle events (TP-040)
 * @param onSupervisorAlert - Optional callback for supervisor alerts (TP-076)
 */
export async function executeOrchBatch(
	args: string,
	orchConfig: OrchestratorConfig,
	runnerConfig: TaskRunnerConfig,
	cwd: string,
	batchState: OrchBatchRuntimeState,
	onNotify: (message: string, level: "info" | "warning" | "error") => void,
	onMonitorUpdate?: MonitorUpdateCallback,
	workspaceConfig?: WorkspaceConfig | null,
	workspaceRoot?: string,
	agentRoot?: string,
	onEngineEvent?: EngineEventCallback | null,
	onSupervisorAlert?: SupervisorAlertCallback | null,
	supervisorAutonomy: "interactive" | "supervised" | "autonomous" = "autonomous",
): Promise<void> {
	const repoRoot = cwd;
	// State files (.pi/batch-state.json, lane-state, etc.) belong in the workspace root,
	// which is where .pi/ config lives. In repo mode, workspaceRoot === repoRoot.
	const stateRoot = workspaceRoot ?? cwd;

	// ── TP-040: Engine event emission helper ─────────────────────
	// Closure over stateRoot and onEngineEvent to keep emit calls terse.
	// batchState.batchId is read at call time (it's set in Phase 1).
	const emitEvent: typeof emitEngineEvent = (sr, event, cb) => emitEngineEvent(sr, event, cb);

	// ── TP-076: Supervisor alert emission helper ─────────────────
	// Wraps the optional callback with a null guard for terse call sites.
	const emitAlert = (alert: SupervisorAlert): void => {
		if (onSupervisorAlert) {
			try {
				onSupervisorAlert(alert);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				execLog("batch", batchState.batchId, `supervisor alert callback failed: ${msg}`, {
					alertCategory: alert.category,
				});
			}
		}
	};

	// ── TP-040 R002: Terminal event emission helper ──────────────
	// Routes all early-return and terminal paths through consistent event
	// emission so external consumers always receive a deterministic terminal
	// signal (batch_complete for completed/failed, batch_paused for paused/stopped).
	// Uses a guard flag to enforce one-transition/one-event semantics — once a
	// terminal event has been emitted, subsequent calls are no-ops.
	let terminalEventEmitted = false;
	const emitTerminalEvent = (reason?: string): void => {
		if (terminalEventEmitted) return;
		terminalEventEmitted = true;
		if (batchState.phase === "completed" || batchState.phase === "failed") {
			emitEvent(stateRoot, {
				...buildEngineEventBase("batch_complete", batchState.batchId, batchState.currentWaveIndex, batchState.phase),
				succeededTasks: batchState.succeededTasks,
				failedTasks: batchState.failedTasks,
				skippedTasks: batchState.skippedTasks,
				blockedTasks: batchState.blockedTasks,
				batchDurationMs: batchState.endedAt ? batchState.endedAt - batchState.startedAt : undefined,
			}, onEngineEvent);
		} else if (batchState.phase === "paused" || batchState.phase === "stopped") {
			emitEvent(stateRoot, {
				...buildEngineEventBase("batch_paused", batchState.batchId, batchState.currentWaveIndex, batchState.phase),
				reason: reason || (batchState.errors.length > 0 ? batchState.errors[batchState.errors.length - 1] : "paused"),
				failedTasks: batchState.failedTasks,
			}, onEngineEvent);
		}
	};

	// ── Phase 1: Planning ────────────────────────────────────────
	batchState.phase = "planning";
	batchState.batchId = generateBatchId();
	// Preserve startedAt if set during "launching" phase (TP-040)
	if (!batchState.startedAt) batchState.startedAt = Date.now();
	// Preserve pauseSignal if already set during "launching" phase (TP-040)
	// — e.g., /orch-pause issued between /orch return and engine start
	if (!batchState.pauseSignal?.paused) batchState.pauseSignal = { paused: false };
	batchState.mergeResults = [];
	batchState.mode = workspaceConfig ? "workspace" : "repo";

	// Capture the current branch as the base for worktrees and merge target
	const detectedBranch = getCurrentBranch(repoRoot);
	if (!detectedBranch) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		batchState.errors.push("Cannot determine current branch (detached HEAD or not a git repo)");
		onNotify("❌ Cannot determine current branch. Ensure HEAD is on a branch (not detached).", "error");
		emitTerminalEvent();
		return;
	}
	batchState.baseBranch = detectedBranch;

	// When true, final cleanup is skipped so failed merge state is preserved
	// for manual intervention and TS-009 resume flow.
	let preserveWorktreesForResume = false;

	// ── State persistence tracking (TS-009 Step 2) ───────────────
	// Accumulated task outcomes across all waves for state serialization.
	let allTaskOutcomes: LaneTaskOutcome[] = [];
	// Merge results accumulated across waves (for branch cleanup after worktree removal).
	const allMergeResults: MergeWaveResult[] = [];
	// Latest allocated lanes (updated each wave for serialization).
	let latestAllocatedLanes: AllocatedLane[] = [];
	// Wave plan as array of task ID arrays (set after wave computation).
	let wavePlan: string[][] = [];
	// Segment frontier runtime state keyed by parent task ID.
	let segmentStateByTask = new Map<string, SegmentFrontierTaskState>();
	// Processed segment-expansion request IDs (idempotency guard).
	const processedSegmentExpansionRequestIds = collectProcessedSegmentExpansionRequestIds(batchState);
	// Tasks that have reached terminal status at segment frontier level.
	const terminalSegmentTasks = new Set<string>();
	// Reference to discovery result for enriching taskFolder paths.
	let discoveryRef: DiscoveryResult | null = null;
	// TP-029: Track all repo roots encountered during execution.
	// Maps repoRoot → repoId (undefined for primary/repo-mode).
	// Used by inter-wave reset and terminal cleanup to iterate ALL repos
	// that had lanes, not just the primary repoRoot. Parity with resume.ts.
	const encounteredRepoRoots = new Map<string, string | undefined>();
	encounteredRepoRoots.set(repoRoot, undefined); // always include primary

	execLog("batch", batchState.batchId, "starting batch planning");

	// Preflight
	const preflight = runPreflight(orchConfig, repoRoot);
	onNotify(formatPreflightResults(preflight), preflight.passed ? "info" : "error");
	if (!preflight.passed) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		batchState.errors.push("Preflight check failed");
		emitTerminalEvent();
		return;
	}

	// ── TP-065: Preflight artifact cleanup (Layer 2 + Layer 3) ───
	// Sweep stale artifacts and rotate oversized logs before batch starts.
	// Always non-fatal — failures warn but never block batch execution.
	try {
		// Layer 2: Age-based sweep of stale telemetry/merge artifacts (>7 days)
		const sweepResult = sweepStaleArtifacts(stateRoot, {
			isBatchActive: () => {
				// Check persisted state — a prior batch may still be active
				try {
					const state = loadBatchState(stateRoot);
					if (state && state.phase !== "completed" && state.phase !== "failed" && state.phase !== "stopped") {
						return true;
					}
				} catch { /* state unreadable — safe to sweep */ }
				return false;
			},
			now: () => Date.now(),
		});
		const sweepMsg = formatPreflightSweep(sweepResult);
		if (sweepMsg) {
			onNotify(sweepMsg, "info");
		}

		// Layer 3: Size-capped rotation of supervisor append-only logs
		const rotationResult = rotateSupervisorLogs(stateRoot);
		const rotationMsg = formatLogRotation(rotationResult);
		if (rotationMsg) {
			onNotify(rotationMsg, "info");
		}
	} catch {
		// Non-fatal — never block batch start for cleanup errors
	}

	// Discovery — task area paths in task-runner.yaml are workspace-relative.
	// In repo mode workspaceRoot === repoRoot, so this is always correct.
	const discoveryRoot = workspaceRoot ?? cwd;
	const discovery = runDiscovery(args, runnerConfig.task_areas, discoveryRoot, {
		refreshDependencies: false,
		dependencySource: orchConfig.dependencies.source,
		useDependencyCache: orchConfig.dependencies.cache,
		workspaceConfig: workspaceConfig ?? null,
	});
	onNotify(formatDiscoveryResults(discovery), discovery.errors.length > 0 ? "warning" : "info");

	// Check for fatal errors
	const fatalCodes = new Set<string>(FATAL_DISCOVERY_CODES);
	const fatalErrors = discovery.errors.filter((e) => fatalCodes.has(e.code));
	if (fatalErrors.length > 0) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		batchState.errors.push("Discovery had fatal errors — cannot proceed");
		onNotify("❌ Cannot execute due to discovery errors above.", "error");
		const hasRoutingErrors = fatalErrors.some(
			(e) => e.code === "TASK_REPO_UNRESOLVED" || e.code === "TASK_REPO_UNKNOWN",
		);
		if (hasRoutingErrors) {
			onNotify(
				"💡 Check PROMPT Repo: fields, area repo_id config, and routing.default_repo in workspace config.",
				"info",
			);
		}
		const hasStrictErrors = fatalErrors.some(
			(e) => e.code === "TASK_ROUTING_STRICT",
		);
		if (hasStrictErrors) {
			onNotify(
				"💡 Strict routing is enabled (routing.strict: true). Every task must declare an explicit execution target.\n" +
				"   Add a `## Execution Target` section with `Repo: <id>` to each task's PROMPT.md.\n" +
				"   To disable strict routing, set `routing.strict: false` in workspace config.",
				"info",
			);
		}
		emitTerminalEvent();
		return;
	}

	if (discovery.pending.size === 0) {
		batchState.phase = "completed";
		batchState.endedAt = Date.now();
		onNotify("No pending tasks found. Nothing to execute.", "info");
		emitTerminalEvent();
		return;
	}

	// Build dependency graph
	const depGraph = buildDependencyGraph(discovery.pending, discovery.completed);
	batchState.dependencyGraph = depGraph;

	// Validate graph
	const validation = validateGraph(depGraph, discovery.pending, discovery.completed);
	if (!validation.valid) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		const errMsgs = validation.errors.map(e => `[${e.code}] ${e.message}`).join("\n");
		batchState.errors.push(`Graph validation failed:\n${errMsgs}`);
		onNotify(`❌ Dependency graph errors:\n${errMsgs}`, "error");
		emitTerminalEvent();
		return;
	}

	// Compute waves + segment plans (task-level waves with additive segment metadata)
	const waveComputation = computeWaveAssignments(
		discovery.pending,
		discovery.completed,
		orchConfig,
		{
			workspaceRepoIds: workspaceConfig ? workspaceConfig.repos.keys() : undefined,
		},
	);
	if (waveComputation.errors.length > 0) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		const errMsgs = waveComputation.errors.map(e => `[${e.code}] ${e.message}`).join("\n");
		batchState.errors.push(`Wave computation failed:\n${errMsgs}`);
		onNotify(`❌ Wave computation errors:\n${errMsgs}`, "error");
		emitTerminalEvent();
		return;
	}

	const taskWaves = waveComputation.waves.map((wave) => wave.tasks.map((assignment) => assignment.taskId));
	const packetRepoId = workspaceConfig?.routing?.taskPacketRepo;
	const frontier = buildSegmentFrontierWaves(
		taskWaves,
		discovery.pending,
		waveComputation.segmentPlans,
		packetRepoId,
		stateRoot,
	);
	const rawWaves = frontier.waves;
	segmentStateByTask = frontier.taskStateById;

	batchState.totalWaves = rawWaves.length;
	batchState.totalTasks = discovery.pending.size;

	// Store wave plan and discovery for state persistence
	wavePlan = rawWaves;
	discoveryRef = discovery;

	// ── Create orchestrator-managed branch ───────────────────────
	// Created after all planning validations pass (preflight, discovery,
	// graph validation, wave computation) to avoid orphan branches on
	// planning-phase early exits.
	// The orch branch isolates all batch work from the user's current branch.
	// Worktrees branch from it; merges target it via update-ref.
	const opId = resolveOperatorId(orchConfig);
	const orchBranch = `orch/${opId}-${batchState.batchId}`;

	// In workspace mode, create the orch branch in every repo that might
	// have tasks. In repo mode, create it only in the single repo.
	if (workspaceConfig) {
		let orchBranchFailed = false;
		for (const [repoId, repoConf] of workspaceConfig.repos) {
			const rRoot = repoConf.path;
			const repoBranch = getCurrentBranch(rRoot) || "HEAD";
			const result = runGit(["branch", orchBranch, repoBranch], rRoot);
			if (result.ok) {
				execLog("batch", batchState.batchId, `created orch branch in ${repoId}`, { orchBranch, base: repoBranch });
			} else {
				const errDetail = result.stderr || result.stdout || "unknown error";
				execLog("batch", batchState.batchId, `failed to create orch branch in ${repoId}: ${errDetail}`);
				batchState.phase = "failed";
				batchState.endedAt = Date.now();
				batchState.errors.push(`Failed to create orch branch '${orchBranch}' in ${repoId}: ${errDetail}`);
				onNotify(`❌ Failed to create orch branch '${orchBranch}' in ${repoId}: ${errDetail}`, "error");
				orchBranchFailed = true;
				break;
			}
		}
		if (orchBranchFailed) { emitTerminalEvent(); return; }
	} else {
		const branchResult = runGit(["branch", orchBranch, batchState.baseBranch], repoRoot);
		if (!branchResult.ok) {
			batchState.phase = "failed";
			batchState.endedAt = Date.now();
			const errDetail = branchResult.stderr || branchResult.stdout || "unknown error";
			batchState.errors.push(`Failed to create orch branch '${orchBranch}': ${errDetail}`);
			onNotify(`❌ Failed to create orch branch '${orchBranch}': ${errDetail}`, "error");
			emitTerminalEvent();
			return;
		}
		execLog("batch", batchState.batchId, "created orch branch", { orchBranch, baseBranch: batchState.baseBranch });
	}
	batchState.orchBranch = orchBranch;

	onNotify(
		ORCH_MESSAGES.orchStarting(batchState.batchId, rawWaves.length, batchState.totalTasks),
		"info",
	);

	// ── Phase 2: Wave Execution Loop ─────────────────────────────
	batchState.phase = "executing";

	// ── TS-009: Persist state on batch start (after wave computation) ──
	persistRuntimeState("batch-start", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

	// ── TP-105: Runtime V2 backend selection ────────────────────
	// Use Runtime V2 (no-TMUX lane-runner) when ALL conditions are met:
	//   1. Exactly one task in the batch
	//   2. Repo mode (not workspace mode — workspace deferred to TP-109)
	//   3. The user target is a single direct PROMPT.md path
	// Otherwise, fall back to the legacy TMUX-backed path.
	const backendSelection = selectRuntimeBackend(args, rawWaves, workspaceConfig);
	const selectedBackend = backendSelection.backend;
	const runtimeSegmentRounds = rawWaves.map((waveTasks) => [...waveTasks]);

	if (selectedBackend === "v2") {
		execLog("batch", batchState.batchId, "Runtime V2 backend selected");
		onNotify("🚀 Using Runtime V2 backend (no-TMUX direct execution)", "info");
	}

	for (let waveIdx = 0; waveIdx < runtimeSegmentRounds.length; waveIdx++) {
		// Check pause signal before starting each wave
		if (batchState.pauseSignal.paused) {
			batchState.phase = "paused";
			execLog("batch", batchState.batchId, `batch paused before wave ${waveIdx + 1}`);
			onNotify(`⏸️  Batch paused before wave ${waveIdx + 1}. Resume not yet implemented (TS-009).`, "warning");
			// ── TS-009: Persist state on pause ──
			persistRuntimeState("pause-before-wave", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
			// TP-040: Emit batch_paused event (via terminal helper for dedup)
			emitTerminalEvent(`Paused before wave ${waveIdx + 1}`);
			break;
		}

		batchState.currentWaveIndex = waveIdx;

		// ── TS-009: Persist state on wave index change ──
		persistRuntimeState("wave-index-change", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

		// Filter wave tasks against blocked + terminal task sets, then bind the
		// next active segment for each surviving task.
		const scheduledWaveTasks = runtimeSegmentRounds[waveIdx];
		const blockedInWave: string[] = [];
		const terminalInWave: string[] = [];
		let waveTasks: string[] = [];
		for (const taskId of scheduledWaveTasks) {
			if (batchState.blockedTaskIds.has(taskId)) {
				blockedInWave.push(taskId);
				continue;
			}
			if (terminalSegmentTasks.has(taskId)) {
				terminalInWave.push(taskId);
				continue;
			}

			const task = discovery.pending.get(taskId);
			const segmentState = segmentStateByTask.get(taskId);
			if (!task || !segmentState) {
				continue;
			}

			task.segmentIds = segmentState.orderedSegments.map((segment) => segment.segmentId);
			const activeSegment = segmentState.orderedSegments[segmentState.nextSegmentIndex] ?? null;
			if (!activeSegment) {
				segmentState.terminalStatus = "succeeded";
				task.activeSegmentId = null;
				terminalSegmentTasks.add(taskId);
				terminalInWave.push(taskId);
				continue;
			}

			task.activeSegmentId = activeSegment.segmentId;
			if (workspaceConfig) {
				task.resolvedRepoId = activeSegment.repoId;
			}
			if (segmentState.statusBySegmentId.get(activeSegment.segmentId) === "pending") {
				segmentState.statusBySegmentId.set(activeSegment.segmentId, "running");
			}
			waveTasks.push(taskId);
		}

		if (blockedInWave.length > 0) {
			execLog("batch", batchState.batchId, `wave ${waveIdx + 1}: skipping ${blockedInWave.length} blocked task(s)`, {
				blocked: blockedInWave.join(","),
			});
			batchState.blockedTasks += blockedInWave.length;
		}
		if (terminalInWave.length > 0) {
			execLog("batch", batchState.batchId, `wave ${waveIdx + 1}: skipping ${terminalInWave.length} terminal task(s)`, {
				terminal: terminalInWave.join(","),
			});
		}

		if (waveTasks.length === 0) {
			execLog("batch", batchState.batchId, `wave ${waveIdx + 1}: no tasks to execute (all blocked or terminal)`);
			continue;
		}

		const handleWaveMonitorUpdate: MonitorUpdateCallback = (monitorState) => {
			const changed = syncTaskOutcomesFromMonitor(monitorState, allTaskOutcomes);
			if (changed) {
				persistRuntimeState("task-transition", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
			}
			onMonitorUpdate?.(monitorState);
		};

		// Execute the wave
		const onLanesAllocatedCb = (lanes: AllocatedLane[]) => {
			latestAllocatedLanes = lanes;
			batchState.currentLanes = lanes;

			// Emit wave_start with actual lane count (post-affinity grouping)
			onNotify(
				ORCH_MESSAGES.orchWaveStart(waveIdx + 1, runtimeSegmentRounds.length, waveTasks.length, lanes.length),
				"info",
			);
			// TP-148: Build per-task segment context for the wave_start event
			const waveSegmentContext: Array<{ taskId: string; segmentIndex: number; totalSegments: number; repoId: string; segmentId: string }> = [];
			for (const taskId of waveTasks) {
				const segState = segmentStateByTask.get(taskId);
				if (segState && segState.orderedSegments.length > 1) {
					const idx = segState.nextSegmentIndex;
					const seg = segState.orderedSegments[idx];
					if (seg) {
						waveSegmentContext.push({
							taskId,
							segmentIndex: idx + 1,
							totalSegments: segState.orderedSegments.length,
							repoId: seg.repoId,
							segmentId: seg.segmentId,
						});
					}
				}
			}
			emitEvent(stateRoot, {
				...buildEngineEventBase("wave_start", batchState.batchId, waveIdx, batchState.phase),
				taskIds: waveTasks,
				laneCount: lanes.length,
				...(waveSegmentContext.length > 0 ? { segmentContext: waveSegmentContext } : {}),
			}, onEngineEvent);
			// TP-029: Track repos from newly allocated lanes for cleanup coverage
			for (const lane of lanes) {
				const laneRepoRoot = resolveRepoRoot(lane.repoId, repoRoot, workspaceConfig);
				encounteredRepoRoots.set(laneRepoRoot, lane.repoId);
			}
			const seededPendingOutcomes = seedPendingOutcomesForAllocatedLanes(lanes, allTaskOutcomes);
			let startedSegments = false;
			for (const lane of lanes) {
				for (const laneTask of lane.tasks) {
					const task = discovery.pending.get(laneTask.taskId);
					const segmentState = segmentStateByTask.get(laneTask.taskId);
					if (!task || !segmentState) continue;
					startedSegments = upsertRunningSegmentRecord(batchState, task, segmentState, lane) || startedSegments;
				}
			}
			if (seededPendingOutcomes || startedSegments) {
				persistRuntimeState(
					startedSegments ? "segment-start" : "wave-lanes-allocated",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discoveryRef,
					stateRoot,
				);
			}
		};

		let waveResult = await executeWave(
			waveTasks,
			waveIdx + 1,
			discovery.pending,
			orchConfig,
			repoRoot,
			batchState.batchId,
			batchState.pauseSignal,
			depGraph,
			batchState.orchBranch,
			handleWaveMonitorUpdate,
			onLanesAllocatedCb,
			workspaceConfig,
			selectedBackend,
			emitAlert,
			supervisorAutonomy,
			{
				model: runnerConfig?.reviewer?.model || "",
				thinking: runnerConfig?.reviewer?.thinking || "",
				tools: runnerConfig?.reviewer?.tools || "",
			},
		);

		// ── TP-039: Tier 0 — Stale worktree recovery ────────────
		// If allocation failed with ALLOC_WORKTREE_FAILED, force cleanup
		// and retry the entire wave execution once.
		if (waveResult.allocationError?.code === "ALLOC_WORKTREE_FAILED") {
			const retryResult = await attemptStaleWorktreeRecovery(
				waveResult,
				waveTasks,
				waveIdx,
				discovery,
				orchConfig,
				repoRoot,
				batchState,
				depGraph,
				workspaceConfig,
				handleWaveMonitorUpdate,
				onLanesAllocatedCb,
				stateRoot,
				selectedBackend,
				emitAlert,
				supervisorAutonomy,
				runnerConfig,
			);
			if (retryResult) {
				const staleRecovered = !retryResult.allocationError;
				onNotify(
					`🔄 Tier 0: Stale worktree recovery ${staleRecovered ? "succeeded" : "failed"} for wave ${waveIdx + 1}`,
					staleRecovered ? "info" : "warning",
				);

				// Emit success or exhausted event based on retry result
				const staleScopeKey = tier0WaveScopeKey("stale_worktree", waveIdx);
				const staleCount = batchState.resilience?.retryCountByScope[staleScopeKey] ?? 1;
				if (staleRecovered) {
					emitTier0Event(stateRoot, {
						...buildTier0EventBase("tier0_recovery_success", batchState.batchId, waveIdx, "stale_worktree", staleCount, TIER0_RETRY_BUDGETS.stale_worktree.maxRetries),
						repoId: null, // wave-scoped
						resolution: `Stale worktree cleanup succeeded — wave ${waveIdx + 1} re-executed successfully`,
						scopeKey: staleScopeKey,
					});
				} else {
					const staleRetryError = retryResult.allocationError?.message ?? "Allocation failed again after cleanup";
					const staleRetrySuggestion = "Stale worktree cleanup did not resolve the allocation failure. Manually inspect and remove worktrees.";
					emitTier0Event(stateRoot, {
						...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "stale_worktree", staleCount, TIER0_RETRY_BUDGETS.stale_worktree.maxRetries),
						repoId: null, // wave-scoped
						error: staleRetryError,
						scopeKey: staleScopeKey,
						affectedTaskIds: waveTasks,
						suggestion: staleRetrySuggestion,
					});
					emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "stale_worktree", staleCount, TIER0_RETRY_BUDGETS.stale_worktree.maxRetries,
						staleRetryError, waveTasks, staleRetrySuggestion,
						{ repoId: null, scopeKey: staleScopeKey },
					);
				}

				waveResult = retryResult;
			}
		}

		batchState.waveResults.push(waveResult);
		batchState.currentLanes = []; // Clear current lanes after wave completes

		// ── TS-009: Accumulate task outcomes from this wave ──
		latestAllocatedLanes = waveResult.allocatedLanes;
		for (const lr of waveResult.laneResults) {
			for (const taskOutcome of lr.tasks) {
				upsertTaskOutcome(allTaskOutcomes, taskOutcome);
			}
		}

		// ── TP-055: Tier 0 — Model fallback retry ───────────────
		// Run model fallback BEFORE worker crash retry so that model_access_error
		// tasks are retried with session model first. Worker crash retry skips
		// model_access_error tasks (handled here instead).
		if (waveResult.failedTaskIds.length > 0) {
			const modelFallbackOutcome = await attemptModelFallbackRetry(
				waveResult,
				waveIdx,
				batchState,
				orchConfig,
				repoRoot,
				workspaceConfig,
				allTaskOutcomes,
				onNotify,
				stateRoot,
				runnerConfig,
				selectedBackend,
			);
			if (modelFallbackOutcome.succeededRetries.length > 0) {
				// Recompute blocked tasks after model fallback successes
				if (waveResult.policyApplied === "skip-dependents" && waveResult.failedTaskIds.length > 0) {
					const recomputed = computeTransitiveDependents(
						new Set(waveResult.failedTaskIds),
						depGraph,
					);
					waveResult.blockedTaskIds = [...recomputed].sort();
				} else if (waveResult.failedTaskIds.length === 0) {
					waveResult.blockedTaskIds = [];
				}
			}
			if (modelFallbackOutcome.retriedCount > 0) {
				persistRuntimeState("tier0-model-fallback", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
			}
		}

		// ── TP-039: Tier 0 — Worker crash retry ─────────────────
		// Run retry BEFORE accumulating counts and blocked tasks so that
		// successfully retried tasks don't inflate failedTasks count and
		// their dependents aren't incorrectly blocked (R002-2 fix).
		if (waveResult.failedTaskIds.length > 0) {
			const retryOutcome = await attemptWorkerCrashRetry(
				waveResult,
				waveIdx,
				batchState,
				orchConfig,
				repoRoot,
				workspaceConfig,
				allTaskOutcomes,
				onNotify,
				stateRoot,
				undefined,
				selectedBackend,
			);
			if (retryOutcome.succeededRetries.length > 0) {
				// Recompute blockedTaskIds from remaining failures (R002-2).
				// attemptWorkerCrashRetry already updated waveResult.failedTaskIds
				// and waveResult.succeededTaskIds in-place.
				if (waveResult.policyApplied === "skip-dependents" && waveResult.failedTaskIds.length > 0) {
					const recomputed = computeTransitiveDependents(
						new Set(waveResult.failedTaskIds),
						depGraph,
					);
					waveResult.blockedTaskIds = [...recomputed].sort();
				} else if (waveResult.failedTaskIds.length === 0) {
					// All failures recovered — no blocked tasks
					waveResult.blockedTaskIds = [];
				}
			}
			if (retryOutcome.retriedCount > 0) {
				// Persist updated state after retries
				persistRuntimeState("tier0-worker-retry", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
			}

			// If stop-wave had paused the batch but Tier 0 retry recovered all
			// failures, clear the policy-induced pause so subsequent waves can
			// proceed. attemptWorkerCrashRetry already set stoppedEarly=false
			// and overallStatus="succeeded" on the waveResult (R002-4 fix).
			if (
				waveResult.failedTaskIds.length === 0
				&& batchState.pauseSignal.paused
				&& waveResult.policyApplied === "stop-wave"
			) {
				batchState.pauseSignal.paused = false;
				execLog("batch", batchState.batchId,
					`tier0: all failed tasks recovered — clearing stop-wave pause`,
				);
				onNotify(
					`✅ Tier 0: All failed tasks recovered — batch continuing past stop-wave`,
					"info",
				);
			}
		}

		// Segment frontier lifecycle transitions (pending → running → terminal).
		const succeededSegmentTaskIdsForMerge = [...waveResult.succeededTaskIds];
		const completedTaskIdsThisWave: string[] = [];
		const failedTaskIdsThisWave: string[] = [];
		const skippedTaskIdsThisWave: string[] = [];
		const continuationTaskIds = new Set<string>();
		const laneByTaskId = new Map<string, AllocatedLane>();
		for (const lane of latestAllocatedLanes) {
			for (const laneTask of lane.tasks) {
				laneByTaskId.set(laneTask.taskId, lane);
			}
		}

		for (const taskId of waveResult.succeededTaskIds) {
			const task = discovery.pending.get(taskId);
			const segmentState = segmentStateByTask.get(taskId);
			if (!task || !segmentState) continue;

			// Use the completing segment ID from the task outcome, not task.activeSegmentId
			// which may already be null (advanced by pre-wave loop for next wave).
			const outcome = allTaskOutcomes.find((candidate) => candidate.taskId === taskId);
			const activeSegmentId = outcome?.segmentId ?? task.activeSegmentId;
			if (activeSegmentId) {
				segmentState.statusBySegmentId.set(activeSegmentId, "succeeded");
				upsertTerminalSegmentRecord(batchState, task, segmentState, activeSegmentId, "succeeded", outcome, laneByTaskId.get(taskId));

				const workerAgentId = resolveTaskWorkerAgentId(taskId, allTaskOutcomes, laneByTaskId);
				if (workerAgentId) {
					const pendingExpansionFiles = listPendingSegmentExpansionRequestFiles(stateRoot, batchState.batchId, workerAgentId);
					if (pendingExpansionFiles.length > 0) {
						const parsedRequests = parseSegmentExpansionRequests(pendingExpansionFiles);
						for (const malformed of parsedRequests.malformed) {
							const renamed = markSegmentExpansionRequestFile(malformed.filePath, "invalid");
							execLog("batch", batchState.batchId, `segment expansion request malformed (${renamed ? "renamed to .invalid" : "rename failed"})`, {
								taskId,
								agentId: workerAgentId,
								segmentId: activeSegmentId,
								filePath: malformed.filePath,
								reason: malformed.reason,
							});
						}
						const orderedRequests = [...parsedRequests.valid].sort((a, b) => a.request.requestId.localeCompare(b.request.requestId));
						const scopedRequests = orderedRequests.filter((pendingRequest) => (
							pendingRequest.request.taskId === taskId
							&& pendingRequest.request.fromSegmentId === activeSegmentId
						));
						let rejectedCount = 0;
						let acceptedCount = 0;
						for (const pendingRequest of scopedRequests) {
							const requestId = pendingRequest.request.requestId;
							const processingResult = processSegmentExpansionRequestAtBoundary(
								batchState.batchId,
								taskId,
								activeSegmentId,
								workerAgentId,
								pendingRequest,
								segmentState,
								workspaceConfig,
								processedSegmentExpansionRequestIds,
							);
							if (!processingResult.ok) {
								rejectedCount += 1;
								processedSegmentExpansionRequestIds.add(requestId);
								const recordedRequestId = recordProcessedSegmentExpansionRequestId(batchState, requestId, "failed");
								if (recordedRequestId) {
									persistRuntimeState("segment-expansion-rejected", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
								}
								const renamedRejected = markSegmentExpansionRequestFile(pendingRequest.filePath, "rejected");
								emitAlert({
									category: "segment-expansion-rejected",
									summary:
										`❌ Segment expansion rejected\n` +
										`  Task: ${taskId}\n` +
										`  Segment: ${activeSegmentId}\n` +
										`  Request: ${requestId}\n` +
										`  Reason: ${processingResult.reason}\n` +
										`  File state: ${renamedRejected ? ".rejected" : "rename failed"}`,
									context: {
										taskId,
										segmentId: activeSegmentId,
										agentId: workerAgentId,
										expansionRequestId: requestId,
										exitReason: processingResult.reason,
									},
								});
								continue;
							}

							const beforeSegmentIds = segmentState.orderedSegments.map((segment) => segment.segmentId);
							const mutation = handoffSegmentExpansionToMutation(
								batchState.batchId,
								taskId,
								activeSegmentId,
								workerAgentId,
								pendingRequest,
								segmentState,
							);
							task.segmentIds = segmentState.orderedSegments.map((segment) => segment.segmentId);
							const afterSegmentIds = [...task.segmentIds];
							const persistedInsertedSegments = upsertPendingExpandedSegmentRecords(
								batchState,
								task,
								segmentState,
								mutation.insertedSegmentIds,
								activeSegmentId,
								requestId,
								batchState.orchBranch,
							);
							const recordedRequestId = recordProcessedSegmentExpansionRequestId(batchState, requestId, "succeeded");

							// TP-145 hardening: if .DONE was prematurely created by the
							// completing segment (because it was the last segment at that
							// time), remove it now. The task is no longer complete — new
							// segments have been added and must execute first.
							// Only delete if segments were actually inserted (avoid
							// reopening a completed task on no-op mutations).
							const doneDir = task.packetTaskPath || task.taskFolder;
							if (doneDir && mutation.insertedSegmentIds.length > 0) {
								const donePath = join(doneDir, ".DONE");
								if (existsSync(donePath)) {
									try {
										unlinkSync(donePath);
										execLog("batch", batchState.batchId, "removed premature .DONE after segment expansion", {
											taskId, donePath, requestId,
										});
									} catch { /* non-fatal */ }
								}
							}

							if (persistedInsertedSegments || recordedRequestId || mutation.insertedSegmentIds.length > 0) {
								persistRuntimeState("segment-expansion-approved", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
							}
							const renamedProcessed = markSegmentExpansionRequestFile(pendingRequest.filePath, "processed");
							emitAlert({
								category: "segment-expansion-approved",
								summary:
									`✅ Segment expansion approved\n` +
									`  Task: ${taskId}\n` +
									`  Segment: ${activeSegmentId}\n` +
									`  Request: ${requestId}\n` +
									`  Before: ${beforeSegmentIds.join(", ")}\n` +
									`  After: ${afterSegmentIds.join(", ")}\n` +
									`  Inserted: ${mutation.insertedSegmentIds.join(", ")}\n` +
									`  File state: ${renamedProcessed ? ".processed" : "rename failed"}`,
								context: {
									taskId,
									segmentId: activeSegmentId,
									agentId: workerAgentId,
									expansionRequestId: requestId,
								},
							});
							acceptedCount += 1;
						}
						execLog("batch", batchState.batchId, `segment ${activeSegmentId} completed with ${pendingExpansionFiles.length} pending expansion request(s)`, {
							taskId,
							agentId: workerAgentId,
							segmentId: activeSegmentId,
							acceptedCount,
							rejectedCount,
							validRequests: parsedRequests.valid.length,
							scopedRequests: scopedRequests.length,
							ignoredRequests: orderedRequests.length - scopedRequests.length,
							malformedRequests: parsedRequests.malformed.length,
						});
					}
				}
			}
			recomputeNextPendingSegmentIndex(segmentState);
			task.activeSegmentId = null;

			if (segmentState.nextSegmentIndex >= segmentState.orderedSegments.length) {
				segmentState.terminalStatus = "succeeded";
				terminalSegmentTasks.add(taskId);
				completedTaskIdsThisWave.push(taskId);
			} else if (!hasTaskInFutureSegmentRounds(runtimeSegmentRounds, waveIdx + 1, taskId)) {
				continuationTaskIds.add(taskId);
			}
		}
		if (continuationTaskIds.size > 0) {
			const continuationWave = scheduleContinuationSegmentRound(runtimeSegmentRounds, waveIdx, continuationTaskIds);
			execLog("batch", batchState.batchId, "scheduled continuation segment round for expanded task frontier", {
				waveIndex: waveIdx,
				taskIds: continuationWave.join(","),
				runtimeSegmentRoundCount: runtimeSegmentRounds.length,
			});
		}

		for (const taskId of waveResult.failedTaskIds) {
			const task = discovery.pending.get(taskId);
			const segmentState = segmentStateByTask.get(taskId);
			if (!task || !segmentState) continue;
			const failOutcome = allTaskOutcomes.find((candidate) => candidate.taskId === taskId);
			const activeSegmentId = failOutcome?.segmentId ?? task.activeSegmentId;
			if (activeSegmentId) {
				segmentState.statusBySegmentId.set(activeSegmentId, "failed");
				upsertTerminalSegmentRecord(batchState, task, segmentState, activeSegmentId, "failed", failOutcome, laneByTaskId.get(taskId));

				const workerAgentId = resolveTaskWorkerAgentId(taskId, allTaskOutcomes, laneByTaskId);
				if (workerAgentId) {
					const pendingExpansionFiles = listPendingSegmentExpansionRequestFiles(stateRoot, batchState.batchId, workerAgentId);
					if (pendingExpansionFiles.length > 0) {
						const parsedRequests = parseSegmentExpansionRequests(pendingExpansionFiles);
						for (const malformed of parsedRequests.malformed) {
							markSegmentExpansionRequestFile(malformed.filePath, "invalid");
						}

						let discardedCount = 0;
						let ignoredCount = 0;
						for (const requestFile of parsedRequests.valid) {
							if (requestFile.request.taskId === taskId && requestFile.request.fromSegmentId === activeSegmentId) {
								const requestId = requestFile.request.requestId;
								processedSegmentExpansionRequestIds.add(requestId);
								const recordedRequestId = recordProcessedSegmentExpansionRequestId(batchState, requestId, "skipped");
								if (recordedRequestId) {
									persistRuntimeState("segment-expansion-discarded", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
								}
								if (markSegmentExpansionRequestFile(requestFile.filePath, "discarded")) {
									discardedCount += 1;
								}
								continue;
							}
							ignoredCount += 1;
						}
						execLog("batch", batchState.batchId, `segment ${activeSegmentId} failed with ${pendingExpansionFiles.length} pending expansion request(s)`, {
							taskId,
							agentId: workerAgentId,
							segmentId: activeSegmentId,
							discardedCount,
							ignoredCount,
							malformedCount: parsedRequests.malformed.length,
						});
						if (discardedCount > 0) {
							emitAlert({
								category: "segment-expansion-rejected",
								summary:
									`🗑️ Segment expansion requests discarded\n` +
									`  Task: ${taskId}\n` +
									`  Segment: ${activeSegmentId}\n` +
									`  Agent: ${workerAgentId}\n` +
									`  Discarded: ${discardedCount}`,
								context: {
									taskId,
									segmentId: activeSegmentId,
									agentId: workerAgentId,
									exitReason: "segment-expansion-discarded-originating-segment-failed",
								},
							});
						}
					}
				}
			}
			task.activeSegmentId = null;
			segmentState.terminalStatus = "failed";
			terminalSegmentTasks.add(taskId);
			failedTaskIdsThisWave.push(taskId);
		}

		for (const taskId of waveResult.skippedTaskIds) {
			const task = discovery.pending.get(taskId);
			const segmentState = segmentStateByTask.get(taskId);
			if (!task || !segmentState) continue;
			const activeSegmentId = task.activeSegmentId;
			if (activeSegmentId) {
				segmentState.statusBySegmentId.set(activeSegmentId, "skipped");
				const outcome = allTaskOutcomes.find((candidate) => candidate.taskId === taskId);
				upsertTerminalSegmentRecord(batchState, task, segmentState, activeSegmentId, "skipped", outcome, laneByTaskId.get(taskId));
			}
			task.activeSegmentId = null;
			segmentState.terminalStatus = "skipped";
			terminalSegmentTasks.add(taskId);
			skippedTaskIdsThisWave.push(taskId);
		}

		// Project task-level completion/failure onto wave result arrays.
		waveResult.succeededTaskIds = [...new Set(completedTaskIdsThisWave)].sort();
		waveResult.failedTaskIds = [...new Set(failedTaskIdsThisWave)].sort();
		waveResult.skippedTaskIds = [...new Set(skippedTaskIdsThisWave)].sort();

		// Accumulate results (after retry so counts reflect recovered tasks)
		batchState.succeededTasks += waveResult.succeededTaskIds.length;
		batchState.failedTasks += waveResult.failedTaskIds.length;
		batchState.skippedTasks += waveResult.skippedTaskIds.length;

		// Add newly blocked tasks (after retry so recovered tasks don't block dependents)
		for (const blocked of waveResult.blockedTaskIds) {
			batchState.blockedTaskIds.add(blocked);
		}

		// ── TP-040: Emit task_complete / task_failed events ──────
		// Emitted after Tier 0 retry so events reflect final status.
		for (const taskId of waveResult.succeededTaskIds) {
			const outcome = allTaskOutcomes.find(o => o.taskId === taskId);
			emitEvent(stateRoot, {
				...buildEngineEventBase("task_complete", batchState.batchId, waveIdx, batchState.phase),
				taskId,
				durationMs: outcome?.startTime && outcome?.endTime
					? outcome.endTime - outcome.startTime
					: undefined,
				outcome: "succeeded",
			}, onEngineEvent);
		}
		for (const taskId of waveResult.failedTaskIds) {
			const outcome = allTaskOutcomes.find(o => o.taskId === taskId);
			emitEvent(stateRoot, {
				...buildEngineEventBase("task_failed", batchState.batchId, waveIdx, batchState.phase),
				taskId,
				durationMs: outcome?.startTime && outcome?.endTime
					? outcome.endTime - outcome.startTime
					: undefined,
				reason: outcome?.exitReason || "unknown",
				partialProgress: (outcome?.partialProgressCommits ?? 0) > 0,
			}, onEngineEvent);

			// ── TP-076: Emit supervisor alert for task failure ──────
			const laneForTask = latestAllocatedLanes.find(l => l.tasks.some(t => t.taskId === taskId));
			const allocatedTask = laneForTask?.tasks.find(t => t.taskId === taskId)?.task;
			const exitReason = outcome?.exitReason || "unknown";
			const hasPartialProgress = (outcome?.partialProgressCommits ?? 0) > 0;
			const segmentFrontier = buildSupervisorSegmentFrontierSnapshot(
				taskId,
				allocatedTask?.segmentIds,
				allocatedTask?.activeSegmentId,
				batchState.segments,
				outcome?.segmentId,
			);
			const segmentId = outcome?.segmentId
				?? allocatedTask?.activeSegmentId
				?? segmentFrontier?.activeSegmentId
				?? undefined;
			const repoId = segmentId
				? (segmentFrontier?.segments.find((segment) => segment.segmentId === segmentId)?.repoId ?? laneForTask?.repoId)
				: laneForTask?.repoId;
			const segmentSummary = segmentId
				? `  Segment: ${segmentId}${repoId ? ` (repo: ${repoId})` : ""}\n`
				: "";
			const frontierSummary = segmentFrontier
				? `  Segment frontier: ${segmentFrontier.terminalSegments}/${segmentFrontier.totalSegments} terminal\n`
				: "";
			emitAlert({
				category: "task-failure",
				summary:
					`⚠️ Task failure: ${taskId}\n` +
					`  Exit reason: ${exitReason}\n` +
					segmentSummary +
					frontierSummary +
					`  Lane: ${laneForTask?.laneId ?? "unknown"} (lane ${laneForTask?.laneNumber ?? "?"})\n` +
					`  Partial progress preserved: ${hasPartialProgress ? "yes" : "no"}\n` +
					`  Batch: wave ${waveIdx + 1}/${batchState.totalWaves}, ` +
					`${batchState.succeededTasks} succeeded, ${batchState.failedTasks} failed\n\n` +
					`Available actions:\n` +
					`  - orch_status() to inspect current state\n` +
					`  - orch_resume(force=true) to retry\n` +
					`  - Read STATUS.md and lane logs for diagnosis`,
				context: {
					taskId,
					segmentId,
					repoId,
					segmentFrontier,
					laneId: laneForTask?.laneId,
					laneNumber: laneForTask?.laneNumber,
					waveIndex: waveIdx,
					exitReason,
					partialProgress: hasPartialProgress,
					batchProgress: buildBatchProgressSnapshot(batchState),
				},
			});
		}

		// ── TS-009: Persist state after wave execution ──
		persistRuntimeState("wave-execution-complete", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

		const elapsedSec = Math.round((waveResult.endedAt - waveResult.startedAt) / 1000);
		onNotify(
			ORCH_MESSAGES.orchWaveComplete(
				waveIdx + 1,
				waveResult.succeededTaskIds.length,
				waveResult.failedTaskIds.length,
				waveResult.skippedTaskIds.length,
				elapsedSec,
			),
			waveResult.failedTaskIds.length > 0 ? "warning" : "info",
		);

		// NOTE: No explicit wave_complete event in the spec event set. The supervisor
		// infers wave completion from the sequence of task_complete/task_failed events
		// followed by merge_start or the next wave_start.

		// Check if we should stop based on task failure policy
		if (waveResult.stoppedEarly) {
			if (waveResult.policyApplied === "stop-all") {
				batchState.phase = "stopped";
				// ── TS-009: Persist state on stop-all ──
				persistRuntimeState("stop-all", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(ORCH_MESSAGES.orchBatchStopped(batchState.batchId, "stop-all"), "error");
				// TP-040: Emit batch_paused event (via terminal helper for dedup)
				emitTerminalEvent(`Stopped by stop-all policy at wave ${waveIdx + 1}`);
				break;
			}
			if (waveResult.policyApplied === "stop-wave") {
				batchState.phase = "stopped";
				// ── TS-009: Persist state on stop-wave ──
				persistRuntimeState("stop-wave", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(ORCH_MESSAGES.orchBatchStopped(batchState.batchId, "stop-wave"), "error");
				// TP-040: Emit batch_paused event (via terminal helper for dedup)
				emitTerminalEvent(`Stopped by stop-wave policy at wave ${waveIdx + 1}`);
				break;
			}
		}

		// ── Wave Merge ───────────────────────────────────────────
		// Merge when at least one segment execution succeeded in this wave.
		let mergeResult: MergeWaveResult | null = null;

		// Build lane outcome lookup and detect mixed-outcome lanes
		// (succeeded work + failed/stalled task in same lane).
		const laneOutcomeByNumber = new Map<number, LaneExecutionResult>();
		for (const lr of waveResult.laneResults) {
			laneOutcomeByNumber.set(lr.laneNumber, lr);
		}
		const mixedOutcomeLanes = waveResult.laneResults.filter(lr => {
			const hasSucceeded = lr.tasks.some(t => t.status === "succeeded");
			const hasHardFailure = lr.tasks.some(
				t => t.status === "failed" || t.status === "stalled",
			);
			return hasSucceeded && hasHardFailure;
		});

		// ── Safety net: auto-commit uncommitted artifacts before merge ──
		// Workers should commit at step boundaries, but may leave uncommitted
		// files (especially for level-0 / fast tasks). Check each merge-candidate
		// lane worktree and auto-commit any remaining changes so they're included
		// in the merge. Skips lanes with only failed/stalled tasks (no merge).
		// TP-147: Also auto-commit skipped-task lanes so partial progress
		// (STATUS.md updates, partial code) is preserved on their branch.
		for (const lane of waveResult.allocatedLanes) {
			if (!lane.worktreePath || !existsSync(lane.worktreePath)) continue;
			const laneOutcome = laneOutcomeByNumber.get(lane.laneNumber);
			if (!laneOutcome) continue;
			const hasSucceeded = laneOutcome.tasks.some(t => t.status === "succeeded");
			const hasSkipped = laneOutcome.tasks.some(t => t.status === "skipped");
			// Auto-commit merge candidates (succeeded) and skipped-task lanes
			if (!hasSucceeded && !hasSkipped) continue;
			try {
				const addResult = runGit(["add", "-A"], lane.worktreePath);
				if (!addResult.ok) {
					execLog("merge", batchState.batchId, `safety-net: git add failed in ${lane.laneId}`, { stderr: addResult.stderr });
					continue;
				}
				const statusResult = runGit(["status", "--porcelain"], lane.worktreePath);
				if (!statusResult.ok || !statusResult.stdout?.trim()) continue;
				const taskIds = lane.tasks.map(t => t.taskId).join(", ");
				const commitResult = runGit(
					["commit", "-m", `safety-net: uncommitted artifacts for ${taskIds}`],
					lane.worktreePath,
				);
				if (commitResult.ok) {
					execLog("merge", batchState.batchId, `safety-net: auto-committed uncommitted files in ${lane.laneId}`, {
						worktree: lane.worktreePath,
						taskIds,
						files: statusResult.stdout.trim(),
					});
				} else {
					execLog("merge", batchState.batchId, `safety-net: commit failed in ${lane.laneId}`, { stderr: commitResult.stderr });
				}
			} catch (err: any) {
				execLog("merge", batchState.batchId, `safety-net: unexpected error in ${lane.laneId}`, { error: err?.message });
			}
		}

		if (succeededSegmentTaskIdsForMerge.length > 0) {
			const mergeableLaneCount = waveResult.allocatedLanes.filter(lane => {
				const outcome = laneOutcomeByNumber.get(lane.laneNumber);
				if (!outcome) return false;
				const hasSucceeded = outcome.tasks.some(t => t.status === "succeeded");
				const hasHardFailure = outcome.tasks.some(
					t => t.status === "failed" || t.status === "stalled",
				);
				return hasSucceeded && !hasHardFailure;
			}).length;

			if (mergeableLaneCount > 0) {
				batchState.phase = "merging";
				// ── TS-009: Persist state on executing→merging transition ──
				persistRuntimeState("merge-start", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(ORCH_MESSAGES.orchMergeStart(waveIdx + 1, mergeableLaneCount), "info");
				// TP-040: Emit merge_start event
				emitEvent(stateRoot, {
					...buildEngineEventBase("merge_start", batchState.batchId, waveIdx, batchState.phase),
					laneCount: mergeableLaneCount,
				}, onEngineEvent);

				// TP-056: Start merge health monitor during merge phase
				const mergeHealthMonitor = new MergeHealthMonitor({
					stateRoot,
					batchId: batchState.batchId,
					waveIndex: waveIdx,
					phase: batchState.phase,
					onDeadSession: (sessionName, laneNumber) => {
						execLog("batch", batchState.batchId, `merge health monitor detected dead session`, {
							sessionName,
							laneNumber,
							waveIndex: waveIdx,
						});
					},
				});
				mergeHealthMonitor.start();

				try {
					mergeResult = await mergeWaveByRepo(
						waveResult.allocatedLanes,
						waveResult,
						waveIdx + 1,
						orchConfig,
						repoRoot,
						batchState.batchId,
						batchState.orchBranch,
						workspaceConfig,
						stateRoot,
						agentRoot,
						runnerConfig.testing_commands,
						mergeHealthMonitor,
						undefined, // forceMixedOutcome
						selectedBackend,
					);
				} finally {
					// TP-056: Always stop the health monitor when merge phase ends
					mergeHealthMonitor.stop();
				}
				allMergeResults.push(mergeResult);
				batchState.mergeResults.push(mergeResult);

				// Persist state after merge so dashboard shows wave merge results
				persistRuntimeState("merge-complete", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

				// Emit per-lane merge notifications
				for (const lr of mergeResult.laneResults) {
					const durationSec = Math.round(lr.durationMs / 1000);
					// TP-032 R006-3: Check lr.error first — verification_new_failure lanes
					// have error set even though lr.result.status may be SUCCESS/CONFLICT_RESOLVED.
					if (lr.error) {
						onNotify(ORCH_MESSAGES.orchMergeLaneFailed(lr.laneNumber, lr.error), "error");
					} else if (lr.result?.status === "SUCCESS") {
						onNotify(ORCH_MESSAGES.orchMergeLaneSuccess(lr.laneNumber, lr.result.merge_commit, durationSec), "info");
					} else if (lr.result?.status === "CONFLICT_RESOLVED") {
						onNotify(ORCH_MESSAGES.orchMergeLaneConflictResolved(lr.laneNumber, lr.result.conflicts.length, durationSec), "info");
					} else if (lr.result?.status === "CONFLICT_UNRESOLVED" || lr.result?.status === "BUILD_FAILURE") {
						onNotify(ORCH_MESSAGES.orchMergeLaneFailed(lr.laneNumber, lr.result.status), "error");
					}
				}

				// If any lane has mixed outcomes, do not silently discard succeeded work.
				// Force merge failure handling so state is preserved for manual resolution.
				if (mixedOutcomeLanes.length > 0) {
					const mixedIds = mixedOutcomeLanes.map(l => `lane-${l.laneNumber}`).join(", ");
					const failureReason =
						`Lane(s) ${mixedIds} contain both succeeded and failed tasks. ` +
						`Automatic partial-branch merge is disabled to avoid dropping succeeded commits.`;
					execLog("merge", `W${waveIdx + 1}`, "mixed-outcome lanes detected — escalating to merge failure handling", {
						mixedLaneIds: mixedIds,
					});
					mergeResult = {
						...mergeResult,
						status: "partial",
						failedLane: mixedOutcomeLanes[0].laneNumber,
						failureReason,
					};
					// Update the already-pushed references so persisted state reflects "partial"
					allMergeResults[allMergeResults.length - 1] = mergeResult;
					batchState.mergeResults[batchState.mergeResults.length - 1] = mergeResult;
				}

				// Emit overall merge result notification
				// TP-032 R006-3: Exclude verification_new_failure lanes from success count
				const mergedCount = mergeResult.laneResults.filter(
					r => !r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED"),
				).length;
				const mergeTotalSec = Math.round(mergeResult.totalDurationMs / 1000);

				if (mergeResult.status === "succeeded") {
					onNotify(ORCH_MESSAGES.orchMergeComplete(waveIdx + 1, mergedCount, mergeTotalSec), "info");

					// TP-040: Emit merge_success event
					emitEvent(stateRoot, {
						...buildEngineEventBase("merge_success", batchState.batchId, waveIdx, batchState.phase),
						laneCount: mergedCount,
						durationMs: mergeResult.totalDurationMs,
						totalWaves: runtimeSegmentRounds.length,
					}, onEngineEvent);
				} else {
					onNotify(
						ORCH_MESSAGES.orchMergeFailed(waveIdx + 1, mergeResult.failedLane ?? 0, mergeResult.failureReason || "unknown"),
						"error",
					);

					// TP-040: Emit merge_failed event
					emitEvent(stateRoot, {
						...buildEngineEventBase("merge_failed", batchState.batchId, waveIdx, batchState.phase),
						laneNumber: mergeResult.failedLane ?? undefined,
						error: mergeResult.failureReason || "unknown",
					}, onEngineEvent);

					// Emit repo-divergence summary when partial is caused by cross-repo outcome differences
					if (mergeResult.status === "partial") {
						const repoSummary = formatRepoMergeSummary(mergeResult);
						if (repoSummary) {
							onNotify(repoSummary, "warning");
						}
					}
				}

				// Restore phase to executing (may be overridden below by failure handling)
				batchState.phase = "executing";
				// ── TS-009: Persist state after merge (merging→executing) ──
				persistRuntimeState("merge-complete", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
			} else if (mixedOutcomeLanes.length > 0) {
				const mixedIds = mixedOutcomeLanes.map(l => `lane-${l.laneNumber}`).join(", ");
				mergeResult = {
					waveIndex: waveIdx + 1,
					status: "partial",
					laneResults: [],
					failedLane: mixedOutcomeLanes[0].laneNumber,
					failureReason:
						`Lane(s) ${mixedIds} contain both succeeded and failed tasks. ` +
						`Automatic partial-branch merge is disabled to avoid dropping succeeded commits.`,
					totalDurationMs: 0,
				};
				// Keep mergeResults in sync even when no mergeable lane exists.
				// Downstream retry/update paths assume the current wave has an entry.
				allMergeResults.push(mergeResult);
				batchState.mergeResults.push(mergeResult);
				onNotify(
					ORCH_MESSAGES.orchMergeFailed(waveIdx + 1, mergeResult.failedLane, mergeResult.failureReason || "unknown"),
					"error",
				);

				// TP-040 R002: Emit merge_failed for mixed-outcome/no-mergeable-lane path
				emitEvent(stateRoot, {
					...buildEngineEventBase("merge_failed", batchState.batchId, waveIdx, batchState.phase),
					laneNumber: mergeResult.failedLane,
					error: mergeResult.failureReason,
				}, onEngineEvent);
			} else {
				// No mergeable lanes and no mixed outcomes (e.g., only skipped tasks)
				onNotify(ORCH_MESSAGES.orchMergeSkipped(waveIdx + 1), "info");
			}
		} else {
			// No succeeded tasks — skip merge entirely
			onNotify(ORCH_MESSAGES.orchMergeSkipped(waveIdx + 1), "info");
		}

		// ── TP-033: Safe-stop on rollback failure ─────────────────
		// When a verification rollback failed, force paused regardless of
		// on_merge_failure policy. The merge worktree and temp branch are
		// preserved for manual recovery using commands in the transaction record.
		if (mergeResult?.rollbackFailed) {
			// TP-033 R004-2: Include persistence error warning when transaction
			// record files may be missing, so operator knows to inspect manually
			const hasPersistErrors = mergeResult.persistenceErrors && mergeResult.persistenceErrors.length > 0;
			const persistWarning = hasPersistErrors
				? ` WARNING: ${mergeResult.persistenceErrors!.length} transaction record(s) failed to persist — recovery file(s) may be missing.`
				: "";

			execLog("batch", batchState.batchId, "SAFE-STOP: verification rollback failed — forcing paused regardless of policy", {
				waveIndex: waveIdx,
				configPolicy: orchConfig.failure.on_merge_failure,
				...(hasPersistErrors ? { persistenceErrors: mergeResult.persistenceErrors } : {}),
			});

			batchState.phase = "paused";
			batchState.errors.push(
				`Safe-stop at wave ${waveIdx + 1}: verification rollback failed. ` +
				`Merge worktree and temp branch preserved for recovery. ` +
				`Check transaction records in .pi/verification/ for recovery commands.` +
				persistWarning
			);
			persistRuntimeState("merge-rollback-safe-stop", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
			onNotify(
				`🛑 Safe-stop: verification rollback failed at wave ${waveIdx + 1}. ` +
				`Batch force-paused. Merge worktree preserved for manual recovery. ` +
				`See .pi/verification/ transaction records for recovery commands.` +
				persistWarning,
				"error",
			);

			// ── TP-076: Emit supervisor alert for rollback safe-stop ──
			const rollbackError = `Safe-stop at wave ${waveIdx + 1}: verification rollback failed.${persistWarning}`;
			const rollbackRepoId = extractFailedRepoId(mergeResult) ?? undefined;
			emitAlert({
				category: "merge-failure",
				summary:
					`⚠️ Merge failed for wave ${waveIdx + 1} — verification rollback failed\n` +
					`  Batch force-paused for manual recovery.\n` +
					`  ${persistWarning ? persistWarning.trim() : "Check .pi/verification/ for recovery commands."}\n\n` +
					`Available actions:\n` +
					`  - Check .pi/verification/ transaction records for recovery commands\n` +
					`  - orch_status() to inspect current state\n` +
					`  - orch_resume(force=true) after manual recovery`,
				context: {
					waveIndex: waveIdx,
					laneNumber: mergeResult.failedLane ?? undefined,
					repoId: rollbackRepoId,
					mergeError: rollbackError,
					batchProgress: buildBatchProgressSnapshot(batchState),
				},
			});

			preserveWorktreesForResume = true;
			break;
		}

		// ── Handle merge failure ─────────────────────────────────
		// TP-033 Step 2 (R006): Retry policy matrix via shared applyMergeRetryLoop.
		// Classifies the failure, loops retries per the matrix (supports maxAttempts>1),
		// and on exhaustion forces paused regardless of on_merge_failure config.
		if (mergeResult && (mergeResult.status === "failed" || mergeResult.status === "partial")) {
			// Initialize resilience state if not yet present (fresh batch)
			if (!batchState.resilience) {
				batchState.resilience = defaultResilienceState();
			}

			// Extract repoId and lane for event attribution before entering retry loop
			const mergeRepoId = extractFailedRepoId(mergeResult) ?? null;
			const mergeFailedLane = mergeResult.failedLane ?? undefined;

			const retryOutcome = await applyMergeRetryLoop(
				mergeResult,
				waveIdx,
				batchState.resilience.retryCountByScope,
				{
					performMerge: async () => {
						batchState.phase = "merging";
						return await mergeWaveByRepo(
							waveResult.allocatedLanes,
							waveResult,
							waveIdx + 1,
							orchConfig,
							repoRoot,
							batchState.batchId,
							batchState.orchBranch,
							workspaceConfig,
							stateRoot,
							agentRoot,
							runnerConfig.testing_commands,
							undefined, // healthMonitor
							undefined, // forceMixedOutcome
							selectedBackend,
						);
					},
					persist: (trigger) => persistRuntimeState(trigger, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot),
					log: (message, details) => execLog("batch", batchState.batchId, message, details),
					notify: (message, level) => onNotify(message, level),
					updateMergeResult: (result) => {
						mergeResult = result;
						allMergeResults[allMergeResults.length - 1] = result;
						batchState.mergeResults[batchState.mergeResults.length - 1] = result;
					},
					sleep: sleepSync,
					// TP-039 R004: Emit attempt event only when retry is actually scheduled,
					// with accurate classification/attempt data from the retry decision.
					onRetryAttempt: (decision) => {
						emitTier0Event(stateRoot, {
							...buildTier0EventBase("tier0_recovery_attempt", batchState.batchId, waveIdx, "merge_timeout", decision.currentAttempt, decision.maxAttempts),
							laneNumber: mergeFailedLane,
							repoId: mergeRepoId,
							classification: decision.classification,
							cooldownMs: decision.cooldownMs,
						});
					},
				},
			);

			if (retryOutcome.kind === "retry_succeeded") {
				mergeResult = retryOutcome.mergeResult;
				batchState.phase = "executing";
				persistRuntimeState("merge-retry-succeeded", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

				// Emit merge retry success event
				emitTier0Event(stateRoot, {
					...buildTier0EventBase("tier0_recovery_success", batchState.batchId, waveIdx, "merge_timeout", retryOutcome.lastDecision.currentAttempt, retryOutcome.lastDecision.maxAttempts),
					laneNumber: mergeFailedLane,
					repoId: mergeRepoId,
					classification: retryOutcome.classification ?? undefined,
					resolution: `Merge retry succeeded at wave ${waveIdx + 1}`,
					scopeKey: retryOutcome.scopeKey,
				});

				// Fall through to normal post-merge flow (worktree cleanup, etc.)
			} else if (retryOutcome.kind === "safe_stop") {
				mergeResult = retryOutcome.mergeResult;
				batchState.phase = "paused";
				batchState.errors.push(retryOutcome.errorMessage);
				persistRuntimeState("merge-rollback-safe-stop", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(retryOutcome.notifyMessage, "error");

				// ── TP-076: Emit supervisor alert for merge safe-stop ──
				emitAlert({
					category: "merge-failure",
					summary:
						`⚠️ Merge failed for wave ${waveIdx + 1} — rollback failure, batch force-paused\n` +
						`  Merge policy: safe-stop (rollback failed)\n` +
						`  Failed lane: ${mergeResult.failedLane ?? "unknown"}\n` +
						`  Error: ${retryOutcome.errorMessage}\n\n` +
						`Available actions:\n` +
						`  - Investigate failed merge, check .pi/verification/ for recovery commands\n` +
						`  - orch_status() to inspect current state\n` +
						`  - orch_resume(force=true) after manual recovery`,
					context: {
						waveIndex: waveIdx,
						laneNumber: mergeResult.failedLane ?? undefined,
						repoId: mergeRepoId ?? undefined,
						mergeError: retryOutcome.errorMessage,
						batchProgress: buildBatchProgressSnapshot(batchState),
					},
				});

				// Emit merge safe-stop event (treated as exhausted — no further automatic recovery possible)
				const mergeSafeStopSuggestion = "Merge rollback failed — batch force-paused for manual recovery. Check .pi/verification/ for recovery commands.";
				emitTier0Event(stateRoot, {
					...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "merge_timeout", retryOutcome.lastDecision.currentAttempt, retryOutcome.lastDecision.maxAttempts),
					laneNumber: mergeFailedLane,
					repoId: mergeRepoId,
					classification: retryOutcome.classification ?? undefined,
					error: retryOutcome.errorMessage,
					scopeKey: retryOutcome.scopeKey,
					suggestion: mergeSafeStopSuggestion,
				});
				emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "merge_timeout",
					retryOutcome.lastDecision.currentAttempt, retryOutcome.lastDecision.maxAttempts,
					retryOutcome.errorMessage, [], mergeSafeStopSuggestion,
					{ laneNumber: mergeFailedLane, repoId: mergeRepoId, classification: retryOutcome.classification ?? undefined, scopeKey: retryOutcome.scopeKey },
				);

				preserveWorktreesForResume = true;
				break;
			} else if (retryOutcome.kind === "exhausted") {
				// TP-033 R006-2: Force paused regardless of on_merge_failure config.
				// Retry exhaustion takes precedence over config policy.
				mergeResult = retryOutcome.mergeResult;
				const exhaustionMsg = retryOutcome.errorMessage +
					` [${retryOutcome.classification ?? "unknown"} ${retryOutcome.lastDecision.currentAttempt}/${retryOutcome.lastDecision.maxAttempts}, scope=${retryOutcome.scopeKey}]`;

				execLog("batch", batchState.batchId, `merge retry exhausted — forcing paused`, {
					classification: retryOutcome.classification,
					scopeKey: retryOutcome.scopeKey,
					attempts: retryOutcome.lastDecision.currentAttempt,
					maxAttempts: retryOutcome.lastDecision.maxAttempts,
				});

				// Emit merge retry exhausted event
				const mergeExhaustedSuggestion = `Merge retry exhausted (${retryOutcome.classification ?? "unknown"}) after ${retryOutcome.lastDecision.currentAttempt} attempt(s). Investigate merge failure and retry manually.`;
				emitTier0Event(stateRoot, {
					...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "merge_timeout", retryOutcome.lastDecision.currentAttempt, retryOutcome.lastDecision.maxAttempts),
					laneNumber: mergeFailedLane,
					repoId: mergeRepoId,
					classification: retryOutcome.classification ?? undefined,
					error: exhaustionMsg,
					scopeKey: retryOutcome.scopeKey,
					suggestion: mergeExhaustedSuggestion,
				});
				emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "merge_timeout",
					retryOutcome.lastDecision.currentAttempt, retryOutcome.lastDecision.maxAttempts,
					exhaustionMsg, [], mergeExhaustedSuggestion,
					{ laneNumber: mergeFailedLane, repoId: mergeRepoId, classification: retryOutcome.classification ?? undefined, scopeKey: retryOutcome.scopeKey },
				);

				batchState.phase = "paused";
				batchState.errors.push(exhaustionMsg);
				persistRuntimeState("merge-retry-exhausted", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(retryOutcome.notifyMessage, "error");

				// ── TP-076: Emit supervisor alert for merge retry exhausted ──
				emitAlert({
					category: "merge-failure",
					summary:
						`⚠️ Merge failed for wave ${waveIdx + 1} — retry exhausted\n` +
						`  Classification: ${retryOutcome.classification ?? "unknown"}\n` +
						`  Attempts: ${retryOutcome.lastDecision.currentAttempt}/${retryOutcome.lastDecision.maxAttempts}\n` +
						`  Failed lane: ${mergeResult.failedLane ?? "unknown"}\n` +
						`  Error: ${exhaustionMsg}\n\n` +
						`Available actions:\n` +
						`  - Investigate merge failure and retry manually\n` +
						`  - orch_status() to inspect current state\n` +
						`  - orch_resume(force=true) after fixing the issue`,
					context: {
						waveIndex: waveIdx,
						laneNumber: mergeResult.failedLane ?? undefined,
						repoId: mergeRepoId ?? undefined,
						mergeError: exhaustionMsg,
						batchProgress: buildBatchProgressSnapshot(batchState),
					},
				});

				preserveWorktreesForResume = true;
				break;
			} else {
				// kind === "no_retry": fall through to standard on_merge_failure policy
				mergeResult = retryOutcome.mergeResult;
				const policyResult = computeMergeFailurePolicy(mergeResult, waveIdx, orchConfig);
				const classNote = retryOutcome.classification
					? ` [not retriable: ${retryOutcome.classification}, scope=${retryOutcome.scopeKey}]`
					: "";

				execLog("batch", batchState.batchId, `merge failure — applying ${policyResult.policy} policy${classNote}`, policyResult.logDetails);

				batchState.phase = policyResult.targetPhase;
				batchState.errors.push(policyResult.errorMessage + classNote);
				persistRuntimeState(policyResult.persistTrigger, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(policyResult.notifyMessage + classNote, policyResult.notifyLevel);

				// ── TP-076: Emit supervisor alert for merge failure (no-retry policy) ──
				emitAlert({
					category: "merge-failure",
					summary:
						`⚠️ Merge failed for wave ${waveIdx + 1}\n` +
						`  Policy: ${policyResult.policy}${classNote}\n` +
						`  Failed lane: ${mergeResult.failedLane ?? "unknown"}\n` +
						`  Error: ${mergeResult.failureReason || "unknown"}\n\n` +
						`Available actions:\n` +
						`  - Investigate failed merge\n` +
						`  - orch_status() to inspect current state\n` +
						`  - orch_resume(force=true) after fixing the issue`,
					context: {
						waveIndex: waveIdx,
						laneNumber: mergeResult.failedLane ?? undefined,
						repoId: mergeRepoId ?? undefined,
						mergeError: mergeResult.failureReason || "unknown",
						batchProgress: buildBatchProgressSnapshot(batchState),
					},
				});

				// DO NOT cleanup/reset worktrees — preserve state for debugging/resume
				preserveWorktreesForResume = true;
				break;
			}
		}

		// NOTE: Merged branch cleanup is deferred to Phase 3, AFTER worktree
		// removal. git branch -D fails if a worktree has the branch checked out.

		// ── TP-028: Preserve partial progress before inter-wave reset ──
		// Failed tasks may have commits on their lane branch that would be lost
		// when the worktree is reset for the next wave. Save these as named
		// branches before any branch-destructive reset/removal occurs.
		// Hoisted outside the if-block so unsafeBranches is accessible to the
		// reset loop below — both blocks share the same guard condition.
		let ppUnsafeBranches = new Set<string>();
		if (waveIdx < runtimeSegmentRounds.length - 1 && !batchState.pauseSignal.paused) {
			const ppOpId = resolveOperatorId(orchConfig);
			const ppResult = preserveFailedLaneProgress(
				latestAllocatedLanes,
				allTaskOutcomes,
				ppOpId,
				batchState.batchId,
				(repoId) => {
					const perRepoRoot = resolveRepoRoot(repoId, repoRoot, workspaceConfig);
					let targetBranch = batchState.orchBranch;
					if (repoId && perRepoRoot !== repoRoot) {
						try {
							targetBranch = resolveBaseBranch(repoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
						} catch { /* fall back to orchBranch */ }
					}
					return { repoRoot: perRepoRoot, targetBranch };
				},
			);
			ppUnsafeBranches = ppResult.unsafeBranches;
			if (ppResult.results.some(r => r.saved)) {
				execLog("batch", batchState.batchId,
					`preserved partial progress for ${ppResult.results.filter(r => r.saved).length} failed task(s) before inter-wave reset`);
			}
			// Log per-task warnings for failed preservation attempts
			for (const r of ppResult.results) {
				if (!r.saved && (r.commitCount > 0 || r.error)) {
					execLog("batch", batchState.batchId,
						`WARNING: Failed to preserve partial progress for task ${r.taskId} ` +
						`(${r.commitCount} commit(s) at risk on lane branch)`,
						{ taskId: r.taskId, commitCount: r.commitCount, error: r.error ?? "unknown" });
				}
			}
			if (ppUnsafeBranches.size > 0) {
				execLog("batch", batchState.batchId,
					`WARNING: ${ppUnsafeBranches.size} lane branch(es) could not be preserved — skipping reset for those lanes to prevent commit loss`,
					{ unsafeBranches: [...ppUnsafeBranches] });
			}
			// TP-028: Stamp task outcomes with partial progress data for persistence
			applyPartialProgressToOutcomes(ppResult, allTaskOutcomes);

			// TP-147: Also preserve skipped task branches before inter-wave reset
			const skippedPpResult = preserveSkippedLaneProgress(
				latestAllocatedLanes,
				allTaskOutcomes,
				ppOpId,
				batchState.batchId,
				(repoId) => {
					const perRepoRoot = resolveRepoRoot(repoId, repoRoot, workspaceConfig);
					let targetBranch = batchState.orchBranch;
					if (repoId && perRepoRoot !== repoRoot) {
						try {
							targetBranch = resolveBaseBranch(repoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
						} catch { /* fall back to orchBranch */ }
					}
					return { repoRoot: perRepoRoot, targetBranch };
				},
			);
			// Merge unsafe branches from skipped tasks into the main set
			for (const branch of skippedPpResult.unsafeBranches) {
				ppUnsafeBranches.add(branch);
			}
			if (skippedPpResult.results.some(r => r.saved)) {
				execLog("batch", batchState.batchId,
					`preserved partial progress for ${skippedPpResult.results.filter(r => r.saved).length} skipped task(s) before inter-wave reset`);
			}
			// Stamp skipped task outcomes with partial progress data
			applyPartialProgressToOutcomes(skippedPpResult, allTaskOutcomes);
		}

		// ── Post-merge: Reset worktrees for next wave ────────────
		// Only reset if merge succeeded AND there are more waves.
		// TP-029: Iterate ALL encountered repo roots (not just primary repoRoot)
		// so that repos active in wave N but not in the final wave still get reset.
		// Follows the resume.ts encounteredRepoRoots pattern for parity.
		if (waveIdx < runtimeSegmentRounds.length - 1 && !batchState.pauseSignal.paused) {
			const resetPrefix = orchConfig.orchestrator.worktree_prefix;
			const resetOpId = resolveOperatorId(orchConfig);
			let totalResetWorktrees = 0;
			// TP-029 R006: Track worktrees that failed reset AND removal
			// so the cleanup gate only fires on true stale state, not
			// successfully-reset reusable worktrees.
			const failedRemovalWorktrees = new Map<string, { repoId: string | undefined; paths: string[] }>();

			for (const [perRepoRoot, perRepoId] of encounteredRepoRoots) {
				const existingWorktrees = listWorktrees(resetPrefix, perRepoRoot, resetOpId, batchState.batchId);
				if (existingWorktrees.length === 0) continue;
				totalResetWorktrees += existingWorktrees.length;

				// Per-repo target branch: primary repo uses orchBranch,
				// secondary repos resolve their own branch (parity with resume.ts).
				let targetBranch: string;
				if (perRepoRoot === repoRoot) {
					targetBranch = batchState.orchBranch;
				} else {
					try {
						targetBranch = resolveBaseBranch(perRepoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
					} catch {
						// If resolution fails, fall back to orchBranch (reset will
						// fail gracefully and trigger worktree removal)
						targetBranch = batchState.orchBranch;
					}
				}

				for (const wt of existingWorktrees) {
					// TP-028: Skip reset for worktrees whose lane branch has
					// unsaved partial progress (preservation failed with commits)
					if (ppUnsafeBranches.has(wt.branch)) {
						execLog("batch", batchState.batchId,
							`skipping worktree reset for lane ${wt.laneNumber} — branch "${wt.branch}" has unsaved partial progress`,
							{ path: wt.path, branch: wt.branch });
						continue;
					}

					const resetResult = safeResetWorktree(wt, targetBranch, perRepoRoot);
					if (!resetResult.success) {
						execLog("batch", batchState.batchId, `worktree reset failed for lane ${wt.laneNumber}`, {
							error: resetResult.error || "unknown",
							path: wt.path,
							repoId: perRepoId ?? "(default)",
						});
						// If reset fails, remove this worktree so the next wave can recreate it cleanly.
						try {
							removeWorktree(wt, perRepoRoot);
							execLog("batch", batchState.batchId, `removed unrecoverable worktree for lane ${wt.laneNumber}`);
						} catch (removeErr: unknown) {
							execLog("batch", batchState.batchId, `removeWorktree failed for lane ${wt.laneNumber}, attempting force cleanup`, {
								error: removeErr instanceof Error ? removeErr.message : String(removeErr),
								path: wt.path,
							});
							// Last resort: force-remove the directory and prune git worktree state.
							forceCleanupWorktree(wt, perRepoRoot, batchState.batchId);
							// Track this worktree for the cleanup gate — it may still be registered
							if (!failedRemovalWorktrees.has(perRepoRoot)) {
								failedRemovalWorktrees.set(perRepoRoot, { repoId: perRepoId, paths: [] });
							}
							failedRemovalWorktrees.get(perRepoRoot)!.paths.push(wt.path);
						}
					} else {
						execLog("batch", batchState.batchId, `worktree reset OK for lane ${wt.laneNumber}`);
					}
				}
			}

			if (totalResetWorktrees > 0) {
				onNotify(
					ORCH_MESSAGES.orchWorktreeReset(waveIdx + 1, totalResetWorktrees),
					"info",
				);
			}

			// ── TP-029: Post-merge cleanup gate ──────────────────────
			// Only gate on worktrees that the reset loop tried and failed
			// to remove. Successfully-reset reusable worktrees are expected
			// to remain registered — they will be reused in the next wave.
			// For each failed-removal worktree, verify it is still registered
			// before classifying it as truly stale.
			const cleanupGateFailures: CleanupGateRepoFailure[] = [];
			if (failedRemovalWorktrees.size > 0) {
				for (const [perRepoRoot, { repoId: perRepoId, paths: failedPaths }] of failedRemovalWorktrees) {
					const remaining = listWorktrees(resetPrefix, perRepoRoot, resetOpId, batchState.batchId);
					const remainingPaths = new Set(remaining.map(wt => wt.path));
					// Only report worktrees that were targeted for removal but are still registered
					const stale = failedPaths.filter(p => remainingPaths.has(p));
					if (stale.length > 0) {
						cleanupGateFailures.push({
							repoRoot: perRepoRoot,
							repoId: perRepoId,
							staleWorktrees: stale,
						});
					}
				}
			}

			if (cleanupGateFailures.length > 0) {
				// ── TP-039: Tier 0 — Cleanup gate retry ──────────────
				// Before pausing, attempt one more force cleanup + prune
				// on the stale worktrees. This handles cases where the
				// first force cleanup partially succeeded (e.g., directory
				// removed but git state not yet pruned).
				if (!batchState.resilience) {
					batchState.resilience = defaultResilienceState();
				}

				const cleanupBudget = TIER0_RETRY_BUDGETS.cleanup_gate;
				const cleanupScopeKey = tier0WaveScopeKey("cleanup_gate", waveIdx);
				const cleanupRetryCount = batchState.resilience.retryCountByScope[cleanupScopeKey] ?? 0;

				if (cleanupRetryCount < cleanupBudget.maxRetries) {
					batchState.resilience.retryCountByScope[cleanupScopeKey] = cleanupRetryCount + 1;

					execLog("batch", batchState.batchId,
						`tier0: retrying cleanup gate (attempt ${cleanupRetryCount + 1}/${cleanupBudget.maxRetries})`,
						{ cleanupScopeKey, staleCount: cleanupGateFailures.reduce((n, f) => n + f.staleWorktrees.length, 0) },
					);

					// Emit attempt event
					const staleWorktreeCount = cleanupGateFailures.reduce((n, f) => n + f.staleWorktrees.length, 0);
					emitTier0Event(stateRoot, {
						...buildTier0EventBase("tier0_recovery_attempt", batchState.batchId, waveIdx, "cleanup_gate", cleanupRetryCount + 1, cleanupBudget.maxRetries),
						repoId: null, // wave-scoped: cleanup gate spans all repos
						classification: `stale_worktrees:${staleWorktreeCount}`,
						cooldownMs: cleanupBudget.cooldownMs,
						scopeKey: cleanupScopeKey,
					});

					if (cleanupBudget.cooldownMs > 0) {
						sleepSync(cleanupBudget.cooldownMs);
					}

					// Force-cleanup each stale worktree again
					for (const failure of cleanupGateFailures) {
						const remaining = listWorktrees(resetPrefix, failure.repoRoot, resetOpId, batchState.batchId);
						for (const wt of remaining) {
							if (failure.staleWorktrees.includes(wt.path)) {
								forceCleanupWorktree(wt, failure.repoRoot, batchState.batchId);
							}
						}
						// Prune after force cleanup
						runGit(["worktree", "prune"], failure.repoRoot);
					}

					// Re-check: are any worktrees still stale?
					const retriedGateFailures: CleanupGateRepoFailure[] = [];
					for (const failure of cleanupGateFailures) {
						const remaining = listWorktrees(resetPrefix, failure.repoRoot, resetOpId, batchState.batchId);
						const remainingPaths = new Set(remaining.map(wt => wt.path));
						const stillStale = failure.staleWorktrees.filter(p => remainingPaths.has(p));
						if (stillStale.length > 0) {
							retriedGateFailures.push({
								repoRoot: failure.repoRoot,
								repoId: failure.repoId,
								staleWorktrees: stillStale,
							});
						}
					}

					if (retriedGateFailures.length === 0) {
						execLog("batch", batchState.batchId,
							`tier0: cleanup gate retry succeeded — all stale worktrees removed`,
							{ cleanupScopeKey },
						);
						onNotify(
							`✅ Tier 0: Cleanup gate retry succeeded at wave ${waveIdx + 1} — continuing`,
							"info",
						);

						// Emit success event
						emitTier0Event(stateRoot, {
							...buildTier0EventBase("tier0_recovery_success", batchState.batchId, waveIdx, "cleanup_gate", cleanupRetryCount + 1, cleanupBudget.maxRetries),
							repoId: null, // wave-scoped
							resolution: `Cleanup gate retry succeeded — all stale worktrees removed at wave ${waveIdx + 1}`,
							scopeKey: cleanupScopeKey,
						});

						persistRuntimeState("tier0-cleanup-retry-success", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
						// Fall through to continue the wave loop (don't break)
					} else {
						// Retry failed — fall through to pausing
						const gatePolicyResult = computeCleanupGatePolicy(waveIdx, retriedGateFailures);

						execLog("batch", batchState.batchId,
							`tier0: cleanup gate retry failed — still ${retriedGateFailures.reduce((n, f) => n + f.staleWorktrees.length, 0)} stale worktree(s), pausing batch`,
							gatePolicyResult.logDetails,
						);

						const stillStaleCount = retriedGateFailures.reduce((n, f) => n + f.staleWorktrees.length, 0);
						const cleanupRetryError = `Cleanup gate retry failed — ${stillStaleCount} stale worktree(s) remain`;
						const cleanupRetrySuggestion = `Post-merge cleanup retry did not remove all stale worktrees. Manually remove the remaining ${stillStaleCount} worktree(s) and prune git state.`;
						const cleanupRetryAffected = retriedGateFailures.flatMap(f => f.staleWorktrees);
						// Emit exhausted event (retry attempted but failed)
						emitTier0Event(stateRoot, {
							...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "cleanup_gate", cleanupRetryCount + 1, cleanupBudget.maxRetries),
							repoId: null, // wave-scoped
							error: cleanupRetryError,
							scopeKey: cleanupScopeKey,
							affectedTaskIds: cleanupRetryAffected,
							suggestion: cleanupRetrySuggestion,
						});
						emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "cleanup_gate", cleanupRetryCount + 1, cleanupBudget.maxRetries,
							cleanupRetryError, cleanupRetryAffected, cleanupRetrySuggestion,
							{ repoId: null, scopeKey: cleanupScopeKey },
						);

						batchState.phase = gatePolicyResult.targetPhase;
						batchState.errors.push(gatePolicyResult.errorMessage);
						persistRuntimeState(gatePolicyResult.persistTrigger, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
						onNotify(gatePolicyResult.notifyMessage, gatePolicyResult.notifyLevel);
						preserveWorktreesForResume = true;
						break;
					}
				} else {
					// Cleanup retry budget exhausted — pause immediately
					const gatePolicyResult = computeCleanupGatePolicy(waveIdx, cleanupGateFailures);

					execLog("batch", batchState.batchId, `cleanup gate failed — pausing batch (retry budget exhausted)`, gatePolicyResult.logDetails);

					// Emit exhausted event (budget already consumed from prior waves)
					const cleanupBudgetError = `Cleanup gate retry budget exhausted (${cleanupRetryCount}/${cleanupBudget.maxRetries})`;
					const cleanupBudgetSuggestion = `Cleanup gate retry budget was already consumed. Manually remove stale worktrees and prune git state.`;
					const cleanupBudgetAffected = cleanupGateFailures.flatMap(f => f.staleWorktrees);
					emitTier0Event(stateRoot, {
						...buildTier0EventBase("tier0_recovery_exhausted", batchState.batchId, waveIdx, "cleanup_gate", cleanupRetryCount, cleanupBudget.maxRetries),
						repoId: null, // wave-scoped
						error: cleanupBudgetError,
						scopeKey: cleanupScopeKey,
						affectedTaskIds: cleanupBudgetAffected,
						suggestion: cleanupBudgetSuggestion,
					});
					emitTier0Escalation(stateRoot, batchState.batchId, waveIdx, "cleanup_gate", cleanupRetryCount, cleanupBudget.maxRetries,
						cleanupBudgetError, cleanupBudgetAffected, cleanupBudgetSuggestion,
						{ repoId: null, scopeKey: cleanupScopeKey },
					);

					batchState.phase = gatePolicyResult.targetPhase;
					batchState.errors.push(gatePolicyResult.errorMessage);
					persistRuntimeState(gatePolicyResult.persistTrigger, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
					onNotify(gatePolicyResult.notifyMessage, gatePolicyResult.notifyLevel);
					preserveWorktreesForResume = true;
					break;
				}
			}
		}
	}

	// ── Save batch history (before cleanup deletes sidecar files) ────
	try {
		// Read fallback token data from V2 lane snapshots and legacy sidecars.
		// Primary source for Runtime V2 is now `LaneTaskOutcome.telemetry`.
		const piDir = join(stateRoot, ".pi");
		const v2LaneTokensByNumber = new Map<number, TokenCounts>();
		const legacyLaneTokensByKey = new Map<string, TokenCounts>();

		// V2 snapshot fallback (used only when outcome.telemetry is absent).
		try {
			const lanesDir = join(piDir, "runtime", batchState.batchId, "lanes");
			if (existsSync(lanesDir)) {
				const files = readdirSync(lanesDir).filter(f => f.startsWith("lane-") && f.endsWith(".json"));
				for (const f of files) {
					try {
						const snap = JSON.parse(readFileSync(join(lanesDir, f), "utf-8"));
						const laneNumber = typeof snap.laneNumber === "number" ? snap.laneNumber : 0;
						if (laneNumber <= 0) continue;
						const w = snap.worker || {};
						const r = snap.reviewer || {};
						v2LaneTokensByNumber.set(laneNumber, {
							input: (w.inputTokens || 0) + (r.inputTokens || 0),
							output: (w.outputTokens || 0) + (r.outputTokens || 0),
							cacheRead: (w.cacheReadTokens || 0) + (r.cacheReadTokens || 0),
							cacheWrite: (w.cacheWriteTokens || 0) + (r.cacheWriteTokens || 0),
							costUsd: (w.costUsd || 0) + (r.costUsd || 0),
						});
					} catch { /* skip invalid files */ }
				}
			}
		} catch { /* runtime dir may not exist */ }

		// Legacy fallback: lane-state-*.json sidecars (pre-V2).
		try {
			const files = readdirSync(piDir).filter(f => f.startsWith("lane-state-") && f.endsWith(".json"));
			for (const f of files) {
				try {
					const raw = readFileSync(join(piDir, f), "utf-8").trim();
					if (!raw) continue;
					const data = JSON.parse(raw);
					if (data.prefix) {
						legacyLaneTokensByKey.set(data.prefix, {
							input: data.workerInputTokens || 0,
							output: data.workerOutputTokens || 0,
							cacheRead: data.workerCacheReadTokens || 0,
							cacheWrite: data.workerCacheWriteTokens || 0,
							costUsd: data.workerCostUsd || 0,
						});
					}
				} catch { /* skip invalid files */ }
			}
		} catch { /* .pi dir may not exist */ }

		// Build per-task summaries from allTaskOutcomes + wave plan
		const taskSummaries: BatchTaskSummary[] = allTaskOutcomes.map((to) => {
			// Find which wave and lane this task ran in
			let wave = 0;
			for (let wi = 0; wi < wavePlan.length; wi++) {
				if (wavePlan[wi].includes(to.taskId)) { wave = wi + 1; break; }
			}
			const lane = to.laneNumber
				?? (() => {
					const laneMatch = to.sessionName?.match(/lane-(\d+)/);
					return laneMatch ? parseInt(laneMatch[1], 10) : 0;
				})();

			// Compute duration from start/end times
			const durationMs = (to.startTime && to.endTime) ? (to.endTime - to.startTime) : 0;

			// TP-116: Resolve tokens from outcome telemetry first; only fallback for legacy outcomes.
			const tokens = resolveBatchHistoryTaskTokens(
				to,
				lane,
				v2LaneTokensByNumber,
				legacyLaneTokensByKey,
			);

			return {
				taskId: to.taskId,
				taskName: to.taskId,
				status: to.status as BatchTaskSummary["status"],
				wave,
				lane,
				durationMs,
				tokens,
				exitReason: to.exitReason || null,
			};
		});

		// TP-147: Ensure ALL tasks from the wave plan are represented in history.
		// Tasks that never got allocated (blocked by upstream failures, never started)
		// won't have entries in allTaskOutcomes. Add them with appropriate status.
		const coveredTaskIds = new Set(taskSummaries.map(t => t.taskId));
		for (let wi = 0; wi < wavePlan.length; wi++) {
			for (const taskId of wavePlan[wi]) {
				if (coveredTaskIds.has(taskId)) continue;
				// Determine the appropriate status for uncovered tasks
				const isBlocked = batchState.blockedTaskIds.has(taskId);
				const status: BatchTaskSummary["status"] = isBlocked ? "blocked" : "pending";
				taskSummaries.push({
					taskId,
					taskName: taskId,
					status,
					wave: wi + 1,
					lane: 0,
					durationMs: 0,
					tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
					exitReason: isBlocked ? "Blocked by upstream failure" : null,
				});
				coveredTaskIds.add(taskId);
			}
		}

		// Build per-wave summaries
		const waveSummaries: BatchWaveSummary[] = wavePlan.map((taskIds, wi) => {
			const waveTasks = taskSummaries.filter(t => t.wave === wi + 1);
			const mergeResult = batchState.mergeResults.find(mr => mr.waveIndex === wi + 1);
			const waveTokens: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
			for (const t of waveTasks) {
				waveTokens.input += t.tokens.input;
				waveTokens.output += t.tokens.output;
				waveTokens.cacheRead += t.tokens.cacheRead;
				waveTokens.cacheWrite += t.tokens.cacheWrite;
				waveTokens.costUsd += t.tokens.costUsd;
			}
			const waveDuration = waveTasks.reduce((sum, t) => Math.max(sum, t.durationMs), 0);
			return {
				wave: wi + 1,
				tasks: taskIds,
				mergeStatus: mergeResult?.status || "skipped",
				durationMs: waveDuration,
				tokens: waveTokens,
			};
		});

		// Aggregate batch tokens
		const batchTokens: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
		for (const ws of waveSummaries) {
			batchTokens.input += ws.tokens.input;
			batchTokens.output += ws.tokens.output;
			batchTokens.cacheRead += ws.tokens.cacheRead;
			batchTokens.cacheWrite += ws.tokens.cacheWrite;
			batchTokens.costUsd += ws.tokens.costUsd;
		}

		// Determine history status from actual outcomes, not batchState.phase
		// (phase hasn't been set to "completed" yet at this point in the flow).
		const historyStatus: "completed" | "partial" | "failed" | "aborted" =
			batchState.failedTasks > 0
				? (batchState.succeededTasks > 0 ? "partial" : "failed")
				: batchState.succeededTasks > 0
					? "completed"
					: "aborted";

		// TP-147: Ensure totalTasks matches actual task array length.
		// Use taskSummaries.length as authoritative (includes gap-filled tasks)
		// and log a warning if it diverges from batchState.totalTasks.
		const actualTotalTasks = taskSummaries.length;
		if (actualTotalTasks !== batchState.totalTasks) {
			execLog("batch", batchState.batchId,
				`WARNING: totalTasks mismatch — batchState.totalTasks=${batchState.totalTasks}, ` +
				`taskSummaries.length=${actualTotalTasks}. Using taskSummaries.length for history.`);
		}

		const summary: BatchHistorySummary = {
			batchId: batchState.batchId,
			status: historyStatus,
			startedAt: batchState.startedAt,
			endedAt: Date.now(),
			durationMs: Date.now() - batchState.startedAt,
			totalWaves: wavePlan.length,
			totalTasks: actualTotalTasks,
			succeededTasks: batchState.succeededTasks,
			failedTasks: batchState.failedTasks,
			skippedTasks: batchState.skippedTasks,
			blockedTasks: batchState.blockedTasks,
			tokens: batchTokens,
			tasks: taskSummaries,
			waves: waveSummaries,
		};

		saveBatchHistory(stateRoot, summary);
	} catch (err) {
		execLog("batch", batchState.batchId, `failed to save batch history: ${err}`);
	}

	// ── Pre-cleanup: Determine if worktrees should be preserved ──
	// TP-031 (R006): This check MUST run before cleanup so that worktrees
	// survive when failedTasks > 0. Without this, cleanup deletes worktrees
	// before the batch is marked "paused", breaking resumability.
	if (!preserveWorktreesForResume &&
		((batchState.phase as OrchBatchPhase) === "executing" || (batchState.phase as OrchBatchPhase) === "merging") &&
		batchState.failedTasks > 0) {
		preserveWorktreesForResume = true;
		execLog("batch", batchState.batchId, "pre-cleanup: failedTasks > 0 detected, preserving worktrees for resume");
	}

	// ── Phase 3: Cleanup ─────────────────────────────────────────
	const prefix = orchConfig.orchestrator.worktree_prefix;

	if (preserveWorktreesForResume) {
		execLog("batch", batchState.batchId, "skipping final cleanup to preserve worktrees/branches for resume");
	} else {
		// Kill lingering Runtime V2 agents BEFORE removing worktrees.
		// On Windows, lingering processes with cwd inside the worktree can lock
		// the directory and cause `git worktree remove` to fail.
		const lingeringLaneSessions = new Set<string>();
		const registry = readRegistrySnapshot(stateRoot, batchState.batchId);
		if (registry) {
			for (const manifest of Object.values(registry.agents)) {
				if (manifest.role !== "worker" && manifest.role !== "reviewer") continue;
				if (isTerminalStatus(manifest.status) || !registryIsProcessAlive(manifest.pid)) continue;
				lingeringLaneSessions.add(manifest.agentId.replace(/-(worker|reviewer)$/, ""));
			}
		}

		let performedAgentCleanup = false;
		if (lingeringLaneSessions.size > 0) {
			execLog("batch", batchState.batchId, `killing ${lingeringLaneSessions.size} lingering lane agent session(s) before cleanup`);
			for (const sessionName of lingeringLaneSessions) {
				killV2LaneAgents(sessionName, {
					stateRoot,
					batchId: batchState.batchId,
					logContext: "batch",
				});
			}
			performedAgentCleanup = true;
		}

		const killedMergeAgents = killAllMergeAgentsV2();
		if (killedMergeAgents > 0) {
			execLog("batch", batchState.batchId, `killed ${killedMergeAgents} lingering merge agent(s) before cleanup`);
			performedAgentCleanup = true;
		}

		if (performedAgentCleanup) {
			sleepSync(1000); // Give OS time to release file locks
		}

		// Clean up sidecar files (lane state, worker conversation, merge artifacts)
		const piDir = join(stateRoot, ".pi");
		try {
			const sidecarFiles = readdirSync(piDir).filter(
				f => f.startsWith("lane-state-") ||
					f.startsWith("worker-conversation-") ||
					f.startsWith("merge-result-") ||
					f.startsWith("merge-request-"),
			);
			for (const f of sidecarFiles) {
				try { unlinkSync(join(piDir, f)); } catch { /* best effort */ }
			}
			if (sidecarFiles.length > 0) {
				execLog("batch", batchState.batchId, `cleaned up ${sidecarFiles.length} sidecar file(s)`);
			}
		} catch { /* .pi dir may not exist */ }

		// ── TP-028: Preserve partial progress before terminal cleanup ──
		// Save failed task commits as named branches before worktree removal
		// destroys the lane branches. Uses the last wave's allocated lanes
		// to map failed tasks to their lane branches.
		{
			const ppOpId = resolveOperatorId(orchConfig);
			const ppResult = preserveFailedLaneProgress(
				latestAllocatedLanes,
				allTaskOutcomes,
				ppOpId,
				batchState.batchId,
				(repoId) => {
					const perRepoRoot = resolveRepoRoot(repoId, repoRoot, workspaceConfig);
					let targetBranch = batchState.orchBranch;
					if (repoId && perRepoRoot !== repoRoot) {
						try {
							targetBranch = resolveBaseBranch(repoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
						} catch { /* fall back to orchBranch */ }
					}
					return { repoRoot: perRepoRoot, targetBranch };
				},
			);
			if (ppResult.results.some(r => r.saved)) {
				execLog("batch", batchState.batchId,
					`preserved partial progress for ${ppResult.results.filter(r => r.saved).length} failed task(s) before terminal cleanup`);
			}
			// Log warnings for failed preservation attempts — at terminal cleanup
			// we cannot skip deletion (batch is ending), but operators need to know
			// that commits may become unreachable via reflog only.
			for (const r of ppResult.results) {
				if (!r.saved && (r.commitCount > 0 || r.error)) {
					execLog("batch", batchState.batchId,
						`WARNING: Failed to preserve partial progress for task ${r.taskId} ` +
						`(${r.commitCount} commit(s) may become unreachable after cleanup)`,
						{ taskId: r.taskId, commitCount: r.commitCount, error: r.error ?? "unknown" });
				}
			}
			// TP-028: Stamp task outcomes with partial progress data for persistence
			applyPartialProgressToOutcomes(ppResult, allTaskOutcomes);

			// TP-147: Also preserve skipped task branches before terminal cleanup
			const skippedPpResult = preserveSkippedLaneProgress(
				latestAllocatedLanes,
				allTaskOutcomes,
				ppOpId,
				batchState.batchId,
				(repoId) => {
					const perRepoRoot = resolveRepoRoot(repoId, repoRoot, workspaceConfig);
					let targetBranch = batchState.orchBranch;
					if (repoId && perRepoRoot !== repoRoot) {
						try {
							targetBranch = resolveBaseBranch(repoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
						} catch { /* fall back to orchBranch */ }
					}
					return { repoRoot: perRepoRoot, targetBranch };
				},
			);
			if (skippedPpResult.results.some(r => r.saved)) {
				execLog("batch", batchState.batchId,
					`preserved partial progress for ${skippedPpResult.results.filter(r => r.saved).length} skipped task(s) before terminal cleanup`);
			}
			for (const r of skippedPpResult.results) {
				if (!r.saved && (r.commitCount > 0 || r.error)) {
					execLog("batch", batchState.batchId,
						`WARNING: Failed to preserve partial progress for skipped task ${r.taskId} ` +
						`(${r.commitCount} commit(s) may become unreachable after cleanup)`,
						{ taskId: r.taskId, commitCount: r.commitCount, error: r.error ?? "unknown" });
				}
			}
			applyPartialProgressToOutcomes(skippedPpResult, allTaskOutcomes);
		}

		// TP-029: Clean up worktrees across ALL encountered repos (not just primary).
		// Per-repo target branch resolution: primary repo uses orchBranch,
		// secondary repos resolve their own branch via resolveBaseBranch.
		// Parity with resume.ts:1475-1507.
		const cleanupOpId = resolveOperatorId(orchConfig);
		execLog("batch", batchState.batchId, "cleaning up worktrees");

		for (const [perRepoRoot, perRepoId] of encounteredRepoRoots) {
			let targetBranch: string | undefined;
			if (perRepoRoot === repoRoot) {
				// Primary repo: lane branches were merged into orchBranch
				targetBranch = batchState.orchBranch;
			} else {
				// Secondary repo (workspace mode): resolve the repo's own branch
				try {
					targetBranch = resolveBaseBranch(perRepoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
				} catch {
					// Fall back to undefined — skips branch protection
					// (safe because successfully merged branches were already cleaned)
					targetBranch = undefined;
				}
			}
			const removeResult = removeAllWorktrees(prefix, perRepoRoot, cleanupOpId, targetBranch, batchState.batchId, orchConfig);

			// Log preserved branches
			for (const p of removeResult.preserved) {
				execLog("batch", batchState.batchId, `preserving unmerged branch as saved ref`, {
					branch: p.branch,
					savedBranch: p.savedBranch,
					lane: p.laneNumber,
					target: targetBranch,
					commitCount: p.unmergedCount ?? 0,
					repoId: perRepoId ?? "(default)",
				});
			}

			if (removeResult.failed.length > 0) {
				const failedPaths = removeResult.failed.map(f => f.worktree.path).join(", ");
				execLog("batch", batchState.batchId, `worktree cleanup: ${removeResult.removed.length} removed, ${removeResult.failed.length} failed, ${removeResult.preserved.length} preserved`, {
					failedPaths,
					repoId: perRepoId ?? "(default)",
				});
			} else if (removeResult.totalAttempted > 0) {
				execLog("batch", batchState.batchId, `worktree cleanup: ${removeResult.removed.length} removed, ${removeResult.preserved.length} preserved`, {
					repoId: perRepoId ?? "(default)",
				});
			}
		}

		// NOTE: Empty .worktrees base-dir cleanup (subdirectory mode) is handled
		// inside removeAllWorktrees() when config is passed — no duplicate pass needed here.

		// ── Post-worktree-removal: Clean up merged branches ──────
		// This MUST run after worktree removal because git branch -D
		// fails if any worktree still has the branch checked out.
		// In workspace mode, each lane's branch lives in its owning repo,
		// so we resolve the correct repo root per lane using repoId.
		for (const mergeResult of allMergeResults) {
			if (mergeResult.status === "succeeded" || mergeResult.status === "partial") {
				for (const lr of mergeResult.laneResults) {
					// TP-032 R006-3: Exclude verification_new_failure lanes from branch cleanup
					// (their merge commits were rolled back, so the branch is NOT merged)
					if (!lr.error && (lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED")) {
						const laneRepoRoot = resolveRepoRoot(lr.repoId, repoRoot, workspaceConfig);
						const ancestorCheck = runGit(
							["merge-base", "--is-ancestor", lr.sourceBranch, lr.targetBranch],
							laneRepoRoot,
						);
						if (ancestorCheck.ok) {
							const deleted = deleteBranchBestEffort(lr.sourceBranch, laneRepoRoot);
							if (deleted) {
								execLog("batch", batchState.batchId, `deleted merged branch ${lr.sourceBranch}`, {
									repoId: lr.repoId ?? "(default)",
								});
							} else {
								execLog("batch", batchState.batchId, `warning: failed to delete merged branch ${lr.sourceBranch} — retained for manual cleanup`, {
									repoId: lr.repoId ?? "(default)",
								});
							}
						} else {
							execLog("batch", batchState.batchId, `warning: branch ${lr.sourceBranch} not fully merged into ${lr.targetBranch} — retained`, {
								repoId: lr.repoId ?? "(default)",
							});
						}
					}
				}
			}
		}
	}

	// Set final state
	batchState.endedAt = Date.now();
	const totalElapsedSec = Math.round((batchState.endedAt - batchState.startedAt) / 1000);

	// Determine final batch state. Cast to OrchBatchPhase to bypass control-flow
	// narrowing — mergeWave() could leave phase as "merging" if an unexpected
	// throw occurs between setting "merging" and restoring "executing".
	if ((batchState.phase as OrchBatchPhase) === "executing" || (batchState.phase as OrchBatchPhase) === "merging") {
		// Normal completion (not stopped, paused, or aborted)
		if (batchState.failedTasks > 0) {
			// TP-031: Default to "paused" so the batch is resumable without --force.
			// "failed" is reserved for unrecoverable invariant violations after retry
			// exhaustion (not yet implemented — will be added when retry logic lands).
			// NOTE: preserveWorktreesForResume was already set pre-cleanup to ensure
			// worktrees survive; this just sets the phase for state persistence.
			batchState.phase = "paused";
		} else {
			batchState.phase = "completed";
		}
	}

	// ── Auto-Integration & Orch Branch Preservation (TP-022 Step 4) ──
	// After all waves are done, optionally fast-forward baseBranch to orchBranch.
	// Auto-integration never converts a successful batch into "failed" — failures
	// are warnings that preserve the orch branch for manual integration.
	// Gate: only run for terminal phases (completed/failed). Paused/stopped batches
	// are not yet done — integration would mutate refs prematurely.
	//
	// TP-043: "supervised" and "auto" integration modes are now owned by the
	// supervisor agent (which stays alive through post-batch integration).
	// The legacy engine fast-forward only runs for "auto" mode when no
	// supervisor is active (fallback). For "supervised" mode, the supervisor
	// always handles integration.
	const mergedTaskCount = batchState.succeededTasks;
	const isTerminalPhase = batchState.phase === "completed" || batchState.phase === "failed";
	if (isTerminalPhase && !preserveWorktreesForResume && batchState.orchBranch && mergedTaskCount > 0) {
		if (orchConfig.orchestrator.integration === "supervised" || orchConfig.orchestrator.integration === "auto") {
			// TP-043: Supervisor-managed integration modes. The supervisor
			// agent handles integration after batch_complete event. The engine
			// does NOT perform legacy fast-forward here — defer to supervisor.
			execLog("batch", batchState.batchId, `integration deferred to supervisor (mode: ${orchConfig.orchestrator.integration})`);
		} else {
			// Manual mode (default): show integration guidance
			onNotify(
				ORCH_MESSAGES.orchIntegrationManual(batchState.orchBranch, batchState.baseBranch, mergedTaskCount),
				"info",
			);
		}
	}

	// ── TS-009: Persist terminal state ──
	persistRuntimeState("batch-terminal", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

	// ── TP-076: Emit supervisor alert for batch completion ──────
	if (batchState.phase === "completed" || batchState.phase === "failed") {
		const batchDurationMs = batchState.endedAt ? batchState.endedAt - batchState.startedAt : 0;
		const durationStr = batchDurationMs > 0
			? `${Math.floor(batchDurationMs / 60000)}m ${Math.round((batchDurationMs % 60000) / 1000)}s`
			: "unknown";
		if (batchState.phase === "completed" && batchState.failedTasks === 0) {
			emitAlert({
				category: "batch-complete",
				summary:
					`✅ Batch ${batchState.batchId} completed\n` +
					`  ${batchState.succeededTasks}/${batchState.totalTasks} tasks succeeded\n` +
					`  ${batchState.totalWaves} wave(s), duration: ${durationStr}\n` +
					`  Merged to orch branch: ${batchState.orchBranch}\n\n` +
					`Ready for integration. Run orch_integrate() or review first.`,
				context: {
					batchProgress: buildBatchProgressSnapshot(batchState),
					batchDurationMs,
				},
			});
		} else {
			emitAlert({
				category: "batch-complete",
				summary:
					`⚠️ Batch ${batchState.batchId} finished with failures\n` +
					`  ${batchState.succeededTasks} succeeded, ${batchState.failedTasks} failed, ` +
					`${batchState.skippedTasks} skipped, ${batchState.blockedTasks} blocked\n` +
					`  Duration: ${durationStr}\n\n` +
					`Available actions:\n` +
					`  - orch_status() to review final state\n` +
					`  - orch_integrate() if succeeded work should be kept\n` +
					`  - orch_resume(force=true) to retry failed tasks`,
				context: {
					batchProgress: buildBatchProgressSnapshot(batchState),
					batchDurationMs,
				},
			});
		}
	}

	// ── TP-040: Emit batch terminal event (R002: unified via helper) ─
	emitTerminalEvent();

	// ── TP-031: Emit diagnostic reports (JSONL + markdown) ──
	// Non-fatal: errors are logged but never crash batch finalization.
	emitDiagnosticReports(assembleDiagnosticInput(orchConfig, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, stateRoot));

	if (batchState.phase === "paused" || batchState.phase === "stopped") {
		execLog("batch", batchState.batchId, "batch ended in non-terminal execution state; completion banner suppressed", {
			phase: batchState.phase,
		});
	} else {
		onNotify(
			ORCH_MESSAGES.orchBatchComplete(
				batchState.batchId,
				batchState.succeededTasks,
				batchState.failedTasks,
				batchState.skippedTasks,
				batchState.blockedTasks,
				totalElapsedSec,
				batchState.orchBranch,
				batchState.baseBranch,
			),
			batchState.failedTasks > 0 ? "warning" : "info",
		);

		// ── Preserve state for /orch-integrate when orch branch exists ──
		// If integration is "manual" and we have an orch branch, keep the
		// state file so /orch-integrate can find orchBranch and baseBranch.
		// Only delete state if there's no orch branch to integrate.
		if (batchState.phase === "completed") {
			if (batchState.orchBranch) {
				execLog("state", batchState.batchId, "state file preserved for /orch-integrate", {
					orchBranch: batchState.orchBranch,
				});
			} else {
				// Legacy mode (no orch branch) — clean up state
				try {
					deleteBatchState(stateRoot);
					execLog("state", batchState.batchId, "state file deleted on clean completion");
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					execLog("state", batchState.batchId, `failed to delete state file: ${msg}`);
				}
			}
		}
	}
}


// ── Dashboard Widget (Step 6) ────────────────────────────────────────

