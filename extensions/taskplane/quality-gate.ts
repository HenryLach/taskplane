/**
 * Quality Gate — structured post-completion review types and verdict evaluation.
 *
 * This module defines the interfaces for quality gate review verdicts and
 * implements the verdict evaluation logic used by the task-runner to decide
 * whether a task passes or needs fixes before `.DONE` creation.
 *
 * Verdict rules (from roadmap Phase 5a):
 * - Any `critical` finding → NEEDS_FIXES
 * - 3+ `important` findings → NEEDS_FIXES
 * - Only `suggestion` findings → PASS
 * - Any `status_mismatch` category → NEEDS_FIXES
 *
 * Fail-open behavior: malformed or missing verdict JSON → PASS
 * (prevents quality gate bugs from blocking task completion)
 *
 * @module quality-gate
 */

import type { PassThreshold } from "./config-schema.ts";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

// ── Verdict Interfaces ───────────────────────────────────────────────

/** Severity levels for review findings, ordered by decreasing severity. */
export type FindingSeverity = "critical" | "important" | "suggestion";

/** Categories of review findings. */
export type FindingCategory =
	| "missing_requirement"
	| "incorrect_implementation"
	| "incomplete_work"
	| "status_mismatch";

/** A single finding from the quality gate review. */
export interface ReviewFinding {
	/** Severity of the finding */
	severity: FindingSeverity;
	/** Category classifying what kind of issue was found */
	category: FindingCategory;
	/** Human-readable description of the issue */
	description: string;
	/** File path related to the finding (may be empty) */
	file: string;
	/** Specific fix instruction for the remediation agent */
	remediation: string;
}

/** STATUS.md checkbox reconciliation entry. */
export interface StatusReconciliation {
	/** Original checkbox text from STATUS.md */
	checkbox: string;
	/** Actual state determined by review */
	actualState: "done" | "not_done" | "partial";
	/** Evidence supporting the state determination */
	evidence: string;
}

/** Overall quality gate verdict from the review agent. */
export interface ReviewVerdict {
	/** Pass/fail verdict */
	verdict: "PASS" | "NEEDS_FIXES";
	/** Review agent confidence level */
	confidence: "high" | "medium" | "low";
	/** Brief overall assessment */
	summary: string;
	/** Individual findings from the review */
	findings: ReviewFinding[];
	/** STATUS.md checkbox reconciliation results */
	statusReconciliation: StatusReconciliation[];
}

// ── Verdict Evaluation ───────────────────────────────────────────────

/** Reason why a verdict was determined to be NEEDS_FIXES. */
export interface VerdictFailReason {
	/** Rule that triggered the failure */
	rule: "critical_finding" | "important_threshold" | "status_mismatch" | "verdict_says_needs_fixes";
	/** Human-readable explanation */
	detail: string;
}

/** Result of applying verdict rules to a parsed ReviewVerdict. */
export interface VerdictEvaluation {
	/** Whether the task passes the quality gate */
	pass: boolean;
	/** Reasons for failure (empty array if pass is true) */
	failReasons: VerdictFailReason[];
}

/**
 * Apply verdict rules to determine pass/fail based on findings and threshold.
 *
 * Rules applied in order:
 * 1. Any finding with category `status_mismatch` → NEEDS_FIXES
 * 2. Any finding with severity `critical` → NEEDS_FIXES
 * 3. Threshold-dependent important finding count check
 * 4. If verdict itself says NEEDS_FIXES → respect it
 *
 * Threshold behavior:
 * - `no_critical`: PASS if no critical findings and no status mismatches
 * - `no_important`: PASS if no critical, fewer than 3 important, no status mismatches
 * - `all_clear`: PASS only if zero findings of any severity
 *
 * @param verdict - Parsed review verdict
 * @param threshold - Configured pass threshold
 * @returns Evaluation result with pass/fail and reasons
 */
