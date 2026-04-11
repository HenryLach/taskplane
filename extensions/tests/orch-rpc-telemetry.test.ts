/**
 * Orchestrator telemetry + runtime wiring tests.
 *
 * Tests for:
 * - Runtime V2 lane/merge execution wiring after TMUX-path removals
 * - Telemetry filename generation contracts
 * - Dashboard telemetry filename parsing
 *
 * Uses source-extraction approach (matching existing test patterns).
 */

import { describe, it, before, after } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8").replace(/\r\n/g, "\n");
}

function readDashboardSource(): string {
	return readFileSync(join(__dirname, "..", "..", "dashboard", "server.cjs"), "utf-8").replace(/\r\n/g, "\n");
}

/**
 * Extract a region of source starting at a function declaration
 * up to the next export/function at the same level.
 */
function extractFunctionRegion(src: string, funcSignature: string): string {
	const idx = src.indexOf(funcSignature);
	if (idx < 0) throw new Error(`Function signature not found: ${funcSignature}`);

	const rest = src.slice(idx + 1);
	const nextFunc = rest.search(/\nexport (async )?function /);
	const endOffset = nextFunc === -1 ? rest.length : nextFunc;

	return src.slice(idx, idx + 1 + endOffset);
}

// ── 1. Runtime V2 lane wiring (execution.ts) ───────────────────────

describe("Runtime V2 lane wiring (source extraction)", () => {
	const execSrc = readSource("execution.ts");

	it("executeLaneV2 is exported", () => {
		expect(execSrc).toContain("export async function executeLaneV2(");
	});

	it("executeLaneV2 accepts extraEnvVars parameter", () => {
		const funcBody = extractFunctionRegion(execSrc, "export async function executeLaneV2(");
		expect(funcBody).toContain("extraEnvVars?: Record<string, string>");
	});

	it("executeLaneV2 reads ORCH_BATCH_ID from extraEnvVars fallback", () => {
		const funcBody = extractFunctionRegion(execSrc, "export async function executeLaneV2(");
		expect(funcBody).toContain("extraEnvVars?.ORCH_BATCH_ID");
	});

	it("executeLaneV2 no longer references removed TMUX spawn helpers", () => {
		const funcBody = extractFunctionRegion(execSrc, "export async function executeLaneV2(");
		expect(funcBody).not.toContain("spawnLaneSession");
		expect(funcBody).not.toContain("buildTmuxSpawnArgs");
	});

	// resolveRpcWrapperPath tests removed — function removed during TMUX extrication

	it("resolveTaskplanePackageFile consolidated in path-resolver.ts (TP-157)", () => {
		// After TP-157, resolveTaskplanePackageFile lives in path-resolver.ts, not execution.ts.
		// Verify execution.ts imports it from path-resolver.ts.
		const pathResolverSrc = readSource("path-resolver.ts");
		const funcBody = extractFunctionRegion(pathResolverSrc, "export function resolveTaskplanePackageFile(");
		expect(funcBody).toContain("getNpmGlobalRoot");
		expect(funcBody).toContain("npmRoot");
		expect(execSrc).toContain('from "./path-resolver.ts"');
	});

	it("getNpmGlobalRoot consolidated in path-resolver.ts (TP-157)", () => {
		// After TP-157, getNpmGlobalRoot lives in path-resolver.ts, not execution.ts.
		const pathResolverSrc = readSource("path-resolver.ts");
		const funcBody = extractFunctionRegion(pathResolverSrc, "export function getNpmGlobalRoot(");
		expect(funcBody).toContain("npm");
		expect(funcBody).toContain("root");
		expect(funcBody).toContain("-g");
	});
});

// ── 2. Runtime V2 merge spawn wiring (merge.ts) ────────────────────

describe("Runtime V2 merge spawn wiring (source extraction)", () => {
	const mergeSrc = readSource("merge.ts");

	it("spawnMergeAgentV2 is exported", () => {
		expect(mergeSrc).toContain("export async function spawnMergeAgentV2(");
	});

	it("spawnMergeAgentV2 spawns via agent-host, not TMUX wrapper", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgentV2(");
		expect(funcBody).toContain("spawnAgent(opts)");
		expect(funcBody).not.toContain("tmux");
	});

	it("spawnMergeAgentV2 sets merger role", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgentV2(");
		expect(funcBody).toContain('role: "merger"');
	});

	it("spawnMergeAgentV2 resolves events and exit summary paths under runtime state", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgentV2(");
		expect(funcBody).toContain("eventsPath");
		expect(funcBody).toContain("exitSummaryPath");
		expect(funcBody).toContain('"runtime"');
	});

	it("spawnMergeAgentV2 threads merge model/tools config", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgentV2(");
		expect(funcBody).toContain("config.merge.model");
		expect(funcBody).toContain("config.merge.tools");
	});

	it("spawnMergeAgentV2 resolves task-merger.md from agentRoot/stateRoot candidates", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgentV2(");
		expect(funcBody).toContain("task-merger.md");
		expect(funcBody).toContain("agentRoot");
		expect(funcBody).toContain("stateRoot ?? repoRoot");
	});
});

// ── 3. Telemetry filename generation ────────────────────────────────

// telemetry filename generation tests removed — generateTelemetryPaths removed during TMUX extrication

// ── 4. Dashboard filename parser ────────────────────────────────────

describe("dashboard parseTelemetryFilename (source extraction)", () => {
	const dashSrc = readDashboardSource();

	it("parseTelemetryFilename handles 'worker' role", () => {
		const funcBody = extractFunctionRegion(dashSrc, "function parseTelemetryFilename(");
		expect(funcBody).toContain('"worker"');
	});

	it("parseTelemetryFilename handles 'reviewer' role", () => {
		const funcBody = extractFunctionRegion(dashSrc, "function parseTelemetryFilename(");
		expect(funcBody).toContain('"reviewer"');
	});

	it("parseTelemetryFilename handles 'merger' role", () => {
		const funcBody = extractFunctionRegion(dashSrc, "function parseTelemetryFilename(");
		expect(funcBody).toContain('"merger"');
	});

	it("parseTelemetryFilename extracts mergeNumber from filename", () => {
		const funcBody = extractFunctionRegion(dashSrc, "function parseTelemetryFilename(");
		expect(funcBody).toContain("mergeNumber");
		expect(funcBody).toContain("mergeMatch");
	});

	it("loadTelemetryData maps merge files to orch-merge prefix", () => {
		const funcBody = extractFunctionRegion(dashSrc, "function loadTelemetryData(");
		expect(funcBody).toContain("orch-merge");
		expect(funcBody).toContain('role === "merger"');
	});

	it("loadBatchState normalizes legacy tmuxSessionName lane records at ingress", () => {
		const normalizeBody = extractFunctionRegion(dashSrc, "function normalizeBatchStateIngress(");
		expect(normalizeBody).toContain("lane.tmuxSessionName");
		expect(normalizeBody).toContain("lane.laneSessionId = laneSessionId");
		expect(normalizeBody).toContain("delete lane.tmuxSessionName");
	});

	it("loadBatchState applies ingress normalization before returning state", () => {
		const funcBody = extractFunctionRegion(dashSrc, "function loadBatchState(");
		expect(funcBody).toContain("normalizeBatchStateIngress(JSON.parse(raw))");
	});
});

// ── 5. Functional tests — generateTelemetryPaths ────────────────────

