/**
 * Review-boundary supervisor notifications — Stage 2 (emission + per-boundary notify).
 *
 * Covers:
 *   - normalizeReviewDisposition: robust parsing of the review_step verdict text
 *     into a ReviewDisposition (agent-host.ts).
 *   - formatEventNotification: the supervisor-facing text for the new
 *     review_started / review_completed / review_failed engine events
 *     (supervisor.ts).
 *   - Wiring assertions (source-based, matching project convention for closures
 *     inside agent-host/lane-runner that have no unit harness):
 *       * agent-host emits review_requested at review_step start and
 *         review_completed / review_failed at end.
 *       * lane-runner bridges the per-agent review_* RuntimeAgentEvents to the
 *         supervisor events.jsonl stream via emitEngineEvent.
 *       * the review event types are registered SIGNIFICANT (surfaced every
 *         boundary, not coalesced into digests).
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/review-boundary-notifications.test.ts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "./expect.ts";
import { normalizeReviewDisposition, extractToolResultText } from "../taskplane/agent-host.ts";
import { formatEventNotification } from "../taskplane/supervisor.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = (f: string) =>
	readFileSync(join(__dirname, "..", "taskplane", f), "utf-8").replace(/\r\n/g, "\n");

// ParsedEvent is not exported from supervisor.ts; build a structurally-
// compatible partial and cast through unknown for formatEventNotification.
const ev = (fields: Record<string, unknown>): Parameters<typeof formatEventNotification>[0] =>
	({
		timestamp: new Date().toISOString(),
		batchId: "b1",
		waveIndex: -1,
		...fields,
	}) as unknown as Parameters<typeof formatEventNotification>[0];

describe("review-boundary — normalizeReviewDisposition", () => {
	it("parses the canonical leading tokens the review_step tool returns", () => {
		expect(normalizeReviewDisposition("APPROVE")).toBe("APPROVE");
		expect(
			normalizeReviewDisposition("REVISE: fix the null check\n\nFull review: .reviews/R3.md"),
		).toBe("REVISE");
		expect(normalizeReviewDisposition("RETHINK — reconsider approach. See .reviews/R4.md")).toBe(
			"RETHINK",
		);
		expect(
			normalizeReviewDisposition("UNAVAILABLE — reviewer exited (code 1) but produced no output."),
		).toBe("UNAVAILABLE");
		expect(normalizeReviewDisposition("REFUSED: Step 3 is already marked Complete.")).toBe("REFUSED");
	});

	it("is case-insensitive and tolerant of leading whitespace", () => {
		expect(normalizeReviewDisposition("  approve ")).toBe("APPROVE");
		expect(normalizeReviewDisposition("revise: things")).toBe("REVISE");
	});

	it("does not misread negated approvals as APPROVE (Sage review hardening)", () => {
		expect(normalizeReviewDisposition("The reviewer said: do not approve, please revise")).toBe(
			"REVISE",
		);
		// Word-boundary + negation guards: none of these are a clean APPROVE.
		expect(normalizeReviewDisposition("not approved")).toBe("UNKNOWN");
		expect(normalizeReviewDisposition("disapprove")).toBe("UNKNOWN");
		expect(normalizeReviewDisposition("do not approve")).toBe("UNKNOWN");
	});

	it("prefers the broken/refused signals over verdict words quoted in the body", () => {
		// A REFUSED/UNAVAILABLE body may quote 'revise'; the specific signal wins.
		expect(normalizeReviewDisposition("REFUSED: revert then re-review (do not revise yet)")).toBe(
			"REFUSED",
		);
		expect(normalizeReviewDisposition("UNAVAILABLE — reviewer crashed before it could revise")).toBe(
			"UNAVAILABLE",
		);
	});

	it("returns UNKNOWN for empty/nullish/unparseable input", () => {
		expect(normalizeReviewDisposition("")).toBe("UNKNOWN");
		expect(normalizeReviewDisposition("   ")).toBe("UNKNOWN");
		expect(normalizeReviewDisposition(null)).toBe("UNKNOWN");
		expect(normalizeReviewDisposition(undefined)).toBe("UNKNOWN");
		expect(normalizeReviewDisposition("something totally unrelated")).toBe("UNKNOWN");
	});
});

describe("review-boundary — formatEventNotification", () => {
	it("review_started names the type, task, step, and lane", () => {
		const text = formatEventNotification(
			ev({ type: "review_started", taskId: "TP-9", reviewStep: 3, reviewType: "code", laneNumber: 2 }),
			"autonomous",
		);
		expect(text).toContain("Review starting");
		expect(text).toContain("code");
		expect(text).toContain("task TP-9");
		expect(text).toContain("step 3");
		expect(text).toContain("lane 2");
	});

	it("review_completed APPROVE reads as clean approval", () => {
		const text = formatEventNotification(
			ev({ type: "review_completed", taskId: "TP-9", reviewStep: 3, disposition: "APPROVE" }),
			"autonomous",
		);
		expect(text).toContain("APPROVE");
		expect(text).toContain("✅");
	});

	it("review_completed REVISE flags watch-for-repeated-revisions", () => {
		const text = formatEventNotification(
			ev({ type: "review_completed", taskId: "TP-9", reviewStep: 3, disposition: "REVISE" }),
			"autonomous",
		);
		expect(text).toContain("REVISE");
		expect(text.toLowerCase()).toContain("revision");
	});

	it("review_completed surfaces the adjudication signals (round, counts, trend)", () => {
		const text = formatEventNotification(
			ev({
				type: "review_completed",
				taskId: "TP-9",
				reviewStep: 4,
				disposition: "REVISE",
				reviewRound: 5,
				findingCounts: { critical: 1, minor: 3 },
				findingTrend: "dropping",
				findingMixed: true,
			}),
			"autonomous",
		);
		expect(text).toContain("round 5");
		expect(text).toContain("critical:1");
		expect(text).toContain("minor:3");
		expect(text).toContain("trend dropping");
		expect(text).toContain("(mixed)");
	});

	it("review_completed REFUSED explains the death-spiral-guard refusal", () => {
		const text = formatEventNotification(
			ev({ type: "review_completed", taskId: "TP-9", reviewStep: 3, disposition: "REFUSED" }),
			"autonomous",
		);
		expect(text).toContain("REFUSED");
		expect(text.toLowerCase()).toContain("revert");
	});

	it("review_failed frames it as a broken reviewer, not a spiral", () => {
		const text = formatEventNotification(
			ev({ type: "review_failed", taskId: "TP-9", reviewStep: 3, disposition: "UNAVAILABLE" }),
			"autonomous",
		);
		expect(text.toLowerCase()).toContain("reviewer unavailable");
		expect(text.toLowerCase()).toContain("not a revision spiral");
	});
});

describe("review-boundary — #624 tool-result extraction + verdict authority", () => {
	it("extractToolResultText handles structured content arrays (not just strings)", () => {
		// Pi delivers review_step results as content blocks; the old extraction
		// produced "" for these, making every verdict look UNKNOWN → review_failed.
		const structured = {
			result: [
				{
					type: "text",
					text: "REVISE: fix the null check\n\nFull review: .reviews/R005-code-step1.md",
				},
			],
		};
		const text = extractToolResultText(structured);
		expect(text).toContain("REVISE:");
		expect(normalizeReviewDisposition(text)).toBe("REVISE");
	});

	it("extractToolResultText handles {content:[...]} objects and plain strings + string fallback", () => {
		expect(extractToolResultText({ result: "APPROVE" })).toBe("APPROVE");
		expect(extractToolResultText({ result: { content: [{ type: "text", text: "APPROVE" }] } })).toBe(
			"APPROVE",
		);
		expect(extractToolResultText({ output: "RETHINK — reconsider" })).toContain("RETHINK");
		expect(extractToolResultText({ result: undefined, output: undefined })).toBe("");
	});

	it("agent-host only buckets a genuine UNAVAILABLE into review_failed (UNKNOWN is NOT a broken reviewer)", () => {
		const src = readSrc("agent-host.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain("extractToolResultText(event)");
		// The fix: UNKNOWN must no longer route to review_failed.
		expect(flat).toContain('if (disposition === "UNAVAILABLE") { emitEvent("review_failed"');
		expect(flat).not.toContain('disposition === "UNAVAILABLE" || disposition === "UNKNOWN"');
	});

	it("review_step tool (worker-facing gate) uses the robust parser and NEVER fail-opens to APPROVE", () => {
		// #624 severity upgrade: the old tool-side parse used a brittle regex and
		// an approve-FIRST substring fallback — REVISE reviews whose body contained
		// 'approve' were returned to the worker as APPROVE, so workers marked steps
		// complete past unaddressed findings. The gate must fail CLOSED.
		const src = readSrc("agent-bridge-extension.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain("parseReviewVerdict(reviewContent)");
		// The approve-biased fallback must be gone from the verdict path.
		expect(flat).not.toContain('lower.includes("approve")');
		// Only fail-closed body guesses remain (REVISE / RETHINK), no approve guess.
		expect(flat).toContain("NO approve fallback");
		// The unclear-verdict return must warn the worker not to self-approve.
		expect(flat).toContain("do NOT treat this as an approval");
	});

	it("#626 minimal: lane-runner refuses .DONE over an outstanding REVISE/RETHINK", () => {
		const src = readSrc("lane-runner.ts");
		const flat = src.replace(/\s+/g, " ");
		// The finalize gate scans the LATEST review per gate and blocks on
		// REVISE/RETHINK, deleting any worker-written .DONE and failing the task
		// instead of letting the wave merge unreviewed work (TP-2037/TP-2039).
		expect(flat).toContain("latestReviewFilesPerGate(readdirSync(reviewsDir))");
		expect(flat).toContain('verdict === "REVISE" || verdict === "RETHINK"');
		expect(flat).toContain("blockingGates");
		// #627 Stage 2a: the kind branches — a bad ratified APPROVE is
		// "invalid-ratification", an outstanding non-APPROVE is "unresolved-verdict".
		expect(flat).toContain('"unresolved-verdict"');
		expect(flat).toContain('"invalid-ratification"');
		// The refusal must precede .DONE creation.
		const gateIdx = src.indexOf("#626 minimal finalize gate");
		const doneIdx = src.indexOf("Create .DONE if not already present");
		expect(gateIdx).toBeGreaterThan(-1);
		expect(doneIdx).toBeGreaterThan(gateIdx);
	});

	it("#628: dirty-refusal is surfaced to the cleanup gate, not treated as success (Sage blocker)", () => {
		// removeWorktree's refusal path does NOT throw — callers must check the
		// result. Both reset-failure cleanup paths track a refused worktree in
		// failedRemovalWorktrees and must never force-clean it (that would destroy
		// the uncommitted work the refusal is protecting).
		for (const f of ["engine.ts", "resume.ts"]) {
			const src = readSrc(f);
			const flat = src.replace(/\s+/g, " ");
			expect(flat).toContain("rm.refusedDirty");
			expect(flat).toContain("worktree removal REFUSED for lane");
		}
		// The refusal branch must feed failedRemovalWorktrees in both files.
		const engine = readSrc("engine.ts").replace(/\s+/g, " ");
		const engineRefusal = engine.slice(engine.indexOf("rm.refusedDirty"));
		expect(engineRefusal.slice(0, 900)).toContain("failedRemovalWorktrees");
	});

	it("#625: log_recovery_action tool is registered and the bash-append instruction is gone", () => {
		const ext = readSrc("extension.ts");
		const extFlat = ext.replace(/\s+/g, " ");
		expect(extFlat).toContain('name: "log_recovery_action"');
		expect(extFlat).toContain("logRecoveryAction(stateRoot, batchId");
		const sup = readSrc("supervisor.ts");
		// The system prompt must direct the supervisor to the tool and must no
		// longer contain the echo-append example that caused fabricated timestamps.
		expect(sup).toContain("log_recovery_action");
		// Avoid a literal ${...} in the assertion string (noTemplateCurlyInString):
		// match the echo-append fragment via regex instead.
		expect(sup).not.toMatch(/' >> \$\{actionsPath\}/);
		expect(sup).toContain("NEVER hand-write");
	});

	it("lane-runner treats the review file's verdict as authoritative and classifies accordingly", () => {
		const src = readSrc("lane-runner.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain("parseReviewVerdict(reviewMd)");
		expect(flat).toContain("const disposition = fileVerdict ?? payloadDisposition");
		// review_failed only when there is genuinely no verdict anywhere.
		expect(flat).toContain(
			'disposition === "UNAVAILABLE" || disposition === "UNKNOWN" || disposition === undefined ? "review_failed" : "review_completed"',
		);
	});
});

describe("review-boundary — wiring", () => {
	it("agent-host emits review_requested at review_step start", () => {
		const src = readSrc("agent-host.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain('if (toolName === "review_step")');
		expect(flat).toContain('emitEvent("review_requested"');
	});

	it("agent-host emits review_completed / review_failed at review_step end with a normalized disposition", () => {
		const src = readSrc("agent-host.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain('if (event.toolName === "review_step")');
		expect(flat).toContain("normalizeReviewDisposition(fullResult)");
		expect(flat).toContain('emitEvent("review_completed"');
		expect(flat).toContain('emitEvent("review_failed"');
		// #624: only a GENUINE UNAVAILABLE routes to review_failed here; UNKNOWN
		// (a parse miss) does not — lane-runner resolves the verdict from the file.
		expect(flat).toContain('if (disposition === "UNAVAILABLE") { emitEvent("review_failed"');
		// End events carry step + reviewType (from the pendingReview slot) so the
		// supervisor can key adjudication + Stage-3 spiral counts on (task, step).
		expect(flat).toContain("pendingReview = { step: stepNum, reviewType: rType }");
		expect(flat).toContain("step: pendingReview?.step");
		expect(flat).toContain("reviewType: pendingReview?.reviewType");
	});

	it("agent-host closes a dangling review_started if the worker dies mid-review", () => {
		const src = readSrc("agent-host.ts");
		const flat = src.replace(/\s+/g, " ");
		// On the terminal exit path, a still-pending review emits review_failed
		// (aborted) so the supervisor never sees an orphaned 'review starting'.
		expect(flat).toContain("if (pendingReview) {");
		// Avoid a literal ${...} in this assertion string (biome noTemplateCurlyInString);
		// match the stable prefix + the interpolated identifier separately.
		expect(flat).toContain("summary: `review aborted (");
		expect(flat).toMatch(/review aborted \(\$\{exitEventType\}\)/);
	});

	it("lane-runner bridges review_* runtime events to the supervisor events stream", () => {
		const src = readSrc("lane-runner.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain("const bridgeReviewEvent");
		expect(flat).toContain('"review_requested"');
		// Emits an EngineEvent via emitEngineEvent, loaded lazily to avoid a
		// lane-runner → persistence → execution → lane-runner import cycle.
		expect(flat).toContain("cachedEmitEngineEvent = m.emitEngineEvent");
		expect(flat).toContain('import("./persistence.ts")');
		expect(flat).toContain("fn(config.stateRoot, engineEvent)");
		// The bridge is actually wired into the worker spawn (not dead code).
		expect(flat).toContain("spawnAgent(hostOpts, bridgeReviewEvent");
		// review_requested maps to the engine-side review_started lifecycle event.
		expect(flat).toContain('"review_started"');
	});

	it("lane-runner runs spiral detection: advances the streak, gates, and escalates", () => {
		const src = readSrc("lane-runner.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain("advanceReviewStreak(state,");
		expect(flat).toContain("shouldFireSpiral(state, spiralCfg");
		expect(flat).toContain("shouldFireOrderViolation(state, spiralCfg)");
		expect(flat).toContain('category: "review-intervention-needed"');
		// REFUSED is order-violation, not spiral (kept out of the REVISE/RETHINK streak).
		expect(flat).toContain('fireIntervention("order-violation"');
		expect(flat).toContain('fireIntervention("revision-spiral"');
	});

	it("lane-runner reconstructs per-step state from history on resume", () => {
		const src = readSrc("lane-runner.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain("seedReviewStateFromHistory(");
		expect(flat).toContain("reconstructReviewStreaks(events");
	});

	it("extension.ts delivers review-intervention escalations via steer (routine stays followUp)", () => {
		const src = readSrc("extension.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain('alert.category === "review-intervention-needed" ? "steer" : "followUp"');
	});

	it("config ships a generic severity vocab + spiral defaults (threshold 3)", () => {
		const src = readSrc("config-schema.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain('severityLabels: ["critical", "important", "minor"]');
		expect(flat).toContain("threshold: 3");
		expect(flat).toContain("treatUnavailableAsNonApprove: false");
	});

	it("the review event types are registered SIGNIFICANT (surfaced every boundary)", () => {
		const src = readSrc("supervisor.ts");
		const sigStart = src.indexOf("const SIGNIFICANT_EVENT_TYPES");
		assert.ok(sigStart > -1);
		const sigBlock = src.slice(sigStart, src.indexOf("]);", sigStart));
		expect(sigBlock).toContain('"review_started"');
		expect(sigBlock).toContain('"review_completed"');
		expect(sigBlock).toContain('"review_failed"');
	});
});
