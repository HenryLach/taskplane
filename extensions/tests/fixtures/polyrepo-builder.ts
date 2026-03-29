/**
 * Polyrepo Fixture Builder — TP-012 Step 0
 *
 * Provides a runtime-generated polyrepo workspace fixture for integration
 * and regression tests. The fixture creates a temporary filesystem topology
 * that mirrors a real polyrepo workspace:
 *
 * ## Fixture Topology
 *
 * ```
 * <tmpdir>/polyrepo-fixture-<ts>/          <- workspace root (NOT a git repo)
 * +-- .pi/
 * |   +-- taskplane-workspace.yaml         <- workspace config
 * |   +-- task-runner.yaml                 <- task runner config with areas
 * +-- tasks/                               <- shared task root (in docs repo)
 * |   +-- api-tasks/
 * |   |   +-- AP-001-api-auth-module/      <- task in api repo
 * |   |   |   +-- PROMPT.md
 * |   |   +-- AP-002-api-user-endpoints/   <- task in api repo, depends on AP-001
 * |   |       +-- PROMPT.md
 * |   +-- ui-tasks/
 * |   |   +-- UI-001-ui-shell-layout/      <- task in frontend repo
 * |   |   |   +-- PROMPT.md
 * |   |   +-- UI-002-ui-dashboard-view/    <- task in frontend repo, depends on UI-001 + AP-001
 * |   |       +-- PROMPT.md
 * |   +-- shared-tasks/
 * |       +-- SH-001-shared-types-foundation/ <- task in docs repo (default), no deps
 * |       |   +-- PROMPT.md
 * |       +-- SH-002-shared-documentation-update/ <- task in docs repo, depends on AP-002 + UI-002
 * |           +-- PROMPT.md
 * +-- repos/
 *     +-- docs/                            <- docs repo (git, default repo, task root)
 *     |   +-- .git/
 *     +-- api/                             <- api repo (git)
 *     |   +-- .git/
 *     +-- frontend/                        <- frontend repo (git)
 *         +-- .git/
 * ```
 *
 * ## Task Packet Matrix
 *
 * | Task ID | Repo      | Area         | Dependencies                | Wave |
 * |---------|-----------|--------------|-----------------------------| -----|
 * | SH-001  | docs      | shared-tasks | (none)                      | 1    |
 * | AP-001  | api       | api-tasks    | (none)                      | 1    |
 * | UI-001  | frontend  | ui-tasks     | (none)                      | 1    |
 * | AP-002  | api       | api-tasks    | AP-001                      | 2    |
 * | UI-002  | frontend  | ui-tasks     | UI-001, AP-001 (cross-repo) | 2    |
 * | SH-002  | docs      | shared-tasks | AP-002, UI-002 (cross-repo) | 3    |
 *
 * ## Wave Shape
 *
 * Wave 1: [SH-001, AP-001, UI-001]  - all independent
 * Wave 2: [AP-002, UI-002]          - depends on wave 1 tasks
 * Wave 3: [SH-002]                  - depends on wave 2 tasks (cross-repo)
 *
 * ## Construction Strategy
 *
 * Runtime-generated in temp directories (like workspace-config.test.ts and
 * worktree-lifecycle.test.ts). Each call to buildPolyrepoFixture() creates
 * a fresh, isolated fixture. Callers must call cleanup() when done.
 *
 * ## Design Decisions
 *
 * - Runtime-generated (not static) because workspace-config validation
 *   requires real git repos on disk (.git/ must exist).
 * - Workspace root is intentionally NOT a git repo to exercise the
 *   workspace-mode invariant that the coordination root is non-git.
 * - Task areas use repo_id to exercise area-level routing fallback.
 * - Cross-repo dependencies exercise the global dependency graph.
 * - 3-wave shape exercises multi-wave progression with blocking.
 */

