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
import { execSync, spawn } from "node:child_process";

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
  spawn_mode: "subprocess"
  tmux_prefix: "${vars.tmux_prefix}"

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

function discoverTaskAreaMetadata(projectRoot) {
	const runnerPath = path.join(projectRoot, ".pi", "task-runner.yaml");
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

	// Check for existing config
	const hasConfig =
		fs.existsSync(path.join(projectRoot, ".pi", "task-runner.yaml")) ||
		fs.existsSync(path.join(projectRoot, ".pi", "task-orchestrator.yaml"));

	if (hasConfig && !force) {
		console.log(`${WARN} Taskplane config already exists in this project.`);
		const proceed = await confirm("  Overwrite existing files?", false);
		if (!proceed) {
			console.log("  Aborted.");
			return;
		}
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

	const exampleTemplateDirs = noExamples ? [] : listExampleTaskTemplates();

	if (dryRun) {
		console.log(`\n${c.bold}Dry run — files that would be created:${c.reset}\n`);
		printFileList(vars, noExamples, preset, exampleTemplateDirs);
		return;
	}

	// Scaffold files
	console.log(`\n${c.bold}Creating files...${c.reset}\n`);
	const skipIfExists = !force;

	// Agent prompts
	for (const agent of ["task-worker.md", "task-reviewer.md", "task-merger.md"]) {
		copyTemplate(
			path.join(TEMPLATES_DIR, "agents", agent),
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

	// Auto-commit task files to git so they're available in worktrees
	await autoCommitTaskFiles(projectRoot, vars.tasks_root);

	// Report
	console.log(`\n${OK} ${c.bold}Taskplane initialized!${c.reset}\n`);
	console.log(`${c.bold}Quick start:${c.reset}`);
	console.log(`  ${c.cyan}pi${c.reset}                                             # start pi (taskplane auto-loads)`);
	if (preset !== "runner-only") {
		console.log(`  ${c.cyan}/orch-plan all${c.reset}                                   # preview waves/lanes/dependencies`);
		console.log(`  ${c.cyan}/orch all${c.reset}                                        # run examples via orchestrator`);
	}
	if (!noExamples && exampleTemplateDirs.length > 0) {
		const firstExample = exampleTemplateDirs[0];
		console.log(`  ${c.dim}optional single-task mode:${c.reset}`);
		console.log(`  ${c.cyan}/task ${vars.tasks_root}/${firstExample}/PROMPT.md${c.reset}`);
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
		tmux_prefix: `${slug}-orch`,
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
		tmux_prefix: `${slug}-orch`,
		tasks_root,
		default_area,
		default_prefix,
		test_cmd,
		build_cmd,
		date: today(),
	};
}

function printFileList(vars, noExamples, preset, exampleTemplateDirs = []) {
	const files = [
		".pi/agents/task-worker.md",
		".pi/agents/task-reviewer.md",
		".pi/agents/task-merger.md",
		".pi/task-runner.yaml",
	];
	if (preset !== "runner-only") files.push(".pi/task-orchestrator.yaml");
	files.push(".pi/taskplane.json");
	files.push(`${vars.tasks_root}/CONTEXT.md`);
	if (!noExamples) {
		for (const exampleName of exampleTemplateDirs) {
			files.push(`${vars.tasks_root}/${exampleName}/PROMPT.md`);
			files.push(`${vars.tasks_root}/${exampleName}/STATUS.md`);
		}
	}
	for (const f of files) console.log(`  ${c.green}create${c.reset} ${f}`);
	console.log();
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

// ─── install-tmux ───────────────────────────────────────────────────────────

/**
 * Install or upgrade tmux for Git Bash on Windows.
 *
 * Downloads tmux and libevent packages from the official MSYS2 package
 * repository, extracts the required binaries, and places them in ~/bin/.
 *
 * Requirements:
 * - Windows with Git Bash (provides tar and msys-2.0.dll runtime)
 * - Node.js >= 21.7 (native zstd decompression)
 *
 * The install target is ~/bin/ because:
 * - It's user-writable (no admin rights needed)
 * - Git Bash includes it in PATH by default
 * - It doesn't conflict with Git's own /usr/bin/
 */

const TMUX_PACKAGES = [
	{
		name: "tmux",
		url: "https://mirror.msys2.org/msys/x86_64/tmux-3.6.a-1-x86_64.pkg.tar.zst",
		version: "3.6a",
		files: ["usr/bin/tmux.exe"],
	},
	{
		name: "libevent",
		url: "https://mirror.msys2.org/msys/x86_64/libevent-2.1.12-4-x86_64.pkg.tar.zst",
		version: "2.1.12",
		files: ["usr/bin/msys-event-2-1-7.dll", "usr/bin/msys-event_core-2-1-7.dll"],
	},
];

const TMUX_INSTALL_DIR_NAME = "bin";

function getTmuxInstallDir() {
	return path.join(process.env.HOME || process.env.USERPROFILE || "", TMUX_INSTALL_DIR_NAME);
}

function detectCurrentTmux() {
	try {
		const out = execSync("tmux -V", { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
		const match = out.match(/tmux\s+([\d.]+\w*)/);
		const version = match ? match[1] : "unknown";

		// Find where tmux lives
		let location = "";
		try {
			location = execSync("which tmux", { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"], shell: "C:/Program Files/Git/bin/bash.exe" }).trim();
		} catch { /* ignore */ }

		return { installed: true, version, location };
	} catch {
		return { installed: false, version: null, location: null };
	}
}

async function httpFollowRedirects(url) {
	const https = await import("node:https");
	const http = await import("node:http");

	return new Promise((resolve, reject) => {
		const mod = url.startsWith("https") ? https.default : http.default;
		mod.get(url, { headers: { "User-Agent": "taskplane" } }, (res) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				return httpFollowRedirects(res.headers.location).then(resolve, reject);
			}
			if (res.statusCode !== 200) {
				return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
			}
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => resolve(Buffer.concat(chunks)));
			res.on("error", reject);
		}).on("error", reject);
	});
}

function toPosixPath(p) {
	return p.replace(/\\/g, "/").replace(/^([A-Z]):/i, (_m, d) => "/" + d.toLowerCase());
}

async function cmdInstallTmux(args) {
	const checkOnly = args.includes("--check");
	const force = args.includes("--force");

	console.log(`\n${c.bold}Taskplane — tmux installer${c.reset}\n`);

	// ── Platform check ───────────────────────────────────────────
	if (process.platform !== "win32") {
		console.log(`  ${INFO} This command is for Windows only.`);
		console.log(`      On macOS: ${c.cyan}brew install tmux${c.reset}`);
		console.log(`      On Linux: ${c.cyan}sudo apt install tmux${c.reset} (or your distro's package manager)\n`);
		return;
	}

	// ── Node.js version check (need >= 21.7 for zstd) ───────────
	const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
	if (nodeMajor < 21 || (nodeMajor === 21 && nodeMinor < 7)) {
		die(`Node.js >= 21.7 required for zstd decompression (found ${process.versions.node}).\n      Upgrade Node.js: https://nodejs.org/`);
	}

	// ── Git Bash check ───────────────────────────────────────────
	const gitBashBin = "C:/Program Files/Git/bin/bash.exe";
	if (!fs.existsSync(gitBashBin)) {
		die(`Git Bash not found at ${gitBashBin}.\n      Install Git for Windows: https://git-scm.com/downloads`);
	}

	// ── MSYS2 runtime check ──────────────────────────────────────
	const msysDll = "C:/Program Files/Git/usr/bin/msys-2.0.dll";
	if (!fs.existsSync(msysDll)) {
		die(`MSYS2 runtime (msys-2.0.dll) not found.\n      This should ship with Git for Windows. Reinstall Git if missing.`);
	}

	// ── Current tmux status ──────────────────────────────────────
	const current = detectCurrentTmux();
	if (current.installed) {
		console.log(`  ${OK} tmux ${c.bold}${current.version}${c.reset} found`);
		if (current.location) {
			console.log(`      Location: ${c.dim}${current.location}${c.reset}`);
		}
	} else {
		console.log(`  ${FAIL} tmux not found`);
	}

	const targetVersion = TMUX_PACKAGES[0].version;
	console.log(`  ${INFO} Available version: ${c.bold}${targetVersion}${c.reset} (MSYS2 package)\n`);

	if (checkOnly) return;

	// ── Skip if already up to date ───────────────────────────────
	if (current.installed && current.version === targetVersion && !force) {
		console.log(`  ${OK} Already up to date. Use ${c.cyan}--force${c.reset} to reinstall.\n`);
		return;
	}

	// ── Download and extract ─────────────────────────────────────
	const zlib = await import("node:zlib");
	const os = await import("node:os");
	const tmpDir = os.default.tmpdir();
	const extractDir = path.join(tmpDir, "taskplane-tmux-install");

	// Clean previous extract
	fs.rmSync(extractDir, { recursive: true, force: true });
	fs.mkdirSync(extractDir, { recursive: true });

	for (const pkg of TMUX_PACKAGES) {
		process.stdout.write(`  ⏳ Downloading ${pkg.name} (v${pkg.version})...`);
		let buf;
		try {
			buf = await httpFollowRedirects(pkg.url);
		} catch (err) {
			console.log(` ${c.red}failed${c.reset}`);
			die(`Download failed: ${err.message}\n      URL: ${pkg.url}`);
		}
		console.log(` ${c.green}${Math.round(buf.length / 1024)}KB${c.reset}`);

		// Decompress zstd → tar
		let tar;
		try {
			tar = zlib.default.zstdDecompressSync(buf);
		} catch (err) {
			die(`zstd decompression failed for ${pkg.name}: ${err.message}`);
		}
		const tarPath = path.join(tmpDir, `${pkg.name}.pkg.tar`);
		fs.writeFileSync(tarPath, tar);

		// Extract needed files
		const posixTar = toPosixPath(tarPath);
		const posixExtract = toPosixPath(extractDir);
		for (const f of pkg.files) {
			try {
				execSync(`tar xf "${posixTar}" -C "${posixExtract}" ${f}`, {
					shell: gitBashBin,
					timeout: 10000,
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch (err) {
				die(`Failed to extract ${f} from ${pkg.name}: ${err.message}`);
			}
		}

		// Clean up tar
		try { fs.unlinkSync(tarPath); } catch { /* best effort */ }
	}

	// ── Install to ~/bin/ ────────────────────────────────────────
	const installDir = getTmuxInstallDir();
	fs.mkdirSync(installDir, { recursive: true });

	const extractBinDir = path.join(extractDir, "usr", "bin");
	const installedFiles = [];
	const lockedFiles = [];
	for (const f of fs.readdirSync(extractBinDir)) {
		const src = path.join(extractBinDir, f);
		const dest = path.join(installDir, f);
		try {
			fs.copyFileSync(src, dest);
			installedFiles.push(f);
		} catch (err) {
			if (err.code === "EBUSY" || err.code === "EPERM") {
				// File is locked (e.g., DLL in use by running tmux session).
				// Try rename-then-copy: rename old file, copy new, delete old.
				const backup = dest + ".old";
				try {
					if (fs.existsSync(backup)) fs.unlinkSync(backup);
					fs.renameSync(dest, backup);
					fs.copyFileSync(src, dest);
					try { fs.unlinkSync(backup); } catch { /* clean up later */ }
					installedFiles.push(f);
				} catch {
					lockedFiles.push(f);
				}
			} else {
				throw err;
			}
		}
	}

	// Clean up extract dir
	fs.rmSync(extractDir, { recursive: true, force: true });

	// ── Verify ───────────────────────────────────────────────────
	console.log("");
	if (lockedFiles.length > 0) {
		console.log(`  ${WARN} Some files are locked (tmux may be running): ${lockedFiles.join(", ")}`);
		console.log(`      Close all tmux sessions and re-run ${c.cyan}taskplane install-tmux --force${c.reset}`);
		if (installedFiles.length > 0) {
			console.log(`      Updated: ${installedFiles.join(", ")}`);
		}
	} else {
		const verify = detectCurrentTmux();
		if (verify.installed) {
			console.log(`  ${OK} tmux ${c.bold}${verify.version}${c.reset} installed successfully`);
			console.log(`      Location: ${c.dim}${installDir}${c.reset}`);
			console.log(`      Files: ${installedFiles.join(", ")}`);
		} else {
			console.log(`  ${WARN} Files installed to ${installDir} but tmux not found on PATH.`);
			console.log(`      Ensure ${c.cyan}~/bin${c.reset} is in your PATH. In Git Bash, add to ~/.bashrc:`);
			console.log(`      ${c.dim}export PATH="$HOME/bin:$PATH"${c.reset}`);
		}
	}
	console.log("");
}

// ─── doctor ─────────────────────────────────────────────────────────────────

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

	// Check tmux (optional)
	const hasTmux = commandExists("tmux");
	console.log(
		`  ${hasTmux ? OK : `${WARN}`} tmux installed${hasTmux ? ` ${c.dim}(${getVersion("tmux", "-V")})${c.reset}` : ` ${c.dim}(optional — needed for spawn_mode: tmux)${c.reset}`}`
	);
	if (!hasTmux && process.platform === "win32") {
		console.log(`      ${c.dim}→ Run ${c.cyan}taskplane install-tmux${c.dim} to install${c.reset}`);
	}

	// Check package installation
	const pkgJson = path.join(PACKAGE_ROOT, "package.json");
	const pkgVersion = getPackageVersion();
	const isProjectLocal = PACKAGE_ROOT.includes(".pi");
	const installType = isProjectLocal ? "project-local" : "global";
	console.log(`  ${OK} taskplane package installed ${c.dim}(v${pkgVersion}, ${installType})${c.reset}`);

	// Detect workspace mode
	const wsResult = loadWorkspaceConfigForDoctor(projectRoot);
	const isWorkspaceMode = wsResult.mode === "workspace";

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
	const configFiles = [
		{ path: ".pi/task-runner.yaml", required: true },
		{ path: ".pi/task-orchestrator.yaml", required: true },
		{ path: ".pi/agents/task-worker.md", required: true },
		{ path: ".pi/agents/task-reviewer.md", required: true },
		{ path: ".pi/agents/task-merger.md", required: true },
		{ path: ".pi/taskplane.json", required: false },
	];

	// In workspace mode, include workspace config in the config files check
	if (isWorkspaceMode && !wsResult.error) {
		configFiles.push({ path: ".pi/taskplane-workspace.yaml", required: true });
	}

	let missingRequiredConfigs = 0;
	for (const { path: relPath, required } of configFiles) {
		const exists = fs.existsSync(path.join(projectRoot, relPath));
		if (exists) {
			console.log(`  ${OK} ${relPath} exists`);
		} else if (required) {
			console.log(`  ${FAIL} ${relPath} missing`);
			missingRequiredConfigs++;
			issues++;
		} else {
			console.log(`  ${WARN} ${relPath} missing ${c.dim}(optional)${c.reset}`);
		}
	}
	if (missingRequiredConfigs > 0) {
		console.log(`     ${c.dim}→ Run: taskplane init${c.reset}`);
	}

	// Check task areas from config
	const { paths: taskAreaPaths, contexts: taskAreaContexts, areaRepoIds } = discoverTaskAreaMetadata(projectRoot);
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
				console.log(`     ${c.dim}→ Available repos: ${knownRepoIds.join(", ")}. Fix repo_id in .pi/task-runner.yaml${c.reset}`);
				issues++;
			}
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
  ${c.cyan}install-tmux${c.reset}   Install or upgrade tmux for Git Bash (Windows)
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

${c.bold}Install-tmux options:${c.reset}
  --check             Check tmux status without installing
  --force             Reinstall even if tmux is already present

${c.bold}Examples:${c.reset}
  taskplane install-tmux                # Install or upgrade tmux
  taskplane install-tmux --check        # Check tmux status only
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
	case "install-tmux":
		await cmdInstallTmux(args);
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
