import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import { createOrchWidget } from "../taskplane/formatting.ts";
import { freshOrchBatchState } from "../taskplane/types.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

describe("merge panel widget", () => {
	it("renders a boxed merge status panel during merging", () => {
		const batchState = freshOrchBatchState();
		batchState.phase = "merging";
		batchState.batchId = "batch-1";
		batchState.orchBranch = "orch/test";
		batchState.startedAt = Date.now() - 1000;
		batchState.currentWaveIndex = 0;
		batchState.totalWaves = 1;
		batchState.totalTasks = 4;
		batchState.mergePanel = {
			status: "warning",
			waveLabel: "Wave 1",
			events: [
				{ level: "info", message: "Lane 1 merged cleanly" },
				{ level: "warning", message: "Lane 2 needs manual review" },
			],
		};

		const widget = createOrchWidget(() => batchState, () => null, "orch")(undefined, theme);
		const rendered = widget.render(80);

		expect(rendered.join("\n")).toContain("Merge Status");
		expect(rendered.join("\n")).toContain("Wave 1 · Warnings");
		expect(rendered.join("\n")).toContain("Lane 1 merged cleanly");
		expect(rendered.join("\n")).toContain("Lane 2 needs manual review");
		for (const line of rendered) {
			expect(line.length <= 80).toBeTruthy();
		}
	});

	it("hides the merge panel outside the merging phase", () => {
		const batchState = freshOrchBatchState();
		batchState.phase = "executing";
		batchState.batchId = "batch-2";
		batchState.startedAt = Date.now() - 1000;
		batchState.currentWaveIndex = 0;
		batchState.totalWaves = 1;
		batchState.totalTasks = 4;
		batchState.mergePanel = {
			status: "success",
			waveLabel: "Wave 1",
			events: [{ level: "success", message: "Lane 1 merged" }],
		};

		const widget = createOrchWidget(() => batchState, () => null, "orch")(undefined, theme);
		const rendered = widget.render(80).join("\n");

		expect(rendered).not.toContain("Merge Status");
	});
});