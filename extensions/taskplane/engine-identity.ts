/**
 * engine-identity.ts — Persisted identity of the batch ENGINE process (#631).
 *
 * The orchestration engine runs as a forked child process of the supervisor's
 * Pi session. If that session dies or is replaced while the batch is
 * `executing`, the replacement supervisor inherits persisted state that says
 * "executing" — but it has no engine attached, and it cannot tell from the
 * supervisor lock alone whether the ORIGINAL engine is still alive (a dead
 * supervisor pid does not imply a dead engine; a forked child survives its
 * parent on Windows, and a wedged supervisor may leave a healthy engine
 * driving lanes).
 *
 * This module gives a replacement session a verifiable answer:
 *
 *   - `alive`   the recorded engine pid still exists → refuse recovery
 *               mutations (double-drive risk); tell the operator the pid.
 *   - `dead`    the recorded pid no longer exists → confirmed orphan; the
 *               persisted-state eligibility rules (`checkResumeEligibility`)
 *               may proceed.
 *   - `exited`  the engine recorded its own exit (clean or crash) → same as dead.
 *   - `none`    no identity recorded (older batch, or the engine never forked)
 *               → callers fall back to supervisor-lock evidence.
 *
 * Verified shutdown, not inferred inactivity: timestamps in batch-state.json
 * are checkpoint times, not heartbeats, and are refreshed by recovery tools
 * themselves — they are NOT used here.
 *
 * File: `{stateRoot}/.pi/runtime/{batchId}/engine.json` (additive; runtime
 * dir already hosts registry.json). Best-effort I/O: a write failure never
 * blocks batch start.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { isProcessAlive } from "./process-registry.ts";
import { runtimeRoot } from "./types.ts";

export interface EngineIdentity {
	batchId: string;
	/** Engine (forked child) pid */
	pid: number;
	/** Pid of the supervisor session that forked it */
	supervisorPid: number;
	/** Epoch ms when the fork happened */
	startedAt: number;
	/** Epoch ms when the engine exited (set by the parent on child exit) */
	exitedAt?: number;
	/** Exit code when known */
	exitCode?: number | null;
	/** Why the exit was recorded (e.g. "child-exit", "session-end-kill", "abort") */
	exitReason?: string;
	/**
	 * Build marker (Penster feedback on #632): which Taskplane code is actually
	 * driving this batch. `version` is package.json's; `build` is a short
	 * content fingerprint of the loaded extension source (sha256 prefix), so a
	 * local pre-release deploy is distinguishable from the published version
	 * even when the version string has not been bumped.
	 */
	taskplaneVersion?: string;
	taskplaneBuild?: string;
}

/**
 * Compute the build marker for the currently loaded Taskplane: package.json
 * version + a short sha256 of the extension entry sources. Cached. Never throws.
 */
let cachedBuildMarker: { taskplaneVersion: string; taskplaneBuild: string } | null = null;
export function taskplaneBuildMarker(): { taskplaneVersion: string; taskplaneBuild: string } {
	if (cachedBuildMarker) return cachedBuildMarker;
	let version = "unknown";
	let build = "unknown";
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf-8")) as {
			version?: string;
		};
		if (typeof pkg.version === "string") version = pkg.version;
		const h = createHash("sha256");
		for (const file of [
			"extension.ts",
			"lane-runner.ts",
			"engine.ts",
			"resume.ts",
			"engine-identity.ts",
		]) {
			try {
				h.update(readFileSync(join(here, file)));
			} catch {
				/* skip */
			}
		}
		build = h.digest("hex").slice(0, 12);
	} catch {
		/* best effort */
	}
	cachedBuildMarker = { taskplaneVersion: version, taskplaneBuild: build };
	return cachedBuildMarker;
}

/**
 * #631: ownership evidence ASSOCIATED WITH AN ORCH BRANCH, independent of full
 * state reconstruction. Integration acts on a branch; the batch behind it may
 * have no batch-state.json (aborted) and may not be *reconstructable* (worker
 * manifests gone) while its engine identity still records a live pid.
 * Reconstructability is a resumability requirement, not a prerequisite for
 * recognising ownership. Scans `.pi/runtime/<batchId>/batch-meta.json` for
 * `orchBranch === branch` and returns each such batch with its liveness.
 * Unreadable/absent meta is skipped (no association can be established).
 */
