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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
	type GateRatification,
	type RatificationValidationCtx,
	isRatificationStale,
	isValidGateRatification,
	parseRatificationLink,
	ratificationFilename,
	ratificationLinkLine,
	readRatifications,
	sha256,
	validateRatification,
	writeRatification,
} from "../taskplane/ratification.ts";
import {
	applyRuling,
	createHoldRecord,
	type HoldRecord,
} from "../taskplane/hold-state.ts";

// ── Fixtures ──────────────────────────────────────────────────────────

const GATE = "code-step3";
const SUPERSEDED_NAME = "R007-code-step3.md";
const SUPERSEDED_CONTENT = "## Verdict: REVISE\n\nfix things\n";
const SUPERSEDED_SHA = sha256(SUPERSEDED_CONTENT);

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
		proofSet: [{ kind: "revision", ref: "deadbeef" }],
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

	it("revision-not-ancestor: revision proof is not an ancestor of HEAD", () => {
		const r = validateRatification(goodRecord(), ctx({ isAncestor: () => false }));
		assert.equal(r.ok === false && r.code, "revision-not-ancestor");
	});

	it("ancestor check skipped when headRevision is null", () => {
		const r = validateRatification(goodRecord(), ctx({ headRevision: null, isAncestor: () => false }));
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
			readReview: (f) =>
				f === approveName ? approveContent : "## Verdict: REVISE\nregression\n",
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
		assert.equal(isValidGateRatification(goodRecord({ proofSet: [{ kind: "bad" as never, ref: "x" }] })), false);
		assert.equal(
			isValidGateRatification({ ...goodRecord(), closedEscalationIds: [1, 2] as never }),
			false,
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
