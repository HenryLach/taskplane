/**
 * Diagnostic Reports Tests — TP-031 Step 4
 *
 * Tests for:
 *   1. buildDiagnosticEvents — deterministic ordering, taskExits fallback, repo attribution
 *   2. eventsToJsonl — JSONL format
 *   3. buildMarkdownReport — batch overview, per-task table, workspace breakdown, empty data
 *   4. emitDiagnosticReports — non-fatal write failures
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/diagnostic-reports.test.ts
 */

import { describe, it, mock, afterEach } from "node:test";
import { expect } from "./expect.ts";

// ── fs mocking for emitDiagnosticReports tests ──────────────────────
// We must mock 'fs' BEFORE any module that imports it is loaded.
// Because ESM static imports execute before module body, we use top-level
// await to set up mock.module() first, then dynamically import everything.

const origFs = await import("node:fs");
const mockExistsSync = mock.fn(origFs.existsSync);
const mockMkdirSync = mock.fn(origFs.mkdirSync);
const mockWriteFileSync = mock.fn(origFs.writeFileSync);

mock.module("fs", {
	namedExports: {
		...origFs,
		existsSync: mockExistsSync,
		mkdirSync: mockMkdirSync,
		writeFileSync: mockWriteFileSync,
	},
});

// Dynamic imports so the module-under-test picks up the mocked 'fs'.
// These MUST be after mock.module() to intercept the module's 'fs' import.
const {
	buildDiagnosticEvents,
	eventsToJsonl,
	buildMarkdownReport,
	emitDiagnosticReports,
} = await import("../taskplane/diagnostic-reports.ts");
type DiagnosticReportInput = import("../taskplane/diagnostic-reports.ts").DiagnosticReportInput;
type DiagnosticEvent = import("../taskplane/diagnostic-reports.ts").DiagnosticEvent;

const { defaultBatchDiagnostics } = await import("../taskplane/types.ts");
type PersistedTaskRecord = import("../taskplane/types.ts").PersistedTaskRecord;
type OrchestratorConfig = import("../taskplane/types.ts").OrchestratorConfig;

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal PersistedTaskRecord with overrides. */
function makeTask(taskId: string, overrides: Partial<PersistedTaskRecord> = {}): PersistedTaskRecord {
	return {
		taskId,
		laneNumber: 1,
		sessionName: `lane-${taskId}`,
		status: "succeeded",
		taskFolder: `/tasks/${taskId}`,
		startedAt: 1710000000000,
		endedAt: 1710000060000,
		doneFileFound: true,
		exitReason: "completed normally",
		...overrides,
	};
}

/** Build a minimal DiagnosticReportInput with overrides. */
function makeInput(overrides: Partial<DiagnosticReportInput> = {}): DiagnosticReportInput {
	return {
		orchConfig: {
			orchestrator: {
				lanes: 2,
				session_prefix: "orch",
				worktree_prefix: "orch",
				integration: "manual",
			},
		} as OrchestratorConfig,
		batchId: "test-batch-001",
		phase: "completed",
		mode: "repo",
		startedAt: 1710000000000,
		endedAt: 1710000300000,    // 300 seconds
		tasks: [],
		diagnostics: defaultBatchDiagnostics(),
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		totalTasks: 0,
		stateRoot: "/tmp/test-state-root",
		...overrides,
	};
}

// ── 1. buildDiagnosticEvents ─────────────────────────────────────────

