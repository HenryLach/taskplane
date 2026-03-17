/**
 * Gitignore Pattern Matching Tests — TP-015 Step 2
 *
 * Tests for the `patternToRegex()` function used by `detectAndOfferUntrackArtifacts()`
 * in `bin/taskplane.mjs`. Since that function is embedded in the CLI script and not
 * exported, we duplicate the pure function here for unit testing.
 *
 * Test categories:
 *   1.x — Directory patterns (trailing `/`)
 *   2.x — Wildcard patterns (`*`)
 *   3.x — Exact file patterns
 *   4.x — Full pattern set against realistic tracked files
 *
 * Run: npx vitest run tests/gitignore-pattern-matching.test.ts
 */

import { describe, it, expect } from "vitest";

// ─── Mirror of patternToRegex from bin/taskplane.mjs ──────────────────────
// Keep in sync with the CLI implementation.

function patternToRegex(pattern: string): RegExp {
	// Directory patterns (trailing slash) → prefix match
	if (pattern.endsWith("/")) {
		const dirPath = pattern.slice(0, -1);
		const escaped = dirPath.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp("^" + escaped + "/.*");
	}
	// Escape regex special chars except *
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	// Replace * with .*
	const regexStr = "^" + escaped.replace(/\*/g, ".*") + "$";
	return new RegExp(regexStr);
}

// ─── Constants mirror (subset needed for testing) ─────────────────────────

const TASKPLANE_GITIGNORE_ENTRIES = [
	".pi/batch-state.json",
	".pi/batch-history.json",
	".pi/lane-state-*",
	".pi/merge-result-*",
	".pi/merge-request-*",
	".pi/worker-conversation-*",
	".pi/orch-logs/",
	".pi/orch-abort-signal",
	".pi/settings.json",
	".worktrees/",
];

const TASKPLANE_GITIGNORE_NPM_ENTRIES = [
	".pi/npm/",
];

const ALL_GITIGNORE_PATTERNS = [...TASKPLANE_GITIGNORE_ENTRIES, ...TASKPLANE_GITIGNORE_NPM_ENTRIES];

// ─── Helper: match a file against all patterns ───────────────────────────

