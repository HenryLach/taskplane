import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readDashboard(file: string): string {
	return readFileSync(join(__dirname, "..", "..", "dashboard", "public", file), "utf-8");
}

describe("TP-136 dashboard segment observability", () => {
	it("renders active lane segment + per-task segment progress when available", () => {
		const appSrc = readDashboard("app.js");
		expect(appSrc).toContain("lane-segment");
		expect(appSrc).toContain("segmentProgressText");
		expect(appSrc).toContain("task-segment-progress");
		expect(appSrc).toContain("Segment ${segmentInfo.index}/${segmentInfo.total}");
	});

	it("renders packet home repo metadata in task details", () => {
		const appSrc = readDashboard("app.js");
		expect(appSrc).toContain("task-packet-home");
		expect(appSrc).toContain("packet: ");
		expect(appSrc).toContain("showPacketHome");
	});

	it("repo-singleton tasks are excluded from segment UI noise", () => {
		const appSrc = readDashboard("app.js");
		expect(appSrc).toContain("if (segmentIds.length <= 1) return null;");
		expect(appSrc).toContain("Repo-singleton (or repo-mode) tasks should stay visually clean");
	});

	it("segment styling classes exist for lane/task metadata", () => {
		const cssSrc = readDashboard("style.css");
		expect(cssSrc).toContain(".lane-segment");
		expect(cssSrc).toContain(".task-segment-progress");
		expect(cssSrc).toContain(".task-packet-home");
	});
});
