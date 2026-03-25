/**
 * Additive upgrade migrations for taskplane.
 *
 * Runs automatically on /orch preflight and extension load to ensure
 * project scaffolding stays up-to-date after package upgrades.
 *
 * Design principles:
 * - Additive only: never overwrite or delete existing files
 * - Idempotent: safe to run multiple times
 * - Non-fatal: migration failures warn but don't block execution
 * - Tracked: applied migrations recorded in .pi/migration-state.json
 *
 * @module migrations
 * @since TP-063
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ── Types ────────────────────────────────────────────────────────────

/**
 * A single additive migration definition.
 */
export interface Migration {
	/** Unique stable ID — once shipped, never changes */
	id: string;
	/** Human-readable description for logs */
	description: string;
	/** Execute the migration. Returns a message describing what was done, or null if skipped. */
	run: (ctx: MigrationContext) => string | null;
}

/**
 * Runtime context passed to each migration's run function.
 */
export interface MigrationContext {
	/** Project root (where .pi/ lives) */
	stateRoot: string;
	/** Path to the taskplane package root (for templates) */
	packageRoot: string;
}

/**
 * Persisted migration state stored in .pi/migration-state.json.
 */
export interface MigrationState {
	/** Map of migration ID → timestamp (ISO string) when it was applied */
	applied: Record<string, string>;
}

// ── State Persistence ────────────────────────────────────────────────

const MIGRATION_STATE_FILENAME = "migration-state.json";

/**
 * Load migration state from .pi/migration-state.json.
 * Returns empty state if file doesn't exist or is malformed.
 */
export function loadMigrationState(stateRoot: string): MigrationState {
	const filePath = join(stateRoot, ".pi", MIGRATION_STATE_FILENAME);
	if (!existsSync(filePath)) {
		return { applied: {} };
	}
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed.applied === "object" && parsed.applied !== null) {
			return { applied: parsed.applied };
		}
		return { applied: {} };
	} catch {
		return { applied: {} };
	}
}

/**
 * Save migration state to .pi/migration-state.json.
 */
export function saveMigrationState(stateRoot: string, state: MigrationState): void {
	const dir = join(stateRoot, ".pi");
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, MIGRATION_STATE_FILENAME);
	writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

// ── Package Root Resolution ──────────────────────────────────────────

/**
 * Resolve the taskplane package root directory.
 *
 * This module lives at `<package-root>/extensions/taskplane/migrations.ts`,
 * so package root is two directories up.
 */
export function resolvePackageRoot(): string {
	try {
		const thisDir = dirname(fileURLToPath(import.meta.url));
		return join(thisDir, "..", "..");
	} catch {
		return join(__dirname, "..", "..");
	}
}

// ── Migration Registry ───────────────────────────────────────────────

/**
 * All registered migrations, in order. New migrations are appended at the end.
 *
 * Once a migration ID is shipped, it must NEVER be removed or renamed —
 * the state file references IDs permanently.
 */
export const MIGRATIONS: Migration[] = [
	{
		id: "add-supervisor-local-template-v1",
		description: "Create .pi/agents/supervisor.md from template if missing",
		run: (ctx: MigrationContext): string | null => {
			const targetPath = join(ctx.stateRoot, ".pi", "agents", "supervisor.md");
			if (existsSync(targetPath)) {
				return null; // Already exists — skip without mutation
			}
			const sourcePath = join(ctx.packageRoot, "templates", "agents", "local", "supervisor.md");
			if (!existsSync(sourcePath)) {
				return null; // Template not found in package — skip silently
			}
			const targetDir = dirname(targetPath);
			mkdirSync(targetDir, { recursive: true });
			copyFileSync(sourcePath, targetPath);
			return `Created .pi/agents/supervisor.md from template`;
		},
	},
];

// ── Migration Runner ─────────────────────────────────────────────────

/**
 * Result of a migration run.
 */
export interface MigrationRunResult {
	/** Number of migrations that ran successfully */
	applied: number;
	/** Messages from successful migrations */
	messages: string[];
	/** Errors from failed migrations (non-fatal) */
	errors: string[];
}

/**
 * Run all pending migrations.
 *
 * Loads state, runs each unapplied migration in order, saves state.
 * Failures are collected but do not stop subsequent migrations.
 *
 * @param stateRoot - Project root where .pi/ lives
 * @param packageRoot - Package root for template resolution (optional, auto-resolved)
 * @returns Result with applied count, messages, and errors
 */
export function runMigrations(
	stateRoot: string,
	packageRoot?: string,
): MigrationRunResult {
	const effectivePackageRoot = packageRoot ?? resolvePackageRoot();
	const state = loadMigrationState(stateRoot);
	const ctx: MigrationContext = { stateRoot, packageRoot: effectivePackageRoot };

	const result: MigrationRunResult = {
		applied: 0,
		messages: [],
		errors: [],
	};

	let stateChanged = false;

	for (const migration of MIGRATIONS) {
		// Skip already-applied migrations
		if (state.applied[migration.id]) {
			continue;
		}

		try {
			const message = migration.run(ctx);
			// Record as applied regardless of whether it created files
			// (null means "nothing to do" which is still a successful run)
			state.applied[migration.id] = new Date().toISOString();
			stateChanged = true;

			if (message) {
				result.applied++;
				result.messages.push(message);
			}
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			result.errors.push(`Migration "${migration.id}" failed: ${errMsg}`);
			// Do NOT mark as applied — will retry on next run
		}
	}

	// Persist state only if something changed
	if (stateChanged) {
		try {
			saveMigrationState(stateRoot, state);
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			result.errors.push(`Failed to save migration state: ${errMsg}`);
		}
	}

	return result;
}
