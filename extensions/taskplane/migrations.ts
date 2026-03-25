/**
 * Additive Upgrade Migrations for Taskplane
 *
 * Provides a lightweight migration runner that applies additive-only
 * changes (e.g., creating missing scaffold files) when extensions load
 * or `/orch` starts. Migrations never overwrite existing files.
 *
 * Migration state is tracked in `.pi/taskplane.json` under the
 * `migrations` key, preserving all existing version-tracker fields.
 *
 * @module migrations
 * @since TP-063
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Metadata for a single additive migration.
 */
export interface Migration {
	/** Unique, stable identifier (e.g., "add-supervisor-local-template-v1") */
	id: string;
	/** Human-readable description for logs */
	description: string;
	/**
	 * Execute the migration. Should only create files that don't exist.
	 *
	 * @param projectRoot - Project root directory
	 * @param packageRoot - Taskplane package root (for template resolution)
	 * @returns A short message describing what was created, or null if skipped (already exists)
	 * @throws If the migration cannot complete (e.g., missing template source)
	 */
	run(projectRoot: string, packageRoot: string): string | null;
}

/**
 * Record of a single applied migration in `.pi/taskplane.json`.
 */
export interface AppliedMigration {
	/** ISO timestamp when the migration was applied */
	appliedAt: string;
}

/**
 * The `migrations` section within `.pi/taskplane.json`.
 */
export interface MigrationState {
	applied: Record<string, AppliedMigration>;
}

/**
 * Shape of `.pi/taskplane.json` (partial — only fields we read/write).
 * Other fields (version, installedAt, lastUpgraded, components) are
 * preserved as-is during read-modify-write.
 */
export interface TaskplaneMeta {
	[key: string]: unknown;
	migrations?: MigrationState;
}

/**
 * Result of running migrations.
 */
export interface MigrationRunResult {
	/** Migration IDs that were applied in this run */
	applied: string[];
	/** Migration IDs that were skipped (already applied or target exists) */
	skipped: string[];
	/** Migrations that failed with errors (non-fatal — logged and skipped) */
	errors: Array<{ id: string; error: string }>;
	/** Human-readable messages for each applied migration */
	messages: string[];
}

// ── Meta File Helpers ────────────────────────────────────────────────

const TASKPLANE_META_FILENAME = "taskplane.json";

/**
 * Load `.pi/taskplane.json`, returning its content or an empty object
 * if the file doesn't exist or is malformed.
 *
 * Never throws — returns `{}` for any read/parse error.
 */
export function loadTaskplaneMeta(projectRoot: string): TaskplaneMeta {
	const metaPath = join(projectRoot, ".pi", TASKPLANE_META_FILENAME);
	try {
		if (!existsSync(metaPath)) return {};
		const raw = readFileSync(metaPath, "utf-8");
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		return parsed as TaskplaneMeta;
	} catch {
		return {};
	}
}

/**
 * Save `.pi/taskplane.json`, merging the provided meta with any
 * existing content. Creates the `.pi/` directory if needed.
 *
 * Performs a shallow merge at the top level — existing keys not in
 * `meta` are preserved. The `migrations` key is always taken from
 * the provided `meta` object (deep replacement).
 */
export function saveTaskplaneMeta(projectRoot: string, meta: TaskplaneMeta): void {
	const piDir = join(projectRoot, ".pi");
	mkdirSync(piDir, { recursive: true });

	const metaPath = join(piDir, TASKPLANE_META_FILENAME);

	// Read existing content to preserve version-tracker fields
	let existing: TaskplaneMeta = {};
	try {
		if (existsSync(metaPath)) {
			const raw = readFileSync(metaPath, "utf-8");
			const parsed = JSON.parse(raw);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				existing = parsed as TaskplaneMeta;
			}
		}
	} catch {
		// Existing file unreadable — start fresh but we'll overwrite only our keys
	}

	// Merge: existing fields preserved, our fields override
	const merged = { ...existing, ...meta };
	writeFileSync(metaPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
}

// ── Package Root Resolution ──────────────────────────────────────────

