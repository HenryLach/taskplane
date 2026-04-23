const { detectUnsafeSubmoduleStates } = await import("../taskplane/git.ts");

/**
 * Unit tests for submodule dirty-state filtering fixes.
 * 
 * Validates that `filterArtifactStatusLines` uses segment matching to catch
 * nested artifacts like scripts/__pycache__/ and that `filterGitIgnoredStatusLines`
 * respects .gitignore rules at every level in the tree (recursive).
 * 
 * These tests cover both scenarios:
 * - Root-level ignores (.gitignore at repo root)  
 * - Recursive/nested ignores (.gitignore inside subdirectories of submodules)
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "./expect.ts";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

function commitAll(repoDir: string, message: string): void {
	git(repoDir, ["add", "."]);
	git(repoDir, ["commit", "-m", message]);
}

describe("filterArtifactStatusLines — segment matching for nested artifacts", () => {
	// We test through detectUnsafeSubmoduleStates since filterArtifactStatusLines is private.
	// The key assertion: submodules with __pycache__/ in NESTED paths should NOT be flagged dirty.

	it("filters root-level __pycache__ artifact", () => {
		const superDir = mkdtempSync(join(tmpdir(), "tp-super-"));
		const subDir = join(superDir, "my_sub");

		// Create submodule with __pycache__ at root
		initRepo(subDir);
		mkdirSync(join(subDir, "__pycache__"), { recursive: true });
		writeFileSync(join(subDir, "__pycache__/test.pyc"), "# cache", "utf-8");
		git(subDir, ["add", "."]);
		git(subDir, ["commit", "-m", "initial"]);

		// Create superproject with gitlink to submodule (no .gitignore for __pycache__)
		initRepo(superDir);
		execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", subDir, "my_sub"], { cwd: superDir });
		commitAll(superDir, "add my_sub");

		// Now dirty the submodule's __pycache__ (simulating worker creating it)
		writeFileSync(join(subDir, "__pycache__/new.pyc"), "# new cache", "utf-8");

		const findings = detectUnsafeSubmoduleStates(superDir);
		
		// __pycache__ should be filtered → no dirty submodules found
		expect(findings).toHaveLength(0);

		rmSync(superDir, { recursive: true, force: true });
	});

	it("filters nested scripts/__pycache__/ artifact (the bof3-disk pattern)", () => {
		const superDir = mkdtempSync(join(tmpdir(), "tp-super-nested-"));
		const subDir = join(superDir, "tools_repo");

		// Create submodule with __pycache__ in NESTED directory
		initRepo(subDir);
		mkdirSync(join(subDir, "scripts/__pycache__"), { recursive: true });
		writeFileSync(join(subDir, "scripts/__pycache__/helper.pyc"), "# cache", { recursive: true });
		git(subDir, ["add", "."]);
		git(subDir, ["commit", "-m", "initial"]);

		// Add to superproject
		initRepo(superDir);
		execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", subDir, "tools_repo"], { cwd: superDir });
		commitAll(superDir, "add tools_repo");

		// Dirty the nested __pycache__ (this is exactly what bof3-disk does)
		writeFileSync(join(subDir, "scripts/__pycache__/new.pyc"), "# new", { recursive: true });

		const findings = detectUnsafeSubmoduleStates(superDir);

		// nested __pycache__ should be filtered via segment matching → no dirty submodules
		expect(findings).toHaveLength(0);

		rmSync(superDir, { recursive: true, force: true });
	});

	it("filters tests/__pycache__/ alongside scripts/__pycache__", () => {
		const superDir = mkdtempSync(join(tmpdir(), "tp-super-test-"));
		const subDir = join(superDir, "multi_sub");

		initRepo(subDir);
		mkdirSync(join(subDir, "tests/__pycache__/"), { recursive: true });
		writeFileSync(join(subDir, "tests/__pycache__/test_helper.pyc"), "# cache", { recursive: true });
		git(subDir, ["add", "."]);
		git(subDir, ["commit", "-m", "initial"]);

		initRepo(superDir);
		execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", subDir, "multi_sub"], { cwd: superDir });
		commitAll(superDir, "add multi_sub");

		// Dirty both nested locations (mimics bof3-disk's scripts/__pycache__ and tests/__pycache__)
		writeFileSync(join(subDir, "tests/__pycache__/new.pyc"), "# new", { recursive: true });

		const findings = detectUnsafeSubmoduleStates(superDir);

		expect(findings).toHaveLength(0); // Both nested paths filtered

		rmSync(superDir, { recursive: true, force: true });
	});

	it("still detects non-filtered real changes", () => {
		const superDir = mkdtempSync(join(tmpdir(), "tp-super-real-"));
		const subDir = join(superDir, "real_sub");

		initRepo(subDir);
		mkdirSync(join(subDir, "src"), { recursive: true });
		writeFileSync(join(subDir, "src/main.c"), "#include <stdio.h>", "utf-8");
		git(subDir, ["add", "."]);
		git(subDir, ["commit", "-m", "initial"]);

		initRepo(superDir);
		execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", subDir, "real_sub"], { cwd: superDir });
		commitAll(superDir, "add real_sub");

		// Actually modify a source file (should be detected as dirty)
		writeFileSync(join(subDir, "src/main.c"), "#include <stdio.h>\nint main() {}", { recursive: true });

		const findings = detectUnsafeSubmoduleStates(superDir);

		expect(findings).toHaveLength(1); // Real change should be detected
		expect(findings[0].kind).toBe("dirty-worktree");

		rmSync(superDir, { recursive: true, force: true });
	});
});

describe("filterGitIgnoredStatusLines — respects recursive .gitignore rules", () => {
	it("respects root-level .gitignore in submodule", () => {
		const superDir = mkdtempSync(join(tmpdir(), "tp-gitroot-"));
		const subDir = join(superDir, "sub_with_root_gitignore");

		initRepo(subDir);
		writeFileSync(join(subDir, ".gitignore"), "__pycache__/\n*.pyc\n", { recursive: true });
		mkdirSync(join(subDir, "__pycache__/"), { recursive: true });
		writeFileSync(join(subDir, "__pycache__/cached.pyc"), "# cache", { recursive: true });
		git(subDir, ["add", "."]);
		git(subDir, ["commit", "-m", "initial with gitignore"]);

		initRepo(superDir);
		execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", subDir, "sub_with_root_gitignore"], { cwd: superDir });
		commitAll(superDir, "add sub");

		const findings = detectUnsafeSubmoduleStates(superDir);

		expect(findings).toHaveLength(0); // __pycache__ is gitignored → not dirty

		rmSync(superDir, { recursive: true, force: true });
	});

	it("respects NESTED .gitignore inside submodule subdirectory", () => {
		const superDir = mkdtempSync(join(tmpdir(), "tp-gitnested-"));
		const subDir = join(superDir, "sub_with_nested_gitignore");

		initRepo(subDir);
		writeFileSync(join(subDir, ".gitignore"), "# root gitignore\nbuild/", { recursive: true });
		mkdirSync(join(subDir, "scripts/__pycache__/"), { recursive: true });
		writeFileSync(join(subDir, "scripts/.gitignore"), "__pycache__/\n", { recursive: true }); // Nested .gitignore!
		writeFileSync(join(subDir, "scripts/__pycache__/helper.pyc"), "# cache", { recursive: true });
		git(subDir, ["add", "."]);
		git(subDir, ["commit", "-m", "initial with nested gitignore"]);

		initRepo(superDir);
		execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", subDir, "sub_with_nested_gitignore"], { cwd: superDir });
		commitAll(superDir, "add nested_sub");

		const findings = detectUnsafeSubmoduleStates(superDir);

		expect(findings).toHaveLength(0); // scripts/__pycache__ is gitignored via nested .gitignore → not dirty

		rmSync(superDir, { recursive: true, force: true });
	});

	it("detects changes NOT covered by any .gitignore", () => {
		const superDir = mkdtempSync(join(tmpdir(), "tp-gitnot-"));
		const subDir = join(superDir, "sub_partial_ignore");

		initRepo(subDir);
		writeFileSync(join(subDir, ".gitignore"), "__pycache__/\n", { recursive: true }); // Only ignores __pycache__, not src/
		mkdirSync(join(subDir, "__pycache__/"), { recursive: true });
		writeFileSync(join(subDir, "__pycache__/cached.pyc"), "# cache", { recursive: true });
		mkdirSync(join(subDir, "src"), { recursive: true });
		writeFileSync(join(subDir, "src/main.c"), "// source\n", "utf-8"); // Not gitignored!
		git(subDir, ["add", "."]);
		git(subDir, ["commit", "-m", "initial partial ignore"]);

		initRepo(superDir);
		execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", subDir, "sub_partial_ignore"], { cwd: superDir });
		commitAll(superDir, "add partial");

		// Modify a tracked source file after the submodule is added so the worktree is actually dirty.
		writeFileSync(join(subDir, "src/main.c"), "// source\nint main(void) { return 0; }\n", "utf-8");

		const findings = detectUnsafeSubmoduleStates(superDir);

		expect(findings).toHaveLength(1); // src/main.c is NOT gitignored → dirty detected
		expect(findings[0].kind).toBe("dirty-worktree");

		rmSync(superDir, { recursive: true, force: true });
	});

	it("respects deeply-nested .gitignore (3 levels deep)", () => {
		const superDir = mkdtempSync(join(tmpdir(), "tp-gitdeep-"));
		const subDir = join(superDir, "sub_deep");

		initRepo(subDir);
		writeFileSync(join(subDir, ".gitignore"), "# Root\n", { recursive: true });
		mkdirSync(join(subDir, "a/b/c/"), { recursive: true });
		writeFileSync(join(subDir, "a/.gitignore"), "*~\n", { recursive: true }); // Level 1
		writeFileSync(join(subDir, "a/b/.gitignore"), "*.swp\n", { recursive: true }); // Level 2
		writeFileSync(join(subDir, "a/b/c/.gitignore"), "__pycache__/\n", { recursive: true }); // Level 3!
		mkdirSync(join(subDir, "a/b/c/__pycache__/"), { recursive: true });
		writeFileSync(join(subDir, "a/b/c/__pycache__/deep.pyc"), "# deep cache", { recursive: true });
		git(subDir, ["add", "."]);
		git(subDir, ["commit", "-m", "initial with 3-level gitignore"]);

		initRepo(superDir);
		execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", subDir, "sub_deep"], { cwd: superDir });
		commitAll(superDir, "add deep");

		const findings = detectUnsafeSubmoduleStates(superDir);

		expect(findings).toHaveLength(0); // a/b/c/__pycache__ is gitignored at level 3 → not dirty

		rmSync(superDir, { recursive: true, force: true });
	});
});
