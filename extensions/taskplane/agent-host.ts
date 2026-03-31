/**
 * Agent Host — Direct-child Pi agent hosting for Runtime V2
 *
 * Spawns `pi --mode rpc` as a direct child process (no TMUX, no shell),
 * parses RPC JSONL events, normalizes them into RuntimeAgentEvents,
 * manages mailbox delivery, and produces exit summaries.
 *
 * This replaces the TMUX-backed hosting path (spawnAgentTmux in
 * task-runner.ts + rpc-wrapper.mjs as a TMUX session command) with
 * a programmatic parent-child model where the caller has full process
 * ownership.
 *
 * Key differences from the legacy path:
 *   1. No TMUX — `spawn()` with `shell: false`
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
	if (opts.extensions && opts.extensions.length > 0) {
		for (const ext of opts.extensions) {
			piArgs.push("-e", ext);
		}
	} else {
		piArgs.push("--no-extensions");
	}
	piArgs.push("--no-skills");
	if (opts.thinking) piArgs.push("--thinking", opts.thinking);

	// Spawn directly — no shell, no TMUX
	const proc = spawn(process.execPath, piArgs, {
		shell: false,
		cwd: opts.cwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env },
	});

	// State accumulator
	const startedAt = Date.now();
	let killed = false;
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
			killed = true;
			try { proc.kill("SIGTERM"); } catch { /* ignore */ }
		}, timeoutMs);
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
			batchId: "",  // caller enriches via onEvent
			agentId: opts.agentId,
			role: opts.role,
			laneNumber: null,
			taskId: null,
			repoId: "",
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

	// Helper: check mailbox and inject
	function checkMailbox() {
		if (!opts.mailboxDir || !proc.stdin || proc.stdin.destroyed) return;
		const inboxDir = join(opts.mailboxDir, "inbox");
		if (!existsSync(inboxDir)) return;

		let entries: string[];
		try { entries = readdirSync(inboxDir); } catch { return; }

		const msgFiles = entries.filter(f => f.endsWith(".msg.json") && !f.endsWith(".msg.json.tmp")).sort();
		if (msgFiles.length === 0) return;

		const expectedSessionName = basename(opts.mailboxDir);
		const expectedBatchId = basename(dirname(opts.mailboxDir));
		const ackDir = join(opts.mailboxDir, "ack");

		for (const filename of msgFiles) {
			try {
				const raw = readFileSync(join(inboxDir, filename), "utf-8");
				const msg = JSON.parse(raw);
				if (!isValidMailboxMessage(msg)) continue;
				if (msg.batchId !== expectedBatchId) continue;
				if (msg.to !== expectedSessionName) continue;

				proc.stdin.write(JSON.stringify({ type: "steer", message: msg.content }) + "\n");

				mkdirSync(ackDir, { recursive: true });
				try { renameSync(join(inboxDir, filename), join(ackDir, filename)); } catch { /* race ok */ }

				emitEvent("message_delivered", { messageId: msg.id, content: msg.content });

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

			emitEvent(killed ? "agent_killed" : (exitCode === 0 && agentEnded ? "agent_exited" : "agent_crashed"), {
				exitCode, signal, durationMs: result.durationMs,
			});

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
						// Request session stats after first assistant message
						if (!statsRequested && event.message?.role === "assistant") {
							statsRequested = true;
							try { proc.stdin?.write(JSON.stringify({ type: "get_session_stats" }) + "\n"); } catch { /* ignore */ }
						}
						// Check mailbox
						checkMailbox();
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
						emitEvent("tool_call", { tool: toolName, args: event.args });
						break;
					}
					case "tool_execution_end": {
						emitEvent("tool_result", { tool: event.toolName });
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
	});

	const kill = () => {
		killed = true;
		try { proc.kill("SIGTERM"); } catch { /* ignore */ }
	};

	return { promise, kill };
}
