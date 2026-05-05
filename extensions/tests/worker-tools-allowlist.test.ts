/**
 * Tests for engine-bridge-tools allowlist helper — TP-184
 *
 * Covers:
 * - `buildWorkerToolsAllowlist` produces the correct combined string for
 *   every input shape (null, undefined, empty, whitespace, custom, with
 *   already-included bridge tools, with extra whitespace/empty entries)
 * - Output formatting (no leading/trailing commas, no spaces, deduped)
 * - `ENGINE_BRIDGE_TOOLS` shape and alignment with the registrations in
 *   `agent-bridge-extension.ts`
 *
 * Issue #530: workers were missing review_step, notify_supervisor, and
 * request_segment_expansion from their --tools allowlist; this caused
 * plan/code/test reviews to silently never fire at Review Level >= 1.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	ENGINE_BRIDGE_TOOLS,
	DEFAULT_WORKER_USER_TOOLS,
	buildWorkerToolsAllowlist,
} from "../taskplane/agent-host.ts";

describe("buildWorkerToolsAllowlist", () => {
	it("undefined input → returns DEFAULT_WORKER_USER_TOOLS + bridge tools", () => {
		const result = buildWorkerToolsAllowlist(undefined);
		const expected =
			DEFAULT_WORKER_USER_TOOLS + "," + ENGINE_BRIDGE_TOOLS.join(",");
		assert.strictEqual(result, expected);
	});

	it("null input → same as undefined", () => {
		const result = buildWorkerToolsAllowlist(null);
		const expected =
			DEFAULT_WORKER_USER_TOOLS + "," + ENGINE_BRIDGE_TOOLS.join(",");
		assert.strictEqual(result, expected);
	});

	it("empty string input → same as undefined", () => {
		const result = buildWorkerToolsAllowlist("");
		const expected =
			DEFAULT_WORKER_USER_TOOLS + "," + ENGINE_BRIDGE_TOOLS.join(",");
		assert.strictEqual(result, expected);
	});

	it("whitespace-only string input → same as undefined", () => {
		const result = buildWorkerToolsAllowlist("   \t  ");
		const expected =
			DEFAULT_WORKER_USER_TOOLS + "," + ENGINE_BRIDGE_TOOLS.join(",");
		assert.strictEqual(result, expected);
	});

	it("custom user tools → returns user tools + bridge tools (in order)", () => {
		const result = buildWorkerToolsAllowlist("read,write");
		assert.strictEqual(
			result,
			"read,write," + ENGINE_BRIDGE_TOOLS.join(","),
		);
	});

	it("user tools that already include a bridge tool → no duplication", () => {
		const result = buildWorkerToolsAllowlist("read,write,review_step");
		// review_step appears exactly once
		const occurrences = result.split(",").filter((t) => t === "review_step").length;
		assert.strictEqual(occurrences, 1, "review_step should not be duplicated");
		// All bridge tools still present
		for (const t of ENGINE_BRIDGE_TOOLS) {
			assert.ok(result.split(",").includes(t), `expected ${t} in result`);
		}
		// User-supplied entries preserved
		assert.ok(result.split(",").includes("read"));
		assert.ok(result.split(",").includes("write"));
	});

	it("user tools with extra whitespace and empty entries → trimmed and filtered", () => {
		const result = buildWorkerToolsAllowlist("read, ,write,");
		const tokens = result.split(",");
		// No empty entries
		for (const t of tokens) {
			assert.notStrictEqual(t, "", "no empty token in result");
			assert.strictEqual(t, t.trim(), `token '${t}' should be trimmed`);
		}
		// User-supplied non-empty entries preserved
		assert.ok(tokens.includes("read"));
		assert.ok(tokens.includes("write"));
		// Bridge tools still appended
		for (const bt of ENGINE_BRIDGE_TOOLS) {
			assert.ok(tokens.includes(bt));
		}
	});

	it("output string has no leading/trailing commas, no whitespace", () => {
		const result = buildWorkerToolsAllowlist("read,write");
		assert.doesNotMatch(result, /^,/, "no leading comma");
		assert.doesNotMatch(result, /,$/, "no trailing comma");
		assert.doesNotMatch(result, /\s/, "no whitespace anywhere");
	});

	it("output is deduped overall (custom user tools repeating themselves)", () => {
		const result = buildWorkerToolsAllowlist("read,write,read,bash");
		const tokens = result.split(",");
		const unique = new Set(tokens);
		assert.strictEqual(tokens.length, unique.size,
			"each tool should appear exactly once");
	});
});

describe("ENGINE_BRIDGE_TOOLS", () => {
	it("contains exactly three entries", () => {
		assert.strictEqual(ENGINE_BRIDGE_TOOLS.length, 3);
	});

	it("entries are exactly review_step, notify_supervisor, request_segment_expansion", () => {
		assert.deepStrictEqual(
			[...ENGINE_BRIDGE_TOOLS].sort(),
			["notify_supervisor", "request_segment_expansion", "review_step"],
		);
	});

	it("each entry is registered as a tool name in agent-bridge-extension.ts", () => {
		// String-presence assertion modeled on lane-runner-v2.test.ts patterns:
		// ensures the canonical constant stays in sync with the bridge
		// extension's registrations. If a registration is renamed, this test
		// will fail and we'll know to update ENGINE_BRIDGE_TOOLS.
		const bridgeSrc = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "agent-bridge-extension.ts"),
			"utf-8",
		);
		for (const toolName of ENGINE_BRIDGE_TOOLS) {
			// Look for `name: "toolName"` (the registration field)
			const pattern = `name: "${toolName}"`;
			assert.ok(
				bridgeSrc.includes(pattern),
				`agent-bridge-extension.ts should register tool ${toolName} (looked for ${pattern})`,
			);
		}
	});
});

describe("DEFAULT_WORKER_USER_TOOLS", () => {
	it("is a non-empty comma-separated string", () => {
		assert.strictEqual(typeof DEFAULT_WORKER_USER_TOOLS, "string");
		assert.ok(DEFAULT_WORKER_USER_TOOLS.length > 0);
		assert.ok(DEFAULT_WORKER_USER_TOOLS.includes(","));
	});

	it("does NOT include any engine bridge tool by default (those are appended by the helper)", () => {
		const tokens = DEFAULT_WORKER_USER_TOOLS.split(",").map((s) => s.trim());
		for (const bridgeTool of ENGINE_BRIDGE_TOOLS) {
			assert.ok(
				!tokens.includes(bridgeTool),
				`DEFAULT_WORKER_USER_TOOLS should not include bridge tool ${bridgeTool}; bridge tools are appended by buildWorkerToolsAllowlist()`,
			);
		}
	});
});
