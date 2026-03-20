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
import { readFileSync, writeFileSync, existsSync } from "fs";
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
 * Compute a robust diff range for the task's git changes.
 *
 * Strategy (in order):
 * 1. `git merge-base HEAD main` — ideal for topic branches
 * 2. `git merge-base HEAD origin/main` — fallback for detached/worktree checkouts
 * 3. `HEAD~N` where N = min(commit count, 50) — bounded fallback for repos
 *    without a main branch or with shallow history
 * 4. Empty string (signals diff unavailable)
 */
function computeDiffBase(cwd: string): string {
	const opts = { encoding: "utf-8" as const, cwd, timeout: 15000 };

	// Try merge-base with local main
	for (const ref of ["main", "origin/main", "master", "origin/master"]) {
		const result = spawnSync("git", ["merge-base", "HEAD", ref], opts);
		if (result.status === 0 && result.stdout.trim()) {
			return result.stdout.trim();
		}
	}

	// Fallback: count commits and use HEAD~N (bounded)
	const countResult = spawnSync("git", ["rev-list", "--count", "HEAD"], opts);
	if (countResult.status === 0) {
		const count = parseInt(countResult.stdout.trim(), 10);
		if (count > 1) {
			const n = Math.min(count - 1, 50);
			return `HEAD~${n}`;
		}
	}

	return "";
}

/**
 * Build the git diff for the entire task.
 *
 * Uses `computeDiffBase()` to find a robust baseline, then runs `git diff`
 * between that base and HEAD. Falls back gracefully when git is unavailable
 * or the repository has insufficient history.
 */
