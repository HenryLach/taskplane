/**
 * Gitignore Pattern Matching Tests — TP-015 Step 2 (R006)
 *
 * Tests for `patternToRegex()` and `matchesAnyGitignorePattern()` from
 * `bin/gitignore-patterns.mjs`. Verifies that:
 *
 *   1.x — Directory patterns (trailing /) match files underneath
 *   2.x — Wildcard patterns match expected file names
 *   3.x — Exact patterns match only the specified file
 *   4.x — Non-matching files are not falsely detected
 *   5.x — matchesAnyGitignorePattern covers all built-in patterns
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/gitignore-patterns.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const patternsPath = resolve(__dirname, "../../bin/gitignore-patterns.mjs");

// Dynamic import since it's an .mjs file
const {
	patternToRegex,
	matchesAnyGitignorePattern,
	TASKPLANE_GITIGNORE_ENTRIES,
	TASKPLANE_GITIGNORE_NPM_ENTRIES,
	ALL_GITIGNORE_PATTERNS,
} = await import(pathToFileURL(patternsPath).href);

// ─── 1.x: Directory patterns (trailing /) ──────────────────────────────────

describe("patternToRegex: directory patterns", () => {
	it("1.1 — .worktrees/ matches files underneath", () => {
		const regex = patternToRegex(".worktrees/");
		expect(regex.test(".worktrees/wt1/file.txt")).toBe(true);
		expect(regex.test(".worktrees/wt-name/sub/deep.js")).toBe(true);
		expect(regex.test(".worktrees/a")).toBe(true);
	});

	it("1.2 — .pi/orch-logs/ matches log files underneath", () => {
		const regex = patternToRegex(".pi/orch-logs/");
		expect(regex.test(".pi/orch-logs/session-1.log")).toBe(true);
		expect(regex.test(".pi/orch-logs/2026-03-17/lane1.txt")).toBe(true);
	});

	it("1.3 — .pi/npm/ matches package files underneath", () => {
		const regex = patternToRegex(".pi/npm/");
		expect(regex.test(".pi/npm/node_modules/pkg/index.js")).toBe(true);
		expect(regex.test(".pi/npm/package.json")).toBe(true);
		expect(regex.test(".pi/npm/something")).toBe(true);
	});

	it("1.4 — directory pattern matches even bare dir path (git ls-files never returns bare dirs in practice)", () => {
		const regex = patternToRegex(".worktrees/");
		// `.*` matches empty string, so bare dir path matches — but git ls-files
		// only returns file paths, so this is acceptable behavior
		expect(regex.test(".worktrees/")).toBe(true);
	});

	it("1.5 — directory pattern does not match similarly named files outside", () => {
		const regex = patternToRegex(".worktrees/");
		expect(regex.test("src/.worktrees/file.txt")).toBe(false);
		expect(regex.test(".worktrees-backup/file.txt")).toBe(false);
	});
});

// ─── 2.x: Wildcard patterns ────────────────────────────────────────────────

describe("patternToRegex: wildcard patterns", () => {
	it("2.1 — .pi/lane-state-* matches lane state files", () => {
		const regex = patternToRegex(".pi/lane-state-*");
		expect(regex.test(".pi/lane-state-lane1.json")).toBe(true);
		expect(regex.test(".pi/lane-state-abc-123")).toBe(true);
		expect(regex.test(".pi/lane-state-")).toBe(true);
	});

	it("2.2 — .pi/merge-result-* matches merge result files", () => {
		const regex = patternToRegex(".pi/merge-result-*");
		expect(regex.test(".pi/merge-result-abc123.json")).toBe(true);
		expect(regex.test(".pi/merge-result-task-1")).toBe(true);
	});

	it("2.3 — .pi/merge-request-* matches merge request files", () => {
		const regex = patternToRegex(".pi/merge-request-*");
		expect(regex.test(".pi/merge-request-session-xyz")).toBe(true);
	});

	it("2.4 — .pi/worker-conversation-* matches conversation files", () => {
		const regex = patternToRegex(".pi/worker-conversation-*");
		expect(regex.test(".pi/worker-conversation-lane1-step3.json")).toBe(true);
	});

	it("2.5 — wildcard patterns do not match unrelated files", () => {
		const regex = patternToRegex(".pi/lane-state-*");
		expect(regex.test(".pi/batch-state.json")).toBe(false);
		expect(regex.test(".pi/settings.json")).toBe(false);
		expect(regex.test("other/lane-state-foo")).toBe(false);
	});
});

// ─── 3.x: Exact patterns ───────────────────────────────────────────────────

describe("patternToRegex: exact patterns", () => {
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

	it("3.5 — exact patterns do not match partial or prefixed paths", () => {
		const regex = patternToRegex(".pi/batch-state.json");
		expect(regex.test(".pi/batch-state.json.bak")).toBe(false);
		expect(regex.test("src/.pi/batch-state.json")).toBe(false);
		expect(regex.test(".pi/batch-state.jsonx")).toBe(false);
	});
});

// ─── 4.x: Non-matching (false positive prevention) ─────────────────────────

describe("patternToRegex: false positive prevention", () => {
	it("4.1 — config files are not matched by any pattern", () => {
		expect(matchesAnyGitignorePattern(".pi/task-runner.yaml")).toBe(false);
		expect(matchesAnyGitignorePattern(".pi/task-orchestrator.yaml")).toBe(false);
		expect(matchesAnyGitignorePattern(".pi/taskplane-config.json")).toBe(false);
	});

	it("4.2 — task files are not matched", () => {
		expect(matchesAnyGitignorePattern("taskplane-tasks/TP-001/PROMPT.md")).toBe(false);
		expect(matchesAnyGitignorePattern("taskplane-tasks/TP-001/STATUS.md")).toBe(false);
	});

	it("4.3 — agent prompt files are not matched", () => {
		expect(matchesAnyGitignorePattern(".pi/agent-system-prompt.md")).toBe(false);
		expect(matchesAnyGitignorePattern(".pi/agent-user-prompt.md")).toBe(false);
	});

	it("4.4 — source files are not matched", () => {
		expect(matchesAnyGitignorePattern("src/index.ts")).toBe(false);
		expect(matchesAnyGitignorePattern("package.json")).toBe(false);
		expect(matchesAnyGitignorePattern("README.md")).toBe(false);
	});
});

// ─── 5.x: matchesAnyGitignorePattern integration ───────────────────────────

describe("matchesAnyGitignorePattern: integration", () => {
	it("5.1 — detects tracked files under .worktrees/", () => {
		expect(matchesAnyGitignorePattern(".worktrees/wt1/README.md")).toBe(true);
		expect(matchesAnyGitignorePattern(".worktrees/taskplane-wt-user1/src/file.ts")).toBe(true);
	});

	it("5.2 — detects tracked files under .pi/orch-logs/", () => {
		expect(matchesAnyGitignorePattern(".pi/orch-logs/session.log")).toBe(true);
	});

	it("5.3 — detects tracked files under .pi/npm/", () => {
		expect(matchesAnyGitignorePattern(".pi/npm/node_modules/pkg/index.js")).toBe(true);
	});

	it("5.4 — detects all exact-match runtime artifacts", () => {
		expect(matchesAnyGitignorePattern(".pi/batch-state.json")).toBe(true);
		expect(matchesAnyGitignorePattern(".pi/batch-history.json")).toBe(true);
		expect(matchesAnyGitignorePattern(".pi/orch-abort-signal")).toBe(true);
		expect(matchesAnyGitignorePattern(".pi/settings.json")).toBe(true);
	});

	it("5.5 — detects all wildcard-match runtime artifacts", () => {
		expect(matchesAnyGitignorePattern(".pi/lane-state-lane1.json")).toBe(true);
		expect(matchesAnyGitignorePattern(".pi/merge-result-task1.json")).toBe(true);
		expect(matchesAnyGitignorePattern(".pi/merge-request-session1")).toBe(true);
		expect(matchesAnyGitignorePattern(".pi/worker-conversation-lane1.json")).toBe(true);
	});

	it("5.6 — accepts custom patterns parameter", () => {
		const customPatterns = [".custom/dir/", "*.log"];
		expect(matchesAnyGitignorePattern(".custom/dir/file.txt", customPatterns)).toBe(true);
		expect(matchesAnyGitignorePattern("app.log", customPatterns)).toBe(true);
		expect(matchesAnyGitignorePattern("src/file.ts", customPatterns)).toBe(false);
	});

	it("5.7 — ALL_GITIGNORE_PATTERNS includes both runtime and npm entries", () => {
		expect(ALL_GITIGNORE_PATTERNS.length).toBe(
			TASKPLANE_GITIGNORE_ENTRIES.length + TASKPLANE_GITIGNORE_NPM_ENTRIES.length,
		);
		expect(ALL_GITIGNORE_PATTERNS).toContain(".pi/npm/");
		expect(ALL_GITIGNORE_PATTERNS).toContain(".worktrees/");
		expect(ALL_GITIGNORE_PATTERNS).toContain(".pi/batch-state.json");
	});
});
