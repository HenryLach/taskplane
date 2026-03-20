/**
 * TP-035 — STATUS.md Reconciliation & Artifact Staging Scope Tests
 *
 * Tests for:
 *   1.x  — Reconciliation happy path: check/uncheck/partial/idempotent
 *   2.x  — Reconciliation edge cases: duplicate matches, unmatched, empty input, missing STATUS.md
 *   3.x  — Reconciliation guard: only runs when quality gate enabled and entries present
 *   4.x  — Artifact staging allowlist: accepts task-owned files only
 *   5.x  — Artifact staging rejection: outside-task paths, repo-escape, no-op on zero candidates
 *
 * Run: npx vitest run tests/status-reconciliation.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join, resolve, relative } from "path";
import { tmpdir } from "os";

import {
	applyStatusReconciliation,
	type StatusReconciliation,
	type ReconciliationResult,
} from "../taskplane/quality-gate.ts";

// ── Fixture Helpers ──────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `recon-${counter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeStatus(dir: string, content: string): string {
	const statusPath = join(dir, "STATUS.md");
	writeFileSync(statusPath, content, "utf-8");
	return statusPath;
}

function readStatus(dir: string): string {
	return readFileSync(join(dir, "STATUS.md"), "utf-8");
}

function makeRecon(
	checkbox: string,
	actualState: "done" | "not_done" | "partial",
	evidence = "test evidence",
): StatusReconciliation {
	return { checkbox, actualState, evidence };
}

// ── Setup / Teardown ─────────────────────────────────────────────────

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-recon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	try { rmSync(testRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ══════════════════════════════════════════════════════════════════════
// 1.x — Reconciliation happy path
// ══════════════════════════════════════════════════════════════════════

describe("1.x: Reconciliation happy path", () => {
	it("1.1: checked→unchecked for not_done", () => {
		const dir = makeTestDir("uncheck");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [x] Implement feature A",
			"- [x] Write tests",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature A", "not_done", "No code changes found"),
		]);

		expect(result.changed).toBe(1);
		expect(result.alreadyCorrect).toBe(0);
		expect(result.unmatched).toBe(0);

		const updated = readStatus(dir);
		expect(updated).toContain("- [ ] Implement feature A");
		// Other checkbox should be unchanged
		expect(updated).toContain("- [x] Write tests");
	});

	it("1.2: unchecked→checked for done", () => {
		const dir = makeTestDir("check");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [ ] Implement feature B",
			"- [ ] Run tests",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature B", "done", "Implementation verified in source"),
		]);

		expect(result.changed).toBe(1);
		expect(result.alreadyCorrect).toBe(0);

		const updated = readStatus(dir);
		expect(updated).toContain("- [x] Implement feature B");
		// Other checkbox should be unchanged
		expect(updated).toContain("- [ ] Run tests");
	});

	it("1.3: partial adds annotation to checked checkbox", () => {
		const dir = makeTestDir("partial-checked");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [x] Implement feature C",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature C", "partial", "Only half the requirements met"),
		]);

		expect(result.changed).toBe(1);

		const updated = readStatus(dir);
		// Should be unchecked with partial annotation
		expect(updated).toContain("- [ ] Implement feature C (partial)");
	});

	it("1.4: partial adds annotation to already-unchecked checkbox", () => {
		const dir = makeTestDir("partial-unchecked");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [ ] Implement feature D",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature D", "partial", "Partially done"),
		]);

		expect(result.changed).toBe(1);

		const updated = readStatus(dir);
		expect(updated).toContain("- [ ] Implement feature D (partial)");
	});

	it("1.5: already correct checked→done is idempotent", () => {
		const dir = makeTestDir("idempotent-done");
		const original = [
			"# Status",
			"- [x] Implement feature E",
		].join("\n");
		const statusPath = writeStatus(dir, original);

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature E", "done", "Confirmed done"),
		]);

		expect(result.changed).toBe(0);
		expect(result.alreadyCorrect).toBe(1);

		// File should not have been rewritten
		const updated = readStatus(dir);
		expect(updated).toBe(original);
	});

	it("1.6: already correct unchecked→not_done is idempotent", () => {
		const dir = makeTestDir("idempotent-notdone");
		const original = [
			"# Status",
			"- [ ] Implement feature F",
		].join("\n");
		const statusPath = writeStatus(dir, original);

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature F", "not_done", "Not started"),
		]);

		expect(result.changed).toBe(0);
		expect(result.alreadyCorrect).toBe(1);

		const updated = readStatus(dir);
		expect(updated).toBe(original);
	});

	it("1.7: multiple reconciliations in one pass", () => {
		const dir = makeTestDir("multi");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [x] Step 1 complete",
			"- [ ] Step 2 pending",
			"- [x] Step 3 complete",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Step 1 complete", "not_done", "Reverted"),
			makeRecon("Step 2 pending", "done", "Actually finished"),
			makeRecon("Step 3 complete", "partial", "Only half done"),
		]);

		expect(result.changed).toBe(3);

		const updated = readStatus(dir);
		expect(updated).toContain("- [ ] Step 1 complete");
		expect(updated).toContain("- [x] Step 2 pending");
		expect(updated).toContain("- [ ] Step 3 complete (partial)");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Reconciliation edge cases
// ══════════════════════════════════════════════════════════════════════

describe("2.x: Reconciliation edge cases", () => {
	it("2.1: duplicate match — first match wins, second is unmatched", () => {
		const dir = makeTestDir("duplicate");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [x] Implement feature",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature", "not_done", "First entry"),
			makeRecon("Implement feature", "done", "Second entry — duplicate"),
		]);

		// First entry should match and change the checkbox
		expect(result.changed).toBe(1);
		// Second entry should be unmatched (line already consumed)
		expect(result.unmatched).toBe(1);

		const updated = readStatus(dir);
		expect(updated).toContain("- [ ] Implement feature");
	});

	it("2.2: unmatched entry when no checkbox text matches", () => {
		const dir = makeTestDir("unmatched");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [x] Build the parser",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Deploy to production", "not_done", "Not deployed"),
		]);

		expect(result.changed).toBe(0);
		expect(result.unmatched).toBe(1);
		expect(result.actions[0].outcome).toBe("unmatched");
		expect(result.actions[0].reason).toContain("No matching checkbox");
	});

	it("2.3: empty reconciliation array is a no-op", () => {
		const dir = makeTestDir("empty");
		const original = "# Status\n- [x] Done";
		const statusPath = writeStatus(dir, original);

		const result = applyStatusReconciliation(statusPath, []);

		expect(result.changed).toBe(0);
		expect(result.alreadyCorrect).toBe(0);
		expect(result.unmatched).toBe(0);
		expect(result.actions).toHaveLength(0);

		// File should be unchanged
		expect(readStatus(dir)).toBe(original);
	});

	it("2.4: null/undefined reconciliation array is a no-op", () => {
		const dir = makeTestDir("null");
		const statusPath = writeStatus(dir, "# Status\n- [x] Done");

		const result = applyStatusReconciliation(statusPath, null as any);
		expect(result.changed).toBe(0);
		expect(result.actions).toHaveLength(0);

		const result2 = applyStatusReconciliation(statusPath, undefined as any);
		expect(result2.changed).toBe(0);
	});

	it("2.5: missing STATUS.md — all entries are unmatched", () => {
		const dir = makeTestDir("missing-status");
		const statusPath = join(dir, "STATUS.md");
		// Don't create the file

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Step 1", "not_done", "No STATUS.md"),
			makeRecon("Step 2", "done", "No STATUS.md"),
		]);

		expect(result.changed).toBe(0);
		expect(result.unmatched).toBe(2);
		expect(result.actions[0].reason).toContain("STATUS.md not found");
	});

	it("2.6: partial annotation on already-unchecked item — adds annotation", () => {
		const dir = makeTestDir("partial-already-unchecked");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [ ] Implement feature G",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature G", "partial", "Work in progress"),
		]);

		expect(result.changed).toBe(1);

		const updated = readStatus(dir);
		expect(updated).toContain("- [ ] Implement feature G (partial)");
	});

	it("2.7: partial annotation already present — idempotent", () => {
		const dir = makeTestDir("partial-already-annotated");
		const original = "# Status\n- [ ] Implement feature H (partial)";
		const statusPath = writeStatus(dir, original);

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature H", "partial", "Still partial"),
		]);

		// The checkbox is already unchecked and has (partial) — should be idempotent
		expect(result.alreadyCorrect).toBe(1);
		expect(result.changed).toBe(0);
	});

	it("2.8: empty checkbox text after normalization — unmatched", () => {
		const dir = makeTestDir("empty-checkbox");
		const statusPath = writeStatus(dir, "# Status\n- [x] Real item");

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("", "not_done", "Empty text"),
		]);

		expect(result.unmatched).toBe(1);
		expect(result.actions[0].reason).toContain("Empty checkbox text");
	});

	it("2.9: fuzzy matching handles markdown formatting differences", () => {
		const dir = makeTestDir("fuzzy");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [x] **Implement** `feature` I",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Implement feature I", "not_done", "Not actually done"),
		]);

		// Should match despite bold/code formatting in STATUS.md
		expect(result.changed).toBe(1);

		const updated = readStatus(dir);
		// The line should now be unchecked
		expect(updated).toMatch(/- \[ \] \*\*Implement\*\* `feature` I/);
	});

	it("2.10: case-insensitive matching", () => {
		const dir = makeTestDir("case");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [x] Implement Feature J",
		].join("\n"));

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("implement feature j", "not_done", "Case mismatch"),
		]);

		expect(result.changed).toBe(1);
	});

	it("2.11: idempotent no-rewrite when all entries already correct", () => {
		const dir = makeTestDir("all-correct");
		const original = [
			"# Status",
			"- [x] Step 1 done",
			"- [ ] Step 2 pending",
		].join("\n");
		const statusPath = writeStatus(dir, original);

		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Step 1 done", "done", "Confirmed"),
			makeRecon("Step 2 pending", "not_done", "Not started"),
		]);

		expect(result.changed).toBe(0);
		expect(result.alreadyCorrect).toBe(2);

		// File should not have been rewritten
		expect(readStatus(dir)).toBe(original);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Reconciliation guard: quality gate enabled check
// ══════════════════════════════════════════════════════════════════════

describe("3.x: Reconciliation guard — gate enabled check", () => {
	// The guard logic lives in task-runner.ts (not in applyStatusReconciliation
	// itself). These tests verify the contract that task-runner uses:
	// reconciliation only runs when:
	//   1. Quality gate is enabled (config.quality_gate.enabled === true)
	//   2. verdict.statusReconciliation.length > 0
	// When the gate is disabled, the entire quality gate code path is skipped
	// (the else branch creates .DONE directly). We verify the config default
	// and the guard conditions the task-runner checks.

	it("3.1: quality gate disabled by default — reconciliation never reached", () => {
		// Import the config loader to verify the default
		const { loadProjectConfig, toTaskConfig } = require("../taskplane/config-loader.ts");
		const dir = makeTestDir("guard-disabled");
		const config = loadProjectConfig(dir);
		const taskConfig = toTaskConfig(config);

		expect(taskConfig.quality_gate.enabled).toBe(false);
		// When false, task-runner goes to the else branch and creates .DONE
		// without ever calling readAndEvaluateVerdict or applyStatusReconciliation
	});

	it("3.2: empty reconciliation array — guard skips (zero entries)", () => {
		// Even when quality gate is enabled, if the verdict has no
		// statusReconciliation entries, the guard `if (verdict.statusReconciliation.length > 0)`
		// in task-runner.ts skips the call.
		const dir = makeTestDir("guard-empty");
		const statusPath = writeStatus(dir, "# Status\n- [x] Step 1");

		// Calling applyStatusReconciliation directly with empty array = no-op
		const result = applyStatusReconciliation(statusPath, []);
		expect(result.changed).toBe(0);
		expect(result.actions).toHaveLength(0);
	});

	it("3.3: reconciliation only applies with non-empty entries (positive guard)", () => {
		const dir = makeTestDir("guard-positive");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [x] Feature implemented",
		].join("\n"));

		// Simulates the case where quality gate IS enabled and verdict has entries
		const result = applyStatusReconciliation(statusPath, [
			makeRecon("Feature implemented", "not_done", "No evidence of implementation"),
		]);

		expect(result.changed).toBe(1);
		expect(result.actions[0].outcome).toBe("unchecked");
	});

	it("3.4: reconciliation is idempotent across multiple calls (same input)", () => {
		const dir = makeTestDir("guard-idempotent");
		const statusPath = writeStatus(dir, [
			"# Status",
			"- [x] Build feature",
		].join("\n"));

		const entries = [makeRecon("Build feature", "not_done", "Not built")];

		// First call changes it
		const result1 = applyStatusReconciliation(statusPath, entries);
		expect(result1.changed).toBe(1);

		// Second call with same entries — already unchecked, so no change
		const result2 = applyStatusReconciliation(statusPath, entries);
		expect(result2.changed).toBe(0);
		expect(result2.alreadyCorrect).toBe(1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Artifact staging allowlist: task-owned files only
// ══════════════════════════════════════════════════════════════════════

describe("4.x: Artifact staging allowlist", () => {
	// The artifact staging allowlist is inline in mergeWaveByRepo() in merge.ts.
	// These tests verify the policy constants and the path containment logic
	// used by the staging code. Since the merge function requires full git
	// worktree infrastructure, we test the policy decisions that drive staging.

	it("4.1: allowlisted artifact names are exactly .DONE, STATUS.md, REVIEW_VERDICT.json", () => {
		// This test documents the allowlist contract from TP-035.
		// If the allowlist changes, this test must be updated intentionally.
		const EXPECTED_ARTIFACTS = [".DONE", "STATUS.md", "REVIEW_VERDICT.json"];

		// Verify by reading the merge.ts source to confirm the constant
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"), "utf-8",
		);

		// Extract the ALLOWED_ARTIFACT_NAMES array from source
		const match = mergeSource.match(/ALLOWED_ARTIFACT_NAMES\s*=\s*\[([^\]]+)\]/);
		expect(match).not.toBeNull();

		const arrayContent = match![1];
		for (const name of EXPECTED_ARTIFACTS) {
			expect(arrayContent).toContain(`"${name}"`);
		}

		// Ensure no additional entries beyond the expected three
		const quoted = arrayContent.match(/"[^"]+"/g) || [];
		expect(quoted).toHaveLength(EXPECTED_ARTIFACTS.length);
	});

	it("4.2: task folder relative paths are computed correctly for allowlist", () => {
		// The staging code uses resolve + relative to compute repo-root-relative paths.
		// Verify this logic produces correct results.
		const repoRoot = resolve(testRoot, "repo");
		const taskFolder = resolve(repoRoot, "taskplane-tasks", "TP-035-test");

		const relFolder = relative(repoRoot, taskFolder).replace(/\\/g, "/");
		expect(relFolder).toBe("taskplane-tasks/TP-035-test");

		// Allowlisted paths are constructed as `relFolder/name`
		const expected = [
			"taskplane-tasks/TP-035-test/.DONE",
			"taskplane-tasks/TP-035-test/STATUS.md",
			"taskplane-tasks/TP-035-test/REVIEW_VERDICT.json",
		];
		const ALLOWED_NAMES = [".DONE", "STATUS.md", "REVIEW_VERDICT.json"];
		const actual = ALLOWED_NAMES.map(name => `${relFolder}/${name}`);
		expect(actual).toEqual(expected);
	});

	it("4.3: only existing allowlisted files would be staged", () => {
		// Simulate the staging logic: iterate allowlisted paths, skip non-existent
		const repoRoot = makeTestDir("stage-existing");
		const taskFolder = join(repoRoot, "tasks", "TP-STAGE");
		mkdirSync(taskFolder, { recursive: true });

		// Create only .DONE and STATUS.md — not REVIEW_VERDICT.json
		writeFileSync(join(taskFolder, ".DONE"), "done", "utf-8");
		writeFileSync(join(taskFolder, "STATUS.md"), "status", "utf-8");

		const ALLOWED_NAMES = [".DONE", "STATUS.md", "REVIEW_VERDICT.json"];
		const relFolder = relative(repoRoot, taskFolder).replace(/\\/g, "/");

		let staged = 0;
		let skipped = 0;
		for (const name of ALLOWED_NAMES) {
			const srcPath = join(repoRoot, relFolder, name);
			if (existsSync(srcPath)) {
				staged++;
			} else {
				skipped++;
			}
		}

		expect(staged).toBe(2);   // .DONE and STATUS.md exist
		expect(skipped).toBe(1);  // REVIEW_VERDICT.json doesn't exist
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Artifact staging rejection: outside-task, repo-escape, no-op
// ══════════════════════════════════════════════════════════════════════

describe("5.x: Artifact staging rejection", () => {
	it("5.1: path outside repo root (repo-escape) is rejected", () => {
		// The staging code checks: relFolder.startsWith("..") || relFolder.startsWith("/")
		const repoRoot = resolve(testRoot, "repo");
		const escapedFolder = resolve(testRoot, "outside-repo", "evil-task");

		const relFolder = relative(repoRoot, escapedFolder).replace(/\\/g, "/");

		// Should start with ".." — this is how the merge code detects escape
		expect(relFolder.startsWith("..")).toBe(true);
	});

	it("5.2: absolute path outside repo is rejected", () => {
		const repoRoot = resolve(testRoot, "repo");
		// On Windows or Unix, an absolute path outside repo produces a .. relative
		const outsidePath = resolve(testRoot, "completely-elsewhere");

		const relFolder = relative(repoRoot, outsidePath).replace(/\\/g, "/");
		// Must either start with ".." or be absolute (starts with /)
		const isEscape = relFolder.startsWith("..") || relFolder.startsWith("/");
		expect(isEscape).toBe(true);
	});

	it("5.3: no-op when zero allowlisted files exist", () => {
		// Simulate: task folder exists but has no allowlisted artifacts
		const repoRoot = makeTestDir("no-artifacts");
		const taskFolder = join(repoRoot, "tasks", "TP-EMPTY");
		mkdirSync(taskFolder, { recursive: true });

		// Write some non-allowlisted file
		writeFileSync(join(taskFolder, "random.txt"), "not an artifact", "utf-8");

		const ALLOWED_NAMES = [".DONE", "STATUS.md", "REVIEW_VERDICT.json"];
		const relFolder = relative(repoRoot, taskFolder).replace(/\\/g, "/");

		let staged = 0;
		for (const name of ALLOWED_NAMES) {
			const srcPath = join(repoRoot, relFolder, name);
			if (existsSync(srcPath)) {
				staged++;
			}
		}

		expect(staged).toBe(0);
		// In the merge code, staged === 0 → log "no task artifacts to stage" and skip git commit
	});

	it("5.4: non-allowlisted files in task folder are not staged", () => {
		// Files like PROMPT.md, .reviews/, random outputs should NOT be staged
		const repoRoot = makeTestDir("non-allowed");
		const taskFolder = join(repoRoot, "tasks", "TP-FILTER");
		mkdirSync(taskFolder, { recursive: true });

		// Create both allowlisted and non-allowlisted files
		writeFileSync(join(taskFolder, ".DONE"), "done", "utf-8");
		writeFileSync(join(taskFolder, "STATUS.md"), "status", "utf-8");
		writeFileSync(join(taskFolder, "PROMPT.md"), "prompt", "utf-8");
		writeFileSync(join(taskFolder, "random.log"), "logs", "utf-8");
		mkdirSync(join(taskFolder, ".reviews"), { recursive: true });
		writeFileSync(join(taskFolder, ".reviews", "R001.md"), "review", "utf-8");

		const ALLOWED_NAMES = [".DONE", "STATUS.md", "REVIEW_VERDICT.json"];
		const relFolder = relative(repoRoot, taskFolder).replace(/\\/g, "/");

		const stagedPaths: string[] = [];
		for (const name of ALLOWED_NAMES) {
			const srcPath = join(repoRoot, relFolder, name);
			if (existsSync(srcPath)) {
				stagedPaths.push(`${relFolder}/${name}`);
			}
		}

		// Only .DONE and STATUS.md should be staged (REVIEW_VERDICT.json doesn't exist)
		expect(stagedPaths).toHaveLength(2);
		expect(stagedPaths).toContain("tasks/TP-FILTER/.DONE");
		expect(stagedPaths).toContain("tasks/TP-FILTER/STATUS.md");

		// PROMPT.md, random.log, .reviews/ should NOT appear
		expect(stagedPaths).not.toContain("tasks/TP-FILTER/PROMPT.md");
		expect(stagedPaths).not.toContain("tasks/TP-FILTER/random.log");
	});

	it("5.5: task folder inside repo root passes containment check", () => {
		const repoRoot = resolve(testRoot, "repo");
		const validFolder = resolve(repoRoot, "taskplane-tasks", "TP-VALID");

		const relFolder = relative(repoRoot, validFolder).replace(/\\/g, "/");

		// Should NOT start with ".." or "/"
		expect(relFolder.startsWith("..")).toBe(false);
		expect(relFolder.startsWith("/")).toBe(false);
		expect(relFolder).toBe("taskplane-tasks/TP-VALID");
	});
});
