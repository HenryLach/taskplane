/**
 * Gate ratification records (#627 Stage 2a).
 *
 * A ruling releases a held lane; a *ratification* is what makes the review-gate
 * closure that follows trustworthy. When a review gate hits its revision cap the
 * supervisor rules on in-authority findings, escalates operator-reserved
 * decisions, verifies the worker's fold, and then must close the gate. Before
 * this module the runtime only saw "the latest review file says APPROVE" — it
 * could not tell a ratified closure from a forged one, tie it to the ruling that
 * authorized it, or notice that the code changed after the fact.
 *
 * A `GateRatification` is a structured, validated artifact written by a trusted
 * operation (the `ratify_gate` supervisor tool or the `/orch-ratify` operator
 * command), linked from the APPROVE review file it authorizes, and REQUIRED by
 * the finalize gate whenever an APPROVE file claims ratification.
 *
 * Everything here is pure/synchronous except the small fs helpers at the bottom
 * (`writeRatification`, `readRatifications`). Holds, rulings and unit-binding are
 * imported from `hold-state.ts` — never re-implemented here.
 *
 * Design: docs/specifications/taskplane/held-state-spec.md §"Finalize".
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { holdsForTask, holdsForUnit, type HoldRecord, type RulingActor } from "./hold-state.ts";
import { parseReviewVerdict } from "./review-analysis.ts";

// ── Types ─────────────────────────────────────────────────────────────

export type FindingDisposition = "fixed" | "ruled";
export type ProofKind = "revision" | "artifact";

export interface RatificationFinding {
	/** Review finding reference (e.g. an "Issues Found" item number/label). */
	ref: string;
	/** How it was resolved: `fixed` by the worker, or `ruled` by the supervisor. */
	disposition: FindingDisposition;
	/** Evidence for the disposition (commit shas, artifact paths, ruling ids). */
	evidenceRefs: string[];
}

export interface RatificationProof {
	kind: ProofKind;
	ref: string;
	sha256?: string;
}

export interface SupersededReviewRef {
	/** Review filename RELATIVE to the reviews dir (portable, not worktree-absolute). */
	path: string;
	/** sha256 of the superseded review file's content at ratification time. */
	sha256: string;
}

/**
 * The authority artifact. Written by a trusted operation, linked from the
 * APPROVE review file it authorizes, and validated by the finalize gate.
 */
export interface GateRatification {
	/** Unique id (stamped by the issuing operation). */
	id: string;
	taskId: string;
	/** Segment identity for segment-aware units; null for whole-task units. */
	segmentId: string | null;
	/** Gate key `{type}-step{N}` (e.g. `code-step3`). */
	gate: string;
	/** The ruling (`HoldRuling.id`) that authorized this closure. */
	rulingId: string;
	/** Who issued the ratification. Stamped by the issuing path, never a parameter. */
	ratifier: RulingActor;
	/** Escalations this closure resolves (each must have a hold for the task). */
	closedEscalationIds: string[];
	/** The review file this ratification replaces, pinned by content hash. */
	supersededReview: SupersededReviewRef;
	/** Non-empty disposition of every review finding. */
	findings: RatificationFinding[];
	/** Proof the fold is real; MUST include at least one `revision` proof. */
	proofSet: RatificationProof[];
	createdAt: number;
}

// ── Filename + link-line helpers ──────────────────────────────────────

/** `code-step3`, 4 → `R004-code-step3.ratification.json`. */
export function ratificationFilename(gate: string, reviewNumber: number): string {
	return `R${String(reviewNumber).padStart(3, "0")}-${gate}.ratification.json`;
}

/** The exact line the authorizing APPROVE review file must contain. */
export function ratificationLinkLine(id: string): string {
	return `Ratification: ${id}`;
}

const RATIFICATION_LINK_RE = /^\s*(?:[-*]\s*)?(?:\*{1,2}\s*)?Ratification\s*:?\s*\*{0,2}\s*(\S+)/im;

/** Extract the ratification id from an APPROVE review markdown, or null. */
export function parseRatificationLink(reviewMarkdown: string | null | undefined): string | null {
	if (!reviewMarkdown || typeof reviewMarkdown !== "string") return null;
	const m = reviewMarkdown.match(RATIFICATION_LINK_RE);
	if (!m) return null;
	// Strip trailing markdown bold if present (e.g. `**id**`).
	return m[1].replace(/\*+$/, "").trim() || null;
}

// ── Hashing ───────────────────────────────────────────────────────────

