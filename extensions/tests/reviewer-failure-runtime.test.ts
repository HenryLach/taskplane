import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { advanceReviewStreak, freshReviewStreakState } from "../taskplane/review-analysis.ts";

interface Attempt {
	code: number | null;
	signal?: string;
	stderr?: string;
	output?: string;
	error?: string;
	hang?: boolean;
	throwOnSpawn?: boolean;
	rpc?: object[];
}

const realChildProcess = await import("node:child_process");
const attempts: Attempt[] = [];
const outputPaths: string[] = [];
let killCalls = 0;
const launchArgs: string[][] = [];
const reviewerStates: object[] = [];
mock.module("child_process", {
	namedExports: {
		...realChildProcess,
		spawn: (_cmd: string, args: string[]) => {
			launchArgs.push(args);
			const attempt = attempts.shift();
			assert.ok(attempt, "unexpected reviewer spawn");
			if (attempt.throwOnSpawn) throw new Error("synchronous launch failure");
			const proc = Object.assign(new EventEmitter(), {
				stdin: new PassThrough(),
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				kill: (signal: string) => {
					killCalls++;
					queueMicrotask(() => proc.emit("close", null, signal));
					return true;
				},
			});
			proc.stdin.on("data", (data) => {
				const message = JSON.parse(data.toString());
				if (message.type !== "prompt") return;
				const outputPath = message.message.match(/Write your review to: `([^`]+)`/)?.[1];
				assert.ok(outputPath);
				outputPaths.push(outputPath);
				queueMicrotask(() => {
					if (attempt.stderr) proc.stderr.write(attempt.stderr);
					for (const event of attempt.rpc ?? []) proc.stdout.write(JSON.stringify(event) + "\n");
					if (attempt.rpc)
						reviewerStates.push(
							JSON.parse(readFileSync(process.env.TASKPLANE_REVIEWER_STATE_PATH!, "utf-8")),
						);
					if (attempt.output !== undefined) writeFileSync(outputPath, attempt.output);
					if (attempt.error) proc.emit("error", new Error(attempt.error));
					else if (!attempt.hang) proc.emit("close", attempt.code, attempt.signal ?? null);
				});
			});
			return proc;
		},
	},
});

const bridgeExtension = (await import("../taskplane/agent-bridge-extension.ts")).default;
const ENV_KEYS = [
	"TASKPLANE_TASK_FOLDER",
	"TASKPLANE_STATUS_PATH",
	"TASKPLANE_PROMPT_PATH",
	"TASKPLANE_REVIEWS_DIR",
	"TASKPLANE_REVIEWER_STATE_PATH",
	"TASKPLANE_STATE_ROOT",
	"TASKPLANE_AGENT_ID",
	"TASKPLANE_TASK_ID",
	"ORCH_BATCH_ID",
	"TASKPLANE_REVIEWER_MODEL",
	"TASKPLANE_REVIEWER_THINKING",
	"TASKPLANE_REVIEWER_TOOLS",
] as const;
let previousEnv: Record<string, string | undefined>;
let root: string;
let statusPath: string;
let reviewsDir: string;
let agentsDir: string;
let previousArgv: string;

beforeEach(() => {
	mock.timers.enable({ apis: ["setTimeout"] });
	attempts.length = 0;
	outputPaths.length = 0;
	launchArgs.length = 0;
	reviewerStates.length = 0;
	killCalls = 0;
	root = mkdtempSync(join(tmpdir(), "reviewer-failure-"));
	previousArgv = process.argv[1];
	process.argv[1] = join(root, "cli.js");
	writeFileSync(process.argv[1], "// mocked Pi CLI\n");
	statusPath = join(root, "STATUS.md");
	reviewsDir = join(root, ".reviews");
	agentsDir = join(root, ".pi", "runtime", "batch", "agents");
	previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	Object.assign(process.env, {
		TASKPLANE_TASK_FOLDER: root,
		TASKPLANE_STATUS_PATH: statusPath,
		TASKPLANE_PROMPT_PATH: join(root, "PROMPT.md"),
		TASKPLANE_REVIEWS_DIR: reviewsDir,
		TASKPLANE_REVIEWER_STATE_PATH: join(root, ".reviewer-state.json"),
		TASKPLANE_STATE_ROOT: root,
		TASKPLANE_AGENT_ID: "worker-1",
		TASKPLANE_TASK_ID: "TP-1",
		ORCH_BATCH_ID: "batch",
	});
	writeFileSync(
		statusPath,
		"**Review Counter:** 2\n\n### Step 5: Implement\n**Status:** 🟨 In Progress\n",
	);
	writeFileSync(join(root, "PROMPT.md"), "### Step 5: Implement\n");
});

afterEach(() => {
	mock.timers.reset();
	process.argv[1] = previousArgv;
	for (const key of ENV_KEYS) {
		if (previousEnv[key] === undefined) delete process.env[key];
		else process.env[key] = previousEnv[key];
	}
	rmSync(root, { recursive: true, force: true });
});

function reviewTool() {
	let execute: (id: string, params: object) => Promise<{ content: { text: string }[] }>;
	bridgeExtension({
		registerTool(tool: { name: string; execute: typeof execute }) {
			if (tool.name === "review_step") execute = tool.execute;
		},
	} as never);
	return () => execute("review-call", { step: 5, type: "code" });
}

describe("reviewer subprocess failures", () => {
	for (const [name, output] of [
		["missing", undefined],
		["empty", " \n"],
	] as const) {
		it(`reuses the review number after ${name} output and reports the retry as round one`, async () => {
			attempts.push({ code: 1, output }, { code: 0, output: "## Verdict: REVISE\n" });
			const review = reviewTool();
			const failed = await review();
			assert.match(failed.content[0].text, /^UNAVAILABLE/);
			assert.match(readFileSync(statusPath, "utf-8"), /\*\*Review Counter:\*\* 2\b/);
			assert.equal(existsSync(outputPaths[0]), false);
			const failedDiagnostics = readdirSync(agentsDir).map((file) => [
				file,
				readFileSync(join(agentsDir, file), "utf-8"),
			]);
			const success = await review();
			for (const [file, content] of failedDiagnostics)
				assert.equal(readFileSync(join(agentsDir, file), "utf-8"), content);
			assert.equal(readdirSync(agentsDir).filter((file) => file.endsWith("-exit.json")).length, 2);
			assert.match(success.content[0].text, /^REVISE/);
			assert.equal(outputPaths[0], outputPaths[1]);
			assert.match(outputPaths[1], /R003-code-step5\.md$/);
			assert.match(readFileSync(statusPath, "utf-8"), /\*\*Review Counter:\*\* 3\b/);
			const state = freshReviewStreakState();
			for (const disposition of ["UNAVAILABLE", "REVISE"] as const) {
				advanceReviewStreak(state, {
					disposition,
					counts: null,
					treatUnavailableAsNonApprove: false,
					recentCap: 6,
				});
			}
			assert.equal(state.round, 1);
			assert.equal(state.consecutiveNonApprove, 1);
		});
	}

	for (const attempt of [
		{ code: 1, stderr: "provider unavailable" },
		{ code: null, signal: "SIGKILL", stderr: "terminated" },
		{ code: null, error: "spawn ENOENT" },
	] satisfies Attempt[]) {
		it(`persists diagnostics for ${attempt.error ?? attempt.signal ?? "exit 1"}`, async () => {
			attempts.push(attempt);
			const result = await reviewTool()();
			assert.match(result.content[0].text, /^UNAVAILABLE/);
			const files = readdirSync(agentsDir);
			const summaryFile = files.find((name) => name.endsWith("-exit.json"));
			assert.ok(summaryFile);
			const summary = JSON.parse(readFileSync(join(agentsDir, summaryFile), "utf-8"));
			assert.equal(summary.exitCode, attempt.code);
			assert.equal(summary.exitSignal, attempt.signal ?? null);
			if (attempt.error) assert.match(summary.error, /spawn ENOENT/);
			const stderrFile = files.find((name) => name.endsWith("-stderr.log"));
			assert.ok(stderrFile);
			assert.equal(readFileSync(join(agentsDir, stderrFile), "utf-8").trim(), attempt.stderr ?? "");
			assert.ok(files.some((name) => name.endsWith(".jsonl")));
			const status = readFileSync(statusPath, "utf-8");
			assert.match(status, /Review spawn failed/);
			assert.ok(status.includes(attempt.error ?? attempt.signal ?? "code 1"));
			assert.equal(existsSync(join(root, ".reviewer-state.json")), false);
		});
	}

	it("records synchronous launch errors without consuming a number", async () => {
		attempts.push({ code: null, throwOnSpawn: true });
		const result = await reviewTool()();
		assert.match(result.content[0].text, /^UNAVAILABLE.*synchronous launch failure/);
		const summary = readdirSync(agentsDir).find((file) => file.endsWith("-exit.json"))!;
		assert.match(readFileSync(join(agentsDir, summary), "utf-8"), /synchronous launch failure/);
		assert.match(
			readFileSync(statusPath, "utf-8"),
			/Review spawn failed.*synchronous launch failure/,
		);
		assert.match(readFileSync(statusPath, "utf-8"), /\*\*Review Counter:\*\* 2\b/);
		assert.equal(existsSync(join(root, ".reviewer-state.json")), false);
	});

	it("keeps nonempty unclear reviews fail-closed and preserves their artifact number", async () => {
		attempts.push({ code: 0, output: "Review interrupted before a verdict.\n" });
		const result = await reviewTool()();
		assert.match(result.content[0].text, /verdict unclear/);
		assert.match(result.content[0].text, /do NOT treat this as an approval/);
		assert.match(readFileSync(statusPath, "utf-8"), /\*\*Review Counter:\*\* 3\b/);
		assert.equal(readFileSync(outputPaths[0], "utf-8"), "Review interrupted before a verdict.\n");
	});

	it("preserves reviewer configuration and dashboard telemetry through the host", async () => {
		process.env.TASKPLANE_REVIEWER_MODEL = "test/reviewer";
		process.env.TASKPLANE_REVIEWER_THINKING = "high";
		process.env.TASKPLANE_REVIEWER_TOOLS = "read,grep";
		attempts.push({
			code: 0,
			output: "## Verdict: APPROVE\n",
			rpc: [
				{ type: "tool_execution_start", toolName: "read", args: { path: "src/main.ts" } },
				{
					type: "message_end",
					message: { role: "assistant", usage: { input: 12, output: 3, cost: { total: 0.01 } } },
				},
			],
		});
		const result = await reviewTool()();
		assert.equal(result.content[0].text, "APPROVE");
		const args = launchArgs[0];
		for (const [flag, value] of [
			["--model", "test/reviewer"],
			["--thinking", "high"],
			["--tools", "read,grep"],
		]) {
			assert.equal(args[args.indexOf(flag) + 1], value);
		}
		assert.ok(args.includes("--no-extensions"));
		assert.ok(args.includes("--no-skills"));
		assert.ok(args.includes("--system-prompt"));
		assert.ok(
			reviewerStates.some(
				(state: any) =>
					state.toolCalls === 1 &&
					state.lastTool === "read: src/main.ts" &&
					state.inputTokens === 12 &&
					state.outputTokens === 3 &&
					state.costUsd === 0.01,
			),
		);
	});

	it("records timeout as the cause of a missing review", async () => {
		attempts.push({ code: null, hang: true });
		const pending = reviewTool()();
		mock.timers.tick(10 * 60 * 1000);
		const result = await pending;
		assert.match(result.content[0].text, /timeout/i);
		assert.match(readFileSync(statusPath, "utf-8"), /Review spawn failed.*timeout/i);
	});

	it("retains a completed verdict after a nonzero exit and clears the timeout", async () => {
		attempts.push({ code: 1, output: "## Verdict: REVISE\n" });
		const result = await reviewTool()();
		assert.match(result.content[0].text, /^REVISE/);
		mock.timers.tick(10 * 60 * 1000);
		assert.equal(killCalls, 0);
	});
});
