/**
 * Sub-fix B (TP-188 / #543) — Windows worktree cleanup fallback.
 *
 * Validates the new isWindowsMaxPathError + runWindowsCmdRd helpers in
 * extensions/taskplane/worktree.ts and confirms removeWorktree() invokes
 * `cmd /c rd /s /q` after `git worktree remove` reports
 * "Filename too long" on Windows.
 *
 * Tests are platform-agnostic: Windows-only code paths are exercised via
 * mocking child_process.execFileSync. Real-environment integration on
 * Windows hardware is covered by worktree-lifecycle.integration.test.ts.
 *
 * Run:
 *   cd extensions && node --experimental-strip-types --experimental-test-module-mocks \\
 *     --no-warnings --import ./tests/loader.mjs \\
 *     --test tests/windows-worktree-cleanup-fallback.test.ts
 */

import { describe, it, mock } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Normalize CRLF -> LF so source-pattern regexes are line-ending agnostic.
const worktreeSrc = readFileSync(
	join(__dirname, "..", "taskplane", "worktree.ts"),
	"utf-8",
).replace(/\r\n/g, "\n");

// ── 1. Source-pattern checks: helpers exist and have the right shape ─────────

describe("TP-188 sub-fix B (#543): worktree.ts source patterns", () => {
	it("1.1: exports isWindowsMaxPathError helper", () => {
		expect(worktreeSrc).toMatch(/export\s+function\s+isWindowsMaxPathError/);
	});

	it("1.2: exports runWindowsCmdRd helper", () => {
		expect(worktreeSrc).toMatch(/export\s+function\s+runWindowsCmdRd/);
	});

	it("1.3: isWindowsMaxPathError guards on win32 platform", () => {
		// The helper must be a no-op on non-Windows so production fallback
		// never fires on macOS / Linux.
		const fnStart = worktreeSrc.indexOf("export function isWindowsMaxPathError");
		expect(fnStart).toBeGreaterThan(-1);
		// Pull the next ~600 chars — enough to cover the helper body without
		// depending on an exact line-ending closing pattern.
		const body = worktreeSrc.slice(fnStart, fnStart + 600);
		expect(body).toContain("process.platform");
		expect(body).toContain("win32");
	});

	it("1.4: isWindowsMaxPathError matches the documented stderr regex", () => {
		const fnStart = worktreeSrc.indexOf("export function isWindowsMaxPathError");
		const body = worktreeSrc.slice(fnStart, fnStart + 600);
		expect(body).toMatch(/filename too long/i);
	});

	it("1.5: runWindowsCmdRd normalizes forward slashes to backslashes", () => {
		const fnStart = worktreeSrc.indexOf("export function runWindowsCmdRd");
		expect(fnStart).toBeGreaterThan(-1);
		const body = worktreeSrc.slice(fnStart, fnStart + 1500);
		// Path normalization is required so cmd `rd` sees a native Windows path.
		expect(body).toMatch(/replace\(\s*\/\\\/\s*\/g\s*,\s*"\\\\"\s*\)/);
	});

	it("1.6: runWindowsCmdRd uses execFileSync with cmd /c rd /s /q", () => {
		const fnStart = worktreeSrc.indexOf("export function runWindowsCmdRd");
		const body = worktreeSrc.slice(fnStart, fnStart + 1500);
		expect(body).toContain("execFileSync");
		expect(body).toContain('"cmd"');
		expect(body).toContain('"/c"');
		expect(body).toContain('"rd"');
		expect(body).toContain('"/s"');
		expect(body).toContain('"/q"');
	});

	it("1.7: removeWorktree wires the fallback into its retry loop", () => {
		// Locate removeWorktree's body (next top-level export marks the end).
		const fnStart = worktreeSrc.indexOf("export function removeWorktree");
		expect(fnStart).toBeGreaterThan(-1);
		const fnEnd = worktreeSrc.indexOf("\nexport ", fnStart + 1);
		const body = worktreeSrc.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);

		expect(body).toContain("isWindowsMaxPathError");
		expect(body).toContain("runWindowsCmdRd");
	});

	it("1.8: fallback runs `git worktree prune` on success so verification passes", () => {
		const fnStart = worktreeSrc.indexOf("export function removeWorktree");
		const fnEnd = worktreeSrc.indexOf("\nexport ", fnStart + 1);
		const body = worktreeSrc.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
		// On fallback success the on-disk tree is gone but git's bookkeeping
		// still has a stale entry. The post-removal verification calls
		// isRegisteredWorktree(), so we must prune.
		const fallbackIdx = body.indexOf("runWindowsCmdRd");
		const pruneIdx = body.indexOf('["worktree", "prune"]', fallbackIdx);
		expect(pruneIdx).toBeGreaterThan(fallbackIdx);
	});

	it("1.9: fallback only fires when isWindowsMaxPathError(stderr) is true", () => {
		// Ensures other error classes (lock errors, perm errors, generic git
		// errors) still flow through the existing retriable/terminal logic
		// rather than being eaten by the fallback.
		const fnStart = worktreeSrc.indexOf("export function removeWorktree");
		const fnEnd = worktreeSrc.indexOf("\nexport ", fnStart + 1);
		const body = worktreeSrc.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
		expect(body).toMatch(/if\s*\(\s*isWindowsMaxPathError\s*\(\s*lastError/);
	});

	it("1.10: fallback logs INFO-level messages via execLog (detection + outcome)", () => {
		const fnStart = worktreeSrc.indexOf("export function removeWorktree");
		const fnEnd = worktreeSrc.indexOf("\nexport ", fnStart + 1);
		const body = worktreeSrc.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
		const fallbackBlockStart = body.indexOf("isWindowsMaxPathError");
		expect(fallbackBlockStart).toBeGreaterThan(-1);
		const fallbackBlock = body.slice(fallbackBlockStart, fallbackBlockStart + 2000);
		const execLogCount = (fallbackBlock.match(/execLog\(/g) ?? []).length;
		expect(execLogCount).toBeGreaterThanOrEqual(2);
	});

	it("1.11: fallback failure path enriches lastError with both attempts", () => {
		const fnStart = worktreeSrc.indexOf("export function removeWorktree");
		const fnEnd = worktreeSrc.indexOf("\nexport ", fnStart + 1);
		const body = worktreeSrc.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
		// When the cmd rd fallback also fails, the operator should see both
		// the original git error and the rescue's stderr in the throw message.
		expect(body).toMatch(
			/git worktree remove failed[\s\S]{0,200}cmd rd[\s\S]{0,200}fallback failed/,
		);
	});
});

// ── 2. Pure-function unit tests for isWindowsMaxPathError ────────────────────

describe("TP-188 sub-fix B (#543): isWindowsMaxPathError unit", () => {
	it("2.1: returns false on non-Windows for any input", async () => {
		const { isWindowsMaxPathError } = await import("../taskplane/worktree.ts");
		const realPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });
		try {
			expect(isWindowsMaxPathError("error: failed to delete 'foo': Filename too long")).toBe(false);
			expect(isWindowsMaxPathError("anything at all")).toBe(false);
		} finally {
			Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
		}
	});

	it("2.2: returns true on Windows when stderr contains 'Filename too long' (case-insensitive)", async () => {
		const { isWindowsMaxPathError } = await import("../taskplane/worktree.ts");
		const realPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "win32", configurable: true });
		try {
			expect(isWindowsMaxPathError("error: failed to delete 'foo': Filename too long")).toBe(true);
			expect(isWindowsMaxPathError("FILENAME TOO LONG")).toBe(true);
			expect(isWindowsMaxPathError("filename Too LONG\n")).toBe(true);
		} finally {
			Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
		}
	});

	it("2.3: returns false on Windows for unrelated errors (other classes still surface unchanged)", async () => {
		const { isWindowsMaxPathError } = await import("../taskplane/worktree.ts");
		const realPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "win32", configurable: true });
		try {
			expect(isWindowsMaxPathError("fatal: 'foo' is not a working tree")).toBe(false);
			expect(isWindowsMaxPathError("error: cannot lock ref 'HEAD'")).toBe(false);
			expect(isWindowsMaxPathError("Permission denied")).toBe(false);
			expect(isWindowsMaxPathError("")).toBe(false);
		} finally {
			Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
		}
	});
});

