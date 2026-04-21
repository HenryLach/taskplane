import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import { buildOrchPlanWidgetLines } from "../taskplane/messages.ts";

describe("orch plan widget lines", () => {
	it("splits multiline sections and keeps blank separators between sections", () => {
		const lines = buildOrchPlanWidgetLines([
			"Preflight Check:\n✅ git\nAll required checks passed.",
			"📋 Discovery Results\nPending tasks: 20",
			"🌊 Execution Plan: 6 wave(s)",
		]);

		expect(lines).toEqual([
			"Preflight Check:",
			"✅ git",
			"All required checks passed.",
			"",
			"📋 Discovery Results",
			"Pending tasks: 20",
			"",
			"🌊 Execution Plan: 6 wave(s)",
		]);
	});

	it("drops empty sections and normalizes CRLF input", () => {
		const lines = buildOrchPlanWidgetLines([
			null,
			"",
			"Section A\r\nLine 2\r\n",
			undefined,
			"Section B",
		]);

		expect(lines).toEqual([
			"Section A",
			"Line 2",
			"",
			"Section B",
		]);
	});
});