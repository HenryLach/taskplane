export type ExtensionAPI = any;
export type ExtensionContext = any;

// Stub value exports used by source files
export class DynamicBorder {
	private color: (text: string) => string;

	constructor(color: (text: string) => string = (text) => text) {
		this.color = color;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}
}
export function getSettingsListTheme(): any { return {}; }
