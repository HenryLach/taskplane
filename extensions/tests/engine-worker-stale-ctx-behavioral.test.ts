/**
 * #620 behavioral regression — engine-worker IPC handler survives a stale ctx.
 *
 * This drives the REAL `startBatchInWorker` with a mocked `child_process.fork`
 * (returning a controllable fake child) and a `ctx` whose `ui` getter throws
 * Pi's exact stale-context error — faithfully reproducing the crash condition
 * from the field report (headless `-p` run finalized while the forked engine
 * worker still emits IPC, or session replacement/reload mid-batch).
 *
 * Complements the wrapper unit tests (supervisor.test.ts 8.23-8.25) and the
 * source-assertion wiring tests (8.26-8.30) with an end-to-end behavioral
 * guarantee that the actual IPC handler:
 *   1. does NOT let a stale-ctx throw escape (no uncaughtException → no Pi crash),
 *   2. persists the failed batch state BEFORE the supervisor alert (the #620
 *      reorder: a dead UI sink must never block failure persistence/propagation),
 *   3. still fires the supervisor alert and marks the batch failed,
 *   4. survives a `notify` IPC with a stale ctx.ui too.
 *
 * `mock.module` MUST run before the consumer (`extension.ts`) is imported, so
 * this lives in its own file to keep the module-graph mocking isolated.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/engine-worker-stale-ctx-behavioral.test.ts
 */

import { describe, it, mock } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "./expect.ts";

// ── Fake child process ──────────────────────────────────────────────
// startBatchInWorker interacts with the child via: child.stderr?.on (nullable),
// child.send({type:"init",...}) (noop), child.on("message"|"error"|"exit"|"close").
class FakeChild extends EventEmitter {
	stderr = null;
	pid = 4242;
	send = (_msg: unknown) => true;
	kill = (_sig?: unknown) => true;
}

let lastFakeChild: FakeChild | null = null;
const realCP = await import("node:child_process");
const fakeFork = mock.fn(() => {
	lastFakeChild = new FakeChild();
	return lastFakeChild as unknown as import("node:child_process").ChildProcess;
});
// extension.ts imports from bare "child_process", which Node normalizes to the
// same builtin as "node:child_process" — mocking one intercepts both.
mock.module("node:child_process", { namedExports: { ...realCP, fork: fakeFork } });

// ── Mock saveBatchState to record call ORDER (no real disk write needed) ──
const realPersistence = await import("../taskplane/persistence.ts");
const callLog: string[] = [];
const saveBatchStateSpy = mock.fn((_json: string, _cwd: string) => {
	callLog.push("save");
});
mock.module("../taskplane/persistence.ts", {
	namedExports: { ...realPersistence, saveBatchState: saveBatchStateSpy },
});

// Import the consumer AFTER the mocks are registered.
const { startBatchInWorker } = await import("../taskplane/extension.ts");

const STALE_MSG = "This extension ctx is stale after session replacement or reload.";

function makeBatchState() {
	return {
		batchId: "tp620-batch",
		phase: "executing" as string,
		errors: [] as string[],
		totalTasks: 1,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		currentWaveIndex: 0,
		totalWaves: 1,
		taskLevelWaveCount: 1,
	};
}

describe("#620 behavioral — startBatchInWorker IPC handler survives a stale ctx", () => {
	it("B1: 'error' IPC with a stale-throwing ctx → no crash, state persisted BEFORE alert, batch failed", () => {
		const cwd = mkdtempSync(join(tmpdir(), "tp620-behavioral-"));
		try {
			callLog.length = 0;
			const staleErr = new Error(STALE_MSG);
			// Faithful to Pi: accessing ctx.ui / ctx.isIdle() throws assertActive.
			const ctx = {
				get ui(): never {
					throw staleErr;
				},
				isIdle: () => {
					throw staleErr;
				},
			} as never;
			const batchState = makeBatchState();
			const alertLog: Array<{ category: string }> = [];
			const onSupervisorAlert = (a: { category: string }) => {
				callLog.push("alert");
				alertLog.push(a);
			};
			const wkData = {
				mode: "execute",
				cwd,
				orchConfig: {},
				runnerConfig: {},
				args: "",
			} as never;

			let threw: unknown = null;
			try {
				startBatchInWorker(
					wkData,
					batchState as never,
					ctx,
					() => {}, // updateWidget noop (real updateOrchWidget guard covered by 8.27)
					undefined,
					undefined,
					onSupervisorAlert as never,
				);
				// The handler runs synchronously on emit.
				lastFakeChild?.emit("message", {
					type: "error",
					message: "boom",
					source: "engine",
					stack: "Error: boom\n  at engine",
				});
			} catch (e) {
				threw = e;
			}

			// (1) No uncaught throw escaped despite the stale ctx.ui inside the handler.
			expect(threw).toBe(null);
			// (2) Failed state was persisted, and BEFORE the supervisor alert (#620 reorder).
			expect(callLog).toContain("save");
			expect(callLog).toContain("alert");
			expect(callLog.indexOf("save")).toBeLessThan(callLog.indexOf("alert"));
			expect(saveBatchStateSpy.mock.callCount()).toBeGreaterThanOrEqual(1);
			// (3) Batch marked failed and the supervisor alert fired.
			expect(batchState.phase).toBe("failed");
			expect(alertLog).toHaveLength(1);
			expect(alertLog[0].category).toBe("task-failure");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("B2: 'notify' IPC with a stale-throwing ctx.ui → no crash (UI sink no-ops)", () => {
		const cwd = mkdtempSync(join(tmpdir(), "tp620-behavioral-notify-"));
		try {
			const staleErr = new Error(STALE_MSG);
			const ctx = {
				get ui(): never {
					throw staleErr;
				},
				isIdle: () => true,
			} as never;
			const batchState = makeBatchState();
			const wkData = {
				mode: "execute",
				cwd,
				orchConfig: {},
				runnerConfig: {},
				args: "",
			} as never;

			let threw: unknown = null;
			try {
				startBatchInWorker(wkData, batchState as never, ctx, () => {});
				lastFakeChild?.emit("message", {
					type: "notify",
					msg: "hello from engine",
					level: "info",
				});
			} catch (e) {
				threw = e;
			}
			expect(threw).toBe(null);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
