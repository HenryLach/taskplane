/**
 * Persistent Reviewer Extension — TP-057
 *
 * Provides the `wait_for_review` tool that enables a reviewer agent to stay
 * alive across multiple review requests within a single task. The tool blocks
 * (via filesystem polling) until the task-runner signals a new review request
 * or shutdown.
 *
 * Signal protocol:
 *   - `.reviews/.review-signal-{NNN}` — new review request available
 *   - `.reviews/.review-shutdown` — reviewer should exit cleanly
 *   - `.reviews/request-R{NNN}.md` — review request content
 *
 * Environment:
 *   - REVIEWER_SIGNAL_DIR — path to .reviews/ directory (required)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
	REVIEWER_POLL_INTERVAL_MS,
	REVIEWER_WAIT_TIMEOUT_MS,
	REVIEWER_SHUTDOWN_SIGNAL,
	REVIEWER_SIGNAL_PREFIX,
} from "./taskplane/types.js";

// ── Extension ────────────────────────────────────────────────────────

export default function reviewerExtension(pi: ExtensionAPI) {
	const signalDir = process.env.REVIEWER_SIGNAL_DIR;

	if (!signalDir) {
		// Not running in persistent reviewer mode — skip tool registration.
		// This allows the extension to be loaded in non-persistent contexts
		// without error (fallback fresh-spawn mode).
		return;
	}

	/** Counter tracking which signal number to watch for next. */
	let nextSignalNum = 1;

	pi.registerTool({
		name: "wait_for_review",
		label: "Wait for Review",
		description:
			"Block until the next review request is available, then return its content. " +
			"Call this after completing each review to wait for the next one. " +
			"Returns 'SHUTDOWN' when the task is complete and you should exit.",
		promptSnippet: "wait_for_review() — block until the next review request arrives (persistent reviewer mode)",
		promptGuidelines: [
			"Call wait_for_review() to receive each review request.",
			"After writing your review to the specified output file, call wait_for_review() again.",
			"When it returns 'SHUTDOWN', exit cleanly — the task is complete.",
			"Reference your previous reviews when relevant (e.g., 'I flagged X in Step 1 — checking if addressed').",
		],
		parameters: Type.Object({}),
		async execute() {
			const startTime = Date.now();
			const signalNum = String(nextSignalNum).padStart(3, "0");
			const signalPath = join(signalDir, `${REVIEWER_SIGNAL_PREFIX}${signalNum}`);
			const shutdownPath = join(signalDir, REVIEWER_SHUTDOWN_SIGNAL);

			// Poll for signal file or shutdown
			while (true) {
				// Check for shutdown signal first
				if (existsSync(shutdownPath)) {
					return {
						content: [{ type: "text" as const, text: "SHUTDOWN — The task is complete. Exit cleanly." }],
						details: undefined,
					};
				}

				// Check for review signal
				if (existsSync(signalPath)) {
					// Signal found — read the request file path from signal content.
					// Signal file content is the request filename (e.g., "request-R003.md").
					const signalContent = readFileSync(signalPath, "utf-8").trim();
					const requestPath = join(signalDir, signalContent);

					if (!existsSync(requestPath)) {
						// Signal fired but request file doesn't exist (race condition or error)
						return {
							content: [{
								type: "text" as const,
								text: `ERROR — Signal file ${REVIEWER_SIGNAL_PREFIX}${signalNum} found but ` +
									`${signalContent} does not exist. Waiting for next signal.`,
							}],
							details: undefined,
						};
					}

					const requestContent = readFileSync(requestPath, "utf-8");
					nextSignalNum++;

					return {
						content: [{ type: "text" as const, text: requestContent }],
						details: undefined,
					};
				}

				// Check timeout
				if (Date.now() - startTime > REVIEWER_WAIT_TIMEOUT_MS) {
					return {
						content: [{
							type: "text" as const,
							text: "TIMEOUT — No review request received within the timeout period. Exit cleanly.",
						}],
						details: undefined,
					};
				}

				// Wait before next poll
				await new Promise(resolve => setTimeout(resolve, REVIEWER_POLL_INTERVAL_MS));
			}
		},
	});
}
