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
 * Returns the legacy `OrchestratorConfig` (snake_case) shape.
 */
export function loadOrchestratorConfig(cwd: string): OrchestratorConfig {
	const unified = loadProjectConfig(cwd);
	return toOrchestratorConfig(unified);
}

/**
 * Load task-runner config (orchestrator subset: task_areas + reference_docs).
 *
 * Reads `.pi/taskplane-config.json` first; falls back to
 * `.pi/task-runner.yaml`; then defaults.
 *
 * Returns the legacy `TaskRunnerConfig` (snake_case) shape.
 */
export function loadTaskRunnerConfig(cwd: string): TaskRunnerConfig {
	const unified = loadProjectConfig(cwd);
	return toTaskRunnerConfig(unified);
}
