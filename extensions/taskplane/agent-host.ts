/**
 * Agent Host — Direct-child Pi agent hosting for Runtime V2
 *
 * Spawns `pi --mode rpc` as a direct child process (no terminal multiplexer, no shell),
 * parses RPC JSONL events, normalizes them into RuntimeAgentEvents,
 * manages mailbox delivery, and produces exit summaries.
 *
 * This replaces the legacy terminal-session hosting path with
 * a programmatic parent-child model where the caller has full process
 * ownership.
 *
 * Key differences from the legacy path:
 *   1. No terminal-session backend — `spawn()` with `shell: false`
 *   2. No sidecar tailing — events flow directly to the caller via callbacks
 *   3. No PID-file orphan guessing — caller owns the process handle
 *   4. Registry integration — manifests updated on status transitions
 *   5. Pi CLI resolved to JS entrypoint, not .CMD shim
 *
 * @module taskplane/agent-host
 * @since TP-104
 */

import { spawn, type ChildProcess } from "child_process";
import {
	readFileSync, writeFileSync, appendFileSync, mkdirSync,
	existsSync, readdirSync, renameSync,
} from "fs";
import { join, dirname, basename, resolve } from "path";
import { StringDecoder } from "string_decoder";

import type {
	RuntimeAgentId,
	RuntimeAgentRole,
	RuntimeAgentEvent,
	RuntimeAgentEventType,
	RuntimeAgentManifest,
	PacketPaths,
} from "./types.ts";

import {
	createManifest,
	writeManifest,
	updateManifestStatus,
	buildRegistrySnapshot,
	writeRegistrySnapshot,
} from "./process-registry.ts";
import { appendMailboxAuditEvent } from "./mailbox.ts";

// ── Pi CLI Resolution ────────────────────────────────────────────────

/**
 * Resolve the Pi CLI JS entrypoint for direct spawning.
 *
 * On Windows, `pi` resolves to a .CMD shim which cannot be spawned
 * with `shell: false`. This function resolves the underlying JS file.
 *
 * Resolution order:
 *   1. APPDATA/npm/node_modules/@mariozechner/pi-coding-agent/dist/cli.js
 *   2. HOME/.npm-global/lib/node_modules/...
 *   3. /usr/local/lib/node_modules/...
 *
 * @returns Absolute path to the Pi CLI JS entrypoint
 * @throws Error if Pi CLI cannot be found
 *
 * @since TP-104
 */
export function resolvePiCliPath(): string {
	const relPath = join("node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js");
	const candidates: string[] = [];

	if (process.env.APPDATA) {
		candidates.push(join(process.env.APPDATA, "npm", relPath));
	}
	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (home) {
		candidates.push(join(home, "AppData", "Roaming", "npm", relPath));
		candidates.push(join(home, ".npm-global", "lib", relPath));
	}
	candidates.push(join("/usr", "local", "lib", relPath));
	candidates.push(join("/opt", "homebrew", "lib", relPath));

	// Dynamic: npm root -g
	try {
		const { spawnSync } = require("child_process");
		const result = spawnSync("npm", ["root", "-g"], { encoding: "utf-8", timeout: 5000, shell: true });
		if (result.stdout?.trim()) {
			candidates.push(join(result.stdout.trim(), "@mariozechner", "pi-coding-agent", "dist", "cli.js"));
		}
	} catch { /* ignore */ }

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	throw new Error(
		"Cannot find Pi CLI entrypoint (cli.js). Ensure pi is installed globally. " +
		`Searched: ${candidates.slice(0, 4).join(", ")}`,
	);
}

// ── Conversation Payload Helpers (TP-111) ───────────────────────────────

/** Maximum characters for conversation event text payloads. */
const MAX_CONV_PAYLOAD_CHARS = 2000;

/** Truncate a string to maxLen chars, appending ellipsis if truncated. */
function truncatePayload(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen) + "…";
}

/**
 * Extract text content from a Pi RPC message_end event's message object.
 * Pi may return content as a string or as an array of content blocks.
 */
