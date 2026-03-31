/**
 * Agent Bridge Extension — Minimal agent-side tools for Runtime V2
 *
 * Loaded into worker/reviewer/merger Pi agent processes to provide
 * structured communication back to the supervisor and lane-runner
 * without requiring agents to hand-roll JSON via bash/write.
 *
 * Tools:
 *   - notify_supervisor: send a reply or acknowledgment to supervisor
 *   - escalate_to_supervisor: escalate a blocker or ambiguity
 *
 * This extension is intentionally minimal and protocol-focused.
 * It does NOT own:
 *   - review_step (deferred to TP-105+ lane-runner bridge work)
 *   - wait_for_review (deferred to persistent reviewer work)
 *   - request_segment_expansion (deferred to TP-086)
 *
 * File I/O only — writes to the agent's outbox directory.
 * The lane-runner or engine polls outbox and surfaces to supervisor.
 *
 * @module taskplane/agent-bridge-extension
 * @since TP-106
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";
import { writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { join, dirname } from "path";
import { randomBytes } from "crypto";

/**
 * Resolve the outbox directory from environment variables.
 *
 * The lane-runner sets TASKPLANE_OUTBOX_DIR when launching workers
 * with the bridge extension. Falls back to .pi/bridge-outbox/ in cwd.
 */
function resolveOutboxDir(): string {
	return process.env.TASKPLANE_OUTBOX_DIR || join(process.cwd(), ".pi", "bridge-outbox");
}

/**
 * Write a message to the agent's outbox.
 */
function writeOutbox(type: "reply" | "escalate", content: string, replyTo?: string): { id: string } {
	const outboxDir = resolveOutboxDir();
	mkdirSync(outboxDir, { recursive: true });

	const timestamp = Date.now();
	const nonce = randomBytes(3).toString("hex").slice(0, 5);
	const id = `${timestamp}-${nonce}`;

	const message = {
		id,
		batchId: process.env.ORCH_BATCH_ID || "unknown",
		from: process.env.TASKPLANE_AGENT_ID || "agent",
		to: "supervisor",
		timestamp,
		type,
		content,
		expectsReply: type === "escalate",
		replyTo: replyTo || null,
	};

	const tmpPath = join(outboxDir, `${id}.msg.json.tmp`);
	const finalPath = join(outboxDir, `${id}.msg.json`);
	writeFileSync(tmpPath, JSON.stringify(message, null, 2) + "\n", "utf-8");
	renameSync(tmpPath, finalPath);

	return { id };
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "notify_supervisor",
		label: "Notify Supervisor",
		description:
			"Send a reply or acknowledgment to the supervisor. " +
			"Use this to confirm you've received a steering message, " +
			"report a status update, or share a discovery.",
		promptSnippet: "notify_supervisor(content, replyTo?) — send reply to supervisor",
		promptGuidelines: [
			"Use notify_supervisor to acknowledge steering messages or share status updates.",
			"Keep content concise (max 4KB).",
			"Include replyTo with the message ID you're responding to, if applicable.",
		],
		parameters: Type.Object({
			content: Type.String({
				description: "Reply content (max 4KB)",
			}),
			replyTo: Type.Optional(Type.String({
				description: "Message ID being replied to (from a steering message)",
			})),
		}),
		async execute(_toolCallId, params) {
			try {
				const result = writeOutbox("reply", params.content, params.replyTo);
				return {
					content: [{
						type: "text" as const,
						text: `✅ Reply sent to supervisor (ID: ${result.id})`,
					}],
					details: undefined,
				};
			} catch (err) {
				return {
					content: [{
						type: "text" as const,
						text: `❌ Failed to send reply: ${err instanceof Error ? err.message : String(err)}`,
					}],
					details: undefined,
				};
			}
		},
	});

	pi.registerTool({
		name: "escalate_to_supervisor",
		label: "Escalate to Supervisor",
		description:
			"Escalate a blocker, ambiguity, or question to the supervisor. " +
			"Use this when you're stuck, confused, or need guidance before proceeding.",
		promptSnippet: "escalate_to_supervisor(content) — escalate blocker to supervisor",
		promptGuidelines: [
			"Use escalate_to_supervisor when you're blocked and need human/supervisor guidance.",
			"Clearly describe what you're stuck on and what options you see.",
			"The supervisor will respond via a steering message.",
		],
		parameters: Type.Object({
			content: Type.String({
				description: "Description of the blocker or question (max 4KB)",
			}),
		}),
		async execute(_toolCallId, params) {
			try {
				const result = writeOutbox("escalate", params.content);
				return {
					content: [{
						type: "text" as const,
						text: `⚠️ Escalation sent to supervisor (ID: ${result.id}). Continue working on other items while waiting for guidance.`,
					}],
					details: undefined,
				};
			} catch (err) {
				return {
					content: [{
						type: "text" as const,
						text: `❌ Failed to escalate: ${err instanceof Error ? err.message : String(err)}`,
					}],
					details: undefined,
				};
			}
		},
	});
}
