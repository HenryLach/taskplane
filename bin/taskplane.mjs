#!/usr/bin/env node

/**
 * Taskplane CLI — Project scaffolding, diagnostics, uninstall, and dashboard launcher.
 *
 * This CLI handles what the pi package system cannot: project-local config
 * scaffolding, installation health checks, and dashboard management.
 *
 * Extensions, skills, and themes are delivered via `pi install npm:taskplane`
 * and auto-discovered by pi. This CLI is for everything else.
 */

// ─── Node.js version gate (fail fast) ───────────────────────────────────────

const MIN_NODE_MAJOR = 22;
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < MIN_NODE_MAJOR) {
	console.error(
		`\x1b[31m❌ Taskplane requires Node.js >= ${MIN_NODE_MAJOR}.0.0 (found ${process.versions.node}).\x1b[0m\n` +
		`   Upgrade: https://nodejs.org/\n`
	);
	process.exit(1);
}

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { execSync, execFileSync, spawn } from "node:child_process";
import {
	TASKPLANE_GITIGNORE_HEADER,
	TASKPLANE_GITIGNORE_NPM_HEADER,
	TASKPLANE_GITIGNORE_ENTRIES,
	TASKPLANE_GITIGNORE_NPM_ENTRIES,
	ALL_GITIGNORE_PATTERNS,
	patternToRegex,
} from "./gitignore-patterns.mjs";

// ─── Paths ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const TEMPLATES_DIR = path.join(PACKAGE_ROOT, "templates");
const DASHBOARD_SERVER = path.join(PACKAGE_ROOT, "dashboard", "server.cjs");

// ─── ANSI Colors ────────────────────────────────────────────────────────────

const c = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
};

const OK = `${c.green}✅${c.reset}`;
const WARN = `${c.yellow}⚠️${c.reset}`;
const FAIL = `${c.red}❌${c.reset}`;
const INFO = `${c.cyan}ℹ${c.reset}`;

// ─── Utilities ──────────────────────────────────────────────────────────────

function die(msg) {
	console.error(`${FAIL} ${msg}`);
	process.exit(1);
}

function today() {
	return new Date().toISOString().slice(0, 10);
}

function slugify(str) {
	return str
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/** Prompt the user for input. Returns the answer or defaultValue. */
function ask(question, defaultValue) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const suffix = defaultValue != null ? ` ${c.dim}(${defaultValue})${c.reset}` : "";
	return new Promise((resolve) => {
		rl.question(`  ${question}${suffix}: `, (answer) => {
			rl.close();
			resolve(answer.trim() || defaultValue || "");
		});
	});
}

/** Prompt yes/no. Returns boolean. */
async function confirm(question, defaultYes = true) {
	const hint = defaultYes ? "Y/n" : "y/N";
	const answer = await ask(`${question} [${hint}]`);
	if (!answer) return defaultYes;
	return answer.toLowerCase().startsWith("y");
}

/** Read a YAML file if it exists, return null otherwise. */
function readYaml(filePath) {
	try {
		// Dynamic import of yaml — it's a dependency of the package
		const raw = fs.readFileSync(filePath, "utf-8");
		// Simple YAML value extraction (avoids requiring yaml at top level for fast startup)
		return raw;
	} catch {
		return null;
	}
}

