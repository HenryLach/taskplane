/**
 * Batch-end epilogue gate tests — issue #621.
 *
 * The supervisor batch-end epilogue appends display banners via
 * pi.sendMessage(..., {triggerTurn:false}), which immediately splices a custom
 * entry into the session tree. If the interactive agent has a tool call in
 * flight, that splice lands between an assistant tool_use and its tool_result
 * and produces an Anthropic 400 that wedges the session. SupervisorNoticeGate
 * runs the epilogue immediately when idle, else defers it to the next
 * agent_settled boundary.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/supervisor-dispatch.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { SupervisorNoticeGate } from "../taskplane/supervisor-dispatch.ts";

describe("#621 — SupervisorNoticeGate", () => {
	it("runs the epilogue immediately when idle (no defer)", () => {
		const gate = new SupervisorNoticeGate();
		let runs = 0;
		gate.runOrDefer(true, 1, () => {
			runs++;
		});
		expect(runs).toBe(1);
		expect(gate.hasPending()).toBe(false);
	});

	it("defers the epilogue when busy (does not run, marks pending)", () => {
		const gate = new SupervisorNoticeGate();
		let runs = 0;
		gate.runOrDefer(false, 1, () => {
			runs++;
		});
		expect(runs).toBe(0);
		expect(gate.hasPending()).toBe(true);
	});

	it("flushes a deferred epilogue on settle when idle", () => {
		const gate = new SupervisorNoticeGate();
		let runs = 0;
		gate.runOrDefer(false, 1, () => {
			runs++;
		});
		gate.onSettled(true, 1);
		expect(runs).toBe(1);
		expect(gate.hasPending()).toBe(false);
	});

	it("does not flush on settle when still busy (another run started)", () => {
		const gate = new SupervisorNoticeGate();
		let runs = 0;
		gate.runOrDefer(false, 1, () => {
			runs++;
		});
		gate.onSettled(false, 1);
		expect(runs).toBe(0);
		expect(gate.hasPending()).toBe(true);
	});

	it("drops a deferred epilogue whose generation was superseded", () => {
		const gate = new SupervisorNoticeGate();
		let runs = 0;
		gate.runOrDefer(false, 1, () => {
			runs++;
		});
		// A newer batch settled — generation no longer matches.
		gate.onSettled(true, 2);
		expect(runs).toBe(0);
		expect(gate.hasPending()).toBe(false);
	});

	it("invalidate() drops pending work (newer batch supersedes)", () => {
		const gate = new SupervisorNoticeGate();
		let runs = 0;
		gate.runOrDefer(false, 1, () => {
			runs++;
		});
		gate.invalidate();
		expect(gate.hasPending()).toBe(false);
		gate.onSettled(true, 1);
		expect(runs).toBe(0);
	});

	it("coalesces multiple deferrals — only the latest epilogue flushes", () => {
		const gate = new SupervisorNoticeGate();
		const order: string[] = [];
		gate.runOrDefer(false, 1, () => order.push("first"));
		gate.runOrDefer(false, 1, () => order.push("second"));
		gate.onSettled(true, 1);
		expect(order).toEqual(["second"]);
	});

	it("dispose() disables the gate: no immediate run, no defer, no flush", () => {
		const gate = new SupervisorNoticeGate();
		let runs = 0;
		gate.dispose();
		gate.runOrDefer(true, 1, () => {
			runs++;
		});
		expect(runs).toBe(0);
		expect(gate.hasPending()).toBe(false);
		// A pending item captured before dispose must not flush afterwards.
		const gate2 = new SupervisorNoticeGate();
		gate2.runOrDefer(false, 1, () => {
			runs++;
		});
		gate2.dispose();
		gate2.onSettled(true, 1);
		expect(runs).toBe(0);
	});

	it("only flushes once — a second settle does not re-run", () => {
		const gate = new SupervisorNoticeGate();
		let runs = 0;
		gate.runOrDefer(false, 1, () => {
			runs++;
		});
		gate.onSettled(true, 1);
		gate.onSettled(true, 1);
		expect(runs).toBe(1);
	});

	// ── Sage #621 review: /orch-resume supersession contract ───────────────────
	//
	// doOrchStart bumps batchGeneration + calls noticeGate.invalidate() on
	// (re)start. doOrchResume must do the SAME. Without it, an epilogue deferred
	// mid-tool by the prior batch survives into the resumed run and fires against
	// it. These two tests model the extension wiring (a shared generation counter
	// + the gate) to demonstrate the failure mode and lock in the fix.

	it("FAILURE MODE: resume that does NOT invalidate fires the prior batch's stale epilogue", () => {
		const gate = new SupervisorNoticeGate();
		let batchGeneration = 1; // batch A running
		let staleRuns = 0;
		// Batch A ends mid-tool (agent busy) -> defer epilogue at gen 1.
		gate.runOrDefer(false, batchGeneration, () => staleRuns++);
		// BUGGY resume: resets state but forgets to bump generation / invalidate.
		// batchGeneration stays 1; gate still holds the stale pending epilogue.
		expect(gate.hasPending()).toBe(true);
		// Agent settles; settle reads the (un-bumped) current generation.
		gate.onSettled(true, batchGeneration);
		expect(staleRuns).toBe(1); // <-- the #621 /orch-resume bug: stale epilogue fired
	});

	it("FIXED: resume that bumps generation + invalidates drops the stale epilogue", () => {
		const gate = new SupervisorNoticeGate();
		let batchGeneration = 1; // batch A running
		let staleRuns = 0;
		// Batch A ends mid-tool -> defer epilogue at gen 1.
		gate.runOrDefer(false, batchGeneration, () => staleRuns++);
		// FIXED resume mirrors doOrchStart: bump generation + invalidate the gate.
		batchGeneration++; // -> 2
		gate.invalidate();
		expect(gate.hasPending()).toBe(false); // stale epilogue dropped immediately
		// Agent settles at the new generation; nothing stale remains.
		gate.onSettled(true, batchGeneration);
		expect(staleRuns).toBe(0);
	});
});
