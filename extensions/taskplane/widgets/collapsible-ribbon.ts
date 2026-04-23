import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import { WidgetBase, type WidgetComponent, type WidgetFactory, type WidgetState } from "./base.ts";

export type CollapsibleRibbonWidgetState = WidgetState & {
	sections: Array<string | null | undefined>;
};
export type CollapsibleRibbonWidgetFactory = WidgetFactory;

export class CollapsibleRibbonWidget extends WidgetBase<CollapsibleRibbonWidgetState> {
	lines(): string[] {
		return this.build(this.state).split("\n");
	}

	protected build(state: CollapsibleRibbonWidgetState): string {
		if (state.collapsed) {
			const hintLine = CollapsibleRibbonWidget.collapsedHint(state);
			return [
				`● ${state.title}`,
				CollapsibleRibbonWidget.collapsedSummary(state),
				...(hintLine ? [hintLine] : []),
			].join("\n");
		}
		const sectionLines = CollapsibleRibbonWidget.buildSectionLines(state.sections);
		return [state.title, WidgetBase.statusLineFor(state), ...(sectionLines.length > 0 ? ["", ...sectionLines] : [])].join("\n");
	}

	protected create(state: CollapsibleRibbonWidgetState, theme: any): WidgetComponent {
		return {
			render: (width: number) => this.render(state, theme, width),
			invalidate() {},
		};
	}

	protected shouldRender(state: CollapsibleRibbonWidgetState): boolean {
		return Boolean(state.title || state.phase || state.sections.length > 0);
	}

	protected render(state: CollapsibleRibbonWidgetState, theme: any, width: number): string[] {
		const safeWidth = Math.max(6, width);
		const padding = Math.max(0, state.padding ?? 1);
		const innerWidth = Math.max(1, safeWidth - (padding * 2));
		const outerPad = " ".repeat(padding);
		const dot = typeof theme.fg === "function" ? theme.fg(WidgetBase.toneFor(state.status), "●") : "●";
		const title = typeof theme.bold === "function" ? theme.bold(state.title) : state.title;
		const phase = WidgetBase.phaseFor(state.status, state.phase);
		const sectionLines = CollapsibleRibbonWidget.buildSectionLines(state.sections);
		const detailSummaryLine = state.viewState === "closed"
			? CollapsibleRibbonWidget.collapsedSummary(state)
			: `${dot} ${phase}`;
		const collapsedHintLine = CollapsibleRibbonWidget.collapsedHint(state);
		const contentLines = state.collapsed
			? [
				`${dot} ${title}`,
				CollapsibleRibbonWidget.collapsedSummary(state),
				...(collapsedHintLine
					? [typeof theme.fg === "function" ? theme.fg("dim", collapsedHintLine) : collapsedHintLine]
					: []),
			]
			: [
				`${dot} ${title}`,
				detailSummaryLine,
				...(sectionLines.length > 0 ? ["", ...sectionLines] : []),
			];
		const rendered: string[] = [];
		for (let index = 0; index < padding; index += 1) rendered.push(" ".repeat(safeWidth));
		for (const contentLine of contentLines) {
			if (contentLine.length === 0) {
				rendered.push(" ".repeat(safeWidth));
				continue;
			}
			for (const wrappedLine of wrapTextWithAnsi(contentLine, innerWidth)) {
				const visible = visibleWidth(wrappedLine);
				rendered.push(truncateToWidth(
					`${outerPad}${wrappedLine}${" ".repeat(Math.max(0, innerWidth - visible))}${outerPad}`,
					safeWidth,
					"",
				));
			}
		}
		for (let index = 0; index < padding; index += 1) rendered.push(" ".repeat(safeWidth));
		return rendered;
	}

	static buildSectionLines(sections: Array<string | null | undefined>): string[] {
		const lines: string[] = [];
		for (const section of sections) {
			const normalized = section?.replace(/\r\n/g, "\n").trimEnd();
			if (!normalized) continue;
			if (lines.length > 0) lines.push("");
			lines.push(...normalized.split("\n"));
		}
		return lines;
	}

	static collapsedSummary(state: CollapsibleRibbonWidgetState): string {
		const phase = WidgetBase.phaseFor(state.status, state.phase);
		const marker = WidgetBase.markerFor(state.status);
		const normalizedSections = state.sections
			.map((section) => section?.replace(/\r\n/g, "\n").trim())
			.filter((section): section is string => Boolean(section));
		const lastSectionHeadline = normalizedSections.length > 0
			? normalizedSections[normalizedSections.length - 1].split("\n")[0]?.trim()
			: "";
		return lastSectionHeadline && lastSectionHeadline !== phase
			? `${marker} ${phase} · ${lastSectionHeadline}`
			: `${marker} ${phase}`;
	}

	static collapsedHint(state: CollapsibleRibbonWidgetState): string | undefined {
		return state.expandHint ? `Expand: ${state.expandHint}` : undefined;
	}
}