describe("buildDiagnosticEvents", () => {
	it("returns empty array for no tasks", () => {
		const input = makeInput({ tasks: [] });
		const events = buildDiagnosticEvents(input);
		expect(events).toEqual([]);
	});

	it("sorts events deterministically by taskId", () => {
		const input = makeInput({
			tasks: [
				makeTask("ZZ-003"),
				makeTask("AA-001"),
				makeTask("MM-002"),
			],
		});
		const events = buildDiagnosticEvents(input);
		expect(events.map(e => e.taskId)).toEqual(["AA-001", "MM-002", "ZZ-003"]);
	});

	it("uses taskExits as primary data source (precedence over exitDiagnostic)", () => {
		const input = makeInput({
			tasks: [
				makeTask("TP-001", {
					exitDiagnostic: { classification: "context_exhaustion" } as any,
				}),
			],
			diagnostics: {
				taskExits: {
					"TP-001": {
						classification: "completed",
						cost: 0.50,
						durationSec: 120,
						retries: 0,
					},
				},
				batchCost: 0.50,
			},
		});
		const events = buildDiagnosticEvents(input);
		expect(events[0].classification).toBe("completed");
		expect(events[0].cost).toBe(0.50);
		expect(events[0].durationSec).toBe(120);
	});

	it("falls back to exitDiagnostic.classification when taskExits entry missing", () => {
		const input = makeInput({
			tasks: [
				makeTask("TP-001", {
					exitDiagnostic: { classification: "api_error" } as any,
				}),
			],
			diagnostics: defaultBatchDiagnostics(), // empty taskExits
		});
		const events = buildDiagnosticEvents(input);
		expect(events[0].classification).toBe("api_error");
		expect(events[0].cost).toBe(0);  // no cost in exitDiagnostic
	});

	it("falls back to 'unknown' when both taskExits and exitDiagnostic missing", () => {
		const input = makeInput({
			tasks: [makeTask("TP-001")],
			diagnostics: defaultBatchDiagnostics(),
		});
		const events = buildDiagnosticEvents(input);
		expect(events[0].classification).toBe("unknown");
	});

	it("computes duration from timestamps when taskExits missing", () => {
		const input = makeInput({
			tasks: [
				makeTask("TP-001", {
					startedAt: 1710000000000,
					endedAt: 1710000090000,  // 90 seconds
				}),
			],
		});
		const events = buildDiagnosticEvents(input);
		expect(events[0].durationSec).toBe(90);
	});

	it("returns 0 duration when both taskExits and timestamps missing", () => {
		const input = makeInput({
			tasks: [
				makeTask("TP-001", {
					startedAt: null,
					endedAt: null,
				}),
			],
		});
		const events = buildDiagnosticEvents(input);
		expect(events[0].durationSec).toBe(0);
	});

	it("preserves repoId from task record (workspace mode)", () => {
		const input = makeInput({
			mode: "workspace",
			tasks: [
				makeTask("TP-001", {
					repoId: "frontend",
					resolvedRepoId: "frontend-resolved",
				}),
			],
		});
		const events = buildDiagnosticEvents(input);
		// resolvedRepoId takes precedence over repoId
		expect(events[0].repoId).toBe("frontend-resolved");
	});

	it("falls back to repoId when resolvedRepoId is undefined", () => {
		const input = makeInput({
			mode: "workspace",
			tasks: [
				makeTask("TP-001", {
					repoId: "frontend",
				}),
			],
		});
		const events = buildDiagnosticEvents(input);
		expect(events[0].repoId).toBe("frontend");
	});

	it("returns null repoId when both repo fields missing", () => {
		const input = makeInput({
			tasks: [makeTask("TP-001")],
		});
		const events = buildDiagnosticEvents(input);
		expect(events[0].repoId).toBeNull();
	});

	it("includes correct batchId and phase on each event", () => {
		const input = makeInput({
			batchId: "batch-42",
			phase: "paused",
			tasks: [makeTask("TP-001"), makeTask("TP-002")],
		});
		const events = buildDiagnosticEvents(input);
		for (const evt of events) {
			expect(evt.batchId).toBe("batch-42");
			expect(evt.phase).toBe("paused");
		}
	});

	it("includes retries from taskExits", () => {
		const input = makeInput({
			tasks: [makeTask("TP-001")],
			diagnostics: {
				taskExits: {
					"TP-001": {
						classification: "completed",
						cost: 0.10,
						durationSec: 30,
						retries: 3,
					},
				},
				batchCost: 0.10,
			},
		});
		const events = buildDiagnosticEvents(input);
		expect(events[0].retries).toBe(3);
	});

	it("defaults retries to 0 when not in taskExits", () => {
		const input = makeInput({
			tasks: [makeTask("TP-001")],
		});
		const events = buildDiagnosticEvents(input);
		expect(events[0].retries).toBe(0);
	});
});

// ── 2. eventsToJsonl ─────────────────────────────────────────────────

describe("eventsToJsonl", () => {
	it("produces one JSON line per event, ending with newline", () => {
		const events: DiagnosticEvent[] = [
			{
				batchId: "b1",
				phase: "completed",
				mode: "repo",
				taskId: "T-001",
				status: "succeeded",
				classification: "completed",
				cost: 0.5,
				durationSec: 60,
				retries: 0,
				repoId: null,
				exitReason: "done",
				startedAt: 1710000000000,
				endedAt: 1710000060000,
			},
			{
				batchId: "b1",
				phase: "completed",
				mode: "repo",
				taskId: "T-002",
				status: "failed",
				classification: "crash",
				cost: 0.3,
				durationSec: 30,
				retries: 1,
				repoId: null,
				exitReason: "segfault",
				startedAt: 1710000000000,
				endedAt: 1710000030000,
			},
		];

		const jsonl = eventsToJsonl(events);
		const lines = jsonl.split("\n");

		// Last line after trailing newline is empty
		expect(lines[lines.length - 1]).toBe("");
		// Two data lines
		expect(lines).toHaveLength(3); // 2 events + trailing newline

		// Each line parses as valid JSON
		const parsed0 = JSON.parse(lines[0]);
		expect(parsed0.taskId).toBe("T-001");
		expect(parsed0.classification).toBe("completed");

		const parsed1 = JSON.parse(lines[1]);
		expect(parsed1.taskId).toBe("T-002");
		expect(parsed1.classification).toBe("crash");
	});

	it("produces empty content for empty events", () => {
		const jsonl = eventsToJsonl([]);
		expect(jsonl).toBe("\n");
	});
});

