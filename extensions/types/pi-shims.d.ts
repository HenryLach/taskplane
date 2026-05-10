/**
 * Type-only stubs for Pi packages so `tsc --noEmit` can resolve the
 * compile-time imports in headless CI environments.
 *
 * Pi's extension loader handles the actual runtime resolution via its
 * bundled-module aliasing (see
 * `pi-coding-agent/dist/core/extensions/loader.js`). At runtime, both the
 * legacy `@mariozechner/*` scope and the current `@earendil-works/*` scope
 * resolve to the same loaded modules. This shim mirrors that behaviour
 * for typecheck purposes by declaring identical shapes under both scopes
 * — so an import from either path resolves identically.
 *
 * Issue #560 (the `@earendil-works` rename) left taskplane's source still
 * referencing the legacy `@mariozechner/*` scope. We stub both here so
 * neither import path breaks `tsc`.
 *
 * **Maintenance note:** when taskplane starts using a new pi export, add
 * its shape here. The first `tsc` failure after such a change is the
 * canary — extend this file rather than disabling typecheck. Keep these
 * declarations as `.d.ts` only (no runtime impact); IDE typing comes from
 * the actual installed pi packages, the shim only matters for headless
 * `tsc --noEmit` runs.
 *
 * Surface seeded from `extensions/tests/mocks/pi-coding-agent.ts` and
 * `pi-tui.ts` plus a grep of taskplane source-tree imports under
 * `extensions/`.
 */

// ─── @earendil-works/* (current scope) ──────────────────────────────────

declare module "@earendil-works/pi-coding-agent" {
	// Types
	export type ExtensionAPI = any;
	// TP-195: Extended `ExtensionContext` from `any` to a structural
	// interface that exposes `ui.custom<T>()` with explicit type-argument
	// support. The 4 settings-tui.ts call sites (`ctx.ui.custom<T>(cb)`)
	// were rejected as TS2347 "Untyped function calls may not accept type
	// arguments" because `any` typed methods cannot accept generics.
	// Index signatures preserve forward-compat for any other ctx access.
	export interface ExtensionContext {
		ui: {
			custom<T = unknown>(...args: any[]): Promise<T>;
			[key: string]: any;
		};
		[key: string]: any;
	}
	// Values
	export class DynamicBorder {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export function getSettingsListTheme(): any;
}

declare module "@earendil-works/pi-ai" {
	// TypeBox-style schema builder. Declared as `any` so that
	// `Type.Object(...)`, `Type.String(...)`, `Type.Optional(...)`, etc.
	// all type-check without us having to mirror TypeBox.
	export const Type: any;
	// Generic types used by extensions/taskplane/supervisor.ts
	export type Api = any;
	export type Model<_A = any> = any;
}

declare module "@earendil-works/pi-tui" {
	// Values
	export class Container {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export class Text {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export class SelectList {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export class SettingsList {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export function truncateToWidth(input: string, width?: number): string;
	// Types
	export type SelectItem = any;
	export type SettingItem = any;
}

// ─── @mariozechner/* (legacy scope — same shapes) ───────────────────────
// Pi's runtime aliases both scopes to the same module; these duplicates
// satisfy the typechecker for source files that still import from the
// legacy scope (Issue #560 migration is in progress).

declare module "@mariozechner/pi-coding-agent" {
	export type ExtensionAPI = any;
	// TP-195: parallel `ExtensionContext` interface for the legacy scope
	// (same rationale as the `@earendil-works/pi-coding-agent` declaration).
	export interface ExtensionContext {
		ui: {
			custom<T = unknown>(...args: any[]): Promise<T>;
			[key: string]: any;
		};
		[key: string]: any;
	}
	export class DynamicBorder {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export function getSettingsListTheme(): any;
}

declare module "@mariozechner/pi-ai" {
	export const Type: any;
	export type Api = any;
	export type Model<_A = any> = any;
}

declare module "@mariozechner/pi-tui" {
	export class Container {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export class Text {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export class SelectList {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export class SettingsList {
		constructor(...args: any[]);
		[key: string]: any;
	}
	export function truncateToWidth(input: string, width?: number): string;
	export type SelectItem = any;
	export type SettingItem = any;
}
