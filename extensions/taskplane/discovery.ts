/**
 * Task discovery, PROMPT.md parsing, dependency resolution
 * @module orch/discovery
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, basename, resolve } from "path";

import { FATAL_DISCOVERY_CODES } from "./types.ts";
import type { DiscoveryError, DiscoveryResult, ParsedTask, TaskArea, WorkspaceConfig } from "./types.ts";

// ── PROMPT.md Parsing ────────────────────────────────────────────────

/**
 * Extract the task ID from a folder name.
 * Convention: "TO-014-accrual-engine" → "TO-014"
 * Matches prefix-number patterns like "COMP-006", "TS-004", "TO-014".
 */
export function extractTaskIdFromFolderName(folderName: string): string | null {
	const match = folderName.match(/^([A-Z]+-\d+)/);
	return match ? match[1] : null;
}

export interface DependencyRef {
	raw: string;
	taskId: string;
	areaName?: string;
}

export function parseDependencyReference(raw: string): DependencyRef {
	const trimmed = raw.trim();
	const qualified = trimmed.match(/^([a-z0-9-]+)\/([A-Z]+-\d+)$/i);
	if (qualified) {
		return {
			raw: trimmed,
			areaName: qualified[1].toLowerCase(),
			taskId: qualified[2].toUpperCase(),
		};
	}

	const idOnly = trimmed.match(/^([A-Z]+-\d+)$/i);
	if (idOnly) {
		return {
			raw: trimmed,
			taskId: idOnly[1].toUpperCase(),
		};
	}

	return {
		raw: trimmed,
		taskId: trimmed.toUpperCase(),
	};
}

export function normalizeDependencyReference(raw: string): string {
	const parsed = parseDependencyReference(raw);
	return parsed.areaName ? `${parsed.areaName}/${parsed.taskId}` : parsed.taskId;
}

/**
 * Parse a PROMPT.md file and extract orchestrator-relevant metadata.
 *
 * Required fields (hard fail if missing):
 *   - Task ID: extracted from `# Task: XX-NNN - Name` heading OR from folder name
 *
 * Optional fields (defaults used if absent):
 *   - Dependencies: defaults to [] (no dependencies)
 *   - Review Level: defaults to 2
 *   - Size: defaults to "M"
 *   - File Scope: defaults to []
 *   - Task Name: defaults to folder name
 *
 * Dependency syntax accepted:
 *   - "**None**" or "None" → empty list
 *   - "**Requires:** COMP-005 ..." → ["COMP-005"]
 *   - "**Requires:** time-off/TO-014 ..." → ["time-off/TO-014"]
 *   - "- COMP-005 (description)" → ["COMP-005"]
 *   - "- **time-off/TO-014** — description" → ["time-off/TO-014"]
 *   - Multiple bullet points → multiple dependencies
 */
