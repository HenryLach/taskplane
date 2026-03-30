/**
 * Orchestrator RPC Telemetry Tests — TP-049
 *
 * Tests for:
 * - Lane spawn command includes rpc-wrapper path and sidecar args
 * - Merge spawn command includes rpc-wrapper path and sidecar args
 * - Telemetry filename generation follows expected patterns
 * - Dashboard filename parser handles worker, merger, reviewer files
 *
 * Uses source-extraction approach (matching the existing test patterns).
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/orch-rpc-telemetry.test.ts
 */

import { describe, it, before, after } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname, resolve } from "path";
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

// ── 1. Lane spawn via RPC wrapper (execution.ts) ────────────────────

describe("lane spawn via RPC wrapper (source extraction)", () => {
	const execSrc = readSource("execution.ts");

	it("buildTmuxSpawnArgs accepts sidecarPath and exitSummaryPath parameters", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function buildTmuxSpawnArgs(");
		expect(funcBody).toContain("sidecarPath");
		expect(funcBody).toContain("exitSummaryPath");
	});

	it("buildTmuxSpawnArgs uses resolveRpcWrapperPath when sidecar paths provided", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function buildTmuxSpawnArgs(");
		expect(funcBody).toContain("resolveRpcWrapperPath");
	});

	it("buildTmuxSpawnArgs passes --sidecar-path to RPC wrapper", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function buildTmuxSpawnArgs(");
		expect(funcBody).toContain("--sidecar-path");
	});

	it("buildTmuxSpawnArgs passes --exit-summary-path to RPC wrapper", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function buildTmuxSpawnArgs(");
		expect(funcBody).toContain("--exit-summary-path");
	});

	it("buildTmuxSpawnArgs passes --prompt-file to RPC wrapper", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function buildTmuxSpawnArgs(");
		expect(funcBody).toContain("--prompt-file");
	});

	it("buildTmuxSpawnArgs passes --extensions for task-runner", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function buildTmuxSpawnArgs(");
		expect(funcBody).toContain("--extensions");
		expect(funcBody).toContain("taskRunnerExtPath");
	});

	it("buildTmuxSpawnArgs falls back to pi direct when no sidecar paths", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function buildTmuxSpawnArgs(");
		expect(funcBody).toContain("pi --no-session -e");
	});

	it("spawnLaneSession generates telemetry paths and passes them to buildTmuxSpawnArgs", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function spawnLaneSession(");
		expect(funcBody).toContain("generateTelemetryPaths");
		expect(funcBody).toContain("telemetry.sidecarPath");
		expect(funcBody).toContain("telemetry.exitSummaryPath");
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

	it("resolveTaskplanePackageFile includes Homebrew path", () => {
		const funcBody = extractFunctionRegion(execSrc, "function resolveTaskplanePackageFile(");
		expect(funcBody).toContain("homebrew");
	});
});

// ── 2. Merge spawn via RPC wrapper (merge.ts) ───────────────────────

describe("merge spawn via RPC wrapper (source extraction)", () => {
	const mergeSrc = readSource("merge.ts");

	it("spawnMergeAgent uses resolveRpcWrapperPath", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgent(");
		expect(funcBody).toContain("resolveRpcWrapperPath");
	});

	it("spawnMergeAgent passes --sidecar-path to RPC wrapper", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgent(");
		expect(funcBody).toContain("--sidecar-path");
	});

	it("spawnMergeAgent passes --exit-summary-path to RPC wrapper", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgent(");
		expect(funcBody).toContain("--exit-summary-path");
	});

	it("spawnMergeAgent passes --prompt-file with merge request", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgent(");
		expect(funcBody).toContain("--prompt-file");
		expect(funcBody).toContain("mergeRequestPath");
	});

	it("spawnMergeAgent passes --system-prompt-file for merger agent definition", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgent(");
		expect(funcBody).toContain("--system-prompt-file");
		expect(funcBody).toContain("task-merger.md");
	});

	it("spawnMergeAgent passes --model when configured", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgent(");
		expect(funcBody).toContain("--model");
		expect(funcBody).toContain("config.merge.model");
	});

	it("spawnMergeAgent passes --tools when configured", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgent(");
		expect(funcBody).toContain("--tools");
		expect(funcBody).toContain("config.merge.tools");
	});

	it("spawnMergeAgent generates merge-specific telemetry paths", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "export async function spawnMergeAgent(");
		expect(funcBody).toContain("generateMergeTelemetryPaths");
	});

	it("merge telemetry uses 'merger' role", () => {
		const funcBody = extractFunctionRegion(mergeSrc, "function generateMergeTelemetryPaths(");
		expect(funcBody).toContain('"merger"');
	});
});

// ── 3. Telemetry filename generation ────────────────────────────────

describe("telemetry filename generation (execution.ts)", () => {
	const execSrc = readSource("execution.ts");

	it("generateTelemetryPaths is exported", () => {
		expect(execSrc).toContain("export function generateTelemetryPaths(");
	});

	it("generateTelemetryPaths uses opId-batchId-repoId-role naming", () => {
		const funcBody = extractFunctionRegion(execSrc, "export function generateTelemetryPaths(");
		expect(funcBody).toContain("opId");
		expect(funcBody).toContain("batchId");
		expect(funcBody).toContain("repoId");
		expect(funcBody).toContain("role");
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

	it("merge telemetry paths include merge number from sessionName", () => {
		const mergeSrc = readSource("merge.ts");
		const funcBody = extractFunctionRegion(mergeSrc, "function generateMergeTelemetryPaths(");
		expect(funcBody).toContain("mergeSuffix");
		expect(funcBody).toMatch(/merge-\(\\d\+\)/);
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
	// Import the actual function
	let generateTelemetryPaths: typeof import("../taskplane/execution.ts").generateTelemetryPaths;

	// Use a temp dir for sidecar root
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
