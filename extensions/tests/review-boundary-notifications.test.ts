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
import { normalizeReviewDisposition } from "../taskplane/agent-host.ts";
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
		// UNAVAILABLE / UNKNOWN route to review_failed (the broken-reviewer signal).
		expect(flat).toMatch(/disposition === "UNAVAILABLE" \|\| disposition === "UNKNOWN"/);
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
