/**
 * Gate ratification — pure module (#627 Stage 2a).
 *
 * Covers: filename + link-line round-trip; every `validateRatification`
 * rejection code with one positive case; scope binding (wrong task / segment /
 * unit-scoped ruling); superseded-review scope + content pinning; staleness
 * true/false and fail-closed link resolution; write/read round-trip; malformed
 * file (invalid JSON AND structurally-invalid JSON) throws.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	collectChangedPaths,
	type GateRatification,
	type RatificationValidationCtx,
	isRatificationStale,
	isValidGateRatification,
	parseRatificationLink,
	ratificationFilename,
	ratificationLinkLine,
	readRatifications,
	sha256,
	runtimeArtifactPrefixes,
	unratifiedWorkingTreePaths,
	validateRatification,
	writeRatification,
} from "../taskplane/ratification.ts";
import { applyRuling, createHoldRecord, type HoldRecord } from "../taskplane/hold-state.ts";
import { selectPacketPaths } from "../taskplane/execution.ts";

// ── Fixtures ──────────────────────────────────────────────────────────

const GATE = "code-step3";
const SUPERSEDED_NAME = "R007-code-step3.md";
const SUPERSEDED_CONTENT = "## Verdict: REVISE\n\nfix things\n";
const SUPERSEDED_SHA = sha256(SUPERSEDED_CONTENT);
/** Canonical 40-hex object ids (revision proofs must be immutable oids). */
const PROOF_OID = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const HEAD_OID = "0123456789abcdef0123456789abcdef01234567";

/** A released hold whose ruling id is `ruling-1`, escalation `esc-1`. */
function releasedHold(overrides: Partial<HoldRecord> = {}): HoldRecord {
	const base = createHoldRecord({
		escalation: { id: "esc-1", content: "cap hit on code-step3", timestamp: 1_000 },
		batchId: "batch-1",
		taskId: "TP-198",
		segmentId: null,
		executionId: "exec-1",
		agentId: "lane-1-worker",
		laneNumber: 1,
		holdTimeoutMinutes: 240,
		now: 1_000,
	});
	const released = applyRuling(
		base,
		{
			id: "ruling-1",
			replyTo: "esc-1",
			content: "rule: findings 1-2 fixed, finding 3 ruled out of authority",
			actor: { role: "supervisor", id: "supervisor" },
		},
		2_000,
	);
	return { ...released, ...overrides };
}

function goodRecord(overrides: Partial<GateRatification> = {}): GateRatification {
	return {
		id: "ratif-1",
		taskId: "TP-198",
		segmentId: null,
		gate: GATE,
		rulingId: "ruling-1",
		ratifier: { role: "supervisor", id: "supervisor" },
		closedEscalationIds: ["esc-1"],
		supersededReview: { path: SUPERSEDED_NAME, sha256: SUPERSEDED_SHA },
		findings: [{ ref: "1", disposition: "fixed", evidenceRefs: ["abc123"] }],
		proofSet: [{ kind: "revision", ref: PROOF_OID }],
		createdAt: 3_000,
		...overrides,
	};
}

function ctx(overrides: Partial<RatificationValidationCtx> = {}): RatificationValidationCtx {
	return {
		holds: [releasedHold()],
		reviewsDir: "/reviews",
		taskId: "TP-198",
		segmentId: null,
		headRevision: "HEADSHA",
		readFile: (p: string) => {
			if (p.endsWith(SUPERSEDED_NAME)) return SUPERSEDED_CONTENT;
			throw new Error(`unexpected read ${p}`);
		},
		isAncestor: () => true,
		...overrides,
	};
}

// ── Filename / link round-trip ────────────────────────────────────────

describe("ratification filename + link helpers", () => {
	it("ratificationFilename zero-pads the review number", () => {
		assert.equal(ratificationFilename("code-step3", 4), "R004-code-step3.ratification.json");
		assert.equal(ratificationFilename("plan-step1", 12), "R012-plan-step1.ratification.json");
	});

	it("link line round-trips through the parser", () => {
		const line = ratificationLinkLine("ratif-xyz");
		assert.equal(line, "Ratification: ratif-xyz");
		const md = `## Verdict: APPROVE\n\nsummary\n\n${line}\n`;
		assert.equal(parseRatificationLink(md), "ratif-xyz");
	});

	it("parseRatificationLink tolerates markdown bold and returns null when absent", () => {
		assert.equal(parseRatificationLink("**Ratification:** ratif-9\n"), "ratif-9");
		assert.equal(parseRatificationLink("## Verdict: APPROVE\nno link here\n"), null);
		assert.equal(parseRatificationLink(""), null);
		assert.equal(parseRatificationLink(null), null);
	});
});

