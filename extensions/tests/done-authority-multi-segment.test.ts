/**
 * TP-196 / #462: Multi-segment `.DONE` authority guards.
 *
 * Three defense-in-depth guards harden the `.DONE` authority model against
 * stale or premature markers in multi-segment tasks:
 *
 *  1. Monitor guard (`resolveTaskMonitorState`) — when the active segment is
 *     known to be NOT the final segment, `.DONE` is logged as suspicious and
 *     demoted (Priority 1 is skipped, task stays non-terminal).
 *  2. Resume guard (`collectDoneTaskIdsForResume`) — when `.DONE` exists but
 *     the persisted segment frontier is incomplete, the task is NOT added
 *     to the done set, so it will re-execute on resume.
 *  3. Discovery safeguard (`checkDoneAuthoritySafeguard`) — when `.DONE`
 *     coexists with unchecked STATUS.md checkboxes, emit a doctor-style
 *     warning (no behaviour change to discovery itself).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect } from "./expect.ts";
import { resolveTaskMonitorState } from "../taskplane/execution.ts";
import { collectDoneTaskIdsForResume } from "../taskplane/resume.ts";
import { checkDoneAuthoritySafeguard } from "../taskplane/discovery.ts";
import type {
	MtimeTracker,
	PersistedBatchState,
	PersistedSegmentRecord,
} from "../taskplane/types.ts";

// ── Helpers ─────────────────────────────────────────────────────────

function makeTracker(taskId: string, now: number): MtimeTracker {
	return {
		taskId,
		firstObservedAt: now,
		statusFileSeenOnce: false,
		lastMtime: null,
		stallTimerStart: null,
	};
}

function makeSegmentRecord(
	taskId: string,
	repoId: string,
	status: PersistedSegmentRecord["status"],
): PersistedSegmentRecord {
	return {
		segmentId: `${taskId}::${repoId}`,
		taskId,
		repoId,
		status,
		laneId: "lane-1",
		sessionName: "lane-1",
		worktreePath: "",
		branch: "",
		startedAt: null,
		endedAt: null,
		retries: 0,
		dependsOnSegmentIds: [],
		exitReason: "",
	};
}

// ── 1. Monitor guard ────────────────────────────────────────────────

describe("1.x: resolveTaskMonitorState — .DONE monitor guard (#462)", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = join(tmpdir(), `tp196-monitor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpRoot, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("1.1: accepts .DONE as authoritative when no multiSegmentContext is given (legacy)", async () => {
		const donePath = join(tmpRoot, ".DONE");
		writeFileSync(donePath, "");
		const now = Date.now();
		const tracker = makeTracker("TP-X", now);
		const snapshot = await resolveTaskMonitorState(
			"TP-X",
			donePath,
			"lane-1",
			{ parsed: null, error: null },
			tracker,
			60_000,
			now,
		);
		expect(snapshot.status).toBe("succeeded");
		expect(snapshot.doneFileFound).toBe(true);
	});

	it("1.2: accepts .DONE when multiSegmentContext.isFinalSegment === true", async () => {
		const donePath = join(tmpRoot, ".DONE");
		writeFileSync(donePath, "");
		const now = Date.now();
		const tracker = makeTracker("TP-X", now);
		const snapshot = await resolveTaskMonitorState(
			"TP-X",
			donePath,
			"lane-1",
			{ parsed: null, error: null },
			tracker,
			60_000,
			now,
			undefined,
			undefined,
			{ isFinalSegment: true, segmentId: "TP-X::api" },
		);
		expect(snapshot.status).toBe("succeeded");
		expect(snapshot.doneFileFound).toBe(true);
	});

	it("1.3: rejects .DONE as authoritative when isFinalSegment === false", async () => {
		const donePath = join(tmpRoot, ".DONE");
		writeFileSync(donePath, "");
		const now = Date.now();
		const tracker = makeTracker("TP-X", now);
		const snapshot = await resolveTaskMonitorState(
			"TP-X",
			donePath,
			"lane-1",
			{ parsed: null, error: null },
			tracker,
			60_000,
			now,
			undefined,
			undefined,
			{ isFinalSegment: false, segmentId: "TP-X::api" },
		);
		// `.DONE` was suspect — Priority 1 was skipped. We fall through to
		// Priority 3 (no v2Context provided → sessionAlive defaults to legacy
		// liveness check → false) and the task is marked "failed" instead of
		// "succeeded". The key invariant is that status is NOT "succeeded".
		expect(snapshot.status).not.toBe("succeeded");
	});

	it("1.4: no .DONE present — multiSegmentContext is irrelevant", async () => {
		const donePath = join(tmpRoot, ".DONE-absent");
		const now = Date.now();
		const tracker = makeTracker("TP-X", now);
		const snapshot = await resolveTaskMonitorState(
			"TP-X",
			donePath,
			"lane-1",
			{ parsed: null, error: null },
			tracker,
			60_000,
			now,
			undefined,
			undefined,
			{ isFinalSegment: false, segmentId: "TP-X::api" },
		);
		expect(snapshot.doneFileFound).toBe(false);
		expect(snapshot.status).not.toBe("succeeded");
	});
});

// ── 2. Resume guard ─────────────────────────────────────────────────

describe("2.x: collectDoneTaskIdsForResume — resume frontier guard (#462)", () => {
	let tmpRoot: string;
	let originalWarn: typeof console.warn;
	let warnings: string[];

	beforeEach(() => {
		tmpRoot = join(tmpdir(), `tp196-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpRoot, { recursive: true });
		warnings = [];
		originalWarn = console.warn;
		console.warn = (msg: string) => {
			warnings.push(typeof msg === "string" ? msg : String(msg));
		};
	});

	afterEach(() => {
		console.warn = originalWarn;
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	function writeDone(taskFolder: string): void {
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, ".DONE"), "");
	}

	function makeState(opts: {
		taskId: string;
		taskFolder: string;
		segments: PersistedSegmentRecord[];
	}): PersistedBatchState {
		return {
			batchId: "test-batch",
			phase: "executing",
			lanes: [],
			tasks: [
				{
					taskId: opts.taskId,
					taskFolder: opts.taskFolder,
					areaName: "test",
					promptPath: join(opts.taskFolder, "PROMPT.md"),
					status: "pending",
					attempts: 0,
				} as unknown as PersistedBatchState["tasks"][number],
			],
			waves: [],
			segments: opts.segments,
		} as unknown as PersistedBatchState;
	}

	it("2.1: includes task in done set when .DONE present and NO segments recorded (legacy)", () => {
		const folder = join(tmpRoot, "TP-A");
		writeDone(folder);
		const state = makeState({ taskId: "TP-A", taskFolder: folder, segments: [] });
		const result = collectDoneTaskIdsForResume(state, tmpRoot);
		expect(result.has("TP-A")).toBe(true);
		expect(warnings.length).toBe(0);
	});

	it("2.2: includes task in done set when .DONE present and ALL segments succeeded", () => {
		const folder = join(tmpRoot, "TP-B");
		writeDone(folder);
		const state = makeState({
			taskId: "TP-B",
			taskFolder: folder,
			segments: [
				makeSegmentRecord("TP-B", "api", "succeeded"),
				makeSegmentRecord("TP-B", "web", "succeeded"),
			],
		});
		const result = collectDoneTaskIdsForResume(state, tmpRoot);
		expect(result.has("TP-B")).toBe(true);
		expect(warnings.length).toBe(0);
	});

	it("2.3: EXCLUDES task from done set when .DONE present but segment frontier incomplete (#462 guard)", () => {
		const folder = join(tmpRoot, "TP-C");
		writeDone(folder);
		const state = makeState({
			taskId: "TP-C",
			taskFolder: folder,
			segments: [
				makeSegmentRecord("TP-C", "api", "succeeded"),
				makeSegmentRecord("TP-C", "web", "pending"),
			],
		});
		const result = collectDoneTaskIdsForResume(state, tmpRoot);
		expect(result.has("TP-C")).toBe(false);
		expect(warnings.length).toBeGreaterThanOrEqual(1);
		expect(warnings.some((w) => w.includes("TP-C") && w.includes("#462 guard"))).toBe(true);
	});

	it("2.4: EXCLUDES task when one segment failed", () => {
		const folder = join(tmpRoot, "TP-D");
		writeDone(folder);
		const state = makeState({
			taskId: "TP-D",
			taskFolder: folder,
			segments: [
				makeSegmentRecord("TP-D", "api", "succeeded"),
				makeSegmentRecord("TP-D", "web", "failed"),
			],
		});
		const result = collectDoneTaskIdsForResume(state, tmpRoot);
		expect(result.has("TP-D")).toBe(false);
	});

	it("2.5: INCLUDES task when remaining segments are 'skipped' (treated as terminal-success)", () => {
		const folder = join(tmpRoot, "TP-E");
		writeDone(folder);
		const state = makeState({
			taskId: "TP-E",
			taskFolder: folder,
			segments: [
				makeSegmentRecord("TP-E", "api", "succeeded"),
				makeSegmentRecord("TP-E", "web", "skipped"),
			],
		});
		const result = collectDoneTaskIdsForResume(state, tmpRoot);
		expect(result.has("TP-E")).toBe(true);
	});

	it("2.6: no .DONE marker — task is never added regardless of segment state", () => {
		const folder = join(tmpRoot, "TP-F");
		mkdirSync(folder, { recursive: true }); // no .DONE
		const state = makeState({
			taskId: "TP-F",
			taskFolder: folder,
			segments: [makeSegmentRecord("TP-F", "api", "succeeded")],
		});
		const result = collectDoneTaskIdsForResume(state, tmpRoot);
		expect(result.has("TP-F")).toBe(false);
		expect(warnings.length).toBe(0);
	});
});

// ── 3. Discovery safeguard ──────────────────────────────────────────

describe("3.x: checkDoneAuthoritySafeguard — discovery doctor warning (#462)", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = join(tmpdir(), `tp196-discovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tmpRoot, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("3.1: returns false when STATUS.md is absent", () => {
		const warnings: string[] = [];
		const result = checkDoneAuthoritySafeguard(tmpRoot, (msg) => warnings.push(msg));
		expect(result).toBe(false);
		expect(warnings.length).toBe(0);
	});

	it("3.2: returns false when STATUS.md has no unchecked checkboxes", () => {
		writeFileSync(
			join(tmpRoot, "STATUS.md"),
			"# Task — Status\n\n### Step 1\n- [x] done\n- [x] done\n",
		);
		const warnings: string[] = [];
		const result = checkDoneAuthoritySafeguard(tmpRoot, (msg) => warnings.push(msg));
		expect(result).toBe(false);
		expect(warnings.length).toBe(0);
	});

	it("3.3: returns true and warns when STATUS.md has unchecked checkboxes", () => {
		writeFileSync(
			join(tmpRoot, "STATUS.md"),
			"# Task — Status\n\n### Step 1\n- [x] done\n- [ ] not yet\n",
		);
		const warnings: string[] = [];
		const result = checkDoneAuthoritySafeguard(tmpRoot, (msg) => warnings.push(msg));
		expect(result).toBe(true);
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toContain("#462 safeguard");
		expect(warnings[0]).toContain(tmpRoot);
	});

	it("3.4: defaults logger to console.warn when not provided", () => {
		writeFileSync(join(tmpRoot, "STATUS.md"), "- [ ] foo\n");
		const orig = console.warn;
		const captured: string[] = [];
		console.warn = (msg: string) => captured.push(String(msg));
		try {
			const result = checkDoneAuthoritySafeguard(tmpRoot);
			expect(result).toBe(true);
			expect(captured.length).toBe(1);
		} finally {
			console.warn = orig;
		}
	});
});
