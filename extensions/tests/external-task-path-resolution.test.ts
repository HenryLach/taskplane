/**
 * External Task Folder Path Resolution Tests — TP-003 Step 2
 *
 * Regression tests for `resolveCanonicalTaskPaths` and downstream call-sites
 * (`resolveTaskDonePath`, `parseWorktreeStatusMd`, `selectAbortTargetSessions`)
 * to verify correct behavior when task folders live outside the repo root
 * (workspace / polyrepo mode) and inside the repo root (monorepo mode).
 *
 * Test matrix covers four resolution branches:
 *   1. Repo-contained task folder → worktree-relative resolution
 *   2. External task folder → canonical absolute resolution
 *   3. Archive fallback when primary location is missing
 *   4. Primary-path fallback when no files exist yet
 *
 * Plus abort-flow regression coverage for `selectAbortTargetSessions`.
 *
 * Run: cd extensions && npx vitest run tests/external-task-path-resolution.test.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	resolveCanonicalTaskPaths,
	resolveTaskDonePath,
	parseWorktreeStatusMd,
} from "../taskplane/execution.ts";

import {
	selectAbortTargetSessions,
} from "../taskplane/abort.ts";

// ── Test Helpers ──────────────────────────────────────────────────────

/** Normalize path separators for cross-platform comparison. */
function norm(p: string): string {
	return p.replace(/\\/g, "/");
}

// ── Fixtures ─────────────────────────────────────────────────────────

let tempRoot: string;
let repoRoot: string;
let worktreePath: string;
let externalTaskRoot: string;

beforeEach(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "tp003-"));

	// Simulate a repo root with tasks inside
	repoRoot = join(tempRoot, "repo");
	mkdirSync(repoRoot, { recursive: true });

	// Simulate a worktree
	worktreePath = join(tempRoot, "repo-wt-1");
	mkdirSync(worktreePath, { recursive: true });

	// Simulate an external task root (outside repo)
	externalTaskRoot = join(tempRoot, "docs-repo", "tasks");
	mkdirSync(externalTaskRoot, { recursive: true });
});