// ── validateRatification: positive + every rejection code ─────────────

describe("validateRatification", () => {
	it("accepts a well-formed, in-scope record (positive case)", () => {
		assert.deepEqual(validateRatification(goodRecord(), ctx()), { ok: true });
	});

	it("malformed-record: structurally invalid shape", () => {
		const r = validateRatification({ id: "x" }, ctx());
		assert.equal(r.ok, false);
		assert.equal(r.ok === false && r.code, "malformed-record");
	});

	it("wrong-task", () => {
		const r = validateRatification(goodRecord({ taskId: "TP-999" }), ctx());
		assert.equal(r.ok === false && r.code, "wrong-task");
	});

	it("wrong-segment", () => {
		const r = validateRatification(goodRecord({ segmentId: "seg-A" }), ctx());
		assert.equal(r.ok === false && r.code, "wrong-segment");
	});

	it("invalid-ratifier-role", () => {
		const r = validateRatification(
			goodRecord({ ratifier: { role: "worker" as never, id: "w" } }),
			ctx(),
		);
		assert.equal(r.ok === false && r.code, "invalid-ratifier-role");
	});

	it("unknown-ruling: no hold carries the ruling id", () => {
		const r = validateRatification(goodRecord({ rulingId: "ruling-nope" }), ctx());
		assert.equal(r.ok === false && r.code, "unknown-ruling");
	});

	it("unknown-ruling: a released ruling from ANOTHER task is excluded (scope binding)", () => {
		const foreign = releasedHold({ taskId: "OTHER-1", escalationId: "esc-x" });
		const r = validateRatification(goodRecord(), ctx({ holds: [foreign] }));
		assert.equal(r.ok === false && r.code, "unknown-ruling");
	});

	it("ruling-not-released: the hold is still open", () => {
		const open = createHoldRecord({
			escalation: { id: "esc-1", content: "x", timestamp: 1 },
			batchId: "b",
			taskId: "TP-198",
			segmentId: null,
			executionId: "e",
			agentId: "a",
			laneNumber: 1,
			holdTimeoutMinutes: 240,
			now: 1,
		});
		// Give it a ruling id by faking a partial released record without phase change is not possible;
		// instead assert an open hold with matching escalation cannot match ruling-1.
		const r = validateRatification(goodRecord(), ctx({ holds: [open] }));
		assert.equal(r.ok === false && r.code, "unknown-ruling");
	});

	it("ruling-not-released: released ruling reverted to a non-released phase is rejected", () => {
		const hold = releasedHold();
		const cancelled: HoldRecord = { ...hold, phase: "cancelled" };
		const r = validateRatification(goodRecord(), ctx({ holds: [cancelled] }));
		assert.equal(r.ok === false && r.code, "ruling-not-released");
	});

	it("unknown-escalation: closed escalation has no hold for the task", () => {
		const r = validateRatification(goodRecord({ closedEscalationIds: ["esc-ghost"] }), ctx());
		assert.equal(r.ok === false && r.code, "unknown-escalation");
	});

	it("superseded-review-out-of-scope: path traversal", () => {
		const r = validateRatification(
			goodRecord({ supersededReview: { path: "../secrets.md", sha256: "x" } }),
			ctx(),
		);
		assert.equal(r.ok === false && r.code, "superseded-review-out-of-scope");
	});

	it("superseded-review-out-of-scope: filename for a different gate", () => {
		const r = validateRatification(
			goodRecord({ supersededReview: { path: "R007-code-step9.md", sha256: SUPERSEDED_SHA } }),
			ctx({ readFile: () => SUPERSEDED_CONTENT }),
		);
		assert.equal(r.ok === false && r.code, "superseded-review-out-of-scope");
	});

	it("superseded-review-mismatch: content hash no longer matches", () => {
		const r = validateRatification(
			goodRecord({ supersededReview: { path: SUPERSEDED_NAME, sha256: "deadbeef" } }),
			ctx(),
		);
		assert.equal(r.ok === false && r.code, "superseded-review-mismatch");
	});

	it("empty-findings", () => {
		const r = validateRatification(goodRecord({ findings: [] }), ctx());
		assert.equal(r.ok === false && r.code, "empty-findings");
	});

	it("no-revision-proof: proofSet has only artifact proofs", () => {
		const r = validateRatification(
			goodRecord({ proofSet: [{ kind: "artifact", ref: "log.txt" }] }),
			ctx(),
		);
		assert.equal(r.ok === false && r.code, "no-revision-proof");
	});

	it("revision-not-ancestor: revision proof is not an ancestor of HEAD (issuance/ancestor mode)", () => {
		const r = validateRatification(goodRecord(), ctx({ isAncestor: () => false }));
		assert.equal(r.ok === false && r.code, "revision-not-ancestor");
	});

	it("ancestor check skipped when headRevision is null", () => {
		const r = validateRatification(
			goodRecord(),
			ctx({ headRevision: null, isAncestor: () => false }),
		);
		assert.deepEqual(r, { ok: true });
	});

	it("wrong-gate: the record is for a different gate than the one being authorized", () => {
		const r = validateRatification(goodRecord(), ctx({ gate: "plan-step1" }));
		assert.equal(r.ok === false && r.code, "wrong-gate");
	});

	it("accepts when ctx.gate matches record.gate", () => {
		assert.deepEqual(validateRatification(goodRecord(), ctx({ gate: GATE })), { ok: true });
	});

	it("requireProofHeadMatch: head-unresolved when HEAD is null", () => {
		const r = validateRatification(
			goodRecord(),
			ctx({ requireProofHeadMatch: true, headRevision: null }),
		);
		assert.equal(r.ok === false && r.code, "head-unresolved");
	});

	it("requireProofHeadMatch: proof-not-head when the (canonical) proof != HEAD", () => {
		const r = validateRatification(
			goodRecord({ proofSet: [{ kind: "revision", ref: PROOF_OID }] }),
			ctx({ requireProofHeadMatch: true, headRevision: HEAD_OID }),
		);
		assert.equal(r.ok === false && r.code, "proof-not-head");
	});

	it("malformed-record: a non-canonical (symbolic) revision ref is refused before any HEAD check (R007)", () => {
		// A symbolic ref must NOT be re-resolved to match a moved HEAD; it is
		// structurally invalid and rejected up front.
		const r = validateRatification(
			goodRecord({ proofSet: [{ kind: "revision", ref: "HEAD" }] }),
			ctx({ requireProofHeadMatch: true, headRevision: HEAD_OID, isAncestor: () => true }),
		);
		assert.equal(r.ok === false && r.code, "malformed-record");
	});

	it("requireProofHeadMatch: ok when a canonical revision proof exactly equals HEAD", () => {
		const r = validateRatification(
			goodRecord({ proofSet: [{ kind: "revision", ref: HEAD_OID }] }),
			ctx({ requireProofHeadMatch: true, headRevision: HEAD_OID }),
		);
		assert.deepEqual(r, { ok: true });
	});
});

