#!/usr/bin/env node

/**
 * rpc-wrapper.mjs — Thin wrapper around `pi --mode rpc` for structured telemetry.
 *
 * Spawns pi in RPC mode, sends a prompt, captures RPC events to a sidecar JSONL
 * file, and writes a final exit summary JSON on process exit. Displays minimal
 * live progress on stderr for tmux pane visibility.
 *
 * Usage:
 *   node bin/rpc-wrapper.mjs \
 *     --sidecar-path .pi/telemetry/sidecar.jsonl \
 *     --exit-summary-path .pi/telemetry/exit-summary.json \
 *     --model "anthropic/claude-sonnet-4-20250514" \
 *     --system-prompt-file /tmp/sys.md \
 *     --prompt-file /tmp/prompt.md \
 *     [--tools tool1,tool2] \
 *     [--extensions ext1.ts,ext2.ts] \
 *     [-- ...passthrough pi args]
 *
 * Exit summary is written exactly once via a single-write guard, even when
 * multiple termination handlers fire (close, error, signals). The wrapper
 * does NOT classify the exit — that is deferred to `classifyExit()` in the
 * task-runner consumer.
 *
 * @see docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md §1a
 * @see extensions/taskplane/diagnostics.ts (ExitSummary type)
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

// ── CLI Argument Parsing ─────────────────────────────────────────────

function parseArgs(argv) {
	const args = {
		sidecarPath: null,
		exitSummaryPath: null,
		model: null,
		systemPromptFile: null,
		promptFile: null,
		tools: [],
		extensions: [],
		passthrough: [],
		help: false,
	};

	let i = 2; // skip "node" and script path
	while (i < argv.length) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			args.help = true;
			i++;
		} else if (arg === "--sidecar-path" && i + 1 < argv.length) {
			args.sidecarPath = argv[++i];
			i++;
		} else if (arg === "--exit-summary-path" && i + 1 < argv.length) {
			args.exitSummaryPath = argv[++i];
			i++;
		} else if (arg === "--model" && i + 1 < argv.length) {
			args.model = argv[++i];
			i++;
		} else if (arg === "--system-prompt-file" && i + 1 < argv.length) {
			args.systemPromptFile = argv[++i];
			i++;
		} else if (arg === "--prompt-file" && i + 1 < argv.length) {
			args.promptFile = argv[++i];
			i++;
		} else if (arg === "--tools" && i + 1 < argv.length) {
			args.tools = argv[++i].split(",").map((t) => t.trim()).filter(Boolean);
			i++;
		} else if (arg === "--extensions" && i + 1 < argv.length) {
			args.extensions = argv[++i].split(",").map((e) => e.trim()).filter(Boolean);
			i++;
		} else if (arg === "--") {
			args.passthrough = argv.slice(i + 1);
			break;
		} else {
			args.passthrough.push(arg);
			i++;
		}
	}

	return args;
}

function printUsage() {
	process.stderr.write(
		`rpc-wrapper.mjs — Wrap pi --mode rpc with structured telemetry

Usage:
  node bin/rpc-wrapper.mjs [options] [-- passthrough args]

Required:
  --sidecar-path <path>        Path for sidecar JSONL telemetry file
  --exit-summary-path <path>   Path for exit summary JSON file
  --prompt-file <path>         Path to the prompt file to send

Optional:
  --model <pattern>            Model pattern (e.g., "anthropic/claude-sonnet-4-20250514")
  --system-prompt-file <path>  Path to system prompt file
  --tools <t1,t2,...>          Comma-separated tool names
  --extensions <e1,e2,...>     Comma-separated extension paths
  -h, --help                   Show this help
`
	);
}

// ── Redaction ────────────────────────────────────────────────────────

/**
 * Regex matching environment variable names that carry secrets.
 * Matches names ending with _KEY, _TOKEN, or _SECRET (case-insensitive).
 */
const SECRET_ENV_PATTERN = /(_KEY|_TOKEN|_SECRET)$/i;

/**
 * Maximum length for tool arguments before truncation.
 */
const MAX_TOOL_ARG_LENGTH = 500;

