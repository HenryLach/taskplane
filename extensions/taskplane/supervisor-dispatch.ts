/**
 * Batch-end epilogue gate — issue #621.
 *
 * PROBLEM
 * -------
 * The supervisor's batch-end epilogue appends display banners to the session via
 * `pi.sendMessage(msg, { triggerTurn: false })`. In pi's `sendCustomMessage`,
 * `{ triggerTurn: false }` always takes the branch that IMMEDIATELY appends a
 * `custom` entry to the session tree at the current leaf — even while the
 * interactive agent is streaming. If the agent has a tool call in flight (an
 * assistant `tool_use` has been appended but its `tool_result` has not yet
 * landed), that append splices a user-role `custom` message BETWEEN the
 * `tool_use` and its `tool_result`. On the next request Anthropic rejects the
 * conversation with a 400 ("`tool_result` ... must have a corresponding
 * `tool_use` block in the previous message"), permanently wedging the session.
 *
 * FIX
 * ---
 * Run the epilogue immediately when the agent is idle (the leaf is a terminal
 * message, so an append is safe and the banner renders now). Otherwise defer it
 * to the next `agent_settled` boundary — the first lifecycle point at which all
 * tool results, retries, compaction, and queued continuations have finished, so
 * an append can no longer split a `tool_use`/`tool_result` pair.
 *
 * Notes:
 * - `deliverAs: "nextTurn"` is NOT usable here: it pushes into the next turn's
 *   in-memory context only, without persisting the entry or emitting
 *   message_start/end, so display banners would be silently dropped.
 * - The gate is session-scoped (constructed inside the extension factory), holds
 *   only a plain closure + a generation tag (no captured `ctx`), and is
 *   invalidated by a newer batch or by session shutdown.
 */

/**
 * Gates the supervisor batch-end epilogue on interactive-agent idleness so its
 * display banners can never be appended between a `tool_use` and its
 * `tool_result` (#621).
 */
export class SupervisorNoticeGate {
	private pending: (() => void) | null = null;
	private pendingGeneration = -1;
	private active = true;

	/**
	 * Run `epilogue` now when `idle`, otherwise defer it to the next settle.
	 *
	 * @param idle       Current `ctx.isIdle()` at the batch-end callback.
	 * @param generation Monotonic batch counter; tags the deferred work so a
	 *                   newer batch can invalidate a stale pending epilogue.
	 * @param epilogue   Side-effecting closure that performs the batch-end sends
	 *                   (integration-skipped banner, batch summary, routing
	 *                   transition). Must be safe to run at a settle boundary.
	 */
	runOrDefer(idle: boolean, generation: number, epilogue: () => void): void {
		if (!this.active) return;
		if (idle) {
			epilogue();
			return;
		}
		// Coalesce: keep only the most recent epilogue for the latest generation.
		this.pending = epilogue;
		this.pendingGeneration = generation;
	}

	/**
	 * Flush a deferred epilogue at an `agent_settled` boundary.
	 *
	 * Re-checks idleness (another extension may have started a run from its own
	 * settle handler) and the generation (a newer batch supersedes it).
	 */
	onSettled(idle: boolean, generation: number): void {
		if (!this.active) return;
		if (!this.pending) return;
		if (!idle) return;
		if (this.pendingGeneration !== generation) {
			// A newer batch superseded this epilogue — drop it.
			this.pending = null;
			this.pendingGeneration = -1;
			return;
		}
		const epilogue = this.pending;
		this.pending = null;
		this.pendingGeneration = -1;
		epilogue();
	}

	/** Drop any deferred epilogue (a newer batch supersedes it). */
	invalidate(): void {
		this.pending = null;
		this.pendingGeneration = -1;
	}

	/** Permanently disable the gate and drop pending work (session shutdown). */
	dispose(): void {
		this.active = false;
		this.invalidate();
	}

	/** Test/inspection helper: whether an epilogue is currently deferred. */
	hasPending(): boolean {
		return this.pending !== null;
	}
}
