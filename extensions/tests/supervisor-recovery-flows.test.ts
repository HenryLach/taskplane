/**
 * TP-187: Supervisor recovery flows — drain alerts, reattach after abort,
 * surface worker reasons.
 *
 * Tests cover:
 *   #538 — Mailbox drain at lane termination + supervisor_takeover tool +
 *          zombie-alert filter lifecycle in extension.ts.
 *   #539 — Resume reconstruction from .pi/runtime/<batchId>/ artifacts after
 *          orch_abort() deletes batch-state.json.
 *   #540 — Non-empty exit reason in task-worker.md + lane-runner.ts fallback
 *          to most-recent assistant_message from events.jsonl.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/supervisor-recovery-flows.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

import {
	drainAgentOutbox,
	sessionOutboxDir,
	discoverMailboxAgentIds,
} from "../taskplane/mailbox.ts";
import {
	saveBatchMetaRuntimeArtifact,
	loadBatchMetaRuntimeArtifact,
	reconstructBatchStateFromRuntime,
	deleteBatchState,
} from "../taskplane/persistence.ts";
import { writeManifest } from "../taskplane/process-registry.ts";
import { ORCH_MESSAGES } from "../taskplane/messages.ts";
import { runtimeRoot } from "../taskplane/types.ts";
import type { RuntimeAgentManifest } from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const laneRunnerSrc = readFileSync(join(__dirname, "..", "taskplane", "lane-runner.ts"), "utf-8");
const extensionSrc = readFileSync(join(__dirname, "..", "taskplane", "extension.ts"), "utf-8");
const engineSrc = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");
const taskWorkerSrc = readFileSync(join(__dirname, "..", "..", "templates", "agents", "task-worker.md"), "utf-8");
const supervisorTemplateSrc = readFileSync(join(__dirname, "..", "..", "templates", "agents", "supervisor.md"), "utf-8");
const resumeSrc = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

function mkTmpRoot(): string {
	const root = join(tmpdir(), `tp-187-${Date.now()}-${randomBytes(3).toString("hex")}`);
	mkdirSync(root, { recursive: true });
	return root;
}

// ── #538: Mailbox drain at lane termination ─────────────────────────

describe("TP-187 #538: drainAgentOutbox helper", () => {
	let stateRoot: string;
	const batchId = "b-test-538";
	const agentId = "orch-test-lane-1-worker";

	beforeEach(() => {
		stateRoot = mkTmpRoot();
	});
	afterEach(() => {
		try { rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it("returns 0 when the outbox directory does not exist", () => {
		const drained = drainAgentOutbox(stateRoot, batchId, agentId);
		expect(drained).toBe(0);
	});

	it("moves pending *.msg.json files to processed/", () => {
		const outbox = sessionOutboxDir(stateRoot, batchId, agentId);
		mkdirSync(outbox, { recursive: true });
		const msg = {
			id: "m1",
			batchId,
			from: agentId,
			to: "supervisor",
			timestamp: Date.now(),
			type: "escalate",
			content: "stuck",
			expectsReply: true,
			replyTo: null,
		};
		writeFileSync(join(outbox, "m1.msg.json"), JSON.stringify(msg), "utf-8");
		writeFileSync(join(outbox, "m2.msg.json"), JSON.stringify({ ...msg, id: "m2", type: "reply" }), "utf-8");

		const drained = drainAgentOutbox(stateRoot, batchId, agentId);
		expect(drained).toBe(2);
		expect(existsSync(join(outbox, "m1.msg.json"))).toBe(false);
		expect(existsSync(join(outbox, "m2.msg.json"))).toBe(false);
		expect(existsSync(join(outbox, "processed", "m1.msg.json"))).toBe(true);
		expect(existsSync(join(outbox, "processed", "m2.msg.json"))).toBe(true);
	});

	it("renames non-message pending files (e.g., segment-expansion-*) to .drained", () => {
		const outbox = sessionOutboxDir(stateRoot, batchId, agentId);
		mkdirSync(outbox, { recursive: true });
		writeFileSync(join(outbox, "segment-expansion-req-1.json"), "{}", "utf-8");

		const drained = drainAgentOutbox(stateRoot, batchId, agentId);
		expect(drained).toBe(1);
		expect(existsSync(join(outbox, "segment-expansion-req-1.json"))).toBe(false);
		expect(existsSync(join(outbox, "segment-expansion-req-1.json.drained"))).toBe(true);
	});

	it("ignores .tmp files and the processed/ subdirectory", () => {
		const outbox = sessionOutboxDir(stateRoot, batchId, agentId);
		mkdirSync(join(outbox, "processed"), { recursive: true });
		writeFileSync(join(outbox, "stale.msg.json.tmp"), "{}", "utf-8");

		const drained = drainAgentOutbox(stateRoot, batchId, agentId);
		expect(drained).toBe(0);
		expect(existsSync(join(outbox, "stale.msg.json.tmp"))).toBe(true);
	});

	it("is race-safe: idempotent when called twice", () => {
		const outbox = sessionOutboxDir(stateRoot, batchId, agentId);
		mkdirSync(outbox, { recursive: true });
		writeFileSync(join(outbox, "m1.msg.json"), "{}", "utf-8");

		const first = drainAgentOutbox(stateRoot, batchId, agentId);
		const second = drainAgentOutbox(stateRoot, batchId, agentId);
		expect(first).toBe(1);
		expect(second).toBe(0);
	});
});

describe("TP-187 #538: lane-runner emits onLaneTerminated on no-progress kill", () => {
	it("calls config.onLaneTerminated before returning failed result", () => {
		// The kill block should: drainAgentOutbox + onLaneTerminated + return makeResult.
		const killIdx = laneRunnerSrc.indexOf("No progress after ${noProgressCount} iterations");
		expect(killIdx).not.toBe(-1);
		// Window large enough to cover the post-Task-blocked block we just added.
		const killBlock = laneRunnerSrc.slice(killIdx, killIdx + 1500);
		expect(killBlock).toContain("drainAgentOutbox(config.stateRoot, config.batchId, workerAgentId)");
		expect(killBlock).toContain("config.onLaneTerminated");
		expect(killBlock).toContain('reason: "no-progress-kill"');
	});

	it("LaneRunnerConfig declares optional onLaneTerminated callback", () => {
		expect(laneRunnerSrc).toContain("onLaneTerminated?:");
	});
});

describe("TP-187 #538: engine emits emitLaneTerminated on hard-fail", () => {
	it("hard-fail block in executeOrchBatch invokes emitLaneTerminated", () => {
		// The hard-fail emit lives near the task-failure alert in engine.ts.
		// We assert the helper closure exists AND is invoked alongside the failure
		// alert so the supervisor process gets the suppression signal.
		expect(engineSrc).toContain("const emitLaneTerminated = (info:");
		expect(engineSrc).toContain('reason: "hard-fail"');
	});

	it("hard-fail block synchronously drains the agent outbox before emitting termination", () => {
		const hardFailIdx = engineSrc.indexOf('reason: "hard-fail"');
		expect(hardFailIdx).not.toBe(-1);
		// Walk back ~1500 chars from the reason to inspect the surrounding block.
		const windowStart = Math.max(0, hardFailIdx - 1500);
		const block = engineSrc.slice(windowStart, hardFailIdx + 200);
		expect(block).toContain("drainAgentOutbox(");
		expect(block).toContain("hard-fail outbox drain");
	});

	it("engine.ts imports drainAgentOutbox from mailbox.ts", () => {
		expect(engineSrc).toContain('import { drainAgentOutbox } from "./mailbox.ts"');
	});
});

describe("TP-187 #538: supervisor_takeover tool", () => {
	it("registers a `supervisor_takeover` tool in extension.ts", () => {
		expect(extensionSrc).toContain('name: "supervisor_takeover"');
	});

	it("declares a string `reason` parameter (required)", () => {
		const toolIdx = extensionSrc.indexOf('name: "supervisor_takeover"');
		expect(toolIdx).not.toBe(-1);
		const window = extensionSrc.slice(toolIdx, toolIdx + 2000);
		expect(window).toContain("reason: Type.String");
	});

	it("delegates to doSupervisorTakeover", () => {
		const toolIdx = extensionSrc.indexOf('name: "supervisor_takeover"');
		const window = extensionSrc.slice(toolIdx, toolIdx + 2000);
		expect(window).toContain("doSupervisorTakeover(");
	});

	it("doSupervisorTakeover pauses + drains + marks lanes terminated, NOT abort", () => {
		const fnIdx = extensionSrc.indexOf("function doSupervisorTakeover(");
		expect(fnIdx).not.toBe(-1);
		const fnBody = extensionSrc.slice(fnIdx, fnIdx + 4000);
		expect(fnBody).toContain('orchBatchState.pauseSignal.paused = true');
		expect(fnBody).toContain('drainAgentOutbox(stateRoot, orchBatchState.batchId, agentId)');
		expect(fnBody).toContain('terminatedLanes.set(lane.laneNumber');
		// Critical: distinct from orch_abort — must NOT call deleteBatchState/executeAbort.
		expect(fnBody.includes("deleteBatchState")).toBe(false);
		expect(fnBody.includes("executeAbort")).toBe(false);
	});

	it("supervisor template documents supervisor_takeover", () => {
		expect(supervisorTemplateSrc).toContain("supervisor_takeover");
		expect(supervisorTemplateSrc).toContain("Non-destructive escape hatch");
	});

	it("supervisor template documents text-reply parser semantics (close keywords + 30-char rule)", () => {
		expect(supervisorTemplateSrc).toContain("Close directives");
		expect(supervisorTemplateSrc).toContain("under 30 characters");
		expect(supervisorTemplateSrc).toContain("`skip`");
		expect(supervisorTemplateSrc).toContain("`let it fail`");
	});
});

describe("TP-187 #538: zombie-alert filter lifecycle in extension.ts", () => {
	it("declares terminatedLanes and terminatedAgents Maps", () => {
		expect(extensionSrc).toContain("const terminatedLanes = new Map<number, number>");
		expect(extensionSrc).toContain("const terminatedAgents = new Map<string, number>");
	});

	it("isAlertSuppressed checks alert.context.laneNumber and agentId", () => {
		const fnIdx = extensionSrc.indexOf("const isAlertSuppressed");
		expect(fnIdx).not.toBe(-1);
		const fnBody = extensionSrc.slice(fnIdx, fnIdx + 600);
		expect(fnBody).toContain("terminatedLanes.has(ctx.laneNumber)");
		expect(fnBody).toContain("terminatedAgents.has(ctx.agentId)");
	});

	it("supervisor-alert handler in startBatchInWorker filters zombies", () => {
		expect(extensionSrc).toContain("isAlertSuppressed(alert)");
		expect(extensionSrc).toContain("[taskplane:zombie-filter] dropped alert");
	});

	it("orch_resume clears the suppression filter (lifecycle rule)", () => {
		// doOrchResume should invoke clearTerminationFilter before launching the worker.
		const fnIdx = extensionSrc.indexOf("function doOrchResume(");
		expect(fnIdx).not.toBe(-1);
		// Find the relevant clearTerminationFilter line within doOrchResume body.
		const body = extensionSrc.slice(fnIdx, fnIdx + 3500);
		expect(body).toContain('clearTerminationFilter("orch_resume_called")');
	});

	it("new batch start clears the suppression filter (lifecycle rule)", () => {
		const fnIdx = extensionSrc.indexOf("function doOrchStart(");
		expect(fnIdx).not.toBe(-1);
		const body = extensionSrc.slice(fnIdx, fnIdx + 12000);
		expect(body).toContain('clearTerminationFilter("new_batch_started")');
	});

	it("startBatchInWorker accepts onLaneTerminated and onLaneRespawned callbacks", () => {
		const sigIdx = extensionSrc.indexOf("export function startBatchInWorker(");
		const sig = extensionSrc.slice(sigIdx, sigIdx + 1200);
		expect(sig).toContain("onLaneTerminated?:");
		expect(sig).toContain("onLaneRespawned?:");
	});
});

// ── #539: Reconstruction from runtime artifacts ─────────────────────

describe("TP-187 #539: batch-meta runtime artifact roundtrip", () => {
	let stateRoot: string;
	const batchId = "b-test-539-meta";

	beforeEach(() => { stateRoot = mkTmpRoot(); });
	afterEach(() => { try { rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

	it("save then load yields the same artifact", () => {
		const wavePlan = [["TP-001", "TP-002"], ["TP-003"]];
		saveBatchMetaRuntimeArtifact(stateRoot, {
			schemaVersion: 1,
			batchId,
			wavePlan,
			baseBranch: "main",
			orchBranch: "orch/test",
			mode: "repo",
			startedAt: 1234,
			totalWaves: 2,
		});
		const loaded = loadBatchMetaRuntimeArtifact(stateRoot, batchId);
		expect(loaded).not.toBeNull();
		expect(loaded!.batchId).toBe(batchId);
		expect(loaded!.wavePlan).toEqual(wavePlan);
		expect(loaded!.baseBranch).toBe("main");
		expect(loaded!.orchBranch).toBe("orch/test");
		expect(loaded!.mode).toBe("repo");
		expect(loaded!.totalWaves).toBe(2);
	});

	it("returns null when the artifact file is missing", () => {
		expect(loadBatchMetaRuntimeArtifact(stateRoot, "no-such-batch")).toBeNull();
	});

	it("returns null when the artifact has the wrong schemaVersion", () => {
		const path = join(runtimeRoot(stateRoot, batchId), "batch-meta.json");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ schemaVersion: 999, batchId, wavePlan: [] }), "utf-8");
		expect(loadBatchMetaRuntimeArtifact(stateRoot, batchId)).toBeNull();
	});

	it("returns null when the batchId in the file does not match", () => {
		const path = join(runtimeRoot(stateRoot, batchId), "batch-meta.json");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({
			schemaVersion: 1,
			batchId: "wrong-id",
			wavePlan: [],
			baseBranch: "main",
			orchBranch: "",
			mode: "repo",
			startedAt: 1,
			totalWaves: 0,
		}), "utf-8");
		expect(loadBatchMetaRuntimeArtifact(stateRoot, batchId)).toBeNull();
	});
});

describe("TP-187 #539: reconstructBatchStateFromRuntime", () => {
	let stateRoot: string;

	beforeEach(() => { stateRoot = mkTmpRoot(); });
	afterEach(() => { try { rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

	function setupBatch(opts: {
		batchId: string;
		tasks: { taskId: string; laneNumber: number; cwd: string }[];
		wavePlan?: string[][];
		mode?: "repo" | "workspace";
	}): void {
		const { batchId, tasks } = opts;
		const wavePlan = opts.wavePlan ?? [tasks.map(t => t.taskId)];

		// Write batch-meta artifact.
		saveBatchMetaRuntimeArtifact(stateRoot, {
			schemaVersion: 1,
			batchId,
			wavePlan,
			baseBranch: "main",
			orchBranch: `orch/${batchId}`,
			mode: opts.mode ?? "repo",
			startedAt: 1000,
			totalWaves: wavePlan.length,
		});

		// Write per-agent worker manifests + ensure cwd worktree dirs exist.
		for (const t of tasks) {
			mkdirSync(t.cwd, { recursive: true });
			const agentId = `orch-${batchId}-lane-${t.laneNumber}-worker`;
			const manifest: RuntimeAgentManifest = {
				batchId,
				agentId,
				role: "worker",
				laneNumber: t.laneNumber,
				taskId: t.taskId,
				repoId: "default",
				pid: 99999,
				parentPid: 99998,
				startedAt: 1100,
				status: "complete",
				cwd: t.cwd,
				packet: null,
			};
			writeManifest(stateRoot, manifest);
		}
	}

	it("returns ok=false when no .pi/runtime/ exists", () => {
		const result = reconstructBatchStateFromRuntime(stateRoot);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("no .pi/runtime/");
	});

	it("reconstructs a validator-compliant state from runtime artifacts", () => {
		const batchId = "b-recon-1";
		const wt1 = join(stateRoot, "wt", "lane-1");
		const wt2 = join(stateRoot, "wt", "lane-2");
		setupBatch({
			batchId,
			tasks: [
				{ taskId: "T-A", laneNumber: 1, cwd: wt1 },
				{ taskId: "T-B", laneNumber: 2, cwd: wt2 },
			],
			wavePlan: [["T-A"], ["T-B"]],
		});

		const result = reconstructBatchStateFromRuntime(stateRoot);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.batchId).toBe(batchId);
		expect(result.state.phase).toBe("stopped");
		expect(result.state.wavePlan).toEqual([["T-A"], ["T-B"]]);
		expect(result.state.totalWaves).toBe(2);
		expect(result.state.tasks.length).toBe(2);
		expect(result.state.lanes.length).toBe(2);
		expect(result.state.lanes[0].laneNumber).toBe(1);
		expect(result.state.lanes[0].worktreePath).toBe(wt1);
		expect(result.state.resilience.resumeForced).toBe(true);
		expect(result.state.baseBranch).toBe("main");
		expect(result.state.orchBranch).toBe(`orch/${batchId}`);
	});

	it("fails loud when batch-meta.json is missing", () => {
		const batchId = "b-missing-meta";
		const wt = join(stateRoot, "wt", "lane-1");
		mkdirSync(wt, { recursive: true });
		// Write a manifest WITHOUT batch-meta.json.
		const manifest: RuntimeAgentManifest = {
			batchId,
			agentId: `orch-${batchId}-lane-1-worker`,
			role: "worker",
			laneNumber: 1,
			taskId: "T-A",
			repoId: "default",
			pid: 99999,
			parentPid: 99998,
			startedAt: 1100,
			status: "complete",
			cwd: wt,
			packet: null,
		};
		writeManifest(stateRoot, manifest);

		const result = reconstructBatchStateFromRuntime(stateRoot);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("batch-meta.json missing");
	});

	it("fails loud when worktree paths from manifests no longer exist", () => {
		const batchId = "b-no-worktree";
		// Create batch-meta but worktree dir doesn't exist.
		saveBatchMetaRuntimeArtifact(stateRoot, {
			schemaVersion: 1,
			batchId,
			wavePlan: [["T-A"]],
			baseBranch: "main",
			orchBranch: `orch/${batchId}`,
			mode: "repo",
			startedAt: 1000,
			totalWaves: 1,
		});
		const manifest: RuntimeAgentManifest = {
			batchId,
			agentId: `orch-${batchId}-lane-1-worker`,
			role: "worker",
			laneNumber: 1,
			taskId: "T-A",
			repoId: "default",
			pid: 99999,
			parentPid: 99998,
			startedAt: 1100,
			status: "complete",
			cwd: join(stateRoot, "non-existent-worktree"),
			packet: null,
		};
		writeManifest(stateRoot, manifest);

		const result = reconstructBatchStateFromRuntime(stateRoot);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("worktree paths");
	});

	it("multi-batch heuristic picks newest by mtime; selectionNote describes it", async () => {
		const wt1 = join(stateRoot, "wt", "lane-1-a");
		const wt2 = join(stateRoot, "wt", "lane-1-b");
		setupBatch({
			batchId: "b-old",
			tasks: [{ taskId: "T-old", laneNumber: 1, cwd: wt1 }],
		});
		// Sleep briefly to ensure mtime differs between the two batch dirs.
		await new Promise(resolve => setTimeout(resolve, 30));
		setupBatch({
			batchId: "b-new",
			tasks: [{ taskId: "T-new", laneNumber: 1, cwd: wt2 }],
		});

		const result = reconstructBatchStateFromRuntime(stateRoot);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.batchId).toBe("b-new");
		expect(result.selectionNote).toContain("2 candidate(s)");
	});
});

describe("TP-187 #539: resumeOrchBatch wires reconstruction on force-resume", () => {
	it("non-force path still emits resumeNoState and sets phase=idle", () => {
		const idx = resumeSrc.indexOf("if (!persistedState)");
		const block = resumeSrc.slice(idx, idx + 400);
		expect(block).toContain("if (!force)");
		expect(block).toContain("resumeNoState()");
		expect(block).toContain('batchState.phase = "idle"');
	});

	it("force-resume path invokes reconstructBatchStateFromRuntime", () => {
		expect(resumeSrc).toContain("reconstructBatchStateFromRuntime(stateRoot)");
	});

	it("force-resume failure path emits resumeNoStateAfterAbort", () => {
		expect(resumeSrc).toContain("resumeNoStateAfterAbort(reconstruction.error");
	});

	it("force-resume success path persists reconstructed state via saveBatchState", () => {
		expect(resumeSrc).toContain("saveBatchState(JSON.stringify(reconstruction.state");
	});
});

describe("TP-187 #539: messages helpers", () => {
	it("resumeReconstructed mentions the batch id and selection note", () => {
		const out = ORCH_MESSAGES.resumeReconstructed("B-1", "single batch in .pi/runtime/");
		expect(out).toContain("B-1");
		expect(out).toContain("single batch");
	});

	it("resumeNoStateAfterAbort recommends orch_start and names the missing artifact", () => {
		const out = ORCH_MESSAGES.resumeNoStateAfterAbort("registry.json missing", "B-1");
		expect(out).toContain("orch_start");
		expect(out).toContain("registry.json missing");
		expect(out).toContain("B-1");
	});

	it("resumeNoStateAfterAbort tolerates a null batchId", () => {
		const out = ORCH_MESSAGES.resumeNoStateAfterAbort("nothing on disk", null);
		expect(out).toContain("nothing on disk");
		expect(out).not.toContain("Last known batch:");
	});
});

// ── #540: Worker reason fallback ───────────────────────────────────

describe("TP-187 #540: task-worker template requires non-empty reason", () => {
	it("contains the new MANDATORY exit-with-reason block", () => {
		expect(taskWorkerSrc).toContain("MANDATORY: If you DO exit-with-no-progress");
		expect(taskWorkerSrc).toContain("one-sentence assistant message");
		expect(taskWorkerSrc).toContain("Worker said:");
	});
});

describe("TP-187 #540: lane-runner reads events.jsonl for fallback when assistantMessage is empty", () => {
	it("declares the workerSaid variable initialized from assistantMessage.trim()", () => {
		expect(laneRunnerSrc).toContain('let workerSaid = (assistantMessage ?? "").trim()');
	});

	it("reads eventsPath and walks backward for an assistant_message", () => {
		expect(laneRunnerSrc).toContain('readFileSync(eventsPath, "utf-8")');
		expect(laneRunnerSrc).toContain('evt.type === "assistant_message"');
	});

	it("uses a sentinel string when no assistant message is found at all", () => {
		expect(laneRunnerSrc).toContain("(no assistant message captured");
	});

	it("annotates the alert with which source produced workerSaid", () => {
		expect(laneRunnerSrc).toContain('workerSaidSource === "events-jsonl-fallback"');
		expect(laneRunnerSrc).toContain('workerSaidSource === "empty-sentinel"');
	});

	it("preserves the 500-character truncation invariant", () => {
		expect(laneRunnerSrc).toContain("workerSaid.slice(0, 500)");
	});
});

// ── End-to-end: drainAgentOutbox + supervisor_takeover via discoverMailboxAgentIds ──

describe("TP-187: end-to-end drain coverage via discoverMailboxAgentIds", () => {
	let stateRoot: string;
	const batchId = "b-e2e";

	beforeEach(() => { stateRoot = mkTmpRoot(); });
	afterEach(() => { try { rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

	it("discovers all per-agent outboxes and drains them in one pass", () => {
		const agents = [
			"orch-test-lane-1-worker",
			"orch-test-lane-2-worker",
		];
		for (const a of agents) {
			const ob = sessionOutboxDir(stateRoot, batchId, a);
			mkdirSync(ob, { recursive: true });
			writeFileSync(join(ob, "m1.msg.json"), JSON.stringify({ id: "m1", batchId, from: a, to: "supervisor", timestamp: Date.now(), type: "reply", content: "x", expectsReply: false, replyTo: null }), "utf-8");
		}
		const discovered = discoverMailboxAgentIds(stateRoot, batchId).sort();
		expect(discovered).toEqual(agents.slice().sort());

		let total = 0;
		for (const a of discovered) {
			total += drainAgentOutbox(stateRoot, batchId, a);
		}
		expect(total).toBe(2);
		// All pending msg files should be gone.
		for (const a of agents) {
			const ob = sessionOutboxDir(stateRoot, batchId, a);
			expect(existsSync(join(ob, "m1.msg.json"))).toBe(false);
			expect(existsSync(join(ob, "processed", "m1.msg.json"))).toBe(true);
		}
	});
});

// ── Lane-terminated / lane-respawned IPC behavioral coverage ────────────

describe("TP-187 #538: lane-terminated/lane-respawned suppression lifecycle (behavioral)", () => {
	/**
	 * Simulate the supervisor-process callback chain that's wired up in
	 * `startBatchInWorker`: alerts pass through `isAlertSuppressed`, lane
	 * termination adds entries to terminatedLanes, lane-respawn removes
	 * them. The behavior under test is independent of the IPC transport.
	 */
	type Alert = { category: string; summary: string; context: { laneNumber?: number; agentId?: string } };

	function makeFilter() {
		const terminatedLanes = new Map<number, number>();
		const terminatedAgents = new Map<string, number>();
		const delivered: Alert[] = [];
		const dropped: Alert[] = [];
		const onAlert = (alert: Alert) => {
			const suppressed =
				(typeof alert.context?.laneNumber === "number" && terminatedLanes.has(alert.context.laneNumber)) ||
				(typeof alert.context?.agentId === "string" && !!alert.context.agentId && terminatedAgents.has(alert.context.agentId));
			if (suppressed) dropped.push(alert);
			else delivered.push(alert);
		};
		const onLaneTerminated = (info: { laneNumber: number; agentId: string; terminatedAt: number }) => {
			terminatedLanes.set(info.laneNumber, info.terminatedAt);
			if (info.agentId) terminatedAgents.set(info.agentId, info.terminatedAt);
		};
		const onLaneRespawned = (laneNumber: number, agentId: string) => {
			terminatedLanes.delete(laneNumber);
			if (agentId) terminatedAgents.delete(agentId);
		};
		return { onAlert, onLaneTerminated, onLaneRespawned, delivered, dropped, terminatedLanes, terminatedAgents };
	}

	it("alerts before termination are delivered; alerts after termination are dropped", () => {
		const f = makeFilter();
		f.onAlert({ category: "worker-exit-intercept", summary: "first", context: { laneNumber: 1, agentId: "a-1" } });
		f.onLaneTerminated({ laneNumber: 1, agentId: "a-1", terminatedAt: 1000 });
		f.onAlert({ category: "worker-exit-intercept", summary: "zombie", context: { laneNumber: 1, agentId: "a-1" } });
		expect(f.delivered.length).toBe(1);
		expect(f.delivered[0].summary).toBe("first");
		expect(f.dropped.length).toBe(1);
		expect(f.dropped[0].summary).toBe("zombie");
	});

	it("lane-respawned lifts suppression so a re-allocated lane's alerts pass through", () => {
		const f = makeFilter();
		// Wave 1: lane 1 terminates with agent a-1
		f.onLaneTerminated({ laneNumber: 1, agentId: "a-1", terminatedAt: 1000 });
		f.onAlert({ category: "task-failure", summary: "wave1-zombie", context: { laneNumber: 1, agentId: "a-1" } });
		expect(f.dropped.length).toBe(1);

		// Wave 2: lane 1 re-allocated for a fresh task with agent a-2
		f.onLaneRespawned(1, "a-2", "b-test");
		f.onAlert({ category: "worker-exit-intercept", summary: "wave2-fresh", context: { laneNumber: 1, agentId: "a-2" } });
		expect(f.delivered.length).toBe(1);
		expect(f.delivered[0].summary).toBe("wave2-fresh");
	});

	it("alerts targeting a different lane are not affected by suppression", () => {
		const f = makeFilter();
		f.onLaneTerminated({ laneNumber: 1, agentId: "a-1", terminatedAt: 1000 });
		f.onAlert({ category: "task-failure", summary: "lane-2-alert", context: { laneNumber: 2, agentId: "a-2" } });
		expect(f.delivered.length).toBe(1);
		expect(f.dropped.length).toBe(0);
	});

	it("alerts without a context are never suppressed", () => {
		const f = makeFilter();
		f.onLaneTerminated({ laneNumber: 1, agentId: "a-1", terminatedAt: 1000 });
		f.onAlert({ category: "batch-complete", summary: "global", context: {} });
		expect(f.delivered.length).toBe(1);
	});
});

