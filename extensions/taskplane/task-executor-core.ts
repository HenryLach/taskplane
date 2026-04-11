/**
 * Task Executor Core — Headless execution semantics for Runtime V2
 *
 * This module owns the deterministic task execution logic for headless lane execution.
 * It has NO dependency on Pi's ExtensionAPI, ExtensionContext, UI
 * widgets, session lifecycle, TMUX, or TASK_AUTOSTART.
 *
 * Consumers:
 *   - lane-runner.ts (Runtime V2 headless lane execution, TP-105)
 *
 * Design rules:
 *   1. No Pi imports. No ExtensionContext. No ctx.ui.
 *   2. File I/O is explicit (path parameters, not cwd inference).
 *   3. All functions are independently testable.
 *   4. STATUS.md and .DONE semantics are preserved exactly.
 *
 * @module taskplane/task-executor-core
 * @since TP-103
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, basename, resolve, join } from "path";
import { spawnSync } from "child_process";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Parsed step information from PROMPT.md or STATUS.md.
 *
 * Re-exported from the core for downstream consumers.
 */
export interface StepInfo {
	number: number;
	name: string;
	status: "not-started" | "in-progress" | "complete";
	checkboxes: { text: string; checked: boolean }[];
	totalChecked: number;
	totalItems: number;
}

/**
 * Parsed task metadata from PROMPT.md.
 *
 * This is the core's view of a task — independent of the orchestrator's
 * ParsedTask which carries additional scheduling/routing metadata.
 */
export interface CoreParsedTask {
	taskId: string;
	taskName: string;
	reviewLevel: number;
	size: string;
	steps: StepInfo[];
	contextDocs: string[];
	taskFolder: string;
	promptPath: string;
}

/**
 * Parsed STATUS.md data.
 */
export interface ParsedStatus {
	steps: StepInfo[];
	reviewCounter: number;
	iteration: number;
}

// ── PROMPT.md Parsing ────────────────────────────────────────────────

/**
 * Parse a PROMPT.md file into structured task metadata.
 *
 * Pure function — no file I/O. Caller provides content and path.
 *
 * @param content - Raw PROMPT.md content
 * @param promptPath - Absolute path to the PROMPT.md file (used to derive taskFolder)
 * @returns Parsed task metadata
 */
