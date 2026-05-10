/**
 * Behavioral tests for `removeWorktree()` Windows MAX_PATH fallback — TP-189-A4.
 *
 * The existing `windows-worktree-cleanup-fallback.test.ts` covers the
 * fallback's helpers (isWindowsMaxPathError, runWindowsCmdRd) and uses
 * source-pattern checks for the wiring inside removeWorktree. Sage's
 * TP-188 follow-up review noted that the source-pattern coverage does
 * NOT prove the conditional logic actually fires correctly at runtime.
 *
 * This file exercises removeWorktree() end-to-end via a single
 * child_process mock that dispatches on the spawned command:
 *
 *   • "git" → controllable per-args response (worktree list / remove /
 *     prune / branch -D)
 *   • "cmd" → simulates the `cmd /c rd /s /q` fallback. When the
 *     dispatcher reports success it physically removes the on-disk
 *     temp directory so the post-removal `existsSync` verification
 *     passes for real.
 *
 * Real on-disk temp directories are used as the worktree path so we
 * don't have to mock fs as well — only the git/cmd subprocess calls.
 *
 * Decision branches covered:
 *
 *   4.1 — win32 + "Filename too long" stderr → fallback IS invoked,
 *         removeWorktree returns removed:true after cmd rd succeeds.
 *   4.2 — win32 + non-MAX_PATH error ("branch is checked out elsewhere")
 *         → fallback is NOT invoked; removeWorktree throws
 *         WORKTREE_REMOVE_FAILED with the original stderr.
 *   4.3 — non-win32 (linux) + "Filename too long" stderr → the
 *         platform guard in isWindowsMaxPathError correctly skips the
 *         fallback; the error is treated as terminal.
 *
 * Mocking strategy is portable to both Node 22 and Node 24 — see
 * windows-worktree-cleanup-fallback.test.ts header for the bare-vs-
 * node:-specifier divergence rationale. We mock the bare specifier
 * "child_process" only.
 *
 * Run:
 *   cd extensions && node --experimental-strip-types --experimental-test-module-mocks \\
 *     --no-warnings --import ./tests/loader.mjs \\
 *     --test tests/windows-worktree-cleanup-behavioral.test.ts
 */

import { afterEach, describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Mock child_process before importing worktree.ts ──────────────────

interface ExecCall {
	cmd: string;
	args: readonly string[];
}

type ExecHandler = (
	cmd: string,
	args: readonly string[],
) => Buffer | { kind: "throw"; stderr: string; stdout?: string };

const execCalls: ExecCall[] = [];
let currentHandler: ExecHandler = () => Buffer.from("");

const realChildProcess = await import("node:child_process");
const mockExecFileSync = mock.fn((cmd: string, args?: readonly string[]): Buffer => {
	const safeArgs = args ?? [];
	execCalls.push({ cmd, args: safeArgs });
	const result = currentHandler(cmd, safeArgs);
	if (Buffer.isBuffer(result)) return result;
	const err = new Error("mocked subprocess failure") as Error & {
		stderr?: Buffer;
		stdout?: Buffer;
		status?: number;
	};
	err.stderr = Buffer.from(result.stderr);
	err.stdout = Buffer.from(result.stdout ?? "");
	err.status = 1;
	throw err;
});

mock.module("child_process", {
	namedExports: {
		...realChildProcess,
		execFileSync: mockExecFileSync,
	},
});

// Import after the mock so worktree.ts (and its transitive ./git.ts)
// pick up the mocked execFileSync.
const { removeWorktree } = await import("../taskplane/worktree.ts");
const { WorktreeError } = await import("../taskplane/types.ts");

// ── Test helpers ──────────────────────────────────────────────────────

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()!;
		rmSync(dir, { recursive: true, force: true });
	}
	currentHandler = () => Buffer.from("");
	execCalls.length = 0;
	mockExecFileSync.mock.resetCalls();
});