// ── 3. buildMarkdownReport ───────────────────────────────────────────

describe("buildMarkdownReport", () => {
	it("includes batch overview table", () => {
		const input = makeInput({
			batchId: "batch-42",
			phase: "completed",
			mode: "repo",
			totalTasks: 3,
			succeededTasks: 2,
			failedTasks: 1,
			skippedTasks: 0,
			blockedTasks: 0,
			diagnostics: { taskExits: {}, batchCost: 1.25 },
		});
		const events = buildDiagnosticEvents(input);
		const report = buildMarkdownReport(input, events);

		expect(report).toContain("# Batch Diagnostic Report");
		expect(report).toContain("## Batch Overview");
		expect(report).toContain("`batch-42`");
		expect(report).toContain("completed");
		expect(report).toContain("$1.2500");
		expect(report).toContain("| Total Tasks | 3 |");
		expect(report).toContain("| Succeeded | 2 |");
		expect(report).toContain("| Failed | 1 |");
	});

	it("includes per-task results table", () => {
		const input = makeInput({
			tasks: [
				makeTask("TP-001", { status: "succeeded" }),
				makeTask("TP-002", { status: "failed", exitReason: "crash" }),
			],
			diagnostics: {
				taskExits: {
					"TP-001": { classification: "completed", cost: 0.10, durationSec: 60, retries: 0 },
					"TP-002": { classification: "crash", cost: 0.05, durationSec: 30, retries: 1 },
				},
				batchCost: 0.15,
			},
		});
		const events = buildDiagnosticEvents(input);
		const report = buildMarkdownReport(input, events);

		expect(report).toContain("## Per-Task Results");
		expect(report).toContain("| TP-001 | succeeded | completed | $0.1000 |");
		expect(report).toContain("| TP-002 | failed | crash | $0.0500 |");
	});

	it("shows empty message when no tasks", () => {
		const input = makeInput({ tasks: [] });
		const events = buildDiagnosticEvents(input);
		const report = buildMarkdownReport(input, events);

		expect(report).toContain("_No task records available._");
	});

	it("includes per-repo breakdown in workspace mode", () => {
		const input = makeInput({
			mode: "workspace",
			tasks: [
				makeTask("TP-001", { resolvedRepoId: "frontend", status: "succeeded" }),
				makeTask("TP-002", { resolvedRepoId: "frontend", status: "failed" }),
				makeTask("TP-003", { resolvedRepoId: "backend", status: "succeeded" }),
			],
			diagnostics: {
				taskExits: {
					"TP-001": { classification: "completed", cost: 0.10, durationSec: 60 },
					"TP-002": { classification: "crash", cost: 0.05, durationSec: 30 },
					"TP-003": { classification: "completed", cost: 0.20, durationSec: 90 },
				},
				batchCost: 0.35,
			},
		});
		const events = buildDiagnosticEvents(input);
		const report = buildMarkdownReport(input, events);

		expect(report).toContain("## Per-Repo Breakdown");
		expect(report).toContain("### backend");
		expect(report).toContain("### frontend");
		// frontend has 2 tasks (1 succeeded, 1 failed)
		expect(report).toContain("Tasks: 2 (1 succeeded, 1 failed)");
		// backend has 1 task (1 succeeded, 0 failed)
		expect(report).toContain("Tasks: 1 (1 succeeded, 0 failed)");
	});

	it("does NOT include per-repo breakdown in repo mode", () => {
		const input = makeInput({
			mode: "repo",
			tasks: [makeTask("TP-001")],
		});
		const events = buildDiagnosticEvents(input);
		const report = buildMarkdownReport(input, events);

		expect(report).not.toContain("## Per-Repo Breakdown");
	});

	it("groups unresolved repos under '(unresolved)' in workspace mode", () => {
		const input = makeInput({
			mode: "workspace",
			tasks: [
				makeTask("TP-001"), // no repoId or resolvedRepoId
			],
		});
		const events = buildDiagnosticEvents(input);
		const report = buildMarkdownReport(input, events);

		expect(report).toContain("### (unresolved)");
	});

	it("formats duration correctly", () => {
		const input = makeInput({
			startedAt: 1710000000000,
			endedAt: 1710003661000,  // 3661 seconds = 1h 1m 1s
		});
		const events = buildDiagnosticEvents(input);
		const report = buildMarkdownReport(input, events);

		expect(report).toContain("1h 1m 1s");
	});

	it("shows $0.00 for zero cost", () => {
		const input = makeInput({
			diagnostics: { taskExits: {}, batchCost: 0 },
		});
		const events = buildDiagnosticEvents(input);
		const report = buildMarkdownReport(input, events);

		expect(report).toContain("$0.00");
	});
});

