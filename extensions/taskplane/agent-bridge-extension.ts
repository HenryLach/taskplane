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
 *   - request_segment_expansion: request runtime segment expansion via file IPC
 *
 * This extension is intentionally minimal and protocol-focused.
 * It does NOT own:
 *   - wait_for_review (deferred to persistent reviewer work)
 *
 * File I/O only — writes to the agent's outbox directory.
 * The lane-runner or engine polls outbox and surfaces to supervisor.
 *
 * @module taskplane/agent-bridge-extension
 * @since TP-106
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@mariozechner/pi-ai";
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { spawn as nodeSpawn } from "child_process";
import { resolvePiCliPath, resolveTaskplaneAgentTemplate } from "./path-resolver.ts";
import { randomBytes } from "crypto";
import { buildExpansionRequestId, type SegmentExpansionRequest } from "./types.ts";

/**
 * Resolve the outbox directory from environment variables.
 *
 * The lane-runner sets TASKPLANE_OUTBOX_DIR when launching workers
 * with the bridge extension. Falls back to .pi/bridge-outbox/ in cwd.
 */
function resolveOutboxDir(): string {
	if (process.env.TASKPLANE_OUTBOX_DIR) return process.env.TASKPLANE_OUTBOX_DIR;

	const batchId = process.env.ORCH_BATCH_ID;
	const agentId = process.env.TASKPLANE_AGENT_ID;
	if (batchId && agentId) {
		return join(process.cwd(), ".pi", "mailbox", batchId, agentId, "outbox");
	}

	return join(process.cwd(), ".pi", "bridge-outbox");
}

/**
 * Write a message to the agent's outbox.
 */