export function applyVerdictRules(
	verdict: ReviewVerdict,
	threshold: PassThreshold,
): VerdictEvaluation {
	const failReasons: VerdictFailReason[] = [];

	// Rule 1: Any status_mismatch category → NEEDS_FIXES
	const statusMismatches = verdict.findings.filter(
		(f) => f.category === "status_mismatch",
	);
	if (statusMismatches.length > 0) {
		failReasons.push({
			rule: "status_mismatch",
			detail: `${statusMismatches.length} status mismatch(es) found — checked boxes don't match actual work`,
		});
	}

	// Rule 2: Any critical finding → NEEDS_FIXES
	const criticals = verdict.findings.filter((f) => f.severity === "critical");
	if (criticals.length > 0) {
		failReasons.push({
			rule: "critical_finding",
			detail: `${criticals.length} critical finding(s)`,
		});
	}

	// Rule 3: Threshold-dependent important check
	const importants = verdict.findings.filter(
		(f) => f.severity === "important",
	);

	if (threshold === "no_important" && importants.length >= 3) {
		failReasons.push({
			rule: "important_threshold",
			detail: `${importants.length} important findings (threshold: fewer than 3 required for pass)`,
		});
	}

	if (threshold === "all_clear" && verdict.findings.length > 0) {
		// For all_clear, any finding of any severity blocks pass
		if (importants.length > 0 && failReasons.every((r) => r.rule !== "important_threshold")) {
			failReasons.push({
				rule: "important_threshold",
				detail: `${importants.length} important finding(s) (all_clear threshold: zero findings required)`,
			});
		}
		// Suggestions also block under all_clear — but we don't need a separate rule
		// since we'll catch it via the verdict_says_needs_fixes or the overall pass logic
	}

	// Rule 4: If the verdict itself says NEEDS_FIXES and we haven't already failed
	if (verdict.verdict === "NEEDS_FIXES" && failReasons.length === 0) {
		failReasons.push({
			rule: "verdict_says_needs_fixes",
			detail: `Review agent verdict: NEEDS_FIXES — ${verdict.summary}`,
		});
	}

	// For all_clear threshold: even suggestions-only should fail
	if (
		threshold === "all_clear" &&
		failReasons.length === 0 &&
		verdict.findings.length > 0
	) {
		const suggestions = verdict.findings.filter(
			(f) => f.severity === "suggestion",
		);
		if (suggestions.length > 0) {
			failReasons.push({
				rule: "important_threshold",
				detail: `${suggestions.length} suggestion(s) found (all_clear threshold: zero findings required)`,
			});
		}
	}

	return {
		pass: failReasons.length === 0,
		failReasons,
	};
}

// ── Verdict Parsing ──────────────────────────────────────────────────

/** Sentinel verdict returned when parsing fails (fail-open). */
const FAIL_OPEN_VERDICT: ReviewVerdict = {
	verdict: "PASS",
	confidence: "low",
	summary: "Verdict could not be parsed — fail-open policy applied",
	findings: [],
	statusReconciliation: [],
};

/**
 * Parse a JSON string into a ReviewVerdict, with fail-open behavior.
 *
 * If the input is missing, empty, or malformed JSON, returns a PASS verdict
 * (fail-open) to prevent quality gate bugs from blocking task completion.
 *
 * Performs structural validation:
 * - `verdict` must be "PASS" or "NEEDS_FIXES"
 * - `findings` must be an array (defaults to [] if missing)
 * - `statusReconciliation` must be an array (defaults to [] if missing)
 * - Individual findings are validated and malformed entries are dropped
 *
 * @param jsonString - Raw JSON string from review agent output
 * @returns Parsed and validated ReviewVerdict (never throws)
 */
export function parseVerdict(jsonString: string | undefined | null): ReviewVerdict {
	if (!jsonString || jsonString.trim() === "") {
		return { ...FAIL_OPEN_VERDICT, summary: "No verdict provided — fail-open policy applied" };
	}

	let raw: unknown;
	try {
		raw = JSON.parse(jsonString);
	} catch {
		return { ...FAIL_OPEN_VERDICT, summary: "Malformed JSON in verdict — fail-open policy applied" };
	}

	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { ...FAIL_OPEN_VERDICT, summary: "Verdict is not a JSON object — fail-open policy applied" };
	}

	const obj = raw as Record<string, unknown>;

	// Validate verdict field
	const verdict = obj.verdict;
	if (verdict !== "PASS" && verdict !== "NEEDS_FIXES") {
		return { ...FAIL_OPEN_VERDICT, summary: `Invalid verdict value "${String(verdict)}" — fail-open policy applied` };
	}

	// Parse confidence with fallback
	const validConfidence = ["high", "medium", "low"];
	const confidence = validConfidence.includes(obj.confidence as string)
		? (obj.confidence as "high" | "medium" | "low")
		: "medium";

	// Parse summary with fallback
	const summary = typeof obj.summary === "string" ? obj.summary : "";

	// Parse and validate findings
	const findings = validateFindings(obj.findings);

	// Parse and validate statusReconciliation
	const statusReconciliation = validateReconciliations(obj.statusReconciliation);

	return {
		verdict,
		confidence,
		summary,
		findings,
		statusReconciliation,
	};
}

// ── Internal Validation Helpers ──────────────────────────────────────

const VALID_SEVERITIES: FindingSeverity[] = ["critical", "important", "suggestion"];
const VALID_CATEGORIES: FindingCategory[] = [
	"missing_requirement",
	"incorrect_implementation",
	"incomplete_work",
	"status_mismatch",
];
const VALID_STATES = ["done", "not_done", "partial"];

/**
 * Validate and normalize the findings array.
 * Drops individual entries that don't have minimum required fields.
 */
