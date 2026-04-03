#!/usr/bin/env node

/**
 * rpc-wrapper.mjs — Thin wrapper around `pi --mode rpc` for structured telemetry.
 *
 * Spawns pi in RPC mode, sends a prompt, captures RPC events to a sidecar JSONL
 * file, and writes a final exit summary JSON on process exit. Displays minimal
 * live progress on stderr for dashboard/session visibility.
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
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
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
		mailboxDir: null,
		steeringPendingPath: null,
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
		} else if (arg === "--mailbox-dir" && i + 1 < argv.length) {
			args.mailboxDir = argv[++i];
			i++;
		} else if (arg === "--steering-pending-path" && i + 1 < argv.length) {
			args.steeringPendingPath = argv[++i];
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
  --mailbox-dir <path>         Mailbox directory for agent steering (TP-089)
  --steering-pending-path <p>  Path to .steering-pending JSONL flag file (TP-090)
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
 * Display minimal progress on stderr for dashboard/session visibility.
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

// ── Session Accumulator (testable) ───────────────────────────────────

/**
 * Create a fresh session state object for accumulating RPC events.
 * Extracted from _main() for testability.
 */
function createSessionState() {
	return {
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		cost: 0,
		toolCalls: 0,
		compactions: 0,
		retries: [],
		lastToolCall: null,
		currentTool: null,
		error: null,
		agentEnded: false,
		/** Authoritative context usage from pi get_session_stats (null if unavailable) */
		contextUsage: null,
	};
}

/**
 * Apply an RPC event to session state, mutating state in place.
 * Extracted from _main() handleEvent for testability.
 *
 * Returns the mutated state (same reference).
 */
function applyEvent(state, event) {
	if (!event || !event.type) return state;

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
			break;
		}

		case "tool_execution_start": {
			state.toolCalls++;
			const toolDesc = event.toolName || "unknown";
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
				succeeded: false,
			});
			break;
		}

		case "auto_retry_end": {
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
			break;
		}

		case "response": {
			if (event.success === false && event.error) {
				state.error = event.error;
			}
			// get_session_stats response — extract authoritative contextUsage
			if (event.success === true && event.data?.contextUsage) {
				state.contextUsage = event.data.contextUsage;
			}
			break;
		}

		default:
			break;
	}

	return state;
}

/**
 * Build an exit summary object from session state.
 * Applies redaction. Does NOT write to disk — caller handles persistence.
 *
 * @param {object} state - Session state from createSessionState + applyEvent calls
 * @param {number|null} exitCode - Process exit code
 * @param {string|null} exitSignal - Process exit signal
 * @param {string|null} errorOverride - Override error message (e.g., spawn error)
 * @param {number} startTime - Session start timestamp (Date.now())
 * @returns {object} Redacted exit summary ready for serialization
 */
function buildExitSummary(state, exitCode, exitSignal, errorOverride, startTime) {
	const durationSec = Math.round((Date.now() - startTime) / 1000);
	const finalError = errorOverride || state.error || null;
	const normalizedExitCode = (typeof exitCode === "number" && Number.isFinite(exitCode) && exitCode >= 0)
		? exitCode
		: (exitCode === null || exitCode === undefined ? null : 1);

	const rawSummary = {
		exitCode: normalizedExitCode,
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
		// Authoritative context usage from pi ≥ 0.63.0 (null if unavailable)
		contextUsage: state.contextUsage || null,
	};

	return redactSummary(rawSummary);
}

/**
 * Create a single-write guard for exit summary persistence.
 * Returns a function that writes the summary at most once;
 * subsequent calls are no-ops.
 *
 * @param {function} writer - Function that receives (summary) and persists it
 * @returns {function} Guarded writer: (state, exitCode, exitSignal, errorOverride, startTime) => boolean
 */
function createSingleWriteGuard(writer) {
	let written = false;
	return function guardedWrite(state, exitCode, exitSignal, errorOverride, startTime) {
		if (written) return false;
		written = true;
		const summary = buildExitSummary(state, exitCode, exitSignal, errorOverride, startTime);
		writer(summary);
		return true;
	};
}

// ── Agent Mailbox Check (TP-089) ─────────────────────────────────────

/**
 * Valid mailbox message types (must match MailboxMessageType in types.ts).
 */
