import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { AgentHostOptions } from "../taskplane/agent-host.ts";
import { runtimeAgentDir } from "../taskplane/types.ts";

let cliPath: string;
const resolver = await import("../taskplane/path-resolver.ts");
mock.module("../taskplane/path-resolver.ts", {
	namedExports: { ...resolver, resolvePiCliPath: () => cliPath },
});
const { spawnAgent } = await import("../taskplane/agent-host.ts");

// A real Node child uses Pi's text-or-file argument contract, then completes
// one RPC turn. No child_process mock or model credentials are involved.
const CHILD = `
const fs = require("node:fs");
const crypto = require("node:crypto");
const readline = require("node:readline");
const args = process.argv.slice(2);
const index = args.indexOf("--system-prompt");
const argument = index >= 0 ? args[index + 1] : null;
const fromFile = argument !== null && fs.existsSync(argument);
const content = fromFile ? fs.readFileSync(argument, "utf8") : argument;
fs.writeFileSync(process.env.PROMPT_CAPTURE, JSON.stringify({
  argument, fromFile, args,
  digest: content === null ? null : crypto.createHash("sha256").update(content).digest("hex"),
  mode: fromFile ? fs.statSync(argument).mode & 0o777 : null,
}));
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (JSON.parse(line).type === "prompt") {
    process.stdout.write(JSON.stringify({ type: "agent_end" }) + "\\n");
  }
});
input.on("close", () => { process.exitCode = Number(process.env.PROMPT_EXIT_CODE || 0); });
`;

interface Capture {
	argument: string | null;
	fromFile: boolean;
	args: string[];
	digest: string | null;
	mode: number | null;
}

describe("agent-host system prompt transport (#612)", () => {
	let root: string;
	let originalTmpdir: string | undefined;
	let opts: AgentHostOptions;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "tp system-prompt-"));
		originalTmpdir = process.env.TMPDIR;
		process.env.TMPDIR = root;
		cliPath = join(root, "fake-pi.cjs");
		writeFileSync(cliPath, CHILD);
		const cwd = join(root, "worktree");
		mkdirSync(cwd);
		opts = {
			agentId: "orch-test-lane-1-worker",
			role: "worker",
			batchId: "prompt-file-test",
			laneNumber: 1,
			taskId: "TP-612",
			repoId: "default",
			cwd,
			prompt: "Run one fixture turn",
			stateRoot: root,
			closeDelayMs: 0,
			timeoutMs: 5000,
			env: { PROMPT_CAPTURE: join(root, "capture.json") },
		};
	});

	afterEach(() => {
		if (originalTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpdir;
		rmSync(root, { recursive: true, force: true });
	});

	function capture(path = opts.env!.PROMPT_CAPTURE): Capture {
		return JSON.parse(readFileSync(path, "utf-8"));
	}

	function assertPrompt(actual: Capture, prompt: string): void {
		assert.equal(actual.fromFile, true, "the child must receive a prompt file, not inline text");
		assert.ok(actual.argument);
		assert.ok(isAbsolute(actual.argument), "the child's worktree differs from the state root");
		assert.equal(actual.digest, createHash("sha256").update(prompt).digest("hex"));
		assert.ok(actual.args.join(" ").length < 32767);
		assert.equal(actual.args.includes("--append-system-prompt"), false);
		if (process.platform !== "win32") assert.equal(actual.mode, 0o600);
	}

	for (const role of ["worker", "reviewer", "merger"] as const) {
		it(`passes a 60K ${role} prompt through a private file and removes it after success`, async () => {
			opts.role = role;
			opts.agentId = `orch-test-${role}`;
			opts.systemPrompt = 'Project rules: "quotes", 中文, backslash \\\n'.repeat(1800);
			const result = await spawnAgent(opts).promise;
			assert.equal(result.exitCode, 0, result.error ?? result.stderrTail);
			assert.equal(result.agentEnded, true);
			const actual = capture();
			assertPrompt(actual, opts.systemPrompt);
			assert.ok(actual.argument!.startsWith(runtimeAgentDir(root, opts.batchId, opts.agentId)));
			assert.equal(existsSync(dirname(actual.argument!)), false);
		});
	}

	it("spawns with a 256 KiB prompt without registry integration", async () => {
		opts.stateRoot = null;
		opts.systemPrompt = "x".repeat(256 * 1024);
		const result = await spawnAgent(opts).promise;
		assert.equal(result.exitCode, 0, result.error ?? result.stderrTail);
		const actual = capture();
		assertPrompt(actual, opts.systemPrompt);
		assert.equal(existsSync(dirname(actual.argument!)), false);
	});

	for (const systemPrompt of [undefined, ""]) {
		it(`preserves Pi's default prompt for ${systemPrompt === undefined ? "omitted" : "empty"} overrides`, async () => {
			opts.systemPrompt = systemPrompt;
			const result = await spawnAgent(opts).promise;
			assert.equal(result.exitCode, 0, result.error ?? result.stderrTail);
			assert.equal(capture().argument, null);
		});
	}

	it("isolates overlapping spawns that reuse an agent identity", async () => {
		const second = {
			...opts,
			systemPrompt: "second prompt",
			env: { PROMPT_CAPTURE: join(root, "second.json") },
		};
		opts.systemPrompt = "first prompt";
		const results = await Promise.all([spawnAgent(opts).promise, spawnAgent(second).promise]);
		for (const result of results) assert.equal(result.exitCode, 0, result.error ?? result.stderrTail);
		const firstCapture = capture();
		const secondCapture = capture(second.env.PROMPT_CAPTURE);
		assertPrompt(firstCapture, opts.systemPrompt);
		assertPrompt(secondCapture, second.systemPrompt);
		assert.notEqual(firstCapture.argument, secondCapture.argument);
	});

	it("retains the prompt file when the child exits with an error", async () => {
		opts.systemPrompt = "retain this diagnostic prompt";
		opts.env!.PROMPT_EXIT_CODE = "7";
		const result = await spawnAgent(opts).promise;
		assert.equal(result.exitCode, 7);
		const actual = capture();
		assertPrompt(actual, opts.systemPrompt);
		assert.equal(readFileSync(actual.argument!, "utf-8"), opts.systemPrompt);
	});
});
