import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { AgentHostResult } from "../taskplane/agent-host.ts";
import type { LaneRunnerConfig } from "../taskplane/lane-runner.ts";
import type { ExecutionUnit } from "../taskplane/types.ts";
import { readLaneSnapshot } from "../taskplane/process-registry.ts";
import { generateStatusMd, parsePromptMd } from "../taskplane/task-executor-core.ts";
import { resolvePacketPaths } from "../taskplane/types.ts";

let onSpawn: (() => void) | undefined;
const workerResult: AgentHostResult = {
	exitCode: 0,
	signal: null,
	durationMs: 500,
	killed: false,
	inputTokens: 5,
	outputTokens: 5,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	costUsd: 0.01,
	toolCalls: 1,
	lastTool: "edit",
	retries: 0,
	compactions: 0,
	contextUsage: null,
	error: null,
	agentEnded: true,
	stderrTail: "",
};
const realAgentHost = await import("../taskplane/agent-host.ts");
const spawnAgent = mock.fn(() => {
	onSpawn?.();
	return { promise: Promise.resolve(workerResult), kill: () => {} };
});
mock.module("../taskplane/agent-host.ts", {
	namedExports: { ...realAgentHost, spawnAgent },
});
const { executeTaskV2 } = await import("../taskplane/lane-runner.ts");

const VALID_PROMPT = `# Task: TP-614 — Empty steps regression

## Review Level: 0

## Steps

### Step 0: Implement
- [ ] Do the work
`;
const INVALID_PROMPTS = [
	["h2 step headings", VALID_PROMPT.replace("### Step", "## Step")],
	["an empty prompt", ""],
	[
		"a mission without steps",
		"# Task: TP-614 — Empty steps regression\n\n## Mission\nDo the work.\n",
	],
];

describe("Runtime V2 rejects tasks without parseable steps (#614)", () => {
	let root: string;
	let unit: ExecutionUnit;
	let config: LaneRunnerConfig;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "taskplane-empty-steps-"));
		const taskFolder = join(root, "task");
		const worktreePath = join(root, "worktree");
		mkdirSync(taskFolder);
		mkdirSync(worktreePath);
		const packet = resolvePacketPaths(taskFolder);
		unit = {
			id: "TP-614",
			taskId: "TP-614",
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-614",
				taskName: "Empty steps regression",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending",
			},
		};
		config = {
			batchId: "empty-steps",
			agentIdPrefix: "orch-test",
			laneNumber: 1,
			worktreePath,
			branch: "test-branch",
			repoId: "default",
			stateRoot: root,
			workerModel: "",
			workerTools: "",
			workerThinking: "",
			workerSystemPrompt: "",
			workerSegmentPrompt: "",
			reviewerModel: "",
			reviewerThinking: "",
			reviewerTools: "",
			maxIterations: 2,
			noProgressLimit: 2,
			maxWorkerMinutes: 5,
			warnPercent: 80,
			killPercent: 95,
		};
		spawnAgent.mock.resetCalls();
		onSpawn = undefined;
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function writeStatus(complete = false): void {
		const status = generateStatusMd(parsePromptMd(VALID_PROMPT, unit.packet.promptPath));
		writeFileSync(unit.packet.statusPath, complete ? status.replaceAll("- [ ]", "- [x]") : status);
	}

	function assertFailed(result: Awaited<ReturnType<typeof executeTaskV2>>): void {
		assert.equal(result.outcome.status, "failed");
		assert.match(result.outcome.exitReason ?? "", /no parseable steps/i);
		assert.match(result.outcome.exitReason ?? "", /### Step N:/);
		assert.equal(result.outcome.doneFileFound, false);
		assert.equal(existsSync(unit.packet.donePath), false);
		const status = readFileSync(unit.packet.statusPath, "utf-8");
		assert.match(status, /\*\*Status:\*\* ❌ Failed/);
		assert.match(status, /no parseable steps/i);
		assert.equal(readLaneSnapshot(root, config.batchId, config.laneNumber)?.status, "failed");
	}

	for (const [name, prompt] of INVALID_PROMPTS) {
		for (const existingStatus of [false, true]) {
			it(`rejects ${name} ${existingStatus ? "with" : "without"} an existing STATUS.md`, async () => {
				writeFileSync(unit.packet.promptPath, prompt);
				if (existingStatus) writeStatus();
				const result = await executeTaskV2(unit, config, { paused: false });
				assertFailed(result);
				assert.equal(spawnAgent.mock.callCount(), 0);
				assert.equal(result.iterations, 0);
				assert.equal(result.costUsd, 0);
				assert.equal(result.totalTokens, 0);
				if (existingStatus) {
					assert.match(readFileSync(unit.packet.statusPath, "utf-8"), /- \[ \] Do the work/);
				}
			});
		}
	}

	it("quarantines an existing completion marker for an invalid task", async () => {
		writeFileSync(unit.packet.promptPath, INVALID_PROMPTS[0][1]);
		writeStatus(true);
		writeFileSync(unit.packet.donePath, "previous false completion");
		assertFailed(await executeTaskV2(unit, config, { paused: false }));
		const quarantined = readdirSync(unit.packet.taskFolder).find((f) =>
			f.startsWith(".DONE.unauthorized-"),
		);
		assert.ok(quarantined);
		assert.equal(
			readFileSync(join(unit.packet.taskFolder, quarantined), "utf-8"),
			"previous false completion",
		);
		assert.equal(spawnAgent.mock.callCount(), 0);
	});

	for (const maxIterations of [1, 2]) {
		it(`rejects steps removed by a worker with an iteration budget of ${maxIterations}`, async () => {
			writeFileSync(unit.packet.promptPath, VALID_PROMPT);
			writeStatus();
			config.maxIterations = maxIterations;
			onSpawn = () => writeFileSync(unit.packet.promptPath, INVALID_PROMPTS[0][1]);
			const result = await executeTaskV2(unit, config, { paused: false });
			assertFailed(result);
			assert.equal(spawnAgent.mock.callCount(), 1);
			assert.equal(result.iterations, 1);
			assert.equal(result.costUsd, workerResult.costUsd);
			assert.equal(result.totalTokens, 10);
		});
	}

	it("still completes a valid task whose steps were finished before resuming", async () => {
		writeFileSync(unit.packet.promptPath, VALID_PROMPT);
		writeStatus(true);
		const result = await executeTaskV2(unit, config, { paused: false });
		assert.equal(result.outcome.status, "succeeded");
		assert.equal(result.outcome.doneFileFound, true);
		assert.equal(existsSync(unit.packet.donePath), true);
		assert.equal(spawnAgent.mock.callCount(), 0);
		assert.equal(result.iterations, 0);
	});
});