function withPlatform(platform: NodeJS.Platform, fn: () => void): void {
	const realPlatform = process.platform;
	Object.defineProperty(process, "platform", {
		value: platform,
		configurable: true,
	});
	try {
		fn();
	} finally {
		Object.defineProperty(process, "platform", {
			value: realPlatform,
			configurable: true,
		});
	}
}

function makeWorktree(): { path: string; branch: string; laneNumber: number; baseBranch: string } {
	const path = mkdtempSync(join(tmpdir(), "tp189-a4-wt-"));
	tempDirs.push(path);
	return { path, branch: "task/lane-1", laneNumber: 1, baseBranch: "main" };
}

function makeRepoRoot(): string {
	const path = mkdtempSync(join(tmpdir(), "tp189-a4-repo-"));
	tempDirs.push(path);
	return path;
}

/**
 * Build a porcelain `git worktree list` output that registers the given
 * paths. Matches the format that worktree.ts's parseWorktreeList expects.
 */
function porcelainList(paths: string[]): Buffer {
	const blocks = paths.map(
		(p) =>
			`worktree ${p}\nHEAD 0000000000000000000000000000000000000000\nbranch refs/heads/task/lane-1`,
	);
	return Buffer.from(blocks.join("\n\n") + "\n");
}

// ── 4.x — Behavioral decision-branch coverage ─────────────────────────