/**
 * Redact sensitive data from a sidecar event before writing.
 *
 * Policy:
 * - Strip env var values matching *_KEY, *_TOKEN, *_SECRET patterns
 * - Redact auth/bearer tokens in string values
 * - Truncate large tool arguments to MAX_TOOL_ARG_LENGTH chars
 *
 * Returns a new object (does not mutate input).
 */
function redactEvent(event) {
	if (!event || typeof event !== "object") return event;

	const redacted = { ...event };

	// Redact tool_execution_start/end args
	if (redacted.args) {
		redacted.args = redactValue(redacted.args);
	}

	// Redact tool results
	if (redacted.result && typeof redacted.result === "object") {
		redacted.result = redactValue(redacted.result);
	}

	// Redact error messages that may contain secrets
	if (typeof redacted.error === "string") {
		redacted.error = redactString(redacted.error);
	}
	if (typeof redacted.errorMessage === "string") {
		redacted.errorMessage = redactString(redacted.errorMessage);
	}
	if (typeof redacted.finalError === "string") {
		redacted.finalError = redactString(redacted.finalError);
	}

	return redacted;
}

/**
 * Recursively redact values in an object or array.
 */
function redactValue(val) {
	if (val === null || val === undefined) return val;

	if (typeof val === "string") {
		return redactString(val.length > MAX_TOOL_ARG_LENGTH
			? val.slice(0, MAX_TOOL_ARG_LENGTH) + "…[truncated]"
			: val);
	}

	if (Array.isArray(val)) {
		return val.map((item) => redactValue(item));
	}

	if (typeof val === "object") {
		const result = {};
		for (const [key, v] of Object.entries(val)) {
			// Redact values of secret-named env vars
			if (SECRET_ENV_PATTERN.test(key) && typeof v === "string") {
				result[key] = "[REDACTED]";
			} else {
				result[key] = redactValue(v);
			}
		}
		return result;
	}

	return val;
}

/**
 * Redact bearer tokens and auth patterns from a string.
 */
function redactString(str) {
	// Redact Bearer tokens
	str = str.replace(/Bearer\s+[A-Za-z0-9._\-~+/]+=*/gi, "Bearer [REDACTED]");
	// Redact patterns that look like API keys (sk-..., key-..., etc.)
	str = str.replace(/\b(sk-|key-|token-)[A-Za-z0-9_\-]{16,}\b/gi, "[REDACTED]");
	return str;
}

/**
 * Redact sensitive data from an exit summary before writing to disk.
 *
 * Applies the same redaction pipeline used for sidecar events to all
 * string fields in the summary — particularly `error` and `lastToolCall`
 * which may carry secrets or token-like strings.
 *
 * Returns a new object (does not mutate input).
 */
function redactSummary(summary) {
	if (!summary || typeof summary !== "object") return summary;

	const redacted = { ...summary };

	// Redact error field
	if (typeof redacted.error === "string") {
		redacted.error = redactString(redacted.error);
	}

	// Redact lastToolCall field (built from raw tool args)
	if (typeof redacted.lastToolCall === "string") {
		redacted.lastToolCall = redactString(
			redacted.lastToolCall.length > MAX_TOOL_ARG_LENGTH
				? redacted.lastToolCall.slice(0, MAX_TOOL_ARG_LENGTH) + "…[truncated]"
				: redacted.lastToolCall
		);
	}

	// Redact retry error messages
	if (Array.isArray(redacted.retries)) {
		redacted.retries = redacted.retries.map((r) => ({
			...r,
			error: typeof r.error === "string" ? redactString(r.error) : r.error,
		}));
	}

	return redacted;
}

// ── Sidecar Event Writing ────────────────────────────────────────────

/**
 * Write a redacted event to the sidecar JSONL file.
 */
function writeSidecarEvent(sidecarPath, event) {
	const redacted = redactEvent(event);
	const ts = Date.now();
	const entry = { ...redacted, ts };
	try {
		appendFileSync(sidecarPath, JSON.stringify(entry) + "\n", "utf-8");
	} catch (err) {
		process.stderr.write(`[rpc-wrapper] sidecar write error: ${err.message}\n`);
	}
}

// ── Progress Display ─────────────────────────────────────────────────

/**
 * Display minimal progress on stderr for tmux pane visibility.
 */
