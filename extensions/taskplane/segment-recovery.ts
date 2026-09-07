/**
 * segment-recovery.ts — Segment-record writers for supervisor recovery tools.
 *
 * On the v2 (segment) runtime, `segments[]` is the authoritative execution
 * record: resume's `reconstructSegmentFrontier()` re-derives each task's
 * status FROM its segment records. A recovery tool that mutates only the
 * task record is therefore silently undone on the next resume (#629: retry
 * reset the task to `pending`, the segment stayed `failed`, the wave was
 * counted as done and the batch no-op'd).
 *
 * These helpers keep segment authority intact by fixing the WRITERS: every
 * tool that changes a task's terminal status must change its segments too.
 * They are pure (mutate the passed state, return a summary) so they can be
 * unit-tested against fixture states.
 */

import type { PersistedBatchState, PersistedSegmentRecord } from "./types.ts";

export interface SegmentResetSummary {
	/** Segment IDs reset to pending */
	resetSegmentIds: string[];
	/** Segment IDs left untouched because they already succeeded/skipped */
	preservedSegmentIds: string[];
}

/**
 * Reset a task's failed/stalled segments to `pending` for re-execution.
 *
 * - Clears exit data (`startedAt`, `endedAt`, `exitDiagnostic`, `exitReason`).
 * - Increments `retries` (semantics: retry REQUESTS — see engine.ts spawn
 *   path, which only increments on restart when `startedAt !== null`, so a
 *   cleared `startedAt` does not double-count).
 * - KEEPS `laneId`, `sessionName`, `worktreePath`, `branch`: resume's
 *   re-execute path reuses the existing worktree so partial work survives.
 * - Succeeded/skipped segments are preserved (multi-segment tasks resume
 *   from the failed segment, not from scratch).
 * - Also clears the task's `activeSegmentId` so the frontier re-derives it.
 */
export function resetTaskSegmentsForRetry(
	state: PersistedBatchState,
	taskId: string,
): SegmentResetSummary {
	const summary: SegmentResetSummary = { resetSegmentIds: [], preservedSegmentIds: [] };
	for (const seg of state.segments ?? []) {
		if (seg.taskId !== taskId) continue;
		if (
			seg.status === "failed" ||
			seg.status === "stalled" ||
			seg.status === "running" ||
			seg.status === "skipped"
		) {
			// `running` is included defensively: a segment left `running` by a
			// dead engine that the operator then retries should re-execute, not
			// be reconstructed as in-flight forever. `skipped` is included so a
			// task wrongly skipped by a runtime defect (pause→skipped) re-executes;
			// an intentionally skipped task is only retried on explicit operator
			// request, which is what orch_retry_task is.
			seg.status = "pending";
			seg.startedAt = null;
			seg.endedAt = null;
			seg.exitDiagnostic = undefined;
			seg.exitReason = "";
			seg.retries = (seg.retries ?? 0) + 1;
			summary.resetSegmentIds.push(seg.segmentId);
		} else {
			summary.preservedSegmentIds.push(seg.segmentId);
		}
	}
	const task = state.tasks.find((t) => t.taskId === taskId);
	if (task) task.activeSegmentId = null;
	return summary;
}

/**
 * Mark a task's non-terminal-success segments as `skipped`.
 *
 * Today `reconstructSegmentFrontier` happens to preserve a task-level
 * `skipped` even when segments read `failed`; this makes the records agree
 * so the invariant does not rest on that accident. Succeeded segments stay
 * succeeded (their merged work is real).
 */
export function markTaskSegmentsSkipped(
	state: PersistedBatchState,
	taskId: string,
	endedAt: number = Date.now(),
): string[] {
	const skipped: string[] = [];
	for (const seg of state.segments ?? []) {
		if (seg.taskId !== taskId) continue;
		if (seg.status === "succeeded" || seg.status === "skipped") continue;
		seg.status = "skipped";
		seg.endedAt = seg.endedAt ?? endedAt;
		seg.exitReason = seg.exitReason || "Skipped by supervisor";
		skipped.push(seg.segmentId);
	}
	return skipped;
}