const MAILBOX_MESSAGE_TYPES = new Set(["steer", "query", "abort", "info", "reply", "escalate"]);

/**
 * Check the agent's mailbox inbox for pending messages and inject them
 * into the pi process via the `steer` RPC command.
 *
 * Called on every `message_end` event when `--mailbox-dir` is provided.
 * Messages are validated (batchId, to, shape), sorted deterministically,
 * injected via steer, and moved from inbox/ to ack/.
 *
 * @param {string} mailboxDir - Session mailbox directory (e.g., .pi/mailbox/{batchId}/{session})
 * @param {object} proc - The spawned pi process (must have writable stdin)
 * @param {string|null} steeringPendingPath - Path to .steering-pending JSONL flag file (TP-090, worker-only)
 * @returns {{ delivered: number, skipped: number }} Delivery stats
 */
function checkMailboxAndSteer(mailboxDir, proc, steeringPendingPath) {
	const stats = { delivered: 0, skipped: 0 };

	// Derive expected values from path structure:
	// mailboxDir = .pi/mailbox/{batchId}/{sessionName}
	const expectedSessionName = basename(mailboxDir);
	const expectedBatchId = basename(dirname(mailboxDir));

	const inboxDir = join(mailboxDir, "inbox");

	// Read inbox — ENOENT is quiet no-op (inbox may not exist yet)
	let entries;
	try {
		entries = readdirSync(inboxDir);
	} catch (err) {
		if (err.code === "ENOENT") return stats;
		process.stderr.write(`\n[STEERING] WARNING: failed to read inbox: ${err.message}\n`);
		return stats;
	}

	// Filter: only *.msg.json files (excludes .msg.json.tmp temp files)
	const msgFiles = entries.filter(f => f.endsWith(".msg.json") && !f.endsWith(".msg.json.tmp"));
	if (msgFiles.length === 0) return stats;

	// Read and validate all messages
	const validMessages = [];

	for (const filename of msgFiles) {
		const filePath = join(inboxDir, filename);
		let raw;
		try {
			raw = readFileSync(filePath, "utf-8");
		} catch (err) {
			process.stderr.write(`\n[STEERING] WARNING: failed to read ${filename}: ${err.message}\n`);
			stats.skipped++;
			continue;
		}

		let msg;
		try {
			msg = JSON.parse(raw);
		} catch {
			process.stderr.write(`\n[STEERING] WARNING: malformed JSON in ${filename}, skipping\n`);
			stats.skipped++;
			continue;
		}

		// Validate shape
		if (!isValidMailboxMessageShape(msg)) {
			process.stderr.write(`\n[STEERING] WARNING: invalid message shape in ${filename}, skipping\n`);
			stats.skipped++;
			continue;
		}

		// Validate batchId (derived from path, not message content)
		if (msg.batchId !== expectedBatchId) {
			process.stderr.write(`\n[STEERING] WARNING: batchId mismatch in ${filename} (expected ${expectedBatchId}, got ${msg.batchId}), skipping\n`);
			stats.skipped++;
			continue;
		}

		// Validate to (no misdelivery)
		if (msg.to !== expectedSessionName) {
			process.stderr.write(`\n[STEERING] WARNING: misdelivery in ${filename} (to=${msg.to}, expected ${expectedSessionName}), skipping\n`);
			stats.skipped++;
			continue;
		}

		validMessages.push({ filename, message: msg });
	}

	// Sort: primary by timestamp ascending, tie-break by filename lexical
	validMessages.sort((a, b) => {
		const tsDiff = a.message.timestamp - b.message.timestamp;
		if (tsDiff !== 0) return tsDiff;
		return a.filename.localeCompare(b.filename);
	});

	// Inject each message via steer RPC command and move to ack/
	for (const { filename, message } of validMessages) {
		try {
			// Precondition: stdin must be available for injection.
			// If stdin is closed/destroyed, keep message in inbox (no false ack).
			if (!proc.stdin || proc.stdin.destroyed) {
				stats.skipped++;
				continue;
			}

			// Inject via steer RPC command
			proc.stdin.write(JSON.stringify({ type: "steer", message: message.content }) + "\n");

			// Move to ack/ (delivery proof)
			const ackDir = join(mailboxDir, "ack");
			try { mkdirSync(ackDir, { recursive: true }); } catch { /* exists */ }
			try {
				renameSync(join(inboxDir, filename), join(ackDir, filename));
			} catch (err) {
				// ENOENT race is harmless (another process acked it)
				if (err.code !== "ENOENT") {
					process.stderr.write(`\n[STEERING] WARNING: failed to ack ${filename}: ${err.message}\n`);
				}
			}

			stats.delivered++;
			process.stderr.write(`\n[STEERING] Delivered message ${message.id}\n`);

			// TP-090: Append to .steering-pending JSONL flag for task-runner STATUS.md annotation.
			// Worker-only: steeringPendingPath is only set for worker sessions.
			if (steeringPendingPath) {
				try {
					const entry = JSON.stringify({ ts: message.timestamp, content: message.content, id: message.id }) + "\n";
					appendFileSync(steeringPendingPath, entry, "utf-8");
				} catch (err) {
					process.stderr.write(`\n[STEERING] WARNING: failed to write .steering-pending: ${err.message}\n`);
				}
			}
		} catch (err) {
			process.stderr.write(`\n[STEERING] WARNING: failed to deliver ${filename}: ${err.message}\n`);
			stats.skipped++;
		}
	}

	return stats;
}