function displayProgress(state) {
	const parts = [];
	if (state.currentTool) parts.push(`tool: ${state.currentTool}`);
	const totalTokens = state.tokens.input + state.tokens.output + state.tokens.cacheRead + state.tokens.cacheWrite;
	if (totalTokens > 0) parts.push(`tokens: ${totalTokens.toLocaleString()}`);
	if (state.cost > 0) parts.push(`cost: $${state.cost.toFixed(4)}`);
	if (state.toolCalls > 0) parts.push(`tools: ${state.toolCalls}`);
	if (parts.length > 0) {
		// Use carriage return to overwrite the line
		process.stderr.write(`\r[rpc-wrapper] ${parts.join(" | ")}   `);
	}
}

// ── JSONL Line Buffering ─────────────────────────────────────────────

/**
 * Create a JSONL line-buffer reader that splits on \n only (NOT readline).
 *
 * Per RPC protocol spec: split on \n, strip optional trailing \r,
 * do NOT use Node readline (splits on U+2028/U+2029).
 *
 * Reuses the proven pattern from task-runner.ts:910-975.
 */
function attachJsonlReader(stream, onLine) {
	const decoder = new StringDecoder("utf8");
	let buffer = "";

	stream.on("data", (chunk) => {
		buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

		while (true) {
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) break;

			let line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);
			// Strip optional trailing \r (accept \r\n input)
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (line.trim()) onLine(line);
		}
	});

	stream.on("end", () => {
		buffer += decoder.end();
		if (buffer.trim()) {
			const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
			if (line.trim()) onLine(line);
		}
	});
}

// ── Main ─────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);

if (args.help) {
	printUsage();
	process.exit(0);
}

// Validate required args
if (!args.sidecarPath) {
	process.stderr.write("[rpc-wrapper] ERROR: --sidecar-path is required\n");
	process.exit(1);
}
if (!args.exitSummaryPath) {
	process.stderr.write("[rpc-wrapper] ERROR: --exit-summary-path is required\n");
	process.exit(1);
}
if (!args.promptFile) {
	process.stderr.write("[rpc-wrapper] ERROR: --prompt-file is required\n");
	process.exit(1);
}

// Read prompt content
let promptContent;
try {
	promptContent = readFileSync(resolve(args.promptFile), "utf-8");
} catch (err) {
	process.stderr.write(`[rpc-wrapper] ERROR: Cannot read prompt file: ${err.message}\n`);
	process.exit(1);
}

// Read system prompt content (optional)
let systemPromptContent = null;
if (args.systemPromptFile) {
	try {
		systemPromptContent = readFileSync(resolve(args.systemPromptFile), "utf-8");
	} catch (err) {
		process.stderr.write(`[rpc-wrapper] WARNING: Cannot read system prompt file: ${err.message}\n`);
	}
}

// Ensure output directories exist
mkdirSync(dirname(resolve(args.sidecarPath)), { recursive: true });
mkdirSync(dirname(resolve(args.exitSummaryPath)), { recursive: true });

// ── Session State ────────────────────────────────────────────────────

const startTime = Date.now();

const state = {
	tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	cost: 0,
	toolCalls: 0,
	compactions: 0,
	retries: [],
	lastToolCall: null,
	currentTool: null,
	error: null,
	agentEnded: false,
};

// ── Build pi spawn args ──────────────────────────────────────────────

const piArgs = ["--mode", "rpc", "--no-session"];

if (args.model) {
	piArgs.push("--model", args.model);
}
if (systemPromptContent) {
	piArgs.push("--system-prompt", systemPromptContent);
}
for (const tool of args.tools) {
	piArgs.push("--tool", tool);
}
for (const ext of args.extensions) {
	piArgs.push("-e", ext);
}
piArgs.push(...args.passthrough);

// ── Spawn pi process ─────────────────────────────────────────────────

const proc = spawn("pi", piArgs, {
	stdio: ["pipe", "pipe", "pipe"],
	env: { ...process.env },
	shell: true, // Required for Windows: resolves pi.cmd shim. Matches task-runner.ts pattern.
});

// ── Send prompt via JSONL stdin ──────────────────────────────────────

const promptCmd = { type: "prompt", message: promptContent };
proc.stdin.write(JSON.stringify(promptCmd) + "\n");

// ── Stdin Lifecycle ──────────────────────────────────────────────────

