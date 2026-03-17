/**
 * Taskplane gitignore patterns and matching utilities.
 *
 * Extracted as a separate module so that pattern-matching logic can be
 * tested independently from the CLI entrypoint.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

export const TASKPLANE_GITIGNORE_HEADER = "# Taskplane runtime artifacts (machine-specific, do not commit)";
export const TASKPLANE_GITIGNORE_NPM_HEADER = "# Pi project-local packages (if using pi install -l)";

/**
 * Required gitignore entries for Taskplane projects.
 * These patterns cover runtime artifacts that are machine-specific and must
 * not be committed to git. Reused by both repo mode (Step 2) and workspace
 * mode (Step 4) init flows.
 */
export const TASKPLANE_GITIGNORE_ENTRIES = [
	".pi/batch-state.json",
	".pi/batch-history.json",
	".pi/lane-state-*",
	".pi/merge-result-*",
	".pi/merge-request-*",
	".pi/worker-conversation-*",
	".pi/orch-logs/",
	".pi/orch-abort-signal",
	".pi/settings.json",
	".worktrees/",
];

export const TASKPLANE_GITIGNORE_NPM_ENTRIES = [
	".pi/npm/",
];

/**
 * All patterns that should be gitignored, used for tracked-artifact detection.
 */
export const ALL_GITIGNORE_PATTERNS = [...TASKPLANE_GITIGNORE_ENTRIES, ...TASKPLANE_GITIGNORE_NPM_ENTRIES];

// ─── Pattern Matching ───────────────────────────────────────────────────────

/**
 * Convert a gitignore-style pattern to a regex for matching tracked file paths.
 *
 * - Trailing-slash directory patterns (e.g., `.pi/orch-logs/`) are treated as
 *   prefix matches so that files underneath are correctly detected.
 * - Wildcard `*` patterns (e.g., `.pi/lane-state-*`) match any characters.
 * - Exact patterns (e.g., `.pi/batch-state.json`) match exactly.
 *
 * @param {string} pattern - Gitignore-style pattern
 * @returns {RegExp} Regex that matches file paths covered by the pattern
 */
export function patternToRegex(pattern) {
	// Directory patterns (trailing slash) → prefix match
	if (pattern.endsWith("/")) {
		const dirPath = pattern.slice(0, -1);
		const escaped = dirPath.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp("^" + escaped + "/.*");
	}
	// Escape regex special chars except *
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	// Replace * with .*
	const regexStr = "^" + escaped.replace(/\*/g, ".*") + "$";
	return new RegExp(regexStr);
}

/**
 * Check whether a tracked file path matches any of the gitignore patterns.
 *
 * @param {string} filePath - Relative file path from git root
 * @param {string[]} [patterns] - Patterns to match against (defaults to ALL_GITIGNORE_PATTERNS)
 * @returns {boolean} True if the file matches any pattern
 */
export function matchesAnyGitignorePattern(filePath, patterns = ALL_GITIGNORE_PATTERNS) {
	const regexes = patterns.map(p => patternToRegex(p));
	return regexes.some(regex => regex.test(filePath));
}