export function sha256(content: string): string {
	return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ── Structural decoding ───────────────────────────────────────────────

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Structural guard: valid JSON with the wrong shape must NEVER be cast to a
 * `GateRatification` and crash unpredictably in validation or the finalize
 * path. `ratifier.role` is checked only for `typeof string` here so that a
 * recognised-but-wrong role surfaces as the explicit `invalid-ratifier-role`
 * validation code rather than a structural rejection.
 */
export function isValidGateRatification(obj: unknown): obj is GateRatification {
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
	const r = obj as Record<string, unknown>;
	if (typeof r.id !== "string" || !r.id) return false;
	if (typeof r.taskId !== "string" || !r.taskId) return false;
	if (r.segmentId !== null && typeof r.segmentId !== "string") return false;
	if (typeof r.gate !== "string" || !r.gate) return false;
	if (typeof r.rulingId !== "string" || !r.rulingId) return false;
	const actor = r.ratifier as Record<string, unknown> | undefined;
	if (!actor || typeof actor !== "object" || Array.isArray(actor)) return false;
	if (typeof actor.id !== "string" || !actor.id) return false;
	if (typeof actor.role !== "string") return false;
	if (!isStringArray(r.closedEscalationIds)) return false;
	const sr = r.supersededReview as Record<string, unknown> | undefined;
	if (!sr || typeof sr !== "object" || Array.isArray(sr)) return false;
	if (typeof sr.path !== "string" || !sr.path) return false;
	if (typeof sr.sha256 !== "string" || !sr.sha256) return false;
	if (!Array.isArray(r.findings)) return false;
	for (const f of r.findings) {
		if (!f || typeof f !== "object" || Array.isArray(f)) return false;
		const ff = f as Record<string, unknown>;
		if (typeof ff.ref !== "string" || !ff.ref) return false;
		if (ff.disposition !== "fixed" && ff.disposition !== "ruled") return false;
		if (!isStringArray(ff.evidenceRefs)) return false;
	}
	if (!Array.isArray(r.proofSet)) return false;
	for (const p of r.proofSet) {
		if (!p || typeof p !== "object" || Array.isArray(p)) return false;
		const pp = p as Record<string, unknown>;
		if (pp.kind !== "revision" && pp.kind !== "artifact") return false;
		if (typeof pp.ref !== "string" || !pp.ref) return false;
		// R007: a `revision` proof MUST be an immutable 40-hex object id. A symbolic
		// ref (e.g. `HEAD`) hand-edited into a record would track a moved HEAD; it
		// is refused at read so it can never reach the finalize validator.
		if (pp.kind === "revision" && !/^[0-9a-f]{40}$/i.test(pp.ref)) return false;
		if (pp.sha256 !== undefined && typeof pp.sha256 !== "string") return false;
	}
	if (typeof r.createdAt !== "number") return false;
	return true;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Validation ────────────────────────────────────────────────────────

export interface RatificationValidationCtx {
	holds: readonly HoldRecord[];
	reviewsDir: string;
	taskId: string;
	segmentId: string | null;
	/**
	 * Expected gate. When given, `record.gate` MUST equal it — so a ratification
	 * for one gate can never authorize the APPROVE of another (R003 issue 1).
	 */
	gate?: string;
	/** Worktree HEAD; when given, every revision proof must be ancestor-or-equal. */
	headRevision: string | null;
	/**
	 * Finalize binding (R003 issue 2): when true, a revision proof must be EXACTLY
	 * the current HEAD (not merely an ancestor), and an unresolvable HEAD rejects.
	 * This closes the fail-open path where code changes after ratification yet
	 * `.DONE` is still accepted. Issuance leaves it false (ancestor-or-equal).
	 */
	requireProofHeadMatch?: boolean;
	/** Reads a file's content (absolute path). Injected so tests need no fs. */
	readFile: (absPath: string) => string;
	/** `git merge-base --is-ancestor a b` semantics. Injected so tests need no git. */
	isAncestor: (a: string, b: string) => boolean;
}

export type RatificationValidationCode =
	| "malformed-record"
	| "wrong-task"
	| "wrong-segment"
	| "wrong-gate"
	| "unknown-ruling"
	| "ruling-not-released"
	| "unknown-escalation"
	| "invalid-ratifier-role"
	| "superseded-review-out-of-scope"
	| "superseded-review-mismatch"
	| "empty-findings"
	| "no-revision-proof"
	| "revision-not-ancestor"
	| "proof-not-head"
	| "head-unresolved";

export type RatificationValidation =
	| { ok: true }
	| { ok: false; code: RatificationValidationCode; reason: string };

/**
 * Validate reference, scope, authority and proof binding of a ratification
 * against the current holds and reviews directory. Fail-closed: any check that
 * cannot be positively satisfied rejects.
 */
export function validateRatification(
	record: unknown,
	ctx: RatificationValidationCtx,
): RatificationValidation {
	if (!isValidGateRatification(record)) {
		return {
			ok: false,
			code: "malformed-record",
			reason: "ratification record is structurally invalid",
		};
	}
	const rec = record;

	// ── Scope binding ──
	if (rec.taskId !== ctx.taskId) {
		return {
			ok: false,
			code: "wrong-task",
			reason: `ratification is for task ${rec.taskId}, not ${ctx.taskId}`,
		};
	}
	if ((rec.segmentId ?? null) !== (ctx.segmentId ?? null)) {
		return {
			ok: false,
			code: "wrong-segment",
			reason: `ratification segment ${rec.segmentId ?? "<none>"} does not match unit segment ${ctx.segmentId ?? "<none>"}`,
		};
	}
	if (ctx.gate !== undefined && rec.gate !== ctx.gate) {
		return {
			ok: false,
			code: "wrong-gate",
			reason: `ratification is for gate ${rec.gate}, but it is being used to authorize gate ${ctx.gate}`,
		};
	}

	// ── Authority: ratifier role ──
	if (rec.ratifier.role !== "supervisor" && rec.ratifier.role !== "operator") {
		return {
			ok: false,
			code: "invalid-ratifier-role",
			reason: `ratifier role "${String(rec.ratifier.role)}" is not supervisor|operator`,
		};
	}

	// ── Reference: ruling must exist on a released hold that binds this unit ──
	const unitHolds = holdsForUnit(ctx.holds, ctx.taskId, ctx.segmentId);
	const rulingHold = unitHolds.find((h) => h.ruling?.id === rec.rulingId);
	if (!rulingHold) {
		return {
			ok: false,
			code: "unknown-ruling",
			reason: `no hold of this unit carries ruling ${rec.rulingId}`,
		};
	}
	if (rulingHold.phase !== "released") {
		return {
			ok: false,
			code: "ruling-not-released",
			reason: `hold ${rulingHold.escalationId} for ruling ${rec.rulingId} is ${rulingHold.phase}, not released`,
		};
	}

	// ── Reference: closed escalations must have a hold for this task ──
	const taskEscalationIds = new Set(holdsForTask(ctx.holds, ctx.taskId).map((h) => h.escalationId));
	for (const eid of rec.closedEscalationIds) {
		if (!taskEscalationIds.has(eid)) {
			return {
				ok: false,
				code: "unknown-escalation",
				reason: `closed escalation ${eid} has no hold for task ${ctx.taskId}`,
			};
		}
	}

	// ── Proof: superseded review is in scope and content-pinned ──
	const srPath = rec.supersededReview.path;
	const base = basename(srPath);
	if (isAbsolute(srPath) || srPath.includes("..") || base !== srPath) {
		return {
			ok: false,
			code: "superseded-review-out-of-scope",
			reason: `superseded review path "${srPath}" must be a plain filename under the reviews dir`,
		};
	}
	if (!new RegExp(`^R\\d+-${escapeRegExp(rec.gate)}\\.md$`, "i").test(base)) {
		return {
			ok: false,
			code: "superseded-review-out-of-scope",
			reason: `superseded review "${base}" is not a review file for gate ${rec.gate}`,
		};
	}
	let content: string;
	try {
		content = ctx.readFile(join(ctx.reviewsDir, srPath));
	} catch (err) {
		return {
			ok: false,
			code: "superseded-review-mismatch",
			reason: `superseded review "${srPath}" is unreadable: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
	if (sha256(content) !== rec.supersededReview.sha256) {
		return {
			ok: false,
			code: "superseded-review-mismatch",
			reason: `superseded review "${srPath}" content no longer matches the ratified sha256`,
		};
	}

	// ── Proof: findings and revision proof ──
	if (rec.findings.length === 0) {
		return { ok: false, code: "empty-findings", reason: "ratification has no findings" };
	}
	const revisionProofs = rec.proofSet.filter((p) => p.kind === "revision");
	if (revisionProofs.length === 0) {
		return { ok: false, code: "no-revision-proof", reason: "proofSet has no revision proof" };
	}
	if (ctx.requireProofHeadMatch) {
		// R003/R004/R007 issue: the ratified code state must still BE the current
		// HEAD, or the code changed after the supervisor verified/ratified it. An
		// unresolvable HEAD is fail-closed, never skipped.
		if (!ctx.headRevision) {
			return {
				ok: false,
				code: "head-unresolved",
				reason: "worktree HEAD could not be resolved; a ratification cannot be trusted without it",
			};
		}
		const head = ctx.headRevision;
		// R007: compare the persisted proof to the already-canonical HEAD by exact
		// object-id equality — do NOT re-resolve the ref through git. A symbolic ref
		// (e.g. `HEAD`) or an abbreviated/branch ref stored in the record would
		// otherwise track a MOVED HEAD (both ancestor probes succeed) and authorize
		// changed code. The proof must itself be an immutable 40-hex object id.
		const CANONICAL_OID = /^[0-9a-f]{40}$/i;
		const matchesHead = revisionProofs.some((p) => CANONICAL_OID.test(p.ref) && p.ref === head);
		if (!matchesHead) {
			return {
				ok: false,
				code: "proof-not-head",
				reason: `code changed since ratification (or proof is not an immutable object id): no revision proof equals HEAD ${head}`,
			};
		}
	} else if (ctx.headRevision) {
		for (const p of revisionProofs) {
			if (!ctx.isAncestor(p.ref, ctx.headRevision)) {
				return {
					ok: false,
					code: "revision-not-ancestor",
					reason: `revision proof ${p.ref} is not an ancestor-or-equal of HEAD ${ctx.headRevision}`,
				};
			}
		}
	}

	return { ok: true };
}

// ── Staleness ─────────────────────────────────────────────────────────

export interface RatificationStalenessCtx {
	/** All filenames in the reviews dir. */
	reviewFilenames: string[];
	/** Reads a review file's content by filename. */
	readReview: (filename: string) => string;
}

/**
 * A ratification is stale when its authorizing APPROVE review file is no longer
 * the latest for its gate — a later REVISE/RETHINK (or any higher-numbered
 * review) means the code moved after the closure. Fail-closed: a missing,
 * ambiguous, wrong-gate or non-APPROVE link is treated as stale.
 */
export function isRatificationStale(
	record: GateRatification,
	ctx: RatificationStalenessCtx,
): boolean {
	const gateRe = new RegExp(`^R(\\d+)-${escapeRegExp(record.gate)}\\.md$`, "i");
	const gateFiles: Array<{ num: number; name: string }> = [];
	for (const name of ctx.reviewFilenames) {
		const m = name.match(gateRe);
		if (m) gateFiles.push({ num: Number.parseInt(m[1], 10), name });
	}
	// Locate the APPROVE review file that links this record id.
	let approve: { num: number; name: string } | null = null;
	for (const f of gateFiles) {
		let content: string;
		try {
			content = ctx.readReview(f.name);
		} catch {
			continue;
		}
		if (parseRatificationLink(content) === record.id && parseReviewVerdict(content) === "APPROVE") {
			if (approve) return true; // ambiguous → fail-closed
			approve = f;
		}
	}
	if (!approve) return true; // no APPROVE link for this record → fail-closed
	return gateFiles.some((f) => f.num > (approve as { num: number }).num);
}

// ── Working-tree binding ──────────────────────────────────────────────

/**
 * Given a list of changed working-tree paths (tracked changes vs HEAD plus
 * untracked files — NOT porcelain status lines, to avoid the leading-space
 * corruption that output-trimming introduces) and the set of runtime-owned
 * path prefixes (the task folder, `.pi/`, …), return the paths that are NOT
 * runtime artifacts — i.e. source changes that a ratification's proof commit
 * does NOT represent (R004 issue 2). A non-empty result means the working tree
 * drifted from the ratified code state and finalization/issuance must refuse.
 */
/**
 * The ONLY working-tree paths a ratification's proof commit is allowed to not
 * cover: the task packet's runtime-written artifacts — `STATUS.md`, `.DONE`,
 * and the `.reviews/` directory (which holds the APPROVE + ratification JSON
 * the operation itself writes). Everything else in the lane worktree — source,
 * AND tracked shared config under `.pi/` (`taskplane-config.json`,
 * `agents/*.md`, …), which is source-controlled per the settings spec — must be
 * represented by the proof commit (R008). The task folder is NOT exempted
 * wholesale: `PROMPT.md` (the immutable task definition) is deliberately not
 * listed, so a mid-run edit to it is still flagged.
 */
export function runtimeArtifactPrefixes(taskFolderRel: string): string[] {
	const base = taskFolderRel.replace(/\\/g, "/").replace(/\/+$/, "");
	return [`${base}/STATUS.md`, `${base}/.DONE`, `${base}/.reviews`];
}

export function unratifiedWorkingTreePaths(
	changedPaths: readonly string[],
	allowedPrefixes: string[],
): string[] {
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/^"|"$/g, "").replace(/\/+$/, "").trim();
	const allowed = allowedPrefixes.map(norm).filter((p) => p.length > 0);
	const out = new Set<string>();
	for (const raw of changedPaths) {
		const path = norm(raw);
		if (!path) continue;
		if (allowed.some((a) => path === a || path.startsWith(`${a}/`))) continue;
		out.add(path);
	}
	return [...out];
}

/**
 * Result of a working-tree probe. `failedProbe` is non-null when a git read
 * failed (fail-closed — callers refuse); otherwise `paths` lists the changed
 * paths. Non-discriminated on purpose so callers use a simple null check.
 */
export interface WorkingTreeProbe {
	paths: string[];
	/** The git command that failed, or null when both probes succeeded. */
	failedProbe: string | null;
	detail: string;
}

/**
 * Collect changed working-tree paths in a worktree: tracked changes vs HEAD
 * (`git diff --name-only HEAD`) plus untracked-but-not-ignored files
 * (`git ls-files --others --exclude-standard`). Both emit plain, forward-slash
 * paths with no status columns, so trimming the command output is safe.
 *
 * FAIL-CLOSED (R005 issue 2): if EITHER probe fails, this returns `ok:false`
 * naming the failed probe — an authority-critical git read error must never be
 * silently treated as "clean". Callers refuse ratification/finalization.
 */
export function collectChangedPaths(
	worktree: string,
	runGit: (args: string[], cwd: string) => { ok: boolean; stdout: string; stderr?: string },
): WorkingTreeProbe {
	const diff = runGit(["diff", "--name-only", "HEAD"], worktree);
	if (!diff.ok) {
		return { paths: [], failedProbe: "git diff --name-only HEAD", detail: diff.stderr ?? "" };
	}
	const untracked = runGit(["ls-files", "--others", "--exclude-standard"], worktree);
	if (!untracked.ok) {
		return {
			paths: [],
			failedProbe: "git ls-files --others --exclude-standard",
			detail: untracked.stderr ?? "",
		};
	}
	return {
		paths: [...diff.stdout.split("\n"), ...untracked.stdout.split("\n")].filter(
			(l) => l.trim().length > 0,
		),
		failedProbe: null,
		detail: "",
	};
}

// ── Persistence ───────────────────────────────────────────────────────

/**
 * Atomically write a ratification record. `reviewNumber` is the single, global
 * review-counter allocation shared with the authorizing APPROVE markdown
 * (`R{NNN}-{gate}.md`) so the two files always share the same R number. Returns
 * the absolute path written.
 */
export function writeRatification(
	reviewsDir: string,
	record: GateRatification,
	reviewNumber: number,
): string {
	const finalPath = join(reviewsDir, ratificationFilename(record.gate, reviewNumber));
	const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
	renameSync(tmpPath, finalPath);
	return finalPath;
}

/**
 * Read every `*.ratification.json` in the reviews dir. A malformed file (invalid
 * JSON OR structurally invalid shape) THROWS — an authority record is never
 * silently skipped.
 */
export function readRatifications(reviewsDir: string): GateRatification[] {
	if (!existsSync(reviewsDir)) return [];
	const out: GateRatification[] = [];
	const seen = new Set<string>();
	for (const name of readdirSync(reviewsDir).sort()) {
		if (!name.endsWith(".ratification.json")) continue;
		const full = join(reviewsDir, name);
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(full, "utf-8"));
		} catch (err) {
			throw new Error(
				`malformed ratification file ${name}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		if (!isValidGateRatification(parsed)) {
			throw new Error(`structurally invalid ratification file ${name}`);
		}
		// R003 issue 3: duplicate ids are fail-closed — a forged/duplicated record
		// must never let the runtime silently pick one and accept it.
		if (seen.has(parsed.id)) {
			throw new Error(`duplicate ratification id ${parsed.id} across records`);
		}
		seen.add(parsed.id);
		out.push(parsed);
	}
	return out;
}
