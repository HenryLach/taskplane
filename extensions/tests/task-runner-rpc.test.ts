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

describe("task-runner subprocess-only spawn contracts", () => {
	const src = readSource();

	it("removes legacy tmux spawn helpers", () => {
		expect(src).not.toContain("function spawnAgentTmux(");
		expect(src).not.toContain("function getSpawnMode(");
		expect(src).not.toContain("TASK_RUNNER_SPAWN_MODE");
	});

	it("runWorker uses spawnAgent directly", () => {
		const block = extractRegion(src, "\tasync function runWorker(");
		expect(block).toContain("const spawned = spawnAgent({");
		expect(block).not.toContain("spawnAgentTmux");
	});

	it("review_step reviewer path uses subprocess spawning", () => {
		const block = extractRegion(src, "\t// ── review_step Tool (orchestrated mode only) ───────────────────");
		expect(block).toContain("reviewer-subprocess");
		expect(block).toContain("const spawned = spawnAgent({");
		expect(block).not.toContain("spawnSync(\"tmux\"");
	});
});