function matchesAnyPattern(file: string, patterns: string[]): boolean {
	return patterns.map(p => patternToRegex(p)).some(regex => regex.test(file));
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("patternToRegex: directory patterns (trailing /)", () => {
	it("1.1 — .pi/orch-logs/ matches files inside the directory", () => {
		const regex = patternToRegex(".pi/orch-logs/");
		expect(regex.test(".pi/orch-logs/session-1.log")).toBe(true);
		expect(regex.test(".pi/orch-logs/2026-03-17/run.log")).toBe(true);
	});

	it("1.2 — .worktrees/ matches nested files", () => {
		const regex = patternToRegex(".worktrees/");
		expect(regex.test(".worktrees/wt1/file.txt")).toBe(true);
		expect(regex.test(".worktrees/wt-henrylach/src/index.ts")).toBe(true);
	});

	it("1.3 — .pi/npm/ matches nested package files", () => {
		const regex = patternToRegex(".pi/npm/");
		expect(regex.test(".pi/npm/node_modules/pkg/index.js")).toBe(true);
		expect(regex.test(".pi/npm/package.json")).toBe(true);
	});

	it("1.4 — directory pattern does NOT match the directory name itself (no trailing content)", () => {
		const regex = patternToRegex(".pi/orch-logs/");
		// The bare directory path without a file beneath shouldn't match
		// (git ls-files returns file paths, not directory paths)
		expect(regex.test(".pi/orch-logs")).toBe(false);
	});

	it("1.5 — directory pattern does NOT match unrelated paths", () => {
		const regex = patternToRegex(".pi/orch-logs/");
		expect(regex.test(".pi/batch-state.json")).toBe(false);
		expect(regex.test("src/orch-logs/test.ts")).toBe(false);
	});
});

describe("patternToRegex: wildcard patterns (*)", () => {
	it("2.1 — .pi/lane-state-* matches lane state files", () => {
		const regex = patternToRegex(".pi/lane-state-*");
		expect(regex.test(".pi/lane-state-lane1.json")).toBe(true);
		expect(regex.test(".pi/lane-state-henrylach-lane-2.json")).toBe(true);
	});

	it("2.2 — .pi/merge-result-* matches merge result files", () => {
		const regex = patternToRegex(".pi/merge-result-*");
		expect(regex.test(".pi/merge-result-TP-001.json")).toBe(true);
	});

	it("2.3 — .pi/merge-request-* matches merge request files", () => {
		const regex = patternToRegex(".pi/merge-request-*");
		expect(regex.test(".pi/merge-request-TP-002.json")).toBe(true);
	});

	it("2.4 — .pi/worker-conversation-* matches worker conversation files", () => {
		const regex = patternToRegex(".pi/worker-conversation-*");
		expect(regex.test(".pi/worker-conversation-lane-1.json")).toBe(true);
	});

	it("2.5 — wildcard does NOT match paths without the prefix", () => {
		const regex = patternToRegex(".pi/lane-state-*");
		expect(regex.test(".pi/batch-state.json")).toBe(false);
		expect(regex.test("lane-state-foo.json")).toBe(false);
	});
});

describe("patternToRegex: exact file patterns", () => {
	it("3.1 — .pi/batch-state.json matches exactly", () => {
		const regex = patternToRegex(".pi/batch-state.json");
		expect(regex.test(".pi/batch-state.json")).toBe(true);
	});

	it("3.2 — .pi/batch-history.json matches exactly", () => {
		const regex = patternToRegex(".pi/batch-history.json");
		expect(regex.test(".pi/batch-history.json")).toBe(true);
	});

	it("3.3 — .pi/orch-abort-signal matches exactly", () => {
		const regex = patternToRegex(".pi/orch-abort-signal");
		expect(regex.test(".pi/orch-abort-signal")).toBe(true);
	});

	it("3.4 — .pi/settings.json matches exactly", () => {
		const regex = patternToRegex(".pi/settings.json");
		expect(regex.test(".pi/settings.json")).toBe(true);
	});

	it("3.5 — exact patterns do NOT match subpaths", () => {
		const regex = patternToRegex(".pi/batch-state.json");
		expect(regex.test(".pi/batch-state.json.bak")).toBe(false);
		expect(regex.test("foo/.pi/batch-state.json")).toBe(false);
	});
});

describe("full pattern set against realistic tracked files", () => {
	it("4.1 — correctly identifies all runtime artifact types", () => {
		const trackedFiles = [
			".pi/batch-state.json",
			".pi/batch-history.json",
			".pi/lane-state-lane1.json",
			".pi/lane-state-henrylach-lane-2.json",
			".pi/merge-result-TP-001.json",
			".pi/merge-request-TP-002.json",
			".pi/worker-conversation-lane-1.json",
			".pi/orch-logs/session-1.log",
			".pi/orch-logs/2026-03-17/run.log",
			".pi/orch-abort-signal",
			".pi/settings.json",
			".worktrees/wt1/file.txt",
			".worktrees/wt-henrylach/src/index.ts",
			".pi/npm/node_modules/pkg/index.js",
			".pi/npm/package.json",
		];

		for (const file of trackedFiles) {
			expect(matchesAnyPattern(file, ALL_GITIGNORE_PATTERNS)).toBe(true);
		}
	});

	it("4.2 — does NOT match legitimate tracked files", () => {
		const legitimateFiles = [
			".pi/task-runner.yaml",
			".pi/task-orchestrator.yaml",
			".pi/prompts/agent.md",
			".pi/CONTEXT.md",
			"src/index.ts",
			"README.md",
			"package.json",
		];

		for (const file of legitimateFiles) {
			expect(matchesAnyPattern(file, ALL_GITIGNORE_PATTERNS)).toBe(false);
		}
	});

	it("4.3 — directory patterns match deeply nested files", () => {
		expect(matchesAnyPattern(".worktrees/wt1/deeply/nested/file.txt", ALL_GITIGNORE_PATTERNS)).toBe(true);
		expect(matchesAnyPattern(".pi/orch-logs/a/b/c/deep.log", ALL_GITIGNORE_PATTERNS)).toBe(true);
		expect(matchesAnyPattern(".pi/npm/node_modules/@scope/pkg/lib/index.js", ALL_GITIGNORE_PATTERNS)).toBe(true);
	});
});
