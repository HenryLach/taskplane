/**
 * TP-177: Validate that polyrepo test workspace PROMPT.md files have
 * correctly formatted segment markers that parse without errors.
 *
 * This test reads the ACTUAL test workspace files and runs them through
 * the discovery parser to verify segment markers are correct.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseStepSegmentMapping, SEGMENT_FALLBACK_REPO_PLACEHOLDER } from "../taskplane/discovery.ts";

const WORKSPACE_ROOT = "C:/dev/tp-test-workspace";
const TASKS_ROOT = resolve(WORKSPACE_ROOT, "shared-libs/task-management/platform/general");

function readPrompt(taskFolder: string): string {
	const promptPath = resolve(TASKS_ROOT, taskFolder, "PROMPT.md");
	if (!existsSync(promptPath)) {
		throw new Error(`PROMPT.md not found: ${promptPath}`);
	}
	return readFileSync(promptPath, "utf-8");
}

describe("TP-177: Polyrepo segment marker validation", () => {
	// ── Single-segment tasks should have NO segment markers ──
	describe("Single-segment tasks (no segment markers expected)", () => {
		for (const task of [
			{ folder: "TP-001-shared-string-utils", id: "TP-001", repo: "shared-libs" },
			{ folder: "TP-002-health-check-endpoint", id: "TP-002", repo: "api-service" },
			{ folder: "TP-003-status-badge-component", id: "TP-003", repo: "web-client" },
		]) {
			it(`${task.id} has no segment markers and all checkboxes go to fallback repo`, () => {
				const content = readPrompt(task.folder);
				const result = parseStepSegmentMapping(content, task.id, task.repo);

				assert.equal(result.errors.length, 0, `Expected no errors, got: ${JSON.stringify(result.errors)}`);
				assert.equal(result.warnings.length, 0, `Expected no warnings, got: ${JSON.stringify(result.warnings)}`);
				assert.ok(result.mapping.length > 0, "Expected at least one step");

				// All segments should use the fallback repo
				for (const step of result.mapping) {
					for (const seg of step.segments) {
						assert.equal(seg.repoId, task.repo, `Step ${step.stepNumber} segment should be ${task.repo}`);
					}
				}
			});
		}
	});

	// ── TP-004: shared-libs → web-client ──
	describe("TP-004: Cross-repo API client (shared-libs → web-client)", () => {
		it("parses without errors", () => {
			const content = readPrompt("TP-004-web-api-client");
			const result = parseStepSegmentMapping(content, "TP-004", "shared-libs");

			assert.equal(result.errors.length, 0, `Errors: ${JSON.stringify(result.errors)}`);
			assert.equal(result.warnings.length, 0, `Warnings: ${JSON.stringify(result.warnings)}`);
		});

		it("has correct step-segment mapping", () => {
			const content = readPrompt("TP-004-web-api-client");
			const result = parseStepSegmentMapping(content, "TP-004", "shared-libs");

			// Step 0: Preflight → shared-libs + web-client
			const step0 = result.mapping.find(s => s.stepNumber === 0);
			assert.ok(step0, "Step 0 must exist");
			assert.equal(step0.segments.length, 2, "Step 0 should have 2 segments");
			assert.equal(step0.segments[0].repoId, "shared-libs");
			assert.ok(step0.segments[0].checkboxes.length > 0, "shared-libs segment has checkboxes");
			assert.equal(step0.segments[1].repoId, "web-client");
			assert.ok(step0.segments[1].checkboxes.length > 0, "web-client segment has checkboxes");

			// Step 1: shared-libs only
			const step1 = result.mapping.find(s => s.stepNumber === 1);
			assert.ok(step1, "Step 1 must exist");
			assert.equal(step1.segments.length, 1, "Step 1 should have 1 segment");
			assert.equal(step1.segments[0].repoId, "shared-libs");
			assert.equal(step1.segments[0].checkboxes.length, 3);

			// Step 2: web-client only
			const step2 = result.mapping.find(s => s.stepNumber === 2);
			assert.ok(step2, "Step 2 must exist");
			assert.equal(step2.segments.length, 1, "Step 2 should have 1 segment");
			assert.equal(step2.segments[0].repoId, "web-client");
			assert.equal(step2.segments[0].checkboxes.length, 4);

			// Step 3: Documentation → shared-libs (packet repo)
			const step3 = result.mapping.find(s => s.stepNumber === 3);
			assert.ok(step3, "Step 3 must exist");
			assert.equal(step3.segments.length, 1, "Step 3 should have 1 segment");
			assert.equal(step3.segments[0].repoId, "shared-libs");
		});
	});

	// ── TP-005: shared-libs → api-service ──
	describe("TP-005: Cross-repo logger middleware (shared-libs → api-service)", () => {
		it("parses without errors", () => {
			const content = readPrompt("TP-005-api-logger-middleware");
			const result = parseStepSegmentMapping(content, "TP-005", "shared-libs");

			assert.equal(result.errors.length, 0, `Errors: ${JSON.stringify(result.errors)}`);
			assert.equal(result.warnings.length, 0, `Warnings: ${JSON.stringify(result.warnings)}`);
		});

		it("has correct step-segment mapping", () => {
			const content = readPrompt("TP-005-api-logger-middleware");
			const result = parseStepSegmentMapping(content, "TP-005", "shared-libs");

			// Step 0: Preflight → shared-libs + api-service
			const step0 = result.mapping.find(s => s.stepNumber === 0);
			assert.ok(step0, "Step 0 must exist");
			assert.equal(step0.segments.length, 2);
			assert.equal(step0.segments[0].repoId, "shared-libs");
			assert.equal(step0.segments[1].repoId, "api-service");

			// Step 1: shared-libs only
			const step1 = result.mapping.find(s => s.stepNumber === 1);
			assert.ok(step1, "Step 1 must exist");
			assert.equal(step1.segments.length, 1);
			assert.equal(step1.segments[0].repoId, "shared-libs");
			assert.equal(step1.segments[0].checkboxes.length, 4);

			// Step 2: api-service only
			const step2 = result.mapping.find(s => s.stepNumber === 2);
			assert.ok(step2, "Step 2 must exist");
			assert.equal(step2.segments.length, 1);
			assert.equal(step2.segments[0].repoId, "api-service");
			assert.equal(step2.segments[0].checkboxes.length, 4);

			// Step 3: Documentation → shared-libs
			const step3 = result.mapping.find(s => s.stepNumber === 3);
			assert.ok(step3, "Step 3 must exist");
			assert.equal(step3.segments.length, 1);
			assert.equal(step3.segments[0].repoId, "shared-libs");
		});
	});

	// ── TP-006: shared-libs → api-service + web-client ──
	describe("TP-006: Integration docs (3-repo fan-out)", () => {
		it("parses without errors", () => {
			const content = readPrompt("TP-006-integration-readme");
			const result = parseStepSegmentMapping(content, "TP-006", "shared-libs");

			assert.equal(result.errors.length, 0, `Errors: ${JSON.stringify(result.errors)}`);
			assert.equal(result.warnings.length, 0, `Warnings: ${JSON.stringify(result.warnings)}`);
		});

		it("has correct step-segment mapping for 3-repo task", () => {
			const content = readPrompt("TP-006-integration-readme");
			const result = parseStepSegmentMapping(content, "TP-006", "shared-libs");

			// Step 0: Preflight → shared-libs + api-service + web-client
			const step0 = result.mapping.find(s => s.stepNumber === 0);
			assert.ok(step0, "Step 0 must exist");
			assert.equal(step0.segments.length, 3, "Step 0 should have 3 segments");
			const step0Repos = step0.segments.map(s => s.repoId).sort();
			assert.deepEqual(step0Repos, ["api-service", "shared-libs", "web-client"]);

			// Step 1: shared-libs only
			const step1 = result.mapping.find(s => s.stepNumber === 1);
			assert.ok(step1, "Step 1 must exist");
			assert.equal(step1.segments.length, 1);
			assert.equal(step1.segments[0].repoId, "shared-libs");
			assert.equal(step1.segments[0].checkboxes.length, 3);

			// Step 2: api-service only
			const step2 = result.mapping.find(s => s.stepNumber === 2);
			assert.ok(step2, "Step 2 must exist");
			assert.equal(step2.segments.length, 1);
			assert.equal(step2.segments[0].repoId, "api-service");
			assert.equal(step2.segments[0].checkboxes.length, 2);

			// Step 3: web-client only
			const step3 = result.mapping.find(s => s.stepNumber === 3);
			assert.ok(step3, "Step 3 must exist");
			assert.equal(step3.segments.length, 1);
			assert.equal(step3.segments[0].repoId, "web-client");
			assert.equal(step3.segments[0].checkboxes.length, 2);

			// Step 4: Documentation → shared-libs
			const step4 = result.mapping.find(s => s.stepNumber === 4);
			assert.ok(step4, "Step 4 must exist");
			assert.equal(step4.segments.length, 1);
			assert.equal(step4.segments[0].repoId, "shared-libs");
		});
	});

	// ── Verify .reset-snapshots STATUS.md files have segment markers ──
	describe("Reset snapshot STATUS.md segment markers exist", () => {
		const SNAPSHOTS_ROOT = resolve(WORKSPACE_ROOT, ".reset-snapshots/general");

		for (const task of [
			{
				folder: "TP-004-web-api-client",
				id: "TP-004",
				expectedSegments: ["shared-libs", "web-client"],
			},
			{
				folder: "TP-005-api-logger-middleware",
				id: "TP-005",
				expectedSegments: ["shared-libs", "api-service"],
			},
			{
				folder: "TP-006-integration-readme",
				id: "TP-006",
				expectedSegments: ["shared-libs", "api-service", "web-client"],
			},
		]) {
			it(`${task.id} STATUS.md has #### Segment: markers for all expected repos`, () => {
				const statusPath = resolve(SNAPSHOTS_ROOT, task.folder, "STATUS.md");
				assert.ok(existsSync(statusPath), `STATUS.md must exist at ${statusPath}`);
				const statusContent = readFileSync(statusPath, "utf-8");

				// Extract all segment markers from STATUS.md
				const segmentRegex = /^####\s+Segment:\s*(.+)$/gm;
				const foundSegments = new Set<string>();
				let m: RegExpExecArray | null;
				while ((m = segmentRegex.exec(statusContent)) !== null) {
					foundSegments.add(m[1].trim());
				}

				// Each expected segment should appear at least once
				for (const expected of task.expectedSegments) {
					assert.ok(
						foundSegments.has(expected),
						`STATUS.md should contain #### Segment: ${expected}. Found: ${[...foundSegments].join(", ")}`
					);
				}
			});

			it(`${task.id} STATUS.md has checkboxes under each segment`, () => {
				const statusPath = resolve(SNAPSHOTS_ROOT, task.folder, "STATUS.md");
				const statusContent = readFileSync(statusPath, "utf-8");
				const lines = statusContent.split(/\r?\n/);

				// For each segment marker, verify there are checkboxes below it
				for (const seg of task.expectedSegments) {
					const segHeaderPattern = new RegExp(`^####\\s+Segment:\\s*${seg}\\s*$`);
					const segHeaderIdx = lines.findIndex(l => segHeaderPattern.test(l));
					assert.ok(segHeaderIdx >= 0, `Should find #### Segment: ${seg} header line`);

					// Count checkboxes from the header line until next header or end
					let checkboxCount = 0;
					for (let k = segHeaderIdx + 1; k < lines.length; k++) {
						if (/^#{2,4}\s+/.test(lines[k])) break; // Next header
						if (/^\s*-\s+\[[ x]\]/.test(lines[k])) checkboxCount++;
					}
					assert.ok(
						checkboxCount > 0,
						`Segment ${seg} in STATUS.md should have at least one checkbox, found ${checkboxCount}`
					);
				}
			});
		}
	});
});
