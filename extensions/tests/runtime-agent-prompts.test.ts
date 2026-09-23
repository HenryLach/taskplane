import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentHostOptions } from "../taskplane/agent-host.ts";
import type { LaneRunnerConfig } from "../taskplane/lane-runner.ts";
import type { AllocatedLane } from "../taskplane/types.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const originalCwd = process.cwd();
const captured = new Error("prompt captured before spawning");
let workerConfig: LaneRunnerConfig | undefined;
let mergerOptions: AgentHostOptions | undefined;

const agentHost = await import("../taskplane/agent-host.ts");
mock.module("../taskplane/agent-host.ts", {
	namedExports: {
		...agentHost,
		spawnAgent: (options: AgentHostOptions) => {
			mergerOptions = options;
			throw captured;
		},
	},
});
const laneRunner = await import("../taskplane/lane-runner.ts");
mock.module("../taskplane/lane-runner.ts", {
	namedExports: {
		...laneRunner,
		executeTaskV2: async (_unit: unknown, config: LaneRunnerConfig) => {
			workerConfig = config;
			throw captured;
		},
	},
});
const { executeLaneV2 } = await import("../taskplane/execution.ts");
const { spawnMergeAgentV2 } = await import("../taskplane/merge.ts");
const { loadReviewerPrompt } = await import("../taskplane/agent-bridge-extension.ts");
const { DEFAULT_ORCHESTRATOR_CONFIG } = await import("../taskplane/types.ts");

describe("Runtime V2 agent prompt inheritance (#619)", () => {
	let projectRoot: string;

	beforeEach(() => {
		projectRoot = mkdtempSync(join(tmpdir(), "tp-agent-prompts-"));
		// Make the stock templates discoverable even before the package-root fix.
		process.chdir(packageRoot);
		workerConfig = undefined;
		mergerOptions = undefined;
	});
	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(projectRoot, { recursive: true, force: true });
	});

	function writeAgent(
		name: string,
		standalone: boolean,
		agentRoot = join(projectRoot, ".pi", "agents"),
	) {
		mkdirSync(agentRoot, { recursive: true });
		writeFileSync(
			join(agentRoot, `${name}.md`),
			`---\nname: ${name}\nstandalone: ${standalone}\nmodel: ignored-model\ntools: ignored-tools\n---\nLocal ${name} guidance.\n`,
		);
	}

	function expectedPrompt(name: string, standalone: boolean) {
		const local = `Local ${name} guidance.`;
		if (standalone) return local;
		const raw = readFileSync(join(packageRoot, "templates", "agents", `${name}.md`), "utf8");
		const base = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
		return `${base}\n\n---\n\n## Project-Specific Guidance\n\n${local}`;
	}

	for (const standalone of [true, false]) {
		it(`loads the bridge reviewer prompt with standalone=${standalone}`, () => {
			writeAgent("task-reviewer", standalone);
			assert.equal(loadReviewerPrompt(projectRoot), expectedPrompt("task-reviewer", standalone));
		});

		it(`passes the worker prompt to the lane runner with standalone=${standalone}`, async () => {
			writeAgent("task-worker", standalone);
			const taskFolder = join(projectRoot, "tasks", "TEST-001");
			mkdirSync(taskFolder, { recursive: true });
			writeFileSync(join(taskFolder, "PROMPT.md"), "# Test\n\n### Step 1: Test\n- [ ] Test\n");
			const lane = {
				laneNumber: 1,
				laneId: "lane-1",
				laneSessionId: "orch-test-lane-1",
				worktreePath: projectRoot,
				branch: "task/test",
				repoId: "default",
				tasks: [
					{
						taskId: "TEST-001",
						order: 0,
						task: {
							taskId: "TEST-001",
							taskName: "Test",
							taskFolder,
							promptPath: join(taskFolder, "PROMPT.md"),
							dependencies: [],
							fileScope: [],
							status: "pending",
							reviewLevel: 0,
						},
					},
				],
			} as unknown as AllocatedLane;
			await executeLaneV2(
				lane,
				DEFAULT_ORCHESTRATOR_CONFIG,
				projectRoot,
				{ paused: false },
				undefined,
				false,
				{
					TASKPLANE_WORKER_MODEL: "configured-model",
					TASKPLANE_WORKER_TOOLS: "read,bash",
				},
			);
			assert.ok(workerConfig, "the real lane path must reach executeTaskV2");
			assert.equal(workerConfig.workerSystemPrompt, expectedPrompt("task-worker", standalone));
			assert.equal(workerConfig.workerModel, "configured-model");
			assert.equal(workerConfig.workerTools, "read,bash");
			assert.ok(workerConfig.workerSegmentPrompt?.length);
		});

		it(`passes the merger prompt to agent-host with standalone=${standalone}`, async () => {
			writeAgent("task-merger", standalone);
			const requestPath = join(projectRoot, "request.md");
			writeFileSync(requestPath, "Merge the branch.");
			const config = structuredClone(DEFAULT_ORCHESTRATOR_CONFIG);
			config.merge.model = "configured-model";
			config.merge.tools = "read,bash";
			await assert.rejects(
				spawnMergeAgentV2("orch-test-merge-1", projectRoot, projectRoot, requestPath, config),
				(err) => err === captured,
			);
			assert.ok(mergerOptions, "the real merge path must reach spawnAgent");
			assert.equal(mergerOptions.systemPrompt, expectedPrompt("task-merger", standalone));
			assert.equal(mergerOptions.model, "configured-model");
			assert.equal(mergerOptions.tools, "read,bash");
		});
	}

	it("uses an explicit merger agent root before project-local guidance", async () => {
		writeAgent("task-merger", false);
		const agentRoot = join(projectRoot, "shared-agents");
		writeAgent("task-merger", true, agentRoot);
		const requestPath = join(projectRoot, "request.md");
		writeFileSync(requestPath, "Merge the branch.");
		await assert.rejects(
			spawnMergeAgentV2(
				"orch-test-merge-1",
				projectRoot,
				projectRoot,
				requestPath,
				DEFAULT_ORCHESTRATOR_CONFIG,
				undefined,
				agentRoot,
			),
			(err) => err === captured,
		);
		assert.equal(mergerOptions?.systemPrompt, "Local task-merger guidance.");
	});
});
