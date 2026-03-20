/**
 * Quality Gate Tests — TP-034
 *
 * Tests for verdict parsing, verdict rule evaluation, config adapter
 * integration, fail-open coverage, feedback generation, and
 * readAndEvaluateVerdict integration.
 *
 * Test categories:
 *   1.x  — parseVerdict fail-open behavior
 *   2.x  — applyVerdictRules evaluation
 *   3.x  — Config defaults and adapter mapping
 *   4.x  — readAndEvaluateVerdict fail-open integration (missing/unreadable verdict file)
 *   5.x  — generateFeedbackMd (threshold-aware)
 *   6.x  — buildFixAgentPrompt
 *   7.x  — Verdict rules threshold matrix (no_critical, no_important, all_clear)
 *   8.x  — .DONE creation contract tests (disabled/enabled/pass/fail behavior)
 *   9.x  — Remediation cycle determinism (NEEDS_FIXES triggers fix, budget consumption)
 *   10.x — generateQualityGatePrompt evidence packaging
 *
 * Run: npx vitest run tests/quality-gate.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
	parseVerdict,
	applyVerdictRules,
	readAndEvaluateVerdict,
	generateFeedbackMd,
	buildFixAgentPrompt,
	generateQualityGatePrompt,
	VERDICT_FILENAME,
	FEEDBACK_FILENAME,
	type ReviewVerdict,
	type ReviewFinding,
	type VerdictEvaluation,
	type QualityGateContext,
} from "../taskplane/quality-gate.ts";
import { loadProjectConfig, toTaskConfig } from "../taskplane/config-loader.ts";
import { DEFAULT_TASK_RUNNER_SECTION } from "../taskplane/config-schema.ts";
import type { PassThreshold } from "../taskplane/config-schema.ts";

// ── Fixture Helpers ──────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `qg-${counter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writePiFile(root: string, filename: string, content: string): void {
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, filename), content, "utf-8");
}

function writeTaskRunnerYaml(root: string, content: string): void {
	writePiFile(root, "task-runner.yaml", content);
}

function writeJsonConfig(root: string, obj: any): void {
	writePiFile(root, "taskplane-config.json", JSON.stringify(obj, null, 2));
}

// ── Setup / Teardown ─────────────────────────────────────────────────

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-qg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	try { rmSync(testRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Helper: make a minimal valid verdict JSON ────────────────────────

function makeVerdictJson(overrides: Record<string, unknown> = {}): string {
	const base = {
		verdict: "PASS",
		confidence: "high",
		summary: "All good",
		findings: [],
		statusReconciliation: [],
		...overrides,
	};
	return JSON.stringify(base);
}

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
	return {
		severity: "suggestion",
		category: "incomplete_work",
		description: "test finding",
		file: "",
		remediation: "",
		...overrides,
	};
}

function makeVerdict(overrides: Partial<ReviewVerdict> = {}): ReviewVerdict {
	return {
		verdict: "PASS",
		confidence: "high",
		summary: "",
		findings: [],
		statusReconciliation: [],
		...overrides,
	};
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — parseVerdict fail-open behavior
// ══════════════════════════════════════════════════════════════════════

describe("1.x: parseVerdict", () => {
	it("1.1: null input returns synthetic PASS", () => {
		const v = parseVerdict(null);
		expect(v.verdict).toBe("PASS");
		expect(v.confidence).toBe("low");
		expect(v.summary).toContain("fail-open");
	});

	it("1.2: undefined input returns synthetic PASS", () => {
		const v = parseVerdict(undefined);
		expect(v.verdict).toBe("PASS");
	});

	it("1.3: empty string returns synthetic PASS", () => {
		const v = parseVerdict("");
		expect(v.verdict).toBe("PASS");
	});

	it("1.4: whitespace-only string returns synthetic PASS", () => {
		const v = parseVerdict("   \n  ");
		expect(v.verdict).toBe("PASS");
	});

	it("1.5: invalid JSON returns synthetic PASS", () => {
		const v = parseVerdict("{not valid json}}}");
		expect(v.verdict).toBe("PASS");
		expect(v.summary).toContain("fail-open");
	});

	it("1.6: JSON with invalid verdict value returns synthetic PASS", () => {
		const v = parseVerdict(JSON.stringify({ verdict: "UNKNOWN", findings: [] }));
		expect(v.verdict).toBe("PASS");
	});

	it("1.7: JSON array returns synthetic PASS", () => {
		const v = parseVerdict(JSON.stringify([1, 2, 3]));
		expect(v.verdict).toBe("PASS");
	});

	it("1.8: valid PASS verdict parsed correctly", () => {
		const v = parseVerdict(makeVerdictJson({
			verdict: "PASS",
			confidence: "high",
			summary: "Looks good",
		}));
		expect(v.verdict).toBe("PASS");
		expect(v.confidence).toBe("high");
		expect(v.summary).toBe("Looks good");
		expect(v.findings).toEqual([]);
	});

	it("1.9: valid NEEDS_FIXES verdict parsed with findings", () => {
		const v = parseVerdict(makeVerdictJson({
			verdict: "NEEDS_FIXES",
			findings: [
				{ severity: "critical", category: "incorrect_implementation", description: "Bug found", file: "foo.ts", remediation: "fix it" },
				{ severity: "suggestion", category: "incomplete_work", description: "Style issue", file: "bar.ts", remediation: "" },
			],
		}));
		expect(v.verdict).toBe("NEEDS_FIXES");
		expect(v.findings).toHaveLength(2);
		expect(v.findings[0].severity).toBe("critical");
		expect(v.findings[0].category).toBe("incorrect_implementation");
		expect(v.findings[1].file).toBe("bar.ts");
	});

	it("1.10: findings with invalid severity are dropped", () => {
		const v = parseVerdict(makeVerdictJson({
			findings: [
				{ severity: "critical", category: "incorrect_implementation", description: "valid", file: "", remediation: "" },
				{ severity: "banana", category: "incorrect_implementation", description: "invalid severity", file: "", remediation: "" },
			],
		}));
		expect(v.findings).toHaveLength(1);
		expect(v.findings[0].severity).toBe("critical");
	});

	it("1.11: findings with invalid category are dropped", () => {
		const v = parseVerdict(makeVerdictJson({
			findings: [
				{ severity: "important", category: "weird_cat", description: "unknown cat", file: "", remediation: "" },
			],
		}));
		expect(v.findings).toHaveLength(0);
	});

	it("1.12: invalid confidence defaults to medium", () => {
		const v = parseVerdict(makeVerdictJson({ confidence: "extreme" }));
		expect(v.confidence).toBe("medium");
	});

	it("1.13: statusReconciliation entries parsed", () => {
		const v = parseVerdict(makeVerdictJson({
			statusReconciliation: [
				{ checkbox: "Step 2 checkbox", actualState: "not_done", evidence: "tests failing" },
			],
		}));
		expect(v.statusReconciliation).toHaveLength(1);
		expect(v.statusReconciliation[0].checkbox).toBe("Step 2 checkbox");
		expect(v.statusReconciliation[0].actualState).toBe("not_done");
	});

	it("1.14: statusReconciliation entry with invalid actualState is dropped", () => {
		const v = parseVerdict(makeVerdictJson({
			statusReconciliation: [
				{ checkbox: "Step 1", actualState: "unknown_state", evidence: "n/a" },
			],
		}));
		expect(v.statusReconciliation).toHaveLength(0);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — applyVerdictRules evaluation
// ══════════════════════════════════════════════════════════════════════

describe("2.x: applyVerdictRules", () => {
	it("2.1: empty findings → pass (no_critical threshold)", () => {
		const result = applyVerdictRules(makeVerdict(), "no_critical");
		expect(result.pass).toBe(true);
		expect(result.failReasons).toHaveLength(0);
	});

	it("2.2: any critical finding → fail", () => {
		const result = applyVerdictRules(
			makeVerdict({ findings: [makeFinding({ severity: "critical", category: "incorrect_implementation" })] }),
			"no_critical",
		);
		expect(result.pass).toBe(false);
		expect(result.failReasons.some((r) => r.rule === "critical_finding")).toBe(true);
	});

	it("2.3: 3+ important findings with no_important threshold → fail", () => {
		const findings = [
			makeFinding({ severity: "important", category: "missing_requirement", description: "a" }),
			makeFinding({ severity: "important", category: "missing_requirement", description: "b" }),
			makeFinding({ severity: "important", category: "missing_requirement", description: "c" }),
		];
		const result = applyVerdictRules(makeVerdict({ findings }), "no_important");
		expect(result.pass).toBe(false);
		expect(result.failReasons.some((r) => r.rule === "important_threshold")).toBe(true);
	});

	it("2.4: 2 important findings → pass with no_critical threshold", () => {
		const findings = [
			makeFinding({ severity: "important", category: "missing_requirement", description: "a" }),
			makeFinding({ severity: "important", category: "missing_requirement", description: "b" }),
		];
		const result = applyVerdictRules(makeVerdict({ findings }), "no_critical");
		expect(result.pass).toBe(true);
	});

	it("2.5: suggestions only → pass with no_critical threshold", () => {
		const findings = [makeFinding({ severity: "suggestion" })];
		const result = applyVerdictRules(makeVerdict({ findings }), "no_critical");
		expect(result.pass).toBe(true);
	});

	it("2.6: suggestions only → pass with no_important threshold", () => {
		const findings = [makeFinding({ severity: "suggestion" })];
		const result = applyVerdictRules(makeVerdict({ findings }), "no_important");
		expect(result.pass).toBe(true);
	});

	it("2.7: suggestions present → fail with all_clear threshold", () => {
		const findings = [makeFinding({ severity: "suggestion" })];
		const result = applyVerdictRules(makeVerdict({ findings }), "all_clear");
		expect(result.pass).toBe(false);
	});

	it("2.8: empty findings → pass with all_clear threshold", () => {
		const result = applyVerdictRules(makeVerdict(), "all_clear");
		expect(result.pass).toBe(true);
	});

	it("2.9: status_mismatch category in findings → fail", () => {
		const v = makeVerdict({
			findings: [makeFinding({ severity: "suggestion", category: "status_mismatch", description: "mismatch" })],
		});
		const result = applyVerdictRules(v, "no_critical");
		expect(result.pass).toBe(false);
		expect(result.failReasons.some((r) => r.rule === "status_mismatch")).toBe(true);
	});

	it("2.10: NEEDS_FIXES verdict with no rule-triggering findings → fail via verdict_says_needs_fixes", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			summary: "Reviewer says no",
			findings: [],
		});
		const result = applyVerdictRules(v, "no_critical");
		expect(result.pass).toBe(false);
		expect(result.failReasons.some((r) => r.rule === "verdict_says_needs_fixes")).toBe(true);
	});

	it("2.11: PASS verdict with no findings → pass", () => {
		const v = makeVerdict({ verdict: "PASS" });
		const result = applyVerdictRules(v, "no_critical");
		expect(result.pass).toBe(true);
		expect(result.failReasons).toHaveLength(0);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Config defaults and adapter mapping
// ══════════════════════════════════════════════════════════════════════

describe("3.x: Quality gate config", () => {
	it("3.1: default qualityGate config in schema defaults", () => {
		expect(DEFAULT_TASK_RUNNER_SECTION.qualityGate).toEqual({
			enabled: false,
			reviewModel: "",
			maxReviewCycles: 2,
			maxFixCycles: 1,
			passThreshold: "no_critical",
		});
	});

	it("3.2: quality gate defaults flow through loadProjectConfig with no YAML", () => {
		const dir = makeTestDir("qg-defaults-no-yaml");
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.qualityGate.enabled).toBe(false);
		expect(config.taskRunner.qualityGate.reviewModel).toBe("");
		expect(config.taskRunner.qualityGate.maxReviewCycles).toBe(2);
		expect(config.taskRunner.qualityGate.maxFixCycles).toBe(1);
		expect(config.taskRunner.qualityGate.passThreshold).toBe("no_critical");
	});

	it("3.3: toTaskConfig adapter maps qualityGate to quality_gate (snake_case)", () => {
		const dir = makeTestDir("qg-adapter");
		const config = loadProjectConfig(dir);
		const taskConfig = toTaskConfig(config);

		expect(taskConfig.quality_gate).toEqual({
			enabled: false,
			review_model: "",
			max_review_cycles: 2,
			max_fix_cycles: 1,
			pass_threshold: "no_critical",
		});
	});

	it("3.4: quality gate YAML settings are loaded and mapped", () => {
		const dir = makeTestDir("qg-yaml");
		writeTaskRunnerYaml(dir, [
			"quality_gate:",
			"  enabled: true",
			"  review_model: anthropic/claude-4-sonnet",
			"  max_review_cycles: 3",
			"  max_fix_cycles: 2",
			"  pass_threshold: no_important",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.qualityGate.enabled).toBe(true);
		expect(config.taskRunner.qualityGate.reviewModel).toBe("anthropic/claude-4-sonnet");
		expect(config.taskRunner.qualityGate.maxReviewCycles).toBe(3);
		expect(config.taskRunner.qualityGate.maxFixCycles).toBe(2);
		expect(config.taskRunner.qualityGate.passThreshold).toBe("no_important");

		// And through the adapter
		const taskConfig = toTaskConfig(config);
		expect(taskConfig.quality_gate.enabled).toBe(true);
		expect(taskConfig.quality_gate.review_model).toBe("anthropic/claude-4-sonnet");
		expect(taskConfig.quality_gate.max_review_cycles).toBe(3);
		expect(taskConfig.quality_gate.max_fix_cycles).toBe(2);
		expect(taskConfig.quality_gate.pass_threshold).toBe("no_important");
	});

	it("3.5: quality gate JSON config settings are loaded and mapped", () => {
		const dir = makeTestDir("qg-json");
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				qualityGate: {
					enabled: true,
					reviewModel: "openai/gpt-5.3-codex",
					maxReviewCycles: 4,
					maxFixCycles: 2,
					passThreshold: "all_clear",
				},
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.qualityGate.enabled).toBe(true);
		expect(config.taskRunner.qualityGate.reviewModel).toBe("openai/gpt-5.3-codex");
		expect(config.taskRunner.qualityGate.maxReviewCycles).toBe(4);
		expect(config.taskRunner.qualityGate.passThreshold).toBe("all_clear");
	});

	it("3.6: partial quality gate YAML merges with defaults", () => {
		const dir = makeTestDir("qg-partial-yaml");
		writeTaskRunnerYaml(dir, [
			"quality_gate:",
			"  enabled: true",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.qualityGate.enabled).toBe(true);
		// All other fields should be defaults
		expect(config.taskRunner.qualityGate.reviewModel).toBe("");
		expect(config.taskRunner.qualityGate.maxReviewCycles).toBe(2);
		expect(config.taskRunner.qualityGate.maxFixCycles).toBe(1);
		expect(config.taskRunner.qualityGate.passThreshold).toBe("no_critical");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — readAndEvaluateVerdict fail-open integration
// ══════════════════════════════════════════════════════════════════════

describe("4.x: readAndEvaluateVerdict fail-open", () => {
	it("4.1: missing verdict file → synthetic PASS", () => {
		const dir = makeTestDir("no-verdict");
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(verdict.confidence).toBe("low");
		expect(verdict.summary).toContain("fail-open");
		expect(evaluation.pass).toBe(true);
	});

	it("4.2: empty verdict file → synthetic PASS", () => {
		const dir = makeTestDir("empty-verdict");
		writeFileSync(join(dir, VERDICT_FILENAME), "", "utf-8");
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(evaluation.pass).toBe(true);
	});

	it("4.3: verdict file with invalid JSON → synthetic PASS", () => {
		const dir = makeTestDir("invalid-json");
		writeFileSync(join(dir, VERDICT_FILENAME), "{ this is not json }", "utf-8");
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(verdict.confidence).toBe("low");
		expect(evaluation.pass).toBe(true);
	});

	it("4.4: verdict file with PASS → pass evaluation", () => {
		const dir = makeTestDir("pass-verdict");
		writeFileSync(join(dir, VERDICT_FILENAME), makeVerdictJson({ verdict: "PASS" }), "utf-8");
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(evaluation.pass).toBe(true);
		expect(evaluation.failReasons).toHaveLength(0);
	});

	it("4.5: verdict file with NEEDS_FIXES and critical finding → fail evaluation", () => {
		const dir = makeTestDir("needs-fixes-critical");
		writeFileSync(join(dir, VERDICT_FILENAME), makeVerdictJson({
			verdict: "NEEDS_FIXES",
			findings: [
				{ severity: "critical", category: "incorrect_implementation", description: "broken", file: "a.ts", remediation: "fix" },
			],
		}), "utf-8");
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("NEEDS_FIXES");
		expect(evaluation.pass).toBe(false);
		expect(evaluation.failReasons.some(r => r.rule === "critical_finding")).toBe(true);
	});

	it("4.6: non-existent directory → synthetic PASS (no crash)", () => {
		const { verdict, evaluation } = readAndEvaluateVerdict(
			join(testRoot, "completely-nonexistent-directory"), "no_critical",
		);
		expect(verdict.verdict).toBe("PASS");
		expect(evaluation.pass).toBe(true);
	});

	it("4.7: verdict file with only suggestions under no_critical → pass", () => {
		const dir = makeTestDir("suggestions-only");
		writeFileSync(join(dir, VERDICT_FILENAME), makeVerdictJson({
			verdict: "PASS",
			findings: [
				{ severity: "suggestion", category: "incomplete_work", description: "minor", file: "", remediation: "" },
			],
		}), "utf-8");
		const { evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(evaluation.pass).toBe(true);
	});

	it("4.8: verdict file with suggestions under all_clear → fail", () => {
		const dir = makeTestDir("suggestions-all-clear");
		writeFileSync(join(dir, VERDICT_FILENAME), makeVerdictJson({
			verdict: "PASS",
			findings: [
				{ severity: "suggestion", category: "incomplete_work", description: "minor", file: "", remediation: "" },
			],
		}), "utf-8");
		const { evaluation } = readAndEvaluateVerdict(dir, "all_clear");
		expect(evaluation.pass).toBe(false);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — generateFeedbackMd (threshold-aware)
// ══════════════════════════════════════════════════════════════════════

describe("5.x: generateFeedbackMd", () => {
	it("5.1: includes critical and important findings", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			confidence: "high",
			summary: "Issues found",
			findings: [
				makeFinding({ severity: "critical", category: "incorrect_implementation", description: "Critical bug" }),
				makeFinding({ severity: "important", category: "missing_requirement", description: "Missing feature" }),
				makeFinding({ severity: "suggestion", category: "incomplete_work", description: "Style nit" }),
			],
		});
		const md = generateFeedbackMd(v, 1, 2, "no_critical");
		expect(md).toContain("Critical Findings (1)");
		expect(md).toContain("Critical bug");
		expect(md).toContain("Important Findings (1)");
		expect(md).toContain("Missing feature");
		// Suggestions should NOT appear under no_critical
		expect(md).not.toContain("Suggestion Findings");
		expect(md).not.toContain("Style nit");
	});

	it("5.2: includes suggestions under all_clear threshold", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			confidence: "medium",
			summary: "Not perfect",
			findings: [
				makeFinding({ severity: "suggestion", category: "incomplete_work", description: "Consider renaming" }),
				makeFinding({ severity: "suggestion", category: "incomplete_work", description: "Add a comment" }),
			],
		});
		const md = generateFeedbackMd(v, 1, 2, "all_clear");
		expect(md).toContain("Suggestion Findings (2)");
		expect(md).toContain("Consider renaming");
		expect(md).toContain("Add a comment");
		expect(md).toContain("all_clear");
		expect(md).toContain("suggestions are also blocking");
	});

	it("5.3: excludes suggestions under no_important threshold", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			findings: [
				makeFinding({ severity: "important", category: "missing_requirement", description: "Must fix" }),
				makeFinding({ severity: "suggestion", category: "incomplete_work", description: "Nice to have" }),
			],
		});
		const md = generateFeedbackMd(v, 1, 2, "no_important");
		expect(md).toContain("Important Findings (1)");
		expect(md).not.toContain("Suggestion Findings");
		expect(md).not.toContain("Nice to have");
	});

	it("5.4: includes cycle info in header", () => {
		const v = makeVerdict({ verdict: "NEEDS_FIXES", findings: [] });
		const md = generateFeedbackMd(v, 2, 3, "no_critical");
		expect(md).toContain("Cycle 2/3");
	});

	it("5.5: includes STATUS reconciliation issues", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			findings: [makeFinding({ severity: "critical", category: "status_mismatch", description: "mismatch" })],
			statusReconciliation: [
				{ checkbox: "Step 1 done", actualState: "not_done" as const, evidence: "No code changes" },
			],
		});
		const md = generateFeedbackMd(v, 1, 2, "no_critical");
		expect(md).toContain("STATUS.md Reconciliation Issues");
		expect(md).toContain("Step 1 done");
		expect(md).toContain("not_done");
		expect(md).toContain("No code changes");
	});

	it("5.6: no blocking findings shows diagnostic message", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			findings: [],
			statusReconciliation: [],
		});
		const md = generateFeedbackMd(v, 1, 2, "no_critical");
		expect(md).toContain("No blocking findings");
		expect(md).toContain("threshold or verdict-rule mismatch");
	});

	it("5.7: includes pass threshold in output", () => {
		const v = makeVerdict({ verdict: "NEEDS_FIXES", findings: [] });
		const md = generateFeedbackMd(v, 1, 2, "all_clear");
		expect(md).toContain("`all_clear`");
	});

	it("5.8: includes file and remediation when present", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			findings: [
				makeFinding({
					severity: "critical",
					category: "incorrect_implementation",
					description: "Buffer overflow",
					file: "src/parser.ts",
					remediation: "Add bounds check at line 42",
				}),
			],
		});
		const md = generateFeedbackMd(v, 1, 2, "no_critical");
		expect(md).toContain("`src/parser.ts`");
		expect(md).toContain("Add bounds check at line 42");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — buildFixAgentPrompt
// ══════════════════════════════════════════════════════════════════════

describe("6.x: buildFixAgentPrompt", () => {
	it("6.1: includes task ID and cycle number", () => {
		const dir = makeTestDir("fix-prompt");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "# Task\nDo the thing", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "# Status\nStep 1 done", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-099",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const prompt = buildFixAgentPrompt(ctx, "## Review\nFix this bug", 2);
		expect(prompt).toContain("TP-099");
		expect(prompt).toContain("Fix Cycle 2");
		expect(prompt).toContain("Fix this bug");
	});

	it("6.2: includes PROMPT.md and STATUS.md content", () => {
		const dir = makeTestDir("fix-prompt-content");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "# My Task\nImplement feature X", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "## Step 1\n- [x] Done", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-100",
			projectName: "Project",
			passThreshold: "no_critical",
		};

		const prompt = buildFixAgentPrompt(ctx, "feedback here", 1);
		expect(prompt).toContain("Implement feature X");
		expect(prompt).toContain("- [x] Done");
	});

	it("6.3: handles missing PROMPT.md gracefully", () => {
		const dir = makeTestDir("fix-no-prompt");
		writeFileSync(join(dir, "STATUS.md"), "status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath: join(dir, "PROMPT.md"), // does not exist
			taskId: "TP-101",
			projectName: "Project",
			passThreshold: "no_critical",
		};

		const prompt = buildFixAgentPrompt(ctx, "feedback", 1);
		expect(prompt).toContain("PROMPT.md not found");
	});

	it("6.4: includes rule about not creating .DONE", () => {
		const dir = makeTestDir("fix-no-done");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "task", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-102",
			projectName: "Project",
			passThreshold: "no_critical",
		};

		const prompt = buildFixAgentPrompt(ctx, "feedback", 1);
		expect(prompt).toContain("Do NOT create .DONE");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — Verdict rules threshold matrix
// ══════════════════════════════════════════════════════════════════════

describe("7.x: Verdict rules threshold matrix", () => {
	// ── no_critical threshold ────────────────────────────────────────

	it("7.1: no_critical: 0 critical, 0 important → PASS", () => {
		const result = applyVerdictRules(makeVerdict(), "no_critical");
		expect(result.pass).toBe(true);
	});

	it("7.2: no_critical: 1 critical → FAIL", () => {
		const v = makeVerdict({ findings: [makeFinding({ severity: "critical", category: "incorrect_implementation" })] });
		const result = applyVerdictRules(v, "no_critical");
		expect(result.pass).toBe(false);
		expect(result.failReasons.some(r => r.rule === "critical_finding")).toBe(true);
	});

	it("7.3: no_critical: 5 important → PASS (important not blocked at this threshold)", () => {
		const findings = Array.from({ length: 5 }, (_, i) =>
			makeFinding({ severity: "important", category: "missing_requirement", description: `issue ${i}` }),
		);
		const result = applyVerdictRules(makeVerdict({ findings }), "no_critical");
		expect(result.pass).toBe(true);
	});

	it("7.4: no_critical: 10 suggestions → PASS", () => {
		const findings = Array.from({ length: 10 }, (_, i) =>
			makeFinding({ severity: "suggestion", description: `sug ${i}` }),
		);
		const result = applyVerdictRules(makeVerdict({ findings }), "no_critical");
		expect(result.pass).toBe(true);
	});

	it("7.5: no_critical: status_mismatch → FAIL regardless", () => {
		const v = makeVerdict({
			findings: [makeFinding({ severity: "suggestion", category: "status_mismatch", description: "mismatch" })],
		});
		const result = applyVerdictRules(v, "no_critical");
		expect(result.pass).toBe(false);
		expect(result.failReasons.some(r => r.rule === "status_mismatch")).toBe(true);
	});

	// ── no_important threshold ───────────────────────────────────────

	it("7.6: no_important: 2 important → PASS (under 3)", () => {
		const findings = [
			makeFinding({ severity: "important", category: "missing_requirement", description: "a" }),
			makeFinding({ severity: "important", category: "missing_requirement", description: "b" }),
		];
		const result = applyVerdictRules(makeVerdict({ findings }), "no_important");
		expect(result.pass).toBe(true);
	});

	it("7.7: no_important: 3 important → FAIL (at threshold)", () => {
		const findings = Array.from({ length: 3 }, (_, i) =>
			makeFinding({ severity: "important", category: "missing_requirement", description: `issue ${i}` }),
		);
		const result = applyVerdictRules(makeVerdict({ findings }), "no_important");
		expect(result.pass).toBe(false);
		expect(result.failReasons.some(r => r.rule === "important_threshold")).toBe(true);
	});

	it("7.8: no_important: 4 important → FAIL (above threshold)", () => {
		const findings = Array.from({ length: 4 }, (_, i) =>
			makeFinding({ severity: "important", category: "missing_requirement", description: `issue ${i}` }),
		);
		const result = applyVerdictRules(makeVerdict({ findings }), "no_important");
		expect(result.pass).toBe(false);
	});

	it("7.9: no_important: 1 critical + 0 important → FAIL (critical always blocks)", () => {
		const v = makeVerdict({
			findings: [makeFinding({ severity: "critical", category: "incorrect_implementation" })],
		});
		const result = applyVerdictRules(v, "no_important");
		expect(result.pass).toBe(false);
		expect(result.failReasons.some(r => r.rule === "critical_finding")).toBe(true);
	});

	it("7.10: no_important: suggestions only → PASS", () => {
		const findings = Array.from({ length: 5 }, () =>
			makeFinding({ severity: "suggestion" }),
		);
		const result = applyVerdictRules(makeVerdict({ findings }), "no_important");
		expect(result.pass).toBe(true);
	});

	// ── all_clear threshold ──────────────────────────────────────────

	it("7.11: all_clear: 0 findings → PASS", () => {
		const result = applyVerdictRules(makeVerdict(), "all_clear");
		expect(result.pass).toBe(true);
	});

	it("7.12: all_clear: 1 suggestion → FAIL (suggestions block under all_clear)", () => {
		const v = makeVerdict({
			findings: [makeFinding({ severity: "suggestion", description: "tiny nit" })],
		});
		const result = applyVerdictRules(v, "all_clear");
		expect(result.pass).toBe(false);
	});

	it("7.13: all_clear: 1 important → FAIL", () => {
		const v = makeVerdict({
			findings: [makeFinding({ severity: "important", category: "missing_requirement", description: "missing" })],
		});
		const result = applyVerdictRules(v, "all_clear");
		expect(result.pass).toBe(false);
	});

	it("7.14: all_clear: 1 critical → FAIL", () => {
		const v = makeVerdict({
			findings: [makeFinding({ severity: "critical", category: "incorrect_implementation", description: "broken" })],
		});
		const result = applyVerdictRules(v, "all_clear");
		expect(result.pass).toBe(false);
	});

	it("7.15: all_clear: mixed findings → FAIL with multiple reasons", () => {
		const v = makeVerdict({
			findings: [
				makeFinding({ severity: "critical", category: "incorrect_implementation", description: "a" }),
				makeFinding({ severity: "important", category: "missing_requirement", description: "b" }),
				makeFinding({ severity: "suggestion", description: "c" }),
			],
		});
		const result = applyVerdictRules(v, "all_clear");
		expect(result.pass).toBe(false);
		expect(result.failReasons.some(r => r.rule === "critical_finding")).toBe(true);
	});

	// ── Cross-threshold: status_mismatch always blocks ───────────────

	it("7.16: status_mismatch blocks at no_critical", () => {
		const v = makeVerdict({
			findings: [makeFinding({ severity: "suggestion", category: "status_mismatch", description: "x" })],
		});
		expect(applyVerdictRules(v, "no_critical").pass).toBe(false);
	});

	it("7.17: status_mismatch blocks at no_important", () => {
		const v = makeVerdict({
			findings: [makeFinding({ severity: "suggestion", category: "status_mismatch", description: "x" })],
		});
		expect(applyVerdictRules(v, "no_important").pass).toBe(false);
	});

	it("7.18: status_mismatch blocks at all_clear", () => {
		const v = makeVerdict({
			findings: [makeFinding({ severity: "suggestion", category: "status_mismatch", description: "x" })],
		});
		expect(applyVerdictRules(v, "all_clear").pass).toBe(false);
	});

	// ── NEEDS_FIXES verdict with no rule-triggering findings ─────────

	it("7.19: NEEDS_FIXES verdict with empty findings → fail via verdict_says_needs_fixes (all thresholds)", () => {
		for (const threshold of ["no_critical", "no_important", "all_clear"] as PassThreshold[]) {
			const v = makeVerdict({ verdict: "NEEDS_FIXES", findings: [] });
			const result = applyVerdictRules(v, threshold);
			expect(result.pass).toBe(false);
			expect(result.failReasons.some(r => r.rule === "verdict_says_needs_fixes")).toBe(true);
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// 8.x — .DONE creation contract tests
// ══════════════════════════════════════════════════════════════════════

describe("8.x: .DONE creation contracts", () => {
	// These tests verify the decision logic that determines .DONE creation.
	// They test the pure evaluation functions that the task-runner integration
	// relies on — the actual .DONE file I/O happens in executeTask() which
	// requires full task-runner state (not unit-testable here).

	it("8.1: disabled behavior — quality_gate.enabled defaults to false", () => {
		// When disabled, the task-runner code path skips the gate entirely
		// and creates .DONE immediately. We verify the config default.
		const dir = makeTestDir("disabled-default");
		const config = loadProjectConfig(dir);
		const taskConfig = toTaskConfig(config);
		expect(taskConfig.quality_gate.enabled).toBe(false);
	});

	it("8.2: enabled + PASS verdict → evaluation.pass is true (gate would create .DONE)", () => {
		const dir = makeTestDir("pass-done");
		writeFileSync(join(dir, VERDICT_FILENAME), makeVerdictJson({
			verdict: "PASS",
			findings: [],
		}), "utf-8");
		const { evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(evaluation.pass).toBe(true);
		// In the task-runner, pass=true → writeFileSync(donePath, ...) with quality gate metadata
	});

	it("8.3: enabled + NEEDS_FIXES with critical → evaluation.pass is false (.DONE NOT created)", () => {
		const dir = makeTestDir("fail-no-done");
		writeFileSync(join(dir, VERDICT_FILENAME), makeVerdictJson({
			verdict: "NEEDS_FIXES",
			findings: [
				{ severity: "critical", category: "incorrect_implementation", description: "bug", file: "", remediation: "" },
			],
		}), "utf-8");
		const { evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(evaluation.pass).toBe(false);
		// .DONE should NOT be created when evaluation.pass is false
		expect(existsSync(join(dir, ".DONE"))).toBe(false);
	});

	it("8.4: PASS verdict includes quality gate metadata expectations", () => {
		// Verify the verdict structure that task-runner uses to populate .DONE content
		const dir = makeTestDir("pass-metadata");
		writeFileSync(join(dir, VERDICT_FILENAME), makeVerdictJson({
			verdict: "PASS",
			confidence: "high",
			summary: "All requirements met",
		}), "utf-8");
		const { verdict } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(verdict.confidence).toBe("high");
		expect(verdict.summary).toBe("All requirements met");
		// task-runner writes: `Quality gate: PASS (cycle N)\n` into .DONE
	});

	it("8.5: gate failure with exhausted cycles → .DONE absent and findings available for logging", () => {
		// Simulates the terminal failure state: verdict has findings, evaluation fails,
		// and the task-runner would set error state + log findings summary.
		const verdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			summary: "Multiple issues remain after remediation",
			findings: [
				makeFinding({ severity: "critical", category: "incorrect_implementation", description: "Broken parser" }),
				makeFinding({ severity: "important", category: "missing_requirement", description: "Missing validation" }),
				makeFinding({ severity: "important", category: "incomplete_work", description: "No tests" }),
			],
		});
		const evaluation = applyVerdictRules(verdict, "no_critical");
		expect(evaluation.pass).toBe(false);

		// Verify the findings summary the task-runner would log
		const criticals = verdict.findings.filter(f => f.severity === "critical");
		const importants = verdict.findings.filter(f => f.severity === "important");
		expect(criticals).toHaveLength(1);
		expect(importants).toHaveLength(2);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 9.x — Remediation cycle determinism
// ══════════════════════════════════════════════════════════════════════

describe("9.x: Remediation cycle determinism", () => {
	// These tests verify the pure-function components of the remediation
	// cycle: feedback generation, fix agent prompt building, and verdict
	// evaluation across cycles. The actual agent spawning and loop control
	// lives in task-runner.ts (doQualityGateFixAgent/executeTask) and
	// requires full runtime state.

	it("9.1: NEEDS_FIXES triggers feedback generation with correct cycle info", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			confidence: "high",
			summary: "Critical bugs found",
			findings: [
				makeFinding({ severity: "critical", category: "incorrect_implementation", description: "Buffer overflow in parser" }),
			],
		});
		const feedback = generateFeedbackMd(v, 1, 2, "no_critical");
		expect(feedback).toContain("Cycle 1/2");
		expect(feedback).toContain("NEEDS_FIXES");
		expect(feedback).toContain("Buffer overflow in parser");
		expect(feedback).toContain("Critical Findings (1)");
	});

	it("9.2: fix agent prompt includes feedback and no-DONE rule", () => {
		const dir = makeTestDir("fix-cycle");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "# Task", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "# Status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-200",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const feedbackContent = "## Critical\nFix the bug";
		const prompt = buildFixAgentPrompt(ctx, feedbackContent, 1);

		expect(prompt).toContain("Fix the bug");
		expect(prompt).toContain("Do NOT create .DONE");
		expect(prompt).toContain("TP-200");
		expect(prompt).toContain("Fix Cycle 1");
	});

	it("9.3: budget consumption — verdict evaluation is deterministic across cycles", () => {
		// Simulate two review cycles: first fails, second also fails
		// Both should produce the same evaluation for identical verdicts
		const failVerdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			findings: [
				makeFinding({ severity: "critical", category: "incorrect_implementation", description: "still broken" }),
			],
		});

		const eval1 = applyVerdictRules(failVerdict, "no_critical");
		const eval2 = applyVerdictRules(failVerdict, "no_critical");

		expect(eval1.pass).toBe(false);
		expect(eval2.pass).toBe(false);
		expect(eval1.failReasons).toEqual(eval2.failReasons);
	});

	it("9.4: remediation can resolve — PASS after NEEDS_FIXES is valid", () => {
		// Cycle 1: fails
		const failVerdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			findings: [
				makeFinding({ severity: "critical", category: "incorrect_implementation", description: "bug" }),
			],
		});
		const evalFail = applyVerdictRules(failVerdict, "no_critical");
		expect(evalFail.pass).toBe(false);

		// Cycle 2: passes (fix agent resolved the issue)
		const passVerdict = makeVerdict({
			verdict: "PASS",
			findings: [],
		});
		const evalPass = applyVerdictRules(passVerdict, "no_critical");
		expect(evalPass.pass).toBe(true);
	});

	it("9.5: fix agent timeout/crash — verdict file is absent → fail-open PASS on re-read", () => {
		// If fix agent crashes and doesn't produce anything, then the next
		// doQualityGateReview deletes the old verdict and spawns a new review.
		// But if review also fails, readAndEvaluateVerdict on missing file = PASS.
		const dir = makeTestDir("no-verdict-after-crash");
		// No REVIEW_VERDICT.json exists
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(evaluation.pass).toBe(true);
	});

	it("9.6: terminal failure findings summary includes all blocking severities", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			summary: "Multiple issues",
			findings: [
				makeFinding({ severity: "critical", category: "incorrect_implementation", description: "a" }),
				makeFinding({ severity: "critical", category: "incorrect_implementation", description: "b" }),
				makeFinding({ severity: "important", category: "missing_requirement", description: "c" }),
				makeFinding({ severity: "suggestion", description: "d" }),
			],
		});

		// Under no_critical threshold, only critical/important are counted in summary
		const criticals = v.findings.filter(f => f.severity === "critical");
		const importants = v.findings.filter(f => f.severity === "important");
		const suggestions = v.findings.filter(f => f.severity === "suggestion");
		expect(criticals).toHaveLength(2);
		expect(importants).toHaveLength(1);
		expect(suggestions).toHaveLength(1);

		// Under all_clear, suggestions would also be included
		const summaryPartsAllClear = [
			criticals.length > 0 ? `${criticals.length} critical` : "",
			importants.length > 0 ? `${importants.length} important` : "",
			suggestions.length > 0 ? `${suggestions.length} suggestion` : "",
		].filter(Boolean);
		expect(summaryPartsAllClear).toEqual(["2 critical", "1 important", "1 suggestion"]);

		// Under no_critical, suggestions excluded from summary
		const summaryPartsNoCritical = [
			criticals.length > 0 ? `${criticals.length} critical` : "",
			importants.length > 0 ? `${importants.length} important` : "",
		].filter(Boolean);
		expect(summaryPartsNoCritical).toEqual(["2 critical", "1 important"]);
	});

	it("9.7: feedback generation for second cycle reflects cycle number", () => {
		const v = makeVerdict({
			verdict: "NEEDS_FIXES",
			findings: [
				makeFinding({ severity: "important", category: "incomplete_work", description: "Still incomplete" }),
			],
		});
		const feedbackCycle2 = generateFeedbackMd(v, 2, 3, "no_critical");
		expect(feedbackCycle2).toContain("Cycle 2/3");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 10.x — generateQualityGatePrompt evidence packaging
// ══════════════════════════════════════════════════════════════════════

describe("10.x: generateQualityGatePrompt", () => {
	it("10.1: includes PROMPT.md content in review prompt", () => {
		const dir = makeTestDir("prompt-evidence");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "# Task TP-300\nImplement quality gate", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "# Status\n- [x] Step 1 done", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-300",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain("Implement quality gate");
		expect(prompt).toContain("Task Requirements (PROMPT.md)");
	});

	it("10.2: includes STATUS.md content", () => {
		const dir = makeTestDir("status-evidence");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "# Task", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "# Status\n- [x] All done\n- [ ] Not done", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-301",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain("- [x] All done");
		expect(prompt).toContain("- [ ] Not done");
		expect(prompt).toContain("Declared Progress (STATUS.md)");
	});

	it("10.3: handles missing PROMPT.md gracefully", () => {
		const dir = makeTestDir("missing-prompt");
		writeFileSync(join(dir, "STATUS.md"), "# Status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath: join(dir, "PROMPT.md"), // does not exist
			taskId: "TP-302",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain("PROMPT.md not found");
	});

	it("10.4: handles missing STATUS.md gracefully", () => {
		const dir = makeTestDir("missing-status");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "# Task", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-303",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain("STATUS.md not found");
	});

	it("10.5: includes task ID and project name", () => {
		const dir = makeTestDir("ids");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "task", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-555",
			projectName: "AwesomeProject",
			passThreshold: "no_critical",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain("TP-555");
		expect(prompt).toContain("AwesomeProject");
	});

	it("10.6: includes JSON schema and verdict instructions", () => {
		const dir = makeTestDir("schema");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "task", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-304",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain('"verdict"');
		expect(prompt).toContain('"findings"');
		expect(prompt).toContain('"statusReconciliation"');
		expect(prompt).toContain("PASS");
		expect(prompt).toContain("NEEDS_FIXES");
	});

	it("10.7: threshold-aware verdict rules — no_critical", () => {
		const dir = makeTestDir("rules-no-crit");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "task", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-305",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain("`no_critical`");
		expect(prompt).toContain("PASS** even if there are `important` or `suggestion`");
	});

	it("10.8: threshold-aware verdict rules — all_clear", () => {
		const dir = makeTestDir("rules-all-clear");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "task", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-306",
			projectName: "TestProject",
			passThreshold: "all_clear",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain("`all_clear`");
		expect(prompt).toContain("ANY findings exist");
	});

	it("10.9: threshold-aware verdict rules — no_important", () => {
		const dir = makeTestDir("rules-no-imp");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "task", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-307",
			projectName: "TestProject",
			passThreshold: "no_important",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain("3 or more findings have severity `important`");
		expect(prompt).toContain("`suggestion`-level findings remain");
	});

	it("10.10: specifies verdict output path", () => {
		const dir = makeTestDir("verdict-path");
		const promptPath = join(dir, "PROMPT.md");
		writeFileSync(promptPath, "task", "utf-8");
		writeFileSync(join(dir, "STATUS.md"), "status", "utf-8");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath,
			taskId: "TP-308",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const prompt = generateQualityGatePrompt(ctx, dir);
		expect(prompt).toContain(VERDICT_FILENAME);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — readAndEvaluateVerdict fail-open integration
// ══════════════════════════════════════════════════════════════════════

describe("4.x: readAndEvaluateVerdict", () => {
	it("4.1: missing verdict file → synthetic PASS (fail-open)", () => {
		const dir = makeTestDir("read-missing");
		// No REVIEW_VERDICT.json exists in dir
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(verdict.confidence).toBe("low");
		expect(verdict.summary).toContain("fail-open");
		expect(evaluation.pass).toBe(true);
		expect(evaluation.failReasons).toHaveLength(0);
	});

	it("4.2: unreadable verdict file (bad permissions simulation via empty file) → synthetic PASS", () => {
		const dir = makeTestDir("read-empty");
		writeFileSync(join(dir, VERDICT_FILENAME), "");
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(verdict.confidence).toBe("low");
		expect(evaluation.pass).toBe(true);
	});

	it("4.3: malformed JSON in verdict file → synthetic PASS", () => {
		const dir = makeTestDir("read-malformed");
		writeFileSync(join(dir, VERDICT_FILENAME), "not json {{{");
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(verdict.summary).toContain("fail-open");
		expect(evaluation.pass).toBe(true);
	});

	it("4.4: valid PASS verdict file → PASS evaluation", () => {
		const dir = makeTestDir("read-pass");
		writeFileSync(join(dir, VERDICT_FILENAME), makeVerdictJson({
			verdict: "PASS",
			confidence: "high",
			summary: "All requirements met",
		}));
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(verdict.confidence).toBe("high");
		expect(evaluation.pass).toBe(true);
	});

	it("4.5: valid NEEDS_FIXES verdict with critical → fail evaluation", () => {
		const dir = makeTestDir("read-needsfixes");
		writeFileSync(join(dir, VERDICT_FILENAME), makeVerdictJson({
			verdict: "NEEDS_FIXES",
			findings: [
				{ severity: "critical", category: "incorrect_implementation", description: "Bug", file: "a.ts", remediation: "fix" },
			],
		}));
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("NEEDS_FIXES");
		expect(evaluation.pass).toBe(false);
		expect(evaluation.failReasons.some(r => r.rule === "critical_finding")).toBe(true);
	});

	it("4.6: verdict with invalid verdict value → synthetic PASS (fail-open)", () => {
		const dir = makeTestDir("read-invalid-verdict");
		writeFileSync(join(dir, VERDICT_FILENAME), JSON.stringify({
			verdict: "MAYBE",
			findings: [],
		}));
		const { verdict, evaluation } = readAndEvaluateVerdict(dir, "no_critical");
		expect(verdict.verdict).toBe("PASS");
		expect(evaluation.pass).toBe(true);
	});

	it("4.7: nonexistent directory path → synthetic PASS (fail-open, no crash)", () => {
		const { verdict, evaluation } = readAndEvaluateVerdict(
			join(testRoot, "completely-nonexistent-dir"),
			"no_critical",
		);
		expect(verdict.verdict).toBe("PASS");
		expect(evaluation.pass).toBe(true);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — generateFeedbackMd (threshold-aware)
// ══════════════════════════════════════════════════════════════════════

describe("5.x: generateFeedbackMd", () => {
	it("5.1: critical and important findings included, suggestions excluded (no_critical threshold)", () => {
		const verdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			confidence: "high",
			summary: "Issues found",
			findings: [
				makeFinding({ severity: "critical", category: "incorrect_implementation", description: "Critical bug" }),
				makeFinding({ severity: "important", category: "missing_requirement", description: "Missing feature" }),
				makeFinding({ severity: "suggestion", category: "incomplete_work", description: "Style issue" }),
			],
		});
		const md = generateFeedbackMd(verdict, 1, 2, "no_critical");
		expect(md).toContain("Critical bug");
		expect(md).toContain("Missing feature");
		expect(md).not.toContain("Style issue");
		expect(md).toContain("Cycle 1/2");
	});

	it("5.2: suggestions included under all_clear threshold", () => {
		const verdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			confidence: "medium",
			summary: "Needs polish",
			findings: [
				makeFinding({ severity: "suggestion", category: "incomplete_work", description: "Naming nit" }),
				makeFinding({ severity: "suggestion", category: "incomplete_work", description: "Doc issue" }),
			],
		});
		const md = generateFeedbackMd(verdict, 1, 2, "all_clear");
		expect(md).toContain("Naming nit");
		expect(md).toContain("Doc issue");
		expect(md).toContain("Suggestion Findings");
		expect(md).toContain("all_clear");
	});

	it("5.3: suggestions excluded under no_important threshold", () => {
		const verdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			confidence: "medium",
			summary: "Some findings",
			findings: [
				makeFinding({ severity: "important", category: "missing_requirement", description: "Important thing" }),
				makeFinding({ severity: "suggestion", category: "incomplete_work", description: "Minor nit" }),
			],
		});
		const md = generateFeedbackMd(verdict, 1, 3, "no_important");
		expect(md).toContain("Important thing");
		expect(md).not.toContain("Minor nit");
		expect(md).not.toContain("Suggestion Findings");
	});

	it("5.4: STATUS.md reconciliation issues included", () => {
		const verdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			summary: "Checkbox mismatch",
			statusReconciliation: [
				{ checkbox: "Step 2 done", actualState: "not_done" as const, evidence: "Tests failing" },
			],
		});
		const md = generateFeedbackMd(verdict, 1, 2);
		expect(md).toContain("STATUS.md Reconciliation Issues");
		expect(md).toContain("Step 2 done");
		expect(md).toContain("not_done");
		expect(md).toContain("Tests failing");
	});

	it("5.5: no blocking findings generates appropriate fallback message", () => {
		const verdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			summary: "Needs fixes but no findings??",
			findings: [],
		});
		const md = generateFeedbackMd(verdict, 1, 2, "no_critical");
		expect(md).toContain("No blocking findings");
		expect(md).toContain("REVIEW_VERDICT.json");
	});

	it("5.6: cycle number and max cycles reflected in header", () => {
		const verdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			summary: "test",
			findings: [makeFinding({ severity: "critical", category: "incorrect_implementation", description: "bug" })],
		});
		const md = generateFeedbackMd(verdict, 2, 3, "no_critical");
		expect(md).toContain("Cycle 2/3");
	});

	it("5.7: pass threshold shown in feedback header", () => {
		const verdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			summary: "test",
			findings: [makeFinding({ severity: "critical", category: "incorrect_implementation", description: "bug" })],
		});
		const md = generateFeedbackMd(verdict, 1, 2, "no_important");
		expect(md).toContain("`no_important`");
	});

	it("5.8: remediation instructions carried through", () => {
		const verdict = makeVerdict({
			verdict: "NEEDS_FIXES",
			summary: "Fix this",
			findings: [
				makeFinding({
					severity: "critical",
					category: "incorrect_implementation",
					description: "Auth bypass",
					file: "auth.ts",
					remediation: "Add token validation in middleware",
				}),
			],
		});
		const md = generateFeedbackMd(verdict, 1, 2);
		expect(md).toContain("auth.ts");
		expect(md).toContain("Add token validation in middleware");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — buildFixAgentPrompt
// ══════════════════════════════════════════════════════════════════════

describe("6.x: buildFixAgentPrompt", () => {
	it("6.1: includes task ID, cycle number, and feedback content", () => {
		const dir = makeTestDir("fix-prompt");
		// Create PROMPT.md and STATUS.md so they can be read
		writeFileSync(join(dir, "PROMPT.md"), "# Task: Test\n## Steps\n- [ ] Step 1");
		writeFileSync(join(dir, "STATUS.md"), "# Status\n**Status:** In Progress");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath: join(dir, "PROMPT.md"),
			taskId: "TP-099",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const feedback = "## Critical Findings\n### C1: Bug in auth\n- **File:** auth.ts";
		const prompt = buildFixAgentPrompt(ctx, feedback, 1);

		expect(prompt).toContain("TP-099");
		expect(prompt).toContain("Fix Cycle 1");
		expect(prompt).toContain("Bug in auth");
		expect(prompt).toContain("auth.ts");
		expect(prompt).toContain("Task: Test");
		expect(prompt).toContain("Status");
	});

	it("6.2: handles missing PROMPT.md and STATUS.md gracefully", () => {
		const dir = makeTestDir("fix-prompt-missing-files");
		// No PROMPT.md or STATUS.md

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath: join(dir, "PROMPT.md"),
			taskId: "TP-100",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const feedback = "## Issues\nSome feedback here";
		const prompt = buildFixAgentPrompt(ctx, feedback, 2);

		expect(prompt).toContain("TP-100");
		expect(prompt).toContain("Fix Cycle 2");
		expect(prompt).toContain("PROMPT.md not found");
		expect(prompt).toContain("STATUS.md not found");
		expect(prompt).toContain("Some feedback here");
	});

	it("6.3: prompt instructs fix agent NOT to create .DONE", () => {
		const dir = makeTestDir("fix-prompt-no-done");
		writeFileSync(join(dir, "PROMPT.md"), "test");
		writeFileSync(join(dir, "STATUS.md"), "test");

		const ctx: QualityGateContext = {
			taskFolder: dir,
			promptPath: join(dir, "PROMPT.md"),
			taskId: "TP-101",
			projectName: "TestProject",
			passThreshold: "no_critical",
		};

		const prompt = buildFixAgentPrompt(ctx, "feedback", 1);
		expect(prompt).toContain("Do NOT create .DONE");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — Verdict rules threshold matrix
// ══════════════════════════════════════════════════════════════════════

describe("7.x: Verdict rules threshold matrix", () => {
	// ── no_critical threshold ───────────────────────────────────────
	describe("no_critical threshold", () => {
		const threshold: PassThreshold = "no_critical";

		it("7.1: 0 findings → pass", () => {
			const result = applyVerdictRules(makeVerdict(), threshold);
			expect(result.pass).toBe(true);
		});

		it("7.2: 1 critical → fail", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [makeFinding({ severity: "critical", category: "incorrect_implementation" })],
			}), threshold);
			expect(result.pass).toBe(false);
			expect(result.failReasons.some(r => r.rule === "critical_finding")).toBe(true);
		});

		it("7.3: 5 important → pass (no_critical ignores important count)", () => {
			const findings = Array(5).fill(null).map(() =>
				makeFinding({ severity: "important", category: "missing_requirement" })
			);
			const result = applyVerdictRules(makeVerdict({ findings }), threshold);
			expect(result.pass).toBe(true);
		});

		it("7.4: suggestions only → pass", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [makeFinding({ severity: "suggestion" })],
			}), threshold);
			expect(result.pass).toBe(true);
		});

		it("7.5: status_mismatch → fail regardless of severity", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [makeFinding({ severity: "suggestion", category: "status_mismatch" })],
			}), threshold);
			expect(result.pass).toBe(false);
			expect(result.failReasons.some(r => r.rule === "status_mismatch")).toBe(true);
		});
	});

	// ── no_important threshold ──────────────────────────────────────
	describe("no_important threshold", () => {
		const threshold: PassThreshold = "no_important";

		it("7.6: 0 findings → pass", () => {
			const result = applyVerdictRules(makeVerdict(), threshold);
			expect(result.pass).toBe(true);
		});

		it("7.7: 1 critical → fail", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [makeFinding({ severity: "critical", category: "incorrect_implementation" })],
			}), threshold);
			expect(result.pass).toBe(false);
		});

		it("7.8: 2 important → pass (under threshold of 3)", () => {
			const findings = [
				makeFinding({ severity: "important", category: "missing_requirement", description: "a" }),
				makeFinding({ severity: "important", category: "missing_requirement", description: "b" }),
			];
			const result = applyVerdictRules(makeVerdict({ findings }), threshold);
			expect(result.pass).toBe(true);
		});

		it("7.9: 3 important → fail (at threshold)", () => {
			const findings = Array(3).fill(null).map((_, i) =>
				makeFinding({ severity: "important", category: "missing_requirement", description: `item ${i}` })
			);
			const result = applyVerdictRules(makeVerdict({ findings }), threshold);
			expect(result.pass).toBe(false);
			expect(result.failReasons.some(r => r.rule === "important_threshold")).toBe(true);
		});

		it("7.10: 4 important → fail (over threshold)", () => {
			const findings = Array(4).fill(null).map((_, i) =>
				makeFinding({ severity: "important", category: "missing_requirement", description: `item ${i}` })
			);
			const result = applyVerdictRules(makeVerdict({ findings }), threshold);
			expect(result.pass).toBe(false);
		});

		it("7.11: suggestions only → pass", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [makeFinding({ severity: "suggestion" })],
			}), threshold);
			expect(result.pass).toBe(true);
		});
	});

	// ── all_clear threshold ─────────────────────────────────────────
	describe("all_clear threshold", () => {
		const threshold: PassThreshold = "all_clear";

		it("7.12: 0 findings → pass", () => {
			const result = applyVerdictRules(makeVerdict(), threshold);
			expect(result.pass).toBe(true);
		});

		it("7.13: 1 critical → fail", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [makeFinding({ severity: "critical", category: "incorrect_implementation" })],
			}), threshold);
			expect(result.pass).toBe(false);
		});

		it("7.14: 1 important → fail (all_clear blocks any finding)", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [makeFinding({ severity: "important", category: "missing_requirement" })],
			}), threshold);
			expect(result.pass).toBe(false);
		});

		it("7.15: 1 suggestion → fail (all_clear blocks suggestions too)", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [makeFinding({ severity: "suggestion" })],
			}), threshold);
			expect(result.pass).toBe(false);
		});

		it("7.16: mixed severity → fail with multiple reasons", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [
					makeFinding({ severity: "critical", category: "incorrect_implementation" }),
					makeFinding({ severity: "important", category: "missing_requirement" }),
					makeFinding({ severity: "suggestion" }),
				],
			}), threshold);
			expect(result.pass).toBe(false);
			expect(result.failReasons.length).toBeGreaterThanOrEqual(1);
		});

		it("7.17: status_mismatch + suggestions → fail with multiple reasons", () => {
			const result = applyVerdictRules(makeVerdict({
				findings: [
					makeFinding({ severity: "suggestion", category: "status_mismatch" }),
					makeFinding({ severity: "suggestion" }),
				],
			}), threshold);
			expect(result.pass).toBe(false);
			expect(result.failReasons.some(r => r.rule === "status_mismatch")).toBe(true);
		});
	});

	// ── Cross-threshold edge cases ──────────────────────────────────
	describe("Cross-threshold edge cases", () => {
		it("7.18: NEEDS_FIXES verdict with 0 findings → fail via verdict_says_needs_fixes (all thresholds)", () => {
			for (const threshold of ["no_critical", "no_important", "all_clear"] as PassThreshold[]) {
				const result = applyVerdictRules(makeVerdict({
					verdict: "NEEDS_FIXES",
					findings: [],
				}), threshold);
				expect(result.pass).toBe(false);
				expect(result.failReasons.some(r => r.rule === "verdict_says_needs_fixes")).toBe(true);
			}
		});

		it("7.19: PASS verdict with critical findings → fail (rules override verdict)", () => {
			const result = applyVerdictRules(makeVerdict({
				verdict: "PASS",
				findings: [makeFinding({ severity: "critical", category: "incorrect_implementation" })],
			}), "no_critical");
			expect(result.pass).toBe(false);
			expect(result.failReasons.some(r => r.rule === "critical_finding")).toBe(true);
		});

		it("7.20: PASS verdict with status_mismatch → fail (status_mismatch always blocks)", () => {
			const result = applyVerdictRules(makeVerdict({
				verdict: "PASS",
				findings: [makeFinding({ severity: "suggestion", category: "status_mismatch" })],
			}), "no_critical");
			expect(result.pass).toBe(false);
			expect(result.failReasons.some(r => r.rule === "status_mismatch")).toBe(true);
		});
	});
});
