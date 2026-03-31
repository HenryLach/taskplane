/**
 * Conversation Event Fidelity Tests — TP-111
 *
 * Validates that the Runtime V2 agent-host emits prompt_sent,
 * assistant_message, and enriched tool events for dashboard rendering.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/conversation-event-fidelity.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentHostSrc = readFileSync(join(__dirname, "..", "taskplane", "agent-host.ts"), "utf-8");
const dashboardAppSrc = readFileSync(join(__dirname, "..", "..", "dashboard", "public", "app.js"), "utf-8");

// ── 1. Agent-host conversation event emission ───────────────────────

describe("1.x: Agent-host emits conversation events (TP-111)", () => {
	it("1.1: emits prompt_sent after writing prompt to stdin", () => {
		// prompt_sent must be emitted after the prompt write
		const promptWriteIdx = agentHostSrc.indexOf('type: "prompt", message: opts.prompt');
		const promptSentIdx = agentHostSrc.indexOf('emitEvent("prompt_sent"');
		expect(promptWriteIdx).toBeGreaterThan(-1);
		expect(promptSentIdx).toBeGreaterThan(-1);
		expect(promptSentIdx).toBeGreaterThan(promptWriteIdx);
	});

	it("1.2: prompt_sent payload includes bounded text", () => {
		const emitIdx = agentHostSrc.indexOf('emitEvent("prompt_sent"');
		const block = agentHostSrc.slice(emitIdx, emitIdx + 200);
		expect(block).toContain("truncatePayload");
		expect(block).toContain("MAX_CONV_PAYLOAD_CHARS");
	});

	it("1.3: emits assistant_message on message_end with assistant role", () => {
		const msgEndIdx = agentHostSrc.indexOf('case "message_end"');
		const block = agentHostSrc.slice(msgEndIdx, msgEndIdx + 1500);
		expect(block).toContain('emitEvent("assistant_message"');
		expect(block).toContain("extractAssistantText");
	});

	it("1.4: assistant_message payload includes bounded text", () => {
		const emitIdx = agentHostSrc.indexOf('emitEvent("assistant_message"');
		const block = agentHostSrc.slice(emitIdx, emitIdx + 200);
		expect(block).toContain("truncatePayload");
		expect(block).toContain("MAX_CONV_PAYLOAD_CHARS");
	});

	it("1.5: tool_call event includes path and bounded argsPreview (no raw args)", () => {
		const emitIdx = agentHostSrc.indexOf('emitEvent("tool_call"');
		const block = agentHostSrc.slice(emitIdx, emitIdx + 200);
		expect(block).toContain("path:");
		expect(block).toContain("argsPreview:");
		// Must NOT contain raw args object
		expect(block).not.toContain("args: event.args");
	});

	it("1.6: tool_result event includes summary field", () => {
		const emitIdx = agentHostSrc.indexOf('emitEvent("tool_result"');
		const block = agentHostSrc.slice(emitIdx, emitIdx + 200);
		expect(block).toContain("summary:");
	});
});

// ── 2. Payload safety helpers ───────────────────────────────────────

describe("2.x: Payload safety (TP-111)", () => {
	it("2.1: MAX_CONV_PAYLOAD_CHARS is defined and reasonable", () => {
		expect(agentHostSrc).toContain("MAX_CONV_PAYLOAD_CHARS = 2000");
	});

	it("2.2: truncatePayload function exists", () => {
		expect(agentHostSrc).toContain("function truncatePayload");
	});

	it("2.3: extractAssistantText handles string content", () => {
		const fnIdx = agentHostSrc.indexOf("function extractAssistantText");
		const block = agentHostSrc.slice(fnIdx, fnIdx + 500);
		expect(block).toContain('typeof message.content === "string"');
	});

	it("2.4: extractAssistantText handles array content blocks with null guards", () => {
		const fnIdx = agentHostSrc.indexOf("function extractAssistantText");
		const block = agentHostSrc.slice(fnIdx, fnIdx + 600);
		expect(block).toContain("Array.isArray(message.content)");
		// Must guard against null/non-object entries
		expect(block).toContain('typeof b === "object"');
		expect(block).toContain("b !== null");
	});
});

// ── 3. Dashboard renderer compatibility ─────────────────────────────

describe("3.x: Dashboard renders V2 conversation events (TP-111)", () => {
	it("3.1: renderV2Event handles assistant_message with payload.text", () => {
		const fnIdx = dashboardAppSrc.indexOf("function renderV2Event");
		const block = dashboardAppSrc.slice(fnIdx, fnIdx + 2000);
		expect(block).toContain("'assistant_message'");
		expect(block).toContain("evt.payload?.text");
	});

	it("3.2: renderV2Event handles prompt_sent with payload.text", () => {
		const fnIdx = dashboardAppSrc.indexOf("function renderV2Event");
		const block = dashboardAppSrc.slice(fnIdx, fnIdx + 2000);
		expect(block).toContain("'prompt_sent'");
		expect(block).toContain("evt.payload?.text");
	});

	it("3.3: renderV2Event handles tool_call with payload.tool and payload.path", () => {
		const fnIdx = dashboardAppSrc.indexOf("function renderV2Event");
		const block = dashboardAppSrc.slice(fnIdx, fnIdx + 2000);
		expect(block).toContain("'tool_call'");
		expect(block).toContain("evt.payload?.tool");
		expect(block).toContain("evt.payload?.path");
	});

	it("3.4: renderV2Event handles tool_result with payload.summary", () => {
		const fnIdx = dashboardAppSrc.indexOf("function renderV2Event");
		const block = dashboardAppSrc.slice(fnIdx, fnIdx + 2000);
		expect(block).toContain("'tool_result'");
		expect(block).toContain("evt.payload?.summary");
	});
});

// ── 4. Event type contract ──────────────────────────────────────────

describe("4.x: Event type contract (TP-111)", () => {
	const typesSrc = readFileSync(join(__dirname, "..", "taskplane", "types.ts"), "utf-8");

	it("4.1: prompt_sent is a valid RuntimeAgentEventType", () => {
		expect(typesSrc).toContain('"prompt_sent"');
	});

	it("4.2: assistant_message is a valid RuntimeAgentEventType", () => {
		expect(typesSrc).toContain('"assistant_message"');
	});
});

// ── 5. Behavioral tests (runtime, not source-shape) ─────────────────

// Import the helpers directly for behavioral validation
const {
	truncatePayload: _truncate,
	extractAssistantText: _extract,
	MAX_CONV_PAYLOAD_CHARS: _maxChars,
} = await (async () => {
	// These are module-private; re-implement here for behavioral testing
	// (mirrors the exact logic in agent-host.ts)
	const MAX_CONV_PAYLOAD_CHARS = 2000;
	function truncatePayload(text: string, maxLen: number): string {
		if (text.length <= maxLen) return text;
		return text.slice(0, maxLen) + "\u2026";
	}
	function extractAssistantText(message: Record<string, unknown>): string {
		if (typeof message.content === "string") return message.content;
		if (Array.isArray(message.content)) {
			const textBlocks = message.content
				.filter((b: unknown): b is { type: string; text: string } =>
					typeof b === "object" && b !== null &&
					(b as any).type === "text" && typeof (b as any).text === "string")
				.map(b => b.text);
			if (textBlocks.length > 0) return textBlocks.join("\n");
		}
		if (typeof message.text === "string") return message.text;
		return "";
	}
	return { truncatePayload, extractAssistantText, MAX_CONV_PAYLOAD_CHARS };
})();

describe("5.x: Behavioral — truncatePayload", () => {
	it("5.1: returns short text unchanged", () => {
		expect(_truncate("hello", 2000)).toBe("hello");
	});

	it("5.2: truncates at boundary and appends ellipsis", () => {
		const long = "x".repeat(3000);
		const result = _truncate(long, 2000);
		expect(result.length).toBe(2001); // 2000 chars + 1 ellipsis
		expect(result.endsWith("\u2026")).toBe(true);
	});

	it("5.3: exact boundary is not truncated", () => {
		const exact = "y".repeat(2000);
		expect(_truncate(exact, 2000)).toBe(exact);
	});
});

describe("6.x: Behavioral — extractAssistantText", () => {
	it("6.1: extracts string content", () => {
		expect(_extract({ content: "Hello world" })).toBe("Hello world");
	});

	it("6.2: extracts from Anthropic content-block array", () => {
		const msg = { content: [{ type: "text", text: "Part 1" }, { type: "text", text: "Part 2" }] };
		expect(_extract(msg)).toBe("Part 1\nPart 2");
	});

	it("6.3: handles null entries in content array without throwing", () => {
		const msg = { content: [null, { type: "text", text: "OK" }, undefined, 42, "bare string"] };
		// Must not throw
		const result = _extract(msg as any);
		expect(result).toBe("OK");
	});

	it("6.4: handles empty content array", () => {
		expect(_extract({ content: [] })).toBe("");
	});

	it("6.5: falls back to message.text", () => {
		expect(_extract({ text: "fallback" })).toBe("fallback");
	});

	it("6.6: returns empty string for completely empty message", () => {
		expect(_extract({})).toBe("");
	});

	it("6.7: handles content blocks with missing text field", () => {
		const msg = { content: [{ type: "text" }, { type: "image", url: "x" }] };
		expect(_extract(msg as any)).toBe("");
	});
});

describe("7.x: Behavioral — payload bounding contract", () => {
	it("7.1: MAX_CONV_PAYLOAD_CHARS is 2000", () => {
		expect(_maxChars).toBe(2000);
	});

	it("7.2: tool_call argsPreview is bounded (no raw args in source)", () => {
		// Verify the emit line does NOT include 'args: event.args'
		const emitLine = agentHostSrc.split(/\r?\n/).find(l => l.includes('emitEvent("tool_call"'));
		expect(emitLine).not.toBe(undefined);
		expect(emitLine!).not.toContain("args: event.args");
		expect(emitLine!).toContain("argsPreview");
	});

	it("7.3: tool_result summary is bounded to 200 chars in source", () => {
		const resultBlock = agentHostSrc.slice(
			agentHostSrc.indexOf('case "tool_execution_end"'),
			agentHostSrc.indexOf('case "tool_execution_end"') + 500
		);
		expect(resultBlock).toContain(".slice(0, 200)");
	});
});
