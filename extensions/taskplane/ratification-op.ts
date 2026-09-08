/**
 * The trusted gate-ratification operation (#627 Stage 2a) — the shared core of
 * the `ratify_gate` supervisor tool and the `/orch-ratify` operator command.
 *
 * Extracted from `extension.ts` so it is behaviourally testable without the
 * full pi extension host: all environment coupling (batch-state load, lane repo
 * resolution, git, audit) is injected via {@link RatifyGateDeps}. Everything
 * else (packet routing, proof canonicalization, working-tree binding,
 * validation, atomic writes) is the same code the tool/command run in
 * production.
 *
 * A ruling releases the held lane; this operation is what makes the APPROVE
 * that closes the capped gate trustworthy. The `actor` is stamped by the CALLER
 * (tool → supervisor, command → operator), never read from a parameter.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveCanonicalTaskPaths, selectPacketPaths } from "./execution.ts";
import type { RulingActor } from "./hold-state.ts";
import {
	collectChangedPaths,
	type GateRatification,
	type RatificationFinding,
	ratificationLinkLine,
	sha256,
	unratifiedWorkingTreePaths,
	validateRatification,
	writeRatification,
} from "./ratification.ts";
import { latestReviewFilesPerGate } from "./review-analysis.ts";
import type { AuditTrailEntry } from "./supervisor.ts";
import type { PersistedBatchState } from "./types.ts";

export interface RatifyGateFindingInput {
	ref: string;
	disposition: "fixed" | "ruled";
	evidence?: string[];
}

export interface RatifyGateParams {
	taskId: string;
	gate: string;
	rulingId: string;
	summary: string;
	findings: RatifyGateFindingInput[];
	proofRevision: string;
	artifactRefs?: string[];
}

type LaneRec = PersistedBatchState["lanes"][number];

export interface RatifyGateDeps {
	loadBatchState: (stateRoot: string) => PersistedBatchState | null;
	/** Resolve the lane's repo root (workspace-aware). */
	resolveLaneRepoRoot: (lane: LaneRec, stateRoot: string) => string;
	/** Whether workspace mode is active (affects canonical path resolution). */
	isWorkspaceMode: boolean;
	runGit: (args: string[], cwd: string) => { ok: boolean; stdout: string; stderr: string };
	/** Append an audit entry (wraps logRecoveryAction). */
	logAudit: (
		stateRoot: string,
		batchId: string,
		entry: Omit<AuditTrailEntry, "ts" | "batchId">,
	) => void;
	/** Injected for deterministic tests. */
	now?: () => number;
	genId?: () => string;
}

/** Read `**Review Counter:**` from STATUS.md, increment, persist, return the new number. */
export function allocateRatificationReviewNumber(statusPath: string): number {
	let counter = 0;
	let content = "";
	try {
		content = readFileSync(statusPath, "utf-8");
		const m = content.match(/\*\*Review Counter:\*\*\s*(\d+)/);
		if (m) counter = Number.parseInt(m[1], 10);
	} catch {
		/* no STATUS.md — start from 0 */
	}
	const next = counter + 1;
	try {
		if (content && /\*\*Review Counter:\*\*\s*\d+/.test(content)) {
			writeFileSync(
				statusPath,
				content.replace(/\*\*Review Counter:\*\*\s*\d+/, `**Review Counter:** ${next}`),
				"utf-8",
			);
		}
	} catch {
		/* best effort — the number is still allocated for the filenames */
	}
	return next;
}

export function buildRatificationApproveMarkdown(
	record: GateRatification,
	summary: string,
	reviewNumber: number,
): string {
	const lines: string[] = [];
	lines.push(`# Ratified closure: ${record.gate} (R${String(reviewNumber).padStart(3, "0")})`);
	lines.push("");
	lines.push("## Verdict: APPROVE");
	lines.push("");
	lines.push(
		`This gate was closed by a **${record.ratifier.role}** ratification after its review reached ` +
			`the revision cap. Authorized by ruling \`${record.rulingId}\`; supersedes ` +
			`\`${record.supersededReview.path}\`.`,
	);
	lines.push("");
	lines.push("### Summary");
	lines.push("");
	lines.push(summary.trim() || "(no summary supplied)");
	lines.push("");
	lines.push("### Findings");
	lines.push("");
	lines.push("| Ref | Disposition | Evidence |");
	lines.push("| --- | --- | --- |");
	for (const f of record.findings) {
		lines.push(`| ${f.ref} | ${f.disposition} | ${f.evidenceRefs.join(", ") || "—"} |`);
	}
	lines.push("");
	// The finalize gate requires this exact link line on a ratified APPROVE.
	lines.push(ratificationLinkLine(record.id));
	lines.push("");
	return lines.join("\n");
}

/**
 * Build, validate and (on success) persist a gate ratification. Returns a
 * human-readable status string (`✅ …` on success, `❌ …` on refusal). On any
 * refusal NOTHING is written.
 */
