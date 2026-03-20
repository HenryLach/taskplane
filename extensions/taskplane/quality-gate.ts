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