// ── isRatificationStale ───────────────────────────────────────────────

describe("isRatificationStale", () => {
	const approveName = "R008-code-step3.md";
	const approveContent = `## Verdict: APPROVE\n\nratified\n\nRatification: ratif-1\n`;

	it("not stale: the linking APPROVE file is the latest for the gate", () => {
		const stale = isRatificationStale(goodRecord(), {
			reviewFilenames: [SUPERSEDED_NAME, approveName],
			readReview: (f) => (f === approveName ? approveContent : SUPERSEDED_CONTENT),
		});
		assert.equal(stale, false);
	});

	it("stale: a higher-numbered REVISE review exists for the gate", () => {
		const laterRevise = "R009-code-step3.md";
		const stale = isRatificationStale(goodRecord(), {
			reviewFilenames: [approveName, laterRevise],
			readReview: (f) => (f === approveName ? approveContent : "## Verdict: REVISE\nregression\n"),
		});
		assert.equal(stale, true);
	});

	it("stale (fail-closed): no APPROVE file links this record id", () => {
		const stale = isRatificationStale(goodRecord(), {
			reviewFilenames: [approveName],
			readReview: () => "## Verdict: APPROVE\nno link\n",
		});
		assert.equal(stale, true);
	});

	it("stale (fail-closed): the linking file is not an APPROVE", () => {
		const stale = isRatificationStale(goodRecord(), {
			reviewFilenames: [approveName],
			readReview: () => "## Verdict: REVISE\n\nRatification: ratif-1\n",
		});
		assert.equal(stale, true);
	});
});

