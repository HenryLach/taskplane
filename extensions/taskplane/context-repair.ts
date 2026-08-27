/**
 * In-flight tool_use/tool_result ordering repair — issue #621 (defense in depth).
 *
 * The supervisor injects `custom` display messages via pi.sendMessage(). Any
 * such injection that lands while the interactive agent has a tool call in
 * flight splices a message BETWEEN an assistant `tool_use` and its
 * `toolResult`. Anthropic then rejects the request:
 *
 *   400 messages.N.content.M: unexpected `tool_use_id` found in `tool_result`
 *   blocks ... Each `tool_result` block must have a corresponding `tool_use`
 *   block in the previous message.
 *
 * The batch-end epilogue gate (supervisor-dispatch.ts) prevents the most common
 * source, but the supervisor has many other background `pi.sendMessage(...,
 * {triggerTurn:false})` sites (integration progress/result, heartbeat, routing)
 * that can splice the same way. Rather than gate each one, this module repairs
 * the ORDERING of the outgoing message array on the pi `context` event, which
 * fires before every provider request (`transformContext`, on the pi-internal
 * AgentMessage[] before convertToLlm). Each assistant's tool results are pulled
 * to immediately follow it (in tool-call order); any spliced-in `custom`/`user`
 * messages move to after the tool-result group. The request is therefore always
 * valid regardless of where a stray message was appended, and a mistimed
 * injection can never wedge the session.
 *
 * This does not mutate the persisted session tree — it only transforms the
 * per-request context — so it is safe, idempotent, and self-correcting across
 * reloads.
 */

interface ToolCallBlock {
	type: string;
	id?: string;
	[key: string]: unknown;
}
interface AgentMessageLike {
	role?: string;
	content?: unknown;
	toolCallId?: string;
	[key: string]: unknown;
}

function toolUseIds(msg: AgentMessageLike): string[] {
	if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return [];
	const ids: string[] = [];
	for (const block of msg.content as ToolCallBlock[]) {
		if (
			block &&
			typeof block === "object" &&
			block.type === "toolCall" &&
			typeof block.id === "string"
		) {
			ids.push(block.id);
		}
	}
	return ids;
}

/**
 * Reorder `messages` so every assistant `tool_use` is immediately followed by
 * its matching `toolResult`(s), relocating any spliced-in non-tool messages to
 * after the tool-result group.
 *
 * Robustness (Sage #621 review):
 * - Duplicate `toolResult` messages sharing a `toolCallId` are all preserved
 *   (queue-based grouping, not last-wins), so repair never drops data.
 * - Emitted results are tracked by message identity, not by id.
 * - Also repairs the result-before-assistant shape: a `toolResult` whose owning
 *   assistant appears later is held and pulled forward at the owner.
 * - A final safety-net pass appends any never-emitted result, guaranteeing no
 *   `toolResult` is ever lost regardless of input malformation.
 *
 * Returns the SAME array reference when already well-formed (no reordering
 * needed), so callers can cheaply detect a no-op. Otherwise returns a new,
 * reordered array. Pure: never mutates the input array or its elements.
 */
export function repairToolResultOrdering<T extends AgentMessageLike>(messages: T[]): T[] {
	if (!Array.isArray(messages) || messages.length < 3) return messages;

	// Collect ALL toolResult messages per toolCallId, preserving original order.
	// A queue (array) rather than last-wins so duplicate results for the same id
	// are never dropped (Sage #621 review: last-wins could silently lose data).
	const resultsById = new Map<string, T[]>();
	for (const m of messages) {
		if (m && m.role === "toolResult" && typeof m.toolCallId === "string") {
			const list = resultsById.get(m.toolCallId);
			if (list) list.push(m);
			else resultsById.set(m.toolCallId, [m]);
		}
	}
	if (resultsById.size === 0) return messages;

	// First-occurrence index of the assistant that owns each toolCallId. Lets us
	// HOLD an in-place toolResult whose owning assistant appears LATER, repairing
	// the result-before-assistant shape (Sage #621 review) instead of emitting it
	// in a position that would still be invalid.
	const ownerIndexById = new Map<string, number>();
	for (let i = 0; i < messages.length; i++) {
		for (const id of toolUseIds(messages[i])) {
			if (!ownerIndexById.has(id)) ownerIndexById.set(id, i);
		}
	}

	const out: T[] = [];
	// Track emitted results by message IDENTITY, not by id, so duplicate result
	// messages sharing a toolCallId are each accounted for individually.
	const emitted = new Set<T>();

	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (m && m.role === "toolResult" && typeof m.toolCallId === "string") {
			if (emitted.has(m)) continue; // already pulled forward next to its assistant
			const owner = ownerIndexById.get(m.toolCallId);
			// Owner appears later → hold; it will be pulled forward at the owner.
			// Owner earlier (normal splice case) or orphan (no owner) → emit in place.
			if (owner !== undefined && owner > i) continue;
			out.push(m);
			emitted.add(m);
			continue;
		}

		out.push(m);

		// Pull every matching toolResult (all of them, in original order) to
		// immediately follow this assistant, in tool-call order.
		for (const id of toolUseIds(m)) {
			const list = resultsById.get(id);
			if (!list) continue; // genuinely unanswered tool_use — not repairable here
			for (const result of list) {
				if (emitted.has(result)) continue;
				out.push(result);
				emitted.add(result);
			}
		}
	}

	// Safety net: guarantee no toolResult is ever dropped. Any result not emitted
	// above (only reachable via a held-but-never-pulled edge case) is appended in
	// original order. Guarded by identity so it can never double-emit.
	for (const m of messages) {
		if (m && m.role === "toolResult" && typeof m.toolCallId === "string" && !emitted.has(m)) {
			out.push(m);
			emitted.add(m);
		}
	}

	// Return the original reference when nothing moved (cheap no-op detection).
	if (out.length === messages.length) {
		let identical = true;
		for (let i = 0; i < out.length; i++) {
			if (out[i] !== messages[i]) {
				identical = false;
				break;
			}
		}
		if (identical) return messages;
	}
	return out;
}