export function parsePromptMd(content: string, promptPath: string): CoreParsedTask {
	const text = content.replace(/\r\n/g, "\n");
	const taskFolder = dirname(resolve(promptPath));

	// Task ID and name
	let taskId = "", taskName = "";
	const titleMatch = text.match(/^#\s+(?:Task:\s*)?(\S+-\d+)\s*[-–:]\s*(.+)/m);
	if (titleMatch) { taskId = titleMatch[1]; taskName = titleMatch[2].trim(); }
	else { taskId = basename(taskFolder); taskName = taskId; }

	// Review level
	let reviewLevel = 0;
	const rlMatch = text.match(/##\s+Review Level[:\s]*(\d)/);
	if (rlMatch) reviewLevel = parseInt(rlMatch[1]);

	// Size
	let size = "M";
	const sizeMatch = text.match(/\*\*Size:\*\*\s*(\w+)/);
	if (sizeMatch) size = sizeMatch[1];

	// Steps
	const steps: StepInfo[] = [];
	const stepRegex = /###\s+Step\s+(\d+):\s*(.+)/g;
	const positions: { number: number; name: string; start: number }[] = [];
	let m;
	while ((m = stepRegex.exec(text)) !== null) {
		positions.push({ number: parseInt(m[1]), name: m[2].trim(), start: m.index });
	}
	for (let i = 0; i < positions.length; i++) {
		const section = text.slice(positions[i].start, i + 1 < positions.length ? positions[i + 1].start : text.length);
		const checkboxes: { text: string; checked: boolean }[] = [];
		const cbRegex = /^\s*-\s*\[([ xX])\]\s*(.*)/gm;
		let cb;
		while ((cb = cbRegex.exec(section)) !== null) {
			checkboxes.push({ text: cb[2].trim(), checked: cb[1].toLowerCase() === "x" });
		}
		steps.push({
			number: positions[i].number, name: positions[i].name,
			status: "not-started", checkboxes,
			totalChecked: checkboxes.filter(c => c.checked).length,
			totalItems: checkboxes.length,
		});
	}

	// Context docs
	const contextDocs: string[] = [];
	const ctxMatch = text.match(/##\s+Context to Read First\s*\n+([\s\S]*?)(?=\n##\s|$)/);
	if (ctxMatch) {
		const pathRegex = /`([^\s`]+\.(?:md|yaml|json|go|ts|js))`/g;
		let pm;
		while ((pm = pathRegex.exec(ctxMatch[1])) !== null) contextDocs.push(pm[1]);
	}

	return { taskId, taskName, reviewLevel, size, steps, contextDocs, taskFolder, promptPath };
}

// ── STATUS.md Parsing ────────────────────────────────────────────────

/**
 * Parse a STATUS.md file into structured execution state.
 *
 * Pure function — no file I/O. Caller provides content.
 *
 * @param content - Raw STATUS.md content
 * @returns Parsed status with steps, review counter, and iteration
 */
export function parseStatusMd(content: string): ParsedStatus {
	const text = content.replace(/\r\n/g, "\n");
	const steps: StepInfo[] = [];
	let currentStep: StepInfo | null = null;
	let reviewCounter = 0, iteration = 0;

	for (const line of text.split("\n")) {
		const rcMatch = line.match(/\*\*Review Counter:\*\*\s*(\d+)/);
		if (rcMatch) reviewCounter = parseInt(rcMatch[1]);
		const itMatch = line.match(/\*\*Iteration:\*\*\s*(\d+)/);
		if (itMatch) iteration = parseInt(itMatch[1]);

		const stepMatch = line.match(/^###\s+Step\s+(\d+):\s*(.+)/);
		if (stepMatch) {
			if (currentStep) {
				currentStep.totalChecked = currentStep.checkboxes.filter(c => c.checked).length;
				currentStep.totalItems = currentStep.checkboxes.length;
				steps.push(currentStep);
			}
			currentStep = { number: parseInt(stepMatch[1]), name: stepMatch[2].trim(), status: "not-started", checkboxes: [], totalChecked: 0, totalItems: 0 };
			continue;
		}
		if (currentStep) {
			const ss = line.match(/\*\*Status:\*\*\s*(.*)/);
			if (ss) {
				const s = ss[1];
				if (s.includes("✅") || s.toLowerCase().includes("complete")) currentStep.status = "complete";
				else if (s.includes("🟨") || s.toLowerCase().includes("progress")) currentStep.status = "in-progress";
			}
			const cb = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
			if (cb) currentStep.checkboxes.push({ text: cb[2].trim(), checked: cb[1].toLowerCase() === "x" });
		}
	}
	if (currentStep) {
		currentStep.totalChecked = currentStep.checkboxes.filter(c => c.checked).length;
		currentStep.totalItems = currentStep.checkboxes.length;
		steps.push(currentStep);
	}
	return { steps, reviewCounter, iteration };
}

// ── STATUS.md Generation ─────────────────────────────────────────────

/**
 * Generate an initial STATUS.md from a parsed task.
 *
 * @param task - Parsed task (from parsePromptMd or orchestrator ParsedTask)
 * @returns Complete STATUS.md content string
 */
export function generateStatusMd(task: { taskId: string; taskName: string; reviewLevel: number; size: string; steps: StepInfo[] }): string {
	const now = new Date().toISOString().slice(0, 10);
	const lines: string[] = [
		`# ${task.taskId}: ${task.taskName} — Status`, "",
		`**Current Step:** Not Started`,
		`**Status:** 🔵 Ready for Execution`,
		`**Last Updated:** ${now}`,
		`**Review Level:** ${task.reviewLevel}`,
		`**Review Counter:** 0`,
		`**Iteration:** 0`,
		`**Size:** ${task.size}`, "", "---", "",
	];
	for (const step of task.steps) {
		lines.push(`### Step ${step.number}: ${step.name}`, `**Status:** ⬜ Not Started`, "");
		for (const cb of step.checkboxes) lines.push(`- [ ] ${cb.text}`);
		lines.push("", "---", "");
	}
	lines.push(
		"## Reviews", "", "| # | Type | Step | Verdict | File |", "|---|------|------|---------|------|", "", "---", "",
		"## Discoveries", "", "| Discovery | Disposition | Location |", "|-----------|-------------|----------|", "", "---", "",
		"## Execution Log", "", "| Timestamp | Action | Outcome |", "|-----------|--------|---------|",
		`| ${now} | Task staged | STATUS.md auto-generated by task-runner |`, "", "---", "",
		"## Blockers", "", "*None*", "", "---", "", "## Notes", "", "*Reserved for execution notes*",
	);
	return lines.join("\n");
}

// ── STATUS.md Mutation ───────────────────────────────────────────────

/**
 * Update a metadata field in STATUS.md.
 *
 * Matches `**Field:** value` patterns and replaces the value.
 *
 * @param statusPath - Absolute path to STATUS.md
 * @param field - Field name (e.g., "Status", "Current Step")
 * @param value - New value
 */
export function updateStatusField(statusPath: string, field: string, value: string): void {
	let content = readFileSync(statusPath, "utf-8").replace(/\r\n/g, "\n");
	const pattern = new RegExp(`(\\*\\*${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\*\\*\\s*)(.+)`);
	if (pattern.test(content)) {
		content = content.replace(pattern, `$1${value}`);
	} else {
		content = content.replace(/(\*\*[^*]+:\*\*\s*.+\n)/, `$1**${field}:** ${value}\n`);
	}
	writeFileSync(statusPath, content);
}

/**
 * Update a step's status in STATUS.md.
 *
 * @param statusPath - Absolute path to STATUS.md
 * @param stepNum - Step number to update
 * @param status - New status
 */
export function updateStepStatus(statusPath: string, stepNum: number, status: "not-started" | "in-progress" | "complete"): void {
	let content = readFileSync(statusPath, "utf-8").replace(/\r\n/g, "\n");
	const emoji = status === "complete" ? "✅ Complete" : status === "in-progress" ? "🟨 In Progress" : "⬜ Not Started";
	const lines = content.split("\n");
	let inTarget = false;
	for (let i = 0; i < lines.length; i++) {
		const sm = lines[i].match(/^###\s+Step\s+(\d+):/);
		if (sm) inTarget = parseInt(sm[1]) === stepNum;
		if (inTarget && lines[i].match(/^\*\*Status:\*\*/)) {
			lines[i] = `**Status:** ${emoji}`;
			break;
		}
	}
	writeFileSync(statusPath, lines.join("\n"));
}

/**
 * Append a row to a named table section in STATUS.md.
 *
 * @param statusPath - Absolute path to STATUS.md
 * @param sectionName - Section heading (e.g., "Execution Log", "Reviews")
 * @param row - Markdown table row to append
 */
export function appendTableRow(statusPath: string, sectionName: string, row: string): void {
	let content = readFileSync(statusPath, "utf-8").replace(/\r\n/g, "\n");
	const lines = content.split("\n");
	let insertIdx = -1, inSection = false, lastTableRow = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].match(new RegExp(`^##\\s+${sectionName}`))) {
			inSection = true;
			continue;
		}
		if (inSection) {
			if (lines[i].match(/^##\s/) || lines[i].trim() === "---") {
				insertIdx = lastTableRow >= 0 ? lastTableRow + 1 : i;
				break;
			}
			if (lines[i].startsWith("|") && !lines[i].match(/^\|[\s-|]+\|$/)) {
				lastTableRow = i;
			}
		}
	}
	if (insertIdx === -1) {
		insertIdx = lastTableRow >= 0 ? lastTableRow + 1 : lines.length;
	}
	lines.splice(insertIdx, 0, row);
	writeFileSync(statusPath, lines.join("\n"));
}

