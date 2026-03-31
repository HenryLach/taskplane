/**
 * Orchestrator Supervisor Recovery Tools Tests — TP-096
 *
 * Tests for the four new supervisor recovery tools:
 *   1.x — read_agent_status: tool registration + parameter schema
 *   2.x — trigger_wrap_up: tool registration + parameter schema
 *   3.x — read_lane_logs: tool registration + parameter schema
 *   4.x — list_active_agents: tool registration + parameter schema
 *   5.x — Dashboard server: merge agent telemetry fields
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/orch-supervisor-recovery-tools.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read extension.ts source for structural verification
const extensionSource = readFileSync(
	join(__dirname, "..", "taskplane", "extension.ts"),
	"utf-8",
);

// Read dashboard server source for telemetry verification
const serverSource = readFileSync(
	join(__dirname, "..", "..", "dashboard", "server.cjs"),
	"utf-8",
);

// Read dashboard client source for UI verification
const appSource = readFileSync(
	join(__dirname, "..", "..", "dashboard", "public", "app.js"),
	"utf-8",
);

/**
 * Helper to extract a tool registration block from the source.
 * Finds the registerTool call containing the given tool name.
 */
function getToolBlock(name: string, source: string = extensionSource): string {
	const marker = `name: "${name}"`;
	const idx = source.indexOf(marker);
	if (idx === -1) return "";
	// Walk back to find pi.registerTool({
	const registerIdx = source.lastIndexOf("pi.registerTool(", idx);
	// Walk forward to find the end — look for `\n\t});` pattern
	const afterMarker = source.indexOf("\n\t});", idx);
	return source.slice(registerIdx, afterMarker + 5);
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — read_agent_status tool
// ══════════════════════════════════════════════════════════════════════

describe("1.x: read_agent_status tool", () => {
	it("1.1: tool is registered", () => {
		expect(extensionSource).toContain('name: "read_agent_status"');
	});

	it("1.2: has optional lane number parameter", () => {
		const block = getToolBlock("read_agent_status");
		expect(block).toContain("lane:");
		expect(block).toContain("Type.Optional(Type.Number(");
	});

	it("1.3: has description and promptSnippet", () => {
		const block = getToolBlock("read_agent_status");
		expect(block).toContain("description:");
		expect(block).toContain("promptSnippet:");
		expect(block).toContain("promptGuidelines:");
	});

	it("1.4: execute handler catches errors", () => {
		const block = getToolBlock("read_agent_status");
		expect(block).toContain("} catch (err)");
		expect(block).toContain('type: "text"');
	});

	it("1.5: doReadAgentStatus helper exists", () => {
		expect(extensionSource).toContain("function doReadAgentStatus(");
	});

	it("1.6: reads STATUS.md using canonical task path resolution", () => {
		const idx = extensionSource.indexOf("function doReadAgentStatus(");
		const block = extensionSource.slice(idx, idx + 3000);
		expect(block).toContain("resolveCanonicalTaskPaths(");
		expect(block).toContain("statusPath");
		expect(block).toContain("Current Step:");
	});

	it("1.7: reads lane-state sidecar", () => {
		const idx = extensionSource.indexOf("function doReadAgentStatus(");
		const block = extensionSource.slice(idx, idx + 4000);
		expect(block).toContain("lane-state-");
		expect(block).toContain("workerContextPct");
		expect(block).toContain("workerCostUsd");
	});

	it("1.8: handles missing lane gracefully", () => {
		const idx = extensionSource.indexOf("function doReadAgentStatus(");
		const block = extensionSource.slice(idx, idx + 500);
		expect(block).toContain("not found in batch");
	});

	it("1.9: returns all lanes when lane is omitted", () => {
		const idx = extensionSource.indexOf("function doReadAgentStatus(");
		const block = extensionSource.slice(idx, idx + 500);
		// When lane is undefined, it should use all lanes
		expect(block).toContain("lane != null");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — trigger_wrap_up tool
// ══════════════════════════════════════════════════════════════════════

describe("2.x: trigger_wrap_up tool", () => {
	it("2.1: tool is registered", () => {
		expect(extensionSource).toContain('name: "trigger_wrap_up"');
	});

	it("2.2: has required lane number parameter", () => {
		const block = getToolBlock("trigger_wrap_up");
		expect(block).toContain("lane:");
		expect(block).toContain("Type.Number(");
	});

	it("2.3: has description and promptSnippet", () => {
		const block = getToolBlock("trigger_wrap_up");
		expect(block).toContain("description:");
		expect(block).toContain("promptSnippet:");
		expect(block).toContain("promptGuidelines:");
	});

	it("2.4: doTriggerWrapUp helper exists", () => {
		expect(extensionSource).toContain("function doTriggerWrapUp(");
	});

	it("2.5: writes .task-wrap-up file", () => {
		const idx = extensionSource.indexOf("function doTriggerWrapUp(");
		const block = extensionSource.slice(idx, idx + 1500);
		expect(block).toContain(".task-wrap-up");
		expect(block).toContain("writeFileSync");
	});

	it("2.6: validates running task exists", () => {
		const idx = extensionSource.indexOf("function doTriggerWrapUp(");
		const block = extensionSource.slice(idx, idx + 800);
		expect(block).toContain("No running task on lane");
	});

	it("2.7: resolves wrap-up path via canonical task paths (workspace-safe)", () => {
		const idx = extensionSource.indexOf("function doTriggerWrapUp(");
		const block = extensionSource.slice(idx, idx + 2200);
		expect(block).toContain("resolveCanonicalTaskPaths(");
		expect(block).toContain("taskFolderResolved");
		expect(block).toContain(".task-wrap-up");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — read_lane_logs tool
// ══════════════════════════════════════════════════════════════════════

describe("3.x: read_lane_logs tool", () => {
	it("3.1: tool is registered", () => {
		expect(extensionSource).toContain('name: "read_lane_logs"');
	});

	it("3.2: has required lane number parameter", () => {
		const block = getToolBlock("read_lane_logs");
		expect(block).toContain("lane:");
		expect(block).toContain("Type.Number(");
	});

	it("3.3: doReadLaneLogs helper exists", () => {
		expect(extensionSource).toContain("function doReadLaneLogs(");
	});

	it("3.4: reads stderr logs from telemetry naming pattern", () => {
		const idx = extensionSource.indexOf("function doReadLaneLogs(");
		const block = extensionSource.slice(idx, idx + 2500);
		expect(block).toContain("-lane-${lane}-worker");
		expect(block).toContain("-stderr.log");
		expect(block).toContain("telemetry");
	});

	it("3.5: reads exit diagnostic files", () => {
		const idx = extensionSource.indexOf("function doReadLaneLogs(");
		const block = extensionSource.slice(idx, idx + 6000);
		expect(block).toContain("worker-exit");
		expect(block).toContain("classification");
		expect(block).toContain("exitCode");
	});

	it("3.6: handles missing log gracefully", () => {
		const idx = extensionSource.indexOf("function doReadLaneLogs(");
		const block = extensionSource.slice(idx, idx + 3000);
		expect(block).toContain("No stderr log found for lane");
	});

	it("3.7: truncates large logs", () => {
		const idx = extensionSource.indexOf("function doReadLaneLogs(");
		const block = extensionSource.slice(idx, idx + 6000);
		expect(block).toContain("5000");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — list_active_agents tool
// ══════════════════════════════════════════════════════════════════════

describe("4.x: list_active_agents tool", () => {
	it("4.1: tool is registered", () => {
		expect(extensionSource).toContain('name: "list_active_agents"');
	});

	it("4.2: has empty parameters", () => {
		const block = getToolBlock("list_active_agents");
		expect(block).toContain("Type.Object({})");
	});

	it("4.3: doListActiveAgents helper exists", () => {
		expect(extensionSource).toContain("function doListActiveAgents(");
	});

	it("4.4: parses session names for role detection", () => {
		const idx = extensionSource.indexOf("function doListActiveAgents(");
		const block = extensionSource.slice(idx, idx + 4000);
		// TP-106: doListActiveAgents now checks registry first, then falls back to TMUX parsing
		expect(block).toContain("-lane-");
		expect(block).toContain("-merge-");
		expect(block).toContain("worker");
	});

	it("4.5: reads lane-state sidecar for context %", () => {
		const idx = extensionSource.indexOf("function doListActiveAgents(");
		const block = extensionSource.slice(idx, idx + 4000);
		expect(block).toContain("lane-state-");
		expect(block).toContain("workerContextPct");
	});

	it("4.6: handles no agents found", () => {
		const idx = extensionSource.indexOf("function doListActiveAgents(");
		const block = extensionSource.slice(idx, idx + 1500);
		// TP-106: registry-first with TMUX fallback; either error message is acceptable
		const hasRegistryMsg = block.includes("No active agents found");
		const hasLegacyMsg = block.includes("tmux not available");
		expect(hasRegistryMsg || hasLegacyMsg).toBe(true);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Dashboard server: merge agent telemetry fields
// ══════════════════════════════════════════════════════════════════════

describe("5.x: Dashboard server merge telemetry", () => {
	it("5.1: telemetry accumulator includes startedAt field", () => {
		expect(serverSource).toContain("startedAt: 0");
	});

	it("5.2: telemetry accumulator includes contextPct field", () => {
		expect(serverSource).toContain("contextPct: 0");
	});

	it("5.3: telemetry accumulator includes currentTool field", () => {
		expect(serverSource).toContain('currentTool: ""');
	});

	it("5.4: parses agent_start events for start timestamp", () => {
		expect(serverSource).toContain('"agent_start"');
		expect(serverSource).toContain("acc.startedAt");
	});

	it("5.5: parses response events for context usage", () => {
		expect(serverSource).toContain("contextUsage");
		expect(serverSource).toContain("acc.contextPct");
	});

	it("5.6: supports legacy percentUsed fallback", () => {
		expect(serverSource).toContain("percentUsed");
	});

	it("5.7: clears currentTool on tool_execution_end", () => {
		expect(serverSource).toContain('"tool_execution_end"');
		expect(serverSource).toContain('acc.currentTool = ""');
	});

	it("5.8: sets currentTool on tool_execution_start", () => {
		expect(serverSource).toContain("acc.currentTool = toolLabel");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — Dashboard client: merge telemetry rendering
// ══════════════════════════════════════════════════════════════════════

describe("6.x: Dashboard client merge telemetry rendering", () => {
	it("6.1: mergeTelemetryHtml helper exists", () => {
		expect(appSource).toContain("function mergeTelemetryHtml(");
	});

	it("6.2: renders elapsed time from startedAt", () => {
		expect(appSource).toContain("tel.startedAt");
		expect(appSource).toContain("formatDuration");
	});

	it("6.3: renders tool count", () => {
		expect(appSource).toContain("tel.toolCalls");
	});

	it("6.4: renders context percentage", () => {
		expect(appSource).toContain("tel.contextPct");
	});

	it("6.5: renders tokens and cost", () => {
		expect(appSource).toContain("formatTokens(inp)");
		expect(appSource).toContain("formatCost(cost)");
	});

	it("6.6: renders current tool for alive sessions", () => {
		expect(appSource).toContain("tel.currentTool");
	});

	it("6.7: renders lastTool for completed merges", () => {
		const idx = appSource.indexOf("function mergeTelemetryHtml(");
		const block = appSource.slice(idx, idx + 2000);
		expect(block).toContain("tel.lastTool");
	});

	it("6.8: reuses telemetryBadgesHtml for badges", () => {
		const idx = appSource.indexOf("function mergeTelemetryHtml(");
		const block = appSource.slice(idx, idx + 2000);
		expect(block).toContain("telemetryBadgesHtml(");
	});

	it("6.9: uses lane-based session mapping (not wave index)", () => {
		// The mapping should use lane numbers from repoResults/wavePlan,
		// not wave index directly
		expect(appSource).toContain("waveLaneNums");
		expect(appSource).toContain("getMergeSessionName(ln)");
	});

	it("6.10: merge-stats CSS class is used", () => {
		expect(appSource).toContain("merge-stats");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — Tool count verification
// ══════════════════════════════════════════════════════════════════════

describe("7.x: All recovery tools are registered", () => {
	it("7.1: exactly 4 new supervisor recovery tools registered", () => {
		const toolNames = ["read_agent_status", "trigger_wrap_up", "read_lane_logs", "list_active_agents"];
		for (const name of toolNames) {
			const regex = new RegExp(`name:\\s*"${name}"`, "g");
			const matches = extensionSource.match(regex);
			expect(matches?.length, `Expected exactly 1 registration for ${name}`).toBe(1);
		}
	});

	it("7.2: all tools have execute handlers with error handling", () => {
		const toolNames = ["read_agent_status", "trigger_wrap_up", "read_lane_logs", "list_active_agents"];
		for (const name of toolNames) {
			const block = getToolBlock(name);
			expect(block, `${name} should have try/catch`).toContain("} catch (err)");
			expect(block, `${name} should return text content`).toContain('type: "text"');
		}
	});
});