/**
 * Close the child process stdin at a deterministic terminal point.
 * RPC mode waits for more commands while stdin is open — without closing it,
 * the pi process can hang indefinitely after `agent_end` or a terminal error.
 *
 * Called from: agent_end handler, terminal response error handler.
 * Safe to call multiple times (checks destroyed flag).
 */
function closeStdin() {
	try {
		if (proc.stdin && !proc.stdin.destroyed) {
			proc.stdin.end();
		}
	} catch {
		// stdin may already be closed — ignore
	}
}

// ── Route RPC events ─────────────────────────────────────────────────

function handleEvent(event) {
	if (!event || !event.type) return;

	// Write ALL events to sidecar (redacted)
	writeSidecarEvent(args.sidecarPath, event);

	switch (event.type) {
		case "message_end": {
			const usage = event.message?.usage;
			if (usage) {
				state.tokens.input += usage.input || 0;
				state.tokens.output += usage.output || 0;
				state.tokens.cacheRead += usage.cacheRead || 0;
				state.tokens.cacheWrite += usage.cacheWrite || 0;
				if (usage.cost) {
					state.cost += typeof usage.cost === "object" ? (usage.cost.total || 0) : (typeof usage.cost === "number" ? usage.cost : 0);
				}
			}
			displayProgress(state);
			break;
		}

		case "tool_execution_start": {
			state.toolCalls++;
			const toolDesc = event.toolName || "unknown";
			// Build a brief description: "toolName: first arg preview"
			let argPreview = "";
			if (event.args) {
				if (typeof event.args === "string") {
					argPreview = event.args.slice(0, 80);
				} else if (typeof event.args === "object") {
					const firstVal = Object.values(event.args)[0];
					if (typeof firstVal === "string") {
						argPreview = firstVal.slice(0, 80);
					}
				}
			}
			state.currentTool = argPreview ? `${toolDesc}: ${argPreview}` : toolDesc;
			state.lastToolCall = state.currentTool;
			displayProgress(state);
			break;
		}

		case "tool_execution_end": {
			state.currentTool = null;
			break;
		}

		case "auto_retry_start": {
			state.retries.push({
				attempt: event.attempt || state.retries.length + 1,
				error: event.errorMessage || event.error || "unknown",
				delayMs: event.delayMs || 0,
				succeeded: false, // updated on auto_retry_end
			});
			break;
		}

		case "auto_retry_end": {
			// Update the last retry record with success status
			if (state.retries.length > 0) {
				const last = state.retries[state.retries.length - 1];
				last.succeeded = event.success === true;
			}
			break;
		}

		case "auto_compaction_start": {
			state.compactions++;
			break;
		}

		case "agent_end": {
			state.agentEnded = true;
			// Close stdin so pi process can exit cleanly.
			// RPC mode waits for more commands while stdin is open;
			// without this, the process can hang indefinitely.
			closeStdin();
			break;
		}

		case "response": {
			// Check for command errors
			if (event.success === false && event.error) {
				state.error = event.error;
				// Terminal error response — close stdin to let pi exit
				closeStdin();
			}
			break;
		}

		default:
			// Other events are still written to sidecar above
			break;
	}
}

// Read RPC events from stdout using JSONL line-buffering
attachJsonlReader(proc.stdout, (line) => {
	try {
		const event = JSON.parse(line);
		handleEvent(event);
	} catch {
		// Malformed JSON line — log to stderr but don't crash
		process.stderr.write(`\n[rpc-wrapper] malformed JSONL: ${line.slice(0, 200)}\n`);
	}
});

// Forward stderr from pi to our stderr
proc.stderr?.setEncoding("utf-8");
proc.stderr?.on("data", (chunk) => {
	process.stderr.write(chunk);
});

// ── Single-Write Exit Summary Finalization ───────────────────────────

/**
 * Single-write guard: ensures exit summary is written exactly once
 * across all termination paths (close, error, signal handlers).
 *
 * Precedence for exitCode/exitSignal/error when multiple handlers fire:
 * 1. `close` event provides exitCode and exitSignal (most authoritative)
 * 2. `error` event provides spawn/pipe errors (fallback if close doesn't fire)
 * 3. Signal handlers set exitSignal to the forwarded signal name
 *
 * The first handler to call writeExitSummary() wins; subsequent calls are no-ops.
 */
