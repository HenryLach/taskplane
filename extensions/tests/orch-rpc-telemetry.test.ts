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

	it("resolveRpcWrapperPath is exported from execution.ts", () => {
		expect(execSrc).toContain("export function resolveRpcWrapperPath(");
	});

	it("resolveRpcWrapperPath resolves bin/rpc-wrapper.mjs", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function resolveRpcWrapperPath(");
		expect(funcBody).toContain("rpc-wrapper.mjs");
	});

	it("resolveTaskplanePackageFile uses npm root -g for dynamic resolution", () => {
		const funcBody = extractFunctionRegion(execSrc, "function resolveTaskplanePackageFile(");
		expect(funcBody).toContain("getNpmGlobalRoot");
		expect(funcBody).toContain("npmRoot");
	});

	it("getNpmGlobalRoot calls npm root -g", () => {
		const funcBody = extractFunctionRegion(execSrc, "function getNpmGlobalRoot(");
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

describe("telemetry filename generation (execution.ts)", () => {
	const execSrc = readSource("execution.ts");

	it("generateTelemetryPaths is exported", () => {
		expect(execSrc).toContain("export function generateTelemetryPaths(");
	});

	it("generateTelemetryPaths uses opId-batchId-repoId naming", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function generateTelemetryPaths(");
		expect(funcBody).toContain("opId");
		expect(funcBody).toContain("effectiveBatchId");
		expect(funcBody).toContain("effectiveRepoId");
	});

	it("generateTelemetryPaths includes lane suffix from sessionName", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function generateTelemetryPaths(");
		expect(funcBody).toContain("laneSuffix");
		expect(funcBody).toMatch(/lane-\(\\d\+\)/);
	});

	it("generateTelemetryPaths includes optional taskId", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function generateTelemetryPaths(");
		expect(funcBody).toContain("taskIdSegment");
		expect(funcBody).toContain("taskId");
	});

	it("generateTelemetryPaths creates .jsonl sidecar and -exit.json files", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function generateTelemetryPaths(");
		expect(funcBody).toContain(".jsonl");
		expect(funcBody).toContain("-exit.json");
	});

	it("generateTelemetryPaths creates telemetry dir if missing", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function generateTelemetryPaths(");
		expect(funcBody).toContain("mkdirSync");
		expect(funcBody).toContain("recursive: true");
	});
});

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
});

// ── 5. Functional tests — generateTelemetryPaths ────────────────────

describe("generateTelemetryPaths functional tests", () => {
	let generateTelemetryPaths: typeof import("../taskplane/execution.ts").generateTelemetryPaths;
	let tempDir: string;

	before(async () => {
		const mod = await import("../taskplane/execution.ts");
		generateTelemetryPaths = mod.generateTelemetryPaths;
		tempDir = mkdtempSync(join(tmpdir(), "tp049-test-"));
	});

	after(() => {
		try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
	});

	it("produces .jsonl sidecar path", () => {
		const result = generateTelemetryPaths("orch-lane-1", tempDir);
		expect(result.sidecarPath).toMatch(/\.jsonl$/);
	});

	it("produces -exit.json exit summary path", () => {
		const result = generateTelemetryPaths("orch-lane-1", tempDir);
		expect(result.exitSummaryPath).toMatch(/-exit\.json$/);
	});

	it("includes lane number in filename", () => {
		const result = generateTelemetryPaths("orch-lane-3", tempDir);
		expect(result.sidecarPath).toContain("-lane-3-");
	});

	it("includes taskId in filename when provided", () => {
		const result = generateTelemetryPaths("orch-lane-1", tempDir, "TP-049");
		expect(result.sidecarPath).toContain("-tp-049-");
	});

	it("uses 'lane' role for lane sessions (avoids collision with worker sidecar)", () => {
		const result = generateTelemetryPaths("orch-lane-1", tempDir);
		expect(result.sidecarPath).toMatch(/-lane\.jsonl$/);
	});

	it("creates telemetry dir under sidecar root", () => {
		const result = generateTelemetryPaths("orch-lane-1", tempDir);
		expect(result.telemetryDir).toBe(join(tempDir, "telemetry"));
	});
});