function validateFindings(raw: unknown): ReviewFinding[] {
	if (!Array.isArray(raw)) return [];

	const validated: ReviewFinding[] = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const f = item as Record<string, unknown>;

		// Severity is required and must be valid
		if (!VALID_SEVERITIES.includes(f.severity as FindingSeverity)) continue;

		// Category is required and must be valid
		if (!VALID_CATEGORIES.includes(f.category as FindingCategory)) continue;

		// Description is required
		if (typeof f.description !== "string" || f.description.trim() === "") continue;

		validated.push({
			severity: f.severity as FindingSeverity,
			category: f.category as FindingCategory,
			description: f.description as string,
			file: typeof f.file === "string" ? f.file : "",
			remediation: typeof f.remediation === "string" ? f.remediation : "",
		});
	}

	return validated;
}

/**
 * Validate and normalize the statusReconciliation array.
 * Drops individual entries that don't have minimum required fields.
 */
function validateReconciliations(raw: unknown): StatusReconciliation[] {
	if (!Array.isArray(raw)) return [];

	const validated: StatusReconciliation[] = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const r = item as Record<string, unknown>;

		if (typeof r.checkbox !== "string" || r.checkbox.trim() === "") continue;
		if (!VALID_STATES.includes(r.actualState as string)) continue;

		validated.push({
			checkbox: r.checkbox as string,
			actualState: r.actualState as "done" | "not_done" | "partial",
			evidence: typeof r.evidence === "string" ? r.evidence : "",
		});
	}

	return validated;
}

// ── Quality Gate Review Prompt ───────────────────────────────────────

/** Information needed to build the quality gate review evidence package. */
export interface QualityGateContext {
	/** Absolute path to task folder */
	taskFolder: string;
	/** Absolute path to PROMPT.md */
	promptPath: string;
	/** Task ID (e.g., "TP-034") */
	taskId: string;
	/** Project name from config */
	projectName: string;
	/** Pass threshold from config */
	passThreshold: PassThreshold;
}

/** Path where the quality gate verdict JSON file is written by the review agent. */
export const VERDICT_FILENAME = "REVIEW_VERDICT.json";

/**
 * Build the git diff for the entire task.
 *
 * Tries `git diff HEAD~N..HEAD` where N is determined by the number of commits
 * on the current branch vs main. Falls back to `git diff HEAD` if that fails.
 */
function buildGitDiff(cwd: string): { diff: string; fileList: string } {
	try {
		// Get file list of changed files
		const fileListResult = spawnSync("git", ["diff", "--name-only", "HEAD~20..HEAD"], {
			encoding: "utf-8",
			cwd,
			timeout: 30000,
		});
		const fileList = fileListResult.status === 0
			? fileListResult.stdout.trim()
			: "";

		// Get full diff (truncated to avoid blowing up context)
		const diffResult = spawnSync("git", ["diff", "HEAD~20..HEAD"], {
			encoding: "utf-8",
			cwd,
			timeout: 30000,
			maxBuffer: 200 * 1024, // 200KB max
		});
		const diff = diffResult.status === 0
			? diffResult.stdout.trim()
			: "(git diff unavailable)";

		return { diff, fileList };
	} catch {
		return { diff: "(git diff failed)", fileList: "(file list unavailable)" };
	}
}

/**
 * Generate the quality gate review prompt that instructs the review agent
 * to produce a structured JSON verdict.
 *
 * The prompt includes:
 * - PROMPT.md content (task requirements)
 * - STATUS.md content (declared progress)
 * - Git diff of all task changes
 * - File change list
 * - JSON schema for the verdict
 * - Instructions for fail criteria
 *
 * @param context - Task context for evidence building
 * @param cwd - Working directory for git commands
 * @returns Review prompt string
 */
