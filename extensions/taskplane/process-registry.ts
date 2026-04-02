/**
 * Process Registry — Runtime V2 agent lifecycle management
 *
 * File-backed registry that replaces legacy session discovery as the
 * authoritative source of truth for agent liveness, identity, and
 * attribution.
 *
 * Key design rules:
 *   1. Parent writes manifest BEFORE child is considered visible.
 *   2. Parent updates manifest on every status transition.
 *   3. Operator tools read the registry, not terminal-session probes.
 *   4. Resume/cleanup validates pid + startedAt for orphan detection.
 *
 * File locations:
 *   .pi/runtime/{batchId}/registry.json       — batch-level snapshot
 *   .pi/runtime/{batchId}/agents/{agentId}/manifest.json — per-agent
 *
 * @module taskplane/process-registry
 * @since TP-104
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, appendFileSync, renameSync } from "fs";
import { join, dirname } from "path";

import {
	TERMINAL_AGENT_STATUSES,
	runtimeRoot,
	runtimeAgentDir,
	runtimeManifestPath,
	runtimeRegistryPath,
	runtimeAgentEventsPath,
	runtimeLaneSnapshotPath,
	validateAgentManifest,
	type RuntimeAgentId,
	type RuntimeAgentManifest,
	type RuntimeAgentRole,
	type RuntimeAgentStatus,
	type RuntimeRegistry,
	type PacketPaths,
} from "./types.ts";

// ── Manifest Lifecycle ───────────────────────────────────────────────

/**
 * Write or update an agent manifest atomically.
 *
 * Uses write-to-temp + rename for crash safety. Creates parent
 * directories if they don't exist.
 *
 * @since TP-104
 */
export function writeManifest(stateRoot: string, manifest: RuntimeAgentManifest): void {
	const dir = runtimeAgentDir(stateRoot, manifest.batchId, manifest.agentId);
	mkdirSync(dir, { recursive: true });
	const path = runtimeManifestPath(stateRoot, manifest.batchId, manifest.agentId);
	const tmpPath = path + ".tmp";
	writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
	// Atomic rename (same directory = safe on all platforms)
	renameSync(tmpPath, path);
}

/**
 * Read an agent manifest. Returns null if not found or malformed.
 *
 * @since TP-104
 */
export function readManifest(stateRoot: string, batchId: string, agentId: RuntimeAgentId): RuntimeAgentManifest | null {
	const path = runtimeManifestPath(stateRoot, batchId, agentId);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw);
		const errors = validateAgentManifest(parsed);
		if (errors.length > 0) {
			console.error(`[process-registry] invalid manifest ${agentId}: ${errors.join(", ")}`);
			return null;
		}
		return parsed as RuntimeAgentManifest;
	} catch (err: any) {
		console.error(`[process-registry] failed to read manifest ${agentId}: ${err?.message}`);
		return null;
	}
}

/**
 * Update an agent's status in its manifest.
 *
 * Reads the current manifest, updates the status field, and writes
 * it back atomically. No-op if manifest doesn't exist.
 *
 * @since TP-104
 */
export function updateManifestStatus(
	stateRoot: string,
	batchId: string,
	agentId: RuntimeAgentId,
	status: RuntimeAgentStatus,
): void {
	const manifest = readManifest(stateRoot, batchId, agentId);
	if (!manifest) return;
	manifest.status = status;
	writeManifest(stateRoot, manifest);
}

/**
 * Create a fresh RuntimeAgentManifest with required fields.
 *
 * @since TP-104
 */
export function createManifest(opts: {
	batchId: string;
	agentId: RuntimeAgentId;
	role: RuntimeAgentRole;
	laneNumber: number | null;
	taskId: string | null;
	repoId: string;
	pid: number;
	parentPid: number;
	cwd: string;
	packet: PacketPaths | null;
}): RuntimeAgentManifest {
	return {
		batchId: opts.batchId,
		agentId: opts.agentId,
		role: opts.role,
		laneNumber: opts.laneNumber,
		taskId: opts.taskId,
		repoId: opts.repoId,
		pid: opts.pid,
		parentPid: opts.parentPid,
		startedAt: Date.now(),
		status: "spawning",
		cwd: opts.cwd,
		packet: opts.packet,
	};
}

// ── Registry Snapshot ────────────────────────────────────────────────

/**
 * Build a registry snapshot from all agent manifests in a batch.
 *
 * Scans the agents/ directory under the runtime root and reads all
 * valid manifests.
 *
 * @since TP-104
 */
export function buildRegistrySnapshot(stateRoot: string, batchId: string): RuntimeRegistry {
	const agentsDir = join(runtimeRoot(stateRoot, batchId), "agents");
	const agents: Record<RuntimeAgentId, RuntimeAgentManifest> = {};

	if (existsSync(agentsDir)) {
		try {
			const entries = readdirSync(agentsDir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const agentId = entry.name;
				const manifest = readManifest(stateRoot, batchId, agentId);
				if (manifest) {
					agents[agentId] = manifest;
				}
			}
		} catch (err: any) {
			console.error(`[process-registry] failed to scan agents dir: ${err?.message}`);
		}
	}

	return {
		batchId,
		updatedAt: Date.now(),
		agents,
	};
}

/**
 * Write the registry snapshot to disk.
 *
 * @since TP-104
 */
