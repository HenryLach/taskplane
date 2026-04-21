import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { basename, dirname, relative, resolve } from "path";
import { stringify as yamlStringify, parse as yamlParse } from "yaml";

import { listConfiguredSubmodulePaths, listGitlinkPaths, listSubmoduleStatus, runGit } from "./git.ts";
import type { PreflightCheck, WorkspaceConfig, WorkspaceRepoConfig } from "./types.ts";

export type SubmoduleFailureMode = "permissive" | "strict";
export type SubmoduleDriftMode = "manual" | "init-only" | "recursive-on-drift";
export type SubmoduleRepoIdStrategy = "path-basename";

export interface SubmodulePolicy {
	failureMode: SubmoduleFailureMode;
	onSubmoduleDrift: SubmoduleDriftMode;
	repoIdStrategy: SubmoduleRepoIdStrategy;
}

export interface WorkspaceSyncFinding {
	name: string;
	kind:
		| "workspace-repo-id"
		| "missing-workspace-repo"
		| "invalid-derived-repo-id"
		| "repo-id-collision"
		| "uninitialized-submodule"
		| "drifted-submodule"
		| "conflicted-submodule";
	status: PreflightCheck["status"];
	repoLabel: string;
	repoRoot: string;
	submodulePath?: string;
	absolutePath?: string;
	derivedRepoId?: string;
	message: string;
	hint?: string;
}

export interface WorkspaceRepoImportCandidate {
	repoLabel: string;
	repoRoot: string;
	submodulePath: string;
	absolutePath: string;
	derivedRepoId: string;
}

export interface WorkspaceSyncSummary {
	trackedSubmodules: number;
	findings: WorkspaceSyncFinding[];
	importCandidates: WorkspaceRepoImportCandidate[];
}

export interface WorkspaceSyncApplyResult {
	importedRepoIds: string[];
	initializedPaths: string[];
	updatedPaths: string[];
	warnings: string[];
	changed: boolean;
}

export interface WorkspaceSyncBadgeStatus {
	state: "none" | "clean";
	trackedSubmodules: number;
	label: string;
	detail: string;
}

export const DEFAULT_SUBMODULE_POLICY: SubmodulePolicy = {
	failureMode: "permissive",
	onSubmoduleDrift: "manual",
	repoIdStrategy: "path-basename",
};

export const WORKSPACE_REPO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function normalizePath(pathValue: string): string {
	return resolve(pathValue).replace(/\\/g, "/");
}

function plannerSyncCommand(targetLabel = "<target>"): string {
	return `/orch-plan ${targetLabel} --sync`;
}

function findingStatus(policy: SubmodulePolicy): PreflightCheck["status"] {
	return policy.failureMode === "strict" ? "fail" : "warn";
}

function buildUninitializedHint(
	policy: SubmodulePolicy,
	repoPath: string,
	submodulePath: string,
	targetLabel?: string,
): string {
	const planner = plannerSyncCommand(targetLabel);
	const initCmd = `git -C "${repoPath}" submodule update --init -- "${submodulePath}"`;
	const recursiveCmd = `git -C "${repoPath}" submodule update --init --recursive -- "${submodulePath}"`;
	if (policy.onSubmoduleDrift === "manual") {
		return `Run ${planner} after setting On Submodule Drift to init-only or recursive-on-drift, or run ${initCmd}.`;
	}
	if (policy.onSubmoduleDrift === "init-only") {
		return `Run ${planner} to initialize it, or run ${initCmd}.`;
	}
	return `Run ${planner} to initialize it recursively, or run ${recursiveCmd}.`;
}

function buildDriftHint(
	policy: SubmodulePolicy,
	repoPath: string,
	submodulePath: string,
	targetLabel?: string,
): string {
	const planner = plannerSyncCommand(targetLabel);
	const updateCmd = `git -C "${repoPath}" submodule update --init --recursive -- "${submodulePath}"`;
	if (policy.onSubmoduleDrift === "manual") {
		return `Run ${planner} after setting On Submodule Drift to recursive-on-drift, or run ${updateCmd}.`;
	}
	if (policy.onSubmoduleDrift === "init-only") {
		return `Configured On Submodule Drift is init-only, which does not repair drift. Switch to recursive-on-drift and rerun ${planner}, or run ${updateCmd}.`;
	}
	return `Run ${planner} to realign the checkout, or run ${updateCmd}.`;
}

function relativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
	const rel = relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
	if (rel && rel !== "." && !rel.startsWith("../") && rel !== "..") {
		return rel;
	}
	return absolutePath.replace(/\\/g, "/");
}