function extractAssistantText(message: Record<string, unknown>): string {
	// Direct string content
	if (typeof message.content === "string") return message.content;
	// Array of content blocks (Anthropic format)
	// Guard: skip null/non-object entries to prevent TypeError on malformed streams
	if (Array.isArray(message.content)) {
		const textBlocks = message.content
			.filter((b: unknown): b is { type: string; text: string } =>
				typeof b === "object" && b !== null &&
				(b as any).type === "text" && typeof (b as any).text === "string")
			.map((b) => b.text);
		if (textBlocks.length > 0) return textBlocks.join("\n");
	}
	// Fallback: try text field
	if (typeof message.text === "string") return message.text;
	return "";
}

// ── Types ────────────────────────────────────────────────────────────

/**
 * Options for spawning an agent via the direct host.
 *
 * @since TP-104
 */
export interface AgentHostOptions {
	/** Stable agent identity */
	agentId: RuntimeAgentId;
	/** Agent role */
	role: RuntimeAgentRole;
	/** Batch ID this agent belongs to */
	batchId: string;
	/** Lane number (null for merge agents) */
	laneNumber: number | null;
	/** Task ID being executed (null before first assignment) */
	taskId: string | null;
	/** Repo ID the agent is operating in */
	repoId: string;
	/** Working directory for the Pi process */
	cwd: string;
	/** User prompt content */
	prompt: string;
	/** Optional system prompt content */
	systemPrompt?: string;
	/** Model identifier (e.g., "anthropic/claude-sonnet-4-20250514") */
	model?: string;
	/** Comma-separated tool list */
	tools?: string;
	/** Thinking mode override */
	thinking?: string;
	/** Extension paths to load */
	extensions?: string[];
	/** Mailbox directory for steering (null = no mailbox) */
	mailboxDir?: string | null;
	/** Steering-pending JSONL path (TP-090, worker-only) */
	steeringPendingPath?: string | null;
	/** Path to persist normalized events JSONL */
	eventsPath?: string | null;
	/** Path to write exit summary JSON */
	exitSummaryPath?: string | null;
	/** Timeout in milliseconds (0 = no timeout) */
	timeoutMs?: number;
	/** Delay in ms before closing stdin after agent_end (default: 100) */
	closeDelayMs?: number;
	/** State root for process registry (null = no registry integration) */
	stateRoot?: string | null;
	/** Packet paths for registry manifest (null for merge agents) */
	packet?: PacketPaths | null;
	/** Extra environment variables for the child process */
	env?: Record<string, string>;
}

/**
 * Accumulated telemetry from a completed agent session.
 *
 * @since TP-104
 */
export interface AgentHostResult {
	/** Process exit code (null if killed by signal) */
	exitCode: number | null;
	/** Signal that killed the process (null if exited normally) */
	signal: string | null;
	/** Wall-clock duration in milliseconds */
	durationMs: number;
	/** Whether the process was killed by the caller */
	killed: boolean;
	/** Total input tokens */
	inputTokens: number;
	/** Total output tokens */
	outputTokens: number;
	/** Cache read tokens */
	cacheReadTokens: number;
	/** Cache write tokens */
	cacheWriteTokens: number;
	/** Cumulative cost in USD */
	costUsd: number;
	/** Number of tool calls */
	toolCalls: number;
	/** Last tool call description */
	lastTool: string;
	/** Number of auto-retries */
	retries: number;
	/** Number of auto-compactions */
	compactions: number;
	/** Authoritative context usage from Pi */
	contextUsage: { tokens: number; contextWindow: number; percent: number } | null;
	/** Final error message (null if clean exit) */
	error: string | null;
	/** Whether agent_end was received */
	agentEnded: boolean;
	/** Captured stderr tail (last 2KB) */
	stderrTail: string;
}

/**
 * Callback for normalized agent events.
 *
 * @since TP-104
 */
export type AgentEventCallback = (event: RuntimeAgentEvent) => void;

/**
 * Callback for telemetry updates (called on each message_end).
 *
 * @since TP-104
 */
export type AgentTelemetryCallback = (result: Partial<AgentHostResult>) => void;

