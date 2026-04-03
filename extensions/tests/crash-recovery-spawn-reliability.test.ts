import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_RUNNER_PATH = resolve(__dirname, "../task-runner.ts");

function readSource(): string {
	return readFileSync(TASK_RUNNER_PATH, "utf-8");
}

function extractRegion(src: string, marker: string): string {
	const start = src.indexOf(marker);
	if (start < 0) throw new Error(`marker not found: ${marker}`);
	const rest = src.slice(start + 1);
	const nextSection = rest.search(/\n\t\/\/ ── /);
	return nextSection < 0 ? src.slice(start) : src.slice(start, start + 1 + nextSection);
}

describe("task-runner crash recovery after subprocess consolidation", () => {
	const src = readSource();

	it("keeps iterative worker invocation and progress loop", () => {
		expect(src).toContain("await runWorker(remainingSteps, ctx);");
		expect(src).toContain("if (state.totalIterations > 1)");
	});

	it("runWorker remains subprocess-only and keeps token/tool accumulation", () => {
		const block = extractRegion(src, "\tasync function runWorker(");
		expect(block).toContain("const spawned = spawnAgent({");
		expect(block).not.toContain("spawnAgentTmux");
		expect(block).toContain("state.workerToolCount++");
		expect(block).toContain("state.workerInputTokens += tokens.input");
		expect(block).toContain("state.workerOutputTokens += tokens.output");
	});

	it("removes stable sidecar/tmux retry helpers", () => {
		expect(src).not.toContain("generateStableSidecarPaths(");
		expect(src).not.toContain("cleanupOrphanProcesses(");
		expect(src).not.toContain("sleepSyncMs(");
	});
});
