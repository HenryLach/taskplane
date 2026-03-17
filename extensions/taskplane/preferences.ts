/**
 * User Preferences Layer (Layer 2)
 *
 * Loads personal settings from `~/.pi/agent/taskplane/preferences.json`
 * (or `$PI_CODING_AGENT_DIR/taskplane/preferences.json` if the env var
 * is set).
 *
 * Preferences are merged into project config at load time. Only an
 * explicit allowlist of user-scoped fields may override project config —
 * all other keys in the preferences file are silently ignored to
 * preserve Layer 1 (project) boundaries.
 *
 * Layer 2 allowlist (preferences → config mapping):
 *   operatorId       → orchestrator.orchestrator.operatorId
 *   workerModel      → taskRunner.worker.model
 *   reviewerModel    → taskRunner.reviewer.model
 *   mergeModel       → orchestrator.merge.model
 *   tmuxPrefix       → orchestrator.orchestrator.tmuxPrefix
 *   dashboardPort    → (stored in preferences; not yet in config schema)
 *
 * @module config/preferences
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

import type { TaskplaneConfig } from "./config-schema.ts";


// ── Schema ───────────────────────────────────────────────────────────

/**
 * User preferences shape (camelCase, JSON file uses camelCase keys).
 *
 * All fields are optional — an empty `{}` file is valid.
 * Unknown keys are ignored on load.
 */
export interface UserPreferences {
	/** Operator identifier (e.g., GitHub handle) */
	operatorId?: string;
	/** Default worker model override */
	workerModel?: string;
	/** Default reviewer model override */
	reviewerModel?: string;
	/** Default merge model override */
	mergeModel?: string;
	/** Tmux session name prefix override */
	tmuxPrefix?: string;
	/** Dashboard port (preferences-only; not yet wired into config schema) */
	dashboardPort?: number;
}

/**
 * Default preferences written on first access.
 * All fields are explicitly set to make the file self-documenting.
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
	operatorId: "",
	workerModel: "",
	reviewerModel: "",
	mergeModel: "",
	tmuxPrefix: "",
	dashboardPort: 0,
};

/**
 * Known preference keys — only these are read from the file.
 * Any other key in preferences.json is silently dropped.
 */
const KNOWN_KEYS = new Set<keyof UserPreferences>([
	"operatorId",
	"workerModel",
	"reviewerModel",
	"mergeModel",
	"tmuxPrefix",
	"dashboardPort",
]);


// ── Path Resolution ──────────────────────────────────────────────────

/**
 * Resolve the directory containing user preferences.
 *
 * Resolution:
 *   1. `PI_CODING_AGENT_DIR` env var → `<value>/taskplane/`
 *   2. Otherwise → `<os.homedir()>/.pi/agent/taskplane/`
 *
 * Uses `os.homedir()` for cross-platform home resolution
 * (USERPROFILE on Windows, HOME on Unix) and `path.join()` for separators.
 */
export function resolveUserPreferencesDir(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (agentDir) {
		return join(agentDir, "taskplane");
	}
	return join(homedir(), ".pi", "agent", "taskplane");
}

/**
 * Resolve the full path to `preferences.json`.
 */
export function resolveUserPreferencesPath(): string {
	return join(resolveUserPreferencesDir(), "preferences.json");
}


// ── Loader ───────────────────────────────────────────────────────────

/**
 * Load user preferences from disk.
 *
 * Behavior:
 *   - If the file doesn't exist → auto-create with defaults, return defaults
 *   - If the file is malformed JSON → return defaults (resilient)
 *   - Unknown keys are silently stripped
 *   - Known keys with wrong types are silently dropped
 *
 * @returns Parsed preferences (only known keys)
 */
export function loadUserPreferences(): UserPreferences {
	const filePath = resolveUserPreferencesPath();

	// Auto-create on first access
	if (!existsSync(filePath)) {
		try {
			mkdirSync(dirname(filePath), { recursive: true });
			writeFileSync(
				filePath,
				JSON.stringify(DEFAULT_USER_PREFERENCES, null, 2) + "\n",
				"utf-8",
			);
		} catch {
			// Can't write — return defaults silently
		}
		return { ...DEFAULT_USER_PREFERENCES };
	}

	// Read and parse
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { ...DEFAULT_USER_PREFERENCES };
		}
		return pickKnownKeys(parsed);
	} catch {
		// Malformed JSON or read error — return defaults
		return { ...DEFAULT_USER_PREFERENCES };
	}
}

/**
 * Extract only known preference keys, with basic type validation.
 * Unknown keys are silently ignored.
 */
function pickKnownKeys(raw: Record<string, unknown>): UserPreferences {
	const result: UserPreferences = {};

	for (const key of KNOWN_KEYS) {
		if (!(key in raw)) continue;
		const val = raw[key];

		// Type validation per field
		if (key === "dashboardPort") {
			if (typeof val === "number" && Number.isFinite(val)) {
				result[key] = val;
			}
		} else {
			// All other known fields are strings
			if (typeof val === "string") {
				result[key] = val as any;
			}
		}
	}

	return result;
}


// ── Merge ────────────────────────────────────────────────────────────

/**
 * Apply user preferences to a loaded project config.
 *
 * Only Layer 2 (user-scoped) fields are overridden. All other config
 * values are left untouched. Empty-string preference values are treated
 * as "not set" and do not override project config.
 *
 * Mapping (preference → config):
 *   operatorId    → config.orchestrator.orchestrator.operatorId
 *   workerModel   → config.taskRunner.worker.model
 *   reviewerModel → config.taskRunner.reviewer.model
 *   mergeModel    → config.orchestrator.merge.model
 *   tmuxPrefix    → config.orchestrator.orchestrator.tmuxPrefix
 *   dashboardPort → (no config target yet — stored only)
 *
 * @param config - Mutable project config (modified in place)
 * @param prefs  - User preferences
 * @returns The same config reference (for chaining)
 */
export function applyUserPreferences(
	config: TaskplaneConfig,
	prefs: UserPreferences,
): TaskplaneConfig {
	// Helper: only apply if the preference value is a non-empty string
	const applyString = (prefVal: string | undefined, setter: (v: string) => void) => {
		if (prefVal !== undefined && prefVal !== "") {
			setter(prefVal);
		}
	};

	applyString(prefs.operatorId, (v) => { config.orchestrator.orchestrator.operatorId = v; });
	applyString(prefs.workerModel, (v) => { config.taskRunner.worker.model = v; });
	applyString(prefs.reviewerModel, (v) => { config.taskRunner.reviewer.model = v; });
	applyString(prefs.mergeModel, (v) => { config.orchestrator.merge.model = v; });
	applyString(prefs.tmuxPrefix, (v) => { config.orchestrator.orchestrator.tmuxPrefix = v; });

	// dashboardPort: no config schema target yet — intentionally not applied

	return config;
}