/**
 * Log an execution event to the Execution Log table in STATUS.md.
 */
export function logExecution(statusPath: string, action: string, outcome: string): void {
	const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
	appendTableRow(statusPath, "Execution Log", `| ${ts} | ${action} | ${outcome} |`);
}

/**
 * Log a review entry to the Reviews table in STATUS.md.
 */
export function logReview(statusPath: string, num: string, type: string, stepNum: number, verdict: string, file: string): void {
	appendTableRow(statusPath, "Reviews", `| ${num} | ${type} | Step ${stepNum} | ${verdict} | ${file} |`);
}

/**
 * Sanitize steering message content for safe injection into a markdown table row.
 * Collapses newlines, escapes pipe characters, and truncates to 200 chars.
 */
export function sanitizeSteeringContent(content: string): string {
	let s = content.replace(/\r?\n/g, " / ").replace(/\|/g, "\\|");
	if (s.length > 200) s = s.slice(0, 197) + "...";
	return s;
}

// ── Step Completion Logic ────────────────────────────────────────────

/**
 * Determine whether a parsed step is complete.
 *
 * A step is complete when its status is explicitly "complete" OR
 * when all checkboxes are checked (with at least one checkbox present).
 *
 * @param step - Parsed step info (or undefined)
 * @returns true if the step should be considered complete
 */