function buildGitDiff(cwd: string): { diff: string; fileList: string } {
	try {
		const base = computeDiffBase(cwd);
		if (!base) {
			return { diff: "(git diff unavailable — could not determine base)", fileList: "(file list unavailable)" };
		}

		const range = `${base}..HEAD`;

		// Get file list of changed files
		const fileListResult = spawnSync("git", ["diff", "--name-only", range], {
			encoding: "utf-8",
			cwd,
			timeout: 30000,
		});
		const fileList = fileListResult.status === 0
			? fileListResult.stdout.trim()
			: "";

		// Get full diff (truncated to avoid blowing up context)
		const diffResult = spawnSync("git", ["diff", range], {
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
/**
 * Build threshold-specific verdict rule lines for the review prompt.
 *
 * This ensures the reviewer's instructions match the runtime behavior of
 * `applyVerdictRules()` — preventing false failures caused by the reviewer
 * emitting NEEDS_FIXES for findings that the runtime threshold would ignore.
 */
function buildThresholdRules(threshold: PassThreshold): string[] {
	const rules: string[] = [];

	// Common rules — always apply
	rules.push(`- **NEEDS_FIXES** if any finding has category \`status_mismatch\` (checkbox claims work is done but it isn't)`);
	rules.push(`- **NEEDS_FIXES** if any finding has severity \`critical\``);

	// Threshold-specific rules
	switch (threshold) {
		case "no_critical":
			rules.push(`- **PASS** even if there are \`important\` or \`suggestion\` findings (threshold: \`no_critical\`)`);
			break;
		case "no_important":
			rules.push(`- **NEEDS_FIXES** if 3 or more findings have severity \`important\``);
			rules.push(`- **PASS** if only \`suggestion\`-level findings remain`);
			break;
		case "all_clear":
			rules.push(`- **NEEDS_FIXES** if ANY findings exist (including \`suggestion\`-level)`);
			break;
	}

	rules.push(`- **PASS** if no findings at all`);
	rules.push(``);

	return rules;
}

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
		`Report ALL findings you discover with accurate severities. The runtime will`,
		`apply the configured pass threshold (\`${context.passThreshold}\`) to decide pass/fail.`,
		``,
		`Use these rules to determine your verdict:`,
		...buildThresholdRules(context.passThreshold),
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

// ── STATUS.md Reconciliation ─────────────────────────────────────────

/** Result of applying status reconciliation to STATUS.md. */
export interface ReconciliationResult {
	/** Number of checkboxes whose state was changed */
	changed: number;
	/** Number of reconciliation entries that matched but required no change */
	alreadyCorrect: number;
	/** Number of reconciliation entries that could not be matched to a checkbox */
	unmatched: number;
	/** Details of each action taken */
	actions: ReconciliationAction[];
}

/** A single reconciliation action applied (or skipped). */
export interface ReconciliationAction {
	/** The checkbox text from the reconciliation entry */
	checkbox: string;
	/** What happened */
	outcome: "checked" | "unchecked" | "no_change" | "unmatched";
	/** Human-readable reason */
	reason: string;
}

/**
 * Normalize checkbox text for fuzzy matching.
 *
 * Strips markdown formatting, collapses whitespace, lowercases, and removes
 * leading punctuation/bullets. This allows reconciliation entries (which come
 * from the review agent's paraphrasing) to match STATUS.md checkboxes that
 * may differ in whitespace, casing, or minor formatting.
 */
function normalizeCheckboxText(text: string): string {
	return text
		.replace(/\*\*|__|``|`/g, "")       // strip bold/code formatting
		.replace(/\s+/g, " ")                // collapse whitespace
		.replace(/^\s*[-*•]\s*/, "")          // strip leading bullets
		.trim()
		.toLowerCase();
}

/**
 * Apply statusReconciliation entries to STATUS.md checkboxes.
 *
 * For each reconciliation entry:
 * - `done` → ensure checkbox is checked (`[x]`)
 * - `not_done` → ensure checkbox is unchecked (`[ ]`)
 * - `partial` → ensure checkbox is unchecked (`[ ]`) with "(partial)" annotation
 *
 * Matching strategy: normalize both the reconciliation `checkbox` text and the
 * STATUS.md checkbox text, then match by substring containment (reconciliation
 * text contained in STATUS line or vice versa). First match wins — duplicates
 * are logged as "unmatched" after the first match is consumed.
 *
 * Idempotency: if a checkbox already has the correct state, no change is made.
 * If no net changes occur, STATUS.md is not rewritten.
 *
 * @param statusPath - Absolute path to STATUS.md
 * @param reconciliations - Array of reconciliation entries from the verdict
 * @returns Summary of changes applied
 */
export function applyStatusReconciliation(
	statusPath: string,
	reconciliations: StatusReconciliation[],
): ReconciliationResult {
	const result: ReconciliationResult = {
		changed: 0,
		alreadyCorrect: 0,
		unmatched: 0,
		actions: [],
	};

	if (!reconciliations || reconciliations.length === 0) {
		return result;
	}

	let content: string;
	try {
		if (!existsSync(statusPath)) {
			// No STATUS.md — mark all as unmatched
			for (const r of reconciliations) {
				result.unmatched++;
				result.actions.push({ checkbox: r.checkbox, outcome: "unmatched", reason: "STATUS.md not found" });
			}
			return result;
		}
		content = readFileSync(statusPath, "utf-8");
	} catch {
		for (const r of reconciliations) {
			result.unmatched++;
			result.actions.push({ checkbox: r.checkbox, outcome: "unmatched", reason: "STATUS.md unreadable" });
		}
		return result;
	}

	// Parse lines, identify checkbox lines with their indices
	const lines = content.split("\n");
	const checkboxRegex = /^(\s*-\s*\[)([ xX])(\]\s*)(.*)/;

	// Track which line indices have been consumed by a reconciliation match
	const consumed = new Set<number>();

	for (const recon of reconciliations) {
		const normalizedRecon = normalizeCheckboxText(recon.checkbox);
		if (!normalizedRecon) {
			result.unmatched++;
			result.actions.push({ checkbox: recon.checkbox, outcome: "unmatched", reason: "Empty checkbox text after normalization" });
			continue;
		}

		// Find the best matching checkbox line (first unconsumed match)
		let matchedIdx = -1;
		for (let i = 0; i < lines.length; i++) {
			if (consumed.has(i)) continue;
			const cbMatch = lines[i].match(checkboxRegex);
			if (!cbMatch) continue;

			const lineText = normalizeCheckboxText(cbMatch[4]);
			// Match if either contains the other (handles paraphrasing)
			if (lineText === normalizedRecon || lineText.includes(normalizedRecon) || normalizedRecon.includes(lineText)) {
				matchedIdx = i;
				break;
			}
		}

		if (matchedIdx === -1) {
			result.unmatched++;
			result.actions.push({ checkbox: recon.checkbox, outcome: "unmatched", reason: "No matching checkbox found in STATUS.md" });
			continue;
		}

		consumed.add(matchedIdx);
		const cbMatch = lines[matchedIdx].match(checkboxRegex)!;
		const currentlyChecked = cbMatch[2].toLowerCase() === "x";
		const currentText = cbMatch[4];

		// Determine desired state
		const shouldBeChecked = recon.actualState === "done";
		// partial → uncheck (conservative: don't claim done)

		if (shouldBeChecked && currentlyChecked) {
			// Already correct
			result.alreadyCorrect++;
			result.actions.push({ checkbox: recon.checkbox, outcome: "no_change", reason: "Already checked (done)" });
		} else if (!shouldBeChecked && !currentlyChecked) {
			// Already correct (unchecked for not_done or partial)
			// But if partial, might need annotation
			if (recon.actualState === "partial" && !currentText.includes("(partial)")) {
				// Add partial annotation
				lines[matchedIdx] = `${cbMatch[1]} ${cbMatch[3]}${currentText} (partial)`;
				result.changed++;
				result.actions.push({ checkbox: recon.checkbox, outcome: "unchecked", reason: "Added (partial) annotation" });
			} else {
				result.alreadyCorrect++;
				result.actions.push({ checkbox: recon.checkbox, outcome: "no_change", reason: `Already unchecked (${recon.actualState})` });
			}
		} else if (shouldBeChecked && !currentlyChecked) {
			// Need to check
			lines[matchedIdx] = `${cbMatch[1]}x${cbMatch[3]}${currentText}`;
			result.changed++;
			result.actions.push({ checkbox: recon.checkbox, outcome: "checked", reason: "Work done but box was unchecked" });
		} else {
			// currentlyChecked but should not be (not_done or partial)
			const annotation = recon.actualState === "partial" ? " (partial)" : "";
			const cleanText = currentText.replace(/\s*\(partial\)\s*$/, "");
			lines[matchedIdx] = `${cbMatch[1]} ${cbMatch[3]}${cleanText}${annotation}`;
			result.changed++;
			const outcomeReason = recon.actualState === "partial"
				? "Unchecked — work partially done"
				: "Unchecked — work not done";
			result.actions.push({ checkbox: recon.checkbox, outcome: "unchecked", reason: outcomeReason });
		}
	}

	// Only rewrite if there were actual changes
	if (result.changed > 0) {
		try {
			writeFileSync(statusPath, lines.join("\n"), "utf-8");
		} catch {
			// Write failed — downgrade changes to unmatched for accuracy
			// (the in-memory result says "changed" but file wasn't updated)
			for (const action of result.actions) {
				if (action.outcome === "checked" || action.outcome === "unchecked") {
					action.outcome = "unmatched";
					action.reason += " (write failed)";
					result.changed--;
					result.unmatched++;
				}
			}
		}
	}

	return result;
}

// ── Remediation: Feedback & Fix Agent Prompt ─────────────────────────

/** Path for the review feedback file written for the fix agent. */
export const FEEDBACK_FILENAME = "REVIEW_FEEDBACK.md";

/**
 * Generate a deterministic REVIEW_FEEDBACK.md from a NEEDS_FIXES verdict.
 *
 * Includes blocking findings based on the configured pass threshold:
 * - `no_critical` / `no_important`: critical + important findings only
 * - `all_clear`: critical + important + suggestion findings (all are blocking)
 *
 * The template is stable across runs so fix-agent prompts are reproducible.
 *
 * This file is intentionally staged as a task artifact (aligns with
 * roadmap 5e: REVIEW_FEEDBACK.md is part of the review audit trail).
 *
 * @param verdict - The NEEDS_FIXES review verdict
 * @param cycleNum - Current remediation cycle number (1-based)
 * @param maxCycles - Maximum review cycles configured
 * @param passThreshold - Configured pass threshold (determines which severities are blocking)
 * @returns Markdown content for REVIEW_FEEDBACK.md
 */
export function generateFeedbackMd(
	verdict: ReviewVerdict,
	cycleNum: number,
	maxCycles: number,
	passThreshold: PassThreshold = "no_critical",
): string {
	const criticals = verdict.findings.filter(f => f.severity === "critical");
	const importants = verdict.findings.filter(f => f.severity === "important");
	const suggestions = verdict.findings.filter(f => f.severity === "suggestion");
	const mismatches = verdict.statusReconciliation.filter(r => r.actualState !== "done");

	// Under all_clear, suggestions are also blocking
	const includeSuggestions = passThreshold === "all_clear";

	const blockingLabel = includeSuggestions
		? "critical, important, and suggestion"
		: "critical and important";

	const lines: string[] = [
		`# Review Feedback — Cycle ${cycleNum}/${maxCycles}`,
		``,
		`**Verdict:** NEEDS_FIXES`,
		`**Confidence:** ${verdict.confidence}`,
		`**Summary:** ${verdict.summary}`,
		`**Pass Threshold:** \`${passThreshold}\``,
		``,
		`> This file was generated by the quality gate. Address all ${blockingLabel}`,
		`> findings below, then the review will re-run automatically.`,
		``,
	];

	if (criticals.length > 0) {
		lines.push(`## Critical Findings (${criticals.length})`);
		lines.push(``);
		for (let i = 0; i < criticals.length; i++) {
			const f = criticals[i];
			lines.push(`### C${i + 1}: ${f.description}`);
			lines.push(``);
			lines.push(`- **Category:** ${f.category}`);
			if (f.file) lines.push(`- **File:** \`${f.file}\``);
			if (f.remediation) lines.push(`- **Remediation:** ${f.remediation}`);
			lines.push(``);
		}
	}

	if (importants.length > 0) {
		lines.push(`## Important Findings (${importants.length})`);
		lines.push(``);
		for (let i = 0; i < importants.length; i++) {
			const f = importants[i];
			lines.push(`### I${i + 1}: ${f.description}`);
			lines.push(``);
			lines.push(`- **Category:** ${f.category}`);
			if (f.file) lines.push(`- **File:** \`${f.file}\``);
			if (f.remediation) lines.push(`- **Remediation:** ${f.remediation}`);
			lines.push(``);
		}
	}

	if (includeSuggestions && suggestions.length > 0) {
		lines.push(`## Suggestion Findings (${suggestions.length})`);
		lines.push(``);
		lines.push(`> Under \`all_clear\` threshold, suggestions are also blocking.`);
		lines.push(``);
		for (let i = 0; i < suggestions.length; i++) {
			const f = suggestions[i];
			lines.push(`### S${i + 1}: ${f.description}`);
			lines.push(``);
			lines.push(`- **Category:** ${f.category}`);
			if (f.file) lines.push(`- **File:** \`${f.file}\``);
			if (f.remediation) lines.push(`- **Remediation:** ${f.remediation}`);
			lines.push(``);
		}
	}

	if (mismatches.length > 0) {
		lines.push(`## STATUS.md Reconciliation Issues (${mismatches.length})`);
		lines.push(``);
		for (const r of mismatches) {
			lines.push(`- **Checkbox:** ${r.checkbox}`);
			lines.push(`  - **Actual state:** ${r.actualState}`);
			if (r.evidence) lines.push(`  - **Evidence:** ${r.evidence}`);
		}
		lines.push(``);
	}

	const totalBlocking = criticals.length + importants.length
		+ (includeSuggestions ? suggestions.length : 0) + mismatches.length;

	if (totalBlocking === 0) {
		lines.push(`## No blocking findings`);
		lines.push(``);
		lines.push(`The review returned NEEDS_FIXES but no blocking findings were extracted for threshold \`${passThreshold}\`.`);
		lines.push(`This may indicate a threshold or verdict-rule mismatch. Review the REVIEW_VERDICT.json for details.`);
		lines.push(``);
	}

	return lines.join("\n");
}

/**
 * Build the prompt for the fix agent that addresses quality gate findings.
 *
 * The fix agent is spawned in the same worktree as the task and receives
 * the REVIEW_FEEDBACK.md content along with task context. It should make
 * targeted code fixes and commit them.
 *
 * @param context - Quality gate context (task folder, IDs, etc.)
 * @param feedbackContent - Content of REVIEW_FEEDBACK.md
 * @param cycleNum - Current fix cycle number
 * @returns Prompt string for the fix agent
 */
export function buildFixAgentPrompt(
	context: QualityGateContext,
	feedbackContent: string,
	cycleNum: number,
): string {
	const statusPath = join(context.taskFolder, "STATUS.md");

	let statusContent = "(STATUS.md not found)";
	try {
		if (existsSync(statusPath)) {
			statusContent = readFileSync(statusPath, "utf-8");
		}
	} catch { /* proceed without */ }

	let promptContent = "(PROMPT.md not found)";
	try {
		if (existsSync(context.promptPath)) {
			promptContent = readFileSync(context.promptPath, "utf-8");
		}
	} catch { /* proceed without */ }

	return [
		`# Quality Gate Remediation — Fix Cycle ${cycleNum}`,
		``,
		`You are a fix agent addressing quality gate findings for task **${context.taskId}**.`,
		``,
		`The quality gate review found issues that must be fixed before the task can be marked complete.`,
		`Your job is to make targeted, minimal fixes to address the critical and important findings below.`,
		``,
		`## Rules`,
		``,
		`1. **Read REVIEW_FEEDBACK.md** below — it lists the blocking findings with specific remediation instructions.`,
		`2. **Fix each finding** — make the minimal code change needed. Do NOT refactor unrelated code.`,
		`3. **Commit your fixes** with message: \`fix(${context.taskId}): address quality gate findings (cycle ${cycleNum})\``,
		`4. **Update STATUS.md** if any checkbox states were flagged as incorrect in the reconciliation section.`,
		`5. **Do NOT create .DONE** — the quality gate will re-run automatically after you exit.`,
		``,
		`## Task Context`,
		``,
		`- **Task folder:** ${context.taskFolder}/`,
		`- **PROMPT:** ${context.promptPath}`,
		`- **STATUS:** ${statusPath}`,
		``,
		`## Review Feedback`,
		``,
		`\`\`\`markdown`,
		feedbackContent,
		`\`\`\``,
		``,
		`## Original Task Requirements (PROMPT.md)`,
		``,
		`\`\`\`markdown`,
		promptContent,
		`\`\`\``,
		``,
		`## Current STATUS.md`,
		``,
		`\`\`\`markdown`,
		statusContent,
		`\`\`\``,
		``,
		`**IMPORTANT:** Focus only on fixing the blocking findings. Do not expand scope or create .DONE.`,
		``,
	].join("\n");
}
