/**
 * Merge Result Schema Compatibility Tests
 *
 * Guards against merge-agent JSON key drift (source/sourceBranch/source_branch,
 * mergeCommit/merge_commit, etc.) causing false merge timeouts.
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { buildMergeRequest, parseMergeResult } from "../taskplane/merge.ts";
import { MergeError } from "../taskplane/types.ts";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "merge-result-compat-"));
}

function writeResult(dir: string, payload: Record<string, unknown>): string {
	const path = join(dir, "result.json");
	writeFileSync(path, JSON.stringify(payload, null, 2), "utf-8");
	return path;
}

describe("merge result parser compatibility", () => {
	it("accepts canonical snake_case fields", () => {
		const dir = makeTmpDir();
		try {
			const path = writeResult(dir, {
				status: "success",
				source_branch: "task/lane-1",
				target_branch: "orch/op",
				merge_commit: "abc123",
				conflicts: [],
				verification: { ran: true, passed: true, output: "ok" },
			});

			const parsed = parseMergeResult(path);
			expect(parsed.status).toBe("SUCCESS");
			expect(parsed.source_branch).toBe("task/lane-1");
			expect(parsed.target_branch).toBe("orch/op");
			expect(parsed.merge_commit).toBe("abc123");
			expect(parsed.verification.passed).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts camelCase branch/commit keys", () => {
		const dir = makeTmpDir();
		try {
			const path = writeResult(dir, {
				status: "SUCCESS",
				sourceBranch: "task/lane-2",
				targetBranch: "orch/op",
				mergeCommit: "def456",
				verification: { passed: true, summary: "47 test files passed" },
			});

			const parsed = parseMergeResult(path);
			expect(parsed.source_branch).toBe("task/lane-2");
			expect(parsed.target_branch).toBe("orch/op");
			expect(parsed.merge_commit).toBe("def456");
			expect(parsed.verification.ran).toBe(true);
			expect(parsed.verification.passed).toBe(true);
			expect(parsed.verification.output).toContain("47 test files passed");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts shortened source/target keys", () => {
		const dir = makeTmpDir();
		try {
			const path = writeResult(dir, {
				status: "success",
				source: "task/lane-3",
				target: "orch/op",
				mergeCommit: "ghi789",
				verification: {
					exitCode: 0,
					command:
						"node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts",
					summary: "all passing",
				},
			});

			const parsed = parseMergeResult(path);
			expect(parsed.source_branch).toBe("task/lane-3");
			expect(parsed.target_branch).toBe("orch/op");
			expect(parsed.merge_commit).toBe("ghi789");
			expect(parsed.verification.passed).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("accepts flat verification fields", () => {
		const dir = makeTmpDir();
		try {
			const path = writeResult(dir, {
				status: "SUCCESS",
				source_branch: "task/lane-4",
				verification_passed: true,
				verification_commands: [
					"cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts",
				],
				verification_output: "ok",
			});

			const parsed = parseMergeResult(path);
			expect(parsed.verification.ran).toBe(true);
			expect(parsed.verification.passed).toBe(true);
			expect(parsed.verification.output).toBe("ok");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws when source field is missing in all accepted variants", () => {
		const dir = makeTmpDir();
		try {
			const path = writeResult(dir, {
				status: "SUCCESS",
				verification: { ran: true, passed: true, output: "ok" },
			});
			expect(() => parseMergeResult(path)).toThrow(MergeError);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("merge request schema guidance", () => {
	it("includes explicit required JSON schema with snake_case keys", () => {
		const request = buildMergeRequest(
			{
				laneNumber: 1,
				laneId: "lane-1",
				branch: "task/lane-1",
				tasks: [{ taskId: "TP-999", task: { taskName: "Example Task", fileScope: [] } }],
			} as any,
			"orch/op",
			1,
			[
				"cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts",
			],
			"/tmp/result.json",
		);

		expect(request).toContain("## Result JSON Schema (required)");
		expect(request).toContain("source_branch");
		expect(request).toContain("target_branch");
		expect(request).toContain("merge_commit");
		expect(request).toContain("Do NOT use keys like source/sourceBranch/target/mergeCommit");
	});
});
