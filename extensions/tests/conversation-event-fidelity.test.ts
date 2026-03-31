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

	it("1.5: tool_call event includes path field", () => {
		const emitIdx = agentHostSrc.indexOf('emitEvent("tool_call"');
		const block = agentHostSrc.slice(emitIdx, emitIdx + 200);
		expect(block).toContain("path:");
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

	it("2.4: extractAssistantText handles array content blocks", () => {
		const fnIdx = agentHostSrc.indexOf("function extractAssistantText");
		const block = agentHostSrc.slice(fnIdx, fnIdx + 500);
		expect(block).toContain("Array.isArray(message.content)");
		expect(block).toContain('b.type === "text"');
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