import { mkdirSync, writeFileSync, rmSync, realpathSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { tmpdir } from "os";

import { loadWorkspaceConfig } from "../../taskplane/workspace.ts";
import type {
	WorkspaceConfig,
	WorkspaceRepoConfig,
	TaskArea,
	ParsedTask,
	DiscoveryResult,
} from "../../taskplane/types.ts";

// -- Types ------------------------------------------------------------

/** Complete polyrepo fixture with all paths and config objects */
export interface PolyrepoFixture {
	/** Absolute path to the workspace root (non-git) */
	workspaceRoot: string;
	/** Absolute paths to repo roots, keyed by repo ID */
	repoPaths: Record<string, string>;
	/** Absolute path to the shared tasks root directory */
	tasksRoot: string;
	/** Absolute paths to task area directories, keyed by area name */
	areaPaths: Record<string, string>;
	/** Absolute paths to individual task folders, keyed by task ID */
	taskFolders: Record<string, string>;
	/** Workspace config object (ready for use with discovery/routing) */
	workspaceConfig: WorkspaceConfig;
	/** Task areas config (ready for use with discovery/routing) */
	taskAreas: Record<string, TaskArea>;
	/** Expected task-to-repo routing (task ID -> resolved repo ID) */
	expectedRouting: Record<string, string>;
	/** Expected wave shape (array of arrays of task IDs) */
	expectedWaves: string[][];
	/** Expected dependency edges (task ID -> list of dependency task IDs) */
	expectedDeps: Record<string, string[]>;
	/** Cleanup function - removes the entire fixture from disk */
	cleanup: () => void;
}

// -- Task Packet Content -----------------------------------------------

interface TaskPacket {
	taskId: string;
	taskName: string;
	size: string;
	areaName: string;
	repoId?: string;  // prompt-level repo declaration (optional)
	dependencies: string[];
	fileScope: string[];
}

/** The canonical set of task packets for the polyrepo fixture */
const TASK_PACKETS: TaskPacket[] = [
	{
		taskId: "SH-001",
		taskName: "Shared Types Foundation",
		size: "S",
		areaName: "shared-tasks",
		// No prompt-level repo - uses area repo_id fallback (docs)
		dependencies: [],
		fileScope: ["shared/types.ts"],
	},
	{
		taskId: "AP-001",
		taskName: "API Auth Module",
		size: "M",
		areaName: "api-tasks",
		// No prompt-level repo - uses area repo_id fallback (api)
		dependencies: [],
		fileScope: ["src/auth/handler.ts", "src/auth/middleware.ts"],
	},
	{
		taskId: "UI-001",
		taskName: "UI Shell Layout",
		size: "M",
		areaName: "ui-tasks",
		repoId: "frontend",  // explicit prompt-level repo
		dependencies: [],
		fileScope: ["src/components/Shell.tsx"],
	},
	{
		taskId: "AP-002",
		taskName: "API User Endpoints",
		size: "L",
		areaName: "api-tasks",
		dependencies: ["AP-001"],
		fileScope: ["src/users/handler.ts", "src/users/routes.ts"],
	},
	{
		taskId: "UI-002",
		taskName: "UI Dashboard View",
		size: "L",
		areaName: "ui-tasks",
		repoId: "frontend",
		dependencies: ["UI-001", "AP-001"],  // cross-repo: AP-001 is in api
		fileScope: ["src/views/Dashboard.tsx", "src/views/Dashboard.test.tsx"],
	},
	{
		taskId: "SH-002",
		taskName: "Shared Documentation Update",
		size: "M",
		areaName: "shared-tasks",
		dependencies: ["AP-002", "UI-002"],  // cross-repo: depends on both api and frontend
		fileScope: ["docs/api.md", "docs/ui.md"],
	},
];

// -- PROMPT.md Generation ----------------------------------------------

function generatePrompt(packet: TaskPacket): string {
	const depsSection = packet.dependencies.length > 0
		? packet.dependencies.map(d => `- **Requires:** ${d}`).join("\n")
		: "**None**";

	const repoSection = packet.repoId
		? `\n## Execution Target\n\nRepo: ${packet.repoId}\n`
		: "";

	const fileScopeSection = packet.fileScope.length > 0
		? `\n## File Scope\n\n${packet.fileScope.map(f => `- ${f}`).join("\n")}\n`
		: "";

	return `# Task: ${packet.taskId} - ${packet.taskName}

**Created:** 2026-03-16
**Size:** ${packet.size}

## Dependencies

${depsSection}
${repoSection}${fileScopeSection}
## Steps

### Step 0: Implement

- [ ] Implement the changes

---
`;
}

// -- Git Initialization ------------------------------------------------

function initGitRepo(dir: string, branch: string = "main"): void {
	mkdirSync(dir, { recursive: true });
	execFileSync("git", ["init", `--initial-branch=${branch}`], {
		cwd: dir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	execFileSync("git", ["config", "user.name", "test"], {
		cwd: dir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	execFileSync("git", ["config", "user.email", "test@test.local"], {
		cwd: dir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
		cwd: dir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
}

// -- Workspace Config Generation ---------------------------------------

function generateWorkspaceYaml(fixture: {
	tasksRoot: string;
	repoPaths: Record<string, string>;
}): string {
	const repoEntries = Object.entries(fixture.repoPaths)
		.map(([id, path]) => `  ${id}:\n    path: "${path.replace(/\\/g, "/")}"`)
		.join("\n");

	return `# Polyrepo workspace config (TP-012 fixture)
repos:
${repoEntries}

routing:
  tasks_root: "${fixture.tasksRoot.replace(/\\/g, "/")}"
  default_repo: docs
  task_packet_repo: docs
`;
}

function generateTaskRunnerYaml(areaPaths: Record<string, string>, areaRepoIds: Record<string, string>): string {
	const entries = Object.entries(areaPaths)
		.map(([name, path]) => {
			const prefix = name === "api-tasks" ? "AP" : name === "ui-tasks" ? "UI" : "SH";
			const repoLine = areaRepoIds[name] ? `\n    repo_id: ${areaRepoIds[name]}` : "";
			return `  ${name}:\n    path: "${path.replace(/\\/g, "/")}"\n    prefix: ${prefix}\n    context: "${name} area"${repoLine}`;
		})
		.join("\n");

	return `task_areas:
${entries}
`;
}

// -- Builder -----------------------------------------------------------

/**
 * Build a complete polyrepo workspace fixture on disk.
 *
 * Creates a temporary directory with the canonical polyrepo topology,
 * including:
 * - Non-git workspace root
 * - 3 git-initialized repos (docs, api, frontend)
 * - Shared task root with 3 task areas
 * - 6 task packets with cross-repo dependencies
 * - Valid workspace config and task runner config
 *
 * Returns a PolyrepoFixture with all paths, configs, and expected outputs.
 * Call fixture.cleanup() when done.
 */
export function buildPolyrepoFixture(): PolyrepoFixture {
	const workspaceRoot = join(tmpdir(), `polyrepo-fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(workspaceRoot, { recursive: true });

	// -- Create repo directories and init git --------------------------
	const repoPaths: Record<string, string> = {
		docs: join(workspaceRoot, "repos", "docs"),
		api: join(workspaceRoot, "repos", "api"),
		frontend: join(workspaceRoot, "repos", "frontend"),
	};

	for (const repoPath of Object.values(repoPaths)) {
		initGitRepo(repoPath);
	}

	// -- Create shared tasks root and area directories -----------------
	// Packet-home contract: tasksRoot must be inside the packet repo (docs).
	const tasksRoot = join(repoPaths.docs, "tasks");
	const areaPaths: Record<string, string> = {
		"api-tasks": join(tasksRoot, "api-tasks"),
		"ui-tasks": join(tasksRoot, "ui-tasks"),
		"shared-tasks": join(tasksRoot, "shared-tasks"),
	};

	for (const areaPath of Object.values(areaPaths)) {
		mkdirSync(areaPath, { recursive: true });
	}

	// -- Create task packet folders and PROMPT.md files -----------------
	const taskFolders: Record<string, string> = {};

	for (const packet of TASK_PACKETS) {
		const areaPath = areaPaths[packet.areaName];
		const folderName = `${packet.taskId}-${packet.taskName.toLowerCase().replace(/\s+/g, "-")}`;
		const taskFolder = join(areaPath, folderName);
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "PROMPT.md"), generatePrompt(packet), "utf-8");
		taskFolders[packet.taskId] = taskFolder;
	}

	// -- Area-to-repo routing configuration ----------------------------
	const areaRepoIds: Record<string, string> = {
		"api-tasks": "api",
		"ui-tasks": "frontend",
		"shared-tasks": "docs",
	};

	// -- Write workspace config ----------------------------------------
	const piDir = join(workspaceRoot, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(
		join(piDir, "taskplane-workspace.yaml"),
		generateWorkspaceYaml({ tasksRoot, repoPaths }),
		"utf-8",
	);
	writeFileSync(
		join(piDir, "task-runner.yaml"),
		generateTaskRunnerYaml(areaPaths, areaRepoIds),
		"utf-8",
	);

	// -- Load WorkspaceConfig via the real loader ----------------------
	// This ensures repo paths are resolved through realpathSync.native,
	// matching the canonical path normalization used in production.
	const workspaceConfig = loadWorkspaceConfig(workspaceRoot);
	if (!workspaceConfig) {
		throw new Error("buildPolyrepoFixture: loadWorkspaceConfig returned null — workspace config missing or broken");
	}

	// Update repoPaths to match the canonicalized paths from the config loader.
	// On Windows, realpathSync.native may resolve 8.3 short names differently.
	for (const [id, repoCfg] of workspaceConfig.repos) {
		repoPaths[id] = repoCfg.path;
	}
	// Also update tasksRoot and areaPaths to match the loader's resolution
	const resolvedTasksRoot = workspaceConfig.routing.tasksRoot;
	for (const [name, _oldPath] of Object.entries(areaPaths)) {
		areaPaths[name] = join(resolvedTasksRoot, name);
	}

	// -- Rebuild task folder paths with resolved area paths -------------
	for (const packet of TASK_PACKETS) {
		const areaPath = areaPaths[packet.areaName];
		const folderName = `${packet.taskId}-${packet.taskName.toLowerCase().replace(/\s+/g, "-")}`;
		taskFolders[packet.taskId] = join(areaPath, folderName);
	}

	// -- Build TaskArea objects ----------------------------------------
	const taskAreas: Record<string, TaskArea> = {};
	for (const [name, path] of Object.entries(areaPaths)) {
		const prefix = name === "api-tasks" ? "AP" : name === "ui-tasks" ? "UI" : "SH";
		taskAreas[name] = {
			path,
			prefix,
			context: `${name} area`,
			repoId: areaRepoIds[name],
		};
	}

	// -- Expected outputs ----------------------------------------------
	const expectedRouting: Record<string, string> = {
		"SH-001": "docs",      // area fallback
		"AP-001": "api",       // area fallback
		"UI-001": "frontend",  // prompt-level repo
		"AP-002": "api",       // area fallback
		"UI-002": "frontend",  // prompt-level repo
		"SH-002": "docs",      // area fallback
	};

	const expectedDeps: Record<string, string[]> = {
		"SH-001": [],
		"AP-001": [],
		"UI-001": [],
		"AP-002": ["AP-001"],
		"UI-002": ["UI-001", "AP-001"],
		"SH-002": ["AP-002", "UI-002"],
	};

	const expectedWaves: string[][] = [
		["AP-001", "SH-001", "UI-001"],  // sorted alphabetically
		["AP-002", "UI-002"],
		["SH-002"],
	];

	return {
		workspaceRoot,
		repoPaths,
		tasksRoot: resolvedTasksRoot,
		areaPaths,
		taskFolders,
		workspaceConfig,
		taskAreas,
		expectedRouting,
		expectedWaves,
		expectedDeps,
		cleanup: () => {
			try {
				rmSync(workspaceRoot, { recursive: true, force: true });
			} catch { /* best effort */ }
		},
	};
}

/**
 * Build ParsedTask objects from the fixture's task packets.
 *
 * Useful for tests that need ParsedTask maps without running full discovery.
 * Resolves repo IDs according to the fixture's expected routing.
 */
export function buildFixtureParsedTasks(fixture: PolyrepoFixture): Map<string, ParsedTask> {
	const tasks = new Map<string, ParsedTask>();

	for (const packet of TASK_PACKETS) {
		const task: ParsedTask = {
			taskId: packet.taskId,
			taskName: packet.taskName,
			reviewLevel: 1,
			size: packet.size,
			dependencies: [...packet.dependencies],
			fileScope: [...packet.fileScope],
			taskFolder: fixture.taskFolders[packet.taskId],
			promptPath: join(fixture.taskFolders[packet.taskId], "PROMPT.md"),
			areaName: packet.areaName,
			status: "pending",
			promptRepoId: packet.repoId,
			resolvedRepoId: fixture.expectedRouting[packet.taskId],
		};
		tasks.set(packet.taskId, task);
	}

	return tasks;
}

/**
 * Build a DiscoveryResult from the fixture's task packets.
 *
 * Useful for tests that need a complete DiscoveryResult without running
 * full discovery from disk.
 */
export function buildFixtureDiscovery(fixture: PolyrepoFixture): DiscoveryResult {
	return {
		pending: buildFixtureParsedTasks(fixture),
		completed: new Set<string>(),
		errors: [],
	};
}

/**
 * The canonical task IDs in the polyrepo fixture.
 */
export const FIXTURE_TASK_IDS = ["SH-001", "AP-001", "UI-001", "AP-002", "UI-002", "SH-002"] as const;

/**
 * The canonical repo IDs in the polyrepo fixture.
 */
export const FIXTURE_REPO_IDS = ["docs", "api", "frontend"] as const;