describe("TP-189-A4 — removeWorktree() Windows fallback decision branches", () => {
	it("4.1: win32 + 'Filename too long' stderr → cmd rd fallback IS invoked and succeeds", () => {
		withPlatform("win32", () => {
			const wt = makeWorktree();
			const repoRoot = makeRepoRoot();

			let listCallCount = 0;
			currentHandler = (cmd, args) => {
				if (cmd === "git" && args[0] === "worktree" && args[1] === "list") {
					listCallCount++;
					// Pre-removal: target IS registered. Post-prune: target is gone.
					return listCallCount === 1 ? porcelainList([wt.path]) : Buffer.from("");
				}
				if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
					return { kind: "throw", stderr: "error: failed to delete 'foo': Filename too long" };
				}
				if (cmd === "cmd" && args[0] === "/c" && args[1] === "rd") {
					// Physically remove the temp dir so the post-removal
					// existsSync check sees an empty path on disk.
					rmSync(wt.path, { recursive: true, force: true });
					return Buffer.from("");
				}
				if (cmd === "git" && args[0] === "worktree" && args[1] === "prune") {
					return Buffer.from("");
				}
				if (cmd === "git" && args[0] === "branch" && args[1] === "-D") {
					return Buffer.from("");
				}
				if (cmd === "git" && args[0] === "rev-parse") {
					// preserveBranch path-not-taken (no targetBranch) — should not hit
					// but tolerate just in case.
					return Buffer.from("");
				}
				// Anything else: succeed silently.
				return Buffer.from("");
			};

			const result = removeWorktree(wt, repoRoot);

			// The fallback must have been invoked exactly once.
			const cmdRdCalls = execCalls.filter(
				(c) => c.cmd === "cmd" && c.args[0] === "/c" && c.args[1] === "rd",
			);
			assert.strictEqual(
				cmdRdCalls.length,
				1,
				`expected exactly 1 cmd /c rd /s /q invocation, got ${cmdRdCalls.length}`,
			);
			// And it must have used the documented arg shape with backslash-normalized path.
			assert.deepStrictEqual(cmdRdCalls[0].args.slice(0, 4), ["/c", "rd", "/s", "/q"]);
			assert.strictEqual(
				cmdRdCalls[0].args[4],
				wt.path.replace(/\//g, "\\"),
				"cmd rd path must be backslash-normalized",
			);
			// `git worktree prune` must have been invoked AFTER the fallback
			// so post-removal verification can pass.
			const pruneIdx = execCalls.findIndex(
				(c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "prune",
			);
			const cmdRdIdx = execCalls.findIndex((c) => c.cmd === "cmd" && c.args[1] === "rd");
			assert.ok(pruneIdx > cmdRdIdx, "prune must run after cmd rd, not before");

			// Final outcome: removed: true, branchDeleted: true.
			assert.strictEqual(result.removed, true);
			assert.strictEqual(result.alreadyRemoved, false);
			assert.strictEqual(result.branchDeleted, true);
			// On-disk verification: the temp dir is gone.
			assert.strictEqual(existsSync(wt.path), false);
		});
	});

	it("4.2: win32 + non-MAX_PATH error → fallback is NOT invoked; original error surfaces as WORKTREE_REMOVE_FAILED", () => {
		withPlatform("win32", () => {
			const wt = makeWorktree();
			const repoRoot = makeRepoRoot();

			currentHandler = (cmd, args) => {
				if (cmd === "git" && args[0] === "worktree" && args[1] === "list") {
					return porcelainList([wt.path]);
				}
				if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
					// Non-MAX_PATH, non-retriable error per isRetriableRemoveError.
					return {
						kind: "throw",
						stderr: "fatal: 'task/lane-1' is checked out at some other place",
					};
				}
				return Buffer.from("");
			};

			let thrown: unknown = null;
			try {
				removeWorktree(wt, repoRoot);
			} catch (err) {
				thrown = err;
			}

			assert.ok(
				thrown instanceof WorktreeError,
				`expected WorktreeError, got ${thrown?.constructor?.name ?? typeof thrown}`,
			);
			assert.strictEqual((thrown as { code: string }).code, "WORKTREE_REMOVE_FAILED");
			assert.match((thrown as Error).message, /checked out at some other place/);

			// Crucially: the cmd rd fallback was NOT invoked.
			const cmdRdCalls = execCalls.filter((c) => c.cmd === "cmd" && c.args[1] === "rd");
			assert.strictEqual(
				cmdRdCalls.length,
				0,
				`fallback must not fire on non-MAX_PATH errors; got ${cmdRdCalls.length} cmd rd call(s)`,
			);
		});
	});

	it("4.3: non-win32 (linux) + 'Filename too long' stderr → platform guard skips fallback; treated as terminal", () => {
		// On linux/macOS, isWindowsMaxPathError() returns false unconditionally
		// (predicate's first line: `if (process.platform !== "win32") return false;`).
		// So even MAX_PATH-shaped stderr does not trigger the cmd rd fallback.
		// "Filename too long" is also non-retriable per isRetriableRemoveError,
		// so the loop exits immediately with WORKTREE_REMOVE_FAILED.
		withPlatform("linux", () => {
			const wt = makeWorktree();
			const repoRoot = makeRepoRoot();

			currentHandler = (cmd, args) => {
				if (cmd === "git" && args[0] === "worktree" && args[1] === "list") {
					return porcelainList([wt.path]);
				}
				if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
					return { kind: "throw", stderr: "error: failed to delete: Filename too long" };
				}
				return Buffer.from("");
			};

			let thrown: unknown = null;
			try {
				removeWorktree(wt, repoRoot);
			} catch (err) {
				thrown = err;
			}

			assert.ok(
				thrown instanceof WorktreeError,
				`expected WorktreeError, got ${thrown?.constructor?.name ?? typeof thrown}`,
			);
			assert.strictEqual((thrown as { code: string }).code, "WORKTREE_REMOVE_FAILED");

			// Fallback must NOT have fired on non-Windows even though stderr matches.
			const cmdRdCalls = execCalls.filter((c) => c.cmd === "cmd" && c.args[1] === "rd");
			assert.strictEqual(
				cmdRdCalls.length,
				0,
				`fallback must not fire on non-win32 platforms; got ${cmdRdCalls.length} cmd rd call(s)`,
			);
		});
	});
});