export function isStepComplete(step: StepInfo | undefined): boolean {
	if (!step) return false;
	if (step.status === "complete") return true;
	return step.totalChecked === step.totalItems && step.totalItems > 0;
}

/**
 * Determine whether a step is "low-risk" and should skip reviews.
 *
 * Low-risk steps: Step 0 (Preflight) and the final step (Delivery/Docs).
 *
 * @param stepNumber - The 0-based step number
 * @param totalSteps - Total number of steps in the task
 * @returns true if the step should skip plan and code reviews
 */
export function isLowRiskStep(stepNumber: number, totalSteps: number): boolean {
	if (totalSteps <= 0) return false;
	const lastStepIndex = totalSteps - 1;
	return stepNumber === 0 || stepNumber === lastStepIndex;
}

// ── Review Helpers ───────────────────────────────────────────────────

/**
 * Extract a review verdict from review file content.
 *
 * Searches for standard verdict patterns (APPROVE, REVISE, RETHINK)
 * with fallback to non-standard formats.
 *
 * @param reviewContent - Raw content of a review output file
 * @returns Uppercase verdict string
 */
export function extractVerdict(reviewContent: string): string {
	// Primary: standard format "### Verdict: APPROVE|REVISE|RETHINK"
	const match = reviewContent.match(/###?\s*Verdict[:\s]*(APPROVE|REVISE|RETHINK)/i);
	if (match) return match[1].toUpperCase();

	// Tolerate non-standard verdict formats
	const lower = reviewContent.toLowerCase();
	if (lower.includes("changes requested") || lower.includes("request changes") || lower.includes("needs revision")) return "REVISE";
	if (lower.includes("approve") && !lower.includes("do not approve") && !lower.includes("cannot approve")) return "APPROVE";
	if (lower.includes("rethink") || lower.includes("re-think")) return "RETHINK";

	return "UNKNOWN";
}

// ── Git Helpers ──────────────────────────────────────────────────────

/**
 * Get the current HEAD commit SHA (short form).
 *
 * @returns Short commit SHA or empty string on failure
 */
export function getHeadCommitSha(): string {
	try {
		const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
			encoding: "utf-8",
			timeout: 5000,
		});
		return result.status === 0 ? (result.stdout || "").trim() : "";
	} catch {
		return "";
	}
}

/**
 * Find the git commit SHA where a specific step was completed.
 *
 * Workers commit at step boundaries with messages like:
 *   feat(TP-048): complete Step N — description
 *
 * @param stepNumber - Step number to search for
 * @param taskId - Task ID prefix in commit message
 * @param since - Optional base commit to search from
 * @returns Commit SHA if found, or empty string
 */
export function findStepBoundaryCommit(stepNumber: number, taskId: string, since?: string): string {
	try {
		const args = ["log", "--oneline", "--grep", `complete Step ${stepNumber}`, "--grep", taskId, "--all-match", "-1", "--format=%H"];
		if (since) args.push(`${since}..HEAD`);
		const result = spawnSync("git", args, {
			encoding: "utf-8",
			timeout: 5000,
		});
		return result.status === 0 ? (result.stdout || "").trim() : "";
	} catch {
		return "";
	}
}

// ── Review Request Generation ────────────────────────────────────────

/**
 * Standards resolution config shape (minimal, no TaskConfig dependency).
 */
export interface StandardsConfig {
	docs: string[];
	rules: string[];
}

/**
 * Resolve which standards apply to a task based on its area.
 *
 * @param globalStandards - Project-level standards
 * @param overrides - Per-area overrides keyed by area name
 * @param taskAreas - Task area definitions keyed by area name
 * @param taskFolder - Absolute task folder path
 * @returns Resolved standards for this task
 */