// ── JSONL Helpers ────────────────────────────────────────────────────

const MAILBOX_MESSAGE_TYPES = new Set(["steer", "query", "abort", "info", "reply", "escalate"]);

function isValidMailboxMessage(obj: any): boolean {
	if (!obj || typeof obj !== "object") return false;
	return (
		typeof obj.id === "string" &&
		typeof obj.batchId === "string" &&
		typeof obj.from === "string" &&
		typeof obj.to === "string" &&
		typeof obj.timestamp === "number" && Number.isFinite(obj.timestamp) &&
		typeof obj.type === "string" && MAILBOX_MESSAGE_TYPES.has(obj.type) &&
		typeof obj.content === "string"
	);
}

// ── Core Host Function ───────────────────────────────────────────────

/**
 * Spawn and manage a Pi agent as a direct child process.
 *
 * Returns a promise that resolves with the full session result when
 * the agent exits, plus a kill function for early termination.
 *
 * @param opts - Agent host options
 * @param onEvent - Optional callback for normalized events
 * @param onTelemetry - Optional callback for telemetry updates
 * @returns Object with promise (resolves on exit) and kill function
 *
 * @since TP-104
 */
export function spawnAgent(
	opts: AgentHostOptions,
	onEvent?: AgentEventCallback,
	onTelemetry?: AgentTelemetryCallback,
): { promise: Promise<AgentHostResult>; kill: () => void } {

	const cliPath = resolvePiCliPath();
	const closeDelayMs = opts.closeDelayMs ?? 100;
	const timeoutMs = opts.timeoutMs ?? 0;

	// Build Pi CLI arguments
	const piArgs: string[] = [cliPath, "--mode", "rpc", "--no-session"];
	if (opts.model) piArgs.push("--model", opts.model);
	if (opts.tools) piArgs.push("--tools", opts.tools);
	if (opts.systemPrompt) piArgs.push("--system-prompt", opts.systemPrompt);
	// Always pass --no-extensions to prevent auto-discovery from cwd.
	// Explicit -e entries are still honored by pi even with --no-extensions.
	// This matches the fix from TP-095 that eliminated duplicate extension loading.
	piArgs.push("--no-extensions");
	if (opts.extensions && opts.extensions.length > 0) {
		for (const ext of opts.extensions) {
			piArgs.push("-e", ext);
		}
	}
	piArgs.push("--no-skills");
	if (opts.thinking) piArgs.push("--thinking", opts.thinking);

	// Spawn directly — no shell, no terminal multiplexer
	const proc = spawn(process.execPath, piArgs, {
		shell: false,
		cwd: opts.cwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, ...(opts.env ?? {}) },
	});

	// State accumulator
	const startedAt = Date.now();
	let killed = false;
	let timedOut = false;
	let agentEnded = false;
	let stdinClosed = false;
	let statsRequested = false;
	let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0;
	let costUsd = 0, toolCalls = 0, retries = 0, compactions = 0;
	let lastTool = "", error: string | null = null;
	let contextUsage: AgentHostResult["contextUsage"] = null;
	let stderrBuffer = "";
	const STDERR_MAX = 2048;

	// Timeout
	let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
	if (timeoutMs > 0) {
		timeoutHandle = setTimeout(() => {
			timedOut = true;
			killed = true;
			try { proc.kill("SIGTERM"); } catch { /* ignore */ }
		}, timeoutMs);
	}

	const REGISTRY_REFRESH_INTERVAL_MS = 1_000;
	let lastRegistryRefreshAt = 0;
	const refreshRegistrySnapshot = (force: boolean = false) => {
		if (!opts.stateRoot) return;
		const now = Date.now();
		if (!force && (now - lastRegistryRefreshAt) < REGISTRY_REFRESH_INTERVAL_MS) return;
		try {
			const snapshot = buildRegistrySnapshot(opts.stateRoot, opts.batchId);
			writeRegistrySnapshot(opts.stateRoot, snapshot);
			lastRegistryRefreshAt = now;
		} catch { /* best effort */ }
	};

	// Registry integration: write manifest before process is considered visible
	if (opts.stateRoot) {
		const manifest = createManifest({
			batchId: opts.batchId,
			agentId: opts.agentId,
			role: opts.role,
			laneNumber: opts.laneNumber,
			taskId: opts.taskId,
			repoId: opts.repoId,
			pid: proc.pid ?? 0,
			parentPid: process.pid,
			cwd: opts.cwd,
			packet: opts.packet ?? null,
		});
		manifest.status = "running";
		writeManifest(opts.stateRoot, manifest);
		refreshRegistrySnapshot(true);
	}

	// Helper: close stdin safely with delay
	function closeStdin() {
		if (stdinClosed) return;
		stdinClosed = true;
		if (closeDelayMs > 0) {
			setTimeout(() => {
				try { proc.stdin?.end(); } catch { /* ignore */ }
			}, closeDelayMs);
		} else {
			try { proc.stdin?.end(); } catch { /* ignore */ }
		}
	}

	// Helper: emit normalized event
	function emitEvent(type: RuntimeAgentEventType, payload: Record<string, unknown> = {}) {
		const event: RuntimeAgentEvent = {
			batchId: opts.batchId,
			agentId: opts.agentId,
			role: opts.role,
			laneNumber: opts.laneNumber,
			taskId: opts.taskId,
			repoId: opts.repoId,
			ts: Date.now(),
			type,
			payload,
		};
		if (onEvent) onEvent(event);
		// Persist to events JSONL if path is provided
		if (opts.eventsPath) {
			try {
				mkdirSync(dirname(opts.eventsPath), { recursive: true });
				appendFileSync(opts.eventsPath, JSON.stringify(event) + "\n", "utf-8");
			} catch { /* best effort */ }
		}
	}

	// Helper: check mailbox and inject (own inbox + _broadcast)
	function checkMailbox() {
		if (!opts.mailboxDir || !proc.stdin || proc.stdin.destroyed) return;

		const expectedSessionName = basename(opts.mailboxDir);
		const expectedBatchId = basename(dirname(opts.mailboxDir));

		// Collect messages from own inbox AND broadcast inbox
		const inboxDirs: Array<{ dir: string; isBroadcast: boolean }> = [
			{ dir: join(opts.mailboxDir, "inbox"), isBroadcast: false },
		];
		// TP-106: Also check _broadcast/inbox for broadcast messages
		const broadcastInbox = join(dirname(opts.mailboxDir), "_broadcast", "inbox");
		if (existsSync(broadcastInbox)) {
			inboxDirs.push({ dir: broadcastInbox, isBroadcast: true });
		}

		for (const { dir: inboxDir, isBroadcast } of inboxDirs) {
			if (!existsSync(inboxDir)) continue;

			let entries: string[];
			try { entries = readdirSync(inboxDir); } catch { continue; }

			const msgFiles = entries.filter(f => f.endsWith(".msg.json") && !f.endsWith(".msg.json.tmp")).sort();
			if (msgFiles.length === 0) continue;

			const ackDir = join(opts.mailboxDir, "ack");

			for (const filename of msgFiles) {
				try {
					const raw = readFileSync(join(inboxDir, filename), "utf-8");
					const msg = JSON.parse(raw);
					if (!isValidMailboxMessage(msg)) continue;
					if (msg.batchId !== expectedBatchId) continue;
					// Validate 'to' field: own inbox requires exact match, broadcast accepts "_broadcast"
					if (!isBroadcast && msg.to !== expectedSessionName) continue;
					if (isBroadcast && msg.to !== "_broadcast") continue;

					mkdirSync(ackDir, { recursive: true });
					const ackPath = join(ackDir, filename);
					// Broadcast fan-out: if this agent already acked this broadcast message,
					// skip to avoid duplicate delivery while preserving message for peers.
					if (isBroadcast && existsSync(ackPath)) continue;

					proc.stdin.write(JSON.stringify({ type: "steer", message: msg.content }) + "\n");

					if (isBroadcast) {
						// Do NOT remove the shared broadcast inbox file. Persist a per-agent
						// ack marker so all agents can consume the same broadcast exactly once.
						try { writeFileSync(ackPath, raw, "utf-8"); } catch { /* best effort */ }
					} else {
						try { renameSync(join(inboxDir, filename), ackPath); } catch { /* race ok */ }
					}

					emitEvent("message_delivered", { messageId: msg.id, content: msg.content, broadcast: isBroadcast });
					if (opts.stateRoot) {
						appendMailboxAuditEvent(opts.stateRoot, expectedBatchId, {
							type: "message_delivered",
							from: msg.from,
							to: isBroadcast ? expectedSessionName : msg.to,
							messageId: msg.id,
							messageType: msg.type,
							contentPreview: msg.content.slice(0, 200),
							broadcast: isBroadcast,
						});
					}

					// TP-090: steering-pending flag
					if (opts.steeringPendingPath) {
						try {
							appendFileSync(opts.steeringPendingPath,
								JSON.stringify({ ts: msg.timestamp, content: msg.content, id: msg.id }) + "\n", "utf-8");
						} catch { /* best effort */ }
					}
				} catch { /* skip malformed */ }
			}
		}
	}

	const promise = new Promise<AgentHostResult>((resolvePromise) => {
		let stdoutBuf = "";
		const decoder = new StringDecoder("utf8");
		let finished = false;

		function finish(exitCode: number | null, signal: string | null) {
			if (finished) return;
			finished = true;
			if (timeoutHandle) clearTimeout(timeoutHandle);

			const result: AgentHostResult = {
				exitCode,
				signal,
				durationMs: Date.now() - startedAt,
				killed,
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheWriteTokens,
				costUsd,
				toolCalls,
				lastTool,
				retries,
				compactions,
				contextUsage,
				error,
				agentEnded,
				stderrTail: stderrBuffer.trim().slice(-STDERR_MAX),
			};

			// Write exit summary if path provided
			if (opts.exitSummaryPath) {
				try {
					mkdirSync(dirname(opts.exitSummaryPath), { recursive: true });
					const summary = {
						exitCode: result.exitCode,
						exitSignal: result.signal,
						tokens: (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens) > 0
							? { input: inputTokens, output: outputTokens, cacheRead: cacheReadTokens, cacheWrite: cacheWriteTokens }
							: null,
						cost: costUsd > 0 ? costUsd : null,
						toolCalls,
						retries,
						compactions,
						durationSec: Math.round(result.durationMs / 1000),
						lastToolCall: lastTool || null,
						error: error || null,
						contextUsage: contextUsage || null,
					};
					writeFileSync(opts.exitSummaryPath, JSON.stringify(summary, null, 2) + "\n", "utf-8");
				} catch { /* best effort */ }
			}

			const exitEventType: RuntimeAgentEventType =
				timedOut ? "agent_timeout" :
				killed ? "agent_killed" :
				(exitCode === 0 && agentEnded) ? "agent_exited" :
				"agent_crashed";
			emitEvent(exitEventType, { exitCode, signal, durationMs: result.durationMs, timedOut });

			// Registry integration: update manifest to terminal status
			if (opts.stateRoot) {
				const terminalStatus =
					timedOut ? "timed_out" as const :
					killed ? "killed" as const :
					(exitCode === 0 && agentEnded) ? "exited" as const :
					"crashed" as const;
				updateManifestStatus(opts.stateRoot, opts.batchId, opts.agentId, terminalStatus);
				refreshRegistrySnapshot(true);
			}

			resolvePromise(result);
		}

		proc.stdout.on("data", (chunk: Buffer | string) => {
			stdoutBuf += typeof chunk === "string" ? chunk : decoder.write(chunk);
			let idx: number;
			while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
				let line = stdoutBuf.slice(0, idx);
				stdoutBuf = stdoutBuf.slice(idx + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (!line.trim()) continue;

				let event: any;
				try { event = JSON.parse(line); } catch { continue; }
				if (!event || !event.type) continue;

				// Accumulate telemetry
				switch (event.type) {
					case "message_end": {
						const usage = event.message?.usage;
						if (usage) {
							inputTokens += usage.input || 0;
							outputTokens += usage.output || 0;
							cacheReadTokens += usage.cacheRead || 0;
							cacheWriteTokens += usage.cacheWrite || 0;
							if (usage.cost) {
								costUsd += typeof usage.cost === "object" ? (usage.cost.total || 0) : (typeof usage.cost === "number" ? usage.cost : 0);
							}
						}
						// TP-111: Emit assistant_message with bounded content
						if (event.message?.role === "assistant") {
							const content = extractAssistantText(event.message);
							if (content) {
								emitEvent("assistant_message", { text: truncatePayload(content, MAX_CONV_PAYLOAD_CHARS) });
							}
						}
						// Request session stats after first assistant message
						if (!statsRequested && event.message?.role === "assistant") {
							statsRequested = true;
							try { proc.stdin?.write(JSON.stringify({ type: "get_session_stats" }) + "\n"); } catch { /* ignore */ }
						}
						// Check mailbox
						checkMailbox();
						// Keep registry snapshot freshness while agent is active.
						refreshRegistrySnapshot(false);
						// Emit telemetry update
						if (onTelemetry) {
							onTelemetry({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, toolCalls, lastTool, contextUsage });
						}
						break;
					}
					case "tool_execution_start": {
						toolCalls++;
						const toolName = event.toolName || "tool";
						const argPreview = typeof event.args === "string" ? event.args.slice(0, 80) :
							(event.args && typeof Object.values(event.args)[0] === "string" ? String(Object.values(event.args)[0]).slice(0, 80) : "");
						lastTool = argPreview ? `${toolName}: ${argPreview}` : toolName;
						// TP-111: Bounded payload only — no raw args in durable event log
						const toolPath = event.args?.path ? String(event.args.path).slice(0, 200) : "";
						emitEvent("tool_call", { tool: toolName, path: toolPath, argsPreview: argPreview });
						break;
					}
					case "tool_execution_end": {
						// TP-111: Include bounded result summary for dashboard display
						const toolResultSummary = typeof event.result === "string" ? event.result.slice(0, 200)
							: event.output ? String(event.output).slice(0, 200) : "";
						emitEvent("tool_result", { tool: event.toolName, summary: toolResultSummary });
						break;
					}
					case "auto_retry_start": {
						retries++;
						emitEvent("retry_started", { attempt: event.attempt, error: event.errorMessage || event.error });
						break;
					}
					case "auto_compaction_start": {
						compactions++;
						emitEvent("compaction_started", {});
						break;
					}
					case "response": {
						if (event.success === false && event.error) {
							error = event.error;
						}
						if (event.success === true && event.data?.contextUsage) {
							contextUsage = event.data.contextUsage;
							emitEvent("context_usage", { ...event.data.contextUsage });
						}
						break;
					}
					case "agent_end": {
						agentEnded = true;
						closeStdin();
						break;
					}
				}
			}
		});

		proc.stderr?.setEncoding("utf-8");
		proc.stderr?.on("data", (chunk: string) => {
			stderrBuffer += chunk;
			if (stderrBuffer.length > STDERR_MAX * 2) {
				stderrBuffer = stderrBuffer.slice(-STDERR_MAX);
			}
		});

		proc.on("error", (err: Error) => {
			error = `spawn error: ${err.message}`;
			finish(null, null);
		});

		proc.on("close", (code: number | null, signal: string | null) => {
			finish(code, signal);
		});

		// Send steering mode and prompt
		if (opts.mailboxDir) {
			proc.stdin.write(JSON.stringify({ type: "set_steering_mode", mode: "all" }) + "\n");
		}
		proc.stdin.write(JSON.stringify({ type: "prompt", message: opts.prompt }) + "\n");

		emitEvent("agent_started", { model: opts.model, cwd: opts.cwd });
		// TP-111: Emit prompt_sent with bounded preview
		emitEvent("prompt_sent", { text: truncatePayload(opts.prompt, MAX_CONV_PAYLOAD_CHARS) });
	});

	const kill = () => {
		killed = true;
		try { proc.kill("SIGTERM"); } catch { /* ignore */ }
	};

	return { promise, kill };
}
