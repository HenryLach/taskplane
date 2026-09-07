/**
 * #631 — Replacement supervisor cannot orch_resume the batch it inherits.
 *
 * Activation imported phase 'executing' into memory; the in-memory guard
 * refused every recovery tool even though checkResumeEligibility on disk
 * treats 'executing' as resumable (orchestrator disconnected). Fix: persist
 * the ENGINE's identity (pid) and decide from VERIFIED engine liveness plus
 * prior-supervisor evidence — never from timestamps, never bypassed by force.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";
import {
	assessEngineLiveness,
	decideInheritedActivePhase,
	decideRecoveryOwnership,
	engineIdentityPath,
	findBatchesForOrchBranch,
	markEngineExited,
	OPERATOR_CONFIRMED_PID,
	readEngineIdentity,
	recordOperatorConfirmedShutdown,
	writeEngineIdentity,
} from "../taskplane/engine-identity.ts";
import { isProcessAlive } from "../taskplane/process-registry.ts";
import { defaultBatchDiagnostics, defaultResilienceState } from "../taskplane/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
function readSrc(file: string): string {
	return readFileSync(join(HERE, "..", "taskplane", file), "utf-8");
}

const BATCH = "henrylach-20260905T210935";

describe("#631 — engine identity persistence", () => {
	it("write → read round-trip; exited marker preserved for forensics", () => {
		const root = mkdtempSync(join(tmpdir(), "tp631-id-"));
		try {
			expect(readEngineIdentity(root, BATCH)).toBe(null);
			writeEngineIdentity(root, {
				batchId: BATCH,
				pid: 59452,
				supervisorPid: 1000,
				startedAt: 1788656981285,
			});
			const id = readEngineIdentity(root, BATCH)!;
			expect(id.pid).toBe(59452);
			expect(id.supervisorPid).toBe(1000);
			expect(id.exitedAt).toBe(undefined);
			expect(engineIdentityPath(root, BATCH).replace(/\\/g, "/")).toContain(
				`/.pi/runtime/${BATCH}/engine.json`,
			);

			expect(
				markEngineExited(root, BATCH, {
					pid: 59452,
					exitCode: 0,
					exitReason: "child-exit",
					exitedAt: 1788657000000,
				}),
			).toBe(true);
			const after = readEngineIdentity(root, BATCH)!;
			expect(after.exitedAt).toBe(1788657000000);
			expect(after.exitCode).toBe(0);
			expect(after.exitReason).toBe("child-exit");
			expect(after.pid).toBe(59452); // identity retained
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("tolerates a corrupt or partial file (treated as no identity)", () => {
		const root = mkdtempSync(join(tmpdir(), "tp631-corrupt-"));
		try {
			const p = engineIdentityPath(root, BATCH);
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, "{ not json");
			expect(readEngineIdentity(root, BATCH)).toBe(null);
			writeFileSync(p, JSON.stringify({ batchId: BATCH })); // no pid
			expect(readEngineIdentity(root, BATCH)).toBe(null);
			expect(assessEngineLiveness(root, BATCH).status).toBe("none");
			// markEngineExited on a missing file is a no-op
			expect(markEngineExited(root, "other-batch", { pid: 1, exitReason: "x" })).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("assessEngineLiveness: alive / dead via injected probe; exited wins over probe", () => {
		const root = mkdtempSync(join(tmpdir(), "tp631-live-"));
		try {
			writeEngineIdentity(root, { batchId: BATCH, pid: 4242, supervisorPid: 1, startedAt: 1 });
			expect(assessEngineLiveness(root, BATCH, () => true).status).toBe("alive");
			expect(assessEngineLiveness(root, BATCH, () => false).status).toBe("dead");
			markEngineExited(root, BATCH, { pid: 4242, exitReason: "child-exit" });
			// Even if a pid was recycled and looks alive, a recorded exit is authoritative.
			expect(assessEngineLiveness(root, BATCH, () => true).status).toBe("exited");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("SAGE REPRO: a delayed exit callback from OLD engine A must not mark NEW engine B exited (pid-scoped)", () => {
		const root = mkdtempSync(join(tmpdir(), "tp631-race-"));
		try {
			writeEngineIdentity(root, { batchId: BATCH, pid: 1111, supervisorPid: 1, startedAt: 1 }); // A
			writeEngineIdentity(root, { batchId: BATCH, pid: 2222, supervisorPid: 2, startedAt: 2 }); // B (successor)
			expect(markEngineExited(root, BATCH, { pid: 1111, exitReason: "child-exit" })).toBe(false); // A's late callback
			expect(assessEngineLiveness(root, BATCH, () => true).status).toBe("alive"); // B still owns the file
			expect(readEngineIdentity(root, BATCH)!.pid).toBe(2222);
			expect(markEngineExited(root, BATCH, { pid: 2222, exitReason: "child-exit" })).toBe(true);
			expect(assessEngineLiveness(root, BATCH, () => true).status).toBe("exited");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("recordOperatorConfirmedShutdown: only for batches with NO identity; yields an exited identity", () => {
		const root = mkdtempSync(join(tmpdir(), "tp631-confirm-"));
		try {
			const ok = recordOperatorConfirmedShutdown(root, BATCH, {
				supervisorPid: 77,
				note: "pgrep -af engine-worker: none",
			});
			expect(ok.ok).toBe(true);
			const live = assessEngineLiveness(root, BATCH, () => true);
			expect(live.status).toBe("exited");
			expect(live.identity!.pid).toBe(OPERATOR_CONFIRMED_PID);
			expect(live.identity!.exitReason).toContain("operator-confirmed-shutdown: pgrep");
			// Re-confirming is idempotent (existing identity IS the operator marker).
			expect(recordOperatorConfirmedShutdown(root, BATCH, { supervisorPid: 77 }).ok).toBe(true);
			// A REAL identity cannot be overridden by confirmation.
			writeEngineIdentity(root, { batchId: "other", pid: 4242, supervisorPid: 1, startedAt: 1 });
			const refused = recordOperatorConfirmedShutdown(root, "other", { supervisorPid: 77 });
			expect(refused.ok).toBe(false);
			expect(refused.reason).toContain("PID 4242");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("isProcessAlive: own pid alive; invalid pids dead; only ESRCH means dead (EPERM/unknown fail closed)", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
		expect(isProcessAlive(0)).toBe(false);
		expect(isProcessAlive(-1)).toBe(false);
		expect(readSrc("process-registry.ts").replace(/\s+/g, " ")).toContain('return code !== "ESRCH";');
		expect(readSrc("supervisor.ts").replace(/\s+/g, " ")).toContain('return code !== "ESRCH";');
	});
});

describe("#631 — decideInheritedActivePhase (pure policy)", () => {
	const identity = { batchId: BATCH, pid: 4242, supervisorPid: 1000, startedAt: 1788656981285 };

	it("engine ALIVE → refuse, names the pid, and states force does not bypass", () => {
		const d = decideInheritedActivePhase({
			phase: "executing",
			batchId: BATCH,
			liveness: { status: "alive", identity },
			priorSupervisor: { pid: 1000, alive: false },
			operation: "orch_resume",
		});
		expect(d.proceed).toBe(false);
		expect(d.reason).toContain("PID 4242");
		expect(d.reason).toContain("still ALIVE");
		expect(d.reason).toContain("force does not bypass");
		expect(d.reason).toContain("taskkill /PID 4242");
	});

	it("engine DEAD → proceed (verified shutdown)", () => {
		const d = decideInheritedActivePhase({
			phase: "executing",
			batchId: BATCH,
			liveness: { status: "dead", identity },
			priorSupervisor: { pid: 1000, alive: true }, // wedged-but-alive supervisor is irrelevant once the engine is gone
			operation: "orch_resume",
		});
		expect(d.proceed).toBe(true);
		expect(d.reason).toContain("PID 4242 is dead");
		expect(d.reason).toContain("treated as disconnected");
	});

	it("engine EXITED → proceed, quoting the recorded exit reason", () => {
		const d = decideInheritedActivePhase({
			phase: "merging",
			batchId: BATCH,
			liveness: { status: "exited", identity: { ...identity, exitedAt: 5, exitReason: "child-exit" } },
			priorSupervisor: null,
			operation: "orch_retry_task",
		});
		expect(d.proceed).toBe(true);
		expect(d.reason).toContain("exited (child-exit)");
	});

	it("no identity + prior supervisor DEAD → REFUSE (a forked engine outlives its supervisor); names the audited path", () => {
		const d = decideInheritedActivePhase({
			phase: "executing",
			batchId: BATCH,
			liveness: { status: "none", identity: null },
			priorSupervisor: { pid: 1000, alive: false },
			operation: "orch_resume",
		});
		expect(d.proceed).toBe(false);
		expect(d.reason).toContain("PID 1000) is dead");
		expect(d.reason).toContain("does not prove the engine is gone");
		expect(d.reason).toContain("orch_confirm_engine_shutdown");
		expect(d.reason).toContain("No hand-edit");
	});

	it("no identity + prior supervisor ALIVE → refuse (its engine may still be driving)", () => {
		const d = decideInheritedActivePhase({
			phase: "executing",
			batchId: BATCH,
			liveness: { status: "none", identity: null },
			priorSupervisor: { pid: 1000, alive: true },
			operation: "orch_resume",
		});
		expect(d.proceed).toBe(false);
		expect(d.reason).toContain("PID 1000) is still ALIVE");
		expect(d.reason).toContain("orch_confirm_engine_shutdown");
	});

	it("no identity + no prior-supervisor evidence → refuse (unknown ownership), never hand-edit", () => {
		const d = decideInheritedActivePhase({
			phase: "executing",
			batchId: BATCH,
			liveness: { status: "none", identity: null },
			priorSupervisor: null,
			operation: "orch_skip_task",
		});
		expect(d.proceed).toBe(false);
		expect(d.reason).toContain("No previous-supervisor record");
		expect(d.reason).toContain("orch_confirm_engine_shutdown");
	});
});

describe("#631 — decideRecoveryOwnership (the single gate; Sage bypass scenarios)", () => {
	const identity = { batchId: BATCH, pid: 4242, supervisorPid: 1000, startedAt: 1 };
	const none = { status: "none" as const, identity: null };
	const dead = { status: "dead" as const, identity };
	const alive = { status: "alive" as const, identity };

	it("BYPASS 1 (fixed): cached idle + persisted executing + no identity → REFUSE (confirm path)", () => {
		const d = decideRecoveryOwnership({
			operation: "orch_resume",
			local: { engineAttached: false, phase: "idle", batchId: "", pid: null },
			target: { batchId: BATCH, phase: "executing" },
			liveness: none,
			priorSupervisor: { pid: 1000, alive: false },
		});
		expect(d.proceed).toBe(false);
		expect(d.reason).toContain("orch_confirm_engine_shutdown");
	});

	it("BYPASS 1b (fixed): cached idle + persisted PAUSED + no identity → still REFUSE (target, not cache, decides)", () => {
		const d = decideRecoveryOwnership({
			operation: "orch_retry_task",
			local: { engineAttached: false, phase: "idle", batchId: "", pid: null },
			target: { batchId: BATCH, phase: "paused" },
			liveness: none,
			priorSupervisor: null,
		});
		expect(d.proceed).toBe(false);
	});

	it("BYPASS 2 (fixed): local engine still exiting while cached phase is paused → REFUSE (teardown race)", () => {
		const d = decideRecoveryOwnership({
			operation: "orch_resume",
			local: { engineAttached: true, phase: "paused", batchId: BATCH, pid: 555 },
			target: { batchId: BATCH, phase: "paused" },
			liveness: { status: "alive", identity: { ...identity, pid: 555 } },
			priorSupervisor: null,
		});
		expect(d.proceed).toBe(false);
		expect(d.reason).toContain("still shutting down");
		expect(d.reason).toContain("PID 555");
	});

	it("BYPASS 3 (fixed): main-thread fallback engine counts as attached → REFUSE", () => {
		const d = decideRecoveryOwnership({
			operation: "orch_skip_task",
			local: { engineAttached: true, phase: "executing", batchId: BATCH, pid: process.pid },
			target: { batchId: BATCH, phase: "executing" },
			liveness: { status: "alive", identity: { ...identity, pid: process.pid } },
			priorSupervisor: null,
		});
		expect(d.proceed).toBe(false);
		expect(d.reason).toContain(`engine PID ${process.pid}`);
	});

	it("foreign alive engine → REFUSE regardless of cached phase", () => {
		for (const cached of ["idle", "paused", "executing", "failed"]) {
			const d = decideRecoveryOwnership({
				operation: "orch_force_merge",
				local: { engineAttached: false, phase: cached, batchId: BATCH, pid: null },
				target: { batchId: BATCH, phase: "paused" },
				liveness: alive,
				priorSupervisor: null,
			});
			expect(d.proceed).toBe(false);
			expect(d.reason).toContain("still ALIVE");
		}
	});

	it("verified dead engine, none attached → PROCEED (the reporter's recovery, now reachable without hand-edits)", () => {
		const d = decideRecoveryOwnership({
			operation: "orch_resume",
			local: { engineAttached: false, phase: "executing", batchId: BATCH, pid: null },
			target: { batchId: BATCH, phase: "executing" },
			liveness: dead,
			priorSupervisor: { pid: 1000, alive: true }, // wedged-but-alive supervisor is irrelevant once its engine is verified dead
		});
		expect(d.proceed).toBe(true);
	});

	it("operator-confirmed shutdown reads as exited → PROCEED", () => {
		const root = mkdtempSync(join(tmpdir(), "tp631-gate-confirm-"));
		try {
			recordOperatorConfirmedShutdown(root, BATCH, { supervisorPid: 1, note: "verified none" });
			const d = decideRecoveryOwnership({
				operation: "orch_resume",
				local: { engineAttached: false, phase: "idle", batchId: "", pid: null },
				target: { batchId: BATCH, phase: "executing" },
				liveness: assessEngineLiveness(root, BATCH, () => true),
				priorSupervisor: null,
			});
			expect(d.proceed).toBe(true);
			expect(d.reason).toContain("operator-confirmed-shutdown");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("#631 — wiring", () => {
	it("extension.ts: engine identity is published BEFORE init for BOTH modes (preallocated batchId); start refused if it cannot be", () => {
		const src = readSrc("extension.ts");
		const flat = src.replace(/\s+/g, " ");
		// The identity write precedes child.send(init).
		const writeIdx = src.indexOf("const published = writeEngineIdentity(engineStateRoot, {");
		const initIdx = src.indexOf('child.send({ type: "init", data: wkData });');
		expect(writeIdx).toBeGreaterThan(-1);
		expect(initIdx).toBeGreaterThan(writeIdx);
		expect(flat).toContain("if (!published) {");
		expect(flat).toContain("Engine start refused: could not publish engine identity");
		// The engine adopts the parent's preallocated id (fresh) / the gated target (resume).
		expect(flat).toContain(
			"const authorizedBatchId = generateBatchId(); orchBatchState.batchId = authorizedBatchId;",
		);
		expect(flat).toContain("authorizedBatchId: resumeTargetBatchId ?? undefined,");
		// No more first-state-sync identity hook.
		expect(src).not.toContain("recordEngineIdentity(");
		// Exit marking is pid-scoped.
		expect(flat).toContain(
			'markEngineExited(engineStateRoot, engineIdentityBatchId, { pid: enginePid, exitCode: code, exitReason: "child-exit", })',
		);
	});

	it("engine adopts the authorized batchId; resume refuses a target mismatch", () => {
		const worker = readSrc("engine-worker.ts").replace(/\s+/g, " ");
		expect(worker).toContain("authorizedBatchId?: string;");
		expect(worker).toContain(
			"if (data.authorizedBatchId) batchState.batchId = data.authorizedBatchId;",
		);
		const engine = readSrc("engine.ts").replace(/\s+/g, " ");
		expect(engine).toContain("batchState.batchId = batchState.batchId || generateBatchId();");
		const resume = readSrc("resume.ts").replace(/\s+/g, " ");
		expect(resume).toContain(
			"if (batchState.batchId && persistedState.batchId !== batchState.batchId) {",
		);
		expect(resume).toContain("resume target mismatch");
	});

	it("extension.ts: main-thread fallback engine publishes its own identity and is tracked as attached", () => {
		const flat = readSrc("extension.ts").replace(/\s+/g, " ");
		expect(flat).toContain("let fallbackEngineActive = false;");
		expect(flat).toContain(
			"fallbackEngineActive = true; startBatchAsync(fallbackFn, batchState, ctx, updateWidget, () => { fallbackEngineActive = false;",
		);
		expect(flat).toContain(
			'markEngineExited(fbStateRoot, fbBatchId, { pid: process.pid, exitReason: "fallback-settled" })',
		);
		expect(flat).toContain("if (isFallbackEngineActive()) return true;");
		// engineAttachedHere uses actual termination evidence, not `killed` (signal dispatched).
		expect(flat).toContain(
			"activeWorker !== null && activeWorker.exitCode === null && activeWorker.signalCode === null",
		);
	});

	it("extension.ts: ONE ownership gate, applied to resume/retry/skip/force-merge/admin-pause against the actual target", () => {
		const src = readSrc("extension.ts");
		const flat = src.replace(/\s+/g, " ");
		for (const op of [
			"orch_resume",
			"orch_retry_task",
			"orch_skip_task",
			"orch_force_merge",
			"orch_pause (administrative)",
		]) {
			expect(
				flat.includes(`recoveryOwnershipGate("${op}"`) ||
					flat.includes(`recoveryOwnershipGate( "${op}"`),
			).toBe(true);
		}
		// The old partial guards are gone.
		expect(src).not.toContain("function activePhaseGuard(");
		expect(src).not.toContain("function foreignEngineAliveRefusal(");
		expect(
			/Cannot retry task while batch is \$\{orchBatchState\.phase\}\. Pause or wait/.test(src),
		).toBe(false);
		expect(
			/Cannot skip task while batch is \$\{orchBatchState\.phase\}\. Pause or wait/.test(src),
		).toBe(false);
		expect(
			/Cannot force merge while batch is \$\{orchBatchState\.phase\}\. Pause or wait/.test(src),
		).toBe(false);
		expect(
			/A batch is currently \$\{orchBatchState\.phase\} \(\$\{orchBatchState\.batchId\}\)\. Cannot resume\./.test(
				src,
			),
		).toBe(false);
		// Case 1 lives in the pure decideRecoveryOwnership; the extension gate feeds it the local engine state.
		expect(flat).toContain("engineAttached: engineAttachedHere(),");
		expect(readSrc("engine-identity.ts")).toContain("is still shutting down");
		// Target resolution includes force-resume reconstruction so the gated batch == the resumed batch.
		expect(flat).toContain("function resolveRecoveryTarget(");
		expect(flat).toContain("const r = reconstructBatchStateFromRuntime(stateRoot);");
		expect(flat).toContain("const resumeTarget = resolveRecoveryTarget(resumeStateRoot, force);");
	});

	it("extension.ts: orch_confirm_engine_shutdown tool + /orch-confirm-engine-shutdown command share one audited helper", () => {
		const flat = readSrc("extension.ts").replace(/\s+/g, " ");
		expect(flat).toContain('name: "orch_confirm_engine_shutdown"');
		expect(flat).toContain('pi.registerCommand("orch-confirm-engine-shutdown"');
		expect(flat.split("doOrchConfirmEngineShutdown(").length - 1).toBe(3); // def + tool + command
		expect(flat).toContain("recordOperatorConfirmedShutdown(stateRoot, batchId, {");
		expect(flat).toContain('action: "confirm_engine_shutdown"');
	});

	it("extension.ts: takeover records priorSupervisor at every import site; own start/resume clears it", () => {
		const src = readSrc("extension.ts");
		const imports =
			src.split("orchBatchState.phase = batchState.phase as typeof orchBatchState.phase;").length - 1;
		const records = src.split("priorSupervisor =\n").length - 1;
		expect(imports).toBe(4);
		expect(records).toBe(4);
		expect(src.split("priorSupervisor = null; // #631").length - 1).toBe(2);
	});

	it("extension.ts: orch_pause with no engine attached → administrative pause (persisted) or honest refusal", () => {
		const flat = readSrc("extension.ts").replace(/\s+/g, " ");
		expect(flat).toContain("if (!engineAttachedHere()) {");
		expect(flat).toContain('recoveryOwnershipGate("orch_pause (administrative)"');
		expect(flat).toContain('persisted.phase = "paused";');
		expect(flat).toContain("a pause signal here would be inert");
		expect(flat).toContain("Administrative pause by replacement supervisor");
	});

	it("engine-worker.ts: orphan winds down as paused; IPC safe after channel close; handler armed before imports", () => {
		const src = readSrc("engine-worker.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain('process.on("disconnect", () => {');
		expect(flat).toContain(
			'if (p === "completed" || p === "failed" || p === "paused" || p === "stopped") return;',
		);
		expect(flat).toContain(
			'batchState.pauseSignal.paused = true; batchState.pauseSignal.cause = "operator"; process.stderr.write(',
		);
		// send() never touches a closed channel (post-disconnect send raises an ASYNC error).
		expect(flat).toContain(
			"const send = (msg: WorkerToMainMessage) => { if (!process.connected) return;",
		);
		expect(flat).toContain("const safeDisconnect = () => { if (!process.connected) return;");
		expect(src.split("safeDisconnect();").length - 1).toBe(2);
		expect(flat).toContain('if (code === "ERR_IPC_CHANNEL_CLOSED" || code === "EPIPE") return;');
		// Disconnect handler is registered BEFORE the init handler / dynamic imports.
		expect(src.indexOf('process.on("disconnect"')).toBeLessThan(
			src.indexOf('process.once("message"'),
		);
		expect(flat).toContain("if (orphanedBeforeInit) return;");
	});

	it("resume.ts: agent termination before re-execute is VERIFIED (SIGTERM → wait → SIGKILL → wait → throw)", () => {
		const src = readSrc("resume.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain("async function terminateAliveV2Agents(");
		expect(flat).toContain('process.kill(t.pid, "SIGTERM")');
		expect(flat).toContain('process.kill(pid, "SIGKILL")');
		expect(flat).toContain("cannot confirm termination of");
		expect(flat).toContain("refusing to re-execute the lane alongside a live agent");
		// Both call sites await it INSIDE their try (a throw fails the task instead of re-executing).
		expect(src.split("await terminateAliveV2Agents(").length - 1).toBe(2);
		expect(flat).toContain(
			"try { await terminateAliveV2Agents(stateRoot, persistedState.batchId, laneRecord.laneSessionId);",
		);
	});

	it("supervisor.ts: takeover summary reports engine liveness and dead-but-running agents", () => {
		const flat = readSrc("supervisor.ts").replace(/\s+/g, " ");
		expect(flat).toContain("assessEngineLiveness(stateRoot, batchState.batchId)");
		expect(flat).toContain("**Engine:**");
		expect(flat).toContain("Dead agents still marked");
		expect(flat).toContain("No registry edit needed: orch_resume reconciles it");
	});

	it("ROUND 3: fresh /orch, abort and integrate are gated; reconstruction is authorized BEFORE it is saved; fallback carries the id", () => {
		const ext = readSrc("extension.ts");
		const flat = ext.replace(/\s+/g, " ");
		// doOrchStart: gate precedes the orphan/stale-state handling.
		const startGate = ext.indexOf('operation: "orch_start"');
		const orphanDetect = ext.indexOf("const orphanResult = detectOrphanSessions(");
		expect(startGate).toBeGreaterThan(-1);
		expect(orphanDetect).toBeGreaterThan(startGate);
		expect(flat).toContain("starting a new batch now would race its teardown");
		// doOrchAbort: refuses under a foreign live engine; verifies local exit before cleanup.
		expect(flat).toContain('operation: "orch_abort"');
		expect(flat).toContain("abort here cannot stop that engine");
		// Verified exit for BOTH modes (graceful waits the grace period first), plus the fallback settle wait.
		expect(flat).toContain("exited = await waitForChildExit(child, graceMs);");
		expect(flat).toContain("exited = await waitForChildExit(child, 5_000);");
		expect(flat).toContain("Refusing to persist/delete batch state underneath a live engine");
		expect(flat).toContain("while (isFallbackEngineActive() && Date.now() < deadline)");
		// The abort gate uses the FULL rule (alive/none refuse) — not an alive-only check.
		expect(flat).toContain(
			"if (!decision.proceed) { try { unlinkSync(abortSignalFile); } catch {} return `",
		);
		// doOrchIntegrate: refuses while the batch's engine is alive.
		// Integrate binds the gate to the ACTUAL target at the canonical root (full rule).
		expect(flat).toContain('operation: "orch_integrate"');
		// Integrate: branch-bound lookup (round 6) — asserted in the ROUND 6 wiring test.
		// Start uses the full rule too (proceed only on verified dead/exited).
		expect(flat).toContain('execLog("supervisor", existing.batchId, "ownership gate: orch_start", {');
		// Fallback engine carries the authorized id.
		expect(flat).toContain("batchState.batchId = fbBatchId;");
		// resume.ts: mismatch refusal precedes the reconstruction save.
		const resume = readSrc("resume.ts");
		const mismatch = resume.indexOf("but reconstruction ");
		const save = resume.indexOf(
			"saveBatchState(JSON.stringify(reconstruction.state, null, 2), stateRoot);",
		);
		expect(mismatch).toBeGreaterThan(-1);
		expect(save).toBeGreaterThan(mismatch);
		expect(resume.replace(/\s+/g, " ")).toContain("Refusing without writing");
	});

	it("ROUND 5 (behavioural): legacy reconstructable batch (no state file, no identity) → gate refuses → confirmation resolves THAT batch → gate proceeds", async () => {
		const { reconstructBatchStateFromRuntime, saveBatchMetaRuntimeArtifact } = await import(
			"../taskplane/persistence.ts"
		);
		const { writeManifest } = await import("../taskplane/process-registry.ts");
		const root = mkdtempSync(join(tmpdir(), "tp631-legacy-"));
		try {
			const legacyId = "legacy-20260101T000000";
			const wt = join(root, "wt-1");
			mkdirSync(wt, { recursive: true });
			saveBatchMetaRuntimeArtifact(root, {
				schemaVersion: 1,
				batchId: legacyId,
				wavePlan: [["TP-1"]],
				baseBranch: "main",
				orchBranch: `orch/${legacyId}`,
				mode: "repo",
				startedAt: 1000,
				totalWaves: 1,
			});
			writeManifest(root, {
				batchId: legacyId,
				agentId: `orch-${legacyId}-lane-1-worker`,
				role: "worker",
				laneNumber: 1,
				taskId: "TP-1",
				repoId: "default",
				pid: 99999,
				parentPid: 99998,
				startedAt: 1100,
				status: "exited",
				cwd: wt,
				packet: null,
			} as never);

			// No batch-state.json, no engine.json: the recovery target is the reconstruction.
			const r = reconstructBatchStateFromRuntime(root);
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			const target = { batchId: r.batchId, phase: r.state.phase };
			expect(target.batchId).toBe(legacyId);

			// Gate: none → refuse, naming the confirm path.
			const before = decideRecoveryOwnership({
				operation: "orch_resume",
				local: { engineAttached: false, phase: "idle", batchId: "", pid: null },
				target,
				liveness: assessEngineLiveness(root, target.batchId),
				priorSupervisor: { pid: 1, alive: false },
			});
			expect(before.proceed).toBe(false);
			expect(before.reason).toContain("orch_confirm_engine_shutdown");

			// Confirmation must bind to the SAME (reconstructed) batch — not "no batch to confirm".
			const confirmed = recordOperatorConfirmedShutdown(root, target.batchId, {
				supervisorPid: process.pid,
				note: "pgrep -af engine-worker: none",
			});
			expect(confirmed.ok).toBe(true);

			const after = decideRecoveryOwnership({
				operation: "orch_resume",
				local: { engineAttached: false, phase: "idle", batchId: "", pid: null },
				target,
				liveness: assessEngineLiveness(root, target.batchId),
				priorSupervisor: { pid: 1, alive: false },
			});
			expect(after.proceed).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("ROUND 5 (wiring): one canonical root for gate AND mutation; conflicting roots refuse; confirm resolves persisted→reconstructed→cached", () => {
		const src = readSrc("extension.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain("function canonicalStateRoot(fallbackCwd: string): string {");
		expect(flat).toContain(
			"function conflictingRootsRefusal(operation: string, fallbackCwd: string): string | null {",
		);
		for (const op of ["orch_start", "orch_abort", "orch_integrate"]) {
			expect(flat).toContain(`conflictingRootsRefusal("${op}"`);
		}
		// Abort: state + gate share the canonical root; no repo-root fallback resolution remains.
		expect(flat).toContain("const stateRoot = canonicalStateRoot(ctx.cwd);");
		expect(flat).toContain("const ownershipRoot = stateRoot;");
		// Start: orphan/stale handling at the gated root.
		expect(flat).toContain(
			"detectOrphanSessions(orchConfig.orchestrator.sessionPrefix, orphanStateRoot)",
		);
		expect(src).not.toContain("deleteBatchState(repoRoot)");
		// Integrate: context resolved at the canonical root.
		expect(flat).toContain("loadBatchState: () => loadBatchState(stateRoot ?? repoRoot),");
		// Confirm: explicit batchId → persisted → reconstructed → cached.
		expect(flat).toContain(
			"const target = explicit ? null : resolveRecoveryTarget(stateRoot, true);",
		);
		expect(flat).toContain(
			"explicit || target?.batchId || orchBatchState.batchId || supervisorState.batchId",
		);
	});

	it("ROUND 7: explicit confirm target; explicit branch arg does not inherit an unrelated batchId; cleanup bound to the branch's batch", () => {
		const ext = readSrc("extension.ts");
		const flat = ext.replace(/\s+/g, " ");
		// Tool + command accept an explicit batchId.
		expect(flat).toContain("batchId: Type.Optional( Type.String({");
		expect(flat).toContain(
			"doOrchConfirmEngineShutdown(params.note, resolveToolStateRoot(ctx), params.batchId)",
		);
		expect(flat).toContain("[--batch <batchId>] <what you verified>");
		expect(flat).toContain("Pass the batchId named by the refusal explicitly.");
		// Resolver: explicit branch that differs from persisted state clears batchId.
		expect(flat).toContain("if (orchBranch && batchId && orchBranch !== parsed.orchBranchArg) {");
		expect(flat).toContain('batchId = ""; } orchBranch = parsed.orchBranchArg;');
		// Integrate binds cleanup/history to the unique branch-associated batch.
		expect(flat).toContain(
			"if (!batchId && associated.size === 1) { batchId = [...associated.values()][0].batchId; }",
		);
		// Branch cleanup receives the ownership root.
		expect(flat).toContain("deleteStaleBranches(repo.root, opId, batchId, stateRoot ?? repoRoot)");
	});

	it("ROUND 6 (behavioural): integration ownership is BRANCH-BOUND — live A is found behind orch/A even when newer B is exited or A is not reconstructable", async () => {
		const { saveBatchMetaRuntimeArtifact, reconstructBatchStateFromRuntime } = await import(
			"../taskplane/persistence.ts"
		);
		const { writeManifest } = await import("../taskplane/process-registry.ts");
		const root = mkdtempSync(join(tmpdir(), "tp631-branch-"));
		try {
			const meta = (batchId: string, startedAt: number) =>
				saveBatchMetaRuntimeArtifact(root, {
					schemaVersion: 1,
					batchId,
					wavePlan: [["TP-1"]],
					baseBranch: "main",
					orchBranch: `orch/${batchId}`,
					mode: "repo",
					startedAt,
					totalWaves: 1,
				});
			// A: live engine identity, meta present, NO worker manifests (not reconstructable).
			meta("A", 1000);
			writeEngineIdentity(root, { batchId: "A", pid: 4242, supervisorPid: 1, startedAt: 1000 });
			// B: newer, reconstructable (manifest + worktree), exited engine.
			meta("B", 2000);
			const wtB = join(root, "wt-b");
			mkdirSync(wtB, { recursive: true });
			writeManifest(root, {
				batchId: "B",
				agentId: "orch-B-lane-1-worker",
				role: "worker",
				laneNumber: 1,
				taskId: "TP-1",
				repoId: "default",
				pid: 99999,
				parentPid: 99998,
				startedAt: 2100,
				status: "exited",
				cwd: wtB,
				packet: null,
			} as never);
			writeEngineIdentity(root, { batchId: "B", pid: 5555, supervisorPid: 1, startedAt: 2000 });
			markEngineExited(root, "B", { pid: 5555, exitReason: "child-exit" });

			// Reconstruction picks B (newest, reconstructable) — the wrong batch for orch/A.
			const r = reconstructBatchStateFromRuntime(root);
			expect(r.ok && r.batchId).toBe("B");

			// Branch-bound lookup finds A behind orch/A with a LIVE pid (probe says alive).
			const forA = findBatchesForOrchBranch(root, "orch/A", () => true);
			expect(forA.map((b) => b.batchId)).toEqual(["A"]);
			expect(forA[0].liveness.status).toBe("alive");
			const gateA = decideRecoveryOwnership({
				operation: "orch_integrate",
				local: { engineAttached: false, phase: "idle", batchId: "", pid: null },
				target: { batchId: "A", phase: "unknown" },
				liveness: forA[0].liveness,
				priorSupervisor: null,
			});
			expect(gateA.proceed).toBe(false);
			expect(gateA.reason).toContain("PID 4242");

			// orch/B: exited → proceeds.
			const forB = findBatchesForOrchBranch(root, "orch/B", () => true);
			expect(forB[0].liveness.status).toBe("exited");

			// A branch with no associated runtime batch → nothing to gate (pure branch integration).
			expect(findBatchesForOrchBranch(root, "orch/nothing")).toEqual([]);

			// A runtime batch for the branch with NO identity → 'none' (gate refuses until confirmed).
			meta("C", 3000);
			const forC = findBatchesForOrchBranch(root, "orch/C");
			expect(forC[0].liveness.status).toBe("none");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("ROUND 6 (wiring): integrate gates EVERY batch associated with the selected branch", () => {
		const flat = readSrc("extension.ts").replace(/\s+/g, " ");
		expect(flat).toContain("for (const b of findBatchesForOrchBranch(integRoot, orchBranch)) {");
		expect(flat).toContain("persisted.orchBranch === orchBranch || persisted.batchId === batchId");
		expect(flat).toContain("for (const target of associated.values()) {");
		expect(flat).not.toContain("resolveRecoveryTarget(integRoot, true)");
	});

	it("ROUND 8 (behavioural): integrating branch A never deletes unrelated persisted batch B's checkpoint", async () => {
		const { deleteBatchStateIfOwned } = await import("../taskplane/extension.ts");
		const { saveBatchState, loadBatchState } = await import("../taskplane/persistence.ts");
		const root = mkdtempSync(join(tmpdir(), "tp631-own-"));
		try {
			mkdirSync(join(root, ".pi"), { recursive: true });
			const stateB = {
				schemaVersion: 4,
				phase: "completed",
				batchId: "B",
				baseBranch: "main",
				orchBranch: "orch/B",
				mode: "repo",
				startedAt: 1,
				updatedAt: 2,
				endedAt: 2,
				currentWaveIndex: 0,
				totalWaves: 1,
				wavePlan: [["TP-1"]],
				lanes: [],
				tasks: [],
				mergeResults: [],
				totalTasks: 1,
				succeededTasks: 1,
				failedTasks: 0,
				skippedTasks: 0,
				blockedTasks: 0,
				blockedTaskIds: [],
				lastError: null,
				errors: [],
				resilience: defaultResilienceState(),
				diagnostics: defaultBatchDiagnostics(),
				segments: [],
			};
			saveBatchState(JSON.stringify(stateB), root);
			expect(loadBatchState(root)?.batchId).toBe("B"); // fixture is valid
			// Integrating A (batch "A", orch/A): B's checkpoint must survive.
			expect(deleteBatchStateIfOwned(root, "A", "orch/A")).toBe(false);
			expect(loadBatchState(root)?.batchId).toBe("B");
			// Integrating with an empty batch id but B's branch: owned by branch → deleted.
			expect(deleteBatchStateIfOwned(root, "", "orch/B")).toBe(true);
			expect(loadBatchState(root)).toBe(null);
			// Nothing persisted → null.
			expect(deleteBatchStateIfOwned(root, "B", "orch/B")).toBe(null);
			// Unreadable state → preserved (ownership cannot be established).
			writeFileSync(join(root, ".pi", "batch-state.json"), "{ not json");
			expect(deleteBatchStateIfOwned(root, "B", "orch/B")).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("ROUND 9 (behavioural): post-PR CI cleanup for batch A cannot erase a newer persisted batch B; deletes A when it is the persisted one", async () => {
		const { buildCiDeps } = await import("../taskplane/extension.ts");
		const { saveBatchState, loadBatchState } = await import("../taskplane/persistence.ts");
		const root = mkdtempSync(join(tmpdir(), "tp631-ci-"));
		try {
			mkdirSync(join(root, ".pi"), { recursive: true });
			const mk = (id: string) => ({
				schemaVersion: 4,
				phase: "completed",
				batchId: id,
				baseBranch: "main",
				orchBranch: `orch/${id}`,
				mode: "repo",
				startedAt: 1,
				updatedAt: 2,
				endedAt: 2,
				currentWaveIndex: 0,
				totalWaves: 1,
				wavePlan: [["TP-1"]],
				lanes: [],
				tasks: [],
				mergeResults: [],
				totalTasks: 1,
				succeededTasks: 1,
				failedTasks: 0,
				skippedTasks: 0,
				blockedTasks: 0,
				blockedTaskIds: [],
				lastError: null,
				errors: [],
				resilience: defaultResilienceState(),
				diagnostics: defaultBatchDiagnostics(),
				segments: [],
			});
			// A's CI lifecycle was built while A was the batch; B persisted afterwards.
			const depsA = buildCiDeps(root, root, { batchId: "A", orchBranch: "orch/A" });
			saveBatchState(JSON.stringify(mk("B")), root);
			depsA.deleteBatchState();
			expect(loadBatchState(root)?.batchId).toBe("B"); // survives
			// When A itself is persisted, A's cleanup deletes it.
			saveBatchState(JSON.stringify(mk("A")), root);
			depsA.deleteBatchState();
			expect(loadBatchState(root)).toBe(null);
			// Legacy caller without an identity: refuses to delete blindly.
			saveBatchState(JSON.stringify(mk("B")), root);
			buildCiDeps(root, root).deleteBatchState();
			expect(loadBatchState(root)?.batchId).toBe("B");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("ROUND 8 (wiring): manual + auto integration use owned-only state deletion; auto sweep gets the ownership root", () => {
		const src = readSrc("extension.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain(
			"deleteBatchStateIfOwned(stateRoot ?? repoRoot, context.batchId, context.orchBranch)",
		);
		expect(flat).toContain(
			"const deleted = deleteBatchStateIfOwned(stateRoot ?? repoRoot, batchId, orchBranch);",
		);
		expect(flat).toContain(
			"deleteStaleBranches(repoRoot, opId, context.batchId, stateRoot ?? repoRoot)",
		);
		// CI lifecycle is bound to the completed batch's identity at the call site.
		expect(flat).toContain(
			"buildCiDeps(execCtx!.repoRoot, execCtx!.workspaceRoot, { batchId: orchBatchState.batchId, orchBranch: orchBatchState.orchBranch, })",
		);
		// No unconditional deletion of persisted state remains on the integration paths.
		const integ = src.slice(src.indexOf("function buildIntegrationExecutor("));
		expect(integ).not.toContain("\t\t\t\t\tdeleteBatchState(stateRoot ?? repoRoot);");
		expect(src.slice(src.indexOf("async function doOrchIntegrate("))).not.toContain(
			"\t\t\tdeleteBatchState(stateRoot);",
		);
	});

	it("waitForChildExit: resolves true on exit, false on timeout, true immediately for an already-exited child", async () => {
		const { waitForChildExit } = await import("../taskplane/extension.ts");
		const { spawn } = await import("node:child_process");
		// A child that exits promptly.
		const quick = spawn(process.execPath, ["-e", "process.exit(0)"]);
		expect(await waitForChildExit(quick, 5_000)).toBe(true);
		expect(await waitForChildExit(quick, 10)).toBe(true); // already exited → immediate
		// A child that lingers longer than the timeout.
		const slow = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
		expect(await waitForChildExit(slow, 150)).toBe(false);
		slow.kill();
		expect(await waitForChildExit(slow, 5_000)).toBe(true);
	});

	it("primer documents Pattern 9 (inherited executing batch)", () => {
		const primer = readSrc("supervisor-primer.md");
		expect(primer).toContain('### Pattern 9: You Inherited an "executing" Batch');
		expect(primer).toContain("engine.json");
		expect(primer).toContain("administrative pause");
		expect(primer).toContain("force` does NOT bypass");
		expect(primer).toContain("orch_confirm_engine_shutdown");
	});
});
