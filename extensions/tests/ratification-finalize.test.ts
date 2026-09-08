/**
 * Gate ratification — trusted operation wiring + finalize-gate binding (#627 Stage 2a).
 *
 * Part 1 (Step 2): source-based assertions that the `ratify_gate` tool and
 * `/orch-ratify` command are registered, that the ratifier role is stamped by
 * the issuing path (supervisor for the tool, operator for the command, exactly
 * one operator stamp site), and that the sequencing invariant is stated.
 *
 * Part 2 (Step 3): behavioural finalize-gate tests using the real `executeTaskV2`
 * with `spawnAgent` mocked (harness mirrors `review-remediation-spawn.test.ts`):
 *   (a) ratified APPROVE with a valid record → succeeds and .DONE is written
 *   (b) APPROVE claiming a ratification id with no record → refused, invalid-ratification, no .DONE
 *   (c) valid record but a later REVISE for the same gate → refused, no .DONE
 *   (d) record whose supersededReview.sha256 no longer matches → refused, invalid-ratification, no .DONE
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EXTENSION_SRC = readFileSync(join(HERE, "..", "taskplane", "extension.ts"), "utf-8");

// ── Step 2: trusted ratify operation wiring (source-based) ────────────

describe("ratify_gate / orch-ratify wiring", () => {
	it("registers the ratify_gate supervisor tool", () => {
		assert.match(EXTENSION_SRC, /name:\s*"ratify_gate"/);
	});

	it("registers the /orch-ratify operator command", () => {
		assert.match(EXTENSION_SRC, /registerCommand\("orch-ratify"/);
	});

	it("stamps the supervisor ratifier role at exactly one site (the tool)", () => {
		const matches = EXTENSION_SRC.match(/RATIFY-SUPERVISOR-STAMP/g) ?? [];
		assert.equal(matches.length, 1);
	});

	it("stamps the operator ratifier role at exactly one site (the command)", () => {
		const matches = EXTENSION_SRC.match(/RATIFY-OPERATOR-STAMP/g) ?? [];
		assert.equal(matches.length, 1, "operator ratifier must be stamped at exactly one site");
	});

	it("never reads the ratifier role from a tool/command parameter", () => {
		assert.doesNotMatch(EXTENSION_SRC, /ratifier:\s*params\./);
	});

	it("states the ruling → fold → verification → ratify_gate → APPROVE → .DONE sequencing invariant", () => {
		assert.match(EXTENSION_SRC, /SEQUENCING INVARIANT/);
		assert.match(EXTENSION_SRC, /ratify_gate.*→.*\.DONE/s);
	});

	it("audits the ratification via logRecoveryAction with a gate_ratified action", () => {
		assert.match(EXTENSION_SRC, /action:\s*"gate_ratified"/);
		assert.match(EXTENSION_SRC, /classification:\s*"destructive"/);
	});

	it("writes the APPROVE review with an explicit APPROVE verdict and the ratification link", () => {
		assert.match(EXTENSION_SRC, /## Verdict: APPROVE/);
		assert.match(EXTENSION_SRC, /ratificationLinkLine\(record\.id\)/);
	});

	it("R005-1: resolves the packet with the shared selectPacketPaths (cross-repo safe) and binds to the ruling's lane", () => {
		assert.match(EXTENSION_SRC, /selectPacketPaths\(/);
		assert.match(EXTENSION_SRC, /l\.laneNumber === rulingHold\.laneNumber/);
	});

	it("R005-2: the trusted operation refuses fail-closed when a working-tree probe fails", () => {
		assert.match(EXTENSION_SRC, /probe\.failedProbe/);
		assert.match(EXTENSION_SRC, /working-tree probe failed/);
	});
});

// ── Step 3: finalize-gate binding (behavioural) ───────────────────────

// spawnAgent mock — installed before importing the lane-runner.
interface SpawnCall {
	prompt: string;
}
let spawnCalls: SpawnCall[] = [];
let onSpawn: ((index: number) => void) | null = null;

const realAgentHost = await import("../taskplane/agent-host.ts");
const mockSpawnAgent = mock.fn((opts: { prompt: string }) => {
	const index = spawnCalls.length;
	spawnCalls.push({ prompt: opts.prompt });
	onSpawn?.(index);
	const result = {
		exitCode: 0,
		signal: null,
		durationMs: 1000,
		killed: false,
		inputTokens: 10,
		outputTokens: 5,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costUsd: 0.01,
		toolCalls: 1,
		lastTool: "edit",
		retries: 0,
		compactions: 0,
		contextUsage: null,
		error: null,
		agentEnded: true,
		stderrTail: "",
	};
	return { promise: Promise.resolve(result), kill: () => {} } as unknown as ReturnType<
		typeof realAgentHost.spawnAgent
	>;
});
mock.module("../taskplane/agent-host.ts", {
	namedExports: { ...realAgentHost, spawnAgent: mockSpawnAgent },
});

const { executeTaskV2 } = await import("../taskplane/lane-runner.ts");
const { resolvePacketPaths } = await import("../taskplane/types.ts");
const {
	createInMemoryHoldStore,
	createHoldRecord,
	applyRuling,
	markDeliveryInFlight,
	markDeliveryAcknowledged,
} = await import("../taskplane/hold-state.ts");
const { sha256, writeRatification } = await import("../taskplane/ratification.ts");
type GateRatification = import("../taskplane/ratification.ts").GateRatification;

const GATE = "code-step1";
const SUPERSEDED_NAME = "R001-code-step1.md";
const SUPERSEDED_CONTENT = "# Code Review — Step 1\n\n## Verdict: REVISE\n\n- P1: fix the thing\n";
const RULING_ID = "ruling-1";
const ESC_ID = "esc-1";
const RATIF_ID = "ratif-TP-R-code-step1-ruling-1";

const PROMPT_MD = `# TP-R: Ratification finalize fixture

**Size:** S

## Review Level: 2

## Mission

Drive the #627 Stage 2a finalize binding.

## Steps

### Step 1: Implement thing

- [ ] Do the thing
- [ ] Test the thing

## Do NOT

- Nothing.

---
`;

const STATUS_MD = `# TP-R — Status

**Current Step:** Step 1: Implement thing
**Status:** 🟡 In Progress
**Iteration:** 1
**Review Level:** 2
**Review Counter:** 2

---

### Step 1: Implement thing
**Status:** ✅ Complete

- [x] Do the thing
- [x] Test the thing

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|

---
`;

/** Latest review file for the gate: an APPROVE that links the ratification. */
function approveReview(ratificationId: string): string {
	return `# Ratified closure — Step 1\n\n## Verdict: APPROVE\n\nRuled and folded.\n\nRatification: ${ratificationId}\n`;
}

