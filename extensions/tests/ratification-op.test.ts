/**
 * Trusted ratify operation — behavioural (#627 Stage 2a, R005/R006).
 *
 * Exercises the extracted `ratifyGate` with injected deps (batch-state, lane
 * repo, git, audit) against real temp git worktrees. Covers:
 *   - same-repo happy path: APPROVE + JSON written, packet STATUS counter bumped
 *   - cross-repo segment: APPROVE, JSON and the PACKET-HOME STATUS counter all
 *     update together (R006 issue 1) — NOT the execution worktree copy
 *   - cited-hold lane binding fails closed when the lane record is missing
 *     (R006 issue 2) — no fallback to task.laneNumber
 *   - working-tree probe failure is fail-closed at issuance (R005 issue 2)
 *   - proof canonicalization: symbolic HEAD accepted (stored as oid); older
 *     ancestor rejected (R004 issue 1)
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ratifyGate, type RatifyGateDeps } from "../taskplane/ratification-op.ts";
import { readRatifications } from "../taskplane/ratification.ts";
import { createHoldRecord, applyRuling, type HoldRecord } from "../taskplane/hold-state.ts";

const REVISE = "# Review\n\n## Verdict: REVISE\n\n- P1: fix\n";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
}

function initRepo(dir: string): string {
	mkdirSync(dir, { recursive: true });
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "t@t.t");
	git(dir, "config", "user.name", "t");
	git(dir, "config", "commit.gpgsign", "false");
	writeFileSync(join(dir, "code.txt"), "folded\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "fold");
	return git(dir, "rev-parse", "HEAD");
}

/** A released+acknowledged hold for TP-R on lane 1 carrying ruling-1. */
function hold(laneNumber = 1, segmentId: string | null = null): HoldRecord {
	const base = createHoldRecord({
		escalation: { id: "esc-1", content: "cap hit", timestamp: 1_000 },
		batchId: "b1",
		taskId: "TP-R",
		segmentId,
		executionId: "e1",
		agentId: "orch-test-lane-1-worker",
		laneNumber,
		holdTimeoutMinutes: 240,
		now: 1_000,
	});
	return applyRuling(
		base,
		{ id: "ruling-1", replyTo: "esc-1", content: "rule", actor: { role: "supervisor", id: "s" } },
		2_000,
	);
}

