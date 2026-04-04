/**
 * Wave computation, graph validation, lane assignment/allocation
 * @module orch/waves
 */
import { join } from "path";

import { parseDependencyReference } from "./discovery.ts";
import { resolveOperatorId } from "./naming.ts";
import { AllocationError, buildSegmentId, getTaskDurationMinutes } from "./types.ts";
import type { AllocatedLane, AllocatedTask, AllocateLanesResult, AllocationErrorCode, DependencyGraph, DiscoveryError, GraphValidationResult, LaneAssignment, OrchestratorConfig, ParsedTask, TaskSegmentPlan, TaskSegmentPlanMap, WaveAssignment, WaveComputationResult, WorkspaceConfig, WorktreeInfo } from "./types.ts";
import { getCurrentBranch, runGit } from "./git.ts";
import { ensureLaneWorktrees, removeAllWorktrees, removeWorktree } from "./worktree.ts";

// ── Dependency Graph Construction ────────────────────────────────────

/**
 * Build a dependency graph from the task registry.
 *
 * Source of truth: `ParsedTask.dependencies` from discovery phase (Step 4).
 * No re-parsing of PROMPT.md. The graph only contains pending tasks as nodes.
 * Completed tasks are NOT added as nodes — they are treated as pre-satisfied
 * in-degree contributors during wave computation.
 */
export function buildDependencyGraph(
	pending: Map<string, ParsedTask>,
	completed: Set<string>,
): DependencyGraph {
	const dependencies = new Map<string, string[]>();
	const dependents = new Map<string, string[]>();
	const nodes = new Set<string>();

	// Initialize all pending tasks as graph nodes
	for (const taskId of pending.keys()) {
		nodes.add(taskId);
		dependencies.set(taskId, []);
		dependents.set(taskId, []);
	}

	// Build adjacency lists from parsed dependencies
	for (const [taskId, task] of pending) {
		const edgeSet = new Set<string>();
		for (const depRaw of task.dependencies) {
			const depId = parseDependencyReference(depRaw).taskId;
			if (edgeSet.has(depId)) continue;
			edgeSet.add(depId);
			// Only add edges to other pending tasks (completed = already satisfied)
			if (pending.has(depId)) {
				dependencies.get(taskId)!.push(depId);
				dependents.get(depId)!.push(taskId);
			}
			// If depId is completed, it's pre-satisfied — no edge needed
			// If depId is unknown, that's a validation error caught by validateGraph()
		}
	}

	return { dependencies, dependents, nodes };
}


// ── Graph Validation ─────────────────────────────────────────────────

/**
 * Validate the dependency graph for correctness.
 *
 * Checks performed (in order):
 * 1. Self-edges: task depends on itself (A → A)
 * 2. Duplicate dependencies: same dep listed twice
 * 3. Missing targets: dependency on unknown task (not pending, not completed)
 * 4. Circular dependencies: DFS cycle detection with full cycle path
 *
 * Returns all errors found (does not stop at first error).
 */