function releasedHold() {
	const base = createHoldRecord({
		escalation: { id: ESC_ID, content: "cap hit on code-step1", timestamp: 1_000 },
		batchId: "tp627-finalize",
		taskId: "TP-R",
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
			actor: { role: "supervisor", id: "supervisor" },
		},
		2_000,
	);
	// In the real flow the worker acknowledges the ruling before ratification; an
	// acknowledged hold no longer blocks completion, so the runner reaches the
	// finalize gate instead of re-spawning to deliver the ruling.
	return markDeliveryAcknowledged(markDeliveryInFlight(released, "delivered"));
}

/** Set per-test to the worktree's real HEAD sha (the ratified proof revision). */
let headSha = "c0ffee";

function goodRecord(overrides: Partial<GateRatification> = {}): GateRatification {
	return {
		id: RATIF_ID,
		taskId: "TP-R",
		segmentId: null,
		gate: GATE,
		rulingId: RULING_ID,
		ratifier: { role: "supervisor", id: "supervisor" },
		closedEscalationIds: [ESC_ID],
		supersededReview: { path: SUPERSEDED_NAME, sha256: sha256(SUPERSEDED_CONTENT) },
		findings: [{ ref: "P1", disposition: "fixed", evidenceRefs: [headSha] }],
		// The proof revision is the real worktree HEAD so the finalize gate's exact
		// proof==HEAD check (R003 issue 2) is satisfied for the happy path.
		proofSet: [{ kind: "revision", ref: headSha }],
		createdAt: 3_000,
		...overrides,
	};
}