export function parsePromptForOrchestrator(
	promptPath: string,
	taskFolder: string,
	areaName: string,
): { task: ParsedTask | null; error: DiscoveryError | null } {
	const folderName = basename(taskFolder);
	let content: string;

	try {
		content = readFileSync(promptPath, "utf-8");
	} catch {
		return {
			task: null,
			error: {
				code: "PARSE_MALFORMED",
				message: `Cannot read PROMPT.md: ${promptPath}`,
				taskPath: promptPath,
			},
		};
	}

	// ── Extract task ID ──────────────────────────────────────────
	// Try from heading first: "# Task: COMP-006 - Pay Bands Implementation"
	let taskId: string | null = null;
	let taskName = folderName;

	const headingMatch = content.match(/^#\s+Task:\s+([A-Z]+-\d+)\s*[-—]\s*(.+)$/m);
	if (headingMatch) {
		taskId = headingMatch[1];
		taskName = headingMatch[2].trim();
	}

	// Fallback: extract from folder name
	if (!taskId) {
		taskId = extractTaskIdFromFolderName(folderName);
	}

	if (!taskId) {
		return {
			task: null,
			error: {
				code: "PARSE_MISSING_ID",
				message: `Cannot extract task ID from heading or folder name "${folderName}" in ${promptPath}`,
				taskPath: promptPath,
			},
		};
	}

	// ── Extract review level ─────────────────────────────────────
	// "## Review Level: 1 (Plan Only)" or "## Review Level: 2"
	let reviewLevel = 2;
	const reviewMatch = content.match(/^##\s+Review Level:\s*(\d+)/m);
	if (reviewMatch) {
		reviewLevel = parseInt(reviewMatch[1], 10);
	}

	// ── Extract size ─────────────────────────────────────────────
	// "**Size:** M" (usually near top, after Created date)
	let size = "M";
	const sizeMatch = content.match(/\*\*Size:\*\*\s*([SMLsml])/);
	if (sizeMatch) {
		size = sizeMatch[1].toUpperCase();
	}

	// ── Extract dependencies ─────────────────────────────────────
	const dependencies: string[] = [];
	const depSectionMatch = content.match(
		/^##\s+Dependencies\s*\n([\s\S]*?)(?=\n##\s|\n---|\n$)/m,
	);

	if (depSectionMatch) {
		const depBody = depSectionMatch[1].trim();

		// Check for "None" variants
		if (!/\*?\*?None\*?\*?/i.test(depBody) && depBody.length > 0) {
			// Pattern 1: "**Requires:** COMP-005 ..." or "**Requires:** time-off/TO-014 ..."
			const requiresMatches = depBody.matchAll(
				/\*?\*?Requires:?\*?\*?\s*((?:[a-z0-9-]+\/)?[A-Z]+-\d+)/gi,
			);
			for (const m of requiresMatches) {
				const dep = normalizeDependencyReference(m[1]);
				if (!dependencies.includes(dep)) dependencies.push(dep);
			}

			// Pattern 2: Bullet list "- COMP-005 ...", "- **time-off/TO-014** ..."
			const bulletMatches = depBody.matchAll(
				/^[\s-]*\*?\*?((?:[a-z0-9-]+\/)?[A-Z]+-\d+)\*?\*?/gim,
			);
			for (const m of bulletMatches) {
				const dep = normalizeDependencyReference(m[1]);
				if (!dependencies.includes(dep)) dependencies.push(dep);
			}

			// Pattern 3: Inline dependency references not caught above
			if (dependencies.length === 0) {
				const inlineMatches = depBody.matchAll(/\b((?:[a-z0-9-]+\/)?[A-Z]+-\d+)\b/gi);
				for (const m of inlineMatches) {
					const dep = parseDependencyReference(m[1]);
					if (dep.taskId === taskId) continue; // Don't add self-references
					const normalized = normalizeDependencyReference(m[1]);
					if (!dependencies.includes(normalized)) {
						dependencies.push(normalized);
					}
				}
			}
		}
	}

	// ── Extract execution target (repo ID) ──────────────────────
	// Repo ID validation: lowercase alphanumeric + hyphens, starting with alnum
	const REPO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

	let promptRepoId: string | undefined;

	// Priority 1: Section-based "## Execution Target" with "Repo: <id>" line
	// Capture everything from section header to the next heading or --- divider.
	// We avoid \n$ (which in multiline mode matches blank lines) by using a two-pass
	// approach: find the section start, then slice to the next section boundary.
	const execTargetHeaderIdx = content.search(/^##\s+Execution Target\s*$/m);
	let execTargetSectionBody: string | null = null;
	if (execTargetHeaderIdx !== -1) {
		const afterHeader = content.indexOf("\n", execTargetHeaderIdx);
		if (afterHeader !== -1) {
			const rest = content.slice(afterHeader + 1);
			const nextSectionMatch = rest.search(/^##\s|^---/m);
			execTargetSectionBody = nextSectionMatch !== -1
				? rest.slice(0, nextSectionMatch)
				: rest;
		}
	}
	if (execTargetSectionBody !== null) {
		// Match "Repo: api" or "**Repo:** api" or "Repo: api" with whitespace
		const repoLineMatch = execTargetSectionBody.match(
			/^\s*\*?\*?Repo:?\*?\*?\s+(\S+)/mi,
		);
		if (repoLineMatch) {
			const candidate = repoLineMatch[1].trim().toLowerCase();
			if (REPO_ID_PATTERN.test(candidate)) {
				promptRepoId = candidate;
			}
		}
	}

	// Priority 2 (fallback): Inline "**Repo:** <id>" anywhere in content
	if (!promptRepoId) {
		const inlineRepoMatch = content.match(
			/^\*\*Repo:\*\*\s+(\S+)/m,
		);
		if (inlineRepoMatch) {
			const candidate = inlineRepoMatch[1].trim().toLowerCase();
			if (REPO_ID_PATTERN.test(candidate)) {
				promptRepoId = candidate;
			}
		}
	}

	// ── Extract file scope ───────────────────────────────────────
	const fileScope: string[] = [];
	const fileScopeMatch = content.match(
		/^##\s+File Scope\s*\n([\s\S]*?)(?=\n##\s|\n---|\n$)/m,
	);

	if (fileScopeMatch) {
		const scopeBody = fileScopeMatch[1].trim();
		const scopeLines = scopeBody.split("\n");
		for (const line of scopeLines) {
			// "- extensions/task-orchestrator.ts" or "- .pi/task-orchestrator.yaml"
			const trimmed = line.replace(/^[\s-*]+/, "").trim();
			if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("```")) {
				fileScope.push(trimmed);
			}
		}
	}

	return {
		task: {
			taskId,
			taskName,
			reviewLevel,
			size,
			dependencies,
			fileScope,
			taskFolder: resolve(taskFolder),
			promptPath: resolve(promptPath),
			areaName,
			status: "pending",
			...(promptRepoId ? { promptRepoId } : {}),
		},
		error: null,
	};
}


// ── Area Scanning ────────────────────────────────────────────────────

/**
 * Scan an area path for pending tasks.
 *
 * Lists immediate subdirectories only (no recursion).
 * Skips "archive" directories and folders with .DONE files.
 * Parses PROMPT.md in each remaining subdirectory.
 */
export function scanAreaForTasks(
	areaPath: string,
	areaName: string,
): { tasks: ParsedTask[]; errors: DiscoveryError[] } {
	const tasks: ParsedTask[] = [];
	const errors: DiscoveryError[] = [];

	const resolvedPath = resolve(areaPath);
	if (!existsSync(resolvedPath)) {
		errors.push({
			code: "SCAN_ERROR",
			message: `Area path does not exist: ${resolvedPath}`,
			taskPath: resolvedPath,
		});
		return { tasks, errors };
	}

	let entries: string[];
	try {
		entries = readdirSync(resolvedPath);
	} catch {
		errors.push({
			code: "SCAN_ERROR",
			message: `Cannot read area directory: ${resolvedPath}`,
			taskPath: resolvedPath,
		});
		return { tasks, errors };
	}

	for (const entry of entries) {
		// Skip archive directory
		if (entry.toLowerCase() === "archive") continue;

		const entryPath = join(resolvedPath, entry);

		// Only process directories
		try {
			if (!statSync(entryPath).isDirectory()) continue;
		} catch {
			continue;
		}

		// Skip if .DONE exists (already complete)
		if (existsSync(join(entryPath, ".DONE"))) continue;

		// Skip if no PROMPT.md
		const promptPath = join(entryPath, "PROMPT.md");
		if (!existsSync(promptPath)) continue;

		// Parse PROMPT.md
		const result = parsePromptForOrchestrator(promptPath, entryPath, areaName);
		if (result.error) {
			errors.push(result.error);
		}
		if (result.task) {
			tasks.push(result.task);
		}
	}

	return { tasks, errors };
}


// ── Completed Task Set ───────────────────────────────────────────────

/**
 * Build a set of completed task IDs by scanning:
 * 1. archive/ subdirectories for .DONE markers
 * 2. Active task folders that have .DONE files (caught during scanAreaForTasks skip)
 *
 * This set is used only for dependency resolution — completed tasks are never re-executed.
 */
export function buildCompletedTaskSet(areaPaths: string[]): Set<string> {
	const completed = new Set<string>();

	for (const areaPath of areaPaths) {
		const resolvedPath = resolve(areaPath);
		if (!existsSync(resolvedPath)) continue;

		let entries: string[];
		try {
			entries = readdirSync(resolvedPath);
		} catch {
			continue;
		}

		for (const entry of entries) {
			const entryPath = join(resolvedPath, entry);

			try {
				if (!statSync(entryPath).isDirectory()) continue;
			} catch {
				continue;
			}

			if (entry.toLowerCase() === "archive") {
				// Scan archive subdirectories for completed tasks
				let archiveEntries: string[];
				try {
					archiveEntries = readdirSync(entryPath);
				} catch {
					continue;
				}
				for (const archiveEntry of archiveEntries) {
					const archiveFolderPath = join(entryPath, archiveEntry);
					try {
						if (!statSync(archiveFolderPath).isDirectory()) continue;
					} catch {
						continue;
					}
					// Only treat archive tasks as complete when .DONE marker exists
					if (!existsSync(join(archiveFolderPath, ".DONE"))) continue;
					const taskId = extractTaskIdFromFolderName(archiveEntry);
					if (taskId) {
						completed.add(taskId);
					}
				}
			} else {
				// Active folder with .DONE = completed
				if (existsSync(join(entryPath, ".DONE"))) {
					const taskId = extractTaskIdFromFolderName(entry);
					if (taskId) {
						completed.add(taskId);
					}
				}
			}
		}
	}

	return completed;
}


// ── Argument Resolution ──────────────────────────────────────────────

/**
 * Resolve command arguments into area scan paths and direct task folders.
 *
 * Accepts mixed arguments:
 *   - "all" → all areas from task_areas
 *   - area name → looked up in task_areas
 *   - directory path → used as-is
 *   - PROMPT.md path → single task (dirname used as task folder)
 */
export function resolveArguments(
	args: string,
	taskAreas: Record<string, TaskArea>,
	cwd: string,
): { areaScanPaths: string[]; directTaskFolders: string[]; errors: DiscoveryError[] } {
	const areaScanPaths: string[] = [];
	const directTaskFolders: string[] = [];
	const errors: DiscoveryError[] = [];

	const tokens = args.trim().split(/\s+/).filter(Boolean);

	for (const token of tokens) {
		if (token.toLowerCase() === "all") {
			// Expand to all areas
			for (const area of Object.values(taskAreas)) {
				const fullPath = resolve(cwd, area.path);
				if (!areaScanPaths.includes(fullPath)) {
					areaScanPaths.push(fullPath);
				}
			}
		} else if (taskAreas[token]) {
			// Known area name
			const fullPath = resolve(cwd, taskAreas[token].path);
			if (!areaScanPaths.includes(fullPath)) {
				areaScanPaths.push(fullPath);
			}
		} else if (
			token.endsWith("PROMPT.md") &&
			existsSync(resolve(cwd, token))
		) {
			// Single PROMPT.md file
			directTaskFolders.push(resolve(cwd, dirname(token)));
		} else if (existsSync(resolve(cwd, token))) {
			// Directory path
			const fullPath = resolve(cwd, token);
			try {
				if (statSync(fullPath).isDirectory()) {
					if (!areaScanPaths.includes(fullPath)) {
						areaScanPaths.push(fullPath);
					}
				} else {
					errors.push({
						code: "UNKNOWN_ARG",
						message: `Not a directory or PROMPT.md file: ${token}`,
					});
				}
			} catch {
				errors.push({
					code: "UNKNOWN_ARG",
					message: `Cannot stat path: ${token}`,
				});
			}
		} else {
			errors.push({
				code: "UNKNOWN_ARG",
				message: `Unknown area, path, or file: "${token}"`,
			});
		}
	}

	return { areaScanPaths, directTaskFolders, errors };
}

export interface DiscoveryOptions {
	refreshDependencies?: boolean;
	dependencySource?: "prompt" | "agent";
	useDependencyCache?: boolean;
	/** Workspace config for repo routing (null/undefined = repo mode, no routing). */
	workspaceConfig?: WorkspaceConfig | null;
}

export interface DependencyCacheFile {
	version: number;
	generatedAt: string;
	source: string;
	tasks: Record<string, string[]>;
}

export function normalizePathForCompare(p: string): string {
	return resolve(p).replace(/\\/g, "/").toLowerCase();
}

export function isPathWithin(childPath: string, parentPath: string): boolean {
	const child = normalizePathForCompare(childPath);
	const parent = normalizePathForCompare(parentPath);
	return child === parent || child.startsWith(`${parent}/`);
}

export function dedupeAndNormalizeDeps(deps: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const dep of deps) {
		const norm = normalizeDependencyReference(dep);
		if (!norm || seen.has(norm)) continue;
		seen.add(norm);
		out.push(norm);
	}
	return out;
}

export function loadAreaDependencyCache(areaPath: string): DependencyCacheFile | null {
	const cachePath = join(areaPath, "dependencies.json");
	if (!existsSync(cachePath)) return null;
	try {
		const raw = readFileSync(cachePath, "utf-8");
		const parsed = JSON.parse(raw) as DependencyCacheFile;
		if (!parsed || typeof parsed !== "object" || !parsed.tasks) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function writeAreaDependencyCache(
	areaPath: string,
	pending: Map<string, ParsedTask>,
	source: "prompt" | "agent",
): void {
	const tasks: Record<string, string[]> = {};
	for (const task of pending.values()) {
		if (!isPathWithin(task.taskFolder, areaPath)) continue;
		tasks[task.taskId] = dedupeAndNormalizeDeps(task.dependencies);
	}

	const cachePath = join(areaPath, "dependencies.json");
	const payload: DependencyCacheFile = {
		version: 1,
		generatedAt: new Date().toISOString(),
		source,
		tasks,
	};

	try {
		// Keep deterministic formatting for easy diffs
		const json = JSON.stringify(payload, null, 2);
		writeFileSync(cachePath, `${json}\n`, "utf-8");
	} catch {
		// Non-fatal: discovery should still succeed without cache persistence
	}
}

export function applyDependenciesFromCache(
	discovery: DiscoveryResult,
	areaScanPaths: string[],
): { applied: boolean } {
	let applied = false;
	for (const areaPath of areaScanPaths) {
		const cache = loadAreaDependencyCache(areaPath);
		if (!cache) continue;
		for (const task of discovery.pending.values()) {
			if (!isPathWithin(task.taskFolder, areaPath)) continue;
			const cachedDeps = cache.tasks[task.taskId];
			if (!cachedDeps) continue;
			task.dependencies = dedupeAndNormalizeDeps(cachedDeps);
			applied = true;
		}
	}
	return { applied };
}


// ── Task Registry ────────────────────────────────────────────────────

/**
 * Build the full task registry: pending tasks + completed set.
 *
 * Enforces global uniqueness of task IDs across all areas.
 * If duplicates are found, returns a fail-fast error listing all collision locations.
 */
export function buildTaskRegistry(
	areaScanPaths: string[],
	directTaskFolders: string[],
	taskAreas: Record<string, TaskArea>,
	cwd: string,
): DiscoveryResult {
	const pending = new Map<string, ParsedTask>();
	const errors: DiscoveryError[] = [];

	// Track all locations per task ID for duplicate detection
	const idLocations = new Map<string, string[]>();

	function trackId(taskId: string, location: string) {
		const existing = idLocations.get(taskId) || [];
		existing.push(location);
		idLocations.set(taskId, existing);
	}

	// Resolve area names for scan paths
	const areaNameByPath = new Map<string, string>();
	for (const [name, area] of Object.entries(taskAreas)) {
		areaNameByPath.set(resolve(cwd, area.path), name);
	}

	// 1. Scan area paths for pending tasks
	for (const areaPath of areaScanPaths) {
		const areaName = areaNameByPath.get(areaPath) || basename(areaPath);
		const result = scanAreaForTasks(areaPath, areaName);
		errors.push(...result.errors);

		for (const task of result.tasks) {
			trackId(task.taskId, task.promptPath);
			pending.set(task.taskId, task);
		}
	}

	// 2. Process direct task folders (single PROMPT.md files)
	for (const taskFolder of directTaskFolders) {
		const promptPath = join(taskFolder, "PROMPT.md");
		if (!existsSync(promptPath)) {
			errors.push({
				code: "SCAN_ERROR",
				message: `No PROMPT.md found in direct task folder: ${taskFolder}`,
				taskPath: taskFolder,
			});
			continue;
		}

		// Try to determine area name from path
		let areaName = "unknown";
		for (const [name, area] of Object.entries(taskAreas)) {
			const resolvedAreaPath = resolve(cwd, area.path);
			if (taskFolder.startsWith(resolvedAreaPath)) {
				areaName = name;
				break;
			}
		}

		// Skip if .DONE exists
		if (existsSync(join(taskFolder, ".DONE"))) continue;

		const result = parsePromptForOrchestrator(promptPath, taskFolder, areaName);
		if (result.error) {
			errors.push(result.error);
		}
		if (result.task) {
			trackId(result.task.taskId, result.task.promptPath);
			pending.set(result.task.taskId, result.task);
		}
	}

	// 3. Build completed task set from all scanned areas
	const completed = buildCompletedTaskSet(areaScanPaths);

	// Also scan all task_areas for completed tasks (needed for cross-area dep resolution)
	const allAreaPaths = Object.values(taskAreas).map((a) => resolve(cwd, a.path));
	const globalCompleted = buildCompletedTaskSet(allAreaPaths);
	for (const id of globalCompleted) {
		completed.add(id);
	}

	// 4. Check for duplicate task IDs (global uniqueness enforcement)
	for (const [taskId, locations] of idLocations) {
		if (locations.length > 1) {
			errors.push({
				code: "DUPLICATE_ID",
				message:
					`Duplicate task ID "${taskId}" found in ${locations.length} locations:\n` +
					locations.map((l) => `  - ${l}`).join("\n"),
				taskId,
			});
		}
	}

	return { pending, completed, errors };
}


// ── Cross-Area Dependency Resolution ─────────────────────────────────

/** Candidate match for a dependency reference found in task areas. */
export interface DependencyCandidate {
	areaName: string;
	path: string;
	status: "pending" | "complete";
}

export function findDependencyCandidates(
	depRef: DependencyRef,
	taskAreas: Record<string, TaskArea>,
	cwd: string,
): DependencyCandidate[] {
	const candidates: DependencyCandidate[] = [];
	const sortedAreas = Object.entries(taskAreas).sort((a, b) => a[0].localeCompare(b[0]));

	for (const [areaName, area] of sortedAreas) {
		if (depRef.areaName && depRef.areaName !== areaName.toLowerCase()) {
			continue;
		}

		const areaPath = resolve(cwd, area.path);
		if (!existsSync(areaPath)) continue;

		let entries: string[];
		try {
			entries = readdirSync(areaPath);
		} catch {
			continue;
		}

		// Active tasks (skip archive)
		for (const entry of entries) {
			if (entry.toLowerCase() === "archive") continue;
			const entryTaskId = extractTaskIdFromFolderName(entry);
			if (entryTaskId !== depRef.taskId) continue;

			const entryPath = join(areaPath, entry);
			try {
				if (!statSync(entryPath).isDirectory()) continue;
			} catch {
				continue;
			}

			candidates.push({
				areaName,
				path: entryPath,
				status: existsSync(join(entryPath, ".DONE")) ? "complete" : "pending",
			});
		}

		// Archived tasks (require .DONE marker)
		const archivePath = join(areaPath, "archive");
		if (!existsSync(archivePath)) continue;
		try {
			const archiveEntries = readdirSync(archivePath);
			for (const archiveEntry of archiveEntries) {
				const entryTaskId = extractTaskIdFromFolderName(archiveEntry);
				if (entryTaskId !== depRef.taskId) continue;

				const archiveTaskPath = join(archivePath, archiveEntry);
				candidates.push({
					areaName,
					path: archiveTaskPath,
					status: existsSync(join(archiveTaskPath, ".DONE")) ? "complete" : "pending",
				});
			}
		} catch {
			// Ignore archive read errors for discovery resilience
		}
	}

	return candidates;
}

/**
 * Resolve dependencies for all pending tasks.
 *
 * Supports both dependency formats:
 * - TASK-ID (unqualified)
 * - area-name/TASK-ID (area-qualified)
 */
export function resolveDependencies(
	discovery: DiscoveryResult,
	taskAreas: Record<string, TaskArea>,
	cwd: string,
): DiscoveryError[] {
	const errors: DiscoveryError[] = [];

	for (const [taskId, task] of discovery.pending) {
		for (const depRaw of task.dependencies) {
			const depRef = parseDependencyReference(depRaw);
			const depId = depRef.taskId;

			// Fast path for unqualified refs already in registry
			if (!depRef.areaName) {
				if (discovery.pending.has(depId)) continue;
				if (discovery.completed.has(depId)) continue;
			} else {
				const pendingTask = discovery.pending.get(depId);
				if (pendingTask && pendingTask.areaName.toLowerCase() === depRef.areaName) {
					continue;
				}
			}

			const candidates = findDependencyCandidates(depRef, taskAreas, cwd);

			if (candidates.length === 0) {
				errors.push({
					code: "DEP_UNRESOLVED",
					message: `${taskId} depends on ${depRaw} which does not exist in any task area`,
					taskId,
					taskPath: task.promptPath,
				});
				continue;
			}

			if (!depRef.areaName && candidates.length > 1) {
				const options = candidates
					.map((c) => `  - ${c.areaName}/${depId} [${c.status}] (${c.path})`)
					.join("\n");
				errors.push({
					code: "DEP_AMBIGUOUS",
					message:
						`${taskId} depends on ${depId}, but multiple tasks match across areas. ` +
						`Use an area-qualified dependency (area/${depId}).\n${options}`,
					taskId,
					taskPath: task.promptPath,
				});
				continue;
			}

			if (depRef.areaName && candidates.length > 1) {
				const options = candidates
					.map((c) => `  - ${c.areaName}/${depId} [${c.status}] (${c.path})`)
					.join("\n");
				errors.push({
					code: "DEP_AMBIGUOUS",
					message:
						`${taskId} depends on ${depRaw}, but multiple matching task folders were found. ` +
						`Resolve duplicate task IDs.\n${options}`,
					taskId,
					taskPath: task.promptPath,
				});
				continue;
			}

			const match = candidates[0];
			if (match.status === "complete") {
				discovery.completed.add(depId);
				continue;
			}

			errors.push({
				code: "DEP_PENDING",
				message:
					`${taskId} depends on ${depRaw} which is pending in "${match.areaName}". ` +
					`Include that area: /orch ${match.areaName}`,
				taskId,
				taskPath: task.promptPath,
			});
		}
	}

	return errors;
}


// ── Task-to-Repo Routing ─────────────────────────────────────────────

/** Repo ID validation: lowercase alphanumeric + hyphens, starting with alnum */
const ROUTING_REPO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Resolve the target repo for each discovered task using the routing
 * precedence chain:
 *
 *   1. `task.promptRepoId` — declared in PROMPT.md metadata
 *   2. `taskArea.repoId` — area-level config from task-runner.yaml
 *   3. `workspaceConfig.routing.defaultRepo` — workspace-level default
 *
 * Only applied in workspace mode (when `workspaceConfig` is provided).
 * In repo mode this function is never called.
 *
 * Returns an array of DiscoveryError for routing failures:
 *   - TASK_REPO_UNRESOLVED: no source provided a repo ID
 *   - TASK_REPO_UNKNOWN: resolved repo ID is not in workspace repos map
 */
export function resolveTaskRouting(
	discovery: DiscoveryResult,
	taskAreas: Record<string, TaskArea>,
	workspaceConfig: WorkspaceConfig,
): DiscoveryError[] {
	const errors: DiscoveryError[] = [];
	const validRepoIds = workspaceConfig.repos;

	for (const task of discovery.pending.values()) {
		// Precedence 1: prompt-declared repo
		let resolvedId = task.promptRepoId;
		let source = "prompt";

		// Precedence 2: area-level repo
		if (!resolvedId) {
			const area = taskAreas[task.areaName];
			if (area?.repoId) {
				const candidate = area.repoId.trim().toLowerCase();
				if (ROUTING_REPO_ID_PATTERN.test(candidate)) {
					resolvedId = candidate;
					source = "area";
				}
			}
		}

		// Precedence 3: workspace default repo
		if (!resolvedId) {
			resolvedId = workspaceConfig.routing.defaultRepo;
			source = "default";
		}

		// Validate resolution
		if (!resolvedId) {
			errors.push({
				code: "TASK_REPO_UNRESOLVED",
				message:
					`Task ${task.taskId} has no resolved repo. ` +
					`Add a Repo: field to the PROMPT, set repo_id on area "${task.areaName}", ` +
					`or set routing.default_repo in the workspace config.`,
				taskId: task.taskId,
				taskPath: task.promptPath,
			});
			continue;
		}

		if (!validRepoIds.has(resolvedId)) {
			errors.push({
				code: "TASK_REPO_UNKNOWN",
				message:
					`Task ${task.taskId} resolved to repo "${resolvedId}" (via ${source}), ` +
					`but no repo with that ID exists in the workspace config. ` +
					`Known repos: ${[...validRepoIds.keys()].join(", ")}`,
				taskId: task.taskId,
				taskPath: task.promptPath,
			});
			continue;
		}

		// Attach resolved repo to the task
		task.resolvedRepoId = resolvedId;
	}

	return errors;
}


// ── Discovery Pipeline (Public) ──────────────────────────────────────

/**
 * Run the full discovery pipeline:
 * 1. Resolve arguments to scan paths and direct task folders
 * 2. Build task registry (scan, parse, deduplicate)
 * 3. Resolve cross-area dependencies
 *
 * Returns a DiscoveryResult with pending tasks, completed set, and any errors.
 */
export function runDiscovery(
	args: string,
	taskAreas: Record<string, TaskArea>,
	cwd: string,
	options: DiscoveryOptions = {},
): DiscoveryResult {
	const dependencySource = options.dependencySource ?? "prompt";
	const useDependencyCache = options.useDependencyCache ?? false;
	const refreshDependencies = options.refreshDependencies ?? false;

	// Step 1: Resolve arguments
	const resolved = resolveArguments(args, taskAreas, cwd);
	if (resolved.errors.length > 0) {
		return {
			pending: new Map(),
			completed: new Set(),
			errors: resolved.errors,
		};
	}

	if (resolved.areaScanPaths.length === 0 && resolved.directTaskFolders.length === 0) {
		return {
			pending: new Map(),
			completed: new Set(),
			errors: [
				{
					code: "UNKNOWN_ARG",
					message: "No valid areas, paths, or PROMPT.md files found in arguments",
				},
			],
		};
	}

	// Step 2: Build task registry (prompt-parsed dependencies as baseline)
	const discovery = buildTaskRegistry(
		resolved.areaScanPaths,
		resolved.directTaskFolders,
		taskAreas,
		cwd,
	);

	// If we have duplicate ID errors, stop early (fail-fast)
	const duplicateErrors = discovery.errors.filter((e) => e.code === "DUPLICATE_ID");
	if (duplicateErrors.length > 0) {
		return discovery;
	}

	// Step 3: Dependency source + cache policy
	// TS-004 scaffold supports prompt parsing and cached dependency maps.
	// Agent-based analysis is deferred to later tasks; when selected, we
	// attempt cache first and fall back to prompt parsing if unavailable.
	let effectiveDependencySource: "prompt" | "agent" = dependencySource;
	if (useDependencyCache && !refreshDependencies) {
		const { applied } = applyDependenciesFromCache(discovery, resolved.areaScanPaths);
		if (dependencySource === "agent" && !applied) {
			effectiveDependencySource = "prompt";
			discovery.errors.push({
				code: "DEP_SOURCE_FALLBACK",
				message:
					"dependencies.source=agent requested, but no dependency cache was found for " +
					"the selected areas. Falling back to PROMPT.md dependencies.",
			});
		}
	} else if (dependencySource === "agent") {
		effectiveDependencySource = "prompt";
		discovery.errors.push({
			code: "DEP_SOURCE_FALLBACK",
			message:
				"dependencies.source=agent requested, but agent-based dependency analysis " +
				"is not implemented in TS-004 scaffold. Falling back to PROMPT.md dependencies.",
		});
	}

	// Step 4: Resolve cross-area dependencies using effective dependencies
	const depErrors = resolveDependencies(discovery, taskAreas, cwd);
	discovery.errors.push(...depErrors);

	// Step 5: Persist cache (if enabled) for next run / non-refresh runs
	if (useDependencyCache) {
		for (const areaPath of resolved.areaScanPaths) {
			writeAreaDependencyCache(areaPath, discovery.pending, effectiveDependencySource);
		}
	}

	// Step 6: Task-to-repo routing (workspace mode only)
	const workspaceConfig = options.workspaceConfig;
	if (workspaceConfig && workspaceConfig.mode === "workspace") {
		const routingErrors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);
		discovery.errors.push(...routingErrors);
	}

	return discovery;
}

/**
 * Format discovery results as a readable string for display.
 */
export function formatDiscoveryResults(result: DiscoveryResult): string {
	const lines: string[] = [];

	// Summary
	lines.push(`📋 Discovery Results`);
	lines.push(`   Pending tasks:   ${result.pending.size}`);
	lines.push(`   Completed tasks: ${result.completed.size}`);
	lines.push("");

	// List pending tasks grouped by area (deterministic: sorted by area name, then task ID)
	if (result.pending.size > 0) {
		const byArea = new Map<string, ParsedTask[]>();
		for (const task of result.pending.values()) {
			const existing = byArea.get(task.areaName) || [];
			existing.push(task);
			byArea.set(task.areaName, existing);
		}

		lines.push("Pending Tasks:");
		const sortedAreas = [...byArea.entries()].sort((a, b) =>
			a[0].localeCompare(b[0]),
		);
		for (const [area, tasks] of sortedAreas) {
			lines.push(`  ${area}:`);
			const sortedTasks = [...tasks].sort((a, b) =>
				a.taskId.localeCompare(b.taskId),
			);
			for (const task of sortedTasks) {
				const deps =
					task.dependencies.length > 0
						? ` → depends on: ${task.dependencies.join(", ")}`
						: "";
				const repo =
					task.resolvedRepoId
						? ` → repo: ${task.resolvedRepoId}`
						: "";
				lines.push(
					`    ${task.taskId} [${task.size}] ${task.taskName}${deps}${repo}`,
				);
			}
		}
		lines.push("");
	}

	// Show errors
	if (result.errors.length > 0) {
		const fatalCodes = new Set<string>(FATAL_DISCOVERY_CODES);
		const fatalErrors = result.errors.filter((e) => fatalCodes.has(e.code));
		const warnings = result.errors.filter((e) => !fatalCodes.has(e.code));

		if (fatalErrors.length > 0) {
			lines.push("❌ Errors:");
			for (const err of fatalErrors) {
				lines.push(`  [${err.code}] ${err.message}`);
			}
			lines.push("");
		}

		if (warnings.length > 0) {
			lines.push("⚠️  Warnings:");
			for (const err of warnings) {
				lines.push(`  [${err.code}] ${err.message}`);
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