/**
 * Resolve the taskplane package root directory.
 *
 * Uses ESM `import.meta.url` to compute the path deterministically.
 * The package root is two levels up from this file:
 *   `<package-root>/extensions/taskplane/migrations.ts`
 *
 * @param importMetaUrl - Pass `import.meta.url` from the calling module
 * @returns Absolute path to the package root
 */
export function resolvePackageRoot(importMetaUrl?: string): string {
	const url = importMetaUrl ?? import.meta.url;
	const thisDir = dirname(fileURLToPath(url));
	// extensions/taskplane/ → extensions/ → package root
	return join(thisDir, "..", "..");
}

// ── Migration Registry ──────────────────────────────────────────────

/**
 * Registry of all additive migrations, ordered by creation date.
 *
 * New migrations are appended to this array. Each migration must:
 * - Have a unique, stable `id` (never renamed after release)
 * - Only create files that don't exist (additive-only)
 * - Throw on unrecoverable errors (e.g., missing template source)
 * - Return null if the target already exists (skip)
 */
export const MIGRATION_REGISTRY: Migration[] = [
	{
		id: "add-supervisor-local-template-v1",
		description: "Create .pi/agents/supervisor.md from template if missing",
		run(projectRoot: string, packageRoot: string): string | null {
			const targetPath = join(projectRoot, ".pi", "agents", "supervisor.md");

			// Skip if file already exists — never overwrite
			if (existsSync(targetPath)) {
				return null;
			}

			// Resolve template source
			const templatePath = join(packageRoot, "templates", "agents", "local", "supervisor.md");
			if (!existsSync(templatePath)) {
				throw new Error(
					`Migration template not found: ${templatePath}. ` +
					`This may indicate a packaging issue with the taskplane package.`,
				);
			}

			// Create target directory and copy template
			mkdirSync(dirname(targetPath), { recursive: true });
			copyFileSync(templatePath, targetPath);

			return "Created .pi/agents/supervisor.md from template";
		},
	},
];

// ── Migration Runner ─────────────────────────────────────────────────

/**
 * Run all pending additive migrations.
 *
 * Loads migration state from `.pi/taskplane.json`, runs only unapplied
 * migrations from the registry, and persists applied IDs + timestamps.
 *
 * Each migration is individually try/caught:
 * - Success → recorded as applied, message logged
 * - Skip (returns null) → recorded as applied (target already exists)
 * - Error → logged and skipped (NOT recorded — will be retried next time)
 *
 * @param projectRoot - Project root directory
 * @param packageRoot - Taskplane package root (for template resolution).
 *                      If omitted, resolved from import.meta.url.
 * @returns Migration run result with applied/skipped/error details
 */
export function runMigrations(
	projectRoot: string,
	packageRoot?: string,
): MigrationRunResult {
	const pkgRoot = packageRoot ?? resolvePackageRoot();
	const result: MigrationRunResult = {
		applied: [],
		skipped: [],
		errors: [],
		messages: [],
	};

	// Load current state
	const meta = loadTaskplaneMeta(projectRoot);
	const migrationState: MigrationState = meta.migrations ?? { applied: {} };

	let stateChanged = false;

	for (const migration of MIGRATION_REGISTRY) {
		// Skip already-applied migrations
		if (migrationState.applied[migration.id]) {
			result.skipped.push(migration.id);
			continue;
		}

		try {
			const message = migration.run(projectRoot, pkgRoot);

			// Record as applied (whether it created something or skipped)
			migrationState.applied[migration.id] = {
				appliedAt: new Date().toISOString(),
			};
			stateChanged = true;

			if (message) {
				result.applied.push(migration.id);
				result.messages.push(`📦 Migration: ${message}`);
			} else {
				// Target already existed — still mark as applied so we don't recheck
				result.skipped.push(migration.id);
			}
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			result.errors.push({ id: migration.id, error: errMsg });
			// NOT recorded as applied — will be retried next time
		}
	}

	// Persist state if anything changed
	if (stateChanged) {
		try {
			saveTaskplaneMeta(projectRoot, { ...meta, migrations: migrationState });
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			result.errors.push({
				id: "__state_save",
				error: `Failed to persist migration state: ${errMsg}`,
			});
		}
	}

	return result;
}