// ── 4. emitDiagnosticReports — Robustness & Emission ─────────────────

describe("emitDiagnosticReports — robustness", () => {
	afterEach(() => {
		mockExistsSync.mock.resetCalls();
		mockMkdirSync.mock.resetCalls();
		mockWriteFileSync.mock.resetCalls();
		// Restore to original implementations for isolation
		mockExistsSync.mock.mockImplementation(origFs.existsSync);
		mockMkdirSync.mock.mockImplementation(origFs.mkdirSync);
		mockWriteFileSync.mock.mockImplementation(origFs.writeFileSync);
	});

	it("does not throw when writeFileSync fails, and writeFileSync was actually called", () => {
		mockExistsSync.mock.mockImplementation(() => true);
		mockMkdirSync.mock.mockImplementation(() => undefined as any);
		mockWriteFileSync.mock.mockImplementation(() => {
			throw new Error("disk full");
		});

		const input = makeInput({
			tasks: [makeTask("TP-001")],
			totalTasks: 1,
			succeededTasks: 1,
		});

		// Should NOT throw
		expect(() => emitDiagnosticReports(input)).not.toThrow();

		// Verify the write-failure path was actually exercised (R010 fix)
		expect(mockWriteFileSync).toHaveBeenCalled();
	});

	it("does not throw when mkdirSync fails, and mkdirSync was actually called", () => {
		mockExistsSync.mock.mockImplementation(() => false);
		mockMkdirSync.mock.mockImplementation(() => {
			throw new Error("permission denied");
		});

		const input = makeInput({
			tasks: [makeTask("TP-001")],
		});

		expect(() => emitDiagnosticReports(input)).not.toThrow();

		// Verify the mkdir-failure path was actually exercised (R010 fix)
		expect(mockMkdirSync).toHaveBeenCalled();
	});

	it("success path writes both JSONL and markdown files with expected filenames", () => {
		mockExistsSync.mock.mockImplementation(() => true);
		mockMkdirSync.mock.mockImplementation(() => undefined as any);
		mockWriteFileSync.mock.mockImplementation(() => {}); // no-op (success)

		const input = makeInput({
			batchId: "test-batch-001",
			tasks: [
				makeTask("TP-001", { status: "succeeded" }),
				makeTask("TP-002", { status: "failed", exitReason: "crash" }),
			],
			totalTasks: 2,
			succeededTasks: 1,
			failedTasks: 1,
			diagnostics: {
				taskExits: {
					"TP-001": { classification: "completed", cost: 0.10, durationSec: 60, retries: 0 },
					"TP-002": { classification: "crash", cost: 0.05, durationSec: 30, retries: 1 },
				},
				batchCost: 0.15,
			},
		});

		emitDiagnosticReports(input);

		// Verify both files were written (R010 fix)
		expect(mockWriteFileSync).toHaveBeenCalledTimes(2);

		// Check JSONL file
		const jsonlCall = mockWriteFileSync.mock.calls.find(
			(call: any) => String(call.arguments[0]).endsWith("-events.jsonl"),
		);
		expect(jsonlCall).toBeDefined();
		const jsonlPath = String(jsonlCall!.arguments[0]);
		expect(jsonlPath).toContain("test-batch-001");
		expect(jsonlPath).toContain("-events.jsonl");

		// Verify JSONL content has valid schema
		const jsonlContent = String(jsonlCall!.arguments[1]);
		const jsonlLines = jsonlContent.trim().split("\n");
		expect(jsonlLines).toHaveLength(2); // 2 tasks
		for (const line of jsonlLines) {
			const parsed = JSON.parse(line);
			expect(parsed).toHaveProperty("batchId");
			expect(parsed).toHaveProperty("taskId");
			expect(parsed).toHaveProperty("classification");
			expect(parsed).toHaveProperty("cost");
			expect(parsed).toHaveProperty("durationSec");
			expect(parsed).toHaveProperty("status");
		}

		// Check markdown file
		const mdCall = mockWriteFileSync.mock.calls.find(
			(call: any) => String(call.arguments[0]).endsWith("-report.md"),
		);
		expect(mdCall).toBeDefined();
		const mdPath = String(mdCall!.arguments[0]);
		expect(mdPath).toContain("test-batch-001");
		expect(mdPath).toContain("-report.md");

		// Verify markdown content has expected sections
		const mdContent = String(mdCall!.arguments[1]);
		expect(mdContent).toContain("# Batch Diagnostic Report");
		expect(mdContent).toContain("## Per-Task Results");
	});
});
