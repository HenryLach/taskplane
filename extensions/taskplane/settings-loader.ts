/**
 * Settings Loader — Read and merge Pi extension packages from settings files
 *
 * Reads `.pi/settings.json` from both project-level and global locations,
 * extracts the `packages` arrays, merges them (project entries first,
 * deduplicated), and filters out taskplane itself.
 *
 * Used by spawn points (worker, reviewer, merge agent) to forward
 * user-installed extensions as explicit `-e` flags alongside `--no-extensions`.
 *
 * @module taskplane/settings-loader
 * @since TP-180
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Constants ────────────────────────────────────────────────────────

/** Subpath under a project root for the project-level Pi settings file. */
const PROJECT_SETTINGS_SUBPATH = join(".pi", "settings.json");

/** Subpath under the global agent dir for the global Pi settings file. */
const GLOBAL_SETTINGS_SUBPATH = join(".pi", "agent", "settings.json");

// ── Internal Helpers ─────────────────────────────────────────────────

/**
 * Safely read and parse a JSON file, returning null on any failure.
 */
function readJsonSafe(filePath: string): Record<string, unknown> | null {
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Extract the `packages` array from a parsed settings object.
 * Returns an empty array if the key is missing or not an array of strings.
 */
function extractPackages(settings: Record<string, unknown> | null): string[] {
	if (!settings) return [];
	const packages = settings.packages;
	if (!Array.isArray(packages)) return [];
	// Filter to strings only, skip non-string entries gracefully
	return packages.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/**
 * Resolve the global Pi agent settings path.
 *
 * Resolution order:
 *   1. `PI_CODING_AGENT_DIR` env → `<value>/settings.json`
 *   2. `os.homedir()/.pi/agent/settings.json`
 */
function resolveGlobalSettingsPath(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (agentDir) {
		return join(agentDir, "settings.json");
	}
	return join(homedir(), GLOBAL_SETTINGS_SUBPATH);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load Pi extension packages from project and global settings files.
 *
 * Reads `.pi/settings.json` from the project root (stateRoot) and from
 * the global agent directory, merges the package lists (project first,
 * deduplicated), and filters out any package containing "taskplane"
 * (which is already loaded as the bridge extension).
 *
 * @param stateRoot - Project root directory (used to locate `.pi/settings.json`)
 * @returns Array of package specifiers (e.g., `["npm:pi-sage"]`) or empty array
 */
export function loadPiSettingsPackages(stateRoot: string): string[] {
	// Read project-level packages
	const projectSettingsPath = join(stateRoot, PROJECT_SETTINGS_SUBPATH);
	const projectSettings = readJsonSafe(projectSettingsPath);
	const projectPackages = extractPackages(projectSettings);

	// Read global packages
	const globalSettingsPath = resolveGlobalSettingsPath();
	const globalSettings = readJsonSafe(globalSettingsPath);
	const globalPackages = extractPackages(globalSettings);

	// Merge: project entries first, then global, deduplicated
	const seen = new Set<string>();
	const merged: string[] = [];

	for (const pkg of projectPackages) {
		if (!seen.has(pkg)) {
			seen.add(pkg);
			merged.push(pkg);
		}
	}
	for (const pkg of globalPackages) {
		if (!seen.has(pkg)) {
			seen.add(pkg);
			merged.push(pkg);
		}
	}

	// Filter out taskplane itself (already loaded as bridge extension)
	return merged.filter((pkg) => !pkg.toLowerCase().includes("taskplane"));
}

/**
 * Filter out excluded extensions from a package list.
 *
 * @param packages - Full list of package specifiers
 * @param exclusions - Package specifiers to exclude (exact match)
 * @returns Filtered list with excluded packages removed
 */
export function filterExcludedExtensions(packages: string[], exclusions: string[]): string[] {
	if (!exclusions || exclusions.length === 0) return packages;
	const excludeSet = new Set(exclusions);
	return packages.filter((pkg) => !excludeSet.has(pkg));
}