// ── 3. runWindowsCmdRd unit tests via single child_process mock ──────────────
//
// node:test's mock.module() can only be called once per module per test file
// (a second call throws ERR_INVALID_STATE: "already mocked"). To exercise
// both the success and failure code paths in runWindowsCmdRd we install a
// single mock at module-load time and switch its behavior between tests via
// a shared fixture variable.

type MockBehavior = () => Buffer;
let currentBehavior: MockBehavior = () => Buffer.from("");
const mockExecFileSyncCalls: Array<{ cmd: string; args: readonly string[] }> = [];

const realChildProcess = await import("node:child_process");
const mockExecFileSync = mock.fn((cmd: string, args?: readonly string[]): Buffer => {
	mockExecFileSyncCalls.push({ cmd, args: args ?? [] });
	return currentBehavior();
});

// Mock the BARE `child_process` specifier (which is what worktree.ts uses).
//
// Node 22 vs Node 24 behavior diverges here: Node 24's mock.module aliases
// `child_process` and `node:child_process` automatically (mocking either
// intercepts both, and trying to mock the second throws ERR_INVALID_STATE).
// Node 22 treats them as separate modules.
//
// Mocking the bare specifier only is portable to both: Node 24 picks it up
// for both forms via aliasing; Node 22 picks it up because that's the exact
// specifier worktree.ts imports from. Mocking `node:child_process` instead
// only works on Node 24 (regression observed in CI on Node 22 — see
// workflow run 25472777114).
mock.module("child_process", {
	namedExports: {
		...realChildProcess,
		execFileSync: mockExecFileSync,
	},
});