describe("#627 Stage 2a — finalize-gate ratification binding (behavioural)", () => {
	let tmpRoot: string;
	let taskFolder: string;
	let worktreePath: string;
	let reviewsDir: string;
	let alerts: Array<{ category: string; summary: string; context?: Record<string, unknown> }>;

	function buildUnitAndConfig(withHold: boolean) {
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-R",
			taskId: "TP-R",
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-R",
				taskName: "Ratification finalize fixture",
				reviewLevel: 2,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
			},
		};
		const config = {
			batchId: "tp627-finalize",
			agentIdPrefix: "orch-test",
			laneNumber: 1,
			worktreePath,
			branch: "test-branch",
			repoId: "default",
			stateRoot: tmpRoot,
			workerModel: "",
			workerTools: "",
			workerThinking: "",
			workerSystemPrompt: "",
			workerSegmentPrompt: "",
			reviewerModel: "",
			reviewerThinking: "",
			reviewerTools: "",
			maxIterations: 6,
			noProgressLimit: 2,
			maxWorkerMinutes: 5,
			warnPercent: 80,
			killPercent: 95,
			...(withHold ? { holdStore: createInMemoryHoldStore([releasedHold()]) } : {}),
			onSupervisorAlert: (a: {
				category: string;
				summary: string;
				context?: Record<string, unknown>;
			}) => {
				alerts.push(a);
			},
		};
		return { unit, config, packet };
	}

	function run(withHold: boolean) {
		const { unit, config, packet } = buildUnitAndConfig(withHold);
		return {
			packet,
			result: executeTaskV2(
				unit as Parameters<typeof executeTaskV2>[0],
				config as unknown as Parameters<typeof executeTaskV2>[1],
				{ paused: false },
			),
		};
	}

	beforeEach(() => {
		spawnCalls = [];
		onSpawn = null;
		alerts = [];
		tmpRoot = mkdtempSync(join(tmpdir(), "tp627-finalize-"));
		worktreePath = join(tmpRoot, "worktree");
		taskFolder = join(worktreePath, "taskplane-tasks", "TP-R");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "PROMPT.md"), PROMPT_MD);
		writeFileSync(join(taskFolder, "STATUS.md"), STATUS_MD);
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
		reviewsDir = resolvePacketPaths(taskFolder).reviewsDir;
		mkdirSync(reviewsDir, { recursive: true });
		writeFileSync(join(reviewsDir, SUPERSEDED_NAME), SUPERSEDED_CONTENT);
		// A real git repo so the finalize gate can resolve HEAD and the exact
		// proof==HEAD binding (R003 issue 2) holds for the happy path.
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: worktreePath, stdio: "pipe" });
		git("init", "-q");
		git("config", "user.email", "t@t.t");
		git("config", "user.name", "t");
		git("config", "commit.gpgsign", "false");
		writeFileSync(join(worktreePath, "code.txt"), "folded\n");
		git("add", "-A");
		git("commit", "-q", "-m", "fold");
		headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath }).toString().trim();
	});

	function gitCommitMore() {
		writeFileSync(join(worktreePath, "more.txt"), "extra\n");
		execFileSync("git", ["add", "-A"], { cwd: worktreePath, stdio: "pipe" });
		execFileSync("git", ["commit", "-q", "-m", "more"], { cwd: worktreePath, stdio: "pipe" });
	}

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("(a) ratified APPROVE with a valid record → succeeded, .DONE written", async () => {
		writeFileSync(join(reviewsDir, "R002-code-step1.md"), approveReview(RATIF_ID));
		writeRatification(reviewsDir, goodRecord(), 2);

		const { result, packet } = run(true);
		const r = await result;
		assert.equal(r.outcome.status, "succeeded");
		assert.equal(existsSync(packet.donePath), true);
		assert.equal(spawnCalls.length, 0); // an authority-clean finalize never spawns
	});

	it("(b) APPROVE claiming a ratification id with no record → refused, invalid-ratification, no .DONE", async () => {
		writeFileSync(join(reviewsDir, "R002-code-step1.md"), approveReview("ratif-missing"));
		// No ratification JSON written.

		const { result, packet } = run(true);
		const r = await result;
		assert.equal(r.outcome.status, "failed");
		assert.equal(r.outcome.exitDiagnostic?.classification, "review_gate_refusal");
		assert.equal(existsSync(packet.donePath), false);
		const alert = alerts.find((a) => a.context?.reviewInterventionKind === "invalid-ratification");
		assert.ok(alert, "expected an invalid-ratification alert");
		assert.match(alert!.summary, /ratif-missing|missing/);
	});

	it("(c) valid record but a later REVISE for the same gate → refused, no .DONE", async () => {
		writeFileSync(join(reviewsDir, "R002-code-step1.md"), approveReview(RATIF_ID));
		writeRatification(reviewsDir, goodRecord(), 2);
		// A later re-review reads REVISE — the ratified APPROVE is no longer latest.
		writeFileSync(
			join(reviewsDir, "R003-code-step1.md"),
			"# Re-review\n\n## Verdict: REVISE\n\nregression\n",
		);

		const { result, packet } = run(true);
		const r = await result;
		assert.equal(r.outcome.status, "failed");
		assert.equal(r.outcome.exitDiagnostic?.classification, "review_gate_refusal");
		assert.equal(existsSync(packet.donePath), false);
	});

	it("(d) record whose supersededReview.sha256 no longer matches → refused, invalid-ratification, no .DONE", async () => {
		writeFileSync(join(reviewsDir, "R002-code-step1.md"), approveReview(RATIF_ID));
		writeRatification(
			reviewsDir,
			goodRecord({ supersededReview: { path: SUPERSEDED_NAME, sha256: "deadbeef" } }),
			2,
		);

		const { result, packet } = run(true);
		const r = await result;
		assert.equal(r.outcome.status, "failed");
		assert.equal(r.outcome.exitDiagnostic?.classification, "review_gate_refusal");
		assert.equal(existsSync(packet.donePath), false);
		const alert = alerts.find((a) => a.context?.reviewInterventionKind === "invalid-ratification");
		assert.ok(alert, "expected an invalid-ratification alert");
		assert.match(alert!.summary, /superseded-review-mismatch|missing, invalid, or\s+stale/s);
	});

	it("(e) an APPROVE with NO ratification link keeps today's behaviour (not blocking)", async () => {
		writeFileSync(
			join(reviewsDir, "R002-code-step1.md"),
			"# Re-review\n\n## Verdict: APPROVE\n\nclean\n",
		);
		const { result, packet } = run(false);
		const r = await result;
		assert.equal(r.outcome.status, "succeeded");
		assert.equal(existsSync(packet.donePath), true);
	});

	it("(f) R003-1 wrong-gate: an APPROVE for another gate cannot reuse this record → refused, invalid-ratification", async () => {
		// The ONLY gate scanned is code-step9, whose APPROVE links a record whose
		// gate is code-step1. The record itself is otherwise valid.
		writeFileSync(join(reviewsDir, "R002-code-step9.md"), approveReview(RATIF_ID));
		writeRatification(reviewsDir, goodRecord(), 2); // record.gate === "code-step1"

		const { result, packet } = run(true);
		const r = await result;
		assert.equal(r.outcome.status, "failed");
		assert.equal(r.outcome.exitDiagnostic?.classification, "review_gate_refusal");
		assert.equal(existsSync(packet.donePath), false);
		const alert = alerts.find((a) => a.context?.reviewInterventionKind === "invalid-ratification");
		assert.ok(alert, "expected an invalid-ratification alert");
		assert.match(alert!.summary, /wrong-gate|missing, invalid, or\s+stale/s);
	});

	it("(g) R003-2 descendant commit: code changed after ratification → refused (proof != HEAD)", async () => {
		writeFileSync(join(reviewsDir, "R002-code-step1.md"), approveReview(RATIF_ID));
		writeRatification(reviewsDir, goodRecord(), 2); // proof pins the pre-commit HEAD
		gitCommitMore(); // HEAD moves past the ratified proof revision

		const { result, packet } = run(true);
		const r = await result;
		assert.equal(r.outcome.status, "failed");
		assert.equal(r.outcome.exitDiagnostic?.classification, "review_gate_refusal");
		assert.equal(existsSync(packet.donePath), false);
	});

	it("(h) R003-2 unresolvable HEAD: no git repo → refused (head-unresolved), no .DONE", async () => {
		// Remove the git repo so `git rev-parse HEAD` fails at finalize.
		rmSync(join(worktreePath, ".git"), { recursive: true, force: true });
		writeFileSync(join(reviewsDir, "R002-code-step1.md"), approveReview(RATIF_ID));
		writeRatification(reviewsDir, goodRecord({ proofSet: [{ kind: "revision", ref: "c0ffee" }] }), 2);

		const { result, packet } = run(true);
		const r = await result;
		assert.equal(r.outcome.status, "failed");
		assert.equal(r.outcome.exitDiagnostic?.classification, "review_gate_refusal");
		assert.equal(existsSync(packet.donePath), false);
	});

	it("(i) R003-3 stale-then-reratify recovery: a fresh record with a new id restores completion authority", async () => {
		// First ratification becomes stale (a later REVISE), then a NEW ratification
		// (new id, higher R APPROVE) is issued → the gate closes.
		writeFileSync(join(reviewsDir, "R002-code-step1.md"), approveReview("ratif-old"));
		writeRatification(reviewsDir, goodRecord({ id: "ratif-old" }), 2);
		writeFileSync(
			join(reviewsDir, "R003-code-step1.md"),
			"# Re-review\n\n## Verdict: REVISE\n\nregression\n",
		);
		// Re-ratify: new id, new APPROVE at R004 (now the latest).
		writeFileSync(join(reviewsDir, "R004-code-step1.md"), approveReview("ratif-new"));
		writeRatification(reviewsDir, goodRecord({ id: "ratif-new" }), 4);

		const { result, packet } = run(true);
		const r = await result;
		assert.equal(r.outcome.status, "succeeded");
		assert.equal(existsSync(packet.donePath), true);
	});

	it("(j) R004-2 uncommitted source change after ratification → refused (working tree dirty), no .DONE", async () => {
		writeFileSync(join(reviewsDir, "R002-code-step1.md"), approveReview(RATIF_ID));
		writeRatification(reviewsDir, goodRecord(), 2); // proof == HEAD, tree clean at this point
		// A source file changes but is NOT committed — HEAD still equals the proof,
		// yet the post-task `git add -A` would sweep this unratified change in.
		writeFileSync(join(worktreePath, "code.txt"), "tampered\n");

		const { result, packet } = run(true);
		const r = await result;
		assert.equal(r.outcome.status, "failed");
		assert.equal(r.outcome.exitDiagnostic?.classification, "review_gate_refusal");
		assert.equal(existsSync(packet.donePath), false);
		const alert = alerts.find((a) => a.context?.reviewInterventionKind === "invalid-ratification");
		assert.ok(alert, "expected an invalid-ratification alert");
	});
});