// ── isValidGateRatification ───────────────────────────────────────────

describe("isValidGateRatification", () => {
	it("accepts a good record and rejects bad shapes", () => {
		assert.equal(isValidGateRatification(goodRecord()), true);
		assert.equal(isValidGateRatification({}), false);
		assert.equal(isValidGateRatification(null), false);
		assert.equal(isValidGateRatification(goodRecord({ findings: "nope" as never })), false);
		assert.equal(
			isValidGateRatification(goodRecord({ proofSet: [{ kind: "bad" as never, ref: "x" }] })),
			false,
		);
		assert.equal(
			isValidGateRatification({ ...goodRecord(), closedEscalationIds: [1, 2] as never }),
			false,
		);
		// R007: a revision proof must be a canonical 40-hex oid; a symbolic/abbrev
		// ref is structurally invalid so it is refused at read.
		assert.equal(
			isValidGateRatification(goodRecord({ proofSet: [{ kind: "revision", ref: "HEAD" }] })),
			false,
		);
		assert.equal(
			isValidGateRatification(goodRecord({ proofSet: [{ kind: "revision", ref: "deadbeef" }] })),
			false,
		);
		// artifact refs remain free-form.
		assert.equal(
			isValidGateRatification(
				goodRecord({
					proofSet: [
						{ kind: "revision", ref: PROOF_OID },
						{ kind: "artifact", ref: "logs/run.txt" },
					],
				}),
			),
			true,
		);
	});
});

// ── write / read round-trip + malformed throws ────────────────────────