function writeYamlFileAtomically(filePath: string, content: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.tmp`;
	writeFileSync(tmpPath, content, "utf-8");
	renameSync(tmpPath, filePath);
}

function groupPathsByRepo(findings: WorkspaceSyncFinding[], kinds: WorkspaceSyncFinding["kind"][]): Map<string, string[]> {
	const grouped = new Map<string, string[]>();
	const kindSet = new Set(kinds);
	for (const finding of findings) {
		if (!finding.submodulePath || !kindSet.has(finding.kind)) continue;
		const paths = grouped.get(finding.repoRoot) ?? [];
		paths.push(finding.submodulePath);
		grouped.set(finding.repoRoot, paths);
	}
	for (const [repoRoot, paths] of grouped) {
		grouped.set(repoRoot, [...new Set(paths)].sort((left, right) => left.localeCompare(right)));
	}
	return grouped;
}

export function collectWorkspaceSyncSummary(
	repoRoot: string | undefined,
	workspaceConfig: WorkspaceConfig | null | undefined,
	policy: SubmodulePolicy,
	targetLabel?: string,
): WorkspaceSyncSummary {
	const findings: WorkspaceSyncFinding[] = [];
	const repoEntries = new Map<string, { label: string; root: string }>();
	const workspaceRepoPaths = new Map<string, string>();
	const workspaceRepoIds = new Map<string, WorkspaceRepoConfig>();

	if (workspaceConfig) {
		for (const [repoId, repoConfig] of workspaceConfig.repos) {
			repoEntries.set(normalizePath(repoConfig.path), { label: repoId, root: repoConfig.path });
			workspaceRepoPaths.set(normalizePath(repoConfig.path), repoId);
			workspaceRepoIds.set(repoId, repoConfig);
			if (!WORKSPACE_REPO_ID_PATTERN.test(repoId)) {
				findings.push({
					name: `workspace-repo-id:${repoId}`,
					kind: "workspace-repo-id",
					status: findingStatus(policy),
					repoLabel: repoId,
					repoRoot: repoConfig.path,
					message: `Workspace repo ID '${repoId}' does not match the lowercase letters/digits/hyphen policy.`,
					hint: "Rename the repo ID to use lowercase letters, digits, and hyphens before relying on workspace routing.",
				});
			}
		}
	} else if (repoRoot) {
		repoEntries.set(normalizePath(repoRoot), { label: basename(repoRoot), root: repoRoot });
	}

	const collisionCandidates = new Map<string, WorkspaceRepoImportCandidate[]>();
	let trackedSubmodules = 0;

	for (const { label, root } of [...repoEntries.values()].sort((left, right) => left.label.localeCompare(right.label))) {
		const configuredPaths = listConfiguredSubmodulePaths(root);
		const gitlinkPaths = listGitlinkPaths(root);
		const statuses = listSubmoduleStatus(root);
		const statusByPath = new Map(statuses.map((entry) => [entry.path, entry]));
		const allPaths = [...new Set([...configuredPaths, ...gitlinkPaths, ...statuses.map((entry) => entry.path)])]
			.sort((left, right) => left.localeCompare(right));

		trackedSubmodules += allPaths.length;

		for (const submodulePath of allPaths) {
			const absolutePath = resolve(root, submodulePath);
			const mappedRepoId = workspaceRepoPaths.get(normalizePath(absolutePath));

			if (workspaceConfig && !mappedRepoId && policy.repoIdStrategy === "path-basename") {
				const derivedRepoId = basename(submodulePath).trim().toLowerCase();
				if (!WORKSPACE_REPO_ID_PATTERN.test(derivedRepoId)) {
					findings.push({
						name: `submodule-import:${label}:${submodulePath}`,
						kind: "invalid-derived-repo-id",
						status: findingStatus(policy),
						repoLabel: label,
						repoRoot: root,
						submodulePath,
						absolutePath,
						derivedRepoId,
						message: `${label}: submodule '${submodulePath}' is not declared in workspace.repos and basename import would derive invalid repo ID '${derivedRepoId}'.`,
						hint: `Rename the submodule path or add an explicit workspace.repos entry with a valid repo ID, then rerun ${plannerSyncCommand(targetLabel)}.`,
					});
				} else {
					const existingRepo = workspaceRepoIds.get(derivedRepoId);
					if (existingRepo && normalizePath(existingRepo.path) !== normalizePath(absolutePath)) {
						findings.push({
							name: `submodule-repo-id:${derivedRepoId}:${label}:${submodulePath}`,
							kind: "repo-id-collision",
							status: findingStatus(policy),
							repoLabel: label,
							repoRoot: root,
							submodulePath,
							absolutePath,
							derivedRepoId,
							message: `${label}: submodule '${submodulePath}' would reuse repo ID '${derivedRepoId}', which is already assigned to '${existingRepo.path}'.`,
							hint: `Add an explicit workspace.repos entry for '${submodulePath}' with a unique repo ID, then rerun ${plannerSyncCommand(targetLabel)}.`,
						});
					} else {
						const candidate: WorkspaceRepoImportCandidate = {
							repoLabel: label,
							repoRoot: root,
							submodulePath,
							absolutePath,
							derivedRepoId,
						};
						const candidates = collisionCandidates.get(derivedRepoId) ?? [];
						candidates.push(candidate);
						collisionCandidates.set(derivedRepoId, candidates);
						findings.push({
							name: `submodule-import:${label}:${submodulePath}`,
							kind: "missing-workspace-repo",
							status: findingStatus(policy),
							repoLabel: label,
							repoRoot: root,
							submodulePath,
							absolutePath,
							derivedRepoId,
							message: `${label}: submodule '${submodulePath}' is not declared in workspace.repos.`,
							hint: `Run ${plannerSyncCommand(targetLabel)} to add a workspace.repos entry for '${submodulePath}' (repo ID '${derivedRepoId}').`,
						});
					}
				}
			}

			const status = statusByPath.get(submodulePath);
			if (status?.state === "uninitialized") {
				findings.push({
					name: `submodule-state:${label}:${submodulePath}`,
					kind: "uninitialized-submodule",
					status: findingStatus(policy),
					repoLabel: label,
					repoRoot: root,
					submodulePath,
					absolutePath,
					message: `${label}: submodule '${submodulePath}' is not initialized.`,
					hint: buildUninitializedHint(policy, root, submodulePath, targetLabel),
				});
				continue;
			}

			if (status?.state === "drifted" || status?.state === "conflict") {
				findings.push({
					name: `submodule-state:${label}:${submodulePath}`,
					kind: status.state === "conflict" ? "conflicted-submodule" : "drifted-submodule",
					status: findingStatus(policy),
					repoLabel: label,
					repoRoot: root,
					submodulePath,
					absolutePath,
					message: `${label}: submodule '${submodulePath}' is ${status.state === "conflict" ? "in conflict" : "drifted from the recorded gitlink commit"}.`,
					hint: buildDriftHint(policy, root, submodulePath, targetLabel),
				});
			}
		}
	}

	const importCandidates: WorkspaceRepoImportCandidate[] = [];
	for (const [derivedRepoId, candidates] of [...collisionCandidates.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
		if (candidates.length === 1) {
			importCandidates.push(candidates[0]);
			continue;
		}
		findings.push({
			name: `submodule-repo-id:${derivedRepoId}`,
			kind: "repo-id-collision",
			status: findingStatus(policy),
			repoLabel: derivedRepoId,
			repoRoot: candidates[0]?.repoRoot ?? repoRoot ?? process.cwd(),
			derivedRepoId,
			message: `Multiple undeclared submodules would map to repo ID '${derivedRepoId}'.`,
			hint: `Add explicit workspace.repos entries for ${candidates.map((candidate) => `${candidate.repoLabel}:${candidate.submodulePath}`).join(", ")} instead of relying on path-basename imports, then rerun ${plannerSyncCommand(targetLabel)}.`,
		});
	}

	findings.sort((left, right) => left.name.localeCompare(right.name));
	importCandidates.sort((left, right) => left.derivedRepoId.localeCompare(right.derivedRepoId));

	return {
		trackedSubmodules,
		findings,
		importCandidates,
	};
}

export function workspaceSyncSummaryToChecks(summary: WorkspaceSyncSummary): PreflightCheck[] {
	if (summary.findings.length === 0) {
		return [{
			name: "submodules",
			status: "pass",
			message: summary.trackedSubmodules > 0
				? `No submodule issues detected (${summary.trackedSubmodules} tracked)`
				: "No submodules detected",
		}];
	}
	return summary.findings.map((finding) => ({
		name: finding.name,
		status: finding.status,
		message: finding.message,
		hint: finding.hint,
	}));
}

export function buildWorkspaceSyncBadgeStatus(summary: WorkspaceSyncSummary): WorkspaceSyncBadgeStatus {
	if (summary.trackedSubmodules === 0) {
		return {
			state: "none",
			trackedSubmodules: 0,
			label: "No submodules",
			detail: "No tracked submodules were detected when the batch started.",
		};
	}
	return {
		state: "clean",
		trackedSubmodules: summary.trackedSubmodules,
		label: `${summary.trackedSubmodules} synced`,
		detail: "Workspace repos and tracked submodules were synchronized before orchestration.",
	};
}

export function applyWorkspaceSync(
	workspaceRoot: string,
	_repoRoot: string,
	workspaceConfig: WorkspaceConfig | null | undefined,
	policy: SubmodulePolicy,
	summary: WorkspaceSyncSummary,
): WorkspaceSyncApplyResult {
	const result: WorkspaceSyncApplyResult = {
		importedRepoIds: [],
		initializedPaths: [],
		updatedPaths: [],
		warnings: [],
		changed: false,
	};

	if (summary.importCandidates.length > 0 && workspaceConfig?.configPath) {
		const parsed = yamlParse(readFileSync(workspaceConfig.configPath, "utf-8")) as Record<string, unknown> | null;
		const document = parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? { ...parsed }
			: {};
		const existingRepos = document.repos && typeof document.repos === "object" && !Array.isArray(document.repos)
			? { ...(document.repos as Record<string, unknown>) }
			: {};

		for (const candidate of summary.importCandidates) {
			if (existingRepos[candidate.derivedRepoId] !== undefined) continue;
			existingRepos[candidate.derivedRepoId] = {
				path: relativeWorkspacePath(workspaceRoot, candidate.absolutePath),
			};
			workspaceConfig.repos.set(candidate.derivedRepoId, {
				id: candidate.derivedRepoId,
				path: candidate.absolutePath,
			});
			result.importedRepoIds.push(candidate.derivedRepoId);
			result.changed = true;
		}

		if (result.importedRepoIds.length > 0) {
			const sortedRepos: Record<string, unknown> = {};
			for (const [repoId, repoValue] of Object.entries(existingRepos).sort((left, right) => left[0].localeCompare(right[0]))) {
				sortedRepos[repoId] = repoValue;
			}
			document.repos = sortedRepos;
			writeYamlFileAtomically(workspaceConfig.configPath, `${yamlStringify(document)}`.trimEnd() + "\n");
		}
	}

	const initGroups = groupPathsByRepo(summary.findings, ["uninitialized-submodule"]);
	const updateGroups = groupPathsByRepo(summary.findings, ["drifted-submodule", "conflicted-submodule"]);

	if (policy.onSubmoduleDrift === "init-only") {
		for (const [root, paths] of initGroups) {
			if (paths.length === 0) continue;
			const gitResult = runGit(["submodule", "update", "--init", "--", ...paths], root);
			if (!gitResult.ok) {
				result.warnings.push(`Failed to initialize submodules in '${root}': ${gitResult.stderr || gitResult.stdout || "git submodule update failed"}`);
				continue;
			}
			result.initializedPaths.push(...paths.map((pathValue) => `${basename(root)}:${pathValue}`));
			result.changed = true;
		}
	} else if (policy.onSubmoduleDrift === "recursive-on-drift") {
		const recursiveGroups = new Map<string, string[]>();
		for (const [root, paths] of initGroups) {
			recursiveGroups.set(root, [...paths]);
		}
		for (const [root, paths] of updateGroups) {
			const current = recursiveGroups.get(root) ?? [];
			recursiveGroups.set(root, [...current, ...paths]);
		}
		for (const [root, paths] of recursiveGroups) {
			const uniquePaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
			if (uniquePaths.length === 0) continue;
			const gitResult = runGit(["submodule", "update", "--init", "--recursive", "--", ...uniquePaths], root);
			if (!gitResult.ok) {
				result.warnings.push(`Failed to synchronize submodules in '${root}': ${gitResult.stderr || gitResult.stdout || "git submodule update failed"}`);
				continue;
			}
			const rootLabel = basename(root);
			for (const pathValue of uniquePaths) {
				const key = `${rootLabel}:${pathValue}`;
				if (initGroups.get(root)?.includes(pathValue)) {
					result.initializedPaths.push(key);
				}
				if (updateGroups.get(root)?.includes(pathValue)) {
					result.updatedPaths.push(key);
				}
			}
			result.changed = true;
		}
	} else if (initGroups.size > 0 || updateGroups.size > 0) {
		result.warnings.push("On Submodule Drift is manual, so planner sync did not run git submodule update commands.");
	}

	return result;
}
