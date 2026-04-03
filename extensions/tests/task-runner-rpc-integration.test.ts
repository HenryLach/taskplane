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

describe("task-runner orchestration helpers after tmux extrication", () => {
	const src = readSource();

	it("detects orchestrated mode via ORCH_BATCH_ID with legacy fallback", () => {
		expect(src).toContain("return !!process.env.ORCH_BATCH_ID || !!process.env.TASK_RUNNER_TMUX_PREFIX;");
	});

	it("resolves lane prefix without spawn-mode branching", () => {
		expect(src).toContain("function getLanePrefix(): string");
		expect(src).toContain("process.env.TASKPLANE_LANE_PREFIX");
		expect(src).toContain("process.env.TASK_RUNNER_TMUX_PREFIX");
		expect(src).not.toContain("TASK_RUNNER_SPAWN_MODE");
	});

	it("contains no direct tmux process invocation", () => {
		expect(src).not.toContain("spawnSync(\"tmux\"");
		expect(src).not.toContain("spawn(\"tmux\"");
	});

	it("writes lane sidecar files with lane prefix", () => {
		expect(src).toContain("lane-state-${prefix}.json");
		expect(src).toContain("worker-conversation-${prefix}.jsonl");
	});
});