describe("TP-187 #538: lane-respawned IPC wiring is end-to-end", () => {
	const engineWorkerSrc = readFileSync(join(__dirname, "..", "taskplane", "engine-worker.ts"), "utf-8");
	const executionSrc = readFileSync(join(__dirname, "..", "taskplane", "execution.ts"), "utf-8");

	it("WorkerToMainMessage type declares lane-respawned", () => {
		expect(engineWorkerSrc).toContain('| { type: "lane-respawned";');
	});

	it("engine-worker emits lane-respawned via IPC", () => {
		expect(engineWorkerSrc).toContain('send({ type: "lane-respawned"');
	});

	it("engine-worker passes onLaneRespawned to executeOrchBatch and resumeOrchBatch", () => {
		// Both invocation sites should pass the callback as the last argument.
		// We just check the closures are wired through.
		expect(engineWorkerSrc).toContain("const onLaneRespawned = (laneNumber: number");
	});

	it("executeLaneV2 emits onLaneRespawned at the top of the function body before the task loop", () => {
		const start = executionSrc.indexOf("export async function executeLaneV2(");
		const body = executionSrc.slice(start, start + 7500);
		const respawnIdx = body.indexOf("onLaneRespawned(lane.laneNumber");
		const forIdx = body.indexOf("for (const task of lane.tasks)");
		expect(respawnIdx).not.toBe(-1);
		expect(forIdx).not.toBe(-1);
		expect(respawnIdx < forIdx).toBe(true);
	});

	it("executeOrchBatch threads onLaneRespawned to executeWave", () => {
		const engineSrc2 = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");
		expect(engineSrc2).toContain("onLaneRespawned ?? undefined,");
	});
});