describe("writeRatification / readRatifications", () => {
	it("round-trips a record through disk with the shared review number", () => {
		const dir = mkdtempSync(join(tmpdir(), "tp-198-ratif-"));
		try {
			const rec = goodRecord();
			const path = writeRatification(dir, rec, 8);
			assert.ok(path.endsWith("R008-code-step3.ratification.json"));
			const round = readRatifications(dir);
			assert.equal(round.length, 1);
			assert.deepEqual(round[0], rec);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws on invalid JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "tp-198-ratif-"));
		try {
			writeFileSync(join(dir, "R008-code-step3.ratification.json"), "{ not json", "utf-8");
			assert.throws(() => readRatifications(dir), /malformed ratification file/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws on structurally-invalid but syntactically-valid JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "tp-198-ratif-"));
		try {
			writeFileSync(
				join(dir, "R008-code-step3.ratification.json"),
				JSON.stringify({ id: "x", proofSet: "not-an-array" }),
				"utf-8",
			);
			assert.throws(() => readRatifications(dir), /structurally invalid ratification file/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws on duplicate ratification ids across records (fail-closed)", () => {
		const dir = mkdtempSync(join(tmpdir(), "tp-198-ratif-"));
		try {
			writeRatification(dir, goodRecord({ id: "dup" }), 8);
			writeFileSync(
				join(dir, "R009-code-step3.ratification.json"),
				JSON.stringify(goodRecord({ id: "dup" }), null, 2),
			);
			assert.throws(() => readRatifications(dir), /duplicate ratification id dup/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("empty / absent reviews dir yields no records", () => {
		const dir = mkdtempSync(join(tmpdir(), "tp-198-ratif-"));
		try {
			assert.deepEqual(readRatifications(dir), []);
			assert.deepEqual(readRatifications(join(dir, "does-not-exist")), []);
			// non-ratification files are ignored
			writeFileSync(join(dir, "R008-code-step3.md"), "## Verdict: APPROVE\n", "utf-8");
			assert.deepEqual(readRatifications(dir), []);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ── working-tree drift binding (R004/R005) ────────────────────────────

describe("unratifiedWorkingTreePaths", () => {
	it("allows only the task packet's runtime artifacts; flags source AND tracked .pi config (R008)", () => {
		const changed = [
			"taskplane-tasks/TP-R/STATUS.md",
			"taskplane-tasks/TP-R/.DONE",
			"taskplane-tasks/TP-R/.reviews/R002-code-step1.md",
			"taskplane-tasks/TP-R/PROMPT.md", // NOT runtime-owned → flagged
			".pi/taskplane-config.json", // tracked shared config → flagged (R008)
			".pi/agents/worker.md", // tracked agent override → flagged
			"src/index.ts",
		];
		assert.deepEqual(
			unratifiedWorkingTreePaths(changed, runtimeArtifactPrefixes("taskplane-tasks/TP-R")),
			[
				"taskplane-tasks/TP-R/PROMPT.md",
				".pi/taskplane-config.json",
				".pi/agents/worker.md",
				"src/index.ts",
			],
		);
	});

	it("runtimeArtifactPrefixes lists exactly STATUS.md, .DONE and .reviews", () => {
		assert.deepEqual(runtimeArtifactPrefixes("taskplane-tasks\\TP-R"), [
			"taskplane-tasks/TP-R/STATUS.md",
			"taskplane-tasks/TP-R/.DONE",
			"taskplane-tasks/TP-R/.reviews",
		]);
	});

	it("normalizes backslashes and dedupes", () => {
		assert.deepEqual(
			unratifiedWorkingTreePaths(["src\\a.ts", "src/a.ts"], ["taskplane-tasks/TP-R"]),
			["src/a.ts"],
		);
	});
});

describe("selectPacketPaths (shared with buildExecutionUnit — R005 issue 1)", () => {
	const resolved = {
		taskFolderResolved: "/wt/taskplane-tasks/TP-R",
		statusPath: "/wt/taskplane-tasks/TP-R/STATUS.md",
		donePath: "/wt/taskplane-tasks/TP-R/.DONE",
	};

	it("cross-repo segment (packet home != execution repo) uses the absolute packetTaskPath", () => {
		const packet = selectPacketPaths("/home-repo/tasks/TP-R", "home", "exec", resolved);
		assert.equal(packet.reviewsDir, "/home-repo/tasks/TP-R/.reviews");
		assert.equal(packet.statusPath, "/home-repo/tasks/TP-R/STATUS.md");
		assert.equal(packet.taskFolder, "/home-repo/tasks/TP-R");
	});

	it("same-repo resolves inside the worktree", () => {
		const packet = selectPacketPaths("/home-repo/tasks/TP-R", "same", "same", resolved);
		assert.equal(packet.reviewsDir, "/wt/taskplane-tasks/TP-R/.reviews");
		assert.equal(packet.statusPath, "/wt/taskplane-tasks/TP-R/STATUS.md");
	});

	it("no packetTaskPath falls back to the worktree even across repos", () => {
		const packet = selectPacketPaths(null, "home", "exec", resolved);
		assert.equal(packet.reviewsDir, "/wt/taskplane-tasks/TP-R/.reviews");
	});
});

describe("collectChangedPaths (fail-closed)", () => {
	const ok = (stdout: string) => ({ ok: true, stdout, stderr: "" });
	const fail = (stderr: string) => ({ ok: false, stdout: "", stderr });

	it("returns tracked + untracked paths when both probes succeed", () => {
		const runGit = (args: string[]) => (args[0] === "diff" ? ok("src/a.ts\n") : ok("src/new.ts\n"));
		const probe = collectChangedPaths("/wt", runGit);
		assert.equal(probe.failedProbe, null);
		assert.deepEqual(probe.paths, ["src/a.ts", "src/new.ts"]);
	});

	it("fails closed (names the probe) when git diff fails", () => {
		const runGit = (args: string[]) => (args[0] === "diff" ? fail("boom") : ok(""));
		const probe = collectChangedPaths("/wt", runGit);
		assert.equal(probe.failedProbe, "git diff --name-only HEAD");
		assert.match(probe.detail, /boom/);
		assert.deepEqual(probe.paths, []);
	});

	it("fails closed (names the probe) when git ls-files fails", () => {
		const runGit = (args: string[]) => (args[0] === "diff" ? ok("") : fail("nope"));
		const probe = collectChangedPaths("/wt", runGit);
		assert.equal(probe.failedProbe, "git ls-files --others --exclude-standard");
		assert.deepEqual(probe.paths, []);
	});
});
