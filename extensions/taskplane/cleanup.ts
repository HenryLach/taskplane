/**
 * Artifact cleanup and log rotation for orchestrator runtime files.
 *
 * Three cleanup layers prevent unbounded disk growth:
 *
 * 1. **Post-Integrate Cleanup** — Deletes batch-specific telemetry and merge
 *    result files after successful /orch-integrate. Scoped by batchId.
 *
 * 2. **Age-Based Preflight Sweep** — On /orch start, removes telemetry and
 *    merge artifacts older than 7 days. Catches files missed by Layer 1
 *    (e.g., aborted batches, manual branch deletions).
 *
 * 3. **Size-Capped Log Rotation** — Rotates append-only supervisor logs
 *    (events.jsonl, actions.jsonl) at a 5MB threshold during preflight.
 *    Keeps one .old generation.
 *
 * All cleanup is **non-fatal** — failures warn but never block execution.
 *
 * @module orch/cleanup
 * @since TP-065
 */
import { existsSync, readdirSync, statSync, unlinkSync, renameSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { MAILBOX_DIR_NAME } from "./types.ts";

// ── Layer 1: Post-Integrate Cleanup ─────────────────────────────────

/**
 * Result of post-integrate artifact cleanup.
 */
export interface PostIntegrateCleanupResult {
	/** Number of telemetry files deleted */
	telemetryFilesDeleted: number;
	/** Number of merge result/request files deleted */
	mergeFilesDeleted: number;
	/** Number of lane prompt files deleted */
	promptFilesDeleted: number;
	/** Number of mailbox batch directories deleted (0 or 1) */
	mailboxDirsDeleted: number;
	/** Number of context-snapshot batch directories deleted (0 or 1) */
	snapshotDirsDeleted: number;
	/** Warnings from non-fatal cleanup failures */
	warnings: string[];
}

/**
 * Clean up batch-specific telemetry and merge result files after integrate.
 *
 * Targets files whose names contain the batchId:
 * - `.pi/telemetry/*-{batchId}-*.jsonl` — worker/merger sidecar files
 * - `.pi/telemetry/*-{batchId}-*-exit.json` — exit summaries
 * - `.pi/telemetry/lane-prompt-*.txt` — temporary prompt files (all, not scoped)
 * - `.pi/merge-result-*-{batchId}.json` — merge result files
 * - `.pi/merge-request-*-{batchId}.txt` — merge request files
 *
 * @param stateRoot - Root directory containing .pi/ (workspace root or repo root)
 * @param batchId - Batch ID to scope deletion
 * @returns Cleanup result with counts and warnings
 */
export function cleanupPostIntegrate(stateRoot: string, batchId: string): PostIntegrateCleanupResult {
	const result: PostIntegrateCleanupResult = {
		telemetryFilesDeleted: 0,
		mergeFilesDeleted: 0,
		promptFilesDeleted: 0,
		mailboxDirsDeleted: 0,
		snapshotDirsDeleted: 0,
		warnings: [],
	};

	if (!batchId) {
		result.warnings.push("No batchId provided — skipping post-integrate cleanup");
		return result;
	}

	// ── Telemetry files (.pi/telemetry/) ─────────────────────────
	const telemetryDir = join(stateRoot, ".pi", "telemetry");
	if (existsSync(telemetryDir)) {
		try {
			const entries = readdirSync(telemetryDir);
			for (const entry of entries) {
				// Delete batch-scoped sidecar/exit files containing the batchId
				if (entry.includes(batchId) && (entry.endsWith(".jsonl") || entry.endsWith("-exit.json"))) {
					try {
						unlinkSync(join(telemetryDir, entry));
						result.telemetryFilesDeleted++;
					} catch (err: unknown) {
						result.warnings.push(`Failed to delete telemetry file ${entry}: ${(err as Error).message}`);
					}
				}
				// Delete all lane-prompt-*.txt files (not batch-scoped — they're
				// temporary and should be cleaned up with any batch)
				if (entry.startsWith("lane-prompt-") && entry.endsWith(".txt")) {
					try {
						unlinkSync(join(telemetryDir, entry));
						result.promptFilesDeleted++;
					} catch (err: unknown) {
						result.warnings.push(`Failed to delete prompt file ${entry}: ${(err as Error).message}`);
					}
				}
			}
		} catch (err: unknown) {
			result.warnings.push(`Failed to read telemetry directory: ${(err as Error).message}`);
		}
	}

	// ── Merge result/request files (.pi/) ────────────────────────
	const piDir = join(stateRoot, ".pi");
	if (existsSync(piDir)) {
		try {
			const entries = readdirSync(piDir);
			for (const entry of entries) {
				if (entry.includes(batchId) && (
					(entry.startsWith("merge-result-") && entry.endsWith(".json")) ||
					(entry.startsWith("merge-request-") && entry.endsWith(".txt"))
				)) {
					try {
						unlinkSync(join(piDir, entry));
						result.mergeFilesDeleted++;
					} catch (err: unknown) {
						result.warnings.push(`Failed to delete merge file ${entry}: ${(err as Error).message}`);
					}
				}
			}
		} catch (err: unknown) {
			result.warnings.push(`Failed to read .pi directory: ${(err as Error).message}`);
		}
	}

	// ── Mailbox directory (.pi/mailbox/{batchId}/) ───────────
	const mailboxBatchDir = join(stateRoot, ".pi", MAILBOX_DIR_NAME, batchId);
	if (existsSync(mailboxBatchDir)) {
		try {
			rmSync(mailboxBatchDir, { recursive: true, force: true });
			result.mailboxDirsDeleted = 1;
		} catch (err: unknown) {
			result.warnings.push(`Failed to delete mailbox directory ${mailboxBatchDir}: ${(err as Error).message}`);
		}
	}

	// ── Context snapshots directory (.pi/context-snapshots/{batchId}/) ──────
	const snapshotBatchDir = join(stateRoot, ".pi", "context-snapshots", batchId);
	if (existsSync(snapshotBatchDir)) {
		try {
			rmSync(snapshotBatchDir, { recursive: true, force: true });
			result.snapshotDirsDeleted = 1;
		} catch (err: unknown) {
			result.warnings.push(`Failed to delete context-snapshots directory ${snapshotBatchDir}: ${(err as Error).message}`);
		}
	}

	return result;
}

/**
 * Format post-integrate cleanup result for user-facing notification.
 */
export function formatPostIntegrateCleanup(result: PostIntegrateCleanupResult): string {
	const parts: string[] = [];
	const totalDeleted = result.telemetryFilesDeleted + result.mergeFilesDeleted + result.promptFilesDeleted + result.mailboxDirsDeleted + result.snapshotDirsDeleted;

	if (totalDeleted > 0) {
		const segments: string[] = [];
		if (result.telemetryFilesDeleted > 0) segments.push(`${result.telemetryFilesDeleted} telemetry`);
		if (result.mergeFilesDeleted > 0) segments.push(`${result.mergeFilesDeleted} merge`);
		if (result.promptFilesDeleted > 0) segments.push(`${result.promptFilesDeleted} prompt`);
		if (result.mailboxDirsDeleted > 0) segments.push(`${result.mailboxDirsDeleted} mailbox`);
		if (result.snapshotDirsDeleted > 0) segments.push(`${result.snapshotDirsDeleted} snapshots`);
		parts.push(`🧹 Cleaned up ${totalDeleted} artifact file(s): ${segments.join(", ")}`);
	}

	for (const warning of result.warnings) {
		parts.push(`  ⚠️ ${warning}`);
	}

	return parts.join("\n");
}

// ── Layer 2: Age-Based Preflight Sweep ──────────────────────────────

/** Default max age for stale artifacts (7 days in milliseconds). */
export const STALE_ARTIFACT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Result of a preflight age-based sweep.
 */
export interface PreflightSweepResult {
	/** Number of stale files deleted */
	staleFilesDeleted: number;
	/** Number of stale mailbox batch directories deleted */
	staleDirsDeleted: number;
	/** Whether the sweep was skipped (e.g., active batch) */
	skipped: boolean;
	/** Reason for skipping (if skipped) */
	skipReason?: string;
	/** Warnings from non-fatal cleanup failures */
	warnings: string[];
}

/**
 * Dependencies injected into sweepStaleArtifacts for testability.
 */
export interface SweepDeps {
	/** Check if a batch is currently active (phase is not terminal). */
	isBatchActive: () => boolean;
	/** Get the current timestamp (for deterministic testing). */
	now: () => number;
}

/**
 * Sweep stale artifacts older than maxAgeMs during preflight.
 *
 * Targets:
 * - `.pi/telemetry/*.jsonl` — sidecar files
 * - `.pi/telemetry/*-exit.json` — exit summaries
 * - `.pi/telemetry/lane-prompt-*.txt` — temporary prompt files
 * - `.pi/merge-result-*.json` — merge result files
 * - `.pi/merge-request-*.txt` — merge request files
 *
 * Uses file mtime for age detection. Skips files modified within maxAgeMs.
 * If a batch is currently active (executing/merging), skips ALL cleanup.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param deps - Injectable dependencies for testability
 * @param maxAgeMs - Maximum file age in milliseconds (default: 7 days)
 * @returns Sweep result with count and warnings
 */
export function sweepStaleArtifacts(
	stateRoot: string,
	deps: SweepDeps,
	maxAgeMs: number = STALE_ARTIFACT_MAX_AGE_MS,
): PreflightSweepResult {
	const result: PreflightSweepResult = {
		staleFilesDeleted: 0,
		staleDirsDeleted: 0,
		skipped: false,
		warnings: [],
	};

	// Guard: skip if batch is actively executing
	try {
		if (deps.isBatchActive()) {
			result.skipped = true;
			result.skipReason = "Active batch detected — skipping stale artifact sweep";
			return result;
		}
	} catch {
		// If we can't determine batch state, proceed cautiously
	}

	const now = deps.now();
	const cutoff = now - maxAgeMs;

	/**
	 * Delete files older than cutoff from a directory, matching a filter.
	 */
	const sweepDir = (dir: string, filter: (name: string) => boolean): void => {
		if (!existsSync(dir)) return;
		try {
			const entries = readdirSync(dir);
			for (const entry of entries) {
				if (!filter(entry)) continue;
				const filePath = join(dir, entry);
				try {
					const stat = statSync(filePath);
					if (!stat.isFile()) continue;
					if (stat.mtimeMs < cutoff) {
						unlinkSync(filePath);
						result.staleFilesDeleted++;
					}
				} catch (err: unknown) {
					result.warnings.push(`Failed to process ${entry}: ${(err as Error).message}`);
				}
			}
		} catch (err: unknown) {
			result.warnings.push(`Failed to read directory ${dir}: ${(err as Error).message}`);
		}
	};

	// Sweep telemetry files
	sweepDir(join(stateRoot, ".pi", "telemetry"), (name) =>
		name.endsWith(".jsonl") ||
		name.endsWith("-exit.json") ||
		(name.startsWith("lane-prompt-") && name.endsWith(".txt")),
	);

	// Sweep merge result/request files
	sweepDir(join(stateRoot, ".pi"), (name) =>
		(name.startsWith("merge-result-") && name.endsWith(".json")) ||
		(name.startsWith("merge-request-") && name.endsWith(".txt")),
	);

	// Sweep stale batch directories under a parent (mailbox, context-snapshots)
	const sweepBatchDirs = (parentDir: string, label: string): void => {
		if (!existsSync(parentDir)) return;
		try {
			const entries = readdirSync(parentDir);
			for (const entry of entries) {
				const entryPath = join(parentDir, entry);
				try {
					const stat = statSync(entryPath);
					if (!stat.isDirectory()) continue;
					if (stat.mtimeMs < cutoff) {
						rmSync(entryPath, { recursive: true, force: true });
						result.staleDirsDeleted++;
					}
				} catch (err: unknown) {
					result.warnings.push(`Failed to process ${label} dir ${entry}: ${(err as Error).message}`);
				}
			}
		} catch (err: unknown) {
			result.warnings.push(`Failed to read ${label} directory ${parentDir}: ${(err as Error).message}`);
		}
	};

	// Sweep stale mailbox batch directories (.pi/mailbox/{batchId}/)
	sweepBatchDirs(join(stateRoot, ".pi", MAILBOX_DIR_NAME), "mailbox");

	// Sweep stale context-snapshot batch directories (.pi/context-snapshots/{batchId}/)
	sweepBatchDirs(join(stateRoot, ".pi", "context-snapshots"), "context-snapshots");

	return result;
}

/**
 * Format preflight sweep result for logging.
 */
export function formatPreflightSweep(result: PreflightSweepResult): string {
	if (result.skipped) {
		return `ℹ️ Preflight sweep skipped: ${result.skipReason}`;
	}
	if (result.staleFilesDeleted === 0 && result.staleDirsDeleted === 0 && result.warnings.length === 0) {
		return ""; // Nothing to report
	}
	const parts: string[] = [];
	if (result.staleFilesDeleted > 0 || result.staleDirsDeleted > 0) {
		const segments: string[] = [];
		if (result.staleFilesDeleted > 0) segments.push(`${result.staleFilesDeleted} stale artifact(s)`);
		if (result.staleDirsDeleted > 0) segments.push(`${result.staleDirsDeleted} stale mailbox dir(s)`);
		parts.push(`🧹 Preflight cleanup: removed ${segments.join(" and ")} (>7 days old)`);
	}
	for (const warning of result.warnings) {
		parts.push(`  ⚠️ ${warning}`);
	}
	return parts.join("\n");
}

// ── Layer 3: Size-Capped Log Rotation ───────────────────────────────

/** Default rotation threshold: 5MB. */
export const LOG_ROTATION_THRESHOLD_BYTES = 5 * 1024 * 1024;

/**
 * Result of log rotation.
 */
export interface LogRotationResult {
	/** Files that were rotated */
	rotated: string[];
	/** Warnings from non-fatal rotation failures */
	warnings: string[];
}

/**
 * Rotate supervisor append-only logs at a size threshold.
 *
 * Checks `events.jsonl` and `actions.jsonl` in `.pi/supervisor/`.
 * If a file exceeds the threshold, renames it to `.old` (overwriting
 * any existing `.old`), allowing a fresh file to be created on next write.
 *
 * Only call during preflight (not mid-batch).
 *
 * @param stateRoot - Root directory containing .pi/
 * @param thresholdBytes - Maximum file size before rotation (default: 5MB)
 * @returns Rotation result
 */
export function rotateSupervisorLogs(
	stateRoot: string,
	thresholdBytes: number = LOG_ROTATION_THRESHOLD_BYTES,
): LogRotationResult {
	const result: LogRotationResult = {
		rotated: [],
		warnings: [],
	};

	const supervisorDir = join(stateRoot, ".pi", "supervisor");
	if (!existsSync(supervisorDir)) {
		return result; // Nothing to rotate
	}

	const filesToRotate = ["events.jsonl", "actions.jsonl"];

	for (const fileName of filesToRotate) {
		const filePath = join(supervisorDir, fileName);
		if (!existsSync(filePath)) continue;

		try {
			const stat = statSync(filePath);
			if (!stat.isFile() || stat.size <= thresholdBytes) continue;

			const oldPath = `${filePath}.old`;
			renameSync(filePath, oldPath);
			result.rotated.push(fileName);
		} catch (err: unknown) {
			result.warnings.push(`Failed to rotate ${fileName}: ${(err as Error).message}`);
		}
	}

	return result;
}

/**
 * Format log rotation result for logging.
 */
export function formatLogRotation(result: LogRotationResult): string {
	if (result.rotated.length === 0 && result.warnings.length === 0) {
		return ""; // Nothing to report
	}
	const parts: string[] = [];
	if (result.rotated.length > 0) {
		parts.push(`🔄 Rotated ${result.rotated.length} supervisor log(s): ${result.rotated.join(", ")}`);
	}
	for (const warning of result.warnings) {
		parts.push(`  ⚠️ ${warning}`);
	}
	return parts.join("\n");
}

// ── Combined Preflight Cleanup ──────────────────────────────────────

/**
 * Combined result of preflight cleanup (Layer 2 + Layer 3).
 */
export interface PreflightCleanupResult {
	sweep: PreflightSweepResult;
	rotation: LogRotationResult;
}

/**
 * Run all preflight cleanup operations (Layer 2 + Layer 3).
 *
 * Called from the engine's preflight phase before batch starts.
 * Always non-fatal.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param deps - Sweep dependencies (active batch check)
 * @returns Combined cleanup result
 */
export function runPreflightCleanup(
	stateRoot: string,
	deps: SweepDeps,
): PreflightCleanupResult {
	const sweep = sweepStaleArtifacts(stateRoot, deps);
	const rotation = rotateSupervisorLogs(stateRoot);
	return { sweep, rotation };
}

/**
 * Format combined preflight cleanup result for user notification.
 *
 * Returns an empty string if nothing happened (no files cleaned/rotated).
 */
export function formatPreflightCleanup(result: PreflightCleanupResult): string {
	const parts: string[] = [];

	// Layer 2: age-based sweep
	if (!result.sweep.skipped && (result.sweep.staleFilesDeleted > 0 || result.sweep.staleDirsDeleted > 0)) {
		const segments: string[] = [];
		if (result.sweep.staleFilesDeleted > 0) segments.push(`${result.sweep.staleFilesDeleted} stale artifact(s)`);
		if (result.sweep.staleDirsDeleted > 0) segments.push(`${result.sweep.staleDirsDeleted} stale mailbox dir(s)`);
		parts.push(`removed ${segments.join(" and ")} (>7 days old)`);
	}

	// Layer 3: log rotation
	if (result.rotation.rotated.length > 0) {
		parts.push(`rotated ${result.rotation.rotated.join(", ")} (>5 MB)`);
	}

	// Collect warnings from both layers
	const warnings = [...result.sweep.warnings, ...result.rotation.warnings];
	if (warnings.length > 0) {
		parts.push(`⚠️ ${warnings.length} cleanup warning(s)`);
	}

	if (parts.length === 0) return "";
	return `🧹 Preflight cleanup: ${parts.join("; ")}`;
}
