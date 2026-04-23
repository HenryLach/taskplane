import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type WidgetStatus = "running" | "success" | "error" | "warning";
export type WidgetViewState = "opened" | "running" | "closed";
export type WidgetThemeState = "in-progress" | "success" | "error" | "warning";

export interface WidgetState {
	title: string;
	status: WidgetStatus;
	phase?: string;
	sections?: Array<string | null | undefined>;
	expandHint?: string;
	collapsed?: boolean;
	viewState?: WidgetViewState;
	themeState?: WidgetThemeState;
	showScrollbar?: boolean;
	maxBodyHeight?: number;
	scrollOffset?: number;
	padding?: number;
}

export interface WidgetMessage<TState extends WidgetState = WidgetState> {
	text: string;
	details: TState;
}

export type WidgetComponent = {
	render(width: number): string[];
	invalidate(): void;
};

export type WidgetFactory = (_tui: any, theme: any) => WidgetComponent;

// Base class for widgets, providing common state management and rendering utilities
// Subclasses should implement the abstract methods to define specific widget behavior and appearance
export abstract class WidgetBase<TState extends WidgetState = WidgetState> {
	private static readonly defaultExpandHint = WidgetBase.resolveExpandHint();

	#state: TState;

	constructor(state: TState) {
		this.#state = WidgetBase.normalizeState(state);
	}

	get state(): TState {
		return WidgetBase.clone(this.#state);
	}

	update(patch: Partial<TState>): this {
		this.#state = WidgetBase.normalizeState({
			...this.#state,
			...patch,
			...(patch.sections ? { sections: [...patch.sections] } : {}),
		} as TState);
		return this;
	}

	open(patch: Partial<TState> = {}): this {
		return this.update({
			...patch,
			collapsed: false,
			viewState: patch.viewState ?? this.#state.viewState ?? "opened",
		} as Partial<TState>);
	}

	close(patch: Partial<TState> = {}): this {
		const status = patch.status ?? this.#state.status;
		return this.update({
			...patch,
			collapsed: true,
			viewState: "closed",
			themeState: WidgetBase.themeStateFor(status),
		} as Partial<TState>);
	}

	message(patch: Partial<TState> = {}): WidgetMessage<TState> {
		const status = patch.status ?? this.#state.status;
		const details = WidgetBase.normalizeState({
			...this.#state,
			...patch,
			...(patch.sections ? { sections: [...patch.sections] } : {}),
			collapsed: true,
			viewState: "closed",
			themeState: WidgetBase.themeStateFor(status),
		} as TState);
		return {
			text: this.build(details),
			details,
		};
	}

	factory(): WidgetFactory | undefined {
		const state = this.state;
		if (!this.shouldRender(state)) return undefined;
		return (_tui: any, theme: any) => ({
			render: (width: number) => this.create(state, theme).render(width),
			invalidate() {},
		});
	}

	protected abstract shouldRender(state: TState): boolean;
	protected abstract render(state: TState, theme: any, width: number): string[];
	protected abstract create(state: TState, theme: any): WidgetComponent;
	protected abstract build(state: TState): string;

	static themeStateFor(status: WidgetStatus): WidgetThemeState {
		return status === "success"
			? "success"
			: status === "error"
				? "error"
				: status === "warning"
					? "warning"
					: "in-progress";
	}

	static phaseFor(status: WidgetStatus, phase?: string): string {
		return phase
			|| (status === "success"
				? "Plan ready"
				: status === "error"
					? "Plan failed"
					: status === "warning"
						? "Needs attention"
						: "Running");
	}

	static markerFor(status: WidgetStatus): string {
		return status === "success"
			? "✓"
			: status === "error"
				? "✗"
				: status === "warning"
					? "!"
					: "●";
	}

	static statusLineFor(state: WidgetState): string {
		return `${WidgetBase.markerFor(state.status)} ${WidgetBase.phaseFor(state.status, state.phase)}`;
	}

	static toneFor(status: WidgetStatus): "success" | "error" | "warning" {
		return status === "success"
			? "success"
			: status === "error"
				? "error"
				: "warning";
	}

	protected static clone<TState extends WidgetState>(state: TState): TState {
		return {
			...state,
			...(state.sections ? { sections: [...state.sections] } : {}),
		};
	}

	private static normalizeState<TState extends WidgetState>(state: TState): TState {
		const nextState = WidgetBase.clone(state);
		if (!nextState.expandHint?.trim()) nextState.expandHint = WidgetBase.defaultExpandHint;
		return nextState;
	}

	private static resolveExpandHint(): string | undefined {
		const defaultKeys = ["ctrl+o"];
		const formatSegment = (segment: string) => {
			if (segment.length === 1) return segment.toUpperCase();
			if (segment === "ctrl") return "Ctrl";
			if (segment === "alt") return "Alt";
			if (segment === "shift") return "Shift";
			if (segment === "meta" || segment === "cmd") return "Cmd";
			if (segment === "pageup") return "PageUp";
			if (segment === "pagedown") return "PageDown";
			if (segment === "backspace") return "Backspace";
			if (segment === "enter") return "Enter";
			if (segment === "escape") return "Escape";
			return segment.charAt(0).toUpperCase() + segment.slice(1);
		};
		const formatHotkeyLabel = (keys: string[]) => {
			if (keys.length === 0) return undefined;
			return keys.map((key) => key.split("+").map(formatSegment).join("+")).join(" / ");
		};
		const keybindingsPath = join(homedir(), ".pi", "agent", "keybindings.json");
		if (!existsSync(keybindingsPath)) return formatHotkeyLabel(defaultKeys);
		try {
			const parsed = JSON.parse(readFileSync(keybindingsPath, "utf-8")) as { expandTools?: string | string[] };
			const value = parsed.expandTools;
			if (typeof value === "string" && value.trim().length > 0) return formatHotkeyLabel([value]);
			if (Array.isArray(value)) {
				const keys = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
				if (keys.length > 0) return formatHotkeyLabel(keys);
			}
		} catch {
			// Fall back to the documented default binding.
		}
		return formatHotkeyLabel(defaultKeys);
	}
}