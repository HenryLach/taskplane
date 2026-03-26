/**
 * Orchestrator Supervisor Tools Tests — TP-053 + TP-061
 *
 * Tests for the orchestrator tools exposed to the supervisor agent:
 *
 *   1.x — Tool registration: all 6 tools registered in extension.ts
 *   2.x — Tool parameter schemas: correct Type.Object definitions
 *   3.x — Shared helpers: command handlers delegate to shared functions
 *   4.x — Supervisor prompt: tool awareness in system prompts
 *
 * Run: npx vitest run tests/orch-supervisor-tools.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
	buildSupervisorSystemPrompt,
	buildRoutingSystemPrompt,
	DEFAULT_SUPERVISOR_CONFIG,
} from "../taskplane/supervisor.ts";
import type { OrchBatchRuntimeState } from "../taskplane/types.ts";
import { DEFAULT_ORCHESTRATOR_CONFIG, freshOrchBatchState } from "../taskplane/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read extension.ts source for structural verification
const extensionSource = readFileSync(
	join(__dirname, "..", "taskplane", "extension.ts"),
	"utf-8",
);

// ══════════════════════════════════════════════════════════════════════
// 1.x — Tool registration
// ══════════════════════════════════════════════════════════════════════

describe("1.x: Orchestrator tools are registered", () => {
	it("1.1: orch_status tool is registered", () => {
		expect(extensionSource).toContain('name: "orch_status"');
		expect(extensionSource).toContain("pi.registerTool(");
	});

	it("1.2: orch_pause tool is registered", () => {
		expect(extensionSource).toContain('name: "orch_pause"');
	});

	it("1.3: orch_resume tool is registered", () => {
		expect(extensionSource).toContain('name: "orch_resume"');
	});

	it("1.4: orch_abort tool is registered", () => {
		expect(extensionSource).toContain('name: "orch_abort"');
	});

	it("1.5: orch_integrate tool is registered", () => {
		expect(extensionSource).toContain('name: "orch_integrate"');
	});

	it("1.6: orch_start tool is registered", () => {
		expect(extensionSource).toContain('name: "orch_start"');
	});

	it("1.7: exactly 6 orchestrator tools registered (no duplicates)", () => {
		const toolNames = ["orch_status", "orch_pause", "orch_resume", "orch_abort", "orch_integrate", "orch_start"];
		for (const name of toolNames) {
			const regex = new RegExp(`name:\\s*"${name}"`, "g");
			const matches = extensionSource.match(regex);
			expect(matches?.length, `Expected exactly 1 registration for ${name}`).toBe(1);
		}
	});

	it("1.8: all tools have description, promptSnippet, and promptGuidelines", () => {
		const toolNames = ["orch_status", "orch_pause", "orch_resume", "orch_abort", "orch_integrate", "orch_start"];
		for (const name of toolNames) {
			// Find the tool registration block
			const idx = extensionSource.indexOf(`name: "${name}"`);
			expect(idx, `Tool ${name} should be in source`).toBeGreaterThan(-1);
			// Look in the surrounding block (next 500 chars should have these)
			const block = extensionSource.slice(Math.max(0, idx - 200), idx + 800);
			expect(block, `${name} should have description`).toContain("description:");
			expect(block, `${name} should have promptSnippet`).toContain("promptSnippet:");
			expect(block, `${name} should have promptGuidelines`).toContain("promptGuidelines:");
		}
	});

	it("1.9: tools are registered unconditionally (not inside isOrchestratedMode guard)", () => {
		// The tools should NOT be gated on orchestrated mode — they're for the
		// supervisor which runs in the main session.
		// Find the orch_status registration and check it's NOT preceded by isOrchestratedMode
		const idx = extensionSource.indexOf('name: "orch_status"');
		const preceding = extensionSource.slice(Math.max(0, idx - 500), idx);
		// Should not find isOrchestratedMode() right before the tool block
		expect(preceding).not.toContain("isOrchestratedMode()");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Tool parameter schemas
// ══════════════════════════════════════════════════════════════════════

describe("2.x: Tool parameter schemas are correct", () => {
	/**
	 * Helper to extract a tool registration block from the source.
	 * Finds the registerTool call containing the given tool name and
	 * returns text up to the matching closing `});` of that call.
	 */
	function getToolBlock(name: string): string {
		const marker = `name: "${name}"`;
		const idx = extensionSource.indexOf(marker);
		if (idx === -1) return "";
		// Walk back to find pi.registerTool({
		const registerIdx = extensionSource.lastIndexOf("pi.registerTool(", idx);
		// Walk forward to find the end — look for `\n\t});` pattern (tool registration end)
		const afterMarker = extensionSource.indexOf("\n\t});", idx);
		return extensionSource.slice(registerIdx, afterMarker + 5);
	}

	it("2.1: orch_status has empty parameters (Type.Object({}))", () => {
		const block = getToolBlock("orch_status");
		expect(block).toContain("Type.Object({})");
	});

	it("2.2: orch_pause has empty parameters (Type.Object({}))", () => {
		const block = getToolBlock("orch_pause");
		expect(block).toContain("Type.Object({})");
	});

	it("2.3: orch_resume has optional force boolean parameter", () => {
		const block = getToolBlock("orch_resume");
		expect(block).toContain("force:");
		expect(block).toContain("Type.Optional(Type.Boolean(");
	});

	it("2.4: orch_abort has optional hard boolean parameter", () => {
		const block = getToolBlock("orch_abort");
		expect(block).toContain("hard:");
		expect(block).toContain("Type.Optional(Type.Boolean(");
	});

	it("2.5: orch_integrate has mode, force, and branch parameters", () => {
		const block = getToolBlock("orch_integrate");
		expect(block).toContain("mode:");
		expect(block).toContain("force:");
		expect(block).toContain("branch:");
		// Mode should be a union of literals
		expect(block).toContain('Type.Literal("fast-forward")');
		expect(block).toContain('Type.Literal("merge")');
		expect(block).toContain('Type.Literal("pr")');
	});

	it("2.6: orch_start has required target string parameter", () => {
		const block = getToolBlock("orch_start");
		expect(block).toContain("target:");
		expect(block).toContain("Type.String(");
	});

	it("2.7: all tool execute handlers catch errors and return text results", () => {
		const toolNames = ["orch_status", "orch_pause", "orch_resume", "orch_abort", "orch_integrate", "orch_start"];
		for (const name of toolNames) {
			const block = getToolBlock(name);
			expect(block, `${name} should have try/catch`).toContain("} catch (err)");
			expect(block, `${name} should return text content`).toContain('type: "text"');
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Shared helpers: command handlers delegate to helpers
// ══════════════════════════════════════════════════════════════════════

describe("3.x: Shared helper functions exist and are used by both commands and tools", () => {
	it("3.1: doOrchStatus helper exists", () => {
		expect(extensionSource).toContain("function doOrchStatus(");
	});

	it("3.2: doOrchPause helper exists", () => {
		expect(extensionSource).toContain("function doOrchPause(");
	});

	it("3.3: doOrchResume helper exists", () => {
		expect(extensionSource).toContain("function doOrchResume(");
	});

	it("3.4: doOrchAbort helper exists", () => {
		expect(extensionSource).toContain("function doOrchAbort(");
	});

	it("3.5: doOrchIntegrate helper exists", () => {
		expect(extensionSource).toContain("function doOrchIntegrate(");
	});

	it("3.6: doOrchStart helper exists", () => {
		expect(extensionSource).toContain("function doOrchStart(");
	});

	it("3.7: orch-status command handler delegates to doOrchStatus", () => {
		// Find the command handler and check it calls the helper
		const cmdIdx = extensionSource.indexOf('"orch-status"');
		const cmdBlock = extensionSource.slice(cmdIdx, cmdIdx + 300);
		expect(cmdBlock).toContain("doOrchStatus(");
	});

	it("3.8: orch-pause command handler delegates to doOrchPause", () => {
		const cmdIdx = extensionSource.indexOf('"orch-pause"');
		const cmdBlock = extensionSource.slice(cmdIdx, cmdIdx + 300);
		expect(cmdBlock).toContain("doOrchPause()");
	});

	it("3.9: orch-resume command handler delegates to doOrchResume", () => {
		const cmdIdx = extensionSource.indexOf('"orch-resume"');
		const cmdBlock = extensionSource.slice(cmdIdx, cmdIdx + 500);
		expect(cmdBlock).toContain("doOrchResume(");
	});

	it("3.10: orch-abort command handler delegates to doOrchAbort", () => {
		const cmdIdx = extensionSource.indexOf('"orch-abort"');
		const cmdBlock = extensionSource.slice(cmdIdx, cmdIdx + 300);
		expect(cmdBlock).toContain("doOrchAbort(");
	});

	it("3.11: orch-integrate command handler delegates to doOrchIntegrate", () => {
		// There may be multiple mentions, find the registerCommand one.
		// The integrate command has a --help section before the delegation,
		// so use a larger window.
		const registrationIdx = extensionSource.indexOf('registerCommand("orch-integrate"');
		const cmdBlock = extensionSource.slice(registrationIdx, registrationIdx + 2000);
		expect(cmdBlock).toContain("doOrchIntegrate(");
	});

	it("3.12: /orch command handler delegates to doOrchStart for batch start", () => {
		// The /orch handler has a large routing section before the batch-start
		// delegation, so use a larger window to find doOrchStart.
		const registrationIdx = extensionSource.indexOf('registerCommand("orch"');
		const cmdBlock = extensionSource.slice(registrationIdx, registrationIdx + 5000);
		expect(cmdBlock).toContain("doOrchStart(");
	});

	it("3.13: orch_start tool delegates to doOrchStart", () => {
		// Find the orch_start tool registration and verify it calls doOrchStart
		const toolIdx = extensionSource.indexOf('name: "orch_start"');
		const toolBlock = extensionSource.slice(toolIdx, toolIdx + 1500);
		expect(toolBlock).toContain("doOrchStart(");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Supervisor prompt tool awareness
// ══════════════════════════════════════════════════════════════════════

describe("4.x: Supervisor prompt includes tool awareness", () => {
	const batchState: OrchBatchRuntimeState = {
		...freshOrchBatchState(),
		batchId: "test-batch-001",
		phase: "executing",
		baseBranch: "main",
		orchBranch: "orch/op-test",
		totalWaves: 2,
		totalTasks: 5,
	};
	const config = { ...DEFAULT_ORCHESTRATOR_CONFIG };
	const supervisorConfig = { ...DEFAULT_SUPERVISOR_CONFIG };
	const stateRoot = "/tmp/test-state";

	const monitoringPrompt = buildSupervisorSystemPrompt(
		batchState,
		config,
		supervisorConfig,
		stateRoot,
	);

	it("4.1: monitoring prompt mentions orch_start tool", () => {
		expect(monitoringPrompt).toContain("orch_start(target)");
	});

	it("4.2: monitoring prompt mentions orch_status tool", () => {
		expect(monitoringPrompt).toContain("orch_status()");
	});

	it("4.4: monitoring prompt mentions orch_pause tool", () => {
		expect(monitoringPrompt).toContain("orch_pause()");
	});

	it("4.5: monitoring prompt mentions orch_resume tool", () => {
		expect(monitoringPrompt).toContain("orch_resume(");
	});

	it("4.6: monitoring prompt mentions orch_abort tool", () => {
		expect(monitoringPrompt).toContain("orch_abort(");
	});

	it("4.7: monitoring prompt mentions orch_integrate tool", () => {
		expect(monitoringPrompt).toContain("orch_integrate(");
	});

	it("4.8: monitoring prompt has 'Available Orchestrator Tools' section", () => {
		expect(monitoringPrompt).toContain("Available Orchestrator Tools");
	});

	it("4.9: monitoring prompt includes proactive usage examples", () => {
		expect(monitoringPrompt).toContain("When to Use These Tools");
	});

	it("4.10: monitoring prompt describes integration modes", () => {
		expect(monitoringPrompt).toContain('"fast-forward"');
		expect(monitoringPrompt).toContain('"merge"');
		expect(monitoringPrompt).toContain('"pr"');
	});

	it("4.11: routing prompt includes orchestrator tools section", () => {
		const routingPrompt = buildRoutingSystemPrompt(
			{ routingState: "no-tasks", contextMessage: "No pending tasks" },
			stateRoot,
		);
		expect(routingPrompt).toContain("Orchestrator Tools");
		expect(routingPrompt).toContain("orch_start(");
		expect(routingPrompt).toContain("orch_status()");
		expect(routingPrompt).toContain("orch_integrate(");
	});
});