export function validateGraph(
	graph: DependencyGraph,
	pending: Map<string, ParsedTask>,
	completed: Set<string>,
): GraphValidationResult {
	const errors: DiscoveryError[] = [];

	// 1. Self-edge check
	for (const [taskId, task] of pending) {
		for (const depRaw of task.dependencies) {
			const depId = parseDependencyReference(depRaw).taskId;
			if (depId === taskId) {
				errors.push({
					code: "DEP_UNRESOLVED",
					message: `${taskId} has a self-dependency (depends on itself)`,
					taskId,
					taskPath: task.promptPath,
				});
			}
		}
	}

	// 2. Duplicate dependency check (same target task referenced multiple times)
	for (const [taskId, task] of pending) {
		const seenTargets = new Set<string>();
		for (const depRaw of task.dependencies) {
			const depId = parseDependencyReference(depRaw).taskId;
			if (seenTargets.has(depId)) {
				errors.push({
					code: "DEP_UNRESOLVED",
					message: `${taskId} lists duplicate dependency targeting ${depId}`,
					taskId,
					taskPath: task.promptPath,
				});
			}
			seenTargets.add(depId);
		}
	}

	// 3. Missing target check (not in pending AND not in completed)
	for (const [taskId, task] of pending) {
		for (const depRaw of task.dependencies) {
			const depId = parseDependencyReference(depRaw).taskId;
			if (!pending.has(depId) && !completed.has(depId)) {
				errors.push({
					code: "DEP_UNRESOLVED",
					message: `${taskId} depends on ${depRaw} which is neither pending nor completed`,
					taskId,
					taskPath: task.promptPath,
				});
			}
		}
	}

	// 4. Circular dependency detection (DFS with cycle path extraction)
	const visited = new Set<string>();
	const inStack = new Set<string>();

	function dfs(node: string): string[] | null {
		if (inStack.has(node)) {
			// Found a cycle — reconstruct path
			return [node];
		}
		if (visited.has(node)) return null;

		visited.add(node);
		inStack.add(node);

		const deps = graph.dependencies.get(node) || [];
		// Deterministic order: sort dependencies alphabetically
		const sortedDeps = [...deps].sort();

		for (const dep of sortedDeps) {
			const cyclePath = dfs(dep);
			if (cyclePath) {
				// If we haven't closed the cycle yet, keep adding nodes
				if (cyclePath.length === 1 || cyclePath[0] !== cyclePath[cyclePath.length - 1]) {
					cyclePath.push(node);
				}
				return cyclePath;
			}
		}

		inStack.delete(node);
		return null;
	}

	// Process nodes in deterministic (sorted) order
	const sortedNodes = [...graph.nodes].sort();
	for (const node of sortedNodes) {
		if (!visited.has(node)) {
			const cyclePath = dfs(node);
			if (cyclePath) {
				// Reverse so the path reads naturally: A → B → C → A
				cyclePath.reverse();
				const cycleStr = cyclePath.join(" → ");
				errors.push({
					code: "DEP_UNRESOLVED",
					message: `Circular dependency detected: ${cycleStr}`,
				});
				// Only report first cycle to avoid noisy output
				break;
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}


// ── Wave Computation (Topological Sort) ──────────────────────────────

/**
 * Compute execution waves via Kahn's algorithm (topological sort).
 *
 * Algorithm contract:
 * - Completed tasks are pre-satisfied: they contribute 0 in-degree but are
 *   excluded from the scheduled output.
 * - Wave 1: all pending tasks with 0 unmet dependencies (deps are either
 *   completed or have no deps).
 * - Wave N+1: tasks whose deps are all in waves 1..N or completed.
 * - Deterministic ordering: within each wave, tasks are sorted by task ID
 *   alphabetically. Queue initialization and zero in-degree pops both use
 *   sorted order.
 * - If not all tasks are placed (cycle exists), returns an error.
 */
export function computeWaves(
	graph: DependencyGraph,
	completed: Set<string>,
	pending: Map<string, ParsedTask>,
): { waves: string[][]; errors: DiscoveryError[] } {
	const errors: DiscoveryError[] = [];
	const waves: string[][] = [];

	// Calculate in-degree for each node (only counting edges from other pending tasks)
	const inDegree = new Map<string, number>();
	for (const node of graph.nodes) {
		const deps = graph.dependencies.get(node) || [];
		// Only count deps that are in the pending set (completed are pre-satisfied)
		const pendingDeps = deps.filter((d) => graph.nodes.has(d));
		inDegree.set(node, pendingDeps.length);
	}

	const placed = new Set<string>();
	const remaining = new Set(graph.nodes);

	while (remaining.size > 0) {
		// Collect all nodes with in-degree 0 (all deps satisfied)
		const waveNodes: string[] = [];
		for (const node of remaining) {
			if ((inDegree.get(node) || 0) === 0) {
				waveNodes.push(node);
			}
		}

		// Deterministic ordering: sort alphabetically by task ID
		waveNodes.sort();

		if (waveNodes.length === 0) {
			// Remaining nodes all have unsatisfied deps — cycle exists
			const stuckNodes = [...remaining].sort().join(", ");
			errors.push({
				code: "DEP_UNRESOLVED",
				message: `Cannot schedule remaining tasks (possible cycle): ${stuckNodes}`,
			});
			break;
		}

		waves.push(waveNodes);

		// Remove placed nodes and reduce in-degree for dependents
		for (const node of waveNodes) {
			placed.add(node);
			remaining.delete(node);

			const deps = graph.dependents.get(node) || [];
			for (const dependent of deps) {
				const current = inDegree.get(dependent) || 0;
				inDegree.set(dependent, current - 1);
			}
		}
	}

	return { waves, errors };
}


// ── File Scope Affinity ──────────────────────────────────────────────

/**
 * Group tasks with overlapping file scopes into affinity groups.
 *
 * Uses connected components over a file-scope overlap graph:
 * - Nodes are task IDs within the wave
 * - Edges connect tasks that share at least one file scope entry
 * - Connected components form affinity groups
 *
 * Affinity groups should be assigned to the same lane for serial execution
 * to avoid file-writing conflicts.
 *
 * Edge cases:
 * - Tasks with empty file scope: no affinity edges (independent)
 * - Partial overlaps: if A overlaps B and B overlaps C, all three
 *   are in the same affinity group (transitive closure)
 * - Oversized groups (> maxLanes): group stays together on one lane
 *   (serial fallback — correctness over parallelism)
 */
export function normalizeScope(scope: string): string {
	return scope.replace(/\\/g, "/").trim().replace(/\/+/g, "/").replace(/\/$/, "");
}

export function isGlobScope(scope: string): boolean {
	return scope.includes("*");
}

export function prefixOfGlob(scope: string): string {
	const idx = scope.indexOf("*");
	if (idx < 0) return scope;
	return scope.slice(0, idx).replace(/\/$/, "");
}

export function pathStartsWithSegment(pathValue: string, prefix: string): boolean {
	if (!prefix) return true;
	return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
}

export function scopesOverlap(aRaw: string, bRaw: string): boolean {
	const a = normalizeScope(aRaw);
	const b = normalizeScope(bRaw);
	if (!a || !b) return false;
	if (a === b) return true;

	const aGlob = isGlobScope(a);
	const bGlob = isGlobScope(b);

	// file vs file (no wildcards): overlap only on exact match
	if (!aGlob && !bGlob) return false;

	if (aGlob && !bGlob) {
		return pathStartsWithSegment(b, prefixOfGlob(a));
	}
	if (!aGlob && bGlob) {
		return pathStartsWithSegment(a, prefixOfGlob(b));
	}

	// glob vs glob: overlap if either prefix contains the other
	const aPrefix = prefixOfGlob(a);
	const bPrefix = prefixOfGlob(b);
	return pathStartsWithSegment(aPrefix, bPrefix) || pathStartsWithSegment(bPrefix, aPrefix);
}

export function taskScopesOverlap(taskA: ParsedTask, taskB: ParsedTask): boolean {
	if (taskA.fileScope.length === 0 || taskB.fileScope.length === 0) return false;
	for (const scopeA of taskA.fileScope) {
		for (const scopeB of taskB.fileScope) {
			if (scopesOverlap(scopeA, scopeB)) return true;
		}
	}
	return false;
}

export function applyFileScopeAffinity(
	waveTasks: string[],
	pending: Map<string, ParsedTask>,
): string[][] {
	if (waveTasks.length === 0) return [];

	// Build overlap graph using Union-Find
	const parent = new Map<string, string>();
	const rank = new Map<string, number>();

	for (const taskId of waveTasks) {
		parent.set(taskId, taskId);
		rank.set(taskId, 0);
	}

	function find(x: string): string {
		while (parent.get(x) !== x) {
			parent.set(x, parent.get(parent.get(x)!)!);
			x = parent.get(x)!;
		}
		return x;
	}

	function union(a: string, b: string): void {
		const ra = find(a);
		const rb = find(b);
		if (ra === rb) return;
		const rankA = rank.get(ra) || 0;
		const rankB = rank.get(rb) || 0;
		if (rankA < rankB) {
			parent.set(ra, rb);
		} else if (rankA > rankB) {
			parent.set(rb, ra);
		} else {
			parent.set(rb, ra);
			rank.set(ra, rankA + 1);
		}
	}

	// Pairwise overlap check (handles exact + wildcard overlaps)
	for (let i = 0; i < waveTasks.length; i++) {
		for (let j = i + 1; j < waveTasks.length; j++) {
			const taskA = pending.get(waveTasks[i]);
			const taskB = pending.get(waveTasks[j]);
			if (!taskA || !taskB) continue;
			if (taskScopesOverlap(taskA, taskB)) {
				union(taskA.taskId, taskB.taskId);
			}
		}
	}

	const groups = new Map<string, string[]>();
	for (const taskId of waveTasks) {
		const root = find(taskId);
		const group = groups.get(root) || [];
		group.push(taskId);
		groups.set(root, group);
	}

	const result: string[][] = [];
	for (const group of groups.values()) {
		group.sort();
		result.push(group);
	}
	result.sort((a, b) => a[0].localeCompare(b[0]));

	return result;
}


// ── Repo-Scoped Lane Helpers ─────────────────────────────────────────

/**
 * A group of tasks targeting the same repository.
 *
 * In repo mode: all tasks are in one group with `repoId` undefined.
 * In workspace mode: tasks are grouped by `resolvedRepoId`.
 */
export interface RepoTaskGroup {
	/** Repo ID (undefined for repo mode / tasks without resolvedRepoId) */
	repoId: string | undefined;
	/** Task IDs in this group (sorted alphabetically) */
	taskIds: string[];
}

/**
 * Group wave tasks by their resolved repo ID.
 *
 * In workspace mode, tasks carry `resolvedRepoId` from the discovery/routing
 * phase. This function groups them so each repo gets independent lane
 * allocation (own affinity groups, own max_lanes budget).
 *
 * In repo mode, all tasks have `resolvedRepoId === undefined`, so they all
 * land in a single group keyed by `""` (empty string). This preserves
 * existing single-repo behavior exactly.
 *
 * Deterministic ordering guarantees:
 * 1. Groups are sorted by repoId (undefined sorts first as empty string)
 * 2. Task IDs within each group are sorted alphabetically
 *
 * @param waveTasks - Task IDs in this wave
 * @param pending   - Full pending task map (from discovery)
 * @returns RepoTaskGroup[] sorted by repoId then by task IDs within group
 */
export function groupTasksByRepo(
	waveTasks: string[],
	pending: Map<string, ParsedTask>,
): RepoTaskGroup[] {
	const groupMap = new Map<string, string[]>();

	for (const taskId of waveTasks) {
		const task = pending.get(taskId);
		// Use resolvedRepoId or empty string as group key (undefined → "" for Map key)
		const key = task?.resolvedRepoId ?? "";
		const existing = groupMap.get(key) || [];
		existing.push(taskId);
		groupMap.set(key, existing);
	}

	// Build sorted groups
	const groups: RepoTaskGroup[] = [];
	const sortedKeys = [...groupMap.keys()].sort();
	for (const key of sortedKeys) {
		const taskIds = groupMap.get(key)!;
		taskIds.sort(); // Deterministic task order within group
		groups.push({
			repoId: key || undefined, // Convert "" back to undefined for repo mode
			taskIds,
		});
	}

	return groups;
}

/**
 * Generate a lane identifier string.
 *
 * - Repo mode (repoId undefined): `"lane-{N}"` — preserves legacy format
 * - Workspace mode (repoId set): `"{repoId}/lane-{N}"` — collision-safe across repos
 *
 * The `laneLocalNumber` is the 1-indexed lane number within the repo group
 * (NOT the global lane number). This gives operators clear per-repo context.
 *
 * @param laneLocalNumber - Lane number within the repo group (1-indexed)
 * @param repoId          - Repo identifier (undefined in repo mode)
 */
export function generateLaneId(laneLocalNumber: number, repoId?: string): string {
	if (repoId) {
		return `${repoId}/lane-${laneLocalNumber}`;
	}
	return `lane-${laneLocalNumber}`;
}

/**
 * Generate a lane session identifier for a lane.
 *
 * Includes the operator identifier (`opId`) for collision resistance
 * across concurrent operators on the same machine.
 *
 * - Repo mode: `"{prefix}-{opId}-lane-{N}"` — operator-scoped
 * - Workspace mode: `"{prefix}-{opId}-{repoId}-lane-{N}"` — operator + repo scoped
 *
 * Session identifiers must not contain periods or colons. Both `opId`
 * and `repoId` are assumed to be sanitized identifiers (alphanumeric
 * + hyphens only).
 *
 * @param sessionPrefix   - Session prefix from config (e.g., "orch")
 * @param laneLocalNumber - Lane number within the repo group (1-indexed)
 * @param opId            - Operator identifier (sanitized, e.g., "henrylach")
 * @param repoId          - Repo identifier (undefined in repo mode)
 */
export function generateLaneSessionId(sessionPrefix: string, laneLocalNumber: number, opId: string, repoId?: string): string {
	if (repoId) {
		return `${sessionPrefix}-${opId}-${repoId}-lane-${laneLocalNumber}`;
	}
	return `${sessionPrefix}-${opId}-lane-${laneLocalNumber}`;
}


// ── Repo-Scoped Worktree Resolution ─────────────────────────────────

/**
 * Resolve the repo root path for a given repo group.
 *
 * - Repo mode (repoId undefined): returns the passed `defaultRepoRoot`.
 * - Workspace mode (repoId set): looks up `workspaceConfig.repos.get(repoId).path`.
 *   Falls back to `defaultRepoRoot` if repoId is not found in config (defensive).
 *
 * @param repoId          - Repo identifier (undefined in repo mode)
 * @param defaultRepoRoot - Default repo root (the single repoRoot in repo mode)
 * @param workspaceConfig - Workspace configuration (null in repo mode)
 * @returns Absolute path to the repo root for this group
 */
export function resolveRepoRoot(
	repoId: string | undefined,
	defaultRepoRoot: string,
	workspaceConfig?: WorkspaceConfig | null,
): string {
	if (!repoId || !workspaceConfig) {
		return defaultRepoRoot;
	}
	const repoConfig = workspaceConfig.repos.get(repoId);
	if (!repoConfig) {
		// Defensive fallback — discovery/routing should have caught this
		return defaultRepoRoot;
	}
	return repoConfig.path;
}

/**
 * Resolve the base branch for worktree creation in a given repo.
 *
 * Fallback chain (first non-empty wins):
 * 1. `WorkspaceRepoConfig.defaultBranch` — explicit per-repo override from workspace config
 * 2. Detected current branch via `getCurrentBranch(repoRoot)` — runtime detection
 * 3. `batchBaseBranch` — the branch captured at batch start (ultimate fallback)
 *
 * In repo mode (repoId undefined), step 1 is skipped and step 2 uses
 * the same repo root as the batch, so the result is equivalent to
 * `batchBaseBranch` (which was itself detected from that repo).
 *
 * @param repoId          - Repo identifier (undefined in repo mode)
 * @param repoRoot        - Absolute path to this repo's root
 * @param batchBaseBranch - The base branch captured at batch start
 * @param workspaceConfig - Workspace configuration (null in repo mode)
 * @returns Branch name to base worktrees on for this repo
 */
export function resolveBaseBranch(
	repoId: string | undefined,
	repoRoot: string,
	batchBaseBranch: string,
	workspaceConfig?: WorkspaceConfig | null,
): string {
	// Step 0: If the batch base branch is an orch branch (wave 2+), check if
	// it exists in this repo. The orch branch has merged work from previous
	// waves — worktrees MUST branch from it so workers see prior wave output.
	// Without this, wave 2 worktrees branch from the repo's HEAD (e.g. develop)
	// which lacks wave 1's code, causing dependency satisfaction failures.
	if (batchBaseBranch.startsWith("orch/") && repoId) {
		try {
			const check = runGit(["rev-parse", "--verify", `refs/heads/${batchBaseBranch}`], repoRoot);
			console.error(`[resolveBaseBranch] repoId=${repoId} batchBaseBranch=${batchBaseBranch} repoRoot=${repoRoot} check.ok=${check.ok}`);
			if (check.ok) {
				return batchBaseBranch;
			}
		} catch (err) {
			console.error(`[resolveBaseBranch] repoId=${repoId} batchBaseBranch=${batchBaseBranch} THREW: ${err}`);
		}
	}

	// Step 1: Detect current branch of this specific repo.
	// This is the branch the developer is working on — worktrees should
	// branch from here so task files committed on this branch are visible.
	// In repo mode this equals batchBaseBranch. In workspace mode this
	// detects each repo's actual HEAD independently.
	if (repoId) {
		const detected = getCurrentBranch(repoRoot);
		if (detected) {
			return detected;
		}
	}

	// Step 2: Per-repo default branch from workspace config.
	// Used when repo HEAD is detached or undetectable.
	if (repoId && workspaceConfig) {
		const repoConfig = workspaceConfig.repos.get(repoId);
		if (repoConfig?.defaultBranch) {
			return repoConfig.defaultBranch;
		}
	}

	// Step 3: Ultimate fallback — batch-level base branch.
	// In workspace mode the batch base branch is the orch branch (e.g.
	// "orch/op-batch123"), which only exists in the primary repo. Using it
	// for a secondary repo would cause worktree creation failure because the
	// ref doesn't exist there. Fail fast with an actionable message instead.
	if (repoId && batchBaseBranch.startsWith("orch/")) {
		throw new Error(
			`Cannot resolve base branch for repo "${repoId}" at ${repoRoot}: ` +
			`HEAD is detached and no defaultBranch is configured. ` +
			`The batch base branch "${batchBaseBranch}" is an orch branch that does not exist in this repo. ` +
			`Configure a defaultBranch for this repo in task-orchestrator.yaml workspace settings.`,
		);
	}

	return batchBaseBranch;
}


// ── Segment Planning (TP-080) ───────────────────────────────────────

const SEGMENT_REPO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const INFERRED_LINEAR_REASON = "inferred:first-appearance-linear-chain";

function normalizeRepoIdCandidate(raw: string): string | null {
	const candidate = raw.trim().toLowerCase();
	if (!SEGMENT_REPO_ID_PATTERN.test(candidate)) return null;
	return candidate;
}

interface SegmentPlanBuildOptions {
	/** Optional workspace repo IDs used to validate file-scope repo prefixes. */
	workspaceRepoIds?: Iterable<string>;
}

function collectKnownRepoIds(
	pending: Map<string, ParsedTask>,
	workspaceRepoIds?: Iterable<string>,
): Set<string> {
	const known = new Set<string>();

	if (workspaceRepoIds) {
		for (const repoIdRaw of workspaceRepoIds) {
			const repoId = normalizeRepoIdCandidate(String(repoIdRaw));
			if (repoId) known.add(repoId);
		}
	}

	for (const task of pending.values()) {
		if (task.resolvedRepoId) {
			const repoId = normalizeRepoIdCandidate(task.resolvedRepoId);
			if (repoId) known.add(repoId);
		}
		if (task.explicitSegmentDag) {
			for (const repoIdRaw of task.explicitSegmentDag.repoIds) {
				const repoId = normalizeRepoIdCandidate(repoIdRaw);
				if (repoId) known.add(repoId);
			}
		}
	}
	return known;
}

function extractRepoPrefixFromFileScope(fileScopeEntry: string): string | null {
	const normalized = fileScopeEntry.replace(/\\/g, "/").trim();
	if (!normalized) return null;
	const firstSegment = normalized.split("/")[0]?.trim();
	if (!firstSegment) return null;
	return normalizeRepoIdCandidate(firstSegment);
}

interface InferredRepoOrder {
	repoIds: string[];
	usedFallback: boolean;
}

/**
 * Build deterministic repo ordering for inferred segment plans.
 *
 * Signal precedence:
 * 1) file scope repo prefixes (first appearance)
 * 2) dependency task repos (first appearance)
 * 3) fallback to `resolvedRepoId`, then synthetic `default`
 */
export function inferTaskRepoOrder(
	task: ParsedTask,
	pending: Map<string, ParsedTask>,
	knownRepoIds: Set<string>,
): InferredRepoOrder {
	const firstAppearance = new Map<string, number>();
	let cursor = 0;

	function record(repoIdRaw: string, requireKnown = false): string | null {
		const repoId = normalizeRepoIdCandidate(repoIdRaw);
		if (!repoId) return null;
		if (requireKnown && knownRepoIds.size > 0 && !knownRepoIds.has(repoId)) return null;
		if (!firstAppearance.has(repoId)) {
			firstAppearance.set(repoId, cursor++);
		}
		return repoId;
	}

	let hasPrimarySignal = false;

	for (const scopeEntry of task.fileScope) {
		if (knownRepoIds.size === 0) {
			// Repo-mode guard: without known workspace repo IDs, fileScope prefixes like
			// "src/" or "lib/" are ambiguous and should not create synthetic segments.
			continue;
		}
		const repoId = extractRepoPrefixFromFileScope(scopeEntry);
		if (!repoId) continue;
		if (record(repoId, true) !== null) {
			hasPrimarySignal = true;
		}
	}

	for (const depRaw of task.dependencies) {
		const depId = parseDependencyReference(depRaw).taskId;
		const depTask = pending.get(depId);
		if (depTask?.resolvedRepoId && record(depTask.resolvedRepoId, true) !== null) {
			hasPrimarySignal = true;
		}
	}

	if (!hasPrimarySignal) {
		const fallback = normalizeRepoIdCandidate(task.resolvedRepoId ?? "") || "default";
		return {
			repoIds: [fallback],
			usedFallback: true,
		};
	}

	if (task.resolvedRepoId) {
		record(task.resolvedRepoId, true);
	}

	const repoIds = [...firstAppearance.entries()]
		.sort((a, b) => {
			if (a[1] !== b[1]) return a[1] - b[1];
			return a[0].localeCompare(b[0]);
		})
		.map(([repoId]) => repoId);

	return {
		repoIds,
		usedFallback: false,
	};
}

function sortSegmentEdges<T extends { fromSegmentId: string; toSegmentId: string }>(
	edges: T[],
): T[] {
	return [...edges].sort((a, b) => {
		if (a.fromSegmentId !== b.fromSegmentId) return a.fromSegmentId.localeCompare(b.fromSegmentId);
		return a.toSegmentId.localeCompare(b.toSegmentId);
	});
}

function buildSegmentNodes(taskId: string, repoIds: string[]) {
	const nodes = repoIds.map((repoId, order) => ({
		segmentId: buildSegmentId(taskId, repoId),
		taskId,
		repoId,
		order,
	}));
	return nodes.sort((a, b) => (a.order - b.order) || a.repoId.localeCompare(b.repoId));
}

export function buildSegmentPlanForTask(
	task: ParsedTask,
	pending: Map<string, ParsedTask>,
	knownRepoIds: Set<string>,
): TaskSegmentPlan {
	if (task.explicitSegmentDag) {
		const repoIds = [...task.explicitSegmentDag.repoIds];
		const segments = buildSegmentNodes(task.taskId, repoIds);
		const edges = sortSegmentEdges(
			task.explicitSegmentDag.edges.map((edge) => ({
				fromSegmentId: buildSegmentId(task.taskId, edge.fromRepoId),
				toSegmentId: buildSegmentId(task.taskId, edge.toRepoId),
				provenance: "explicit" as const,
				reason: "prompt:segment-dag",
			})),
		);
		return {
			taskId: task.taskId,
			segments,
			edges,
			mode: "explicit-dag",
		};
	}

	const inferred = inferTaskRepoOrder(task, pending, knownRepoIds);
	const segments = buildSegmentNodes(task.taskId, inferred.repoIds);
	const edges = sortSegmentEdges(
		segments.slice(0, -1).map((segment, idx) => ({
			fromSegmentId: segment.segmentId,
			toSegmentId: segments[idx + 1].segmentId,
			provenance: "inferred" as const,
			reason: INFERRED_LINEAR_REASON,
		})),
	);

	return {
		taskId: task.taskId,
		segments,
		edges,
		mode: inferred.usedFallback ? "repo-singleton" : "inferred-sequential",
	};
}

/** Build a deterministic taskId→segmentPlan map for the whole pending set. */
export function buildTaskSegmentPlans(
	pending: Map<string, ParsedTask>,
	options: SegmentPlanBuildOptions = {},
): TaskSegmentPlanMap {
	const knownRepoIds = collectKnownRepoIds(pending, options.workspaceRepoIds);
	const plans: TaskSegmentPlanMap = new Map();
	for (const taskId of [...pending.keys()].sort()) {
		const task = pending.get(taskId);
		if (!task) continue;
		plans.set(taskId, buildSegmentPlanForTask(task, pending, knownRepoIds));
	}
	return plans;
}


// ── Lane Assignment ──────────────────────────────────────────────────

/**
 * Assign tasks within a wave to lanes.
 *
 * Algorithm (affinity-first strategy):
 * 1. Compute affinity groups via file scope overlap
 * 2. Each affinity group goes to one lane (serial within lane)
 * 3. Remaining single-task "groups" are distributed via round-robin
 *    or load-balanced fill
 * 4. Lane count: min(number of groups, maxLanes)
 *
 * Deterministic tie-breaking: groups are sorted by first task ID,
 * then assigned in order. Round-robin assignment is deterministic
 * given deterministic group ordering.
 *
 * For "round-robin" strategy: simple sequential assignment.
 * For "load-balanced" strategy: assign to lane with lowest total weight.
 * For "affinity-first": affinity groups first, then load-balanced fill.
 */
export function assignTasksToLanes(
	waveTasks: string[],
	pending: Map<string, ParsedTask>,
	maxLanes: number,
	strategy: string,
	sizeWeights: Record<string, number>,
): LaneAssignment[] {
	if (waveTasks.length === 0) return [];

	// Step 1: Compute affinity groups
	const affinityGroups = applyFileScopeAffinity(waveTasks, pending);

	// Step 2: Determine lane count
	const laneCount = Math.min(affinityGroups.length, maxLanes);

	// Step 3: Initialize lane weights (for load-balanced assignment)
	const laneWeights: number[] = new Array(laneCount).fill(0);
	const laneAssignments: LaneAssignment[][] = new Array(laneCount)
		.fill(null)
		.map(() => []);

	function getWeight(taskId: string): number {
		const task = pending.get(taskId);
		if (!task) return sizeWeights["M"] || 2;
		return sizeWeights[task.size] || sizeWeights["M"] || 2;
	}

	function assignGroupToLane(group: string[], laneIndex: number): void {
		for (const taskId of group) {
			const task = pending.get(taskId);
			if (!task) continue;
			laneAssignments[laneIndex].push({
				taskId,
				lane: laneIndex + 1, // 1-indexed lanes
				task,
			});
			laneWeights[laneIndex] += getWeight(taskId);
		}
	}

	function findLightestLane(): number {
		let minIdx = 0;
		let minWeight = laneWeights[0];
		for (let i = 1; i < laneCount; i++) {
			if (laneWeights[i] < minWeight) {
				minWeight = laneWeights[i];
				minIdx = i;
			}
		}
		return minIdx;
	}

	// Step 4: Assign groups to lanes based on strategy
	if (strategy === "round-robin") {
		for (let i = 0; i < affinityGroups.length; i++) {
			const laneIdx = i % laneCount;
			assignGroupToLane(affinityGroups[i], laneIdx);
		}
	} else if (strategy === "load-balanced") {
		// Sort groups by weight (heaviest first for better balance)
		const sortedGroups = [...affinityGroups].sort((a, b) => {
			const weightA = a.reduce((sum, id) => sum + getWeight(id), 0);
			const weightB = b.reduce((sum, id) => sum + getWeight(id), 0);
			if (weightB !== weightA) return weightB - weightA;
			// Deterministic tie-break: alphabetical by first task ID
			return a[0].localeCompare(b[0]);
		});
		for (const group of sortedGroups) {
			const laneIdx = findLightestLane();
			assignGroupToLane(group, laneIdx);
		}
	} else {
		// affinity-first: multi-task groups get priority, then load-balanced fill
		const multiGroups = affinityGroups.filter((g) => g.length > 1);
		const singleGroups = affinityGroups.filter((g) => g.length === 1);

		// Assign multi-task affinity groups first (heaviest first)
		const sortedMulti = [...multiGroups].sort((a, b) => {
			const weightA = a.reduce((sum, id) => sum + getWeight(id), 0);
			const weightB = b.reduce((sum, id) => sum + getWeight(id), 0);
			if (weightB !== weightA) return weightB - weightA;
			return a[0].localeCompare(b[0]);
		});
		for (const group of sortedMulti) {
			const laneIdx = findLightestLane();
			assignGroupToLane(group, laneIdx);
		}

		// Fill remaining with single-task groups (load-balanced)
		const sortedSingles = [...singleGroups].sort((a, b) => {
			const weightA = getWeight(a[0]);
			const weightB = getWeight(b[0]);
			if (weightB !== weightA) return weightB - weightA;
			return a[0].localeCompare(b[0]);
		});
		for (const group of sortedSingles) {
			const laneIdx = findLightestLane();
			assignGroupToLane(group, laneIdx);
		}
	}

	// Flatten all lane assignments into a single array
	const result: LaneAssignment[] = [];
	for (const assignments of laneAssignments) {
		result.push(...assignments);
	}

	return result;
}


/**
 * Result of `allocateLanes()`.
 *
 * On success: `success=true`, `lanes` contains all allocated lanes.
 * On failure: `success=false`, `error` describes what went wrong,
 *   `rolledBack` indicates whether partial worktrees were cleaned up.
 */
export interface AllocateLanesResult {
	/** Whether all lanes were allocated successfully */
	success: boolean;
	/** Allocated lanes, sorted by laneNumber. Empty on failure. */
	lanes: AllocatedLane[];
	/** Number of lanes allocated */
	laneCount: number;
	/** Error details (null on success) */
	error: {
		code: AllocationErrorCode;
		message: string;
		details?: string;
	} | null;
	/** Whether partial worktrees were rolled back on failure */
	rolledBack: boolean;
	/** Batch ID used for branch/session naming */
	batchId: string;
}

/**
 * Validate allocation inputs before proceeding.
 *
 * Checks:
 * - max_lanes >= 1
 * - waveTasks is non-empty
 * - All task IDs in waveTasks exist in pending map
 * - Config has valid strategy and size_weights
 *
 * @returns null if valid, AllocationError if invalid
 */
export function validateAllocationInputs(
	waveTasks: string[],
	pending: Map<string, ParsedTask>,
	config: OrchestratorConfig,
): AllocationError | null {
	// Validate max_lanes
	if (
		!config.orchestrator.max_lanes ||
		config.orchestrator.max_lanes < 1 ||
		!Number.isInteger(config.orchestrator.max_lanes)
	) {
		return new AllocationError(
			"ALLOC_INVALID_CONFIG",
			`max_lanes must be a positive integer, got: ${config.orchestrator.max_lanes}`,
		);
	}

	// Validate wave has tasks
	if (!waveTasks || waveTasks.length === 0) {
		return new AllocationError(
			"ALLOC_EMPTY_WAVE",
			"Cannot allocate lanes for an empty wave (no tasks provided)",
		);
	}

	// Validate all task IDs exist in pending map
	const missingTasks: string[] = [];
	for (const taskId of waveTasks) {
		if (!pending.has(taskId)) {
			missingTasks.push(taskId);
		}
	}
	if (missingTasks.length > 0) {
		return new AllocationError(
			"ALLOC_TASK_NOT_FOUND",
			`Task IDs not found in pending map: ${missingTasks.join(", ")}`,
			`These tasks may have been completed or removed between discovery and allocation.`,
		);
	}

	// Validate strategy is recognized
	const validStrategies = ["affinity-first", "round-robin", "load-balanced"];
	if (!validStrategies.includes(config.assignment.strategy)) {
		return new AllocationError(
			"ALLOC_INVALID_CONFIG",
			`Unknown assignment strategy: "${config.assignment.strategy}". ` +
			`Valid strategies: ${validStrategies.join(", ")}`,
		);
	}

	// Validate worktree prefix is non-empty
	if (!config.orchestrator.worktree_prefix?.trim()) {
		return new AllocationError(
			"ALLOC_INVALID_CONFIG",
			`worktree_prefix must be a non-empty string`,
		);
	}

	return null;
}

/**
 * Allocate lanes for a wave: assign tasks, create worktrees, return ready-to-execute lanes.
 *
 * This is the Phase 3 implementation from §5 of the design doc.
 * It coordinates four stages:
 *
 * 0. **Input validation** — config, tasks, strategy checks.
 *
 * 1. **Repo grouping** — tasks are grouped by `resolvedRepoId` via
 *    `groupTasksByRepo()`. In repo mode (no resolvedRepoId), all tasks
 *    go to a single group, preserving existing behavior exactly.
 *
 * 2. **Per-repo affinity grouping + strategy assignment** — for each repo
 *    group, `assignTasksToLanes()` runs independently with its own
 *    max_lanes budget. Lane numbers within each group are 1-indexed.
 *    Groups are processed in deterministic order (sorted by repoId).
 *    Global lane numbers are assigned sequentially across repo groups
 *    (repo A gets lanes 1..Na, repo B gets lanes Na+1..Na+Nb, etc.).
 *
 * 3. **Worktree provisioning** — ensure one worktree per global lane via
 *    `ensureLaneWorktrees()`. Existing lanes are reused across waves;
 *    missing lanes are created. If creating a missing lane fails,
 *    newly-created lanes in this call are rolled back.
 *
 * 4. **Build AllocatedLane[]** — each lane gets repo-aware `laneId` and
 *    `laneSessionId`. In workspace mode: `"api/lane-1"`, `"orch-api-lane-1"`.
 *    In repo mode: `"lane-1"`,
 *    `"orch-lane-1"` (unchanged).
 *
 * **Determinism guarantee:** Given the same `waveTasks`, `pending`, and `config`,
 * this function always produces the same lane assignments and task ordering.
 * Repo group order is sorted alphabetically by repoId. Lane assignment within
 * each group uses the configured strategy deterministically.
 *
 * @param waveTasks       - Task IDs in this wave (from topological sort)
 * @param pending         - Full pending task map (from discovery)
 * @param config          - Orchestrator configuration
 * @param repoRoot        - Absolute path to the main/default repository root
 * @param batchId         - Batch ID for branch/session naming (e.g., "20260308T111750")
 * @param baseBranch      - Branch to base worktrees on (captured at batch start)
 * @param workspaceConfig - Workspace configuration for repo routing (null/undefined = repo mode)
 * @returns               - AllocateLanesResult with success flag and lane details
 */
export function allocateLanes(
	waveTasks: string[],
	pending: Map<string, ParsedTask>,
	config: OrchestratorConfig,
	repoRoot: string,
	batchId: string,
	baseBranch: string,
	workspaceConfig?: WorkspaceConfig | null,
): AllocateLanesResult {
	// ── Stage 0: Input validation ────────────────────────────────
	const validationError = validateAllocationInputs(waveTasks, pending, config);
	if (validationError) {
		return {
			success: false,
			lanes: [],
			laneCount: 0,
			error: {
				code: validationError.code,
				message: validationError.message,
				details: validationError.details,
			},
			rolledBack: false,
			batchId,
		};
	}

	// ── Stage 1: Group tasks by repo ─────────────────────────────
	const repoGroups = groupTasksByRepo(waveTasks, pending);

	// ── Stage 2: Per-repo affinity grouping + strategy assignment ─
	// Each repo group gets independent lane assignment. Lane numbers
	// within each group start at 1. We track a globalLaneOffset to
	// produce globally unique lane numbers across all repo groups.
	//
	// The structure tracks: global lane number → { repoId, localLane, assignments }
	const globalLaneEntries: Array<{
		globalLane: number;
		localLane: number;
		repoId: string | undefined;
		assignments: LaneAssignment[];
	}> = [];

	let globalLaneOffset = 0;

	for (const group of repoGroups) {
		const groupAssignments = assignTasksToLanes(
			group.taskIds,
			pending,
			config.orchestrator.max_lanes,
			config.assignment.strategy,
			config.assignment.size_weights,
		);

		// Determine local lane numbers used in this group's assignment
		const localLaneNumbers = new Set(groupAssignments.map((a) => a.lane));
		const sortedLocalLanes = [...localLaneNumbers].sort((a, b) => a - b);

		// Map local lane numbers to global lane numbers
		const localToGlobal = new Map<number, number>();
		for (let i = 0; i < sortedLocalLanes.length; i++) {
			localToGlobal.set(sortedLocalLanes[i], globalLaneOffset + i + 1);
		}

		// Group assignments by local lane number
		const byLocalLane = new Map<number, LaneAssignment[]>();
		for (const a of groupAssignments) {
			const existing = byLocalLane.get(a.lane) || [];
			existing.push(a);
			byLocalLane.set(a.lane, existing);
		}

		// Produce global lane entries
		for (const localLane of sortedLocalLanes) {
			globalLaneEntries.push({
				globalLane: localToGlobal.get(localLane)!,
				localLane,
				repoId: group.repoId,
				assignments: byLocalLane.get(localLane) || [],
			});
		}

		globalLaneOffset += sortedLocalLanes.length;
	}

	const laneCount = globalLaneEntries.length;

	if (laneCount === 0) {
		return {
			success: false,
			lanes: [],
			laneCount: 0,
			error: {
				code: "ALLOC_EMPTY_WAVE",
				message: "Lane assignment produced zero lanes (no tasks could be assigned)",
			},
			rolledBack: false,
			batchId,
		};
	}

	// ── Stage 3: Ensure lane worktrees exist per repo group ──────
	// In repo mode: all lanes use the single repoRoot/baseBranch (unchanged).
	// In workspace mode: each repo group's lanes are created against that
	// repo's root with its resolved base branch. Cross-repo rollback on
	// partial failure ensures atomic wave provisioning.
	//
	// Group globalLaneEntries by repoId for per-repo worktree provisioning.
	const repoLaneGroups = new Map<string, number[]>(); // key → global lane numbers
	const repoIdForGroup = new Map<string, string | undefined>(); // key → repoId
	for (const entry of globalLaneEntries) {
		const key = entry.repoId ?? "";
		const existing = repoLaneGroups.get(key) || [];
		existing.push(entry.globalLane);
		repoLaneGroups.set(key, existing);
		repoIdForGroup.set(key, entry.repoId);
	}
	const sortedGroupKeys = [...repoLaneGroups.keys()].sort();

	// Track all worktrees created across all repo groups for cross-repo rollback
	const allWorktrees = new Map<number, WorktreeInfo>(); // global lane → worktree
	const createdGroupKeys: string[] = []; // groups that succeeded (for rollback tracking)

	for (const groupKey of sortedGroupKeys) {
		const groupLaneNumbers = repoLaneGroups.get(groupKey)!;
		const groupRepoId = repoIdForGroup.get(groupKey);
		const groupRepoRoot = resolveRepoRoot(groupRepoId, repoRoot, workspaceConfig);
		const groupBaseBranch = resolveBaseBranch(groupRepoId, groupRepoRoot, baseBranch, workspaceConfig);

		const worktreeResult = ensureLaneWorktrees(
			groupLaneNumbers,
			batchId,
			config,
			groupRepoRoot,
			groupBaseBranch,
		);

		if (!worktreeResult.success) {
			// ── Cross-repo rollback: remove worktrees from all previously-succeeded groups ─
			const rollbackErrors: string[] = [];
			for (const prevKey of createdGroupKeys) {
				const prevRepoId = repoIdForGroup.get(prevKey);
				const prevRepoRoot = resolveRepoRoot(prevRepoId, repoRoot, workspaceConfig);
				const prevLanes = repoLaneGroups.get(prevKey)!;
				for (const lane of prevLanes) {
					const wt = allWorktrees.get(lane);
					if (wt) {
						try {
							removeWorktree(wt, prevRepoRoot);
						} catch (rbErr: unknown) {
							rollbackErrors.push(
								`Lane ${lane} (repo ${prevRepoId ?? "default"}): ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`,
							);
						}
					}
				}
			}

			const failedLanes = worktreeResult.errors
				.map((e) => `Lane ${e.laneNumber}: [${e.code}] ${e.message}`)
				.join("\n");
			const withinGroupRollbackIssues = worktreeResult.rollbackErrors.length > 0
				? "\nWithin-group rollback issues:\n" +
				  worktreeResult.rollbackErrors
					.map((e) => `  Lane ${e.laneNumber}: [${e.code}] ${e.message}`)
					.join("\n")
				: "";
			const crossRepoRollbackIssues = rollbackErrors.length > 0
				? "\nCross-repo rollback issues:\n" +
				  rollbackErrors.map((e) => `  ${e}`).join("\n")
				: "";

			return {
				success: false,
				lanes: [],
				laneCount: 0,
				error: {
					code: "ALLOC_WORKTREE_FAILED",
					message: `Failed to create worktrees for repo "${groupRepoId ?? "default"}" (${groupLaneNumbers.length} lane(s))`,
					details: failedLanes + withinGroupRollbackIssues + crossRepoRollbackIssues,
				},
				rolledBack: true,
				batchId,
			};
		}

		// Record successful worktrees
		for (const wt of worktreeResult.worktrees) {
			allWorktrees.set(wt.laneNumber, wt);
		}
		createdGroupKeys.push(groupKey);
	}

	// ── Stage 4: Build AllocatedLane[] from assignments + worktrees ─
	const sessionPrefix = config.orchestrator.sessionPrefix || "orch";
	const opId = resolveOperatorId(config);
	const strategy = config.assignment.strategy as AllocatedLane["strategy"];
	const sizeWeights = config.assignment.size_weights;

	const allocatedLanes: AllocatedLane[] = [];

	for (const entry of globalLaneEntries) {
		const wt = allWorktrees.get(entry.globalLane);
		if (!wt) {
			// This should never happen if ensureLaneWorktrees and assignTasksToLanes
			// agree on lane numbers, but handle defensively.
			// Roll back all worktrees across all repos on this unexpected failure.
			// Pass batchId + config for batch-scoped cleanup (only remove this batch's worktrees).
			for (const groupKey of createdGroupKeys) {
				const groupRepoId = repoIdForGroup.get(groupKey);
				const groupRepoRoot = resolveRepoRoot(groupRepoId, repoRoot, workspaceConfig);
				removeAllWorktrees(config.orchestrator.worktree_prefix, groupRepoRoot, opId, undefined, batchId, config);
			}
			return {
				success: false,
				lanes: [],
				laneCount: 0,
				error: {
					code: "ALLOC_WORKTREE_FAILED",
					message: `No worktree found for lane ${entry.globalLane} — lane count mismatch between assignment and worktree creation`,
				},
				rolledBack: true,
				batchId,
			};
		}

		// Build ordered task list (preserve assignment order from assignTasksToLanes)
		const allocatedTasks: AllocatedTask[] = entry.assignments.map((a, idx) => ({
			taskId: a.taskId,
			order: idx,
			task: a.task,
			estimatedMinutes: getTaskDurationMinutes(a.task.size, sizeWeights),
		}));

		const estimatedLoad = allocatedTasks.reduce(
			(sum, t) => sum + (sizeWeights[t.task.size] || sizeWeights["M"] || 2),
			0,
		);
		const estimatedMinutes = allocatedTasks.reduce(
			(sum, t) => sum + t.estimatedMinutes,
			0,
		);

		const laneSessionId = generateLaneSessionId(sessionPrefix, entry.localLane, opId, entry.repoId);
		allocatedLanes.push({
			laneNumber: entry.globalLane,
			laneId: generateLaneId(entry.localLane, entry.repoId),
			laneSessionId,
			worktreePath: wt.path,
			branch: wt.branch,
			tasks: allocatedTasks,
			strategy,
			estimatedLoad,
			estimatedMinutes,
			repoId: entry.repoId,
		});
	}

	// Sort by global lane number for deterministic output
	allocatedLanes.sort((a, b) => a.laneNumber - b.laneNumber);

	return {
		success: true,
		lanes: allocatedLanes,
		laneCount: allocatedLanes.length,
		error: null,
		rolledBack: false,
		batchId,
	};
}


// ── Full Wave Pipeline ───────────────────────────────────────────────

/**
 * Run the full wave computation pipeline:
 * 1. Build dependency graph from registry
 * 2. Validate graph (self-edges, duplicates, cycles, missing targets)
 * 3. Compute topological waves
 * 4. Assign tasks to lanes within each wave
 *
 * Returns WaveAssignment[] with wave numbers and lane assignments,
 * plus any errors encountered.
 */
export interface WaveComputationOptions {
	/** Optional workspace repo IDs used by segment inference in workspace mode. */
	workspaceRepoIds?: Iterable<string>;
}

export function computeWaveAssignments(
	pending: Map<string, ParsedTask>,
	completed: Set<string>,
	config: OrchestratorConfig,
	options: WaveComputationOptions = {},
): WaveComputationResult {
	const errors: DiscoveryError[] = [];

	// Step 1: Build dependency graph
	const graph = buildDependencyGraph(pending, completed);

	// Step 2: Validate graph
	const validation = validateGraph(graph, pending, completed);
	if (!validation.valid) {
		return { waves: [], errors: validation.errors };
	}

	// Step 3: Compute topological waves
	const { waves: rawWaves, errors: waveErrors } = computeWaves(graph, completed, pending);
	if (waveErrors.length > 0) {
		return { waves: [], errors: waveErrors };
	}

	// Step 3.5: Build additive segment planning output (deterministic map)
	const segmentPlans = buildTaskSegmentPlans(pending, {
		workspaceRepoIds: options.workspaceRepoIds,
	});

	// Step 4: Assign tasks to lanes within each wave
	const waveAssignments: WaveAssignment[] = [];
	for (let i = 0; i < rawWaves.length; i++) {
		const waveTasks = rawWaves[i];
		const laneAssignments = assignTasksToLanes(
			waveTasks,
			pending,
			config.orchestrator.max_lanes,
			config.assignment.strategy,
			config.assignment.size_weights,
		);

		waveAssignments.push({
			waveNumber: i + 1,
			tasks: laneAssignments,
		});
	}

	return { waves: waveAssignments, errors, segmentPlans };
}