export function writeRegistrySnapshot(stateRoot: string, registry: RuntimeRegistry): void {
	const path = runtimeRegistryPath(stateRoot, registry.batchId);
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = path + ".tmp";
	writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
	renameSync(tmpPath, path);
}

/**
 * Read the registry snapshot from disk. Returns null if not found.
 *
 * @since TP-104
 */
export function readRegistrySnapshot(stateRoot: string, batchId: string): RuntimeRegistry | null {
	const path = runtimeRegistryPath(stateRoot, batchId);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

// ── Liveness Checks ──────────────────────────────────────────────────

/**
 * Check whether a process with the given PID is still alive.
 *
 * Uses `process.kill(pid, 0)` which sends no signal but checks existence.
 * Returns false for PID 0, negative PIDs, and dead processes.
 *
 * @since TP-104
 */
export function isProcessAlive(pid: number): boolean {
	if (!pid || pid <= 0 || !Number.isFinite(pid)) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Determine if an agent is in a terminal (non-alive) state.
 *
 * @since TP-104
 */
export function isTerminalStatus(status: RuntimeAgentStatus): boolean {
	return TERMINAL_AGENT_STATUSES.has(status);
}

/**
 * Get all live (non-terminal) agents from a registry snapshot.
 *
 * @since TP-104
 */
export function getLiveAgents(registry: RuntimeRegistry): RuntimeAgentManifest[] {
	return Object.values(registry.agents).filter(m => !isTerminalStatus(m.status));
}

/**
 * Get all agents matching a specific role from a registry snapshot.
 *
 * @since TP-104
 */
export function getAgentsByRole(registry: RuntimeRegistry, role: RuntimeAgentRole): RuntimeAgentManifest[] {
	return Object.values(registry.agents).filter(m => m.role === role);
}

// ── Orphan Detection ─────────────────────────────────────────────────

/**
 * Detect orphaned agents — manifests that claim to be running but whose
 * process is no longer alive.
 *
 * Returns agent IDs of orphans. Caller decides whether to terminate,
 * update manifest status, or log.
 *
 * @since TP-104
 */
export function detectOrphans(registry: RuntimeRegistry): RuntimeAgentId[] {
	const orphans: RuntimeAgentId[] = [];
	for (const manifest of Object.values(registry.agents)) {
		if (isTerminalStatus(manifest.status)) continue;
		if (!isProcessAlive(manifest.pid)) {
			orphans.push(manifest.agentId);
		}
	}
	return orphans;
}

/**
 * Mark detected orphans as crashed in their manifests.
 *
 * @since TP-104
 */
export function markOrphansCrashed(stateRoot: string, batchId: string, orphanIds: RuntimeAgentId[]): void {
	for (const agentId of orphanIds) {
		updateManifestStatus(stateRoot, batchId, agentId, "crashed");
	}
}

// ── Cleanup ──────────────────────────────────────────────────────────

/**
 * Remove all runtime artifacts for a batch.
 *
 * Best-effort: logs errors but doesn't throw.
 *
 * @since TP-104
 */
export function cleanupBatchRuntime(stateRoot: string, batchId: string): { removed: boolean; error?: string } {
	const root = runtimeRoot(stateRoot, batchId);
	if (!existsSync(root)) return { removed: false };
	try {
		rmSync(root, { recursive: true, force: true });
		return { removed: true };
	} catch (err: any) {
		console.error(`[process-registry] failed to cleanup batch runtime: ${err?.message}`);
		return { removed: false, error: err?.message };
	}
}

// ── Normalized Event Helpers ─────────────────────────────────────────

/**
 * Append a normalized event to an agent's event log.
 *
 * Creates the events file and parent directories if they don't exist.
 * Best-effort: logs errors but doesn't throw.
 *
 * @since TP-104
 */
export function appendAgentEvent(
	stateRoot: string,
	batchId: string,
	agentId: RuntimeAgentId,
	event: Record<string, unknown>,
): void {
	const path = runtimeAgentEventsPath(stateRoot, batchId, agentId);
	mkdirSync(dirname(path), { recursive: true });
	try {
		appendFileSync(path, JSON.stringify(event) + "\n", "utf-8");
	} catch (err: any) {
		console.error(`[process-registry] failed to append event for ${agentId}: ${err?.message}`);
	}
}

/**
 * Write a lane snapshot to disk.
 *
 * @since TP-104
 */
export function writeLaneSnapshot(
	stateRoot: string,
	batchId: string,
	laneNumber: number,
	snapshot: Record<string, unknown>,
): void {
	const path = runtimeLaneSnapshotPath(stateRoot, batchId, laneNumber);
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = path + ".tmp";
	writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
	renameSync(tmpPath, path);
}

/**
 * Read a V2 lane snapshot from disk.
 * Returns null if the file doesn't exist or is unreadable.
 * @since TP-115
 */
export function readLaneSnapshot(
	stateRoot: string,
	batchId: string,
	laneNumber: number,
): { status: string; updatedAt?: number } | null {
	try {
		const p = runtimeLaneSnapshotPath(stateRoot, batchId, laneNumber);
		if (!existsSync(p)) return null;
		return JSON.parse(readFileSync(p, "utf-8"));
	} catch {
		return null;
	}
}