/**
 * Apply a re-execution outcome (resume's `re-execute` path, which runs the
 * task in its existing worktree) to the task's segment records.
 *
 * Resume copies `segments[]` into the runtime state but — before #629 — never
 * transitioned them when re-execution finished, so a successful retry could
 * persist `task=succeeded, segment=pending`; the next resume then normalized
 * the task back to pending and refused `.DONE` authority.
 *
 * SCOPE: re-execution builds its execution unit from the task's
 * `activeSegmentId`, i.e. it runs ONE segment (or the whole task for
 * single-segment/legacy tasks, `segmentId` null). Only that executed segment
 * may take the outcome; marking every pending segment succeeded would
 * silently skip downstream segments. When `executedSegmentId` is null, all
 * still-non-terminal segments are the whole task and take the status.
 * Already-terminal segments are never touched.
 */
export function applyReExecutionOutcomeToSegments(
	segments: PersistedSegmentRecord[] | undefined,
	taskId: string,
	status: "succeeded" | "failed",
	outcome: {
		startTime?: number | null;
		endTime?: number | null;
		exitReason?: string;
		exitDiagnostic?: PersistedSegmentRecord["exitDiagnostic"];
	},
	executedSegmentId: string | null = null,
	now: number = Date.now(),
): string[] {
	const updated: string[] = [];
	for (const seg of segments ?? []) {
		if (seg.taskId !== taskId) continue;
		if (executedSegmentId !== null && seg.segmentId !== executedSegmentId) continue;
		if (seg.status !== "pending" && seg.status !== "running") continue;
		seg.status = status;
		seg.startedAt = seg.startedAt ?? outcome.startTime ?? now;
		seg.endedAt = outcome.endTime ?? now;
		seg.exitReason =
			outcome.exitReason ??
			(status === "succeeded" ? "Re-executed task completed" : "Re-executed task failed");
		seg.exitDiagnostic = status === "failed" ? outcome.exitDiagnostic : undefined;
		updated.push(seg.segmentId);
	}
	return updated;
}

/**
 * After applying a segment outcome: is the TASK complete (every segment
 * terminal-success)? Drives whether resume may count a re-executed task as
 * completed. Tasks without segment records are complete iff the outcome was
 * a success (caller decides).
 */
export function taskSegmentsAllSucceeded(
	segments: PersistedSegmentRecord[] | undefined,
	taskId: string,
): boolean | null {
	const own = (segments ?? []).filter((s) => s.taskId === taskId);
	if (own.length === 0) return null;
	return own.every((s) => s.status === "succeeded" || s.status === "skipped");
}

/**
 * Advance a task's `activeSegmentId` to its next non-terminal segment (in
 * `segmentIds` order) after a segment outcome was applied. Returns the new
 * active segment id, or null when every segment is terminal. Without this, a
 * re-executed non-final segment left the task pointing at the segment that
 * just succeeded, so the next execution re-ran it and mistook that segment's
 * success for whole-task completion.
 */
export function advanceActiveSegment(state: PersistedBatchState, taskId: string): string | null {
	const task = state.tasks.find((t) => t.taskId === taskId);
	if (!task) return null;
	const order = task.segmentIds ?? [];
	const byId = new Map((state.segments ?? []).map((s) => [s.segmentId, s] as const));
	for (const id of order) {
		const seg = byId.get(id);
		const status = seg?.status ?? "pending";
		if (status === "pending" || status === "running") {
			task.activeSegmentId = id;
			return id;
		}
	}
	task.activeSegmentId = null;
	return null;
}

/** Convenience for tests/diagnostics: segment records belonging to a task. */
export function segmentsForTask(
	state: PersistedBatchState,
	taskId: string,
): PersistedSegmentRecord[] {
	return (state.segments ?? []).filter((s) => s.taskId === taskId);
}