// Import after mocking so worktree.ts picks up the mocked execFileSync.
const { runWindowsCmdRd } = await import("../taskplane/worktree.ts");

describe("TP-188 sub-fix B (#543): runWindowsCmdRd unit (mocked execFileSync)", () => {
	it("3.1: invokes cmd /c rd /s /q with backslash-normalized path on success", () => {
		mockExecFileSyncCalls.length = 0;
		currentBehavior = () => Buffer.from("");

		const result = runWindowsCmdRd("C:/dev/repo/.worktrees/lane-1");

		expect(result.ok).toBe(true);
		const lastCall = mockExecFileSyncCalls[mockExecFileSyncCalls.length - 1];
		expect(lastCall).toBeDefined();
		expect(lastCall.cmd).toBe("cmd");
		expect(lastCall.args[0]).toBe("/c");
		expect(lastCall.args[1]).toBe("rd");
		expect(lastCall.args[2]).toBe("/s");
		expect(lastCall.args[3]).toBe("/q");
		// Path normalized: forward slashes -> backslashes for native Windows path
		expect(lastCall.args[4]).toBe("C:\\dev\\repo\\.worktrees\\lane-1");
	});

	it("3.2: surfaces stderr on failure without throwing", () => {
		mockExecFileSyncCalls.length = 0;
		currentBehavior = (() => {
			const err = new Error("rd failed") as Error & {
				stderr?: Buffer;
				stdout?: Buffer;
			};
			err.stderr = Buffer.from("Access is denied.");
			err.stdout = Buffer.from("");
			throw err;
		}) as MockBehavior;

		const result = runWindowsCmdRd("C:\\dev\\repo\\.worktrees\\lane-2");

		expect(result.ok).toBe(false);
		expect(result.stderr).toContain("Access is denied");
	});

	it("3.3: leaves already-backslash paths unchanged", () => {
		mockExecFileSyncCalls.length = 0;
		currentBehavior = () => Buffer.from("");

		runWindowsCmdRd("C:\\dev\\repo\\.worktrees\\lane-3");

		const lastCall = mockExecFileSyncCalls[mockExecFileSyncCalls.length - 1];
		expect(lastCall.args[4]).toBe("C:\\dev\\repo\\.worktrees\\lane-3");
	});
});
