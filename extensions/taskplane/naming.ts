/**
 * Naming contract helpers for team-scale collision resistance.
 *
 * Provides deterministic, human-readable identifiers for TMUX sessions,
 * worktree directories, git branches, and merge artifacts. All naming
 * components are sanitized for safe use in filesystem paths, git refs,
 * and TMUX session names.
 *
 * @module orch/naming
 */
import { basename, resolve } from "path";
import { userInfo } from "os";

import type { OrchestratorConfig } from "./types.ts";

// ── Sanitization ─────────────────────────────────────────────────────

/**
 * Sanitize a raw string into a safe naming component.
 *
 * Rules:
 * - Lowercase
 * - Replace non-alphanumeric characters (except hyphens) with hyphens
 * - Collapse consecutive hyphens
 * - Trim leading/trailing hyphens
 * - Truncate to `maxLen` characters
 *
 * Safe for use in: TMUX session names, git branch refs, filesystem paths.
 *
 * @param raw    - Raw input string
 * @param maxLen - Maximum length (default: 16)
 * @returns Sanitized string, or empty string if input sanitizes to nothing
 */
export function sanitizeNameComponent(raw: string, maxLen: number = 16): string {
	return raw
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLen);
}

// ── Operator ID ──────────────────────────────────────────────────────

/**
 * Resolve the operator identifier from available sources.
 *
 * Resolution order (first non-empty wins):
 * 1. `TASKPLANE_OPERATOR_ID` environment variable
 * 2. `operator_id` field in OrchestratorConfig
 * 3. Current OS username via `os.userInfo().username`
 * 4. Fallback: `"op"`
 *
 * The resolved value is sanitized and truncated to 12 characters.
 *
 * @param config - Orchestrator configuration (may contain operator_id)
 * @param env    - Environment variables (defaults to process.env)
 * @returns Sanitized operator identifier (never empty)
 */
export function resolveOperatorId(
	config: OrchestratorConfig,
	env: Record<string, string | undefined> = process.env,
): string {
	const FALLBACK = "op";
	const MAX_LEN = 12;

	// 1. Environment variable
	const envValue = env.TASKPLANE_OPERATOR_ID;
	if (envValue && envValue.trim()) {
		const sanitized = sanitizeNameComponent(envValue.trim(), MAX_LEN);
		if (sanitized) return sanitized;
	}

	// 2. Config field
	const configValue = config.orchestrator.operator_id;
	if (configValue && configValue.trim()) {
		const sanitized = sanitizeNameComponent(configValue.trim(), MAX_LEN);
		if (sanitized) return sanitized;
	}

	// 3. OS username
	try {
		const username = userInfo().username;
		if (username && username.trim()) {
			const sanitized = sanitizeNameComponent(username.trim(), MAX_LEN);
			if (sanitized) return sanitized;
		}
	} catch {
		// userInfo() can throw on some platforms
	}

	// 4. Fallback
	return FALLBACK;
}

// ── Repo Slug ────────────────────────────────────────────────────────

/**
 * Derive a repo slug from the repository root directory name.
 *
 * Provides cross-repo disambiguation when multiple repos share the
 * same machine. Used in TMUX session names and worktree paths where
 * names must be globally unique on the machine.
 *
 * @param repoRoot - Absolute path to the repository root
 * @returns Sanitized repo slug (never empty; falls back to "repo")
 */
export function resolveRepoSlug(repoRoot: string): string {
	const FALLBACK = "repo";
	const MAX_LEN = 16;

	const dirName = basename(resolve(repoRoot));
	if (!dirName) return FALLBACK;

	const sanitized = sanitizeNameComponent(dirName, MAX_LEN);
	return sanitized || FALLBACK;
}