function writeOutbox(type: "reply" | "escalate", content: string, replyTo?: string): { id: string } {
	const outboxDir = resolveOutboxDir();
	mkdirSync(outboxDir, { recursive: true });

	const contentBytes = Buffer.byteLength(content, "utf8");
	if (contentBytes > 4096) {
		throw new Error(`Outbox message exceeds 4096 bytes (${contentBytes})`);
	}

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

const REPO_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const AUTONOMY_PATTERN = /^(interactive|supervised|autonomous)$/;

function resolveActiveSegmentId(): string | null {
	const raw = (process.env.TASKPLANE_ACTIVE_SEGMENT_ID || process.env.TASKPLANE_SEGMENT_ID || "").trim();
	if (!raw || raw === "null" || raw === "(none / whole-task execution)") return null;
	return raw;
}

function resolveTaskId(fromSegmentId: string): string {
	const envTaskId = process.env.TASKPLANE_TASK_ID?.trim();
	if (envTaskId) return envTaskId;
	const idx = fromSegmentId.indexOf("::");
	if (idx > 0) return fromSegmentId.slice(0, idx);
	const folder = process.env.TASKPLANE_TASK_FOLDER || "";
	const name = folder.split(/[\\/]/).filter(Boolean).at(-1) || "";
	const match = name.match(/^[A-Z]+-\d+/);
	return match ? match[0] : "unknown";
}

function resolveSupervisorAutonomy(): "interactive" | "supervised" | "autonomous" {
	const value = (process.env.TASKPLANE_SUPERVISOR_AUTONOMY || "autonomous").trim().toLowerCase();
	if (AUTONOMY_PATTERN.test(value)) {
		return value as "interactive" | "supervised" | "autonomous";
	}
	return "autonomous";
}

function writeSegmentExpansionRequest(request: SegmentExpansionRequest): string {
	const outboxDir = resolveOutboxDir();
	mkdirSync(outboxDir, { recursive: true });

	const filename = `segment-expansion-${request.requestId}.json`;
	const finalPath = join(outboxDir, filename);
	const tempPath = `${finalPath}.tmp`;

	try {
		writeFileSync(tempPath, JSON.stringify(request, null, 2) + "\n", "utf-8");
		renameSync(tempPath, finalPath);
	} catch (err) {
		try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch { /* cleanup */ }
		throw new Error(`Failed to write segment expansion request: ${err instanceof Error ? err.message : String(err)}`);
	}

	return finalPath;
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

	const activeSegmentId = resolveActiveSegmentId();
	if (activeSegmentId) {
		/**
		 * Worker RPC for requesting runtime segment expansion.
		 *
		 * Contract summary:
		 * - accepts requested repo IDs + rationale (+ optional placement/edges)
		 * - validates request shape and repo ID rules
		 * - writes `.pi/mailbox/{batchId}/{agentId}/outbox/segment-expansion-{requestId}.json`
		 * - returns acknowledgment payload (`accepted`, `requestId`, `message`)
		 */
		pi.registerTool({
			name: "request_segment_expansion",
			label: "Request Segment Expansion",
			description:
				"Request additional repository segments for the current task at runtime. " +
				"Writes a request file to the worker outbox for engine processing.",
			promptSnippet:
				"request_segment_expansion(requestedRepoIds, rationale, placement?, edges?)",
			promptGuidelines: [
				"Use this when runtime discovery reveals additional repos are needed.",
				"Do not wait for approval; continue current segment work after requesting.",
				"requestedRepoIds must be non-empty, unique, and match /^[a-z0-9][a-z0-9._-]*$/.",
				"In supervised/interactive autonomy, this tool returns accepted: false (V1 guard).",
			],
			parameters: Type.Object({
				requestedRepoIds: Type.Array(Type.String({ description: "Repo ID to add" }), {
					description: "Repo IDs to add as new segments",
				}),
				rationale: Type.String({
					description: "Why these repos are needed",
				}),
				placement: Type.Optional(Type.Union([
					Type.Literal("after-current"),
					Type.Literal("end"),
				], {
					description: "Where to place new segments: after-current (default) or end",
				})),
				edges: Type.Optional(Type.Array(Type.Object({
					from: Type.String({ description: "Source repo ID" }),
					to: Type.String({ description: "Destination repo ID" }),
				}), {
					description: "Optional ordering edges between requested repos",
				})),
			}),
			async execute(_toolCallId, params) {
				const autonomy = resolveSupervisorAutonomy();
				if (autonomy !== "autonomous") {
					const rejected = {
						accepted: false,
						requestId: null,
						message: "Segment expansion requires autonomous supervisor mode",
					};
					return {
						content: [{ type: "text" as const, text: JSON.stringify(rejected) }],
						details: rejected,
					};
				}

				const requestedRepoIds = Array.isArray(params.requestedRepoIds)
					? params.requestedRepoIds.map((id) => String(id).trim()).filter(Boolean)
					: [];
				const rejections: Array<{ repoId: string; reason: string }> = [];

				if (requestedRepoIds.length === 0) {
					rejections.push({ repoId: "", reason: "requestedRepoIds must be a non-empty array" });
				} else {
					const seen = new Set<string>();
					for (const repoId of requestedRepoIds) {
						if (!REPO_ID_PATTERN.test(repoId)) {
							rejections.push({ repoId, reason: "invalid repo ID format" });
							continue;
						}
						if (seen.has(repoId)) {
							rejections.push({ repoId, reason: "duplicate repo ID in request" });
							continue;
						}
						seen.add(repoId);
					}
				}

				if (rejections.length > 0) {
					const rejected = {
						accepted: false,
						requestId: null,
						message: "Segment expansion request rejected by tool validation",
						rejections,
					};
					return {
						content: [{ type: "text" as const, text: JSON.stringify(rejected) }],
						details: rejected,
					};
				}

				const requestId = buildExpansionRequestId();
				const now = Date.now();
				const request: SegmentExpansionRequest = {
					requestId,
					taskId: resolveTaskId(activeSegmentId),
					fromSegmentId: activeSegmentId as SegmentExpansionRequest["fromSegmentId"],
					requestedRepoIds,
					rationale: String(params.rationale ?? "").trim(),
					placement: params.placement === "end" ? "end" : "after-current",
					edges: Array.isArray(params.edges)
						? params.edges
							.filter((edge): edge is { from: string; to: string } => Boolean(edge && typeof edge.from === "string" && typeof edge.to === "string"))
							.map((edge) => ({ from: edge.from.trim(), to: edge.to.trim() }))
							.filter((edge) => edge.from.length > 0 && edge.to.length > 0)
						: [],
					timestamp: now,
				};

				try {
					writeSegmentExpansionRequest(request);
					const accepted = {
						accepted: true,
						requestId,
						message: "Segment expansion request accepted",
					};
					return {
						content: [{ type: "text" as const, text: JSON.stringify(accepted) }],
						details: accepted,
					};
				} catch (err) {
					const failed = {
						accepted: false,
						requestId: null,
						message: err instanceof Error ? err.message : String(err),
					};
					return {
						content: [{ type: "text" as const, text: JSON.stringify(failed) }],
						details: failed,
					};
				}
			},
		});
	}

	// ── review_step Tool (TP-117) ─────────────────────────────────────
	// Spawns a reviewer subprocess to evaluate work at step boundaries.
	// The reviewer runs as a separate Pi process, writes feedback to
	// .reviews/, and this tool returns the verdict to the worker.



	/**
	 * Load the reviewer system prompt from base template + local override.
	 * Uses resolveTaskplaneAgentTemplate (path-resolver.ts) for all platform support (TP-157).
	 */
	function loadReviewerPrompt(): string {
		let basePrompt = "You are a code reviewer. Read the request and write your review to the specified output file.";
		try {
			const templatePath = resolveTaskplaneAgentTemplate("task-reviewer");
			if (existsSync(templatePath)) {
				const raw = readFileSync(templatePath, "utf-8");
				const fmEnd = raw.indexOf("---", 4);
				if (fmEnd > 0) basePrompt = raw.slice(fmEnd + 3).trim();
			}
		} catch { /* fall through to default */ }
		// Local override
		const localPaths = [join(process.cwd(), ".pi", "agents", "task-reviewer.md"), join(process.cwd(), "agents", "task-reviewer.md")];
		for (const p of localPaths) {
			try {
				if (!existsSync(p)) continue;
				const raw = readFileSync(p, "utf-8");
				const fmEnd = raw.indexOf("---", 4);
				if (fmEnd > 0) {
					const localBody = raw.slice(fmEnd + 3).trim();
					if (localBody) basePrompt += "\n\n---\n\n## Project-Specific Guidance\n\n" + localBody;
				}
				break;
			} catch { continue; }
		}
		return basePrompt;
	}

	function reviewerStatePath(taskFolder: string): string {
		return process.env.TASKPLANE_REVIEWER_STATE_PATH || join(taskFolder, ".reviewer-state.json");
	}

	function writeReviewerState(taskFolder: string, state: {
		status: "running" | "done" | "error";
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
		reviewType?: string;
		reviewStep?: number;
	}): void {
		const filePath = reviewerStatePath(taskFolder);
		const tmpPath = filePath + ".tmp";
		writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf-8");
		renameSync(tmpPath, filePath);
	}

	function removeReviewerState(taskFolder: string): void {
		const filePath = reviewerStatePath(taskFolder);
		if (!existsSync(filePath)) return;
		try { unlinkSync(filePath); } catch { /* best effort */ }
	}

	/**
	 * Spawn a reviewer Pi subprocess and wait for it to complete.
	 * Returns the process exit code.
	 */
	function spawnReviewer(prompt: string, systemPrompt: string, cwd: string, taskFolder: string, reviewType?: string, reviewStep?: number): Promise<number> {
		// Pre-clean stale reviewer state from prior interrupted review
		removeReviewerState(taskFolder);
		return new Promise((resolve) => {
			// Read reviewer config from env vars set by lane-runner from runnerConfig.reviewer.
			// Empty string means inherit from session default (no flag passed to pi CLI).
			const reviewerModel = process.env.TASKPLANE_REVIEWER_MODEL || "";
			const reviewerThinking = process.env.TASKPLANE_REVIEWER_THINKING || "";
			// Fall back to the schema default reviewer tool list (read-only + bash/grep).
			// Must match config-schema.ts reviewer.tools default to avoid capability expansion.
			const reviewerTools = process.env.TASKPLANE_REVIEWER_TOOLS || "read,bash,grep,find,ls";

			const cliPath = resolvePiCliPath();
			const args = [
				cliPath, "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills",
				"--tools", reviewerTools,
				"--system-prompt", systemPrompt,
			];
			if (reviewerModel) args.push("--model", reviewerModel);
			if (reviewerThinking) args.push("--thinking", reviewerThinking);
			const proc = nodeSpawn(process.execPath, args, {
				shell: false,
				cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env },
			});

			const startedAt = Date.now();
			let inputTokens = 0;
			let outputTokens = 0;
			let cacheReadTokens = 0;
			let cacheWriteTokens = 0;
			let costUsd = 0;
			let toolCalls = 0;
			let lastTool = "";
			let contextPct = 0;
			let stdoutBuf = "";
			let finalized = false;

			const emitState = (status: "running" | "done" | "error") => {
				try {
					writeReviewerState(taskFolder, {
						status,
						elapsedMs: Date.now() - startedAt,
						toolCalls,
						contextPct,
						costUsd,
						lastTool,
						inputTokens,
						outputTokens,
						cacheReadTokens,
						cacheWriteTokens,
						updatedAt: Date.now(),
						reviewType,
						reviewStep,
					});
				} catch { /* best effort */ }
			};

			// Write initial "running" state immediately so dashboard shows
			// the reviewer sub-row before the first message_end arrives.
			emitState("running");

			const closeStdin = () => {
				setTimeout(() => {
					try { proc.stdin?.end(); } catch { /* ignore */ }
				}, 100);
			};

			const finalize = (code: number) => {
				if (finalized) return;
				finalized = true;
				emitState(code === 0 ? "done" : "error");
				resolve(code);
			};

			const handleEvent = (event: any) => {
				if (!event || typeof event.type !== "string") return;
				switch (event.type) {
					case "message_end": {
						const usage = event.message?.usage;
						if (usage) {
							inputTokens += usage.input || 0;
							outputTokens += usage.output || 0;
							cacheReadTokens += usage.cacheRead || 0;
							cacheWriteTokens += usage.cacheWrite || 0;
							if (usage.cost) {
								costUsd += typeof usage.cost === "object"
									? (usage.cost.total || 0)
									: (typeof usage.cost === "number" ? usage.cost : 0);
							}
						}
						emitState("running");
						break;
					}
					case "tool_execution_start": {
						toolCalls++;
						const toolName = event.toolName || "tool";
						const argPreview = typeof event.args === "string"
							? event.args.slice(0, 80)
							: (event.args && typeof Object.values(event.args)[0] === "string"
								? String(Object.values(event.args)[0]).slice(0, 80)
								: "");
						lastTool = argPreview ? `${toolName}: ${argPreview}` : toolName;
						emitState("running");
						break;
					}
					case "response": {
						const pct = event.success === true ? event.data?.contextUsage?.percent : undefined;
						if (typeof pct === "number" && Number.isFinite(pct)) {
							contextPct = pct;
						}
						break;
					}
					case "agent_end": {
						closeStdin();
						break;
					}
				}
			};

			// Send prompt immediately
			proc.stdin?.write(JSON.stringify({ type: "prompt", message: prompt }) + "\n");

			proc.stdout?.on("data", (chunk: Buffer | string) => {
				stdoutBuf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
				let idx = -1;
				while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
					let line = stdoutBuf.slice(0, idx);
					stdoutBuf = stdoutBuf.slice(idx + 1);
					if (line.endsWith("\r")) line = line.slice(0, -1);
					if (!line.trim()) continue;
					let event: any;
					try { event = JSON.parse(line); } catch { continue; }
					handleEvent(event);
				}
			});

			proc.on("close", (code) => finalize(code ?? 1));
			proc.on("error", () => finalize(1));

			// Timeout: 10 minutes
			setTimeout(() => {
				try { proc.kill("SIGTERM"); } catch { /* ignore */ }
			}, 10 * 60 * 1000);
		});
	}

	pi.registerTool({
		name: "review_step",
		label: "Review Step",
		description:
			"Spawn a reviewer agent to evaluate your work on a step. " +
			"Returns APPROVE, REVISE, RETHINK, or UNAVAILABLE. " +
			"Use at step boundaries based on the task's review level.",
		promptSnippet: "review_step(step, type, baseline?) — spawn reviewer for a step",
		promptGuidelines: [
			"Call review_step at step boundaries based on the task's Review Level (from STATUS.md header).",
			"Review Level 0: skip all reviews. Level 1: plan review. Level 2: plan + code review. Level 3: plan + code + test.",
			"Skip reviews for Step 0 (Preflight) and the final documentation step.",
			"For code reviews: capture HEAD commit before starting a step with `git rev-parse HEAD` and pass as baseline.",
			"On REVISE: read the review file in .reviews/ for feedback, fix issues, then proceed.",
			"On RETHINK: reconsider your approach.",
		],
		parameters: Type.Object({
			step: Type.Number({ description: "Step number to review" }),
			type: Type.Union(
				[Type.Literal("plan"), Type.Literal("code")],
				{ description: 'Review type: "plan" or "code"' },
			),
			baseline: Type.Optional(Type.String({
				description: "Git commit SHA for code review diff baseline",
			})),
		}),
		async execute(_toolCallId, params) {
			const { step: stepNum, type: reviewType, baseline } = params;
			const cwd = process.cwd();

			// Find task folder and paths
			const taskFolder = process.env.TASKPLANE_TASK_FOLDER || cwd;
			const statusPath = process.env.TASKPLANE_STATUS_PATH || join(taskFolder, "STATUS.md");
			const promptPath = process.env.TASKPLANE_PROMPT_PATH || join(taskFolder, "PROMPT.md");
			const reviewsDir = process.env.TASKPLANE_REVIEWS_DIR || join(taskFolder, ".reviews");
			if (!existsSync(reviewsDir)) mkdirSync(reviewsDir, { recursive: true });

			// Read review counter from STATUS.md
			let reviewCounter = 0;
			try {
				const statusContent = readFileSync(statusPath, "utf-8");
				const rcMatch = statusContent.match(/\*\*Review Counter:\*\*\s*(\d+)/);
				if (rcMatch) reviewCounter = parseInt(rcMatch[1]);
			} catch { /* default 0 */ }

			reviewCounter++;
			const num = String(reviewCounter).padStart(3, "0");
			const outputPath = join(reviewsDir, `R${num}-${reviewType}-step${stepNum}.md`);

			// Find step name from PROMPT.md
			let stepName = `Step ${stepNum}`;
			try {
				const promptFiles = [join(taskFolder, "PROMPT.md")];
				for (const pf of promptFiles) {
					if (!existsSync(pf)) continue;
					const content = readFileSync(pf, "utf-8");
					const stepMatch = content.match(new RegExp(`###\\s+Step\\s+${stepNum}[:\\s]+(.+)`));
					if (stepMatch) { stepName = stepMatch[1].trim(); break; }
				}
			} catch { /* use default */ }

			// Generate review request prompt
			const projectName = process.env.TASKPLANE_PROJECT_NAME || "project";
			const diffCmd = baseline ? `git diff ${baseline}..HEAD` : `git diff`;
			const diffNamesCmd = baseline ? `git diff ${baseline}..HEAD --name-only` : `git diff --name-only`;

			let reviewPrompt: string;
			if (reviewType === "plan") {
				reviewPrompt = [
					`# Review Request: Plan Review`,
					``,
					`You are reviewing an implementation plan for a ${projectName} task.`,
					`You have full tool access — use \`read\` to examine files and \`bash\` to run commands.`,
					``,
					`## Task Context`,
					`- **Task PROMPT:** ${promptPath}`,
					`- **Task STATUS:** ${statusPath}`,
					`- **Step being planned:** Step ${stepNum}: ${stepName}`,
					``,
					`## Instructions`,
					`1. Read the PROMPT.md for full requirements`,
					`2. Read STATUS.md for progress so far`,
					`3. Evaluate the plan for this step`,
					``,
					`## Output`,
					`Write your review to: \`${outputPath}\``,
				].join("\n");
			} else {
				reviewPrompt = [
					`# Review Request: Code Review`,
					``,
					`You are reviewing code changes for a ${projectName} task.`,
					`You have full tool access — use \`read\` to examine files and \`bash\` to run commands.`,
					``,
					`## Task Context`,
					`- **Task PROMPT:** ${promptPath}`,
					`- **Task STATUS:** ${statusPath}`,
					`- **Step reviewed:** Step ${stepNum}: ${stepName}`,
					...(baseline ? [`- **Baseline commit:** ${baseline}`] : []),
					``,
					`## Instructions`,
					`1. Run \`${diffNamesCmd}\` to see changed files`,
					`2. Run \`${diffCmd}\` for the full diff`,
					`3. Read changed files for context`,
					``,
					`## Output`,
					`Write your review to: \`${outputPath}\``,
				].join("\n");
			}

			try {
				const systemPrompt = loadReviewerPrompt();
				const exitCode = await spawnReviewer(reviewPrompt, systemPrompt, cwd, taskFolder, reviewType, stepNum);

				// Update review counter in STATUS.md
				try {
					const status = readFileSync(statusPath, "utf-8");
					const updated = status.replace(/\*\*Review Counter:\*\*\s*\d+/, `**Review Counter:** ${reviewCounter}`);
					writeFileSync(statusPath, updated);
				} catch { /* best effort */ }

				// Read review output and extract verdict
				if (existsSync(outputPath)) {
					const reviewContent = readFileSync(outputPath, "utf-8");
					const verdictMatch = reviewContent.match(/###?\s*Verdict[:\s]*(APPROVE|REVISE|RETHINK)/i);
					let verdict = verdictMatch ? verdictMatch[1].toUpperCase() : "UNKNOWN";
					if (verdict === "UNKNOWN") {
						const lower = reviewContent.toLowerCase();
						if (lower.includes("approve") && !lower.includes("do not approve")) verdict = "APPROVE";
						else if (lower.includes("revise") || lower.includes("changes requested")) verdict = "REVISE";
						else if (lower.includes("rethink")) verdict = "RETHINK";
					}

					// Log review in STATUS.md execution log
					try {
						const status = readFileSync(statusPath, "utf-8");
						const logEntry = `| ${new Date().toISOString().slice(0, 16).replace("T", " ")} | Review R${num} | ${reviewType} Step ${stepNum}: ${verdict} |\n`;
						writeFileSync(statusPath, status.trimEnd() + "\n" + logEntry);
					} catch { /* best effort */ }

					removeReviewerState(taskFolder);

					const reviewFile = `.reviews/R${num}-${reviewType}-step${stepNum}.md`;
					if (verdict === "APPROVE") {
						return { content: [{ type: "text" as const, text: `APPROVE` }], details: undefined };
					} else if (verdict === "REVISE") {
						const summaryMatch = reviewContent.match(/###?\s*Summary[:\s]*([\s\S]*?)(?=###|$)/i);
						const details = summaryMatch ? summaryMatch[1].trim().slice(0, 500) : "See review file.";
						return { content: [{ type: "text" as const, text: `REVISE: ${details}\n\nFull review: ${reviewFile}` }], details: undefined };
					} else if (verdict === "RETHINK") {
						return { content: [{ type: "text" as const, text: `RETHINK — reconsider approach. See ${reviewFile}` }], details: undefined };
					} else {
						return { content: [{ type: "text" as const, text: `Review complete (verdict unclear). See ${reviewFile}` }], details: undefined };
					}
				} else {
					removeReviewerState(taskFolder);
					return { content: [{ type: "text" as const, text: `UNAVAILABLE — reviewer exited (code ${exitCode}) but produced no output.` }], details: undefined };
				}
			} catch (err) {
				removeReviewerState(taskFolder);
				return {
					content: [{ type: "text" as const, text: `UNAVAILABLE — reviewer failed: ${err instanceof Error ? err.message : String(err)}` }],
					details: undefined,
				};
			}
		},
	});
}
