/**
 * Config loading — thin wrappers over the unified loader.
 *
 * These functions preserve the existing snake_case return shapes
 * (`OrchestratorConfig`, `TaskRunnerConfig` from types.ts) so all
 * downstream consumers remain unchanged during the JSON migration.
 *
 * The unified loader (`loadProjectConfig`) handles JSON-first loading
 * with YAML fallback and defaults merging.
 *
 * @module orch/config
 */

import { loadProjectConfig, toOrchestratorConfig, toTaskRunnerConfig } from "./config-loader.ts";
import type { OrchestratorConfig, TaskRunnerConfig } from "./types.ts";

// ── Config Loading ───────────────────────────────────────────────────

/**
 * Load orchestrator config.
 *
 * Reads `.pi/taskplane-config.json` first; falls back to
 * `.pi/task-orchestrator.yaml` + `.pi/task-runner.yaml`; then defaults.
 *
 * In workspace mode, `pointerConfigRoot` (from the resolved pointer file)
 * is inserted into the config resolution chain between cwd-local and
 * TASKPLANE_WORKSPACE_ROOT. See `resolveConfigRoot()` in config-loader.ts.
 *
 * Returns the legacy `OrchestratorConfig` (snake_case) shape.
 */
export function loadOrchestratorConfig(cwd: string, pointerConfigRoot?: string): OrchestratorConfig {
	const unified = loadProjectConfig(cwd, pointerConfigRoot);
	return toOrchestratorConfig(unified);
}

/**
 * Load task-runner config (orchestrator subset: task_areas + reference_docs).
 *
 * Reads `.pi/taskplane-config.json` first; falls back to
 * `.pi/task-runner.yaml`; then defaults.
 *
 * In workspace mode, `pointerConfigRoot` (from the resolved pointer file)
 * is inserted into the config resolution chain between cwd-local and
 * TASKPLANE_WORKSPACE_ROOT. See `resolveConfigRoot()` in config-loader.ts.
 *
 * Returns the legacy `TaskRunnerConfig` (snake_case) shape.
 */
export function loadTaskRunnerConfig(cwd: string, pointerConfigRoot?: string): TaskRunnerConfig {
	const unified = loadProjectConfig(cwd, pointerConfigRoot);
	return toTaskRunnerConfig(unified);
}