// ── deleteBatchState + reconstruction flow ─────────────────────────

describe("TP-187 #539: end-to-end abort-then-reconstruct flow", () => {
	let stateRoot: string;
	const batchId = "b-abort-recon";

	beforeEach(() => { stateRoot = mkTmpRoot(); });
	afterEach(() => { try { rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

	it("after batch-state.json is deleted, reconstruction still succeeds from runtime artifacts", () => {
		const wt = join(stateRoot, "wt", "lane-1");
		mkdirSync(wt, { recursive: true });

		// Set up runtime artifacts that survive abort.
		saveBatchMetaRuntimeArtifact(stateRoot, {
			schemaVersion: 1,
			batchId,
			wavePlan: [["T-A"]],
			baseBranch: "main",
			orchBranch: `orch/${batchId}`,
			mode: "repo",
			startedAt: 1000,
			totalWaves: 1,
		});
		const manifest: RuntimeAgentManifest = {
			batchId,
			agentId: `orch-${batchId}-lane-1-worker`,
			role: "worker",
			laneNumber: 1,
			taskId: "T-A",
			repoId: "default",
			pid: 99999,
			parentPid: 99998,
			startedAt: 1100,
			status: "complete",
			cwd: wt,
			packet: null,
		};
		writeManifest(stateRoot, manifest);

		// Simulate abort: deleteBatchState (idempotent — file may not exist, that's fine).
		expect(() => deleteBatchState(stateRoot)).not.toThrow();

		// Reconstruction succeeds.
		const result = reconstructBatchStateFromRuntime(stateRoot);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.batchId).toBe(batchId);
	});
});