let summaryWritten = false;

function writeExitSummary(exitCode, exitSignal, errorOverride) {
	if (summaryWritten) return;
	summaryWritten = true;

	const durationSec = Math.round((Date.now() - startTime) / 1000);

	// Determine final error: explicit override > accumulated state error > null
	const finalError = errorOverride || state.error || null;

	const rawSummary = {
		exitCode: typeof exitCode === "number" ? exitCode : null,
		exitSignal: exitSignal || null,
		tokens: (state.tokens.input + state.tokens.output + state.tokens.cacheRead + state.tokens.cacheWrite) > 0
			? { ...state.tokens }
			: null,
		cost: state.cost > 0 ? state.cost : null,
		toolCalls: state.toolCalls,
		retries: state.retries,
		compactions: state.compactions,
		durationSec,
		lastToolCall: state.lastToolCall,
		error: finalError,
	};

	// Apply redaction pipeline to summary fields (error, lastToolCall, retries)
	// before persisting — same policy as sidecar events.
	const summary = redactSummary(rawSummary);

	try {
		writeFileSync(resolve(args.exitSummaryPath), JSON.stringify(summary, null, 2) + "\n", "utf-8");
		process.stderr.write(`\n[rpc-wrapper] exit summary written to ${args.exitSummaryPath}\n`);
	} catch (err) {
		process.stderr.write(`\n[rpc-wrapper] FATAL: failed to write exit summary: ${err.message}\n`);
	}
}

// ── Process Lifecycle Handlers ───────────────────────────────────────

// Primary handler: process close event (most authoritative source of exit info)
proc.on("close", (code, signal) => {
	// Newline after progress display
	process.stderr.write("\n");

	if (!state.agentEnded && code !== 0) {
		// Process crashed without agent_end — capture what we have
		const crashError = state.error || `pi process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`;
		writeExitSummary(code, signal, crashError);
	} else {
		writeExitSummary(code, signal, null);
	}
});

// Fallback handler: spawn error (e.g., pi binary not found)
proc.on("error", (err) => {
	writeExitSummary(null, null, `spawn error: ${err.message}`);
});

// ── Signal Forwarding ────────────────────────────────────────────────

/**
 * Forward SIGTERM/SIGINT to the pi process via RPC abort command.
 * This allows graceful shutdown of the agent before the process exits.
 *
 * On Windows, SIGTERM/SIGINT behavior differs — we handle both and
 * attempt graceful abort first, then hard kill after a timeout.
 */
let signalForwarded = false;

function forwardSignal(signal) {
	if (signalForwarded) return;
	signalForwarded = true;

	process.stderr.write(`\n[rpc-wrapper] received ${signal}, sending abort to pi...\n`);

	// Try graceful abort via RPC
	try {
		if (proc.stdin && !proc.stdin.destroyed) {
			proc.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
		}
	} catch {
		// stdin may already be closed
	}

	// Give pi 5 seconds to shut down gracefully, then hard kill
	const killTimer = setTimeout(() => {
		try {
			proc.kill("SIGTERM");
		} catch {
			// Process may already be dead
		}
	}, 5000);

	// Don't let the timer keep the process alive
	if (killTimer.unref) killTimer.unref();
}

process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGINT", () => forwardSignal("SIGINT"));

// ── Uncaught Exception / Unhandled Rejection Handler ─────────────────

process.on("uncaughtException", (err) => {
	process.stderr.write(`\n[rpc-wrapper] uncaught exception: ${err.message}\n`);
	writeExitSummary(null, null, `wrapper uncaught exception: ${err.message}`);
	process.exit(1);
});

process.on("unhandledRejection", (reason) => {
	const msg = reason instanceof Error ? reason.message : String(reason);
	process.stderr.write(`\n[rpc-wrapper] unhandled rejection: ${msg}\n`);
	writeExitSummary(null, null, `wrapper unhandled rejection: ${msg}`);
	process.exit(1);
});

// ── Exit Code Forwarding ─────────────────────────────────────────────

// Forward the pi process exit code as our own
proc.on("close", (code) => {
	// Use setImmediate to let other close handlers run first
	setImmediate(() => {
		process.exitCode = code ?? 1;
	});
});