export function ratifyGate(
	params: RatifyGateParams,
	actor: RulingActor,
	stateRoot: string,
	deps: RatifyGateDeps,
): string {
	const now = deps.now ?? Date.now;
	const genId = deps.genId ?? randomUUID;

	let state: PersistedBatchState | null = null;
	try {
		state = deps.loadBatchState(stateRoot);
	} catch (err) {
		return `❌ Failed to load batch state: ${err instanceof Error ? err.message : String(err)}`;
	}
	if (!state) return "❌ No batch state found. There is no active or recent batch.";

	const task = state.tasks.find((t) => t.taskId === params.taskId);
	if (!task) return `❌ Task ${params.taskId} is not part of batch ${state.batchId}.`;

	// The hold that carries the cited ruling supplies lane + segment + escalation
	// scope. Bind STRICTLY to it (R005/R006 issue): if that lane has no record we
	// fail closed rather than silently falling back to task.laneNumber — a
	// fallback could validate/persist proof from a different worktree while
	// claiming authority from the cited hold.
	const rulingHold = (state.holds ?? []).find((h) => h.ruling?.id === params.rulingId);
	if (!rulingHold) {
		return `❌ No hold carries ruling ${params.rulingId}. A ratification must cite the ruling that released the lane.`;
	}
	const segmentId = rulingHold.segmentId ?? null;

	const laneRec = state.lanes.find((l) => l.laneNumber === rulingHold.laneNumber);
	if (!laneRec) {
		return `❌ Ratification refused: the cited ruling ${params.rulingId} names lane ${rulingHold.laneNumber}, which has no lane record in batch ${state.batchId}. Nothing was written.`;
	}
	if (!task.taskFolder || !laneRec.worktreePath) {
		return `❌ Cannot resolve the worktree/task folder for ${params.taskId} (lane ${rulingHold.laneNumber}).`;
	}

	// Packet resolution MUST match the lane-runner's contract (buildExecutionUnit
	// → selectPacketPaths): a cross-repo segment's packet lives at the absolute
	// `packetTaskPath` in the packet-home repo, NOT under the execution worktree.
	const executionRepoId = laneRec.repoId ?? "default";
	const packetHomeRepoId = task.packetRepoId ?? executionRepoId;
	const resolved = resolveCanonicalTaskPaths(
		task.taskFolder,
		laneRec.worktreePath,
		deps.resolveLaneRepoRoot(laneRec, stateRoot),
		deps.isWorkspaceMode,
	);
	const packet = selectPacketPaths(task.packetTaskPath, packetHomeRepoId, executionRepoId, resolved);
	const reviewsDir = packet.reviewsDir;
	// R006 issue 1: allocate the R number from the packet-home STATUS.md (the same
	// file the APPROVE/JSON are written beside), NOT the worktree copy — otherwise
	// a cross-repo segment leaves the authoritative counter unchanged and a later
	// ordinary review reuses the number.
	const statusPathForCounter = packet.statusPath;
	if (!existsSync(reviewsDir)) {
		return `❌ No reviews directory for ${params.taskId} at ${reviewsDir}.`;
	}

	// Superseded review = the current latest review file for this gate.
	const supersededName = latestReviewFilesPerGate(readdirSync(reviewsDir)).get(params.gate);
	if (!supersededName) {
		return `❌ No review file for gate ${params.gate} to supersede — ratify_gate closes a gate that already has a review at its revision cap.`;
	}
	let supersededContent: string;
	try {
		supersededContent = readFileSync(join(reviewsDir, supersededName), "utf-8");
	} catch (err) {
		return `❌ Cannot read superseded review ${supersededName}: ${err instanceof Error ? err.message : String(err)}`;
	}

	// Canonicalize the proof to an immutable oid and require it to BE the current
	// worktree HEAD (R004 issue 1). A symbolic ref or an older SHA must never be
	// stored verbatim.
	const headOidRes = deps.runGit(["rev-parse", "--verify", "HEAD^{commit}"], laneRec.worktreePath);
	if (!headOidRes.ok) {
		return `❌ Ratification refused: worktree HEAD could not be resolved (${headOidRes.stderr}). Nothing was written.`;
	}
	const headOid = headOidRes.stdout.trim();
	const proofOidRes = deps.runGit(
		["rev-parse", "--verify", `${params.proofRevision}^{commit}`],
		laneRec.worktreePath,
	);
	if (!proofOidRes.ok) {
		return `❌ Ratification refused: proofRevision "${params.proofRevision}" does not resolve to a commit (${proofOidRes.stderr}). Nothing was written.`;
	}
	const proofOid = proofOidRes.stdout.trim();
	if (proofOid !== headOid) {
		return (
			`❌ Ratification refused: proofRevision ${proofOid.slice(0, 12)} is not the current worktree HEAD ` +
			`${headOid.slice(0, 12)}. Ratify at the exact HEAD that contains the fold (re-verify the fold). Nothing was written.`
		);
	}

	// The working tree must be clean of source changes (R004 issue 2); a failed
	// git probe is fail-closed (R005 issue 2).
	const taskFolderRel = relative(laneRec.worktreePath, resolved.taskFolderResolved);
	const probe = collectChangedPaths(laneRec.worktreePath, deps.runGit);
	if (probe.failedProbe) {
		return `❌ Ratification refused: working-tree probe failed (${probe.failedProbe}: ${probe.detail || "no detail"}). Nothing was written.`;
	}
	const dirty = unratifiedWorkingTreePaths(probe.paths, [taskFolderRel, ".pi"]);
	if (dirty.length > 0) {
		return (
			`❌ Ratification refused: uncommitted source changes are not covered by the proof commit: ` +
			`${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? " …" : ""}. Commit or revert them, then ratify. Nothing was written.`
		);
	}

	const findings: RatificationFinding[] = (
		params.findings.length > 0
			? params.findings
			: [{ ref: "ratified", disposition: "ruled" as const, evidence: [params.rulingId] }]
	).map((f) => ({ ref: f.ref, disposition: f.disposition, evidenceRefs: f.evidence ?? [] }));

	const record: GateRatification = {
		// R003 issue 3: a UNIQUE id per issuance so a stale-then-reratify recovery
		// is possible (each APPROVE links a distinct id).
		id: `ratif-${params.taskId}-${params.gate}-${genId()}`,
		taskId: params.taskId,
		segmentId,
		gate: params.gate,
		rulingId: params.rulingId,
		ratifier: actor,
		closedEscalationIds: [rulingHold.escalationId],
		supersededReview: { path: supersededName, sha256: sha256(supersededContent) },
		findings,
		proofSet: [
			// Store the canonical oid, never the caller's (possibly symbolic) ref.
			{ kind: "revision", ref: proofOid },
			...(params.artifactRefs ?? []).map((ref) => ({ kind: "artifact" as const, ref })),
		],
		createdAt: now(),
	};

	const validation = validateRatification(record, {
		holds: state.holds ?? [],
		reviewsDir,
		taskId: params.taskId,
		segmentId,
		gate: params.gate,
		headRevision: headOid,
		requireProofHeadMatch: true,
		readFile: (p: string) => readFileSync(p, "utf-8"),
		isAncestor: (a: string, b: string) =>
			deps.runGit(["merge-base", "--is-ancestor", a, b], laneRec.worktreePath).ok,
	});
	if (validation.ok === false) {
		return `❌ Ratification refused (${validation.code}): ${validation.reason}. Nothing was written.`;
	}

	// Only after validation passes do we consume a review number (from the
	// packet-home STATUS.md) and write.
	const num = allocateRatificationReviewNumber(statusPathForCounter);
	const pad = String(num).padStart(3, "0");
	const approveName = `R${pad}-${params.gate}.md`;
	// Fail closed on a filename collision rather than overwrite an existing pair.
	if (
		existsSync(join(reviewsDir, approveName)) ||
		existsSync(join(reviewsDir, `R${pad}-${params.gate}.ratification.json`))
	) {
		return `❌ Ratification refused: review number R${pad} for ${params.gate} already exists — resolve the review-counter drift before ratifying.`;
	}
	try {
		writeFileSync(
			join(reviewsDir, approveName),
			buildRatificationApproveMarkdown(record, params.summary, num),
			"utf-8",
		);
	} catch (err) {
		return `❌ Ratification validated but the APPROVE review could not be written: ${err instanceof Error ? err.message : String(err)}`;
	}
	let jsonPath: string;
	try {
		jsonPath = writeRatification(reviewsDir, record, num);
	} catch (err) {
		return `❌ Ratification APPROVE written but the record could not be persisted: ${err instanceof Error ? err.message : String(err)}`;
	}

	deps.logAudit(stateRoot, state.batchId, {
		action: "gate_ratified",
		classification: "destructive",
		context: `ratify ${params.gate} for ${params.taskId} on ruling ${params.rulingId} (${actor.role})`,
		command: `ratify_gate ${params.taskId} ${params.gate} ${params.rulingId}`,
		result: "success",
		detail: `ratification ${record.id}; APPROVE ${approveName}; ruling ${params.rulingId}; superseded ${supersededName}`,
		taskId: params.taskId,
		// R006 issue 2: attribute to the cited ruling's lane, not task.laneNumber.
		laneNumber: rulingHold.laneNumber,
	});

	return (
		`✅ Ratified **${params.gate}** for ${params.taskId} (${actor.role})\n` +
		`- **Ratification:** ${record.id}\n` +
		`- **Ruling:** ${params.rulingId}\n` +
		`- **APPROVE review:** ${approveName}\n` +
		`- **Record:** ${jsonPath}\n` +
		`- **Supersedes:** ${supersededName}\n` +
		`The finalize gate will now accept the worker's \`.DONE\` for this gate. The worker must NOT write the APPROVE file itself.`
	);
}
