import { afterEach, beforeEach, describe, it } from "node:test";
import { execFileSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { expect } from "./expect.ts";
import { buildLaneExitDiagnostic, detectSoftProgress, getStatusProgressTotals, readGitHead } from "../taskplane/lane-runner.ts";

let testRoot: string;

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function initRepo(repoDir: string): void {
	mkdirSync(repoDir, { recursive: true });
	git(repoDir, ["init", "--initial-branch=main"]);
	git(repoDir, ["config", "user.email", "test@example.com"]);
	git(repoDir, ["config", "user.name", "Taskplane Test"]);
}

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-lane-progress-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

describe("lane-runner progress helpers", () => {
	it("detectSoftProgress returns false for a clean worktree with unchanged HEAD", () => {
		initRepo(testRoot);
		writeFileSync(join(testRoot, "file.txt"), "base\n", "utf-8");
		git(testRoot, ["add", "."]);
		git(testRoot, ["commit", "-m", "initial"]);

		const previousHead = readGitHead(testRoot);
		const result = detectSoftProgress(testRoot, previousHead);

		expect(result.hasProgress).toBe(false);
		expect(result.reason).toBe(null);
	});

	it("detectSoftProgress treats uncommitted source changes as progress", () => {
		initRepo(testRoot);
		writeFileSync(join(testRoot, "main.c"), "int main(void) { return 0; }\n", "utf-8");
		git(testRoot, ["add", "."]);
		git(testRoot, ["commit", "-m", "initial"]);

		const previousHead = readGitHead(testRoot);
		writeFileSync(join(testRoot, "main.c"), "int main(void) { return 1; }\n", "utf-8");

		const result = detectSoftProgress(testRoot, previousHead);

		expect(result.hasProgress).toBe(true);
		expect(result.reason).toContain("uncommitted worktree changes");
	});

	it("detectSoftProgress treats HEAD advance as progress even when worktree is clean", () => {
		initRepo(testRoot);
		writeFileSync(join(testRoot, "Makefile"), "all:\n\t@echo ok\n", "utf-8");
		git(testRoot, ["add", "."]);
		git(testRoot, ["commit", "-m", "initial"]);

		const previousHead = readGitHead(testRoot);
		writeFileSync(join(testRoot, "Makefile"), "all:\n\t@echo done\n", "utf-8");
		git(testRoot, ["add", "."]);
		git(testRoot, ["commit", "-m", "update makefile"]);

		const result = detectSoftProgress(testRoot, previousHead);

		expect(result.hasProgress).toBe(true);
		expect(result.reason).toContain("HEAD advanced");
	});

	it("getStatusProgressTotals counts total items separately from checked items", () => {
		const content = [
			"# TP-001: Example — Status",
			"",
			"### Step 0: Preflight",
			"**Status:** ✅ Complete",
			"- [x] Verified artifact exists",
			"- [ ] Confirmed clean worktree",
			"",
			"### Step 1: Implement",
			"**Status:** 🟨 In Progress",
			"- [ ] Create Makefile",
		].join("\n");

		const totals = getStatusProgressTotals(content);

		expect(totals.checked).toBe(1);
		expect(totals.total).toBe(3);
	});

	it("getStatusProgressTotals accepts worker-authored step evidence headings", () => {
		const content = [
			"**Current Step:** Step 0: Preflight — Verify existing artifacts exist",
			"**Status:** ✅ Complete — all steps verified, git clean",
			"",
			"## Step 0 Evidence — Verify existing artifacts exist",
			"- [x] Verify artifact A",
			"- [x] Verify artifact B",
			"",
			"## Step 1 Evidence — Create Makefile",
			"- [x] Create Makefile",
			"- [ ] Verify .PHONY",
			"",
			"## Completion Criteria",
			"- [x] Parent-repo integration verified",
		].join("\n");

		const totals = getStatusProgressTotals(content);

		expect(totals.checked).toBe(3);
		expect(totals.total).toBe(4);
	});

	it("getStatusProgressTotals ignores pseudo-headings inside fenced evidence blocks", () => {
		const content = [
			"**Current Step:** Step 1: Create the Makefile",
			"**Status:** ✅ Complete",
			"",
			"## Step 1: Create the Makefile at `third_party/tools/bof3-inventory/Makefile`",
			"",
			"**EVIDENCE:**",
			"",
			"```bash",
			"$ cat third_party/tools/bof3-inventory/Makefile",
			"# Makefile for bof3-inventory — top-level build/test/docker targets",
			"# Callable from parent repo via: $(MAKE) -C third_party/tools/bof3-inventory <target>",
			"",
			".PHONY: build test api docker-build docker-run cpp-build clean",
			"```",
			"",
			"- [x] File created at exact path",
			"- [x] All 7 targets declared in `.PHONY`",
			"- [x] Each target uses relative paths",
			"- [x] Target implementations match the command specifications above",
		].join("\n");

		const totals = getStatusProgressTotals(content);

		expect(totals.checked).toBe(4);
		expect(totals.total).toBe(4);
	});

	it("buildLaneExitDiagnostic classifies no-progress failures as stall_timeout", () => {
		const diagnostic = buildLaneExitDiagnostic(
			"failed",
			"No progress after 3 iterations",
			false,
			{ durationMs: 341000, toolCalls: 18, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
			undefined,
			"default",
		);

		expect(diagnostic?.classification).toBe("stall_timeout");
		expect(diagnostic?.errorMessage).toBe("No progress after 3 iterations");
	});

	it("buildLaneExitDiagnostic classifies succeeded outcomes as completed", () => {
		const diagnostic = buildLaneExitDiagnostic(
			"succeeded",
			"Task completed",
			true,
			{ durationMs: 1000, toolCalls: 2, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		);

		expect(diagnostic?.classification).toBe("completed");
		expect(diagnostic?.errorMessage).toBeNull();
	});

	it("buildLaneExitDiagnostic classifies dirty submodule safety failures distinctly", () => {
		const diagnostic = buildLaneExitDiagnostic(
			"failed",
			"Unsafe submodule state after task success: libs/my_lib has uncommitted submodule changes",
			false,
			{ durationMs: 1000, toolCalls: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, exitCode: 1 },
		);

		expect(diagnostic?.classification).toBe("unsafe_submodule_dirty");
	});

	it("buildLaneExitDiagnostic classifies unpublished submodule commits distinctly", () => {
		const diagnostic = buildLaneExitDiagnostic(
			"failed",
			"Unsafe submodule state after task success: libs/my_lib points to local commit abcdef12 not reachable on origin",
			false,
			{ durationMs: 1000, toolCalls: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, exitCode: 1 },
		);

		expect(diagnostic?.classification).toBe("unsafe_submodule_unpublished_commit");
	});
});