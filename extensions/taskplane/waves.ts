/**
 * Wave computation, graph validation, lane assignment/allocation
 * @module orch/waves
 */
import { join } from "path";

import { parseDependencyReference } from "./discovery.ts";
import { AllocationError, getTaskDurationMinutes } from "./types.ts";
import type { AllocatedLane, AllocatedTask, AllocateLanesResult, AllocationErrorCode, DependencyGraph, DiscoveryError, GraphValidationResult, LaneAssignment, OrchestratorConfig, ParsedTask, WaveAssignment, WaveComputationResult, WorktreeInfo } from "./types.ts";
import { ensureLaneWorktrees, removeAllWorktrees } from "./worktree.ts";

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
 * It coordinates three stages:
 *
 * 1. **Affinity grouping** — tasks with overlapping file scope are grouped
 *    together using `applyFileScopeAffinity()`. Overlap is detected from
 *    PROMPT.md's `## File Scope` section (parsed during discovery). Affinity
 *    groups have priority: they are assigned before independent tasks.
 *    Tie-breaking is deterministic (alphabetical by first task ID in group).
 *
 * 2. **Strategy assignment** — groups are distributed across lanes using
 *    the configured strategy via `assignTasksToLanes()`:
 *    - `affinity-first`: multi-task groups first (heaviest→lightest), then
 *      single tasks via load-balanced fill
 *    - `round-robin`: sequential assignment by group index mod lane count
 *    - `load-balanced`: heaviest group → lightest lane, repeated
 *
 * 3. **Worktree provisioning** — ensure one worktree per lane via
 *    `ensureLaneWorktrees()`.
 *    Existing lanes are reused across waves; missing lanes are created.
 *    If creating a missing lane fails, newly-created lanes in this call are
 *    rolled back.
 *
 * **Determinism guarantee:** Given the same `waveTasks`, `pending`, and `config`,
 * this function always produces the same lane assignments and task ordering.
 * This makes debugging and retry behavior predictable.
 *
 * @param waveTasks - Task IDs in this wave (from topological sort)
 * @param pending   - Full pending task map (from discovery)
 * @param config    - Orchestrator configuration
 * @param repoRoot  - Absolute path to the main repository root
 * @param batchId   - Batch ID for branch/session naming (e.g., "20260308T111750")
 * @param baseBranch - Branch to base worktrees on (captured at batch start)
 * @returns         - AllocateLanesResult with success flag and lane details
 */
export function allocateLanes(
	waveTasks: string[],
	pending: Map<string, ParsedTask>,
	config: OrchestratorConfig,
	repoRoot: string,
	batchId: string,
	baseBranch: string,
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

	// ── Stage 1+2: Affinity grouping + strategy assignment ───────
	// assignTasksToLanes() internally calls applyFileScopeAffinity()
	// and applies the configured strategy. It returns LaneAssignment[]
	// with deterministic ordering.
	const laneAssignments = assignTasksToLanes(
		waveTasks,
		pending,
		config.orchestrator.max_lanes,
		config.assignment.strategy,
		config.assignment.size_weights,
	);

	// Determine actual lane count from assignments
	const laneNumbers = new Set(laneAssignments.map((a) => a.lane));
	const sortedLaneNumbers = [...laneNumbers].sort((a, b) => a - b);
	const laneCount = laneNumbers.size;

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

	// ── Stage 3: Ensure lane worktrees exist (reuse across waves + create missing) ─
	const worktreeResult = ensureLaneWorktrees(sortedLaneNumbers, batchId, config, repoRoot, baseBranch);

	if (!worktreeResult.success) {
		const failedLanes = worktreeResult.errors
			.map((e) => `Lane ${e.laneNumber}: [${e.code}] ${e.message}`)
			.join("\n");
		const rollbackIssues = worktreeResult.rollbackErrors.length > 0
			? "\nRollback issues:\n" +
			  worktreeResult.rollbackErrors
				.map((e) => `  Lane ${e.laneNumber}: [${e.code}] ${e.message}`)
				.join("\n")
			: "";

		return {
			success: false,
			lanes: [],
			laneCount: 0,
			error: {
				code: "ALLOC_WORKTREE_FAILED",
				message: `Failed to create worktrees for ${laneCount} lane(s)`,
				details: failedLanes + rollbackIssues,
			},
			rolledBack: worktreeResult.rolledBack,
			batchId,
		};
	}

	// ── Stage 4: Build AllocatedLane[] from assignments + worktrees ─
	const tmuxPrefix = config.orchestrator.tmux_prefix || "orch";
	const strategy = config.assignment.strategy as AllocatedLane["strategy"];
	const sizeWeights = config.assignment.size_weights;

	// Build a worktree lookup by lane number
	const worktreeByLane = new Map<number, WorktreeInfo>();
	for (const wt of worktreeResult.worktrees) {
		worktreeByLane.set(wt.laneNumber, wt);
	}

	// Group assignments by lane number and build AllocatedLane objects
	const laneTaskMap = new Map<number, LaneAssignment[]>();
	for (const assignment of laneAssignments) {
		const existing = laneTaskMap.get(assignment.lane) || [];
		existing.push(assignment);
		laneTaskMap.set(assignment.lane, existing);
	}

	const allocatedLanes: AllocatedLane[] = [];

	for (const [laneNum, assignments] of laneTaskMap) {
		const wt = worktreeByLane.get(laneNum);
		if (!wt) {
			// This should never happen if ensureLaneWorktrees and assignTasksToLanes
			// agree on lane numbers, but handle defensively
			// Roll back all worktrees on this unexpected failure
			removeAllWorktrees(config.orchestrator.worktree_prefix, repoRoot);
			return {
				success: false,
				lanes: [],
				laneCount: 0,
				error: {
					code: "ALLOC_WORKTREE_FAILED",
					message: `No worktree found for lane ${laneNum} — lane count mismatch between assignment and worktree creation`,
				},
				rolledBack: true,
				batchId,
			};
		}

		// Build ordered task list (preserve assignment order from assignTasksToLanes)
		const allocatedTasks: AllocatedTask[] = assignments.map((a, idx) => ({
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

		allocatedLanes.push({
			laneNumber: laneNum,
			laneId: `lane-${laneNum}`,
			tmuxSessionName: `${tmuxPrefix}-lane-${laneNum}`,
			worktreePath: wt.path,
			branch: wt.branch,
			tasks: allocatedTasks,
			strategy,
			estimatedLoad,
			estimatedMinutes,
		});
	}

	// Sort by lane number for deterministic output
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
export function computeWaveAssignments(
	pending: Map<string, ParsedTask>,
	completed: Set<string>,
	config: OrchestratorConfig,
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

	return { waves: waveAssignments, errors };
}

