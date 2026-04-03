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

describe("Task Runner orchestration compatibility", () => {
	const src = readSource();

	it("uses ORCH_BATCH_ID orchestration detection", () => {
		expect(src).toContain("return !!process.env.ORCH_BATCH_ID || !!process.env.TASK_RUNNER_TMUX_PREFIX;");
	});

	it("uses lane prefix helper for sidecar naming", () => {
		expect(src).toContain("function getLanePrefix(): string");
		expect(src).toContain("lane-state-${prefix}.json");
		expect(src).toContain("context-snapshots");
	});

	it("contains no spawn-mode branch or tmux process commands", () => {
		expect(src).not.toContain("TASK_RUNNER_SPAWN_MODE");
		expect(src).not.toContain("if (spawnMode === \"tmux\")");
		expect(src).not.toContain("spawnSync(\"tmux\"");
	});
});
