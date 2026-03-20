/**
 * Quality Gate Tests — TP-034 Step 1
 *
 * Tests for verdict parsing, verdict rule evaluation, and config
 * adapter integration for the quality gate feature.
 *
 * Test categories:
 *   1.x — parseVerdict fail-open behavior
 *   2.x — applyVerdictRules evaluation
 *   3.x — Config defaults and adapter mapping
 *
 * Run: npx vitest run tests/quality-gate.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
	parseVerdict,
	applyVerdictRules,
	type ReviewVerdict,
	type ReviewFinding,
	type VerdictEvaluation,
} from "../taskplane/quality-gate.ts";
import { loadProjectConfig, toTaskConfig } from "../taskplane/config-loader.ts";
import { DEFAULT_TASK_RUNNER_SECTION } from "../taskplane/config-schema.ts";

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
