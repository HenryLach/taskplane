/**
 * RPC Wrapper Tests — TP-025 Step 3
 *
 * Tests for pure functions exported by bin/rpc-wrapper.mjs:
 * - Redaction logic (sidecar events AND exit summary)
 * - JSONL framing (split on \n, optional \r, trailing partial buffer)
 * - Session state accumulation (applyEvent: token totals, retry aggregation, tool tracking)
 * - Exit summary building (buildExitSummary: exit code normalization, error precedence, redaction)
 * - Single-write guard (createSingleWriteGuard: exactly-once semantics)
 * - Integration: spawn rpc-wrapper.mjs with mock pi script, verify sidecar + summary artifacts
 *
 * Run: npx vitest run extensions/tests/rpc-wrapper.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import { expect } from "./expect.ts";
import { resolve, dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Readable } from "stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wrapperPath = resolve(__dirname, "../../bin/rpc-wrapper.mjs");

// Dynamic import of the .mjs wrapper (exports pure functions, skips main)
let wrapperModule: any;

beforeEach(async () => {
	// Import once — the module guards main() behind an isMain check
	if (!wrapperModule) {
		wrapperModule = await import(pathToFileURL(wrapperPath).href);
	}
});

// ── 1. Redaction — sidecar events ────────────────────────────────────

describe("redactEvent — sidecar event redaction", () => {
	it("returns non-objects as-is", async () => {
		const { redactEvent } = wrapperModule;
		expect(redactEvent(null)).toBe(null);
		expect(redactEvent(undefined)).toBe(undefined);
		expect(redactEvent(42)).toBe(42);
	});

	it("redacts env var values matching *_KEY pattern in args", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "tool_execution_start",
			args: { OPENAI_API_KEY: "sk-1234567890abcdef", normalArg: "hello" },
		};
		const result = redactEvent(event);
		expect(result.args.OPENAI_API_KEY).toBe("[REDACTED]");
		expect(result.args.normalArg).toBe("hello");
	});

	it("redacts env var values matching *_TOKEN pattern in args", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "tool_execution_start",
			args: { GITHUB_TOKEN: "ghp_abcdef123456", other: "safe" },
		};
		const result = redactEvent(event);
		expect(result.args.GITHUB_TOKEN).toBe("[REDACTED]");
		expect(result.args.other).toBe("safe");
	});

	it("redacts env var values matching *_SECRET pattern in args", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "tool_execution_start",
			args: { AWS_SECRET: "mysecretvalue", name: "test" },
		};
		const result = redactEvent(event);
		expect(result.args.AWS_SECRET).toBe("[REDACTED]");
		expect(result.args.name).toBe("test");
	});

	it("is case-insensitive for secret pattern matching", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "tool_execution_start",
			args: { api_key: "secret123", My_Token: "tok123", app_secret: "s3cr3t" },
		};
		const result = redactEvent(event);
		expect(result.args.api_key).toBe("[REDACTED]");
		expect(result.args.My_Token).toBe("[REDACTED]");
		expect(result.args.app_secret).toBe("[REDACTED]");
	});

	it("truncates long string args to 500 chars", () => {
		const { redactEvent, MAX_TOOL_ARG_LENGTH } = wrapperModule;
		const longString = "x".repeat(600);
		const event = {
			type: "tool_execution_start",
			args: { content: longString },
		};
		const result = redactEvent(event);
		expect(result.args.content.length).toBeLessThanOrEqual(MAX_TOOL_ARG_LENGTH + 20); // +20 for "…[truncated]"
		expect(result.args.content).toContain("…[truncated]");
	});

	it("does not truncate args under 500 chars", () => {
		const { redactEvent, MAX_TOOL_ARG_LENGTH } = wrapperModule;
		const shortString = "x".repeat(MAX_TOOL_ARG_LENGTH - 1);
		const event = {
			type: "tool_execution_start",
			args: { content: shortString },
		};
		const result = redactEvent(event);
		expect(result.args.content).toBe(shortString);
	});

	it("redacts Bearer tokens in error fields", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "error",
			error: "Authorization: Bearer sk-abc123def456ghi789",
		};
		const result = redactEvent(event);
		expect(result.error).toContain("Bearer [REDACTED]");
		expect(result.error).not.toContain("sk-abc123def456ghi789");
	});

	it("redacts API key patterns in error messages", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "error",
			error: "Failed with key sk-abcdefghijklmnopqrst",
		};
		const result = redactEvent(event);
		expect(result.error).toContain("[REDACTED]");
		expect(result.error).not.toContain("sk-abcdefghijklmnopqrst");
	});

	it("redacts errorMessage and finalError fields", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "error",
			errorMessage: "Bearer sk-abcdef1234567890abcd",
			finalError: "token-abcdefghijklmnopqrst failed",
		};
		const result = redactEvent(event);
		expect(result.errorMessage).toContain("[REDACTED]");
		expect(result.finalError).toContain("[REDACTED]");
	});

	it("redacts nested objects in args recursively", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "tool_execution_start",
			args: {
				env: {
					HOME: "/home/user",
					API_KEY: "secret-key-value",
					nested: {
						AUTH_TOKEN: "tok-nested",
					},
				},
			},
		};
		const result = redactEvent(event);
		expect(result.args.env.HOME).toBe("/home/user");
		expect(result.args.env.API_KEY).toBe("[REDACTED]");
		expect(result.args.env.nested.AUTH_TOKEN).toBe("[REDACTED]");
	});

	it("redacts arrays in args recursively", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "tool_execution_start",
			args: {
				list: [
					{ DB_SECRET: "dbpass" },
					"normal string",
				],
			},
		};
		const result = redactEvent(event);
		expect(result.args.list[0].DB_SECRET).toBe("[REDACTED]");
		expect(result.args.list[1]).toBe("normal string");
	});

	it("does not mutate the original event", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "tool_execution_start",
			args: { API_KEY: "secret123" },
		};
		const original = JSON.parse(JSON.stringify(event));
		redactEvent(event);
		expect(event).toEqual(original);
	});

	it("redacts result objects", () => {
		const { redactEvent } = wrapperModule;
		const event = {
			type: "tool_execution_end",
			result: {
				AUTH_TOKEN: "secret-token",
				output: "normal output",
			},
		};
		const result = redactEvent(event);
		expect(result.result.AUTH_TOKEN).toBe("[REDACTED]");
		expect(result.result.output).toBe("normal output");
	});
});

// ── 2. Redaction — exit summary ──────────────────────────────────────

describe("redactSummary — exit summary redaction", () => {
	it("returns non-objects as-is", () => {
		const { redactSummary } = wrapperModule;
		expect(redactSummary(null)).toBe(null);
		expect(redactSummary(undefined)).toBe(undefined);
	});

	it("redacts Bearer tokens in error field", () => {
		const { redactSummary } = wrapperModule;
		const summary = {
			exitCode: 1,
			error: "API call failed: Bearer sk-12345678901234567890",
			lastToolCall: "bash: echo hello",
			retries: [],
		};
		const result = redactSummary(summary);
		expect(result.error).toContain("Bearer [REDACTED]");
		expect(result.error).not.toContain("sk-12345678901234567890");
	});

	it("redacts API key patterns in error field", () => {
		const { redactSummary } = wrapperModule;
		const summary = {
			exitCode: 1,
			error: "Failed with key-abcdefghijklmnopqrst",
			lastToolCall: null,
			retries: [],
		};
		const result = redactSummary(summary);
		expect(result.error).toContain("[REDACTED]");
	});

	it("truncates and redacts long lastToolCall", () => {
		const { redactSummary, MAX_TOOL_ARG_LENGTH } = wrapperModule;
		const longTool = "bash: " + "x".repeat(600);
		const summary = {
			exitCode: 0,
			error: null,
			lastToolCall: longTool,
			retries: [],
		};
		const result = redactSummary(summary);
		expect(result.lastToolCall.length).toBeLessThanOrEqual(MAX_TOOL_ARG_LENGTH + 20);
		expect(result.lastToolCall).toContain("…[truncated]");
	});

	it("redacts Bearer tokens in lastToolCall", () => {
		const { redactSummary } = wrapperModule;
		const summary = {
			exitCode: 0,
			error: null,
			lastToolCall: "curl -H 'Authorization: Bearer sk-abcdef1234567890abcd' ...",
			retries: [],
		};
		const result = redactSummary(summary);
		expect(result.lastToolCall).toContain("Bearer [REDACTED]");
	});

	it("redacts error strings in retry records", () => {
		const { redactSummary } = wrapperModule;
		const summary = {
			exitCode: 1,
			error: null,
			lastToolCall: null,
			retries: [
				{ attempt: 1, error: "Auth: Bearer sk-abcdef1234567890abcd", delayMs: 1000, succeeded: false },
				{ attempt: 2, error: "key-xyzxyzxyzxyzxyzxyzxyz expired", delayMs: 2000, succeeded: true },
			],
		};
		const result = redactSummary(summary);
		expect(result.retries[0].error).toContain("[REDACTED]");
		expect(result.retries[0].error).not.toContain("sk-abcdef1234567890abcd");
		expect(result.retries[1].error).toContain("[REDACTED]");
		expect(result.retries[1].error).not.toContain("key-xyzxyzxyzxyzxyzxyzxyz");
	});

	it("preserves non-string fields unchanged", () => {
		const { redactSummary } = wrapperModule;
		const summary = {
			exitCode: 42,
			exitSignal: "SIGTERM",
			tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
			cost: 0.05,
			toolCalls: 3,
			compactions: 1,
			durationSec: 120,
			error: null,
			lastToolCall: null,
			retries: [],
		};
		const result = redactSummary(summary);
		expect(result.exitCode).toBe(42);
		expect(result.exitSignal).toBe("SIGTERM");
		expect(result.tokens).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
		expect(result.cost).toBe(0.05);
		expect(result.toolCalls).toBe(3);
		expect(result.compactions).toBe(1);
		expect(result.durationSec).toBe(120);
	});

	it("does not mutate the original summary", () => {
		const { redactSummary } = wrapperModule;
		const summary = {
			error: "Bearer sk-abcdef1234567890abcd failed",
			retries: [
				{ attempt: 1, error: "Bearer sk-abcdef1234567890abcd", delayMs: 0, succeeded: false },
			],
		};
		const original = JSON.parse(JSON.stringify(summary));
		redactSummary(summary);
		expect(summary).toEqual(original);
	});
});

// ── 3. JSONL Framing ─────────────────────────────────────────────────

describe("attachJsonlReader — JSONL line-buffered parsing", () => {
	it("parses complete JSONL lines split on \\n", async () => {
		const { attachJsonlReader } = wrapperModule;
		const lines: string[] = [];
		const stream = new Readable({ read() {} });

		attachJsonlReader(stream, (line: string) => lines.push(line));

		stream.push('{"type":"agent_start"}\n{"type":"message_end"}\n');
		stream.push(null);

		// Wait for stream to finish
		await new Promise((resolve) => stream.on("end", resolve));

		expect(lines).toEqual(['{"type":"agent_start"}', '{"type":"message_end"}']);
	});

	it("handles \\r\\n line endings (strips trailing \\r)", async () => {
		const { attachJsonlReader } = wrapperModule;
		const lines: string[] = [];
		const stream = new Readable({ read() {} });

		attachJsonlReader(stream, (line: string) => lines.push(line));

		stream.push('{"type":"agent_start"}\r\n{"type":"agent_end"}\r\n');
		stream.push(null);

		await new Promise((resolve) => stream.on("end", resolve));

		expect(lines).toEqual(['{"type":"agent_start"}', '{"type":"agent_end"}']);
		// Verify no trailing \r
		for (const line of lines) {
			expect(line.endsWith("\r")).toBe(false);
		}
	});

	it("handles chunked data across multiple pushes", async () => {
		const { attachJsonlReader } = wrapperModule;
		const lines: string[] = [];
		const stream = new Readable({ read() {} });

		attachJsonlReader(stream, (line: string) => lines.push(line));

		// Split a line across two chunks
		stream.push('{"type":"agent');
		stream.push('_start"}\n');
		stream.push(null);

		await new Promise((resolve) => stream.on("end", resolve));

		expect(lines).toEqual(['{"type":"agent_start"}']);
	});

	it("handles trailing partial buffer on stream end", async () => {
		const { attachJsonlReader } = wrapperModule;
		const lines: string[] = [];
		const stream = new Readable({ read() {} });

		attachJsonlReader(stream, (line: string) => lines.push(line));

		// Last line without trailing newline
		stream.push('{"type":"agent_start"}\n{"type":"final_event"}');
		stream.push(null);

		await new Promise((resolve) => stream.on("end", resolve));

		expect(lines).toEqual(['{"type":"agent_start"}', '{"type":"final_event"}']);
	});

	it("handles trailing \\r in partial buffer on stream end", async () => {
		const { attachJsonlReader } = wrapperModule;
		const lines: string[] = [];
		const stream = new Readable({ read() {} });

		attachJsonlReader(stream, (line: string) => lines.push(line));

		// Partial buffer ending with \r (no \n)
		stream.push('{"type":"event"}\r');
		stream.push(null);

		await new Promise((resolve) => stream.on("end", resolve));

		expect(lines).toEqual(['{"type":"event"}']);
	});

	it("skips empty/whitespace-only lines", async () => {
		const { attachJsonlReader } = wrapperModule;
		const lines: string[] = [];
		const stream = new Readable({ read() {} });

		attachJsonlReader(stream, (line: string) => lines.push(line));

		stream.push('{"type":"a"}\n\n  \n{"type":"b"}\n');
		stream.push(null);

		await new Promise((resolve) => stream.on("end", resolve));

		expect(lines).toEqual(['{"type":"a"}', '{"type":"b"}']);
	});

	it("handles Buffer chunks (not just strings)", async () => {
		const { attachJsonlReader } = wrapperModule;
		const lines: string[] = [];
		const stream = new Readable({ read() {} });

		attachJsonlReader(stream, (line: string) => lines.push(line));

		stream.push(Buffer.from('{"type":"buf_test"}\n'));
		stream.push(null);

		await new Promise((resolve) => stream.on("end", resolve));

		expect(lines).toEqual(['{"type":"buf_test"}']);
	});
});

// ── 4. parseArgs ─────────────────────────────────────────────────────

describe("parseArgs — CLI argument parsing", () => {
	it("parses all required arguments", () => {
		const { parseArgs } = wrapperModule;
		const result = parseArgs([
			"node", "rpc-wrapper.mjs",
			"--sidecar-path", "/tmp/sidecar.jsonl",
			"--exit-summary-path", "/tmp/summary.json",
			"--prompt-file", "/tmp/prompt.md",
		]);
		expect(result.sidecarPath).toBe("/tmp/sidecar.jsonl");
		expect(result.exitSummaryPath).toBe("/tmp/summary.json");
		expect(result.promptFile).toBe("/tmp/prompt.md");
	});

	it("parses optional arguments", () => {
		const { parseArgs } = wrapperModule;
		const result = parseArgs([
			"node", "rpc-wrapper.mjs",
			"--sidecar-path", "/tmp/sidecar.jsonl",
			"--exit-summary-path", "/tmp/summary.json",
			"--prompt-file", "/tmp/prompt.md",
			"--model", "anthropic/claude-sonnet-4-20250514",
			"--system-prompt-file", "/tmp/sys.md",
			"--tools", "bash,read,write",
			"--extensions", "ext1.ts,ext2.ts",
		]);
		expect(result.model).toBe("anthropic/claude-sonnet-4-20250514");
		expect(result.systemPromptFile).toBe("/tmp/sys.md");
		expect(result.tools).toEqual(["bash", "read", "write"]);
		expect(result.extensions).toEqual(["ext1.ts", "ext2.ts"]);
	});

	it("handles -- passthrough args", () => {
		const { parseArgs } = wrapperModule;
		const result = parseArgs([
			"node", "rpc-wrapper.mjs",
			"--sidecar-path", "/tmp/sidecar.jsonl",
			"--exit-summary-path", "/tmp/summary.json",
			"--prompt-file", "/tmp/prompt.md",
			"--", "--verbose", "--debug",
		]);
		expect(result.passthrough).toEqual(["--verbose", "--debug"]);
	});

	it("handles --help flag", () => {
		const { parseArgs } = wrapperModule;
		const result = parseArgs(["node", "rpc-wrapper.mjs", "--help"]);
		expect(result.help).toBe(true);
	});

	it("handles -h flag", () => {
		const { parseArgs } = wrapperModule;
		const result = parseArgs(["node", "rpc-wrapper.mjs", "-h"]);
		expect(result.help).toBe(true);
	});

	it("collects unknown args as passthrough", () => {
		const { parseArgs } = wrapperModule;
		const result = parseArgs([
			"node", "rpc-wrapper.mjs",
			"--sidecar-path", "/tmp/sidecar.jsonl",
			"--exit-summary-path", "/tmp/summary.json",
			"--prompt-file", "/tmp/prompt.md",
			"--unknown-flag",
		]);
		expect(result.passthrough).toContain("--unknown-flag");
	});
});

// ── 5. SECRET_ENV_PATTERN ────────────────────────────────────────────

describe("SECRET_ENV_PATTERN", () => {
	it("matches *_KEY pattern (case-insensitive)", () => {
		const { SECRET_ENV_PATTERN } = wrapperModule;
		expect(SECRET_ENV_PATTERN.test("API_KEY")).toBe(true);
		expect(SECRET_ENV_PATTERN.test("OPENAI_API_KEY")).toBe(true);
		expect(SECRET_ENV_PATTERN.test("api_key")).toBe(true);
	});

	it("matches *_TOKEN pattern (case-insensitive)", () => {
		const { SECRET_ENV_PATTERN } = wrapperModule;
		expect(SECRET_ENV_PATTERN.test("GITHUB_TOKEN")).toBe(true);
		expect(SECRET_ENV_PATTERN.test("auth_token")).toBe(true);
	});

	it("matches *_SECRET pattern (case-insensitive)", () => {
		const { SECRET_ENV_PATTERN } = wrapperModule;
		expect(SECRET_ENV_PATTERN.test("AWS_SECRET")).toBe(true);
		expect(SECRET_ENV_PATTERN.test("db_secret")).toBe(true);
	});

	it("does not match non-secret env var names", () => {
		const { SECRET_ENV_PATTERN } = wrapperModule;
		expect(SECRET_ENV_PATTERN.test("HOME")).toBe(false);
		expect(SECRET_ENV_PATTERN.test("PATH")).toBe(false);
		expect(SECRET_ENV_PATTERN.test("NODE_ENV")).toBe(false);
		expect(SECRET_ENV_PATTERN.test("KEY_NAME")).toBe(false); // KEY not at end
	});
});

// ── 6. redactString ──────────────────────────────────────────────────

describe("redactString — string-level redaction", () => {
	it("redacts Bearer tokens", () => {
		const { redactString } = wrapperModule;
		expect(redactString("Authorization: Bearer abc123.def456")).toContain("Bearer [REDACTED]");
	});

	it("redacts sk- API key patterns", () => {
		const { redactString } = wrapperModule;
		const result = redactString("key is sk-abcdefghijklmnopqrst");
		expect(result).toContain("[REDACTED]");
		expect(result).not.toContain("sk-abcdefghijklmnopqrst");
	});

	it("redacts key- patterns", () => {
		const { redactString } = wrapperModule;
		const result = redactString("using key-abcdefghijklmnopqrst for auth");
		expect(result).toContain("[REDACTED]");
	});

	it("redacts token- patterns", () => {
		const { redactString } = wrapperModule;
		const result = redactString("found token-abcdefghijklmnopqrst in env");
		expect(result).toContain("[REDACTED]");
	});

	it("does not redact normal strings", () => {
		const { redactString } = wrapperModule;
		expect(redactString("hello world")).toBe("hello world");
		expect(redactString("the skeleton key")).toBe("the skeleton key");
	});
});

// ── 7. redactValue — deeper unit tests ───────────────────────────────

describe("redactValue — value redaction details", () => {
	it("handles null and undefined", () => {
		const { redactValue } = wrapperModule;
		expect(redactValue(null)).toBe(null);
		expect(redactValue(undefined)).toBe(undefined);
	});

	it("handles numbers and booleans (passthrough)", () => {
		const { redactValue } = wrapperModule;
		expect(redactValue(42)).toBe(42);
		expect(redactValue(true)).toBe(true);
	});

	it("truncates long strings", () => {
		const { redactValue, MAX_TOOL_ARG_LENGTH } = wrapperModule;
		const longStr = "a".repeat(MAX_TOOL_ARG_LENGTH + 100);
		const result = redactValue(longStr);
		expect(result).toContain("…[truncated]");
		expect(result.length).toBeLessThanOrEqual(MAX_TOOL_ARG_LENGTH + 20);
	});

	it("does not truncate strings at exactly MAX_TOOL_ARG_LENGTH", () => {
		const { redactValue, MAX_TOOL_ARG_LENGTH } = wrapperModule;
		const exactStr = "b".repeat(MAX_TOOL_ARG_LENGTH);
		const result = redactValue(exactStr);
		expect(result).toBe(exactStr);
		expect(result).not.toContain("…[truncated]");
	});

	it("handles deeply nested objects", () => {
		const { redactValue } = wrapperModule;
		const nested = {
			level1: {
				level2: {
					API_KEY: "secret",
					normal: "value",
				},
			},
		};
		const result = redactValue(nested);
		expect(result.level1.level2.API_KEY).toBe("[REDACTED]");
		expect(result.level1.level2.normal).toBe("value");
	});

	it("handles arrays of mixed types", () => {
		const { redactValue } = wrapperModule;
		const arr = [
			"normal",
			{ APP_SECRET: "s3cr3t" },
			42,
			null,
			["nested", { AUTH_KEY: "key123" }],
		];
		const result = redactValue(arr);
		expect(result[0]).toBe("normal");
		expect(result[1].APP_SECRET).toBe("[REDACTED]");
		expect(result[2]).toBe(42);
		expect(result[3]).toBe(null);
		expect(result[4][0]).toBe("nested");
		expect(result[4][1].AUTH_KEY).toBe("[REDACTED]");
	});
});

// ── 8. Session State Accumulation (applyEvent) ──────────────────────

describe("applyEvent — session state accumulation", () => {
	it("accumulates token totals from message_end events", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, {
			type: "message_end",
			message: { usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: 0.01 } },
		});
		applyEvent(state, {
			type: "message_end",
			message: { usage: { input: 200, output: 80, cacheRead: 20, cacheWrite: 10, cost: 0.02 } },
		});

		expect(state.tokens.input).toBe(300);
		expect(state.tokens.output).toBe(130);
		expect(state.tokens.cacheRead).toBe(30);
		expect(state.tokens.cacheWrite).toBe(15);
		expect(state.cost).toBeCloseTo(0.03);
	});

	it("handles message_end with object cost (cost.total)", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, {
			type: "message_end",
			message: { usage: { input: 100, output: 50, cost: { total: 0.05, input: 0.02, output: 0.03 } } },
		});

		expect(state.cost).toBeCloseTo(0.05);
	});

	it("handles message_end with missing usage fields (defaults to 0)", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, {
			type: "message_end",
			message: { usage: { input: 100 } },
		});

		expect(state.tokens.input).toBe(100);
		expect(state.tokens.output).toBe(0);
		expect(state.tokens.cacheRead).toBe(0);
		expect(state.tokens.cacheWrite).toBe(0);
	});

	it("handles message_end with null message or usage", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		// Should not throw
		applyEvent(state, { type: "message_end", message: null });
		applyEvent(state, { type: "message_end", message: {} });
		applyEvent(state, { type: "message_end" });

		expect(state.tokens.input).toBe(0);
	});

	it("counts tool calls from tool_execution_start events", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "tool_execution_start", toolName: "bash", args: { command: "ls" } });
		applyEvent(state, { type: "tool_execution_start", toolName: "read", args: { path: "foo.txt" } });
		applyEvent(state, { type: "tool_execution_start", toolName: "write", args: { path: "bar.txt" } });

		expect(state.toolCalls).toBe(3);
		expect(state.lastToolCall).toContain("write");
	});

	it("tracks currentTool and lastToolCall correctly across start/end", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "tool_execution_start", toolName: "bash", args: { command: "echo hello" } });
		expect(state.currentTool).toBe("bash: echo hello");
		expect(state.lastToolCall).toBe("bash: echo hello");

		applyEvent(state, { type: "tool_execution_end", toolName: "bash" });
		expect(state.currentTool).toBe(null);
		expect(state.lastToolCall).toBe("bash: echo hello"); // preserved

		applyEvent(state, { type: "tool_execution_start", toolName: "read", args: { path: "file.ts" } });
		expect(state.lastToolCall).toBe("read: file.ts");
	});

	it("builds tool description for tool with no string arg", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "tool_execution_start", toolName: "custom", args: { count: 42 } });
		expect(state.currentTool).toBe("custom");
	});

	it("builds tool description for tool with string args (string type)", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "tool_execution_start", toolName: "bash", args: "echo hello" });
		expect(state.currentTool).toBe("bash: echo hello");
	});

	it("truncates tool arg preview to 80 chars", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		const longArg = "x".repeat(200);
		applyEvent(state, { type: "tool_execution_start", toolName: "bash", args: { command: longArg } });
		expect(state.currentTool!.length).toBeLessThanOrEqual(80 + "bash: ".length);
	});

	it("accumulates retries from auto_retry_start/end events", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit", delayMs: 1000 });
		expect(state.retries).toHaveLength(1);
		expect(state.retries[0]).toEqual({
			attempt: 1,
			error: "rate_limit",
			delayMs: 1000,
			succeeded: false,
		});

		applyEvent(state, { type: "auto_retry_end", success: true });
		expect(state.retries[0].succeeded).toBe(true);

		applyEvent(state, { type: "auto_retry_start", attempt: 2, error: "overloaded", delayMs: 2000 });
		applyEvent(state, { type: "auto_retry_end", success: false });
		expect(state.retries).toHaveLength(2);
		expect(state.retries[1].succeeded).toBe(false);
	});

	it("auto_retry_start defaults attempt from array length when not provided", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "auto_retry_start", errorMessage: "fail" });
		expect(state.retries[0].attempt).toBe(1);
	});

	it("auto_retry_start uses error field as fallback when errorMessage is missing", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "auto_retry_start", error: "fallback_error" });
		expect(state.retries[0].error).toBe("fallback_error");
	});

	it("counts compactions from auto_compaction_start events", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "auto_compaction_start" });
		applyEvent(state, { type: "auto_compaction_start" });
		expect(state.compactions).toBe(2);
	});

	it("sets agentEnded on agent_end event", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		expect(state.agentEnded).toBe(false);
		applyEvent(state, { type: "agent_end" });
		expect(state.agentEnded).toBe(true);
	});

	it("captures error from failed response event", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "response", success: false, error: "command failed" });
		expect(state.error).toBe("command failed");
	});

	it("ignores response events without error", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, { type: "response", success: true });
		expect(state.error).toBe(null);
	});

	it("ignores null/undefined/typeless events", () => {
		const { createSessionState, applyEvent } = wrapperModule;
		const state = createSessionState();

		applyEvent(state, null);
		applyEvent(state, undefined);
		applyEvent(state, {});
		applyEvent(state, { noType: true });

		expect(state.tokens.input).toBe(0);
		expect(state.toolCalls).toBe(0);
	});
});

// ── 9. Exit Summary Building (buildExitSummary) ─────────────────────

describe("buildExitSummary — exit summary construction", () => {
	it("builds summary with all fields from accumulated state", () => {
		const { createSessionState, applyEvent, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const startTime = Date.now() - 60000; // 60 seconds ago

		applyEvent(state, {
			type: "message_end",
			message: { usage: { input: 500, output: 200, cacheRead: 50, cacheWrite: 10, cost: 0.05 } },
		});
		applyEvent(state, { type: "tool_execution_start", toolName: "bash", args: { command: "echo test" } });
		applyEvent(state, { type: "auto_compaction_start" });

		const summary = buildExitSummary(state, 0, null, null, startTime);

		expect(summary.exitCode).toBe(0);
		expect(summary.exitSignal).toBe(null);
		expect(summary.tokens).toEqual({ input: 500, output: 200, cacheRead: 50, cacheWrite: 10 });
		expect(summary.cost).toBeCloseTo(0.05);
		expect(summary.toolCalls).toBe(1);
		expect(summary.compactions).toBe(1);
		expect(summary.durationSec).toBeGreaterThanOrEqual(59);
		expect(summary.lastToolCall).toBe("bash: echo test");
		expect(summary.error).toBe(null);
	});

	it("normalizes exit code: null → null", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, null, null, null, Date.now());
		expect(summary.exitCode).toBe(null);
	});

	it("normalizes exit code: undefined → null", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, undefined, null, null, Date.now());
		expect(summary.exitCode).toBe(null);
	});

	it("normalizes exit code: negative → 1", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, -1, null, null, Date.now());
		expect(summary.exitCode).toBe(1);
	});

	it("normalizes exit code: NaN → 1", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, NaN, null, null, Date.now());
		expect(summary.exitCode).toBe(1);
	});

	it("normalizes exit code: Infinity → 1", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, Infinity, null, null, Date.now());
		expect(summary.exitCode).toBe(1);
	});

	it("preserves valid exit codes (0, 1, 137)", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		expect(buildExitSummary(state, 0, null, null, Date.now()).exitCode).toBe(0);
		expect(buildExitSummary(state, 1, null, null, Date.now()).exitCode).toBe(1);
		expect(buildExitSummary(state, 137, null, null, Date.now()).exitCode).toBe(137);
	});

	it("includes exitSignal when provided", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, null, "SIGTERM", null, Date.now());
		expect(summary.exitSignal).toBe("SIGTERM");
	});

	it("uses errorOverride over state.error", () => {
		const { createSessionState, applyEvent, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		applyEvent(state, { type: "response", success: false, error: "state error" });
		const summary = buildExitSummary(state, 1, null, "override error", Date.now());
		expect(summary.error).toBe("override error");
	});

	it("falls back to state.error when no override", () => {
		const { createSessionState, applyEvent, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		applyEvent(state, { type: "response", success: false, error: "accumulated error" });
		const summary = buildExitSummary(state, 1, null, null, Date.now());
		expect(summary.error).toBe("accumulated error");
	});

	it("returns null tokens when no tokens accumulated", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, 0, null, null, Date.now());
		expect(summary.tokens).toBe(null);
	});

	it("returns null cost when no cost accumulated", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, 0, null, null, Date.now());
		expect(summary.cost).toBe(null);
	});

	it("applies redaction to error field", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, 1, null, "Bearer sk-abcdef1234567890abcd", Date.now());
		expect(summary.error).toContain("[REDACTED]");
		expect(summary.error).not.toContain("sk-abcdef1234567890abcd");
	});

	it("applies redaction to lastToolCall field", () => {
		const { createSessionState, applyEvent, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		applyEvent(state, {
			type: "tool_execution_start",
			toolName: "bash",
			args: { command: "curl -H 'Bearer sk-abcdef1234567890abcd'" },
		});
		const summary = buildExitSummary(state, 0, null, null, Date.now());
		expect(summary.lastToolCall).toContain("[REDACTED]");
	});

	it("spawn error scenario: null exitCode + error message", () => {
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const summary = buildExitSummary(state, null, null, "spawn error: ENOENT", Date.now());
		expect(summary.exitCode).toBe(null);
		expect(summary.error).toBe("spawn error: ENOENT");
		expect(summary.tokens).toBe(null);
		expect(summary.toolCalls).toBe(0);
	});

	it("crash without agent_end: partial state is preserved", () => {
		const { createSessionState, applyEvent, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		const startTime = Date.now() - 30000;

		// Simulate partial session: some events received, then crash
		applyEvent(state, {
			type: "message_end",
			message: { usage: { input: 100, output: 50, cost: 0.01 } },
		});
		applyEvent(state, { type: "tool_execution_start", toolName: "bash", args: { command: "make build" } });
		// No agent_end, no tool_execution_end — process crashed

		const summary = buildExitSummary(state, 137, "SIGKILL", "pi process exited with code 137 (signal: SIGKILL)", startTime);

		expect(summary.exitCode).toBe(137);
		expect(summary.exitSignal).toBe("SIGKILL");
		expect(summary.error).toContain("exited with code 137");
		expect(summary.tokens).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
		expect(summary.toolCalls).toBe(1);
		expect(summary.lastToolCall).toContain("bash");
		expect(summary.durationSec).toBeGreaterThanOrEqual(29);
	});
});

// ── 10. Single-Write Guard (createSingleWriteGuard) ─────────────────

describe("createSingleWriteGuard — exactly-once semantics", () => {
	it("calls writer on first invocation and returns true", () => {
		const { createSessionState, createSingleWriteGuard } = wrapperModule;
		const summaries: any[] = [];
		const guard = createSingleWriteGuard((summary: any) => summaries.push(summary));
		const state = createSessionState();
		const startTime = Date.now();

		const result = guard(state, 0, null, null, startTime);

		expect(result).toBe(true);
		expect(summaries).toHaveLength(1);
	});

	it("returns false on subsequent invocations (no double-write)", () => {
		const { createSessionState, createSingleWriteGuard } = wrapperModule;
		const summaries: any[] = [];
		const guard = createSingleWriteGuard((summary: any) => summaries.push(summary));
		const state = createSessionState();
		const startTime = Date.now();

		guard(state, 0, null, null, startTime);
		const result2 = guard(state, 1, null, "different error", startTime);
		const result3 = guard(state, null, "SIGTERM", null, startTime);

		expect(result2).toBe(false);
		expect(result3).toBe(false);
		expect(summaries).toHaveLength(1);
	});

	it("first writer wins: close handler vs error handler race", () => {
		const { createSessionState, createSingleWriteGuard } = wrapperModule;
		const summaries: any[] = [];
		const guard = createSingleWriteGuard((summary: any) => summaries.push(summary));
		const state = createSessionState();
		const startTime = Date.now();

		// Simulate error handler firing first
		guard(state, null, null, "spawn error: ENOENT", startTime);
		// Then close handler fires — should be a no-op
		guard(state, 1, null, null, startTime);

		expect(summaries).toHaveLength(1);
		expect(summaries[0].error).toBe("spawn error: ENOENT");
		expect(summaries[0].exitCode).toBe(null);
	});

	it("first writer wins: close handler vs signal handler race", () => {
		const { createSessionState, applyEvent, createSingleWriteGuard } = wrapperModule;
		const summaries: any[] = [];
		const guard = createSingleWriteGuard((summary: any) => summaries.push(summary));
		const state = createSessionState();
		const startTime = Date.now();

		// Simulate close handler winning
		guard(state, 0, null, null, startTime);
		// Signal handler fires late
		guard(state, null, "SIGTERM", "killed by signal", startTime);

		expect(summaries).toHaveLength(1);
		expect(summaries[0].exitCode).toBe(0);
		expect(summaries[0].error).toBe(null);
	});

	it("builds and redacts the summary passed to writer", () => {
		const { createSessionState, applyEvent, createSingleWriteGuard } = wrapperModule;
		const summaries: any[] = [];
		const guard = createSingleWriteGuard((summary: any) => summaries.push(summary));
		const state = createSessionState();
		const startTime = Date.now();

		applyEvent(state, {
			type: "message_end",
			message: { usage: { input: 100, output: 50, cost: 0.01 } },
		});

		guard(state, 0, null, "Bearer sk-abcdef1234567890abcd", startTime);

		expect(summaries).toHaveLength(1);
		expect(summaries[0].tokens).toEqual({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
		expect(summaries[0].error).toContain("[REDACTED]");
	});
});

// ── 11. Integration: Mock pi process end-to-end ─────────────────────

describe("integration — mock pi process end-to-end", () => {
	it("produces correct sidecar JSONL and exit summary from scripted events", async () => {
		const { execFile } = await import("child_process");
		const { promisify } = await import("util");
		const { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } = await import("fs");
		const { tmpdir } = await import("os");
		const execFileAsync = promisify(execFile);

		const tmpDir = join(tmpdir(), `rpc-wrapper-integ-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });

		const promptFile = join(tmpDir, "prompt.md");
		const sidecarPath = join(tmpDir, "sidecar.jsonl");
		const summaryPath = join(tmpDir, "summary.json");

		// Write a minimal prompt
		writeFileSync(promptFile, "test prompt");

		// Create a mock pi script that reads the prompt command from stdin
		// and emits a scripted sequence of RPC events, then exits cleanly.
		const mockPiScript = join(tmpDir, "mock-pi.mjs");
		writeFileSync(mockPiScript, `
import process from 'process';

// Read all stdin, then emit events once we see a prompt command.
let stdinBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
	stdinBuf += chunk;
	// Look for a complete JSONL prompt command
	const newlineIdx = stdinBuf.indexOf('\\n');
	if (newlineIdx === -1) return;
	const line = stdinBuf.slice(0, newlineIdx);
	stdinBuf = stdinBuf.slice(newlineIdx + 1);

	let cmd;
	try { cmd = JSON.parse(line); } catch { return; }
	if (cmd.type !== 'prompt') return;

	// Emit scripted RPC events
	const events = [
		{ type: "response", success: true },
		{ type: "agent_start" },
		{ type: "tool_execution_start", toolName: "bash", args: { command: "echo hello" } },
		{ type: "tool_execution_end", toolName: "bash", result: { output: "hello" } },
		{ type: "message_end", message: { usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: 0.0123 } } },
		{ type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit", delayMs: 1000 },
		{ type: "auto_retry_end", success: true },
		{ type: "auto_compaction_start" },
		{ type: "tool_execution_start", toolName: "read", args: { path: "file.ts" } },
		{ type: "tool_execution_end", toolName: "read", result: { content: "..." } },
		{ type: "message_end", message: { usage: { input: 200, output: 100, cacheRead: 20, cacheWrite: 10, cost: 0.0234 } } },
		{ type: "agent_end" },
	];

	for (const evt of events) {
		process.stdout.write(JSON.stringify(evt) + '\\n');
	}
});

// Exit cleanly when stdin closes
process.stdin.on('end', () => {
	process.exit(0);
});
`);

		// Run rpc-wrapper.mjs, using node to execute the mock pi script
		// We override the pi command by passing -- to use our mock instead
		// However, rpc-wrapper spawns "pi" directly. We need to create a pi shim
		// that delegates to our mock script.
		const shimDir = join(tmpDir, "bin");
		mkdirSync(shimDir, { recursive: true });

		// On Windows, create a pi.cmd shim; on Unix, a pi shell script
		const isWindows = process.platform === "win32";
		if (isWindows) {
			// Create pi.cmd that ignores all pi args and runs our mock script
			writeFileSync(join(shimDir, "pi.cmd"), `@echo off\nnode "${mockPiScript.replace(/\\/g, "\\\\")}" %*\n`);
		} else {
			writeFileSync(join(shimDir, "pi"), `#!/bin/sh\nexec node "${mockPiScript}" "$@"\n`);
			const { chmodSync } = await import("fs");
			chmodSync(join(shimDir, "pi"), 0o755);
		}

		// Run rpc-wrapper with our shimmed PATH (our shim dir prepended)
		const wrapperAbsPath = resolve(__dirname, "../../bin/rpc-wrapper.mjs");
		const pathSep = isWindows ? ";" : ":";
		const env = {
			...process.env,
			PATH: shimDir + pathSep + (process.env.PATH || ""),
		};

		try {
			const { stdout, stderr } = await execFileAsync("node", [
				wrapperAbsPath,
				"--sidecar-path", sidecarPath,
				"--exit-summary-path", summaryPath,
				"--prompt-file", promptFile,
			], {
				env,
				timeout: 30000,
			});

			// Verify sidecar file exists and contains expected events
			expect(existsSync(sidecarPath)).toBe(true);
			const sidecarContent = readFileSync(sidecarPath, "utf-8").trim();
			const sidecarLines = sidecarContent.split("\n").map((l: string) => JSON.parse(l));

			// Should have all 12 events
			expect(sidecarLines.length).toBe(12);

			// Check event types in order
			const types = sidecarLines.map((e: any) => e.type);
			expect(types).toEqual([
				"response",
				"agent_start",
				"tool_execution_start",
				"tool_execution_end",
				"message_end",
				"auto_retry_start",
				"auto_retry_end",
				"auto_compaction_start",
				"tool_execution_start",
				"tool_execution_end",
				"message_end",
				"agent_end",
			]);

			// Each sidecar entry should have a timestamp
			for (const entry of sidecarLines) {
				expect(typeof entry.ts).toBe("number");
				expect(entry.ts).toBeGreaterThan(0);
			}

			// Verify exit summary file exists and is valid JSON
			expect(existsSync(summaryPath)).toBe(true);
			const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));

			// Verify summary fields
			expect(summary.exitCode).toBe(0);
			expect(summary.exitSignal).toBe(null);
			expect(summary.tokens).toEqual({ input: 300, output: 150, cacheRead: 30, cacheWrite: 15 });
			expect(summary.cost).toBeCloseTo(0.0357);
			expect(summary.toolCalls).toBe(2);
			expect(summary.compactions).toBe(1);
			expect(summary.retries).toHaveLength(1);
			expect(summary.retries[0].succeeded).toBe(true);
			expect(summary.durationSec).toBeGreaterThanOrEqual(0);
			expect(summary.lastToolCall).toContain("read");
			expect(summary.error).toBe(null);
		} finally {
			// Cleanup
			try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
		}
	}, 30000);

	it("handles mock pi crash (non-zero exit, no agent_end) — writes summary with error", async () => {
		const { execFile } = await import("child_process");
		const { promisify } = await import("util");
		const { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } = await import("fs");
		const { tmpdir } = await import("os");
		const execFileAsync = promisify(execFile);

		const tmpDir = join(tmpdir(), `rpc-wrapper-crash-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });

		const promptFile = join(tmpDir, "prompt.md");
		const sidecarPath = join(tmpDir, "sidecar.jsonl");
		const summaryPath = join(tmpDir, "summary.json");
		writeFileSync(promptFile, "crash test prompt");

		// Mock pi that emits one event, then crashes
		const mockPiScript = join(tmpDir, "mock-pi-crash.mjs");
		writeFileSync(mockPiScript, `
import process from 'process';

let responded = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
	if (responded) return; // Ignore get_session_stats and other follow-up commands
	responded = true;
	// Emit one event then crash
	process.stdout.write(JSON.stringify({ type: "agent_start" }) + '\\n');
	process.stdout.write(JSON.stringify({
		type: "tool_execution_start", toolName: "bash", args: { command: "make build" }
	}) + '\\n');
	process.stdout.write(JSON.stringify({
		type: "message_end",
		message: { usage: { input: 50, output: 25, cost: 0.005 } }
	}) + '\\n');

	// Crash without agent_end
	setTimeout(() => process.exit(1), 100);
});
`);

		const shimDir = join(tmpDir, "bin");
		mkdirSync(shimDir, { recursive: true });

		const isWindows = process.platform === "win32";
		if (isWindows) {
			writeFileSync(join(shimDir, "pi.cmd"), `@echo off\nnode "${mockPiScript.replace(/\\/g, "\\\\")}" %*\n`);
		} else {
			writeFileSync(join(shimDir, "pi"), `#!/bin/sh\nexec node "${mockPiScript}" "$@"\n`);
			const { chmodSync } = await import("fs");
			chmodSync(join(shimDir, "pi"), 0o755);
		}

		const wrapperAbsPath = resolve(__dirname, "../../bin/rpc-wrapper.mjs");
		const pathSep = isWindows ? ";" : ":";
		const env = {
			...process.env,
			PATH: shimDir + pathSep + (process.env.PATH || ""),
		};

		try {
			// The wrapper should exit with the pi process exit code (1)
			await execFileAsync("node", [
				wrapperAbsPath,
				"--sidecar-path", sidecarPath,
				"--exit-summary-path", summaryPath,
				"--prompt-file", promptFile,
			], { env, timeout: 30000 });
			// If it doesn't throw, that's also fine — check summary
		} catch (err: any) {
			// Expected: non-zero exit
			expect(err.code).toBe(1);
		}

		// Summary should still be written with partial data
		expect(existsSync(summaryPath)).toBe(true);
		const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));

		expect(summary.exitCode).toBe(1);
		expect(summary.error).toBeTruthy(); // Should have crash error message
		expect(summary.tokens).toEqual({ input: 50, output: 25, cacheRead: 0, cacheWrite: 0 });
		expect(summary.toolCalls).toBe(1);
		expect(summary.lastToolCall).toContain("bash");

		// Sidecar should have the events that were received before crash
		expect(existsSync(sidecarPath)).toBe(true);
		const sidecarContent = readFileSync(sidecarPath, "utf-8").trim();
		const sidecarLines = sidecarContent.split("\n").map((l: string) => JSON.parse(l));
		expect(sidecarLines.length).toBeGreaterThanOrEqual(3);

		// Cleanup
		try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
	}, 30000);

	it("spawn failure produces valid summary via extracted buildExitSummary", () => {
		// When the pi binary is not found, the spawn error handler fires
		// and calls buildExitSummary with null exitCode and a spawn error message.
		// This tests the same code path without fragile PATH manipulation and
		// platform-specific shell behavior.
		const { createSessionState, buildExitSummary } = wrapperModule;
		const state = createSessionState();
		// No events were applied — state is empty (pi never ran)

		const summary = buildExitSummary(state, null, null, "spawn error: ENOENT", Date.now());

		expect(summary.exitCode).toBe(null);
		expect(summary.error).toBe("spawn error: ENOENT");
		expect(summary.tokens).toBe(null);
		expect(summary.cost).toBe(null);
		expect(summary.toolCalls).toBe(0);
		expect(summary.retries).toEqual([]);
		expect(summary.compactions).toBe(0);
		expect(summary.lastToolCall).toBe(null);
		expect(summary.durationSec).toBeGreaterThanOrEqual(0);
	});
});