/**
 * Runtime validation for mailbox message shape in rpc-wrapper.
 * Mirrors isValidMailboxMessage() from mailbox.ts but as a standalone
 * function (rpc-wrapper.mjs is a plain .mjs module, not TypeScript).
 *
 * @param {any} obj - Parsed JSON value
 * @returns {boolean} true if valid shape
 */
function isValidMailboxMessageShape(obj) {
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

// ── Exports for Testing ──────────────────────────────────────────────

// Export pure functions so tests can import them without triggering side effects.
export {
	parseArgs,
	redactEvent,
	redactValue,
	redactString,
	redactSummary,
	attachJsonlReader,
	SECRET_ENV_PATTERN,
	MAX_TOOL_ARG_LENGTH,
	createSessionState,
	applyEvent,
	buildExitSummary,
	createSingleWriteGuard,
	checkMailboxAndSteer,
	isValidMailboxMessageShape,
	MAILBOX_MESSAGE_TYPES,
};

// ── Main ─────────────────────────────────────────────────────────────

// Guard: only run main logic when executed directly (not imported).
// import.meta.url ends with the script name; process.argv[1] is the entry point.
// On Windows with shell:true, argv[1] may differ, so also check for --help being
// processed as a signal that we're the entry point.
const _isMain = process.argv[1] &&
	(import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/")) ||
	 import.meta.url.endsWith("/" + process.argv[1].replace(/\\/g, "/").split("/").pop()) ||
	 process.argv[1].endsWith("rpc-wrapper.mjs"));

if (_isMain) {
	_main();
}

function _main() {

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
const state = createSessionState();

// ── Build pi spawn args ──────────────────────────────────────────────

const piArgs = ["--mode", "rpc", "--no-session"];

if (args.model) {
	piArgs.push("--model", args.model);
}
if (systemPromptContent) {
	piArgs.push("--system-prompt", systemPromptContent);
}
if (args.tools.length > 0) {
	piArgs.push("--tools", args.tools.join(","));
}
for (const ext of args.extensions) {
	piArgs.push("-e", ext);
}
piArgs.push(...args.passthrough);

// ── Spawn pi process ─────────────────────────────────────────────────

// ── System prompt: file-based passthrough to avoid command line limits ────
// Windows CreateProcess has a ~32K command line limit. Orchestrated worker
// system prompts routinely exceed this (PROMPT.md + context docs + steps).
// When the system prompt is large, write it to a temp file and use shell
// expansion `$(cat file)` to pass it. This works in MSYS2/Git Bash shells
// used by lane sessions without hitting the Win32 limit.
//
// For small system prompts (< 8K), pass inline for simplicity.
const SYSTEM_PROMPT_FILE_THRESHOLD = 8192;
let systemPromptTempFile = null;

if (systemPromptContent && systemPromptContent.length >= SYSTEM_PROMPT_FILE_THRESHOLD) {
	// Remove --system-prompt from piArgs (was added above) and use file instead
	const sysIdx = piArgs.indexOf("--system-prompt");
	if (sysIdx >= 0) piArgs.splice(sysIdx, 2);
	// Write to temp file and use --append-system-prompt with @file syntax.
	// Pi's --append-system-prompt accepts @filepath to read from a file.
	// We use --system-prompt "" (empty base) + --append-system-prompt @file
	// to effectively set the system prompt from a file.
	systemPromptTempFile = join(tmpdir(), `pi-rpc-sysprompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
	writeFileSync(systemPromptTempFile, systemPromptContent, "utf-8");
	piArgs.push("--system-prompt", "");
	piArgs.push("--append-system-prompt", `@${systemPromptTempFile}`);
	process.stderr.write(`[rpc-wrapper] system prompt written to file (${systemPromptContent.length} chars): ${systemPromptTempFile}\n`);
}

const proc = spawn("pi", piArgs, {
	stdio: ["pipe", "pipe", "pipe"],
	env: { ...process.env },
	shell: true,
});

// ── TP-097: Write PID file for orphan cleanup ──────────────────
// Write both the wrapper PID and the pi child PID alongside the sidecar file.
// The task-runner reads this on session end to kill orphan processes.
// Format: JSON with wrapperPid and childPid fields.
const pidFilePath = args.sidecarPath + ".pid";
try {
	const pidData = {
		wrapperPid: process.pid,
		childPid: proc.pid ?? null,
		startedAt: Date.now(),
	};
	writeFileSync(pidFilePath, JSON.stringify(pidData) + "\n", "utf-8");
	process.stderr.write(`[rpc-wrapper] PID file written: ${pidFilePath} (wrapper=${process.pid}, child=${proc.pid})\n`);
} catch (err) {
	process.stderr.write(`[rpc-wrapper] WARNING: failed to write PID file: ${err.message}\n`);
}

// Clean up PID file on process exit (best-effort)
function cleanupPidFile() {
	try { unlinkSync(pidFilePath); } catch { /* ignore */ }
	if (systemPromptTempFile) {
		try { unlinkSync(systemPromptTempFile); } catch { /* ignore */ }
	}
}
process.on("exit", cleanupPidFile);

// ── Send prompt via JSONL stdin ──────────────────────────────────────

const promptCmd = { type: "prompt", message: promptContent };
proc.stdin.write(JSON.stringify(promptCmd) + "\n");

// ── Agent Mailbox Steering Setup (TP-089) ────────────────────────────
// When mailbox-dir is provided, set steering mode to "all" so queued
// steering messages are delivered together at the next turn boundary.
// Must be sent after prompt but before any agent processing begins.
if (args.mailboxDir) {
	proc.stdin.write(JSON.stringify({ type: "set_steering_mode", mode: "all" }) + "\n");
	process.stderr.write(`[rpc-wrapper] mailbox enabled: ${args.mailboxDir}\n`);
}

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

/**
 * Query pi for authoritative session stats including contextUsage.
 * Available in pi ≥ 0.63.0 (RPC get_session_stats exposes contextUsage).
 * Safe to call on older versions — the command is ignored or returns
 * without the field, and state.contextUsage stays null.
 */
function querySessionStats() {
	try {
		if (proc.stdin && !proc.stdin.destroyed) {
			proc.stdin.write(JSON.stringify({ type: "get_session_stats" }) + "\n");
		}
	} catch {
		// stdin may be closed — ignore
	}
}

// ── Route RPC events ─────────────────────────────────────────────────

// Event types worth persisting to the sidecar JSONL.
// Streaming deltas (content_block_delta, content_block_start/stop, message_start,
// input_json_delta, etc.) are omitted — they're high-volume, large, and not used
// by the dashboard or telemetry consumers. A single merge agent can produce 42MB+
// of sidecar data from streaming deltas alone.
const SIDECAR_EVENT_TYPES = new Set([
	"agent_start",
	"agent_end",
	"message_end",
	"tool_execution_start",
	"tool_execution_end",
	"tool_execution_update",
	"auto_retry_start",
	"auto_retry_end",
	"auto_compaction_start",
	"response",
]);

function handleEvent(event) {
	if (!event || !event.type) return;

	// Write only telemetry-relevant events to sidecar (redacted)
	if (SIDECAR_EVENT_TYPES.has(event.type)) {
		writeSidecarEvent(args.sidecarPath, event);
	}

	// Delegate state mutation to the extracted (testable) accumulator
	applyEvent(state, event);

	// Side effects that depend on the event type (IO, stdin lifecycle, display)
	switch (event.type) {
		case "message_end":
			displayProgress(state);
			// Query pi for authoritative context usage (pi ≥ 0.63.0).
			// Falls back gracefully: older pi versions ignore the command
			// or return a response without contextUsage — state.contextUsage stays null.
			querySessionStats();
			// Check mailbox for pending steering messages (TP-089).
			// Only active when --mailbox-dir is provided (backward compatible).
			if (args.mailboxDir) {
				try {
					checkMailboxAndSteer(args.mailboxDir, proc, args.steeringPendingPath || null);
				} catch (err) {
					// Never crash on mailbox I/O errors
					process.stderr.write(`\n[STEERING] ERROR: ${err.message}\n`);
				}
			}
			break;

		case "tool_execution_start":
			displayProgress(state);
			break;

		case "agent_end":
			// Close stdin so pi process can exit cleanly.
			// RPC mode waits for more commands while stdin is open;
			// without this, the process can hang indefinitely.
			closeStdin();
			break;

		case "response":
			// Terminal error response — close stdin to let pi exit
			if (event.success === false && event.error) {
				closeStdin();
			}
			break;

		default:
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
// Capture pi stderr for diagnostics — last 2KB preserved in exit summary.
// This is critical for diagnosing startup crashes (pi exits code 1 with 0 tokens).
let piStderrBuffer = "";
const PI_STDERR_MAX = 2048;
proc.stderr?.setEncoding("utf-8");
proc.stderr?.on("data", (chunk) => {
	process.stderr.write(chunk);
	piStderrBuffer += chunk;
	if (piStderrBuffer.length > PI_STDERR_MAX * 2) {
		piStderrBuffer = piStderrBuffer.slice(-PI_STDERR_MAX);
	}
});

// ── Single-Write Exit Summary Finalization ───────────────────────────

/**
 * Single-write guard: ensures exit summary is written exactly once
 * across all termination paths (close, error, signal handlers).
 *
 * Uses the extracted createSingleWriteGuard + buildExitSummary for testability.
 * The first handler to call writeExitSummary() wins; subsequent calls are no-ops.
 */
const writeExitSummary = createSingleWriteGuard((summary) => {
	try {
		writeFileSync(resolve(args.exitSummaryPath), JSON.stringify(summary, null, 2) + "\n", "utf-8");
		process.stderr.write(`\n[rpc-wrapper] exit summary written to ${args.exitSummaryPath}\n`);
	} catch (err) {
		process.stderr.write(`\n[rpc-wrapper] FATAL: failed to write exit summary: ${err.message}\n`);
	}
});

// ── Process Lifecycle Handlers ───────────────────────────────────────

// Primary handler: process close event (most authoritative source of exit info)
proc.on("close", (code, signal) => {
	// Newline after progress display
	process.stderr.write("\n");

	if (!state.agentEnded && code !== 0) {
		// Process crashed without agent_end — capture what we have
		const stderrTail = piStderrBuffer.trim().slice(-PI_STDERR_MAX);
		const crashError = state.error || `pi process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}${stderrTail ? `\npi stderr: ${stderrTail}` : ""}`;
		writeExitSummary(state, code, signal, crashError, startTime);
	} else {
		writeExitSummary(state, code, signal, null, startTime);
	}
});

// Fallback handler: spawn error (e.g., pi binary not found)
proc.on("error", (err) => {
	writeExitSummary(state, null, null, `spawn error: ${err.message}`, startTime);
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
	writeExitSummary(state, null, null, `wrapper uncaught exception: ${err.message}`, startTime);
	process.exit(1);
});

process.on("unhandledRejection", (reason) => {
	const msg = reason instanceof Error ? reason.message : String(reason);
	process.stderr.write(`\n[rpc-wrapper] unhandled rejection: ${msg}\n`);
	writeExitSummary(state, null, null, `wrapper unhandled rejection: ${msg}`, startTime);
	process.exit(1);
});

// ── Exit Code Forwarding ─────────────────────────────────────────────

// Forward the pi process exit code as our own (normalized: null/negative/non-finite → 1)
proc.on("close", (code) => {
	// Use setImmediate to let other close handlers run first
	setImmediate(() => {
		process.exitCode = (typeof code === "number" && Number.isFinite(code) && code >= 0) ? code : 1;
	});
});

} // end _main()