afterEach(() => {
	rmSync(tempRoot, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════
// 1. resolveCanonicalTaskPaths — four-branch regression matrix
// ═══════════════════════════════════════════════════════════════════════

describe("resolveCanonicalTaskPaths", () => {
	// ── Branch 1: Task folder inside repo root (monorepo mode) ───────

	describe("repo-contained task folder (monorepo mode)", () => {
		it("1.1: translates task folder to worktree-relative path", () => {
			const taskFolder = join(repoRoot, "tasks", "TP-001-feature");
			const wtTaskFolder = join(worktreePath, "tasks", "TP-001-feature");
			mkdirSync(wtTaskFolder, { recursive: true });
			writeFileSync(join(wtTaskFolder, "STATUS.md"), "# Status\n");

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			expect(norm(result.taskFolderResolved)).toBe(norm(wtTaskFolder));
			expect(norm(result.donePath)).toBe(norm(join(wtTaskFolder, ".DONE")));
			expect(norm(result.statusPath)).toBe(norm(join(wtTaskFolder, "STATUS.md")));
		});

		it("1.2: preserves nested task folder structure in worktree", () => {
			const taskFolder = join(repoRoot, "taskplane-tasks", "area", "TP-002-deep");
			const wtTaskFolder = join(worktreePath, "taskplane-tasks", "area", "TP-002-deep");
			mkdirSync(wtTaskFolder, { recursive: true });
			writeFileSync(join(wtTaskFolder, ".DONE"), "done\n");

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			expect(norm(result.taskFolderResolved)).toBe(norm(wtTaskFolder));
			expect(norm(result.donePath)).toBe(norm(join(wtTaskFolder, ".DONE")));
		});

		it("1.3: donePath and statusPath are correctly constructed even without files", () => {
			const taskFolder = join(repoRoot, "tasks", "TP-003-nofiles");
			const wtTaskFolder = join(worktreePath, "tasks", "TP-003-nofiles");
			// Don't create the worktree folder or any files

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			expect(norm(result.taskFolderResolved)).toBe(norm(wtTaskFolder));
			expect(norm(result.donePath)).toBe(norm(join(wtTaskFolder, ".DONE")));
			expect(norm(result.statusPath)).toBe(norm(join(wtTaskFolder, "STATUS.md")));
		});
	});

	// ── Branch 2: Task folder outside repo root (workspace mode) ─────

	describe("external task folder (workspace mode)", () => {
		it("2.1: uses absolute task folder path directly (not re-joined under worktree)", () => {
			const taskFolder = join(externalTaskRoot, "TP-010-external");
			mkdirSync(taskFolder, { recursive: true });
			writeFileSync(join(taskFolder, "STATUS.md"), "# Status\n");

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			// Must NOT be under worktreePath — stays at canonical location
			expect(norm(result.taskFolderResolved)).toBe(norm(taskFolder));
			expect(norm(result.donePath)).toBe(norm(join(taskFolder, ".DONE")));
			expect(norm(result.statusPath)).toBe(norm(join(taskFolder, "STATUS.md")));
			expect(norm(result.taskFolderResolved).startsWith(norm(worktreePath))).toBe(false);
		});

		it("2.2: works with deeply nested external paths", () => {
			const taskFolder = join(externalTaskRoot, "sprint-1", "area", "TP-011-deep-external");
			mkdirSync(taskFolder, { recursive: true });
			writeFileSync(join(taskFolder, ".DONE"), "done\n");

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			expect(norm(result.taskFolderResolved)).toBe(norm(taskFolder));
			expect(norm(result.donePath)).toBe(norm(join(taskFolder, ".DONE")));
		});

		it("2.3: external folder not confused with repo root when path is a prefix substring", () => {
			// Edge case: external path starts with repoRoot string but adds
			// more chars without a separator (e.g., /repo vs /repo-extra)
			const similarRoot = repoRoot + "-extra";
			mkdirSync(similarRoot, { recursive: true });
			const taskFolder = join(similarRoot, "tasks", "TP-012-prefix-trap");
			mkdirSync(taskFolder, { recursive: true });
			writeFileSync(join(taskFolder, "STATUS.md"), "# Status\n");

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			// Must be treated as external, NOT as repo-contained
			expect(norm(result.taskFolderResolved)).toBe(norm(taskFolder));
			expect(norm(result.taskFolderResolved).startsWith(norm(worktreePath))).toBe(false);
		});

		it("2.4: donePath and statusPath are correctly constructed for external without files", () => {
			const taskFolder = join(externalTaskRoot, "TP-013-pending");
			// Don't create the folder

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			expect(norm(result.taskFolderResolved)).toBe(norm(resolve(taskFolder)));
			expect(norm(result.donePath)).toBe(norm(join(resolve(taskFolder), ".DONE")));
			expect(norm(result.statusPath)).toBe(norm(join(resolve(taskFolder), "STATUS.md")));
		});
	});

	// ── Branch 3: Archive fallback ───────────────────────────────────

	describe("archive fallback", () => {
		it("3.1: repo-contained task falls back to archive when primary is empty", () => {
			const taskFolder = join(repoRoot, "tasks", "TP-020-archived");
			const wtPrimary = join(worktreePath, "tasks", "TP-020-archived");
			const wtArchive = join(worktreePath, "tasks", "archive", "TP-020-archived");
			mkdirSync(wtPrimary, { recursive: true });
			mkdirSync(wtArchive, { recursive: true });
			writeFileSync(join(wtArchive, ".DONE"), "done\n");
			writeFileSync(join(wtArchive, "STATUS.md"), "# Archived\n");
			// Primary has NO .DONE or STATUS.md

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			expect(norm(result.taskFolderResolved)).toBe(norm(wtArchive));
			expect(norm(result.donePath)).toBe(norm(join(wtArchive, ".DONE")));
			expect(norm(result.statusPath)).toBe(norm(join(wtArchive, "STATUS.md")));
		});

		it("3.2: external task falls back to archive when primary is empty", () => {
			const taskFolder = join(externalTaskRoot, "TP-021-ext-archived");
			const archiveFolder = join(externalTaskRoot, "archive", "TP-021-ext-archived");
			mkdirSync(taskFolder, { recursive: true });
			mkdirSync(archiveFolder, { recursive: true });
			writeFileSync(join(archiveFolder, ".DONE"), "done\n");
			// Primary has NO .DONE or STATUS.md

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			expect(norm(result.taskFolderResolved)).toBe(norm(archiveFolder));
			expect(norm(result.donePath)).toBe(norm(join(archiveFolder, ".DONE")));
		});

		it("3.3: primary location preferred over archive when both have files", () => {
			const taskFolder = join(repoRoot, "tasks", "TP-022-both");
			const wtPrimary = join(worktreePath, "tasks", "TP-022-both");
			const wtArchive = join(worktreePath, "tasks", "archive", "TP-022-both");
			mkdirSync(wtPrimary, { recursive: true });
			mkdirSync(wtArchive, { recursive: true });
			writeFileSync(join(wtPrimary, "STATUS.md"), "# Primary\n");
			writeFileSync(join(wtArchive, ".DONE"), "done\n");

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			// Primary has STATUS.md so it's found first
			expect(norm(result.taskFolderResolved)).toBe(norm(wtPrimary));
		});
	});

	// ── Branch 4: Primary fallback when nothing exists ───────────────

	describe("primary-path fallback (no files exist yet)", () => {
		it("4.1: returns primary paths for repo-contained when nothing exists", () => {
			const taskFolder = join(repoRoot, "tasks", "TP-030-new");
			const wtPrimary = join(worktreePath, "tasks", "TP-030-new");

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			expect(norm(result.taskFolderResolved)).toBe(norm(wtPrimary));
			expect(norm(result.donePath)).toBe(norm(join(wtPrimary, ".DONE")));
			expect(norm(result.statusPath)).toBe(norm(join(wtPrimary, "STATUS.md")));
		});

		it("4.2: returns primary paths for external when nothing exists", () => {
			const taskFolder = join(externalTaskRoot, "TP-031-new-ext");

			const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

			expect(norm(result.taskFolderResolved)).toBe(norm(resolve(taskFolder)));
			expect(norm(result.donePath)).toBe(norm(join(resolve(taskFolder), ".DONE")));
			expect(norm(result.statusPath)).toBe(norm(join(resolve(taskFolder), "STATUS.md")));
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 2. resolveTaskDonePath — delegates to resolveCanonicalTaskPaths
// ═══════════════════════════════════════════════════════════════════════

describe("resolveTaskDonePath", () => {
	it("returns worktree-relative .DONE for repo-contained task", () => {
		const taskFolder = join(repoRoot, "tasks", "TP-040");
		const expected = join(worktreePath, "tasks", "TP-040", ".DONE");

		const result = resolveTaskDonePath(taskFolder, worktreePath, repoRoot);

		expect(norm(result)).toBe(norm(expected));
	});

	it("returns canonical absolute .DONE for external task", () => {
		const taskFolder = join(externalTaskRoot, "TP-041-ext");

		const result = resolveTaskDonePath(taskFolder, worktreePath, repoRoot);

		expect(norm(result)).toBe(norm(join(resolve(taskFolder), ".DONE")));
		expect(norm(result).startsWith(norm(worktreePath))).toBe(false);
	});

	it("falls back to archive .DONE for repo-contained task", () => {
		const taskFolder = join(repoRoot, "tasks", "TP-042-archived");
		const wtArchive = join(worktreePath, "tasks", "archive", "TP-042-archived");
		mkdirSync(wtArchive, { recursive: true });
		writeFileSync(join(wtArchive, ".DONE"), "done\n");

		const result = resolveTaskDonePath(taskFolder, worktreePath, repoRoot);

		expect(norm(result)).toBe(norm(join(wtArchive, ".DONE")));
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 3. parseWorktreeStatusMd — uses resolveCanonicalTaskPaths for STATUS.md
// ═══════════════════════════════════════════════════════════════════════

describe("parseWorktreeStatusMd", () => {
	const validStatusContent = `# Task Status

**Current Step:** Step 1: Implement feature
**Status:** 🟨 In Progress

---

### Step 0: Setup
**Status:** ✅ Complete

- [x] Initialize project
- [x] Create config

### Step 1: Implement feature
**Status:** 🟨 In Progress

- [x] Write code
- [ ] Add tests
- [ ] Update docs
`;

	it("parses STATUS.md for repo-contained task in worktree", () => {
		const taskFolder = join(repoRoot, "tasks", "TP-050");
		const wtTaskFolder = join(worktreePath, "tasks", "TP-050");
		mkdirSync(wtTaskFolder, { recursive: true });
		writeFileSync(join(wtTaskFolder, "STATUS.md"), validStatusContent);

		const { parsed, error } = parseWorktreeStatusMd(taskFolder, worktreePath, repoRoot);

		expect(error).toBeNull();
		expect(parsed).not.toBeNull();
		// ParsedWorktreeStatus has a steps array — verify step parsing
		expect(parsed!.steps.length).toBeGreaterThanOrEqual(2);
		const inProgressStep = parsed!.steps.find(s => s.status === "in-progress");
		expect(inProgressStep).toBeDefined();
		expect(inProgressStep!.name).toContain("Implement feature");
		// Aggregate checkbox counts across steps
		const totalChecked = parsed!.steps.reduce((sum, s) => sum + s.totalChecked, 0);
		const totalItems = parsed!.steps.reduce((sum, s) => sum + s.totalItems, 0);
		expect(totalChecked).toBeGreaterThanOrEqual(3);
		expect(totalItems).toBeGreaterThanOrEqual(5);
	});

	it("parses STATUS.md for external task folder (canonical location)", () => {
		const taskFolder = join(externalTaskRoot, "TP-051-ext");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "STATUS.md"), validStatusContent);

		const { parsed, error } = parseWorktreeStatusMd(taskFolder, worktreePath, repoRoot);

		expect(error).toBeNull();
		expect(parsed).not.toBeNull();
		const inProgressStep = parsed!.steps.find(s => s.status === "in-progress");
		expect(inProgressStep).toBeDefined();
		expect(inProgressStep!.name).toContain("Implement feature");
	});

	it("returns error when STATUS.md not found for external task", () => {
		const taskFolder = join(externalTaskRoot, "TP-052-missing");
		// Don't create the folder or STATUS.md

		const { parsed, error } = parseWorktreeStatusMd(taskFolder, worktreePath, repoRoot);

		expect(parsed).toBeNull();
		expect(error).not.toBeNull();
		expect(error).toContain("STATUS.md not found");
	});

	it("parses archived STATUS.md via archive fallback", () => {
		const taskFolder = join(repoRoot, "tasks", "TP-053-archived");
		const wtArchive = join(worktreePath, "tasks", "archive", "TP-053-archived");
		mkdirSync(wtArchive, { recursive: true });
		writeFileSync(join(wtArchive, "STATUS.md"), validStatusContent);

		const { parsed, error } = parseWorktreeStatusMd(taskFolder, worktreePath, repoRoot);

		expect(error).toBeNull();
		expect(parsed).not.toBeNull();
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 4. selectAbortTargetSessions — abort-flow regression
// ═══════════════════════════════════════════════════════════════════════

describe("selectAbortTargetSessions", () => {
	it("resolves repo-contained task folder into worktree path", () => {
		const taskFolder = join(repoRoot, "tasks", "TP-060");

		const targets = selectAbortTargetSessions(
			["orch-lane-1"],
			null, // no persisted state
			[{
				laneId: "lane-1",
				laneNumber: 1,
				worktreePath,
				tmuxSessionName: "orch-lane-1",
				tasks: [{
					taskId: "TP-060",
					task: { taskFolder } as any,
				}] as any[],
			} as any],
			repoRoot,
			"orch",
		);

		expect(targets.length).toBe(1);
		const target = targets[0];
		expect(target.sessionName).toBe("orch-lane-1");
		expect(target.taskFolderInWorktree).not.toBeNull();
		// Must be under worktreePath for repo-contained tasks
		expect(norm(target.taskFolderInWorktree!).startsWith(norm(worktreePath))).toBe(true);
		expect(norm(target.taskFolderInWorktree!)).toBe(
			norm(join(worktreePath, "tasks", "TP-060")),
		);
	});

	it("resolves external task folder to absolute canonical path (not under worktree)", () => {
		const taskFolder = join(externalTaskRoot, "TP-061-ext");
		mkdirSync(taskFolder, { recursive: true });

		const targets = selectAbortTargetSessions(
			["orch-lane-1"],
			null,
			[{
				laneId: "lane-1",
				laneNumber: 1,
				worktreePath,
				tmuxSessionName: "orch-lane-1",
				tasks: [{
					taskId: "TP-061-ext",
					task: { taskFolder } as any,
				}] as any[],
			} as any],
			repoRoot,
			"orch",
		);

		expect(targets.length).toBe(1);
		const target = targets[0];
		expect(target.taskFolderInWorktree).not.toBeNull();
		// Must NOT be under worktreePath — external path stays absolute
		expect(norm(target.taskFolderInWorktree!).startsWith(norm(worktreePath))).toBe(false);
		expect(norm(target.taskFolderInWorktree!)).toBe(norm(resolve(taskFolder)));
	});

	it("resolves archived external task folder via archive fallback in abort flow", () => {
		const taskFolder = join(externalTaskRoot, "TP-062-ext-archived");
		const archiveFolder = join(externalTaskRoot, "archive", "TP-062-ext-archived");
		mkdirSync(taskFolder, { recursive: true });
		mkdirSync(archiveFolder, { recursive: true });
		writeFileSync(join(archiveFolder, ".DONE"), "done\n");
		// Primary has no .DONE or STATUS.md

		const targets = selectAbortTargetSessions(
			["orch-lane-1"],
			null,
			[{
				laneId: "lane-1",
				laneNumber: 1,
				worktreePath,
				tmuxSessionName: "orch-lane-1",
				tasks: [{
					taskId: "TP-062-ext-archived",
					task: { taskFolder } as any,
				}] as any[],
			} as any],
			repoRoot,
			"orch",
		);

		expect(targets.length).toBe(1);
		const target = targets[0];
		expect(target.taskFolderInWorktree).not.toBeNull();
		expect(norm(target.taskFolderInWorktree!)).toBe(norm(archiveFolder));
	});

	it("resolves archived repo-contained task folder via archive fallback in abort flow", () => {
		const taskFolder = join(repoRoot, "tasks", "TP-063-archived");
		const wtArchive = join(worktreePath, "tasks", "archive", "TP-063-archived");
		mkdirSync(join(worktreePath, "tasks", "TP-063-archived"), { recursive: true });
		mkdirSync(wtArchive, { recursive: true });
		writeFileSync(join(wtArchive, ".DONE"), "done\n");
		// Primary worktree folder has no .DONE or STATUS.md

		const targets = selectAbortTargetSessions(
			["orch-lane-1"],
			null,
			[{
				laneId: "lane-1",
				laneNumber: 1,
				worktreePath,
				tmuxSessionName: "orch-lane-1",
				tasks: [{
					taskId: "TP-063-archived",
					task: { taskFolder } as any,
				}] as any[],
			} as any],
			repoRoot,
			"orch",
		);

		expect(targets.length).toBe(1);
		const target = targets[0];
		expect(norm(target.taskFolderInWorktree!)).toBe(norm(wtArchive));
	});

	it("handles session with no task (taskFolderInWorktree is null)", () => {
		const targets = selectAbortTargetSessions(
			["orch-lane-1"],
			null,
			[{
				laneId: "lane-1",
				laneNumber: 1,
				worktreePath,
				tmuxSessionName: "orch-lane-1",
				tasks: [] as any[],
			} as any],
			repoRoot,
			"orch",
		);

		expect(targets.length).toBe(1);
		expect(targets[0].taskFolderInWorktree).toBeNull();
	});

	it("handles persisted state with external task folder", () => {
		const taskFolder = join(externalTaskRoot, "TP-064-persisted-ext");

		const persistedState = {
			tasks: [{
				taskId: "TP-064-persisted-ext",
				sessionName: "orch-lane-1",
				laneNumber: 1,
				taskFolder,
				status: "running",
			}],
		};

		// No runtime lanes — only persisted data
		const targets = selectAbortTargetSessions(
			["orch-lane-1"],
			persistedState as any,
			[],
			repoRoot,
			"orch",
		);

		expect(targets.length).toBe(1);
		// Without worktreePath (no runtime lane), taskFolderInWorktree should be null
		// because the resolver needs both taskFolder and worktreePath
		expect(targets[0].taskId).toBe("TP-064-persisted-ext");
		expect(targets[0].taskFolderInWorktree).toBeNull();
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Monorepo regression — completion detection end-to-end
// ═══════════════════════════════════════════════════════════════════════

describe("monorepo completion detection regression", () => {
	it("detects .DONE in worktree for repo-contained task", () => {
		const taskFolder = join(repoRoot, "tasks", "TP-070");
		const wtTaskFolder = join(worktreePath, "tasks", "TP-070");
		mkdirSync(wtTaskFolder, { recursive: true });
		writeFileSync(join(wtTaskFolder, ".DONE"), "done\n");

		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

		expect(existsSync(result.donePath)).toBe(true);
		expect(norm(result.donePath)).toBe(norm(join(wtTaskFolder, ".DONE")));
	});

	it("detects STATUS.md in worktree for repo-contained task", () => {
		const taskFolder = join(repoRoot, "tasks", "TP-071");
		const wtTaskFolder = join(worktreePath, "tasks", "TP-071");
		mkdirSync(wtTaskFolder, { recursive: true });
		writeFileSync(join(wtTaskFolder, "STATUS.md"), "# Status\n");

		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

		expect(existsSync(result.statusPath)).toBe(true);
	});

	it("detects .DONE for external task at canonical location", () => {
		const taskFolder = join(externalTaskRoot, "TP-072-ext");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, ".DONE"), "done\n");

		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);

		expect(existsSync(result.donePath)).toBe(true);
		expect(norm(result.donePath)).toBe(norm(join(taskFolder, ".DONE")));
	});

	it("both repo-contained and external tasks can coexist with correct resolution", () => {
		// Internal task
		const internalTask = join(repoRoot, "tasks", "TP-073-internal");
		const wtInternal = join(worktreePath, "tasks", "TP-073-internal");
		mkdirSync(wtInternal, { recursive: true });
		writeFileSync(join(wtInternal, ".DONE"), "done\n");

		// External task
		const externalTask = join(externalTaskRoot, "TP-074-external");
		mkdirSync(externalTask, { recursive: true });
		writeFileSync(join(externalTask, ".DONE"), "done\n");

		const internalResult = resolveCanonicalTaskPaths(internalTask, worktreePath, repoRoot);
		const externalResult = resolveCanonicalTaskPaths(externalTask, worktreePath, repoRoot);

		// Internal resolves to worktree
		expect(norm(internalResult.taskFolderResolved).startsWith(norm(worktreePath))).toBe(true);
		expect(existsSync(internalResult.donePath)).toBe(true);

		// External resolves to canonical location
		expect(norm(externalResult.taskFolderResolved).startsWith(norm(worktreePath))).toBe(false);
		expect(existsSync(externalResult.donePath)).toBe(true);
	});
});