export function generateQualityGatePrompt(context: QualityGateContext, cwd: string): string {
	const statusPath = join(context.taskFolder, "STATUS.md");
	const verdictPath = join(context.taskFolder, VERDICT_FILENAME);

	// Read evidence files
	let promptContent = "(PROMPT.md not found)";
	try {
		if (existsSync(context.promptPath)) {
			promptContent = readFileSync(context.promptPath, "utf-8");
		}
	} catch { /* fail-open: proceed without */ }

	let statusContent = "(STATUS.md not found)";
	try {
		if (existsSync(statusPath)) {
			statusContent = readFileSync(statusPath, "utf-8");
		}
	} catch { /* fail-open: proceed without */ }

	const { diff, fileList } = buildGitDiff(cwd);

	// Truncate diff if too long (keep first 100KB)
	const maxDiffLen = 100 * 1024;
	const truncatedDiff = diff.length > maxDiffLen
		? diff.slice(0, maxDiffLen) + "\n\n... (diff truncated at 100KB) ..."
		: diff;

	return [
		`# Quality Gate Review`,
		``,
		`You are performing a structured post-completion quality gate review for task **${context.taskId}** in project **${context.projectName}**.`,
		``,
		`Your job is to verify that the task was completed correctly by comparing the PROMPT requirements against the actual code changes and STATUS.md progress claims.`,
		``,
		`## Task Requirements (PROMPT.md)`,
		``,
		`\`\`\`markdown`,
		promptContent,
		`\`\`\``,
		``,
		`## Declared Progress (STATUS.md)`,
		``,
		`\`\`\`markdown`,
		statusContent,
		`\`\`\``,
		``,
		`## Changed Files`,
		``,
		`\`\`\``,
		fileList,
		`\`\`\``,
		``,
		`## Git Diff`,
		``,
		`\`\`\`diff`,
		truncatedDiff,
		`\`\`\``,
		``,
		`## Instructions`,
		``,
		`1. **Read the PROMPT.md requirements** carefully — identify every deliverable and acceptance criterion.`,
		`2. **Cross-check STATUS.md checkboxes** — verify each checked item actually has corresponding code/test changes in the diff.`,
		`3. **Review the git diff** — look for missing implementations, incorrect logic, incomplete work.`,
		`4. **Use tools** to read actual source files if the diff is unclear.`,
		`5. **Produce your verdict** as a JSON object written to the file specified below.`,
		``,
		`## Verdict Rules`,
		``,
		`Apply these rules to determine your verdict:`,
		`- **NEEDS_FIXES** if any finding has severity \`critical\``,
		`- **NEEDS_FIXES** if 3 or more findings have severity \`important\``,
		`- **NEEDS_FIXES** if any finding has category \`status_mismatch\` (checkbox claims work is done but it isn't)`,
		`- **PASS** if only \`suggestion\`-level findings remain`,
		`- **PASS** if no findings at all`,
		``,
		`Current pass threshold: \`${context.passThreshold}\``,
		``,
		`## Output Format`,
		``,
		`Write a JSON file to: \`${verdictPath}\``,
		``,
		`The JSON must conform to this schema:`,
		``,
		`\`\`\`json`,
		`{`,
		`  "verdict": "PASS" | "NEEDS_FIXES",`,
		`  "confidence": "high" | "medium" | "low",`,
		`  "summary": "Brief overall assessment",`,
		`  "findings": [`,
		`    {`,
		`      "severity": "critical" | "important" | "suggestion",`,
		`      "category": "missing_requirement" | "incorrect_implementation" | "incomplete_work" | "status_mismatch",`,
		`      "description": "What is wrong",`,
		`      "file": "path/to/file.ts",`,
		`      "remediation": "Specific fix instruction"`,
		`    }`,
		`  ],`,
		`  "statusReconciliation": [`,
		`    {`,
		`      "checkbox": "Original checkbox text",`,
		`      "actualState": "done" | "not_done" | "partial",`,
		`      "evidence": "How you verified"`,
		`    }`,
		`  ]`,
		`}`,
		`\`\`\``,
		``,
		`**IMPORTANT:** Write ONLY valid JSON to the verdict file. No markdown, no explanation — just the JSON object.`,
		``,
	].join("\n");
}

// ── Quality Gate Result ──────────────────────────────────────────────

/** Result of a quality gate review cycle. */
export interface QualityGateResult {
	/** Whether the task passed the quality gate */
	passed: boolean;
	/** Parsed verdict from the review agent (fail-open sentinel if parsing failed) */
	verdict: ReviewVerdict;
	/** Evaluation of verdict rules against threshold */
	evaluation: VerdictEvaluation;
	/** Number of review cycles consumed so far */
	cyclesUsed: number;
	/** Whether the gate was skipped because it's disabled */
	skipped: boolean;
}

/**
 * Read and evaluate the quality gate verdict file from the task folder.
 *
 * Handles all fail-open paths:
 * - Missing verdict file → synthetic PASS
 * - Malformed JSON → synthetic PASS
 * - Invalid verdict structure → synthetic PASS
 *
 * @param taskFolder - Absolute path to task folder
 * @param passThreshold - Configured pass threshold
 * @returns Evaluated quality gate result
 */
export function readAndEvaluateVerdict(
	taskFolder: string,
	passThreshold: PassThreshold,
): { verdict: ReviewVerdict; evaluation: VerdictEvaluation } {
	const verdictPath = join(taskFolder, VERDICT_FILENAME);

	let rawJson: string | null = null;
	try {
		if (existsSync(verdictPath)) {
			rawJson = readFileSync(verdictPath, "utf-8");
		}
	} catch {
		// File read error → fail-open
	}

	const verdict = parseVerdict(rawJson);
	const evaluation = applyVerdictRules(verdict, passThreshold);

	return { verdict, evaluation };
}
