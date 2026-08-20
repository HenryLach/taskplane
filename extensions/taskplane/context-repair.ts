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
	if (msg.role !== "assistant" || !Array.isArray(msg.content)) return [];
	const ids: string[] = [];
	for (const block of msg.content as ToolCallBlock[]) {
		if (block && typeof block === "object" && block.type === "toolCall" && typeof block.id === "string") {
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
 * Returns the SAME array reference when already well-formed (no reordering
 * needed), so callers can cheaply detect a no-op. Otherwise returns a new,
 * reordered array. Pure: never mutates the input array or its elements.
 */
export function repairToolResultOrdering<T extends AgentMessageLike>(messages: T[]): T[] {
	if (!Array.isArray(messages) || messages.length < 3) return messages;

	// Map each toolCallId -> its toolResult message (last one wins if duplicated).
	const resultById = new Map<string, T>();
	for (const m of messages) {
		if (m && m.role === "toolResult" && typeof m.toolCallId === "string") {
			resultById.set(m.toolCallId, m);
		}
	}
	if (resultById.size === 0) return messages;

	const out: T[] = [];
	const emitted = new Set<string>();

	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (m && m.role === "toolResult" && typeof m.toolCallId === "string") {
			// Emit here only if not already pulled forward next to its assistant;
			// otherwise skip (its original, now-misplaced slot is dropped).
			if (!emitted.has(m.toolCallId)) {
				out.push(m);
				emitted.add(m.toolCallId);
			}
			continue;
		}

		out.push(m);

		// Pull each matching toolResult to immediately follow this assistant, in
		// tool-call order.
		for (const id of toolUseIds(m)) {
			if (emitted.has(id)) continue;
			const result = resultById.get(id);
			if (!result) continue; // genuinely unanswered tool_use — not repairable here
			out.push(result);
			emitted.add(id);
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