const realRunGit: RatifyGateDeps["runGit"] = (args, cwd) => {
	try {
		const stdout = execFileSync("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
			.toString()
			.trim();
		return { ok: true, stdout, stderr: "" };
	} catch (err) {
		const e = err as { stdout?: Buffer; stderr?: Buffer };
		return {
			ok: false,
			stdout: (e.stdout?.toString() ?? "").trim(),
			stderr: (e.stderr?.toString() ?? "git failed").trim(),
		};
	}
};

describe("ratifyGate (behavioural, injected deps)", () => {
	let tmpRoot: string;
	let audit: Array<{ laneNumber?: number; action: string }>;

	function deps(state: unknown, over: Partial<RatifyGateDeps> = {}): RatifyGateDeps {
		return {
			loadBatchState: () => state as never,
			// Repo-mode: the lane's repo root IS the worktree, so task folders
			// resolve to `<worktree>/taskplane-tasks/...` without path doubling.
			resolveLaneRepoRoot: (lane) => lane.worktreePath,
			isWorkspaceMode: false,
			runGit: realRunGit,
			logAudit: (_root, _batch, entry) =>
				audit.push({ laneNumber: entry.laneNumber, action: entry.action }),
			genId: () => "fixed-uuid",
			now: () => 3_000,
			...over,
		};
	}

	const params = (over: Record<string, unknown> = {}) => ({
		taskId: "TP-R",
		gate: "code-step1",
		rulingId: "ruling-1",
		summary: "ruled and folded",
		findings: [{ ref: "P1", disposition: "fixed" as const, evidence: ["c"] }],
		proofRevision: "HEAD",
		...over,
	});

	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "tp198-op-"));
		audit = [];
	});
	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("same-repo happy path: writes APPROVE + JSON and bumps the packet STATUS counter", () => {
		const worktree = join(tmpRoot, "wt");
		initRepo(worktree);
		const taskFolder = join(worktree, "taskplane-tasks", "TP-R");
		const reviewsDir = join(taskFolder, ".reviews");
		mkdirSync(reviewsDir, { recursive: true });
		writeFileSync(join(taskFolder, "STATUS.md"), "# S\n\n**Review Counter:** 5\n");
		writeFileSync(join(reviewsDir, "R005-code-step1.md"), REVISE);

		const state = {
			batchId: "b1",
			tasks: [{ taskId: "TP-R", laneNumber: 1, taskFolder }],
			lanes: [{ laneNumber: 1, repoId: "default", worktreePath: worktree }],
			holds: [hold()],
		};
		const res = ratifyGate(params(), { role: "supervisor", id: "supervisor" }, tmpRoot, deps(state));
		assert.match(res, /^✅ Ratified/);
		// R006: counter allocated from packet STATUS.md → R006 files.
		assert.match(readFileSync(join(taskFolder, "STATUS.md"), "utf-8"), /\*\*Review Counter:\*\* 6/);
		assert.match(
			readFileSync(join(reviewsDir, "R006-code-step1.md"), "utf-8"),
			/## Verdict: APPROVE/,
		);
		const records = readRatifications(reviewsDir);
		assert.equal(records.length, 1);
		assert.equal(records[0].gate, "code-step1");
		// proof stored as an immutable oid (not the symbolic "HEAD").
		assert.match(records[0].proofSet[0].ref, /^[0-9a-f]{40}$/);
		assert.equal(audit[0]?.laneNumber, 1);
	});

	it("cross-repo segment: APPROVE, JSON and the PACKET-HOME STATUS counter update together (R006-1)", () => {
		// Execution worktree (where the fold is committed) and a SEPARATE packet-home.
		const worktree = join(tmpRoot, "exec-wt");
		initRepo(worktree);
		const packetHome = join(tmpRoot, "home", "tasks", "TP-R");
		const packetReviews = join(packetHome, ".reviews");
		mkdirSync(packetReviews, { recursive: true });
		writeFileSync(join(packetHome, "STATUS.md"), "# S\n\n**Review Counter:** 9\n");
		writeFileSync(join(packetReviews, "R009-code-step1.md"), REVISE);
		// A decoy STATUS in the execution worktree that must NOT be touched.
		const wtTaskFolder = join(worktree, "taskplane-tasks", "TP-R");
		mkdirSync(wtTaskFolder, { recursive: true });
		writeFileSync(join(wtTaskFolder, "STATUS.md"), "# S\n\n**Review Counter:** 1\n");

		const state = {
			batchId: "b1",
			tasks: [
				{
					taskId: "TP-R",
					laneNumber: 1,
					taskFolder: wtTaskFolder,
					packetRepoId: "home",
					packetTaskPath: packetHome,
				},
			],
			lanes: [{ laneNumber: 1, repoId: "exec", worktreePath: worktree }],
			holds: [hold()],
		};
		const res = ratifyGate(params(), { role: "supervisor", id: "supervisor" }, tmpRoot, deps(state));
		assert.match(res, /^✅ Ratified/);
		// Packet-home STATUS counter bumped; execution-worktree decoy untouched.
		assert.match(readFileSync(join(packetHome, "STATUS.md"), "utf-8"), /\*\*Review Counter:\*\* 10/);
		assert.match(readFileSync(join(wtTaskFolder, "STATUS.md"), "utf-8"), /\*\*Review Counter:\*\* 1/);
		// APPROVE + JSON written to the packet-home .reviews, at the packet counter.
		assert.match(readFileSync(join(packetReviews, "R010-code-step1.md"), "utf-8"), /Ratification:/);
		assert.equal(readRatifications(packetReviews).length, 1);
	});

	it("fails closed when the cited ruling's lane has no record (R006-2, no task.laneNumber fallback)", () => {
		const worktree = join(tmpRoot, "wt");
		initRepo(worktree);
		const taskFolder = join(worktree, "taskplane-tasks", "TP-R");
		mkdirSync(join(taskFolder, ".reviews"), { recursive: true });
		writeFileSync(join(taskFolder, ".reviews", "R001-code-step1.md"), REVISE);
		writeFileSync(join(taskFolder, "STATUS.md"), "# S\n\n**Review Counter:** 1\n");

		// Ruling names lane 7; only lane 1 exists. task.laneNumber is 1 (the trap).
		const state = {
			batchId: "b1",
			tasks: [{ taskId: "TP-R", laneNumber: 1, taskFolder }],
			lanes: [{ laneNumber: 1, repoId: "default", worktreePath: worktree }],
			holds: [hold(7)],
		};
		const res = ratifyGate(params(), { role: "supervisor", id: "supervisor" }, tmpRoot, deps(state));
		assert.match(res, /names lane 7, which has no lane record/);
		assert.equal(audit.length, 0);
	});

	it("fails closed when a git working-tree probe fails (R005-2)", () => {
		const worktree = join(tmpRoot, "wt");
		initRepo(worktree);
		const taskFolder = join(worktree, "taskplane-tasks", "TP-R");
		mkdirSync(join(taskFolder, ".reviews"), { recursive: true });
		writeFileSync(join(taskFolder, ".reviews", "R001-code-step1.md"), REVISE);
		writeFileSync(join(taskFolder, "STATUS.md"), "# S\n\n**Review Counter:** 1\n");
		const state = {
			batchId: "b1",
			tasks: [{ taskId: "TP-R", laneNumber: 1, taskFolder }],
			lanes: [{ laneNumber: 1, repoId: "default", worktreePath: worktree }],
			holds: [hold()],
		};
		// runGit that resolves HEAD but fails the diff probe.
		const flakyGit: RatifyGateDeps["runGit"] = (args, cwd) =>
			args[0] === "diff" ? { ok: false, stdout: "", stderr: "index locked" } : realRunGit(args, cwd);
		const res = ratifyGate(
			params(),
			{ role: "supervisor", id: "supervisor" },
			tmpRoot,
			deps(state, { runGit: flakyGit }),
		);
		assert.match(res, /working-tree probe failed \(git diff/);
		assert.equal(audit.length, 0);
	});

	it("rejects a proof revision that is not the current HEAD (R004-1)", () => {
		const worktree = join(tmpRoot, "wt");
		const firstSha = initRepo(worktree);
		// Advance HEAD so `firstSha` is now an older ancestor.
		writeFileSync(join(worktree, "code.txt"), "more\n");
		git(worktree, "add", "-A");
		git(worktree, "commit", "-q", "-m", "more");
		const taskFolder = join(worktree, "taskplane-tasks", "TP-R");
		mkdirSync(join(taskFolder, ".reviews"), { recursive: true });
		writeFileSync(join(taskFolder, ".reviews", "R001-code-step1.md"), REVISE);
		writeFileSync(join(taskFolder, "STATUS.md"), "# S\n\n**Review Counter:** 1\n");
		const state = {
			batchId: "b1",
			tasks: [{ taskId: "TP-R", laneNumber: 1, taskFolder }],
			lanes: [{ laneNumber: 1, repoId: "default", worktreePath: worktree }],
			holds: [hold()],
		};
		const res = ratifyGate(
			params({ proofRevision: firstSha }),
			{ role: "supervisor", id: "supervisor" },
			tmpRoot,
			deps(state),
		);
		assert.match(res, /is not the current worktree HEAD/);
		assert.equal(audit.length, 0);
	});
});
