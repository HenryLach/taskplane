import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import { CollapsibleRibbonWidget } from "../taskplane/widgets/collapsible-ribbon.ts";

describe("orch plan widget lines", () => {
	it("splits multiline sections and keeps blank separators between sections", () => {
		const lines = CollapsibleRibbonWidget.buildSectionLines([
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
		const lines = CollapsibleRibbonWidget.buildSectionLines([
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

	it("renders a simple orch-plan box so content is not capped at ten lines", () => {
		const factory = new CollapsibleRibbonWidget({
			title: "/orch-plan all --sync",
			status: "running",
			phase: "Computing waves",
			sections: [Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`).join("\n")],
		}).factory();

		expect(factory).toBeDefined();

		const widget = factory!(undefined, {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		});
		const rendered = widget.render(80).join("\n");

		expect(rendered).toContain("/orch-plan all --sync");
		expect(rendered).toContain("Computing waves");
		expect(rendered).toContain("Line 12");
		expect(rendered).not.toContain("... (widget truncated)");
	});

	it("renders a simple orch-plan box and wraps to the inner width", () => {
		const factory = new CollapsibleRibbonWidget({
			title: "/orch-plan all",
			status: "success",
			phase: "Plan ready",
			sections: ["This line is long enough to wrap across multiple rows in the widget body."],
			padding: 1,
		}).factory();

		expect(factory).toBeDefined();

		const widget = factory!(undefined, {
			bg: (_color: string, text: string) => text,
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		});
		const rendered = widget.render(20);

		expect(rendered.length > 5).toBeTruthy();
		expect(rendered[0].trim()).toBe("");
		expect(rendered[1].trim()).toBe("● /orch-plan all");
		expect(rendered[2].trim()).toBe("● Plan ready");
		expect(rendered[rendered.length - 1].trim()).toBe("");

		for (const line of rendered) {
			expect(line).toHaveLength(20);
		}
	});

	it("renders a collapsed orch-plan summary without pinning the full body", () => {
		const factory = new CollapsibleRibbonWidget({
			title: "/orch-plan all",
			status: "success",
			phase: "Plan ready",
			sections: ["Wave 1\nWave 2"],
			expandHint: "Ctrl+O",
			collapsed: true,
			padding: 1,
		}).factory();

		expect(factory).toBeDefined();

		const widget = factory!(undefined, {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		});
		const rendered = widget.render(28).join("\n");

		expect(rendered).toContain("● /orch-plan all");
		expect(rendered).toContain("✓ Plan ready · Wave 1");
		expect(rendered).toContain("Expand: Ctrl+O");
		expect(rendered).not.toContain("Wave 2");
	});

	it("renders an expanded closed-state summary before the full details", () => {
		const factory = new CollapsibleRibbonWidget({
			title: "/orch-plan all",
			status: "success",
			phase: "Plan ready",
			sections: ["Wave 1\nWave 2"],
			viewState: "closed",
			padding: 1,
		}).factory();

		expect(factory).toBeDefined();

		const widget = factory!(undefined, {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		});
		const rendered = widget.render(32).join("\n");

		expect(rendered).toContain("● /orch-plan all");
		expect(rendered).toContain("✓ Plan ready · Wave 1");
		expect(rendered).toContain("Wave 2");
	});

	it("serializes a plain fallback header with title and terminal status", () => {
		const lines = new CollapsibleRibbonWidget({
			title: "/orch-plan all",
			status: "success",
			phase: "Plan ready",
			sections: ["Wave 1", "Wave 2"],
		}).lines();

		expect(lines).toEqual([
			"/orch-plan all",
			"✓ Plan ready",
			"",
			"Wave 1",
			"",
			"Wave 2",
		]);
	});

	it("serializes a collapsed ribbon summary for fallback surfaces", () => {
		const message = new CollapsibleRibbonWidget({
			title: "/orch-plan all",
			status: "running",
			phase: "Computing waves",
			sections: ["Wave 1"],
			expandHint: "Ctrl+O",
		}).message();

		expect(message.text.split("\n")).toEqual([
			"● /orch-plan all",
			"● Computing waves · Wave 1",
			"Expand: Ctrl+O",
		]);
		expect(message.details.collapsed).toBeTruthy();
	});
});
