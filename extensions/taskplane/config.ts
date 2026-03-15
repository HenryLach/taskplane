/**
 * Config loading from YAML
 * @module orch/config
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as yamlParse } from "yaml";

import { DEFAULT_ORCHESTRATOR_CONFIG, DEFAULT_TASK_RUNNER_CONFIG } from "./types.ts";
import type { OrchestratorConfig, TaskArea, TaskRunnerConfig } from "./types.ts";

// ── Config Loading ───────────────────────────────────────────────────

/**
 * Load orchestrator config from .pi/task-orchestrator.yaml.
 * Merges with defaults for any missing fields.
 */
export function loadOrchestratorConfig(cwd: string): OrchestratorConfig {
	const configPath = join(cwd, ".pi", "task-orchestrator.yaml");
	if (!existsSync(configPath)) {
		return { ...DEFAULT_ORCHESTRATOR_CONFIG };
	}
	try {
		const raw = readFileSync(configPath, "utf-8");
		const loaded = yamlParse(raw) as any;
		return {
			orchestrator: {
				...DEFAULT_ORCHESTRATOR_CONFIG.orchestrator,
				...loaded?.orchestrator,
			},
			dependencies: {
				...DEFAULT_ORCHESTRATOR_CONFIG.dependencies,
				...loaded?.dependencies,
			},
			assignment: {
				...DEFAULT_ORCHESTRATOR_CONFIG.assignment,
				...loaded?.assignment,
				size_weights: {
					...DEFAULT_ORCHESTRATOR_CONFIG.assignment.size_weights,
					...loaded?.assignment?.size_weights,
				},
			},
			pre_warm: {
				...DEFAULT_ORCHESTRATOR_CONFIG.pre_warm,
				...loaded?.pre_warm,
				commands: {
					...DEFAULT_ORCHESTRATOR_CONFIG.pre_warm.commands,
					...loaded?.pre_warm?.commands,
				},
				always: loaded?.pre_warm?.always ?? DEFAULT_ORCHESTRATOR_CONFIG.pre_warm.always,
			},
			merge: {
				...DEFAULT_ORCHESTRATOR_CONFIG.merge,
				...loaded?.merge,
				verify: loaded?.merge?.verify ?? DEFAULT_ORCHESTRATOR_CONFIG.merge.verify,
			},
			failure: {
				...DEFAULT_ORCHESTRATOR_CONFIG.failure,
				...loaded?.failure,
			},
			monitoring: {
				...DEFAULT_ORCHESTRATOR_CONFIG.monitoring,
				...loaded?.monitoring,
			},
		};
	} catch {
		return { ...DEFAULT_ORCHESTRATOR_CONFIG };
	}
}

/**
 * Load task-runner config from .pi/task-runner.yaml.
 * Extracts only the fields the orchestrator needs: task_areas, reference_docs.
 */
export function loadTaskRunnerConfig(cwd: string): TaskRunnerConfig {
	const configPath = join(cwd, ".pi", "task-runner.yaml");
	if (!existsSync(configPath)) {
		return { ...DEFAULT_TASK_RUNNER_CONFIG };
	}
	try {
		const raw = readFileSync(configPath, "utf-8");
		const loaded = yamlParse(raw) as any;
		const taskAreas: Record<string, TaskArea> = {};
		if (loaded?.task_areas) {
			for (const [name, area] of Object.entries(loaded.task_areas)) {
				const a = area as any;
				const ta: TaskArea = {
					path: a?.path || "",
					prefix: a?.prefix || "",
					context: a?.context || "",
				};
				// Parse repo_id (snake_case YAML key) into repoId for routing
				if (a?.repo_id && typeof a.repo_id === "string" && a.repo_id.trim()) {
					ta.repoId = a.repo_id.trim();
				}
				taskAreas[name] = ta;
			}
		}
		return {
			task_areas: taskAreas,
			reference_docs: loaded?.reference_docs || {},
		};
	} catch {
		return { ...DEFAULT_TASK_RUNNER_CONFIG };
	}
}