/** Check if a command exists on PATH. */
function commandExists(cmd) {
	try {
		const which = process.platform === "win32" ? "where" : "which";
		execSync(`${which} ${cmd}`, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

/** Get command version string. */
function getVersion(cmd, flag = "--version") {
	try {
		return execSync(`${cmd} ${flag}`, { stdio: "pipe" }).toString().trim();
	} catch {
		return null;
	}
}

/** Write a file, creating parent directories as needed. Optionally skip if exists. */
function writeFile(dest, content, { skipIfExists = false, label = "" } = {}) {
	if (skipIfExists && fs.existsSync(dest)) {
		if (label) console.log(`  ${c.dim}skip${c.reset}  ${label} (already exists)`);
		return false;
	}
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.writeFileSync(dest, content, "utf-8");
	if (label) console.log(`  ${c.green}create${c.reset} ${label}`);
	return true;
}

/** Copy a file from templates, creating parent dirs. */
function copyTemplate(src, dest, { skipIfExists = false, label = "" } = {}) {
	if (skipIfExists && fs.existsSync(dest)) {
		if (label) console.log(`  ${c.dim}skip${c.reset}  ${label} (already exists)`);
		return false;
	}
	const content = fs.readFileSync(src, "utf-8");
	return writeFile(dest, content, { label });
}

/** Replace {{variables}} in template content. */
function interpolate(content, vars) {
	return content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ─── Stack Detection ────────────────────────────────────────────────────────

function detectStack(projectRoot) {
	const checks = [
		{ file: "package.json", stack: "node", test: "npm test", build: "npm run build" },
		{ file: "go.mod", stack: "go", test: "go test ./...", build: "go build ./..." },
		{ file: "Cargo.toml", stack: "rust", test: "cargo test", build: "cargo build" },
		{ file: "pyproject.toml", stack: "python", test: "pytest", build: "" },
		{ file: "pom.xml", stack: "java-maven", test: "mvn test", build: "mvn package" },
		{ file: "build.gradle", stack: "java-gradle", test: "gradle test", build: "gradle build" },
	];
	for (const { file, stack, test, build } of checks) {
		if (fs.existsSync(path.join(projectRoot, file))) {
			return { stack, test, build };
		}
	}
	return { stack: "unknown", test: "", build: "" };
}

// ─── YAML Generation ────────────────────────────────────────────────────────

function generateTaskRunnerYaml(vars) {
	return `# ═══════════════════════════════════════════════════════════════════════
# Task Runner Configuration — ${vars.project_name}
# ═══════════════════════════════════════════════════════════════════════
#
# This file configures the /task command (task-runner extension).
# Edit freely — this file is owned by you, not the package.

# ── Task Areas ────────────────────────────────────────────────────────
# Define where tasks live. Each area has a folder path, ID prefix, and
# a CONTEXT.md file that provides domain context to agents.

task_areas:
  ${vars.default_area}:
    path: "${vars.tasks_root}"
    prefix: "${vars.default_prefix}"
    context: "${vars.tasks_root}/CONTEXT.md"

# ── Reference Docs ────────────────────────────────────────────────────
# Docs that tasks can reference in their "Context to Read First" section.
# Add your project's architecture docs, API specs, etc.

reference_docs: {}

# ── Standards ─────────────────────────────────────────────────────────
# Coding standards and rules. Agents follow these during implementation.

standards: {}

# ── Testing ───────────────────────────────────────────────────────────
# Commands that agents run to verify their work.

testing:
  commands:${vars.test_cmd ? `\n    unit: "${vars.test_cmd}"` : ""}${vars.build_cmd ? `\n    build: "${vars.build_cmd}"` : ""}
`;
}

function generateOrchestratorYaml(vars) {
	return `# ═══════════════════════════════════════════════════════════════════════
# Parallel Task Orchestrator Configuration — ${vars.project_name}
# ═══════════════════════════════════════════════════════════════════════
#
# This file configures the /orch commands (task-orchestrator extension).
# Edit freely — this file is owned by you, not the package.

orchestrator:
  max_lanes: ${vars.max_lanes}
  worktree_location: "subdirectory"
  worktree_prefix: "${vars.worktree_prefix}"
  batch_id_format: "timestamp"
  spawn_mode: "${vars.spawn_mode}"
  session_prefix: "${vars.session_prefix}"

dependencies:
  source: "prompt"
  cache: true

assignment:
  strategy: "affinity-first"
  size_weights:
    S: 1
    M: 2
    L: 4

pre_warm:
  auto_detect: false
  commands: {}
  always: []

merge:
  model: ""
  tools: "read,write,edit,bash,grep,find,ls"
  verify: []
  order: "fewest-files-first"

failure:
  on_task_failure: "skip-dependents"
  on_merge_failure: "pause"
  stall_timeout: 30
  max_worker_minutes: 30
  abort_grace_period: 60

monitoring:
  poll_interval: 5
`;
}

function buildTestingCommands(vars) {
	const commands = {};
	if (vars.test_cmd) commands.unit = vars.test_cmd;
	if (vars.build_cmd) commands.build = vars.build_cmd;
	return commands;
}

function generateProjectConfig(vars) {
	return {
		configVersion: 1,
		taskRunner: {
			project: { name: vars.project_name, description: "" },
			paths: { tasks: vars.tasks_root },
			testing: { commands: buildTestingCommands(vars) },
			standards: { docs: [], rules: [] },
			standardsOverrides: {},
			worker: { model: "", tools: "read,write,edit,bash,grep,find,ls", thinking: "off" },
			reviewer: { model: "openai/gpt-5.3-codex", tools: "read,bash,grep,find,ls", thinking: "on" },
			context: {
				workerContextWindow: 200000,
				warnPercent: 70,
				killPercent: 85,
				maxWorkerIterations: 20,
				maxReviewCycles: 2,
				noProgressLimit: 3,
			},
			taskAreas: {
				[vars.default_area]: {
					path: vars.tasks_root,
					prefix: vars.default_prefix,
					context: `${vars.tasks_root}/CONTEXT.md`,
				},
			},
			referenceDocs: {},
			neverLoad: [],
			selfDocTargets: {},
			protectedDocs: [],
		},
		orchestrator: {
			orchestrator: {
				maxLanes: vars.max_lanes,
				worktreeLocation: "subdirectory",
				worktreePrefix: vars.worktree_prefix,
				batchIdFormat: "timestamp",
				spawnMode: vars.spawn_mode,
				sessionPrefix: vars.session_prefix,
				operatorId: "",
			},
			dependencies: { source: "prompt", cache: true },
			assignment: { strategy: "affinity-first", sizeWeights: { S: 1, M: 2, L: 4 } },
			preWarm: { autoDetect: false, commands: {}, always: [] },
			merge: {
				model: "",
				tools: "read,write,edit,bash,grep,find,ls",
				verify: [],
				order: "fewest-files-first",
				timeoutMinutes: 10,
			},
			failure: {
				onTaskFailure: "skip-dependents",
				onMergeFailure: "pause",
				stallTimeout: 30,
				maxWorkerMinutes: 30,
				abortGracePeriod: 60,
			},
			monitoring: { pollInterval: 5 },
		},
	};
}

function generateWorkspaceYaml(repoNames, defaultRepo, tasksRoot) {
	const reposBlock = repoNames
		.map((name) => `  ${name}:\n    path: "${name}"`)
		.join("\n");
	return `repos:\n${reposBlock}\nrouting:\n  tasks_root: "${tasksRoot}"\n  default_repo: "${defaultRepo}"\n`;
}

function readWorkspaceJson(configRepoRoot) {
	const workspaceJsonPath = path.join(configRepoRoot, ".taskplane", "workspace.json");
	if (!fs.existsSync(workspaceJsonPath)) return null;
	try {
		return JSON.parse(fs.readFileSync(workspaceJsonPath, "utf-8"));
	} catch {
		return null;
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ═════════════════════════════════════════════════════════════════════════════

/** Auto-commit task files to git so they're available in orchestrator worktrees. */
async function autoCommitTaskFiles(projectRoot, tasksRoot) {
	// Check if we're in a git repo
	try {
		execSync("git rev-parse --is-inside-work-tree", { cwd: projectRoot, stdio: "pipe" });
	} catch {
		// Not a git repo — skip silently
		return;
	}

	// Stage the tasks directory (not .pi/ — that's gitignored)
	const tasksDir = path.join(projectRoot, tasksRoot);
	if (!fs.existsSync(tasksDir)) return;

	try {
		// Check if there's anything new to commit
		execSync(`git add "${tasksRoot}"`, { cwd: projectRoot, stdio: "pipe" });
		const status = execSync("git diff --cached --name-only", { cwd: projectRoot, stdio: "pipe" })
			.toString()
			.trim();

		if (!status) return; // nothing staged

		execSync('git commit -m "chore: initialize taskplane tasks"', {
			cwd: projectRoot,
			stdio: "pipe",
		});
		console.log(`\n  ${c.green}git${c.reset}    committed ${tasksRoot}/ to git`);
		console.log(`  ${c.dim}(orchestrator worktrees require committed files)${c.reset}`);
	} catch (err) {
		// Git commit failed — warn but don't block init
		console.log(`\n  ${WARN} Could not auto-commit task files to git.`);
		console.log(`  ${c.dim}Run manually before using /orch: git add ${tasksRoot} && git commit -m "add taskplane tasks"${c.reset}`);
	}
}

function discoverTaskAreaMetadata(projectRoot, configRoot = projectRoot, configPrefix = ".pi") {
	const runnerPath = path.join(configRoot, configPrefix, "task-runner.yaml");
	if (!fs.existsSync(runnerPath)) return { paths: [], contexts: [], areaRepoIds: {} };

	const raw = readYaml(runnerPath);
	if (!raw) return { paths: [], contexts: [], areaRepoIds: {} };

	const lines = raw.split(/\r?\n/);
	let inTaskAreas = false;
	let currentAreaName = null;
	const paths = new Set();
	const contexts = new Set();
	const areaRepoIds = {}; // area name → repo_id (only areas that declare one)

	for (const line of lines) {
		const trimmed = line.trim();

		if (!inTaskAreas) {
			if (/^task_areas:\s*$/.test(trimmed)) {
				inTaskAreas = true;
			}
			continue;
		}

		// End of task_areas block when we hit next top-level key
		if (/^[A-Za-z0-9_]+\s*:\s*$/.test(line)) {
			break;
		}

		// Area name line (2-space indent): "  taskplane-tasks:"
		const areaNameMatch = line.match(/^  ([A-Za-z0-9][A-Za-z0-9_-]*)\s*:\s*$/);
		if (areaNameMatch) {
			currentAreaName = areaNameMatch[1];
			continue;
		}

		const pathMatch = line.match(/^\s{4}path:\s*["']?([^"'\n#]+)["']?\s*(?:#.*)?$/);
		if (pathMatch?.[1]) {
			paths.add(pathMatch[1].trim());
		}

		const contextMatch = line.match(/^\s{4}context:\s*["']?([^"'\n#]+)["']?\s*(?:#.*)?$/);
		if (contextMatch?.[1]) {
			contexts.add(contextMatch[1].trim());
		}

		// Extract repo_id per area (workspace mode routing validation)
		// Only store when trimmed value is non-empty — aligns with orchestrator
		// config.ts behavior which ignores empty/whitespace repo_id values.
		const repoIdMatch = line.match(/^\s{4}repo_id:\s*["']?([^"'\n#]+)["']?\s*(?:#.*)?$/);
		const repoIdValue = repoIdMatch?.[1]?.trim();
		if (repoIdValue && currentAreaName) {
			areaRepoIds[currentAreaName] = repoIdValue;
		}
	}

	return { paths: [...paths], contexts: [...contexts], areaRepoIds };
}

function discoverTaskAreaPaths(projectRoot) {
	return discoverTaskAreaMetadata(projectRoot).paths;
}

function pruneEmptyDir(dirPath) {
	try {
		if (!fs.existsSync(dirPath)) return false;
		if (fs.readdirSync(dirPath).length !== 0) return false;
		fs.rmdirSync(dirPath);
		return true;
	} catch {
		return false;
	}
}

function listExampleTaskTemplates() {
	const tasksTemplatesDir = path.join(TEMPLATES_DIR, "tasks");
	try {
		return fs.readdirSync(tasksTemplatesDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && /^EXAMPLE-\d+/i.test(entry.name))
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

async function cmdUninstall(args) {
	const projectRoot = process.cwd();
	const dryRun = args.includes("--dry-run");
	const yes = args.includes("--yes") || args.includes("-y");
	const removePackage = args.includes("--package") || args.includes("--all") || args.includes("--package-only");
	const packageOnly = args.includes("--package-only");
	const removeProject = !packageOnly;
	const removeTasks = removeProject && (args.includes("--remove-tasks") || args.includes("--all"));
	const local = args.includes("--local");
	const global = args.includes("--global");

	if (local && global) {
		die("Choose either --local or --global, not both.");
	}

	console.log(`\n${c.bold}Taskplane Uninstall${c.reset}\n`);

	const managedFiles = [
		".pi/task-runner.yaml",
		".pi/task-orchestrator.yaml",
		".pi/taskplane.json",
		".pi/agents/task-worker.md",
		".pi/agents/task-reviewer.md",
		".pi/agents/task-merger.md",
		".pi/agents/supervisor.md",
		".pi/batch-state.json",
		".pi/batch-history.json",
		".pi/orch-abort-signal",
	];

	const sidecarPrefixes = [
		"lane-state-",
		"worker-conversation-",
		"merge-result-",
		"merge-request-",
	];

	const filesToDelete = managedFiles
		.map(rel => ({ rel, abs: path.join(projectRoot, rel) }))
		.filter(({ abs }) => fs.existsSync(abs));

	const piDir = path.join(projectRoot, ".pi");
	const sidecarsToDelete = fs.existsSync(piDir)
		? fs.readdirSync(piDir)
			.filter(name => sidecarPrefixes.some(prefix => name.startsWith(prefix)))
			.map(name => ({ rel: path.join(".pi", name), abs: path.join(piDir, name) }))
		: [];

	let taskDirsToDelete = [];
	if (removeTasks) {
		const areaPaths = discoverTaskAreaPaths(projectRoot);
		const rootPrefix = path.resolve(projectRoot) + path.sep;
		taskDirsToDelete = areaPaths
			.map(rel => ({ rel, abs: path.resolve(projectRoot, rel) }))
			.filter(({ abs }) => abs.startsWith(rootPrefix) && fs.existsSync(abs));
	}

	const inferredInstallType = /[\\/]\.pi[\\/]/.test(PACKAGE_ROOT) ? "local" : "global";
	const packageScope = local ? "local" : global ? "global" : inferredInstallType;
	const piRemoveCmd = packageScope === "local"
		? "pi remove -l npm:taskplane"
		: "pi remove npm:taskplane";

	if (!removeProject && !removePackage) {
		console.log(`  ${WARN} Nothing to do. Use one of:`);
		console.log(`    ${c.cyan}taskplane uninstall${c.reset}              # remove project-scaffolded files`);
		console.log(`    ${c.cyan}taskplane uninstall --package${c.reset}    # remove installed package via pi`);
		console.log();
		return;
	}

	if (removeProject) {
		console.log(`${c.bold}Project cleanup:${c.reset}`);
		if (filesToDelete.length === 0 && sidecarsToDelete.length === 0 && taskDirsToDelete.length === 0) {
			console.log(`  ${c.dim}No Taskplane-managed project files found.${c.reset}`);
		}
		for (const f of filesToDelete) console.log(`  - remove ${f.rel}`);
		for (const f of sidecarsToDelete) console.log(`  - remove ${f.rel}`);
		for (const d of taskDirsToDelete) console.log(`  - remove dir ${d.rel}`);
		if (removeTasks && taskDirsToDelete.length === 0) {
			console.log(`  ${c.dim}No task area directories found from .pi/task-runner.yaml.${c.reset}`);
		}
		if (!removeTasks) {
			console.log(`  ${c.dim}Task directories are preserved by default (use --remove-tasks to delete them).${c.reset}`);
		}
		console.log();
	}

	if (removePackage) {
		console.log(`${c.bold}Package cleanup:${c.reset}`);
		console.log(`  - run ${piRemoveCmd}`);
		console.log(`  ${c.dim}(removes extensions, skills, and dashboard files from this install scope)${c.reset}`);
		console.log();
	}

	if (dryRun) {
		console.log(`${INFO} Dry run complete. No files were changed.\n`);
		return;
	}

	if (!yes) {
		const proceed = await confirm("Proceed with uninstall?", false);
		if (!proceed) {
			console.log("  Aborted.");
			return;
		}
		if (removeTasks) {
			const taskConfirm = await confirm("This will delete task area directories recursively. Continue?", false);
			if (!taskConfirm) {
				console.log("  Aborted.");
				return;
			}
		}
	}

	let removedCount = 0;
	let failedCount = 0;

	if (removeProject) {
		for (const item of [...filesToDelete, ...sidecarsToDelete]) {
			try {
				fs.unlinkSync(item.abs);
				removedCount++;
			} catch (err) {
				failedCount++;
				console.log(`  ${WARN} Failed to remove ${item.rel}: ${err.message}`);
			}
		}

		for (const dir of taskDirsToDelete) {
			try {
				fs.rmSync(dir.abs, { recursive: true, force: true });
				removedCount++;
			} catch (err) {
				failedCount++;
				console.log(`  ${WARN} Failed to remove directory ${dir.rel}: ${err.message}`);
			}
		}

		// Best-effort cleanup of empty folders
		pruneEmptyDir(path.join(projectRoot, ".pi", "agents"));
		pruneEmptyDir(path.join(projectRoot, ".pi"));
	}

	if (removePackage) {
		if (!commandExists("pi")) {
			failedCount++;
			console.log(`  ${FAIL} pi is not on PATH; could not run: ${piRemoveCmd}`);
		} else {
			try {
				execSync(piRemoveCmd, { cwd: projectRoot, stdio: "inherit" });
			} catch {
				failedCount++;
				console.log(`  ${FAIL} Package uninstall failed: ${piRemoveCmd}`);
			}
		}
	}

	console.log();
	if (failedCount === 0) {
		console.log(`${OK} ${c.bold}Uninstall complete.${c.reset}`);
		if (removeProject) {
			console.log(`  Removed ${removedCount} project artifact(s).`);
		}
		console.log();
	} else {
		console.log(`${FAIL} Uninstall completed with ${failedCount} error(s).`);
		if (removeProject) {
			console.log(`  Removed ${removedCount} project artifact(s).`);
		}
		console.log();
		process.exit(1);
	}
}

// ─── Gitignore Enforcement ──────────────────────────────────────────────────

// Gitignore constants and patternToRegex imported from ./gitignore-patterns.mjs

/**
 * Ensure required Taskplane gitignore entries exist in the project's .gitignore.
 * Creates the file if it doesn't exist. Skips entries that already exist.
 * Returns { created: boolean, added: string[], skipped: string[] }.
 *
 * @param {string} projectRoot - Root directory containing (or to contain) .gitignore
 * @param {object} options
 * @param {boolean} options.dryRun - If true, don't modify files
 * @param {string} [options.prefix] - Optional prefix for entries (e.g., ".taskplane/" for workspace mode)
 */
function ensureGitignoreEntries(projectRoot, { dryRun = false, prefix = "" } = {}) {
	const gitignorePath = path.join(projectRoot, ".gitignore");
	const fileExists = fs.existsSync(gitignorePath);
	const existingContent = fileExists ? fs.readFileSync(gitignorePath, "utf-8") : "";
	const existingLines = new Set(existingContent.split(/\r?\n/).map(l => l.trim()));

	const allEntries = [...TASKPLANE_GITIGNORE_ENTRIES, ...TASKPLANE_GITIGNORE_NPM_ENTRIES];
	const added = [];
	const skipped = [];

	for (const entry of allEntries) {
		const prefixedEntry = prefix ? `${prefix}${entry}` : entry;
		if (existingLines.has(prefixedEntry)) {
			skipped.push(prefixedEntry);
		} else {
			added.push(prefixedEntry);
		}
	}

	if (added.length === 0) {
		return { created: false, added: [], skipped };
	}

	if (!dryRun) {
		// Build the block of new entries with headers
		const runtimeAdded = added.filter(e => !e.endsWith("npm/"));
		const npmAdded = added.filter(e => e.endsWith("npm/"));
		const newLines = [];

		if (runtimeAdded.length > 0) {
			// Only add header if it's not already present
			const headerToCheck = prefix
				? TASKPLANE_GITIGNORE_HEADER
				: TASKPLANE_GITIGNORE_HEADER;
			if (!existingLines.has(headerToCheck)) {
				newLines.push(TASKPLANE_GITIGNORE_HEADER);
			}
			newLines.push(...runtimeAdded);
		}

		if (npmAdded.length > 0) {
			if (!existingLines.has(TASKPLANE_GITIGNORE_NPM_HEADER)) {
				if (newLines.length > 0) newLines.push("");
				newLines.push(TASKPLANE_GITIGNORE_NPM_HEADER);
			}
			newLines.push(...npmAdded);
		}

		const blockText = newLines.join("\n") + "\n";

		if (fileExists) {
			// Append to existing file with a blank line separator
			const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";
			fs.appendFileSync(gitignorePath, separator + blockText, "utf-8");
		} else {
			fs.writeFileSync(gitignorePath, blockText, "utf-8");
		}
	}

	return { created: !fileExists, added, skipped };
}

// patternToRegex imported from ./gitignore-patterns.mjs

/**
 * Check for tracked runtime artifacts and offer to untrack them.
 * Uses `git ls-files` to find tracked files that match gitignore patterns.
 * Runs `git rm --cached` to untrack (files remain on disk).
 *
 * Isolation: This function commits or stashes nothing. It only removes files
 * from the index. The caller is responsible for ensuring this runs BEFORE
 * autoCommitTaskFiles() so the removals don't get bundled into unrelated commits.
 *
 * @param {string} projectRoot - Git repo root
 * @param {object} options
 * @param {boolean} options.dryRun - If true, report but don't modify index
 * @param {boolean} options.interactive - If false, skip prompt and don't untrack
 * @param {string} options.prefix - Path prefix for workspace-scoped scanning (e.g., ".taskplane/")
 */
async function detectAndOfferUntrackArtifacts(projectRoot, { dryRun = false, interactive = true, prefix = "" } = {}) {
	// Only run in a git repo
	if (!isInsideGitRepo(projectRoot)) return { found: [], untracked: false };

	// Get list of tracked files under the relevant directories
	// For workspace mode (prefix=".taskplane/"), scan .taskplane/.pi/ and .taskplane/.worktrees/
	// For repo mode (no prefix), scan .pi/ and .worktrees/
	const scanDirs = prefix
		? [`${prefix}.pi/`, `${prefix}.worktrees/`]
		: [".pi/", ".worktrees/"];

	let trackedFiles;
	try {
		const raw = execFileSync("git", ["ls-files", "--", ...scanDirs], {
			cwd: projectRoot,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 10000,
		}).toString().trim();
		trackedFiles = raw ? raw.split(/\r?\n/) : [];
	} catch {
		return { found: [], untracked: false };
	}

	if (trackedFiles.length === 0) return { found: [], untracked: false };

	// Build regex patterns for matching (with prefix if workspace-scoped)
	const prefixedPatterns = prefix
		? ALL_GITIGNORE_PATTERNS.map(p => `${prefix}${p}`)
		: ALL_GITIGNORE_PATTERNS;
	const patterns = prefixedPatterns.map(p => patternToRegex(p));

	// Find tracked files that match runtime artifact patterns
	const matchedFiles = trackedFiles.filter(file => {
		return patterns.some(regex => regex.test(file));
	});

	if (matchedFiles.length === 0) return { found: [], untracked: false };

	// Report findings
	console.log(`\n  ${WARN} Found runtime artifacts tracked by git:`);
	for (const file of matchedFiles) {
		console.log(`     ${file}`);
	}
	console.log();
	console.log(`  These files contain machine-specific state that will cause problems`);
	console.log(`  for other team members.`);

	if (dryRun) {
		console.log(`  ${c.dim}(dry run — would offer to untrack these files)${c.reset}`);
		return { found: matchedFiles, untracked: false };
	}

	if (!interactive) {
		console.log(`  ${c.dim}Run: git rm --cached ${matchedFiles.join(" ")}${c.reset}`);
		return { found: matchedFiles, untracked: false };
	}

	const doUntrack = await confirm("  Untrack them? (files stay on disk, become gitignored)", true);
	if (!doUntrack) {
		console.log(`  ${c.dim}Skipped. You can untrack later with:${c.reset}`);
		console.log(`  ${c.dim}git rm --cached ${matchedFiles.join(" ")}${c.reset}`);
		return { found: matchedFiles, untracked: false };
	}

	// Untrack: git rm --cached for each file (using execFileSync for shell-safety)
	try {
		execFileSync("git", ["rm", "--cached", "--", ...matchedFiles], {
			cwd: projectRoot,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 10000,
		});
		console.log(`  ${OK} Files untracked (still on disk, now gitignored)`);
		return { found: matchedFiles, untracked: true };
	} catch (err) {
		console.log(`  ${WARN} Failed to untrack files: ${err.message}`);
		console.log(`  ${c.dim}Run manually: git rm --cached ${matchedFiles.join(" ")}${c.reset}`);
		return { found: matchedFiles, untracked: false };
	}
}

// ─── Mode Auto-Detection ────────────────────────────────────────────────────

/**
 * Check if the given directory is inside a git work tree.
 * Uses `git rev-parse --is-inside-work-tree` for reliability.
 */
function isInsideGitRepo(dir) {
	try {
		execSync("git rev-parse --is-inside-work-tree", {
			cwd: dir,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 5000,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if the given directory is the root of its own git repository.
 * A directory is a git repo root if it has a `.git` entry (file or directory)
 * AND `git rev-parse --show-toplevel` resolves to that directory.
 * This distinguishes true nested repos from subdirectories of a parent repo.
 */
function isGitRepoRoot(dir) {
	const gitEntry = path.join(dir, ".git");
	if (!fs.existsSync(gitEntry)) return false;
	try {
		const toplevel = execSync("git rev-parse --show-toplevel", {
			cwd: dir,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 5000,
		}).toString().trim();
		// Normalize paths for comparison (handles Windows path separators
		// and 8.3 short name mismatches on Windows)
		const normalizedToplevel = path.resolve(toplevel);
		let normalizedDir = path.resolve(dir);
		// On Windows, fs.realpathSync.native resolves 8.3 short names to
		// long names, matching what git returns. Without this, paths like
		// C:\Users\HENRYL~1\... won't match C:\Users\HenryLach\...
		try { normalizedDir = fs.realpathSync.native(normalizedDir); } catch {}
		return normalizedToplevel === normalizedDir;
	} catch {
		return false;
	}
}

/**
 * Scan immediate subdirectories of `dir` for git repositories.
 * Returns an array of subdirectory names that are git repo roots.
 * Only checks one level deep (direct children).
 * Uses `isGitRepoRoot()` to ensure we find actual nested repos,
 * not just subdirectories of the parent repo.
 */
function findSubdirectoryGitRepos(dir) {
	const results = [];
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			// Skip hidden directories and common non-repo directories
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;
			const subdir = path.join(dir, entry.name);
			if (isGitRepoRoot(subdir)) {
				results.push(entry.name);
			}
		}
	} catch {
		// If we can't read the directory, return empty
	}
	return results.sort();
}

/**
 * Detect the init mode for the current directory.
 *
 * Detection precedence:
 * 1. Check for existing config (Scenario B — "already initialized")
 * 2. Check git repo topology to determine mode
 *
 * Returns: { mode, subRepos, alreadyInitialized, existingConfigPath }
 * - mode: "repo" | "workspace" | "ambiguous" | "error"
 * - subRepos: string[] — names of subdirectory git repos (for workspace/ambiguous)
 * - alreadyInitialized: boolean — true if config already exists
 * - existingConfigPath: string|null — path to existing config (for Scenario B/D messaging)
 */
function detectInitMode(dir) {
	const currentIsGitRepo = isInsideGitRepo(dir);
	const subRepos = findSubdirectoryGitRepos(dir);
	const hasSubRepos = subRepos.length > 0;

	// Check for existing config in current dir (monorepo Scenario B)
	const hasLocalConfig =
		fs.existsSync(path.join(dir, ".pi", "task-runner.yaml")) ||
		fs.existsSync(path.join(dir, ".pi", "task-orchestrator.yaml")) ||
		fs.existsSync(path.join(dir, ".pi", "taskplane-config.json"));

	if (currentIsGitRepo && !hasSubRepos) {
		// Clear repo mode (Scenario A or B)
		return {
			mode: "repo",
			subRepos: [],
			alreadyInitialized: hasLocalConfig,
			existingConfigPath: hasLocalConfig ? path.join(dir, ".pi") : null,
		};
	}

	if (currentIsGitRepo && hasSubRepos) {
		// Ambiguous — git repo that also contains git repo subdirectories
		// Check for workspace-style .taskplane/ in subrepos too (for Scenario D if user picks workspace)
		let workspaceConfigRepo = null;
		for (const repoName of subRepos) {
			const taskplaneDir = path.join(dir, repoName, ".taskplane");
			if (fs.existsSync(taskplaneDir)) {
				workspaceConfigRepo = repoName;
				break;
			}
		}
		return {
			mode: "ambiguous",
			subRepos,
			alreadyInitialized: hasLocalConfig,
			existingConfigPath: hasLocalConfig ? path.join(dir, ".pi") : null,
			workspaceConfigRepo,
			workspaceConfigPath: workspaceConfigRepo
				? path.join(dir, workspaceConfigRepo, ".taskplane")
				: null,
		};
	}

	if (!currentIsGitRepo && hasSubRepos) {
		// Workspace mode (Scenario C or D)
		// Check for existing .taskplane/ in any subdirectory repo (Scenario D)
		let existingConfigRepo = null;
		for (const repoName of subRepos) {
			const taskplaneDir = path.join(dir, repoName, ".taskplane");
			if (fs.existsSync(taskplaneDir)) {
				existingConfigRepo = repoName;
				break;
			}
		}
		return {
			mode: "workspace",
			subRepos,
			alreadyInitialized: existingConfigRepo !== null,
			existingConfigPath: existingConfigRepo
				? path.join(dir, existingConfigRepo, ".taskplane")
				: null,
		};
	}

	// Not a git repo and no git repos in subdirectories → error
	return {
		mode: "error",
		subRepos: [],
		alreadyInitialized: false,
		existingConfigPath: null,
	};
}

// ─── init ───────────────────────────────────────────────────────────────────

async function cmdInit(args) {
	const projectRoot = process.cwd();
	const force = args.includes("--force");
	const dryRun = args.includes("--dry-run");
	const noExamplesFlag = args.includes("--no-examples");
	const includeExamples = args.includes("--include-examples");
	const presetIdx = args.indexOf("--preset");
	const preset = presetIdx !== -1 ? args[presetIdx + 1] : null;
	const tasksRootIdx = args.indexOf("--tasks-root");
	const tasksRootRaw = tasksRootIdx !== -1 ? args[tasksRootIdx + 1] : null;

	if (noExamplesFlag && includeExamples) {
		die("Choose either --no-examples or --include-examples, not both.");
	}

	if (tasksRootIdx !== -1 && (!tasksRootRaw || tasksRootRaw.startsWith("--"))) {
		die("Missing value for --tasks-root <relative-path>.");
	}

	let tasksRootOverride = null;
	if (tasksRootRaw) {
		if (path.isAbsolute(tasksRootRaw)) {
			die("--tasks-root must be relative to the project root (absolute paths are not allowed).");
		}
		tasksRootOverride = tasksRootRaw.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
		if (!tasksRootOverride || tasksRootOverride === ".") {
			die("--tasks-root must not be empty.");
		}
		if (tasksRootOverride === ".." || tasksRootOverride.startsWith("../")) {
			die("--tasks-root must stay within the project root (paths starting with .. are not allowed).");
		}
	}

	const noExamples = noExamplesFlag || (!!tasksRootOverride && !includeExamples);

	console.log(`\n${c.bold}Taskplane Init${c.reset}\n`);

	if (tasksRootOverride && !noExamplesFlag && !includeExamples) {
		console.log(`  ${INFO} Using custom --tasks-root (${tasksRootOverride}); skipping example tasks by default.`);
		console.log(`     Use --include-examples to scaffold examples into that directory.\n`);
	}

	// ── Mode auto-detection ──────────────────────────────────────
	const detection = detectInitMode(projectRoot);
	const isPreset = preset === "minimal" || preset === "full" || preset === "runner-only";

	// Error path: not a git repo and no git repos found
	if (detection.mode === "error") {
		die(
			"Not a git repo and no git repos found in subdirectories.\n" +
			"  Run from inside a git repository, or from a workspace root\n" +
			"  that contains git repositories as subdirectories."
		);
	}

	// Resolve ambiguous mode (git repo + git repo subdirectories)
	let resolvedMode = detection.mode;
	if (detection.mode === "ambiguous") {
		if (isPreset || dryRun) {
			// Non-interactive: default to repo mode (safe default, no prompt)
			resolvedMode = "repo";
			console.log(`  ${INFO} Ambiguous layout detected (git repo with git repo subdirectories).`);
			console.log(`     Defaulting to ${c.cyan}repo mode${c.reset} (use interactive mode for workspace).\n`);
		} else {
			// Interactive: prompt the user
			console.log(`  ${WARN} This directory is a git repo AND contains git repos as subdirectories.`);
			console.log(`     Subdirectory repos found: ${detection.subRepos.join(", ")}\n`);
			const modeChoice = await ask(
				"Mode: (r)epo — treat as single monorepo, or (w)orkspace — treat subdirs as independent repos",
				"r"
			);
			resolvedMode = modeChoice.toLowerCase().startsWith("w") ? "workspace" : "repo";
			console.log();
		}
	}

	// When ambiguous mode resolves to workspace, use workspace-specific config
	// detection. The detection.existingConfigPath from ambiguous mode points to
	// monorepo `.pi/` config, which is irrelevant for workspace Scenario D
	// (which looks for `.taskplane/` in subrepos).
	let effectiveAlreadyInitialized = detection.alreadyInitialized;
	let effectiveConfigPath = detection.existingConfigPath;
	if (detection.mode === "ambiguous" && resolvedMode === "workspace") {
		effectiveAlreadyInitialized = detection.workspaceConfigRepo !== null;
		effectiveConfigPath = detection.workspaceConfigPath || null;
	}

	// Scenario B: existing monorepo config — block reinit unless --force
	if (effectiveAlreadyInitialized && !force && resolvedMode === "repo") {
		console.log(`  ${INFO} Project already initialized (config exists in .pi/).`);
		console.log(`     Run ${c.cyan}taskplane doctor${c.reset} to verify, or use ${c.cyan}--force${c.reset} to reinitialize.\n`);
		return;
	}

	// Scenario D: existing workspace config found in a subdirectory repo
	// Create pointer only — skip all Scenario C scaffolding/prompts/gitignore/auto-commit
	// This is independent of --force: --force only controls pointer overwrite, not Scenario D detection
	if (effectiveAlreadyInitialized && resolvedMode === "workspace" && effectiveConfigPath) {
		const configRepo = path.basename(path.dirname(effectiveConfigPath));
		const configRepoRoot = path.join(projectRoot, configRepo);
		// Read existing routing from config repo first, then fall back to
		// the workspace root's .pi/taskplane-workspace.yaml (which --force may overwrite).
		// This preserves user's tasks_root and default_repo on reinit.
		const existingWorkspaceJson = readWorkspaceJson(configRepoRoot);
		const existingRootYaml = (() => {
			try {
				const yamlPath = path.join(projectRoot, ".pi", "taskplane-workspace.yaml");
				if (fs.existsSync(yamlPath)) {
					const raw = fs.readFileSync(yamlPath, "utf-8");
					const tasksMatch = raw.match(/tasks_root:\s*"?([^"\n]+)"?/);
					const defaultMatch = raw.match(/default_repo:\s*"?([^"\n]+)"?/);
					return {
						routing: {
							tasks_root: tasksMatch?.[1]?.trim() || null,
							default_repo: defaultMatch?.[1]?.trim() || null,
						},
					};
				}
			} catch {}
			return null;
		})();
		const workspaceTasksRoot = existingWorkspaceJson?.routing?.tasks_root
			|| existingRootYaml?.routing?.tasks_root
			|| "taskplane-tasks";
		const workspaceDefaultRepo = existingWorkspaceJson?.routing?.default_repo
			|| existingRootYaml?.routing?.default_repo
			|| configRepo;
		const workspaceRepoNames = Array.from(
			new Set([
				...detection.subRepos,
				...((Array.isArray(existingWorkspaceJson?.repos) ? existingWorkspaceJson.repos : [])
					.map((repo) => repo?.name)
					.filter(Boolean)),
			]),
		).sort();

		console.log(`  ${c.dim}Mode: workspace (${detection.subRepos.length} git repositories found)${c.reset}`);
		console.log(`  ${INFO} Found existing Taskplane config in ${c.cyan}${configRepo}/.taskplane/${c.reset}`);
		console.log(`     Using existing configuration.\n`);

		// ── Pointer idempotency ─────────────────────────────────
		const pointerPath = path.join(projectRoot, ".pi", "taskplane-pointer.json");
		const workspaceYamlPath = path.join(projectRoot, ".pi", "taskplane-workspace.yaml");
		const pointerExists = fs.existsSync(pointerPath);
		const workspaceYamlExists = fs.existsSync(workspaceYamlPath);

		if (dryRun) {
			console.log(`${c.bold}Dry run — files that would be created:${c.reset}\n`);
			if (pointerExists) {
				console.log(`  ${c.yellow}overwrite${c.reset} .pi/taskplane-pointer.json`);
			} else {
				console.log(`  ${c.green}create${c.reset}    .pi/taskplane-pointer.json`);
			}
			if (workspaceYamlExists) {
				console.log(`  ${c.dim}skip${c.reset}  .pi/taskplane-workspace.yaml (already exists)`);
			} else {
				console.log(`  ${c.green}create${c.reset} .pi/taskplane-workspace.yaml`);
			}
			console.log();
			return;
		}

		if (pointerExists && !force) {
			let existingPointer = null;
			try {
				existingPointer = JSON.parse(fs.readFileSync(pointerPath, "utf-8"));
			} catch {
				// Malformed pointer file — treat as invalid, will be overwritten
				console.log(`  ${WARN} .pi/taskplane-pointer.json exists but is malformed — will overwrite.`);
			}
			if (existingPointer && existingPointer.config_repo === configRepo && existingPointer.config_path === ".taskplane") {
				console.log(`  ${c.dim}skip${c.reset}  .pi/taskplane-pointer.json (already points to ${configRepo}/.taskplane/)`);
				console.log(`\n${OK} ${c.bold}Workspace already configured.${c.reset}`);
				console.log(`     Run ${c.cyan}taskplane doctor${c.reset} to verify.\n`);
				return;
			}
			// Pointer exists but points elsewhere (or was malformed) — prompt to overwrite
			if (existingPointer && !isPreset) {
				console.log(`  ${WARN} .pi/taskplane-pointer.json already exists (points to ${existingPointer.config_repo}/.taskplane/).`);
				const proceed = await confirm("  Update pointer to point to " + configRepo + "/.taskplane/?", true);
				if (!proceed) {
					console.log("  Aborted.");
					return;
				}
			}
			// Preset/non-interactive or malformed: overwrite silently
		}

		// Create pointer file
		const pointer = {
			config_repo: configRepo,
			config_path: ".taskplane",
		};
		writeFile(
			pointerPath,
			JSON.stringify(pointer, null, 2) + "\n",
			{ label: ".pi/taskplane-pointer.json" }
		);

		writeFile(
			workspaceYamlPath,
			generateWorkspaceYaml(workspaceRepoNames, workspaceDefaultRepo, workspaceTasksRoot),
			{ skipIfExists: !force, label: ".pi/taskplane-workspace.yaml" },
		);

		// ── Gitignore enforcement in config repo (Scenario D) ───
		// Ensure .gitignore exists even when reusing existing config
		const gitignoreResult = ensureGitignoreEntries(configRepoRoot, { dryRun: false, prefix: ".taskplane/" });
		if (gitignoreResult.created) {
			console.log(`  ${c.green}create${c.reset} ${configRepo}/.gitignore`);
		} else if (gitignoreResult.added.length > 0) {
			console.log(`  ${c.green}update${c.reset} ${configRepo}/.gitignore (${gitignoreResult.added.length} entries added)`);
		}

		console.log(`\n${OK} ${c.bold}Workspace pointer created.${c.reset}\n`);
		console.log(`  Config:  ${c.cyan}${configRepo}/.taskplane/${c.reset}`);
		console.log(`  Pointer: ${c.cyan}.pi/taskplane-pointer.json${c.reset}`);
		console.log(`  Workspace config: ${c.cyan}.pi/taskplane-workspace.yaml${c.reset}\n`);
		console.log(`${c.bold}Quick start:${c.reset}`);
		console.log(`  ${c.cyan}pi${c.reset}                                             # start pi (taskplane auto-loads)`);
		console.log(`  ${c.cyan}taskplane doctor${c.reset}                                # verify setup`);
		console.log();
		return;
	}

	// Show detected mode
	if (resolvedMode === "repo") {
		console.log(`  ${c.dim}Mode: repo (standard monorepo)${c.reset}`);
	} else if (resolvedMode === "workspace") {
		console.log(`  ${c.dim}Mode: workspace (${detection.subRepos.length} git repositories found)${c.reset}`);
	}
	console.log();

	// ── Workspace mode: Scenario C (first-time project init) ─────────────
	if (resolvedMode === "workspace") {
		// List discovered repos
		console.log(`  Found ${detection.subRepos.length} git repositories:`);
		console.log(`    ${detection.subRepos.join(", ")}\n`);

		// ── Config repo selection ────────────────────────────────────
		let configRepoName;
		if (isPreset || dryRun) {
			// Non-interactive: pick first repo alphabetically as default
			configRepoName = detection.subRepos[0];
			console.log(`  ${INFO} Using ${c.cyan}${configRepoName}${c.reset} as config repo (first alphabetically).\n`);
		} else {
			// Interactive: prompt user to choose config repo
			console.log(`  Which repo should hold Taskplane config?`);
			for (let i = 0; i < detection.subRepos.length; i++) {
				console.log(`    ${c.dim}${i + 1}.${c.reset} ${detection.subRepos[i]}`);
			}
			console.log();
			const configRepoAnswer = await ask(
				"Config repo (name or number)",
				detection.subRepos[0]
			);
			// Accept numeric index or repo name
			const asNum = parseInt(configRepoAnswer, 10);
			if (asNum >= 1 && asNum <= detection.subRepos.length) {
				configRepoName = detection.subRepos[asNum - 1];
			} else if (detection.subRepos.includes(configRepoAnswer)) {
				configRepoName = configRepoAnswer;
			} else {
				die(`Unknown repo: ${configRepoAnswer}. Must be one of: ${detection.subRepos.join(", ")}`);
			}
			console.log(`  Using config repo: ${c.cyan}${configRepoName}${c.reset}\n`);
		}

		const configRepoRoot = path.join(projectRoot, configRepoName);
		const taskplaneDir = path.join(configRepoRoot, ".taskplane");

		// ── Existing config overwrite check for workspace reinit ─────
		let userConfirmedOverwrite = false;
		if (fs.existsSync(taskplaneDir) && !force) {
			console.log(`${WARN} Taskplane config already exists in ${configRepoName}/.taskplane/.`);
			const proceed = await confirm("  Overwrite existing files?", false);
			if (!proceed) {
				console.log("  Aborted.");
				return;
			}
			userConfirmedOverwrite = true;
		}

		// ── Gather config values (workspace mode) ───────────────────
		let vars;
		if (preset === "minimal" || preset === "full" || preset === "runner-only") {
			vars = getPresetVars(preset, projectRoot, tasksRootOverride);
			console.log(`  Using preset: ${c.cyan}${preset}${c.reset}`);
			if (tasksRootOverride) {
				console.log(`  Task directory: ${c.cyan}${tasksRootOverride}${c.reset}`);
			}
			console.log();
		} else {
			vars = await getInteractiveVars(projectRoot, tasksRootOverride);
		}

		// Runtime V2 is subprocess-only.
		vars.spawn_mode = "subprocess";

		const exampleTemplateDirs = noExamples ? [] : listExampleTaskTemplates();

		// ── Dry-run: show what would be created ─────────────────────
		if (dryRun) {
			console.log(`\n${c.bold}Dry run — files that would be created:${c.reset}\n`);
			printWorkspaceFileList(vars, noExamples, preset, exampleTemplateDirs, configRepoName, configRepoRoot);
			console.log(`  ${c.green}create${c.reset} .pi/taskplane-pointer.json`);
			console.log(`  ${c.green}create${c.reset} .pi/taskplane-workspace.yaml`);
			console.log();
			return;
		}

		// ── Scaffold .taskplane/ in config repo ─────────────────────
		console.log(`\n${c.bold}Creating files in ${configRepoName}/.taskplane/...${c.reset}\n`);
		// Skip existing files only when --force was NOT used AND the user did NOT confirm overwrite
		const skipIfExists = !force && !userConfirmedOverwrite;

		// Agent prompts
		for (const agent of ["task-worker.md", "task-reviewer.md", "task-merger.md", "supervisor.md"]) {
			copyTemplate(
				path.join(TEMPLATES_DIR, "agents", "local", agent),
				path.join(taskplaneDir, "agents", agent),
				{ skipIfExists, label: `${configRepoName}/.taskplane/agents/${agent}` }
			);
		}

		// Task runner config
		writeFile(
			path.join(taskplaneDir, "task-runner.yaml"),
			generateTaskRunnerYaml(vars),
			{ skipIfExists, label: `${configRepoName}/.taskplane/task-runner.yaml` }
		);

		// Orchestrator config (skip for runner-only preset)
		if (preset !== "runner-only") {
			writeFile(
				path.join(taskplaneDir, "task-orchestrator.yaml"),
				generateOrchestratorYaml(vars),
				{ skipIfExists, label: `${configRepoName}/.taskplane/task-orchestrator.yaml` }
			);
		}

		// Project config JSON (taskplane-config.json)
		const projectConfig = generateProjectConfig(vars);
		writeFile(
			path.join(taskplaneDir, "taskplane-config.json"),
			JSON.stringify(projectConfig, null, 2) + "\n",
			{ skipIfExists, label: `${configRepoName}/.taskplane/taskplane-config.json` }
		);

		// Version tracker (always overwrite)
		const versionInfo = {
			version: getPackageVersion(),
			installedAt: new Date().toISOString(),
			lastUpgraded: new Date().toISOString(),
			components: { agents: getPackageVersion(), config: getPackageVersion() },
		};
		writeFile(
			path.join(taskplaneDir, "taskplane.json"),
			JSON.stringify(versionInfo, null, 2) + "\n",
			{ label: `${configRepoName}/.taskplane/taskplane.json` }
		);

		// Workspace definition (workspace.json)
		const workspaceConfig = {
			repos: detection.subRepos.map(name => ({
				name,
				path: `../${name}`,
				default_branch: "main",
			})),
			routing: {
				tasks_root: vars.tasks_root,
				default_repo: configRepoName,
				strict: false,
			},
		};
		writeFile(
			path.join(taskplaneDir, "workspace.json"),
			JSON.stringify(workspaceConfig, null, 2) + "\n",
			{ skipIfExists, label: `${configRepoName}/.taskplane/workspace.json` }
		);

		// CONTEXT.md — tasks area context
		const tasksDir = path.join(configRepoRoot, vars.tasks_root);
		const contextSrc = fs.readFileSync(path.join(TEMPLATES_DIR, "tasks", "CONTEXT.md"), "utf-8");
		writeFile(
			path.join(tasksDir, "CONTEXT.md"),
			interpolate(contextSrc, vars),
			{ skipIfExists, label: `${configRepoName}/${vars.tasks_root}/CONTEXT.md` }
		);

		// Example tasks
		if (!noExamples) {
			for (const exampleName of exampleTemplateDirs) {
				const exampleDir = path.join(TEMPLATES_DIR, "tasks", exampleName);
				const destDir = path.join(tasksDir, exampleName);
				for (const file of ["PROMPT.md", "STATUS.md"]) {
					const srcPath = path.join(exampleDir, file);
					if (!fs.existsSync(srcPath)) continue;
					const src = fs.readFileSync(srcPath, "utf-8");
					writeFile(path.join(destDir, file), interpolate(src, vars), {
						skipIfExists,
						label: `${configRepoName}/${vars.tasks_root}/${exampleName}/${file}`,
					});
				}
			}
			if (exampleTemplateDirs.length === 0) {
				console.log(`  ${WARN} No example task templates found under templates/tasks/EXAMPLE-*`);
			}
		}

		// ── Gitignore enforcement in config repo ────────────────────
		// Use .taskplane/ prefix so patterns apply within the config repo's
		// .taskplane/ directory (e.g., ".taskplane/.pi/batch-state.json")
		// Per spec: standard .pi/ patterns + .worktrees/ in config repo root
		const gitignoreResult = ensureGitignoreEntries(configRepoRoot, { dryRun: false, prefix: ".taskplane/" });

		if (gitignoreResult.created) {
			console.log(`  ${c.green}create${c.reset} ${configRepoName}/.gitignore`);
		} else if (gitignoreResult.added.length > 0) {
			console.log(`  ${c.green}update${c.reset} ${configRepoName}/.gitignore (${gitignoreResult.added.length} entries added)`);
		} else {
			console.log(`  ${c.dim}skip${c.reset}  ${configRepoName}/.gitignore (all entries already present)`);
		}

		// Check for tracked runtime artifacts in config repo (workspace-scoped)
		const wsIsInteractive = !isPreset && !dryRun;
		await detectAndOfferUntrackArtifacts(configRepoRoot, { dryRun: false, interactive: wsIsInteractive, prefix: ".taskplane/" });

		// ── Pointer file in workspace root .pi/ ─────────────────────
		const pointer = {
			config_repo: configRepoName,
			config_path: ".taskplane",
		};
		writeFile(
			path.join(projectRoot, ".pi", "taskplane-pointer.json"),
			JSON.stringify(pointer, null, 2) + "\n",
			{ label: ".pi/taskplane-pointer.json" }
		);
		writeFile(
			path.join(projectRoot, ".pi", "taskplane-workspace.yaml"),
			generateWorkspaceYaml(detection.subRepos, configRepoName, vars.tasks_root),
			{ label: ".pi/taskplane-workspace.yaml" },
		);

		// ── Auto-commit config files in the config repo ─────────────
		await autoCommitTaskFiles(configRepoRoot, vars.tasks_root);
		// Also stage and commit .taskplane/ directory and .gitignore
		try {
			execSync('git add .taskplane/ .gitignore', { cwd: configRepoRoot, stdio: "pipe" });
			const status = execSync("git diff --cached --name-only", { cwd: configRepoRoot, stdio: "pipe" })
				.toString().trim();
			if (status) {
				execSync('git commit -m "chore: initialize taskplane workspace config"', {
					cwd: configRepoRoot,
					stdio: "pipe",
				});
				console.log(`\n  ${c.green}git${c.reset}    committed .taskplane/ and .gitignore to ${configRepoName}`);
			}
		} catch (err) {
			console.log(`\n  ${WARN} Could not auto-commit .taskplane/ to ${configRepoName}.`);
			console.log(`  ${c.dim}Run manually: cd ${configRepoName} && git add .taskplane/ .gitignore && git commit -m "add taskplane config"${c.reset}`);
		}

		// ── Post-init guidance ──────────────────────────────────────
		console.log(`\n${OK} ${c.bold}Taskplane initialized in workspace mode!${c.reset}\n`);
		console.log(`  Config repo: ${c.cyan}${configRepoName}/.taskplane/${c.reset}`);
		console.log(`  Pointer:     ${c.cyan}.pi/taskplane-pointer.json${c.reset}`);
		console.log(`  Workspace:   ${c.cyan}.pi/taskplane-workspace.yaml${c.reset}\n`);
		console.log(`  ${WARN} ${c.bold}Important:${c.reset} merge these changes to your default branch (e.g., ${c.cyan}develop${c.reset})`);
		console.log(`     before other team members run ${c.cyan}taskplane init${c.reset}.\n`);
		console.log(`     cd ${configRepoName}`);
		console.log(`     git push && ${c.dim}[create PR / merge to default branch]${c.reset}\n`);
		console.log(`${c.bold}Quick start:${c.reset}`);
		console.log(`  ${c.cyan}pi${c.reset}                                             # start pi (taskplane auto-loads)`);
		if (preset !== "runner-only") {
			console.log(`  ${c.cyan}/orch${c.reset}                                             # start the taskplane supervisor`);
			console.log(`  ${c.cyan}/orch all${c.reset}                                        # run all open tasks`);
		}
		console.log();
		return;
	}

	// ── Existing config overwrite check (for repo mode force reinit) ──
	let repoUserConfirmedOverwrite = false;
	const hasConfig =
		fs.existsSync(path.join(projectRoot, ".pi", "task-runner.yaml")) ||
		fs.existsSync(path.join(projectRoot, ".pi", "task-orchestrator.yaml")) ||
		fs.existsSync(path.join(projectRoot, ".pi", "taskplane-config.json"));

	if (hasConfig && !force && resolvedMode === "repo") {
		console.log(`${WARN} Taskplane config already exists in this project.`);
		const proceed = await confirm("  Overwrite existing files?", false);
		if (!proceed) {
			console.log("  Aborted.");
			return;
		}
		repoUserConfirmedOverwrite = true;
	}

	// Gather config values
	let vars;
	if (preset === "minimal" || preset === "full" || preset === "runner-only") {
		vars = getPresetVars(preset, projectRoot, tasksRootOverride);
		console.log(`  Using preset: ${c.cyan}${preset}${c.reset}`);
		if (tasksRootOverride) {
			console.log(`  Task directory: ${c.cyan}${tasksRootOverride}${c.reset}`);
		}
		console.log();
	} else {
		vars = await getInteractiveVars(projectRoot, tasksRootOverride);
	}

	// Runtime V2 is subprocess-only.
	vars.spawn_mode = "subprocess";

	const exampleTemplateDirs = noExamples ? [] : listExampleTaskTemplates();

	if (dryRun) {
		console.log(`\n${c.bold}Dry run — files that would be created:${c.reset}\n`);
		printFileList(vars, noExamples, preset, exampleTemplateDirs, projectRoot);
		return;
	}

	// Scaffold files
	console.log(`\n${c.bold}Creating files...${c.reset}\n`);
	// Skip existing files only when --force was NOT used AND the user did NOT confirm overwrite
	const skipIfExists = !force && !repoUserConfirmedOverwrite;

	// Agent prompts — copy thin local files (base prompts ship in the package
	// and are composed automatically by the task-runner at runtime)
	for (const agent of ["task-worker.md", "task-reviewer.md", "task-merger.md", "supervisor.md"]) {
		copyTemplate(
			path.join(TEMPLATES_DIR, "agents", "local", agent),
			path.join(projectRoot, ".pi", "agents", agent),
			{ skipIfExists, label: `.pi/agents/${agent}` }
		);
	}

	// Task runner config
	writeFile(
		path.join(projectRoot, ".pi", "task-runner.yaml"),
		generateTaskRunnerYaml(vars),
		{ skipIfExists, label: ".pi/task-runner.yaml" }
	);

	// Orchestrator config (skip for runner-only preset)
	if (preset !== "runner-only") {
		writeFile(
			path.join(projectRoot, ".pi", "task-orchestrator.yaml"),
			generateOrchestratorYaml(vars),
			{ skipIfExists, label: ".pi/task-orchestrator.yaml" }
		);
	}

	// Unified project config JSON
	writeFile(
		path.join(projectRoot, ".pi", "taskplane-config.json"),
		JSON.stringify(generateProjectConfig(vars), null, 2) + "\n",
		{ skipIfExists, label: ".pi/taskplane-config.json" },
	);

	// Version tracker (always overwrite)
	const versionInfo = {
		version: getPackageVersion(),
		installedAt: new Date().toISOString(),
		lastUpgraded: new Date().toISOString(),
		components: { agents: getPackageVersion(), config: getPackageVersion() },
	};
	writeFile(
		path.join(projectRoot, ".pi", "taskplane.json"),
		JSON.stringify(versionInfo, null, 2) + "\n",
		{ label: ".pi/taskplane.json" }
	);

	// CONTEXT.md
	const contextSrc = fs.readFileSync(path.join(TEMPLATES_DIR, "tasks", "CONTEXT.md"), "utf-8");
	writeFile(
		path.join(projectRoot, vars.tasks_root, "CONTEXT.md"),
		interpolate(contextSrc, vars),
		{ skipIfExists, label: `${vars.tasks_root}/CONTEXT.md` }
	);

	// Example tasks
	if (!noExamples) {
		for (const exampleName of exampleTemplateDirs) {
			const exampleDir = path.join(TEMPLATES_DIR, "tasks", exampleName);
			const destDir = path.join(projectRoot, vars.tasks_root, exampleName);
			for (const file of ["PROMPT.md", "STATUS.md"]) {
				const srcPath = path.join(exampleDir, file);
				if (!fs.existsSync(srcPath)) continue;
				const src = fs.readFileSync(srcPath, "utf-8");
				writeFile(path.join(destDir, file), interpolate(src, vars), {
					skipIfExists,
					label: `${vars.tasks_root}/${exampleName}/${file}`,
				});
			}
		}
		if (exampleTemplateDirs.length === 0) {
			console.log(`  ${WARN} No example task templates found under templates/tasks/EXAMPLE-*`);
		}
	}

	// ── Gitignore enforcement ────────────────────────────────────────────
	// Must run BEFORE autoCommitTaskFiles() so that:
	// 1. .gitignore changes are committed alongside task files
	// 2. git rm --cached removals don't get bundled into the task auto-commit
	const isInteractive = !isPreset && !dryRun;
	const gitignoreResult = ensureGitignoreEntries(projectRoot, { dryRun });

	if (!dryRun) {
		if (gitignoreResult.created) {
			console.log(`  ${c.green}create${c.reset} .gitignore`);
		} else if (gitignoreResult.added.length > 0) {
			console.log(`  ${c.green}update${c.reset} .gitignore (${gitignoreResult.added.length} entries added)`);
		} else {
			console.log(`  ${c.dim}skip${c.reset}  .gitignore (all entries already present)`);
		}
	}

	// Check for tracked runtime artifacts and offer to untrack
	await detectAndOfferUntrackArtifacts(projectRoot, { dryRun, interactive: isInteractive });

	// Auto-commit task files to git so they're available in worktrees
	await autoCommitTaskFiles(projectRoot, vars.tasks_root);

	// Report
	console.log(`\n${OK} ${c.bold}Taskplane initialized!${c.reset}\n`);
	console.log(`${c.bold}Quick start:${c.reset}`);
	console.log(`  ${c.cyan}pi${c.reset}                                             # start pi (taskplane auto-loads)`);
	if (preset !== "runner-only") {
		console.log(`  ${c.cyan}/orch${c.reset}                                             # start the taskplane supervisor`);
		console.log(`  ${c.cyan}/orch all${c.reset}                                        # run all open tasks`);
	}
	console.log();
}

function getPresetVars(preset, projectRoot, tasksRootOverride = null) {
	const dirName = path.basename(projectRoot);
	const slug = slugify(dirName);
	const { test: test_cmd, build: build_cmd } = detectStack(projectRoot);
	return {
		project_name: dirName,
		max_lanes: 3,
		worktree_prefix: `${slug}-wt`,
		session_prefix: `${slug}-orch`,
		tasks_root: tasksRootOverride || "taskplane-tasks",
		default_area: "general",
		default_prefix: "TP",
		test_cmd,
		build_cmd,
		date: today(),
	};
}

async function getInteractiveVars(projectRoot, tasksRootOverride = null) {
	const dirName = path.basename(projectRoot);
	const detected = detectStack(projectRoot);

	const project_name = await ask("Project name", dirName);
	const max_lanes = parseInt(await ask("Max parallel lanes", "3")) || 3;
	const tasks_root = tasksRootOverride || await ask("Tasks directory", "taskplane-tasks");
	const default_area = await ask("Default area name", "general");
	const default_prefix = await ask("Task ID prefix", "TP");
	const test_cmd = await ask("Test command (agents run this to verify work — blank to skip)", detected.test || "");
	const build_cmd = await ask("Build command (agents run this after tests — blank to skip)", detected.build || "");

	const slug = slugify(project_name);
	return {
		project_name,
		max_lanes,
		worktree_prefix: `${slug}-wt`,
		session_prefix: `${slug}-orch`,
		tasks_root,
		default_area,
		default_prefix,
		test_cmd,
		build_cmd,
		date: today(),
	};
}

function printFileList(vars, noExamples, preset, exampleTemplateDirs = [], projectRoot = null) {
	const files = [
		".pi/agents/task-worker.md",
		".pi/agents/task-reviewer.md",
		".pi/agents/task-merger.md",
		".pi/agents/supervisor.md",
		".pi/task-runner.yaml",
	];
	if (preset !== "runner-only") files.push(".pi/task-orchestrator.yaml");
	files.push(".pi/taskplane-config.json");
	files.push(".pi/taskplane.json");
	files.push(`${vars.tasks_root}/CONTEXT.md`);
	if (!noExamples) {
		for (const exampleName of exampleTemplateDirs) {
			files.push(`${vars.tasks_root}/${exampleName}/PROMPT.md`);
			files.push(`${vars.tasks_root}/${exampleName}/STATUS.md`);
		}
	}
	for (const f of files) console.log(`  ${c.green}create${c.reset} ${f}`);

	// Show gitignore entries that would be added
	if (projectRoot) {
		const gitignoreResult = ensureGitignoreEntries(projectRoot, { dryRun: true });
		if (gitignoreResult.added.length > 0) {
			const action = fs.existsSync(path.join(projectRoot, ".gitignore")) ? "update" : "create";
			console.log(`  ${c.green}${action}${c.reset} .gitignore (${gitignoreResult.added.length} entries)`);
		} else {
			console.log(`  ${c.dim}skip${c.reset}  .gitignore (all entries already present)`);
		}
	}

	console.log();
}

/**
 * Print the list of files that would be created for workspace mode (dry-run).
 * Similar to printFileList but paths are scoped to <configRepo>/.taskplane/.
 */
function printWorkspaceFileList(vars, noExamples, preset, exampleTemplateDirs, configRepoName, configRepoRoot) {
	const prefix = `${configRepoName}/.taskplane`;
	const files = [
		`${prefix}/agents/task-worker.md`,
		`${prefix}/agents/task-reviewer.md`,
		`${prefix}/agents/task-merger.md`,
		`${prefix}/agents/supervisor.md`,
		`${prefix}/task-runner.yaml`,
	];
	if (preset !== "runner-only") files.push(`${prefix}/task-orchestrator.yaml`);
	files.push(`${prefix}/taskplane-config.json`);
	files.push(`${prefix}/taskplane.json`);
	files.push(`${prefix}/workspace.json`);
	files.push(`${configRepoName}/${vars.tasks_root}/CONTEXT.md`);
	if (!noExamples) {
		for (const exampleName of exampleTemplateDirs) {
			files.push(`${configRepoName}/${vars.tasks_root}/${exampleName}/PROMPT.md`);
			files.push(`${configRepoName}/${vars.tasks_root}/${exampleName}/STATUS.md`);
		}
	}
	for (const f of files) console.log(`  ${c.green}create${c.reset} ${f}`);

	// Show gitignore entries that would be added to config repo (workspace-scoped)
	const gitignoreResult = ensureGitignoreEntries(configRepoRoot, { dryRun: true, prefix: ".taskplane/" });
	if (gitignoreResult.added.length > 0) {
		const action = fs.existsSync(path.join(configRepoRoot, ".gitignore")) ? "update" : "create";
		console.log(`  ${c.green}${action}${c.reset} ${configRepoName}/.gitignore (${gitignoreResult.added.length} entries)`);
	} else {
		console.log(`  ${c.dim}skip${c.reset}  ${configRepoName}/.gitignore (all entries already present)`);
	}
}

// ─── Workspace Mode Detection (for doctor) ─────────────────────────────────

/**
 * Lightweight workspace config loader for doctor diagnostics.
 *
 * Unlike the orchestrator's `loadWorkspaceConfig()` in workspace.ts (which
 * throws on invalid config), this returns a result object so doctor can
 * report errors as diagnostics and continue checking remaining items.
 *
 * Mode determination rules (mirrors workspace.ts):
 * 1. No config file → { mode: "repo", config: null, error: null }
 * 2. Config file present + valid → { mode: "workspace", config: {...}, error: null }
 * 3. Config file present + invalid → { mode: "workspace", config: null, error: { code, message } }
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @returns {Promise<{ mode: string, config: object|null, error: object|null }>}
 */
function loadWorkspaceConfigForDoctor(projectRoot) {
	const configFile = path.join(projectRoot, ".pi", "taskplane-workspace.yaml");

	// 1. File existence — absent = repo mode
	if (!fs.existsSync(configFile)) {
		return { mode: "repo", config: null, error: null };
	}

	// 2. File read
	let rawContent;
	try {
		rawContent = fs.readFileSync(configFile, "utf-8");
	} catch (err) {
		return {
			mode: "workspace",
			config: null,
			error: {
				code: "WORKSPACE_FILE_READ_ERROR",
				message: `Cannot read workspace config file: ${err.message}`,
			},
		};
	}

	// 3. YAML parse using lightweight line-based extraction
	// (avoids importing the yaml module for CLI startup speed)
	let parsed;
	try {
		parsed = parseWorkspaceYaml(rawContent);
	} catch (err) {
		return {
			mode: "workspace",
			config: null,
			error: {
				code: "WORKSPACE_FILE_PARSE_ERROR",
				message: `Cannot parse workspace config: ${err.message}`,
			},
		};
	}

	// 4. Schema validation: repos map present and non-empty
	if (!parsed.repos || Object.keys(parsed.repos).length === 0) {
		return {
			mode: "workspace",
			config: null,
			error: {
				code: "WORKSPACE_SCHEMA_INVALID",
				message: "Workspace config must define at least one repo under 'repos'.",
			},
		};
	}

	// 5. Schema validation: routing present
	if (!parsed.routing || (!parsed.routing.default_repo && !parsed.routing.tasks_root)) {
		return {
			mode: "workspace",
			config: null,
			error: {
				code: "WORKSPACE_SCHEMA_INVALID",
				message: "Workspace config must contain a 'routing' mapping with default_repo and tasks_root.",
			},
		};
	}

	// 6. Per-repo validation: path field present
	const repoKeys = Object.keys(parsed.repos).sort();
	for (const repoId of repoKeys) {
		const repo = parsed.repos[repoId];
		if (!repo.path) {
			return {
				mode: "workspace",
				config: null,
				error: {
					code: "WORKSPACE_REPO_PATH_MISSING",
					message: `Repo '${repoId}' is missing a 'path' field.`,
				},
			};
		}
	}

	// 7. Routing validation
	if (!parsed.routing.tasks_root) {
		return {
			mode: "workspace",
			config: null,
			error: {
				code: "WORKSPACE_MISSING_TASKS_ROOT",
				message: "Workspace config 'routing.tasks_root' is missing or empty.",
			},
		};
	}

	if (!parsed.routing.default_repo) {
		return {
			mode: "workspace",
			config: null,
			error: {
				code: "WORKSPACE_MISSING_DEFAULT_REPO",
				message: "Workspace config 'routing.default_repo' is missing or empty.",
			},
		};
	}

	const defaultRepoId = parsed.routing.default_repo;
	if (!parsed.repos[defaultRepoId]) {
		const available = Object.keys(parsed.repos).join(", ");
		return {
			mode: "workspace",
			config: null,
			error: {
				code: "WORKSPACE_DEFAULT_REPO_NOT_FOUND",
				message: `routing.default_repo '${defaultRepoId}' does not match any repo ID. Available: ${available}`,
			},
		};
	}

	// Valid workspace config — build summary for doctor display
	return {
		mode: "workspace",
		config: {
			repos: parsed.repos,
			routing: {
				tasksRoot: parsed.routing.tasks_root,
				defaultRepo: defaultRepoId,
			},
			configPath: configFile,
		},
		error: null,
	};
}

/**
 * Lightweight YAML parser for workspace config.
 * Extracts repos (id → { path, default_branch }) and routing fields.
 * Does NOT handle all YAML — only the workspace config subset.
 */
function parseWorkspaceYaml(raw) {
	const lines = raw.split(/\r?\n/);
	const result = { repos: {}, routing: {} };
	let section = null;       // "repos" | "routing" | null
	let currentRepoId = null; // current repo being parsed

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		// Top-level keys
		if (/^repos\s*:\s*$/.test(trimmed)) {
			section = "repos";
			currentRepoId = null;
			continue;
		}
		if (/^routing\s*:\s*$/.test(trimmed)) {
			section = "routing";
			currentRepoId = null;
			continue;
		}
		// Any other top-level key ends current section
		if (/^[a-z_]+\s*:/.test(line) && !line.startsWith(" ") && !line.startsWith("\t")) {
			section = null;
			currentRepoId = null;
			continue;
		}

		if (section === "repos") {
			// Repo ID line (2-space indent): "  api:"
			const repoIdMatch = line.match(/^  ([a-z0-9][a-z0-9_-]*)\s*:\s*$/);
			if (repoIdMatch) {
				currentRepoId = repoIdMatch[1];
				result.repos[currentRepoId] = {};
				continue;
			}
			// Repo property lines (4-space indent): "    path: ../api-repo"
			if (currentRepoId) {
				const propMatch = line.match(/^\s{4}(\w+)\s*:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/);
				if (propMatch) {
					result.repos[currentRepoId][propMatch[1]] = propMatch[2].trim();
				}
			}
		}

		if (section === "routing") {
			// Routing property lines (2-space indent): "  default_repo: api"
			const propMatch = line.match(/^\s{2}(\w+)\s*:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/);
			if (propMatch) {
				result.routing[propMatch[1]] = propMatch[2].trim();
			}
		}
	}

	return result;
}

// ─── doctor ─────────────────────────────────────────────────────────────────

function resolveDoctorConfigLocation(projectRoot, isWorkspaceMode) {
	if (!isWorkspaceMode) {
		return {
			root: projectRoot,
			prefix: ".pi",
			label: ".pi",
		};
	}

	const pointerPath = path.join(projectRoot, ".pi", "taskplane-pointer.json");
	if (!fs.existsSync(pointerPath)) {
		return {
			root: projectRoot,
			prefix: ".pi",
			label: ".pi",
		};
	}

	try {
		const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf-8"));
		if (pointer.config_repo && pointer.config_path) {
			return {
				root: path.resolve(projectRoot, pointer.config_repo),
				prefix: pointer.config_path,
				label: `${pointer.config_repo}/${pointer.config_path}`,
			};
		}
	} catch {
		// fall through to workspace-root .pi fallback
	}

	return {
		root: projectRoot,
		prefix: ".pi",
		label: ".pi",
	};
}

function cmdDoctor() {
	const projectRoot = process.cwd();
	let issues = 0;

	console.log(`\n${c.bold}Taskplane Doctor${c.reset}\n`);

	// Check prerequisites
	const checks = [
		{ label: "pi installed", check: () => commandExists("pi"), detail: () => getVersion("pi") },
		{
			label: "Node.js >= 22.0.0",
			check: () => {
				const v = process.versions.node;
				return parseInt(v.split(".")[0]) >= 22;
			},
			detail: () => `v${process.versions.node}`,
		},
		{ label: "git installed", check: () => commandExists("git"), detail: () => getVersion("git") },
	];

	for (const { label, check, detail } of checks) {
		const ok = check();
		const info = ok && detail ? ` ${c.dim}(${detail()})${c.reset}` : "";
		console.log(`  ${ok ? OK : FAIL} ${label}${info}`);
		if (!ok) issues++;
	}

	// Detect workspace mode early so config-path checks can resolve via pointer
	const wsResult = loadWorkspaceConfigForDoctor(projectRoot);
	const isWorkspaceMode = wsResult.mode === "workspace";
	const configLocation = resolveDoctorConfigLocation(projectRoot, isWorkspaceMode);

	// Check package installation
	const pkgJson = path.join(PACKAGE_ROOT, "package.json");
	const pkgVersion = getPackageVersion();
	const isProjectLocal = PACKAGE_ROOT.includes(".pi");
	const installType = isProjectLocal ? "project-local" : "global";
	console.log(`  ${OK} taskplane package installed ${c.dim}(v${pkgVersion}, ${installType})${c.reset}`);

	if (isWorkspaceMode) {
		console.log();
		if (wsResult.error) {
			// Config present but invalid — report as failure
			const codeHint = wsResult.error.code ? ` [${wsResult.error.code}]` : "";
			console.log(`  ${FAIL} workspace mode detected but config is invalid${codeHint}`);
			console.log(`     ${c.dim}${wsResult.error.message}${c.reset}`);
			console.log(`     ${c.dim}→ Fix .pi/taskplane-workspace.yaml or remove it to use repo mode${c.reset}`);
			issues++;
		} else {
			// Valid workspace config — show summary banner
			const cfg = wsResult.config;
			const repoIds = Object.keys(cfg.repos);
			const repoCount = repoIds.length;
			const defaultRepo = cfg.routing.defaultRepo;
			const tasksRoot = cfg.routing.tasksRoot;
			console.log(`  ${OK} workspace mode ${c.dim}(${repoCount} repo${repoCount !== 1 ? "s" : ""}, default: ${defaultRepo})${c.reset}`);
			console.log(`     ${c.dim}repos: ${repoIds.join(", ")}${c.reset}`);
			console.log(`     ${c.dim}tasks_root: ${tasksRoot}${c.reset}`);
		}
	}

	// ── Workspace pointer chain validation ──────────────────────────────
	// Validates: pointer file → config repo → .taskplane/ directory → default branch
	if (isWorkspaceMode && wsResult.config) {
		console.log();
		const pointerPath = path.join(projectRoot, ".pi", "taskplane-pointer.json");

		// Check 1: Pointer file exists and is valid JSON with required fields
		let pointer = null;
		if (!fs.existsSync(pointerPath)) {
			console.log(`  ${FAIL} .pi/taskplane-pointer.json missing [POINTER_MISSING]`);
			console.log(`     ${c.dim}→ Run ${c.cyan}taskplane init${c.dim} to create the workspace pointer${c.reset}`);
			issues++;
		} else {
			try {
				pointer = JSON.parse(fs.readFileSync(pointerPath, "utf-8"));
				if (!pointer.config_repo || !pointer.config_path) {
					console.log(`  ${FAIL} .pi/taskplane-pointer.json missing required fields (config_repo, config_path) [POINTER_SCHEMA_INVALID]`);
					console.log(`     ${c.dim}→ Run ${c.cyan}taskplane init${c.dim} to recreate the pointer${c.reset}`);
					pointer = null;
					issues++;
				} else {
					console.log(`  ${OK} .pi/taskplane-pointer.json ${c.dim}(→ ${pointer.config_repo}/${pointer.config_path})${c.reset}`);
				}
			} catch {
				console.log(`  ${FAIL} .pi/taskplane-pointer.json is not valid JSON [POINTER_PARSE_ERROR]`);
				console.log(`     ${c.dim}→ Run ${c.cyan}taskplane init${c.dim} to recreate the pointer${c.reset}`);
				issues++;
			}
		}

		// Check 2: Config repo path exists on disk
		let configRepoRoot = null;
		if (pointer) {
			configRepoRoot = path.resolve(projectRoot, pointer.config_repo);
			if (!fs.existsSync(configRepoRoot)) {
				console.log(`  ${FAIL} config repo not found: ${pointer.config_repo} [CONFIG_REPO_NOT_FOUND]`);
				console.log(`     ${c.dim}→ Clone ${pointer.config_repo} into ${projectRoot}${c.reset}`);
				configRepoRoot = null;
				issues++;
			} else if (!isInsideGitRepo(configRepoRoot)) {
				console.log(`  ${FAIL} config repo is not a git repository: ${pointer.config_repo} [CONFIG_REPO_NOT_GIT]`);
				console.log(`     ${c.dim}→ Run: git init ${configRepoRoot}${c.reset}`);
				configRepoRoot = null;
				issues++;
			} else {
				console.log(`  ${OK} config repo: ${pointer.config_repo} ${c.dim}(${configRepoRoot})${c.reset}`);
			}
		}

		// Check 3: .taskplane/ directory exists in config repo
		let taskplaneDirExists = false;
		if (configRepoRoot) {
			const taskplaneDir = path.join(configRepoRoot, pointer.config_path);
			if (!fs.existsSync(taskplaneDir)) {
				console.log(`  ${FAIL} ${pointer.config_repo}/${pointer.config_path}/ not found [CONFIG_DIR_NOT_FOUND]`);
				console.log(`     ${c.dim}→ Run ${c.cyan}taskplane init${c.dim} to create the config directory${c.reset}`);
				issues++;
			} else {
				console.log(`  ${OK} ${pointer.config_repo}/${pointer.config_path}/ exists`);
				taskplaneDirExists = true;
			}
		}

		// Check 4: .taskplane/ exists on config repo's default branch (not just current branch)
		if (configRepoRoot && taskplaneDirExists) {
			try {
				// Get current branch name
				const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
					cwd: configRepoRoot,
					stdio: ["pipe", "pipe", "pipe"],
					timeout: 5000,
				}).toString().trim();

				// Detect default branch (try origin/HEAD, fall back to main/master heuristic)
				let defaultBranch = null;
				try {
					const originHead = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
						cwd: configRepoRoot,
						stdio: ["pipe", "pipe", "pipe"],
						timeout: 5000,
					}).toString().trim();
					// refs/remotes/origin/main → main
					defaultBranch = originHead.replace(/^refs\/remotes\/origin\//, "");
				} catch {
					// origin/HEAD not set — try common default branch names
					for (const candidate of ["main", "master", "develop"]) {
						try {
							execFileSync("git", ["rev-parse", "--verify", `refs/heads/${candidate}`], {
								cwd: configRepoRoot,
								stdio: ["pipe", "pipe", "pipe"],
								timeout: 5000,
							});
							defaultBranch = candidate;
							break;
						} catch {
							// candidate doesn't exist, try next
						}
					}
				}

				if (defaultBranch && currentBranch !== defaultBranch) {
					// Check if .taskplane/ exists on the default branch via git ls-tree
					try {
						const lsOutput = execFileSync("git", ["ls-tree", "--name-only", defaultBranch, pointer.config_path + "/"], {
							cwd: configRepoRoot,
							stdio: ["pipe", "pipe", "pipe"],
							timeout: 5000,
						}).toString().trim();

						if (lsOutput) {
							console.log(`  ${OK} ${pointer.config_path}/ exists on default branch (${defaultBranch})`);
						} else {
							console.log(`  ${WARN} ${pointer.config_path}/ exists on current branch (${currentBranch}) but not on default branch (${defaultBranch})`);
							console.log(`     ${c.dim}→ Merge to ${defaultBranch} so teammates can onboard${c.reset}`);
						}
					} catch {
						// ls-tree failed — directory doesn't exist on that branch
						console.log(`  ${WARN} ${pointer.config_path}/ exists on current branch (${currentBranch}) but not on default branch (${defaultBranch})`);
						console.log(`     ${c.dim}→ Merge to ${defaultBranch} so teammates can onboard${c.reset}`);
					}
				} else if (defaultBranch && currentBranch === defaultBranch) {
					console.log(`  ${OK} ${pointer.config_path}/ on default branch (${defaultBranch})`);
				} else {
					// Could not determine default branch — skip this check silently
					console.log(`  ${INFO} could not determine default branch for ${pointer.config_repo} — skipping branch check`);
				}
			} catch {
				// git commands failed — skip branch check
			}
		}
	}

	// Step 1: Validate repo topology (workspace mode + valid config only)
	if (isWorkspaceMode && wsResult.config) {
		console.log();
		const repoIds = Object.keys(wsResult.config.repos).sort();
		for (const repoId of repoIds) {
			const repo = wsResult.config.repos[repoId];
			const resolvedPath = path.resolve(projectRoot, repo.path);

			// Check path exists on disk
			if (!fs.existsSync(resolvedPath)) {
				console.log(`  ${FAIL} repo: ${repoId} — path not found: ${resolvedPath} [WORKSPACE_REPO_PATH_NOT_FOUND]`);
				console.log(`     ${c.dim}→ Check repos.${repoId}.path in .pi/taskplane-workspace.yaml${c.reset}`);
				issues++;
				continue;
			}

			// Check path is a git repository
			try {
				execSync("git rev-parse --git-dir", {
					cwd: resolvedPath,
					stdio: ["pipe", "pipe", "pipe"],
					timeout: 5000,
				});
				console.log(`  ${OK} repo: ${repoId} ${c.dim}(${resolvedPath})${c.reset}`);
			} catch {
				console.log(`  ${FAIL} repo: ${repoId} — not a git repository: ${resolvedPath} [WORKSPACE_REPO_NOT_GIT]`);
				console.log(`     ${c.dim}→ Run: git init ${resolvedPath}${c.reset}`);
				console.log(`     ${c.dim}  or fix repos.${repoId}.path in .pi/taskplane-workspace.yaml${c.reset}`);
				issues++;
			}
		}
	}

	// Check project config (common — both modes)
	console.log();
	const hasUnifiedJson = fs.existsSync(path.join(configLocation.root, configLocation.prefix, "taskplane-config.json"));
	const configFiles = [
		{ path: "taskplane-config.json", required: false, hide: false },
		// YAML configs are legacy fallback — hide when taskplane-config.json exists
		{ path: "task-runner.yaml", required: !hasUnifiedJson, hide: hasUnifiedJson },
		{ path: "task-orchestrator.yaml", required: !hasUnifiedJson, hide: hasUnifiedJson },
		{ path: "agents/task-worker.md", required: true, hide: false },
		{ path: "agents/task-reviewer.md", required: true, hide: false },
		{ path: "agents/task-merger.md", required: true, hide: false },
		// supervisor.md is created by /orch; taskplane.json is created at runtime
		{ path: "agents/supervisor.md", required: false, hide: true },
		{ path: "taskplane.json", required: false, hide: true },
	];

	let missingRequiredConfigs = 0;
	for (const { path: relPath, required, hide } of configFiles) {
		const fullPath = path.join(configLocation.root, configLocation.prefix, relPath);
		const displayPath = `${configLocation.label}/${relPath}`;
		const exists = fs.existsSync(fullPath);
		if (exists) {
			console.log(`  ${OK} ${displayPath} exists`);
		} else if (required) {
			console.log(`  ${FAIL} ${displayPath} missing`);
			missingRequiredConfigs++;
			issues++;
		} else if (!hide) {
			// Show optional files only when they're relevant (not superseded)
			console.log(`  ${WARN} ${displayPath} missing ${c.dim}(optional)${c.reset}`);
		}
	}

	if (isWorkspaceMode && !wsResult.error) {
		const wsConfigPath = path.join(projectRoot, ".pi", "taskplane-workspace.yaml");
		if (fs.existsSync(wsConfigPath)) {
			console.log(`  ${OK} .pi/taskplane-workspace.yaml exists`);
		} else {
			console.log(`  ${FAIL} .pi/taskplane-workspace.yaml missing`);
			missingRequiredConfigs++;
			issues++;
		}
	}

	if (missingRequiredConfigs > 0) {
		console.log(`     ${c.dim}→ Run: taskplane init${c.reset}`);
	}

	// ── Legacy YAML config migration warning ────────────────────────────
	// Detect YAML config files without a JSON equivalent (taskplane-config.json).
	{
		const yamlRunnerPath = path.join(configLocation.root, configLocation.prefix, "task-runner.yaml");
		const yamlOrchestratorPath = path.join(configLocation.root, configLocation.prefix, "task-orchestrator.yaml");
		const jsonConfigPath = path.join(configLocation.root, configLocation.prefix, "taskplane-config.json");

		const hasYamlRunner = fs.existsSync(yamlRunnerPath);
		const hasYamlOrchestrator = fs.existsSync(yamlOrchestratorPath);
		const hasJsonConfig = fs.existsSync(jsonConfigPath);

		if ((hasYamlRunner || hasYamlOrchestrator) && !hasJsonConfig) {
			console.log(`  ${WARN} legacy YAML config detected in ${configLocation.label}`);
			console.log(`     ${c.dim}→ Run /taskplane-settings to migrate to taskplane-config.json${c.reset}`);
		}
	}

	// Check task areas from config
	const { paths: taskAreaPaths, contexts: taskAreaContexts, areaRepoIds } = discoverTaskAreaMetadata(projectRoot, configLocation.root, configLocation.prefix);
	if (taskAreaPaths.length > 0) {
		console.log();
		for (const areaPath of taskAreaPaths) {
			const exists = fs.existsSync(path.join(projectRoot, areaPath));
			if (exists) {
				console.log(`  ${OK} task area path: ${areaPath}`);
			} else {
				console.log(`  ${FAIL} task area path: ${areaPath} ${c.dim}(directory not found)${c.reset}`);
				console.log(`     ${c.dim}→ Run: mkdir -p ${areaPath}${c.reset}`);
				issues++;
			}
		}
		for (const ctxPath of taskAreaContexts) {
			const exists = fs.existsSync(path.join(projectRoot, ctxPath));
			if (exists) {
				console.log(`  ${OK} CONTEXT.md: ${ctxPath}`);
			} else {
				console.log(`  ${WARN} CONTEXT.md: ${ctxPath} ${c.dim}(not found)${c.reset}`);
			}
		}
	}

	// Validate area repo_id routing targets (workspace mode + valid config only)
	if (isWorkspaceMode && wsResult.config && Object.keys(areaRepoIds).length > 0) {
		const knownRepoIds = Object.keys(wsResult.config.repos).sort();
		const areaNames = Object.keys(areaRepoIds).sort();
		for (const areaName of areaNames) {
			const repoId = areaRepoIds[areaName];
			if (knownRepoIds.includes(repoId)) {
				console.log(`  ${OK} area '${areaName}' repo_id: ${repoId}`);
			} else {
				console.log(`  ${FAIL} area '${areaName}' repo_id '${repoId}' does not match any workspace repo [AREA_REPO_ID_UNKNOWN]`);
				console.log(`     ${c.dim}→ Available repos: ${knownRepoIds.join(", ")}. Fix repo_id in ${configLocation.label}/task-runner.yaml${c.reset}`);
				issues++;
			}
		}
	}

	// ── Gitignore and tracked artifact checks ───────────────────────────
	// In workspace mode, check the config repo's .gitignore (with .taskplane/ prefix).
	// In repo mode, check the project root's .gitignore directly.
	// Workspace root is NOT a git repo, so gitignore checks don't apply there.

	if (isWorkspaceMode && wsResult.config) {
		// Workspace mode: find config repo from pointer file
		const pointerPath = path.join(projectRoot, ".pi", "taskplane-pointer.json");
		let configRepoRoot = null;
		let configRepoName = null;
		try {
			const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf-8"));
			if (pointer.config_repo) {
				configRepoName = pointer.config_repo;
				configRepoRoot = path.resolve(projectRoot, pointer.config_repo);
			}
		} catch {
			// Pointer missing or invalid — skip gitignore checks (pointer validation is Step 2)
		}

		if (configRepoRoot && isInsideGitRepo(configRepoRoot)) {
			const prefix = ".taskplane/";
			console.log();

			// Check 1: Gitignore entries present in config repo
			const gitignorePath = path.join(configRepoRoot, ".gitignore");
			const gitignoreExists = fs.existsSync(gitignorePath);
			if (!gitignoreExists) {
				console.log(`  ${WARN} ${configRepoName}/.gitignore missing — Taskplane runtime entries not protected`);
				console.log(`     ${c.dim}→ Run ${c.cyan}taskplane init${c.dim} to add them, or add manually${c.reset}`);
				// WARN doesn't increment issues (it's advisory, not a failure)
			} else {
				const content = fs.readFileSync(gitignorePath, "utf-8");
				const existingLines = new Set(content.split(/\r?\n/).map(l => l.trim()));
				const allEntries = [...TASKPLANE_GITIGNORE_ENTRIES, ...TASKPLANE_GITIGNORE_NPM_ENTRIES];
				const missing = allEntries
					.map(entry => `${prefix}${entry}`)
					.filter(prefixed => !existingLines.has(prefixed));

				if (missing.length === 0) {
					console.log(`  ${OK} ${configRepoName}/.gitignore has all Taskplane runtime entries`);
				} else {
					console.log(`  ${WARN} ${configRepoName}/.gitignore missing ${missing.length} Taskplane runtime entr${missing.length === 1 ? "y" : "ies"}`);
					console.log(`     ${c.dim}→ Run ${c.cyan}taskplane init${c.dim} to add them, or add manually${c.reset}`);
				}
			}

			// Check 2: Tracked artifact detection in config repo
			const scanDirs = [`${prefix}.pi/`, `${prefix}.worktrees/`];
			try {
				const raw = execFileSync("git", ["ls-files", "--", ...scanDirs], {
					cwd: configRepoRoot,
					stdio: ["pipe", "pipe", "pipe"],
					timeout: 10000,
				}).toString().trim();
				const trackedFiles = raw ? raw.split(/\r?\n/) : [];

				if (trackedFiles.length > 0) {
					const prefixedPatterns = ALL_GITIGNORE_PATTERNS.map(p => `${prefix}${p}`);
					const patterns = prefixedPatterns.map(p => patternToRegex(p));
					const matchedFiles = trackedFiles.filter(file =>
						patterns.some(regex => regex.test(file))
					);

					if (matchedFiles.length > 0) {
						console.log(`  ${FAIL} ${matchedFiles.length} runtime artifact${matchedFiles.length === 1 ? "" : "s"} tracked by git in ${configRepoName}`);
						for (const file of matchedFiles) {
							console.log(`     ${c.dim}${file}${c.reset}`);
						}
						console.log(`     ${c.dim}→ Run: cd ${configRepoName} && git rm --cached ${matchedFiles.join(" ")}${c.reset}`);
						issues++;
					} else {
						console.log(`  ${OK} no runtime artifacts tracked by git in ${configRepoName}`);
					}
				} else {
					console.log(`  ${OK} no runtime artifacts tracked by git in ${configRepoName}`);
				}
			} catch {
				// git ls-files failed — skip silently (repo validation already covers git issues)
			}
		}
	} else if (!isWorkspaceMode && isInsideGitRepo(projectRoot)) {
		// Repo mode: check project root .gitignore and tracked artifacts
		console.log();

		// Check 1: Gitignore entries present
		const gitignorePath = path.join(projectRoot, ".gitignore");
		const gitignoreExists = fs.existsSync(gitignorePath);
		if (!gitignoreExists) {
			console.log(`  ${WARN} .gitignore missing — Taskplane runtime entries not protected`);
			console.log(`     ${c.dim}→ Run ${c.cyan}taskplane init${c.dim} to add them, or add manually${c.reset}`);
		} else {
			const content = fs.readFileSync(gitignorePath, "utf-8");
			const existingLines = new Set(content.split(/\r?\n/).map(l => l.trim()));
			const allEntries = [...TASKPLANE_GITIGNORE_ENTRIES, ...TASKPLANE_GITIGNORE_NPM_ENTRIES];
			const missing = allEntries.filter(entry => !existingLines.has(entry));

			if (missing.length === 0) {
				console.log(`  ${OK} .gitignore has all Taskplane runtime entries`);
			} else {
				console.log(`  ${WARN} .gitignore missing ${missing.length} Taskplane runtime entr${missing.length === 1 ? "y" : "ies"}`);
				console.log(`     ${c.dim}→ Run ${c.cyan}taskplane init${c.dim} to add them, or add manually${c.reset}`);
			}
		}

		// Check 2: Tracked artifact detection
		const scanDirs = [".pi/", ".worktrees/"];
		try {
			const raw = execFileSync("git", ["ls-files", "--", ...scanDirs], {
				cwd: projectRoot,
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 10000,
			}).toString().trim();
			const trackedFiles = raw ? raw.split(/\r?\n/) : [];

			if (trackedFiles.length > 0) {
				const patterns = ALL_GITIGNORE_PATTERNS.map(p => patternToRegex(p));
				const matchedFiles = trackedFiles.filter(file =>
					patterns.some(regex => regex.test(file))
				);

				if (matchedFiles.length > 0) {
					console.log(`  ${FAIL} ${matchedFiles.length} runtime artifact${matchedFiles.length === 1 ? "" : "s"} tracked by git`);
					for (const file of matchedFiles) {
						console.log(`     ${c.dim}${file}${c.reset}`);
					}
					console.log(`     ${c.dim}→ Run: git rm --cached ${matchedFiles.join(" ")}${c.reset}`);
					issues++;
				} else {
					console.log(`  ${OK} no runtime artifacts tracked by git`);
				}
			} else {
				console.log(`  ${OK} no runtime artifacts tracked by git`);
			}
		} catch {
			// git ls-files failed — skip silently
		}
	}

	console.log();
	if (issues === 0) {
		console.log(`${OK} ${c.green}All checks passed!${c.reset}\n`);
	} else {
		console.log(`${FAIL} ${issues} issue(s) found. Run ${c.cyan}taskplane init${c.reset} to fix config issues.\n`);
		process.exit(1);
	}
}

// ─── version ────────────────────────────────────────────────────────────────

function cmdVersion() {
	const pkgVersion = getPackageVersion();
	const isProjectLocal = PACKAGE_ROOT.includes(".pi");
	const installType = isProjectLocal ? `project-local: ${PACKAGE_ROOT}` : `global: ${PACKAGE_ROOT}`;

	console.log(`\ntaskplane ${c.bold}v${pkgVersion}${c.reset}`);
	console.log(`  Package:  ${installType}`);

	// Check for project config
	const projectRoot = process.cwd();
	const tpJson = path.join(projectRoot, ".pi", "taskplane.json");
	if (fs.existsSync(tpJson)) {
		try {
			const info = JSON.parse(fs.readFileSync(tpJson, "utf-8"));
			console.log(`  Config:   .pi/taskplane.json (v${info.version}, initialized ${info.installedAt?.slice(0, 10) || "unknown"})`);
		} catch {
			console.log(`  Config:   .pi/taskplane.json (unreadable)`);
		}
	} else {
		console.log(`  Config:   ${c.dim}not initialized (run taskplane init)${c.reset}`);
	}

	// Pi version
	const piVersion = getVersion("pi");
	if (piVersion) console.log(`  Pi:       ${piVersion}`);

	// Node version
	console.log(`  Node:     v${process.versions.node}`);
	console.log();
}

function getPackageVersion() {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf-8"));
		return pkg.version || "unknown";
	} catch {
		return "unknown";
	}
}

// ─── dashboard ──────────────────────────────────────────────────────────────

function cmdDashboard(args) {
	const projectRoot = process.cwd();

	if (!fs.existsSync(DASHBOARD_SERVER)) {
		die(`Dashboard server not found at ${DASHBOARD_SERVER}`);
	}

	// Pass through args to server.cjs, adding --root
	const serverArgs = ["--root", projectRoot];

	// Forward --port and --no-open if provided
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--port" && args[i + 1]) {
			serverArgs.push("--port", args[i + 1]);
			i++;
		} else if (args[i] === "--no-open") {
			serverArgs.push("--no-open");
		}
	}

	console.log(`\n${c.bold}Taskplane Dashboard${c.reset}`);
	console.log(`  Project: ${projectRoot}`);
	console.log(`  Server:  ${DASHBOARD_SERVER}\n`);

	const child = spawn("node", [DASHBOARD_SERVER, ...serverArgs], {
		stdio: "inherit",
		cwd: projectRoot,
	});

	child.on("error", (err) => {
		die(`Failed to start dashboard: ${err.message}`);
	});

	// Forward signals
	process.on("SIGINT", () => child.kill("SIGINT"));
	process.on("SIGTERM", () => child.kill("SIGTERM"));

	child.on("exit", (code) => {
		process.exit(code ?? 0);
	});
}

// ─── help ───────────────────────────────────────────────────────────────────

function showHelp() {
	const version = getPackageVersion();
	console.log(`
${c.bold}taskplane${c.reset} v${version} — AI agent orchestration for pi

${c.bold}Usage:${c.reset}
  taskplane <command> [options]

${c.bold}Commands:${c.reset}
  ${c.cyan}init${c.reset}           Scaffold Taskplane config in the current project
  ${c.cyan}doctor${c.reset}         Validate installation and project configuration
  ${c.cyan}version${c.reset}        Show version information
  ${c.cyan}dashboard${c.reset}      Launch the web-based orchestrator dashboard
  ${c.cyan}uninstall${c.reset}      Remove Taskplane project files and/or package install
  ${c.cyan}help${c.reset}           Show this help message

${c.bold}Init options:${c.reset}
  --preset <name>       Use a preset: minimal, full, runner-only
  --tasks-root <path>   Relative tasks directory to use (e.g. docs/task-management)
  --no-examples         Skip example tasks scaffolding
  --include-examples    With --tasks-root, include example tasks (default is skip)
  --force               Overwrite existing files without prompting
  --dry-run             Show what would be created without writing

${c.bold}Dashboard options:${c.reset}
  --port <number>   Port to listen on (default: 8099)
  --no-open         Don't auto-open browser

${c.bold}Uninstall options:${c.reset}
  --dry-run         Show what would be removed
  --yes, -y         Skip confirmation prompts
  --package         Also remove installed package via pi remove
  --package-only    Only remove installed package (skip project cleanup)
  --local           Force package uninstall from project-local scope
  --global          Force package uninstall from global scope
  --remove-tasks    Also remove task area directories from task-runner.yaml
  --all             Equivalent to --package + --remove-tasks

${c.bold}Examples:${c.reset}
  taskplane init                        # Interactive project setup
  taskplane init --preset full          # Quick setup with defaults
  taskplane init --preset full --tasks-root docs/task-management
                                        # Use existing task area path
  taskplane init --dry-run              # Preview what would be created
  taskplane doctor                      # Check installation health
  taskplane dashboard                   # Launch web dashboard
  taskplane dashboard --port 3000       # Dashboard on custom port
  taskplane uninstall --dry-run         # Preview uninstall actions
  taskplane uninstall --package --yes   # Remove project files + package install

${c.bold}Getting started:${c.reset}
  1. pi install npm:taskplane       # Install the pi package
  2. cd my-project && taskplane init    # Scaffold project config
  3. pi                             # Start pi — /task and /orch are ready
`);
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

const [command, ...args] = process.argv.slice(2);

switch (command) {
	case "init":
		await cmdInit(args);
		break;
	case "doctor":
		cmdDoctor();
		break;
	case "version":
	case "--version":
	case "-v":
		cmdVersion();
		break;
	case "dashboard":
		cmdDashboard(args);
		break;
	case "uninstall":
		await cmdUninstall(args);
		break;
	case "help":
	case "--help":
	case "-h":
	case undefined:
		showHelp();
		break;
	default:
		console.error(`${FAIL} Unknown command: ${command}`);
		showHelp();
		process.exit(1);
}