export function resolveStandards(
	globalStandards: StandardsConfig,
	overrides: Record<string, Partial<StandardsConfig>>,
	taskAreas: Record<string, { path: string;[key: string]: any }>,
	taskFolder: string,
): StandardsConfig {
	const normalizedFolder = taskFolder.replace(/\\/g, "/");
	for (const [areaName, areaCfg] of Object.entries(taskAreas)) {
		const areaPath = areaCfg.path.replace(/\\/g, "/");
		if (normalizedFolder.includes(areaPath)) {
			const override = overrides[areaName];
			if (override) {
				return {
					docs: override.docs ?? globalStandards.docs,
					rules: override.rules ?? globalStandards.rules,
				};
			}
			break;
		}
	}
	return { docs: globalStandards.docs, rules: globalStandards.rules };
}

/**
 * Generate a review request document for a plan or code review.
 *
 * @param type - Review type (plan or code)
 * @param stepNum - Step number being reviewed
 * @param stepName - Step name
 * @param taskPromptPath - Path to the task's PROMPT.md
 * @param taskFolder - Path to the task folder
 * @param projectName - Project name from config
 * @param standards - Resolved standards for this task
 * @param outputPath - Path where the reviewer should write output
 * @param stepBaselineCommit - Optional baseline commit for code review diffs
 * @returns Complete review request markdown content
 */
export function generateReviewRequest(
	type: "plan" | "code",
	stepNum: number,
	stepName: string,
	taskPromptPath: string,
	taskFolder: string,
	projectName: string,
	standards: StandardsConfig,
	outputPath: string,
	stepBaselineCommit?: string,
): string {
	const standardsDocs = standards.docs.map(d => `   - ${d}`).join("\n");
	const standardsRules = standards.rules.map(r => `- ${r}`).join("\n");
	const statusPath = join(taskFolder, "STATUS.md");

	if (type === "plan") {
		return [
			`# Review Request: Plan Review`, "",
			`You are reviewing an implementation plan for a ${projectName} task.`,
			`You have full tool access — use \`read\` to examine files and \`bash\` to run commands.`, "",
			`## Task Context`, "",
			`- **Task PROMPT:** ${taskPromptPath}`,
			`- **Task STATUS:** ${statusPath}`,
			`- **Step being planned:** Step ${stepNum}: ${stepName}`, "",
			`## Instructions`, "",
			`1. Read the PROMPT.md for full requirements`,
			`2. Read STATUS.md for progress so far`,
			`3. Check relevant source files for existing patterns:`,
			standardsDocs, "",
			`## Project Standards`, "", standardsRules, "",
			`## Output`, "",
			`Write your review to: \`${outputPath}\``,
		].join("\n");
	}

	const diffCmd = stepBaselineCommit ? `git diff ${stepBaselineCommit}..HEAD --name-only` : `git diff --name-only`;
	const diffFullCmd = stepBaselineCommit ? `git diff ${stepBaselineCommit}..HEAD` : `git diff`;

	return [
		`# Review Request: Code Review`, "",
		`You are reviewing code changes for a ${projectName} task.`,
		`You have full tool access — use \`read\` to examine files and \`bash\` to run commands.`, "",
		`## Task Context`, "",
		`- **Task PROMPT:** ${taskPromptPath}`,
		`- **Task STATUS:** ${statusPath}`,
		`- **Step reviewed:** Step ${stepNum}: ${stepName}`,
		...(stepBaselineCommit ? [`- **Step baseline commit:** ${stepBaselineCommit}`] : []),
		"",
		`## Instructions`, "",
		`1. Run \`${diffCmd}\` to see files changed in this step`,
		`   Then \`${diffFullCmd}\` for the full diff`,
		`   **Important:** The worker commits code via checkpoints, so plain \`git diff\` may show nothing.`,
		`   Always use the baseline commit range above to see all step changes.`,
		`2. Read changed files in full for context`,
		`3. Check neighboring files for pattern consistency`,
		`4. Check standards:`,
		standardsDocs, "",
		`## Project Standards`, "", standardsRules, "",
		`## Output`, "",
		`Write your review to: \`${outputPath}\``,
	].join("\n");
}

// ── Display Helpers ──────────────────────────────────────────────────

/**
 * Convert a kebab-case name to Title Case for display.
 */
export function displayName(name: string): string {
	return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