export function findBatchesForOrchBranch(
	stateRoot: string,
	orchBranch: string,
	probe: (pid: number) => boolean = isProcessAlive,
): Array<{ batchId: string; liveness: EngineLiveness }> {
	const out: Array<{ batchId: string; liveness: EngineLiveness }> = [];
	const runtimeDir = join(stateRoot, ".pi", "runtime");
	if (!existsSync(runtimeDir)) return out;
	let entries: string[] = [];
	try {
		entries = readdirSync(runtimeDir);
	} catch {
		return out;
	}
	for (const batchId of entries) {
		try {
			const metaPath = join(runtimeDir, batchId, "batch-meta.json");
			if (!existsSync(metaPath)) continue;
			const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
				orchBranch?: unknown;
				batchId?: unknown;
			};
			if (meta.orchBranch !== orchBranch) continue;
			const id = typeof meta.batchId === "string" && meta.batchId ? meta.batchId : batchId;
			out.push({ batchId: id, liveness: assessEngineLiveness(stateRoot, id, probe) });
		} catch {
			/* skip unreadable runtime dir */
		}
	}
	return out;
}

export type EngineLivenessStatus = "alive" | "dead" | "exited" | "none";

export interface EngineLiveness {
	status: EngineLivenessStatus;
	identity: EngineIdentity | null;
}

export function engineIdentityPath(stateRoot: string, batchId: string): string {
	return join(runtimeRoot(stateRoot, batchId), "engine.json");
}

/**
 * Publish a freshly started engine's identity. Returns false when it could not
 * be written — callers treat that as "cannot own this batch verifiably" and
 * refuse to start the engine (the identity is what lets a successor prove
 * shutdown; an engine without one is an unownable orphan-in-waiting).
 * The write goes through a temp file + rename so a reader never sees a
 * partial record.
 */
export function writeEngineIdentity(
	stateRoot: string,
	identity: Omit<EngineIdentity, "exitedAt" | "exitCode" | "exitReason">,
): boolean {
	try {
		const path = engineIdentityPath(stateRoot, identity.batchId);
		mkdirSync(join(path, ".."), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, JSON.stringify({ ...identity, ...taskplaneBuildMarker() }, null, 2), "utf-8");
		renameSync(tmp, path);
		// Read-back: the record on disk must be the one we just published.
		const check = readEngineIdentity(stateRoot, identity.batchId);
		return check !== null && check.pid === identity.pid && check.exitedAt === undefined;
	} catch {
		return false;
	}
}

/**
 * Mark the recorded engine as exited (keeps the file for forensics). Best effort.
 *
 * ATTEMPT-SCOPED: only marks the file when its recorded `pid` matches the
 * exiting engine's pid. A delayed exit callback from an OLD parent must never
 * mark a NEW live engine (which has since overwritten the identity) as exited.
 * Returns true when the mark was applied.
 */
export function markEngineExited(
	stateRoot: string,
	batchId: string,
	info: { pid: number; exitCode?: number | null; exitReason: string; exitedAt?: number },
): boolean {
	try {
		const path = engineIdentityPath(stateRoot, batchId);
		if (!existsSync(path)) return false;
		const current = JSON.parse(readFileSync(path, "utf-8")) as EngineIdentity;
		if (current.pid !== info.pid) return false; // a newer engine owns this file
		current.exitedAt = info.exitedAt ?? Date.now();
		current.exitCode = info.exitCode ?? null;
		current.exitReason = info.exitReason;
		writeFileSync(path, JSON.stringify(current, null, 2), "utf-8");
		return true;
	} catch {
		return false;
	}
}

/** Marker pid for an identity synthesized by operator confirmation (no real engine pid). */
export const OPERATOR_CONFIRMED_PID = 0;

