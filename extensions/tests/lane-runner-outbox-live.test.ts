/**
 * Mail-recognition fix — live worker-outbox surfacing during a running worker.
 *
 * Worker reply/escalate mail (notify_supervisor / escalate_to_supervisor →
 * *.msg.json) must reach the supervisor WHILE the worker is still running (e.g.
 * a worker asking for help to break a review spiral). Previously lane-runner
 * only read the outbox AFTER the worker subprocess exited, so mid-run mail sat
 * unread until exit and the supervisor "woke up" too late.
 *
 * The fix runs a `drainAndSurfaceOutbox` helper on a live timer during the
 * worker await (mirroring the existing reviewerRefresh interval) and once more
 * after exit as a final drain. Acking each surfaced message dedupes the live
 * timer against the post-exit drain.
 *
 * These are source-assertion tests (lane-runner's executeWorker spawns real
 * subprocesses and has no unit harness — same convention as
 * lane-runner-spawn-wiring.test.ts). The ack→no-reread dedup invariant that
 * makes double-surfacing impossible is separately covered behaviorally by
 * mailbox-v2.test.ts §1.6.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/lane-runner-outbox-live.test.ts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const laneRunnerSrc = readFileSync(
	join(__dirname, "..", "taskplane", "lane-runner.ts"),
	"utf-8",
).replace(/\r\n/g, "\n");

describe("mail-recognition — lane-runner live outbox surfacing", () => {
	it("defines a reusable drainAndSurfaceOutbox helper", () => {
		assert.match(
			laneRunnerSrc,
			/const\s+drainAndSurfaceOutbox\s*=\s*\(\)\s*:\s*void\s*=>/,
			"lane-runner.ts must define drainAndSurfaceOutbox for live + final outbox surfacing",
		);
	});

	it("the helper reads the outbox, surfaces agent-message alerts, and acks each message", () => {
		const fnStart = laneRunnerSrc.indexOf("const drainAndSurfaceOutbox");
		assert.ok(fnStart > -1, "drainAndSurfaceOutbox must exist");
		// Bound the helper body generously; it ends before the '── 1. Ensure STATUS.md' marker.
		const fnEnd = laneRunnerSrc.indexOf("Ensure STATUS.md exists", fnStart);
		const body = laneRunnerSrc.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 3000);
		assert.match(body, /readOutbox\(config\.stateRoot, config\.batchId, workerAgentId\)/);
		assert.match(body, /category:\s*"agent-message"/);
		assert.match(
			body,
			/ackOutboxMessage\(config\.stateRoot, config\.batchId, workerAgentId, msg\.id\)/,
			"each surfaced message must be acked so live + final drains never double-surface",
		);
	});

	it("is re-entrancy guarded so a slow cycle can't overlap the next tick", () => {
		const fnStart = laneRunnerSrc.indexOf("const drainAndSurfaceOutbox");
		const body = laneRunnerSrc.slice(fnStart, fnStart + 3000);
		assert.match(body, /if\s*\(outboxDraining\)\s*return;/);
		assert.match(body, /outboxDraining\s*=\s*true;/);
		assert.match(body, /outboxDraining\s*=\s*false;/);
	});

	it("runs the drain on a live timer during the worker await and clears it in finally", () => {
		// Flatten whitespace so multi-line formatting doesn't matter.
		const flat = laneRunnerSrc.replace(/\s+/g, " ");
		assert.match(
			flat,
			/setInterval\(drainAndSurfaceOutbox, OUTBOX_LIVE_POLL_INTERVAL_MS\)/,
			"a live poll timer must run drainAndSurfaceOutbox during the worker run",
		);
		// The interval must be cleared alongside reviewerRefresh in the await's finally.
		assert.match(
			flat,
			/clearInterval\(outboxLivePoll\)/,
			"the live poll timer must be cleared in finally",
		);
	});

	it("does a final drain after the worker exits (catches last stragglers)", () => {
		// After the await/finally, a bare drainAndSurfaceOutbox() call surfaces
		// any mail written between the last live tick and exit.
		assert.match(
			laneRunnerSrc,
			/final outbox drain[\s\S]{0,400}drainAndSurfaceOutbox\(\);/,
			"a final drainAndSurfaceOutbox() must run after the worker exits",
		);
	});

	it("defines the live poll interval constant", () => {
		assert.match(laneRunnerSrc, /const OUTBOX_LIVE_POLL_INTERVAL_MS\s*=\s*3_000;/);
	});
});
