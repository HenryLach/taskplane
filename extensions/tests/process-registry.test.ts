/**
 * Process Registry Tests — TP-104
 *
 * Behavioral tests for the Runtime V2 process registry:
 *   - Manifest CRUD lifecycle
 *   - Registry snapshot build/read
 *   - Liveness detection
 *   - Orphan detection
 *   - Cleanup
 *   - Agent-host export contract
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/process-registry.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
	writeManifest,
	readManifest,
	updateManifestStatus,
	createManifest,
	buildRegistrySnapshot,
	writeRegistrySnapshot,
	readRegistrySnapshot,
	isProcessAlive,
	isTerminalStatus,
	getLiveAgents,
	getAgentsByRole,
	detectOrphans,
	markOrphansCrashed,
	cleanupBatchRuntime,
	appendAgentEvent,
	writeLaneSnapshot,
} from "../taskplane/process-registry.ts";

import {
	runtimeManifestPath,
	runtimeRegistryPath,
	runtimeAgentEventsPath,
	runtimeLaneSnapshotPath,
	type RuntimeAgentManifest,
} from "../taskplane/types.ts";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "tp-registry-test-"));
});

afterEach(() => {
	try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── 1. Manifest CRUD ────────────────────────────────────────────────

describe("1.x: Manifest CRUD lifecycle", () => {
	const batchId = "20260330T120000";
	const agentId = "orch-test-lane-1-worker";

	function testManifest(): RuntimeAgentManifest {
		return createManifest({
			batchId,
			agentId,
			role: "worker",
			laneNumber: 1,
			taskId: "TP-104",
			repoId: "default",
			pid: process.pid,
			parentPid: process.ppid,
			cwd: tmpDir,
			packet: null,
		});
	}

	it("1.1: writeManifest creates file at correct path", () => {
		const m = testManifest();
		writeManifest(tmpDir, m);
		const path = runtimeManifestPath(tmpDir, batchId, agentId);
		expect(existsSync(path)).toBe(true);
	});

	it("1.2: readManifest returns written manifest", () => {
		const m = testManifest();
		writeManifest(tmpDir, m);
		const read = readManifest(tmpDir, batchId, agentId);
		expect(read).not.toBe(null);
		expect(read!.agentId).toBe(agentId);
		expect(read!.role).toBe("worker");
		expect(read!.status).toBe("spawning");
		expect(read!.pid).toBe(process.pid);
	});

	it("1.3: readManifest returns null for non-existent agent", () => {
		expect(readManifest(tmpDir, batchId, "nonexistent")).toBe(null);
	});

	it("1.4: updateManifestStatus changes status", () => {
		writeManifest(tmpDir, testManifest());
		updateManifestStatus(tmpDir, batchId, agentId, "running");
		const read = readManifest(tmpDir, batchId, agentId);
		expect(read!.status).toBe("running");
	});

	it("1.5: updateManifestStatus is idempotent", () => {
		writeManifest(tmpDir, testManifest());
		updateManifestStatus(tmpDir, batchId, agentId, "exited");
		updateManifestStatus(tmpDir, batchId, agentId, "exited");
		const read = readManifest(tmpDir, batchId, agentId);
		expect(read!.status).toBe("exited");
	});

	it("1.6: createManifest sets initial status to spawning", () => {
		const m = testManifest();
		expect(m.status).toBe("spawning");
		expect(m.startedAt).toBeGreaterThan(0);
	});
});

// ── 2. Registry Snapshots ───────────────────────────────────────────

describe("2.x: Registry snapshots", () => {
	const batchId = "20260330T120000";

	it("2.1: buildRegistrySnapshot discovers all manifests", () => {
		writeManifest(tmpDir, createManifest({
			batchId, agentId: "agent-1", role: "worker", laneNumber: 1,
			taskId: "TP-1", repoId: "default", pid: 1234, parentPid: 1000, cwd: tmpDir, packet: null,
		}));
		writeManifest(tmpDir, createManifest({
			batchId, agentId: "agent-2", role: "reviewer", laneNumber: 1,
			taskId: "TP-1", repoId: "default", pid: 1235, parentPid: 1000, cwd: tmpDir, packet: null,
		}));
		const reg = buildRegistrySnapshot(tmpDir, batchId);
		expect(Object.keys(reg.agents).length).toBe(2);
		expect(reg.agents["agent-1"]).not.toBe(undefined);
		expect(reg.agents["agent-2"]).not.toBe(undefined);
		expect(reg.batchId).toBe(batchId);
	});

	it("2.2: empty batch produces empty agents map", () => {
		const reg = buildRegistrySnapshot(tmpDir, batchId);
		expect(Object.keys(reg.agents).length).toBe(0);
	});

	it("2.3: write + read registry snapshot round-trip", () => {
		const reg = buildRegistrySnapshot(tmpDir, batchId);
		writeRegistrySnapshot(tmpDir, reg);
		const read = readRegistrySnapshot(tmpDir, batchId);
		expect(read).not.toBe(null);
		expect(read!.batchId).toBe(batchId);
	});
});

// ── 3. Liveness and Status ──────────────────────────────────────────

describe("3.x: Liveness detection", () => {
	it("3.1: current process is alive", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("3.2: pid 0 is not alive", () => {
		expect(isProcessAlive(0)).toBe(false);
	});

	it("3.3: negative pid is not alive", () => {
		expect(isProcessAlive(-1)).toBe(false);
	});

	it("3.4: very large pid is not alive", () => {
		expect(isProcessAlive(999999999)).toBe(false);
	});

	it("3.5: terminal statuses are identified", () => {
		expect(isTerminalStatus("exited")).toBe(true);
		expect(isTerminalStatus("crashed")).toBe(true);
		expect(isTerminalStatus("timed_out")).toBe(true);
		expect(isTerminalStatus("killed")).toBe(true);
	});

	it("3.6: non-terminal statuses are identified", () => {
		expect(isTerminalStatus("spawning")).toBe(false);
		expect(isTerminalStatus("running")).toBe(false);
		expect(isTerminalStatus("wrapping_up")).toBe(false);
	});
});

// ── 4. Agent Queries ────────────────────────────────────────────────

describe("4.x: Agent queries", () => {
	const batchId = "20260330T120000";

	function seedAgents() {
		const m1 = createManifest({
			batchId, agentId: "worker-1", role: "worker", laneNumber: 1,
			taskId: "TP-1", repoId: "default", pid: process.pid, parentPid: 1000, cwd: tmpDir, packet: null,
		});
		m1.status = "running";
		writeManifest(tmpDir, m1);

		const m2 = createManifest({
			batchId, agentId: "reviewer-1", role: "reviewer", laneNumber: 1,
			taskId: "TP-1", repoId: "default", pid: process.pid, parentPid: 1000, cwd: tmpDir, packet: null,
		});
		m2.status = "exited";
		writeManifest(tmpDir, m2);

		return buildRegistrySnapshot(tmpDir, batchId);
	}

	it("4.1: getLiveAgents filters terminal agents", () => {
		const reg = seedAgents();
		const live = getLiveAgents(reg);
		expect(live.length).toBe(1);
		expect(live[0].agentId).toBe("worker-1");
	});

	it("4.2: getAgentsByRole filters by role", () => {
		const reg = seedAgents();
		expect(getAgentsByRole(reg, "worker").length).toBe(1);
		expect(getAgentsByRole(reg, "reviewer").length).toBe(1);
		expect(getAgentsByRole(reg, "merger").length).toBe(0);
	});
});

// ── 5. Orphan Detection ─────────────────────────────────────────────

describe("5.x: Orphan detection", () => {
	const batchId = "20260330T120000";

	it("5.1: detects dead agents as orphans", () => {
		const m = createManifest({
			batchId, agentId: "dead-worker", role: "worker", laneNumber: 1,
			taskId: "TP-1", repoId: "default", pid: 999999999, parentPid: 1000, cwd: tmpDir, packet: null,
		});
		m.status = "running";
		writeManifest(tmpDir, m);
		const reg = buildRegistrySnapshot(tmpDir, batchId);
		const orphans = detectOrphans(reg);
		expect(orphans).toContain("dead-worker");
	});

	it("5.2: does not flag live agents as orphans", () => {
		const m = createManifest({
			batchId, agentId: "live-worker", role: "worker", laneNumber: 1,
			taskId: "TP-1", repoId: "default", pid: process.pid, parentPid: 1000, cwd: tmpDir, packet: null,
		});
		m.status = "running";
		writeManifest(tmpDir, m);
		const reg = buildRegistrySnapshot(tmpDir, batchId);
		expect(detectOrphans(reg)).toEqual([]);
	});

	it("5.3: does not flag terminal agents as orphans", () => {
		const m = createManifest({
			batchId, agentId: "done-worker", role: "worker", laneNumber: 1,
			taskId: "TP-1", repoId: "default", pid: 999999999, parentPid: 1000, cwd: tmpDir, packet: null,
		});
		m.status = "exited";
		writeManifest(tmpDir, m);
		const reg = buildRegistrySnapshot(tmpDir, batchId);
		expect(detectOrphans(reg)).toEqual([]);
	});

	it("5.4: markOrphansCrashed updates manifests", () => {
		const m = createManifest({
			batchId, agentId: "orphan-1", role: "worker", laneNumber: 1,
			taskId: "TP-1", repoId: "default", pid: 999999999, parentPid: 1000, cwd: tmpDir, packet: null,
		});
		m.status = "running";
		writeManifest(tmpDir, m);
		markOrphansCrashed(tmpDir, batchId, ["orphan-1"]);
		const read = readManifest(tmpDir, batchId, "orphan-1");
		expect(read!.status).toBe("crashed");
	});
});

// ── 6. Cleanup ──────────────────────────────────────────────────────

describe("6.x: Cleanup", () => {
	const batchId = "20260330T120000";

	it("6.1: cleanupBatchRuntime removes runtime directory", () => {
		writeManifest(tmpDir, createManifest({
			batchId, agentId: "cleanup-agent", role: "worker", laneNumber: 1,
			taskId: "TP-1", repoId: "default", pid: 1234, parentPid: 1000, cwd: tmpDir, packet: null,
		}));
		const result = cleanupBatchRuntime(tmpDir, batchId);
		expect(result.removed).toBe(true);
		const path = runtimeManifestPath(tmpDir, batchId, "cleanup-agent");
		expect(existsSync(path)).toBe(false);
	});

	it("6.2: cleanupBatchRuntime returns removed=false for non-existent batch", () => {
		const result = cleanupBatchRuntime(tmpDir, "nonexistent");
		expect(result.removed).toBe(false);
	});
});

// ── 7. Event and Snapshot Persistence ───────────────────────────────

describe("7.x: Event and snapshot persistence", () => {
	const batchId = "20260330T120000";
	const agentId = "event-agent";

	it("7.1: appendAgentEvent creates JSONL file", () => {
		appendAgentEvent(tmpDir, batchId, agentId, { type: "test", ts: Date.now() });
		const path = runtimeAgentEventsPath(tmpDir, batchId, agentId);
		expect(existsSync(path)).toBe(true);
		const content = readFileSync(path, "utf-8");
		expect(content).toContain('"type":"test"');
	});

	it("7.2: appendAgentEvent appends multiple events", () => {
		appendAgentEvent(tmpDir, batchId, agentId, { type: "a" });
		appendAgentEvent(tmpDir, batchId, agentId, { type: "b" });
		const path = runtimeAgentEventsPath(tmpDir, batchId, agentId);
		const lines = readFileSync(path, "utf-8").trim().split("\n");
		expect(lines.length).toBe(2);
	});

	it("7.3: writeLaneSnapshot creates lane JSON file", () => {
		writeLaneSnapshot(tmpDir, batchId, 1, { laneNumber: 1, status: "running" });
		const path = runtimeLaneSnapshotPath(tmpDir, batchId, 1);
		expect(existsSync(path)).toBe(true);
		const data = JSON.parse(readFileSync(path, "utf-8"));
		expect(data.laneNumber).toBe(1);
	});
});

// ── 8. Agent-host export contract ───────────────────────────────────

describe("8.x: Agent-host export contract", () => {
	it("8.1: spawnAgent is exported as a function", async () => {
		const mod = await import("../taskplane/agent-host.ts");
		expect(typeof mod.spawnAgent).toBe("function");
	});

	it("8.2: resolvePiCliPath is exported as a function", async () => {
		const mod = await import("../taskplane/agent-host.ts");
		expect(typeof mod.resolvePiCliPath).toBe("function");
	});

	it("8.3: resolvePiCliPath finds pi CLI (skipped in CI without pi)", async () => {
		const mod = await import("../taskplane/agent-host.ts");
		try {
			const path = mod.resolvePiCliPath();
			expect(path).toContain("cli.js");
			expect(existsSync(path)).toBe(true);
		} catch (err: any) {
			// Pi is not installed in CI — skip gracefully
			if (err.message?.includes("Cannot find Pi CLI")) {
				// Expected in environments without pi installed
				expect(true).toBe(true);
			} else {
				throw err;
			}
		}
	});
});

// ── 9. Agent-host option and event attribution contract (remediation) ─

describe("9.x: Agent-host option and event attribution contract", () => {
	const hostSrc = readFileSync(join(__dirname, "..", "taskplane", "agent-host.ts"), "utf-8");

	it("9.1: AgentHostOptions requires batch/lane/task/repo fields", () => {
		expect(hostSrc).toContain("batchId: string");
		expect(hostSrc).toContain("laneNumber: number | null");
		expect(hostSrc).toContain("taskId: string | null");
		expect(hostSrc).toContain("repoId: string");
	});

	it("9.2: emitEvent uses opts fields, not empty placeholders", () => {
		expect(hostSrc).toContain("batchId: opts.batchId");
		expect(hostSrc).toContain("laneNumber: opts.laneNumber");
		expect(hostSrc).toContain("taskId: opts.taskId");
		expect(hostSrc).toContain("repoId: opts.repoId");
	});

	it("9.3: timeout produces agent_timeout not agent_killed", () => {
		expect(hostSrc).toContain("agent_timeout");
		expect(hostSrc).toContain("timedOut");
		expect(hostSrc).toContain("timed_out");
	});

	it("9.4: --no-extensions is always passed (even with explicit -e)", () => {
		const noExtIdx = hostSrc.indexOf('piArgs.push("--no-extensions")');
		const eIdx = hostSrc.indexOf('piArgs.push("-e"');
		expect(noExtIdx).toBeGreaterThan(-1);
		expect(eIdx).toBeGreaterThan(noExtIdx);
	});

	it("9.5: registry integration writes manifest on spawn", () => {
		expect(hostSrc).toContain("writeManifest(opts.stateRoot");
		expect(hostSrc).toContain("updateManifestStatus(opts.stateRoot");
	});

	it("9.6: registry manifest transitions to terminal status on exit", () => {
		expect(hostSrc).toContain('"timed_out"');
		expect(hostSrc).toContain('"killed"');
		expect(hostSrc).toContain('"exited"');
		expect(hostSrc).toContain('"crashed"');
	});

	it("9.7: stateRoot and packet are optional (for callers without registry)", () => {
		expect(hostSrc).toContain("stateRoot?: string | null");
		expect(hostSrc).toContain("packet?: PacketPaths | null");
	});

	it("9.8: get_session_stats is requested immediately then on bounded cadence", () => {
		expect(hostSrc).toContain("const STATS_REFRESH_EVERY_ASSISTANT_MESSAGES = 5");
		expect(hostSrc).toContain("assistantMessageEnds += 1");
		expect(hostSrc).toContain("assistantMessageEnds === 1 || assistantMessageEnds % STATS_REFRESH_EVERY_ASSISTANT_MESSAGES === 0");
		expect(hostSrc).toContain("{ type: \"get_session_stats\" }");
	});
});
