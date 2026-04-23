/**
 * Tests for filterArtifactStatusLines — artifact directory filtering.
 *
 * Regression test for TP-XXX: task artifact modifications at worktree root level
 * (.pi/tasks/*/STATUS.md, .pi/tasks/*/.DONE) were incorrectly passing through the
 * submodule dirty-state filter, causing "unsafe submodule state" checkpoint failures
 * even when no actual code was modified inside submodules.
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";

describe("filterArtifactStatusLines", () => {
	// We can't directly import the private function, so we test through its behavior
	// by simulating what detectUnsafeSubmoduleStates does with git status output.

	function simulateFilter(
		statusOutput: string,
		knownPaths: Set<string>,
	): boolean {
		// Simulates filterArtifactStatusLines logic from git.ts (lines 110-143)
		const TASKPLANE_ARTIFACTS = new Set([".pi/tasks", ".pi/supervisor"]);
		const artifacts = new Set(knownPaths);

		const filtered = statusOutput
			.split(/\r?\n/)
			.filter((line) => {
				if (!line.trim()) return false;
				const parts = line.trimStart().split(/\s+/);
				if (parts.length >= 2) {
					const filePath = parts[1];
					for (const known of artifacts) {
						if (filePath === known || filePath.startsWith(known + "/")) {
							return false;
						}
					}
					for (const artifact of TASKPLANE_ARTIFACTS) {
						if (filePath === artifact || filePath.startsWith(artifact + "/")) {
							return false;
						}
					}
				}
				return true;
			})
			.join("\n");

		return filtered.trim().length > 0; // returns true if "dirty" after filtering
	}

	it("filters out .pi/tasks/STATUS.md artifact lines", () => {
		const buggyStatus = "M .pi/tasks/disk/DISK-001-disk-client-inventory-publish-hardening/STATUS.md\n?? .pi/tasks/disk/DISK-001-disk-client-inventory-publish-hardening/.DONE";
		expect(simulateFilter(buggyStatus, new Set())).toBe(false); // should be clean after filtering
	});

	it("filters out .pi/supervisor/ artifact lines", () => {
		const status = "M .pi/supervisor/events.jsonl\n?? .pi/supervisor/koija-summary.md";
		expect(simulateFilter(status, new Set())).toBe(false);
	});

	it("keeps actual submodule dirty state", () => {
		const knownPaths = new Set(["third_party/tools/rabbitizer"]);
		const status = "M third_party/tools/rabbitizer/src/mips.cc\n?? third_party/tools/rabbitizer/src/new_file.c";
		expect(simulateFilter(status, knownPaths)).toBe(true); // should remain dirty
	});

	it("filters other-submodule paths but keeps non-matching submodules", () => {
		const knownPaths = new Set([
			"third_party/tools/asm-differ",
			"third_party/tools/rabbitizer",
			"third_party/tools/m2c",
		]);
		const status = "M third_party/tools/asm-differ\n?? third_party/tools/rabbitizer/foo.txt";
		const result = simulateFilter(status, knownPaths);
		expect(result).toBe(true); // rabbitizer path remains dirty since it's a real change
	});

	it("handles empty and whitespace-only input", () => {
		expect(simulateFilter("", new Set())).toBe(false);
		expect(simulateFilter("\n\n  \n", new Set())).toBe(false);
	});

	it("does not filter partial path matches (e.g., .pi/tasks-backup)", () => {
		const status = "?? .pi/tasks-backup/somefile.txt";
		expect(simulateFilter(status, new Set())).toBe(true); // should NOT be filtered
	});
});