/**
 * The explicit, auditable LEGACY path (#631): for a batch with no engine
 * identity (pre-#631 engine, or an engine that never got far enough to publish
 * one), the runtime cannot verify shutdown and MUST fail closed. The operator
 * verifies out-of-band that no engine process exists for this repo and records
 * that confirmation here; it becomes an `exited` identity so every recovery
 * gate proceeds through the normal verified path. Refuses (returns false) if a
 * REAL identity exists — confirmation cannot override an alive engine.
 */
export function recordOperatorConfirmedShutdown(
	stateRoot: string,
	batchId: string,
	confirmedBy: { supervisorPid: number; note?: string },
): { ok: boolean; reason: string } {
	const existing = readEngineIdentity(stateRoot, batchId);
	if (existing && existing.pid !== OPERATOR_CONFIRMED_PID) {
		return {
			ok: false,
			reason: `an engine identity IS recorded (PID ${existing.pid}${existing.exitedAt ? ", exited" : ""}); confirmation is only for batches with no identity — use the pid-verified path`,
		};
	}
	try {
		const path = engineIdentityPath(stateRoot, batchId);
		mkdirSync(join(path, ".."), { recursive: true });
		const now = Date.now();
		const identity: EngineIdentity = {
			batchId,
			pid: OPERATOR_CONFIRMED_PID,
			supervisorPid: confirmedBy.supervisorPid,
			startedAt: now,
			exitedAt: now,
			exitCode: null,
			exitReason: `operator-confirmed-shutdown${confirmedBy.note ? `: ${confirmedBy.note.slice(0, 200)}` : ""}`,
		};
		writeFileSync(path, JSON.stringify(identity, null, 2), "utf-8");
		return { ok: true, reason: `recorded operator-confirmed shutdown for ${batchId}` };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

export function readEngineIdentity(stateRoot: string, batchId: string): EngineIdentity | null {
	try {
		const path = engineIdentityPath(stateRoot, batchId);
		if (!existsSync(path)) return null;
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<EngineIdentity>;
		if (typeof parsed.pid !== "number" || typeof parsed.batchId !== "string") return null;
		return parsed as EngineIdentity;
	} catch {
		return null;
	}
}

/**
 * Is the recorded engine for this batch still running?
 *
 * `probe` is injectable for tests; defaults to a real pid probe.
 */
export function assessEngineLiveness(
	stateRoot: string,
	batchId: string,
	probe: (pid: number) => boolean = isProcessAlive,
): EngineLiveness {
	const identity = readEngineIdentity(stateRoot, batchId);
	if (!identity) return { status: "none", identity: null };
	if (identity.exitedAt !== undefined) return { status: "exited", identity };
	return { status: probe(identity.pid) ? "alive" : "dead", identity };
}

/**
 * Decide whether a recovery mutation (resume / retry / skip / force-merge /
 * administrative pause) may proceed against a batch whose persisted phase is
 * ACTIVE but which has no engine attached to THIS process.
 *
 * Pure decision function (no I/O) so the policy is unit-testable:
 *
 *   - engine `alive`                       → refuse (double-drive)
 *   - engine `dead` | `exited`             → proceed (verified shutdown)
 *   - engine `none`                        → REFUSE, always. Unknown ownership is
 *                                            not confirmed shutdown (a forked
 *                                            engine outlives a dead supervisor).
 *                                            The message names the explicit,
 *                                            auditable legacy path:
 *                                            orch_confirm_engine_shutdown after
 *                                            out-of-band verification.
 *
 * `force` deliberately does NOT bypass an alive engine — that is the one case
 * where proceeding can corrupt state.
 */
/**
 * THE recovery-ownership rule (#631), as a pure function so every bypass
 * scenario is unit-testable. `extension.ts` wraps it with I/O (engine
 * liveness probe, logging).
 *
 *   1. an engine runs IN THIS PROCESS (forked child not yet terminated, or the
 *      main-thread fallback) → refuse — even when the cached phase already
 *      reads paused/failed/completed (teardown still in flight).
 *   2–4. otherwise defer to `decideInheritedActivePhase` against the ACTUAL
 *      target: alive elsewhere → refuse; none → refuse (confirm path);
 *      dead/exited → proceed.
 */
export function decideRecoveryOwnership(input: {
	operation: string;
	local: { engineAttached: boolean; phase: string; batchId: string; pid: number | null };
	target: { batchId: string; phase: string };
	liveness: EngineLiveness;
	priorSupervisor: { pid: number; alive: boolean } | null;
}): InheritedPhaseDecision {
	const { operation, local, target, liveness, priorSupervisor } = input;
	if (local.engineAttached) {
		const pid = local.pid ?? "?";
		const terminalCache =
			local.phase === "paused" ||
			local.phase === "failed" ||
			local.phase === "stopped" ||
			local.phase === "completed";
		return {
			proceed: false,
			reason: terminalCache
				? `⏳ This session's engine (PID ${pid}) for batch ${local.batchId} is still shutting down — ${operation} would race its teardown. Retry in a moment.`
				: `❌ Cannot ${operation} while batch ${local.batchId} is ${local.phase} in this session (engine PID ${pid}). Pause or wait for the current operation to finish first.`,
		};
	}
	return decideInheritedActivePhase({
		phase: target.phase,
		batchId: target.batchId,
		liveness,
		priorSupervisor,
		operation,
	});
}

export interface InheritedPhaseDecision {
	proceed: boolean;
	/** Operator-facing explanation (refusal reason or proceed rationale) */
	reason: string;
}

export function decideInheritedActivePhase(input: {
	phase: string;
	batchId: string;
	liveness: EngineLiveness;
	priorSupervisor: { pid: number; alive: boolean } | null;
	operation: string;
}): InheritedPhaseDecision {
	const { phase, batchId, liveness, priorSupervisor, operation } = input;
	const id = liveness.identity;
	switch (liveness.status) {
		case "alive":
			return {
				proceed: false,
				reason:
					`❌ Batch ${batchId} is "${phase}" and its engine process (PID ${id!.pid}, forked ` +
					`${new Date(id!.startedAt).toISOString()} by supervisor PID ${id!.supervisorPid}) is still ALIVE ` +
					`in another process. This session has no engine attached and cannot drive or signal it; ` +
					`${operation} now would double-drive the batch.\n` +
					`   Wait for that engine to finish or wind down (it pauses itself when its supervisor ` +
					`disconnects), or terminate it explicitly (Windows: taskkill /PID ${id!.pid} /T; ` +
					`POSIX: kill ${id!.pid}) and re-run ${operation}. force does not bypass this check.`,
			};
		case "dead":
		case "exited":
			return {
				proceed: true,
				reason:
					`engine PID ${id!.pid} is ${liveness.status === "exited" ? `exited (${id!.exitReason ?? "recorded"})` : "dead"} ` +
					`— inherited "${phase}" phase treated as disconnected; persisted-state eligibility applies`,
			};
		case "none": {
			const supervisorNote = priorSupervisor
				? priorSupervisor.alive
					? `The previous supervisor (PID ${priorSupervisor.pid}) is still ALIVE, so its engine may well be driving the batch.`
					: `The previous supervisor (PID ${priorSupervisor.pid}) is dead — but a forked engine can outlive its supervisor, so that alone does not prove the engine is gone.`
				: `No previous-supervisor record is available either.`;
			return {
				proceed: false,
				reason:
					`❌ Batch ${batchId} is "${phase}" but this session has no engine attached and NO engine identity is ` +
					`recorded for it (pre-#631 engine, or it never published one). ${supervisorNote} ` +
					`Refusing ${operation}: unknown ownership is not confirmed shutdown.
` +
					`   Verify out-of-band that no engine process exists for this repo — Windows: ` +
					`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "engine-worker" } ; ` +
					`POSIX: pgrep -af engine-worker — then record it with orch_confirm_engine_shutdown(note) ` +
					`(audited) and re-run ${operation}. No hand-edit of batch-state.json is needed.`,
			};
		}
	}
}
