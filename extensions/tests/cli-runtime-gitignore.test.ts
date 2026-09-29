import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../bin/taskplane.mjs", import.meta.url));
const RUNTIME_FILES = [
	".pi/bridge-outbox/batch/worker/message.json",
	".pi/context-snapshots/batch/worker/context.json",
	".pi/diagnostics/batch/task.json",
	".pi/mailbox/batch/worker/inbox/message.json",
	".pi/runtime/batch/agents/worker/manifest.json",
	".pi/supervisor/events.jsonl",
	".pi/telemetry/batch/events.jsonl",
	".pi/verification/operator/transaction.json",
];
const PROJECT_FILES = [
	".pi/agents/task-worker.md",
	".pi/taskplane-config.json",
	".pi/taskplane.json",
];

describe("CLI runtime artifact gitignore coverage (#611)", () => {
	let root: string;

	function git(args: string[], input?: string): string {
		return execFileSync("git", args, { cwd: root, encoding: "utf-8", input }).trim();
	}

	function cli(args: string[]) {
		const result = spawnSync(process.execPath, [CLI, ...args], {
			cwd: root,
			encoding: "utf-8",
			env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent-config") },
			timeout: 25000,
		});
		assert.ifError(result.error);
		assert.notEqual(result.status, null, result.stderr);
		return result;
	}

	function init(): void {
		const result = cli(["init", "--preset", "full", "--no-examples"]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "taskplane-gitignore-"));
		git(["init", "--quiet"]);
		init();
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("init protects nested runtime files while leaving project configuration trackable", () => {
		const ignored = git(["check-ignore", "--stdin"], [...RUNTIME_FILES, ...PROJECT_FILES].join("\n"));
		assert.deepEqual(ignored.split(/\r?\n/).sort(), [...RUNTIME_FILES].sort());
	});

	it("doctor reports missing runtime directories until every entry is present", () => {
		const ignorePath = join(root, ".gitignore");
		const runtimeDirs = new Set(
			RUNTIME_FILES.map((file) => file.split("/").slice(0, 2).join("/") + "/"),
		);
		const oldEntries = readFileSync(ignorePath, "utf-8")
			.split(/\r?\n/)
			.filter((line) => !runtimeDirs.has(line.trim()))
			.join("\n");
		writeFileSync(ignorePath, `${oldEntries}\ncustom-build/\n`);
		const missing = cli(["doctor"]).stdout;
		assert.match(missing, /\.gitignore missing 8 Taskplane runtime entries/);
		assert.doesNotMatch(missing, /\.gitignore has all Taskplane runtime entries/);

		writeFileSync(ignorePath, readFileSync(ignorePath, "utf-8") + ".pi/runtime/\n");
		assert.match(cli(["doctor"]).stdout, /\.gitignore missing 7 Taskplane runtime entries/);

		writeFileSync(ignorePath, `${oldEntries}\n${[...runtimeDirs].join("\n")}\n`);
		assert.match(cli(["doctor"]).stdout, /\.gitignore has all Taskplane runtime entries/);
	});

	it("doctor detects already-tracked runtime files without flagging project configuration", () => {
		for (const file of [...RUNTIME_FILES, ...PROJECT_FILES]) {
			const path = join(root, file);
			mkdirSync(dirname(path), { recursive: true });
			if (RUNTIME_FILES.includes(file)) writeFileSync(path, "{}\n");
		}
		git(["add", "--force", "--", ...RUNTIME_FILES, ...PROJECT_FILES]);
		const output = cli(["doctor"]).stdout;
		assert.match(output, /8 runtime artifacts tracked by git/);
		const untrackHint = output.split("\n").find((line) => line.includes("git rm --cached"));
		assert.ok(untrackHint);
		for (const file of RUNTIME_FILES) assert.ok(untrackHint.includes(file), file);
		for (const file of PROJECT_FILES) assert.ok(!untrackHint.includes(file), file);
	});
});
