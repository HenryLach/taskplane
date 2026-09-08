/**
 * resume-completion-drift.test.ts — resume `.DONE` acceptance binds ratification
 * authority to a clean source working tree, exactly like the live finalize gate
 * (#627 Stage 2b / TP-199, R003 review parity fix).
 *
 * A `.DONE` with an otherwise-valid linked APPROVE ratification must be REFUSED
 * on resume when the lane worktree carries uncommitted SOURCE drift (which the
 * engine's post-task `git add -A` could sweep into the merge candidate,
 * defeating the ratification's proof-to-code binding). Runtime-owned task
 * artifacts (STATUS.md / .reviews / .DONE) remain allowed to be dirty.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const { collectDoneTaskIdsForResume } = await import("../taskplane/resume.ts");
const { createHoldRecord, applyRuling, markDeliveryInFlight, markDeliveryAcknowledged } =
	await import("../taskplane/hold-state.ts");
const { sha256, writeRatification } = await import("../taskplane/ratification.ts");
type GateRatification = import("../taskplane/ratification.ts").GateRatification;
type HoldRecord = import("../taskplane/hold-state.ts").HoldRecord;
type PersistedBatchState = import("../taskplane/types.ts").PersistedBatchState;

const TASK_ID = "TP-DRIFT";
const GATE = "code-step1";
const SUPERSEDED_NAME = "R001-code-step1.md";
const SUPERSEDED_CONTENT = "# Code Review — Step 1\n\n## Verdict: REVISE\n\n- P1: fix the thing\n";
const RULING_ID = "ruling-drift";
const ESC_ID = "esc-drift";
const RATIF_ID = "ratif-TP-DRIFT-code-step1-ruling-drift";

function approveReview(ratificationId: string): string {
	return `# Ratified closure — Step 1\n\n## Verdict: APPROVE\n\nRuled and folded.\n\nRatification: ${ratificationId}\n`;
}

function ruledHold(): HoldRecord {
	const base = createHoldRecord({
		escalation: { id: ESC_ID, content: "cap hit on code-step1", timestamp: 1_000 },
		batchId: "tp199-drift",
		taskId: TASK_ID,
		segmentId: null,
		executionId: "exec-1",
		agentId: "orch-test-lane-1-worker",
		laneNumber: 1,
		holdTimeoutMinutes: 240,
		now: 1_000,
	});
	const released = applyRuling(
		base,
		{
			id: RULING_ID,
			replyTo: ESC_ID,
			content: "rule: P1 fixed",
			actor: { role: "supervisor", id: "sup" },
		},
		2_000,
	);
	return markDeliveryAcknowledged(markDeliveryInFlight(released, "delivered"));
}

function goodRecord(headSha: string): GateRatification {
	return {
		id: RATIF_ID,
		taskId: TASK_ID,
		segmentId: null,
		gate: GATE,
		rulingId: RULING_ID,
		ratifier: { role: "supervisor", id: "sup" },
		closedEscalationIds: [ESC_ID],
		supersededReview: { path: SUPERSEDED_NAME, sha256: sha256(SUPERSEDED_CONTENT) },
		findings: [{ ref: "P1", disposition: "fixed", evidenceRefs: [headSha] }],
		proofSet: [{ kind: "revision", ref: headSha }],
		createdAt: 3_000,
	};
}

describe("resume `.DONE` acceptance — ratification working-tree drift parity", () => {
	let tmpRoot: string;
	let worktreePath: string;
	let taskFolder: string;
	let reviewsDir: string;
	let warnings: string[];
	let originalWarn: typeof console.warn;

	function git(...args: string[]): void {
		execFileSync("git", args, { cwd: worktreePath, stdio: "pipe" });
	}

	function state(): PersistedBatchState {
		return {
			batchId: "tp199-drift",
			phase: "executing",
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "orch-lane-1",
					worktreePath,
					branch: "test-branch",
					taskIds: [TASK_ID],
				} as unknown as PersistedBatchState["lanes"][number],
			],
			tasks: [
				{
					taskId: TASK_ID,
					taskFolder,
					areaName: "test",
					promptPath: join(taskFolder, "PROMPT.md"),
					status: "pending",
					attempts: 0,
				} as unknown as PersistedBatchState["tasks"][number],
			],
			waves: [],
			segments: [],
			holds: [ruledHold()],
		} as unknown as PersistedBatchState;
	}

	beforeEach(() => {
		warnings = [];
		originalWarn = console.warn;
		console.warn = (msg: unknown) => {
			warnings.push(typeof msg === "string" ? msg : String(msg));
		};
		tmpRoot = mkdtempSync(join(tmpdir(), "tp199-drift-"));
		worktreePath = join(tmpRoot, "worktree");
		taskFolder = join(worktreePath, "taskplane-tasks", TASK_ID);
		reviewsDir = join(taskFolder, ".reviews");
		mkdirSync(reviewsDir, { recursive: true });
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });

		git("init", "-q");
		git("config", "user.email", "t@t.t");
		git("config", "user.name", "t");
		git("config", "commit.gpgsign", "false");

		// Source file + task artifacts, all committed clean; the commit is the
		// ratified proof HEAD (proof == HEAD, R003 issue 2).
		writeFileSync(join(worktreePath, "code.txt"), "folded\n");
		writeFileSync(join(taskFolder, "PROMPT.md"), "# TP-DRIFT\n");
		writeFileSync(join(taskFolder, "STATUS.md"), "# TP-DRIFT — Status\n\n**Status:** ✅ Complete\n");
		writeFileSync(join(reviewsDir, SUPERSEDED_NAME), SUPERSEDED_CONTENT);
		writeFileSync(join(reviewsDir, "R002-code-step1.md"), approveReview(RATIF_ID));
		writeFileSync(join(taskFolder, ".DONE"), "Completed\n");
		git("add", "-A");
		git("commit", "-q", "-m", "fold");
		const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath })
			.toString()
			.trim();
		writeRatification(reviewsDir, goodRecord(headSha), 2);
		// The ratification json is written after the commit (untracked, under
		// .reviews) — a runtime artifact, exempt from the drift check.
	});

	afterEach(() => {
		console.warn = originalWarn;
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("clean source tree + valid ratified APPROVE → collected", () => {
		const result = collectDoneTaskIdsForResume(state(), worktreePath);
		assert.equal(result.has(TASK_ID), true);
	});

	it("uncommitted SOURCE drift → NOT collected (refused by completion authority)", () => {
		// A source change the ratified proof commit does not represent.
		writeFileSync(join(worktreePath, "code.txt"), "drifted after ratification\n");
		const result = collectDoneTaskIdsForResume(state(), worktreePath);
		assert.equal(result.has(TASK_ID), false);
		assert.ok(
			warnings.some((w) => w.includes(TASK_ID) && w.includes("refused by completion authority")),
			"expected a completion-authority refusal warning for source drift",
		);
	});

	it("runtime-only task-artifact drift (STATUS.md) → still collected", () => {
		// Only a runtime-owned artifact is dirty — allowed, must not refuse.
		writeFileSync(
			join(taskFolder, "STATUS.md"),
			"# TP-DRIFT — Status\n\n**Status:** ✅ Complete\n\nedited post-crash\n",
		);
		const result = collectDoneTaskIdsForResume(state(), worktreePath);
		assert.equal(result.has(TASK_ID), true);
	});
});
