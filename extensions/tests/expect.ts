/**
 * expect() compatibility wrapper — maps the legacy Vitest-style expect API
 * to node:assert.
 *
 * Vitest is no longer the project test runner. This helper remains to keep
 * existing test code concise while running on Node's native `node:test`.
 */
import assert from "node:assert";

interface ExpectMethods {
	toBe(expected: unknown): void;
	toEqual(expected: unknown): void;
	toContain(needle: unknown): void;
	/**
	 * Like `toContain`, but whitespace-insensitive when matching strings.
	 * Both haystack and needle have any run of whitespace collapsed to a
	 * single space before checking. Intended for source-grep tests so they
	 * survive cosmetic formatter changes (line wrapping, indentation,
	 * inserted parentheses around arrow params, etc.).
	 */
	toContainNormalized(needle: string): void;
	toHaveLength(n: number): void;
	toBeDefined(): void;
	toBeUndefined(): void;
	toBeNull(): void;
	toBeTruthy(): void;
	toBeFalsy(): void;
	toBeGreaterThan(n: number): void;
	toBeGreaterThanOrEqual(n: number): void;
	toBeLessThan(n: number): void;
	toBeLessThanOrEqual(n: number): void;
	toBeCloseTo(expected: number, numDigits?: number): void;
	toMatch(re: RegExp | string): void;
	toBeInstanceOf(cls: unknown): void;
	toHaveProperty(key: string): void;
	toThrow(expected?: string | RegExp | (new (...args: any[]) => Error)): void;
	toHaveBeenCalled(): void;
	toHaveBeenCalledTimes(n: number): void;
	toHaveBeenCalledWith(...args: unknown[]): void;
	not: Omit<ExpectMethods, "not">;
}

/**
 * Vitest-compatible `expect.unreachable(msg)` helper.
 *
 * Throws an assertion error with the given message. Used in tests where a
 * code path should be unreachable (e.g., after a `throw` in the
 * production code, the test asserts that the catch handler ran rather
 * than fall-through). Static method on `expect` to match Vitest's API.
 *
 * @since TP-195 (#TBD) — was previously called but never defined,
 * silently typecheck-erroring on every call site (TS2339).
 */
export function expectUnreachable(message?: string): never {
	assert.fail(message ?? "Reached unreachable code path");
}

export function expect(actual: unknown): ExpectMethods {
	const methods: ExpectMethods = {
		toBe(expected: unknown) {
			assert.strictEqual(actual, expected);
		},
		toEqual(expected: unknown) {
			assert.deepStrictEqual(actual, expected);
		},
		toContain(needle: unknown) {
			if (typeof actual === "string") {
				assert.ok(
					actual.includes(needle as string),
					`Expected string to contain "${needle}", but got: "${actual}"`,
				);
			} else if (Array.isArray(actual)) {
				assert.ok(actual.includes(needle), `Expected array to contain ${JSON.stringify(needle)}`);
			} else {
				assert.fail(`toContain: actual is neither string nor array`);
			}
		},
		toContainNormalized(needle: string) {
			assert.ok(
				typeof actual === "string",
				`toContainNormalized: actual must be a string, got ${typeof actual}`,
			);
			// Collapse runs of whitespace, strip whitespace adjacent to brackets
			// and commas, and drop trailing commas before close-brackets so
			// source-grep needles like `foo(a, b, c)` match formatter output
			// `foo(\n\ta,\n\tb,\n\tc,\n)` after vertical re-wrapping with
			// trailingCommas: "all".
			const normalize = (s: string) =>
				s
					.replace(/\s+/g, " ")
					.replace(/([(\[{])\s+/g, "$1")
					.replace(/\s+([)\]},])/g, "$1")
					.replace(/,([)\]}])/g, "$1")
					.trim();
			const hayN = normalize(actual as string);
			const needleN = normalize(needle);
			assert.ok(
				hayN.includes(needleN),
				`Expected (whitespace-normalized) string to contain "${needleN}"`,
			);
		},
		toHaveLength(n: number) {
			assert.strictEqual((actual as any).length, n);
		},
		toBeDefined() {
			assert.notStrictEqual(actual, undefined);
		},
		toBeUndefined() {
			assert.strictEqual(actual, undefined);
		},
		toBeNull() {
			assert.strictEqual(actual, null);
		},
		toBeTruthy() {
			assert.ok(actual, `Expected truthy value, got: ${actual}`);
		},
		toBeFalsy() {
			assert.ok(!actual, `Expected falsy value, got: ${actual}`);
		},
		toBeGreaterThan(n: number) {
			assert.ok((actual as number) > n, `Expected ${actual} > ${n}`);
		},
		toBeGreaterThanOrEqual(n: number) {
			assert.ok((actual as number) >= n, `Expected ${actual} >= ${n}`);
		},
		toBeLessThan(n: number) {
			assert.ok((actual as number) < n, `Expected ${actual} < ${n}`);
		},
		toBeLessThanOrEqual(n: number) {
			assert.ok((actual as number) <= n, `Expected ${actual} <= ${n}`);
		},
		toBeCloseTo(expected: number, numDigits: number = 2) {
			const precision = 10 ** -numDigits / 2;
			assert.ok(
				Math.abs((actual as number) - expected) < precision,
				`Expected ${actual} to be close to ${expected} (precision ${numDigits})`,
			);
		},
		toMatch(re: RegExp | string) {
			if (typeof re === "string") {
				assert.ok(
					(actual as string).includes(re),
					`Expected string to match "${re}", got: "${actual}"`,
				);
			} else {
				assert.match(actual as string, re);
			}
		},
		toBeInstanceOf(cls: unknown) {
			assert.ok(
				actual instanceof (cls as any),
				`Expected instance of ${(cls as any).name}, got ${actual}`,
			);
		},
		toHaveProperty(key: string) {
			assert.ok(
				actual != null && key in (actual as object),
				`Expected object to have property "${key}"`,
			);
		},
		toThrow(expected?: string | RegExp | (new (...args: any[]) => Error)) {
			if (expected === undefined) {
				assert.throws(actual as () => void);
			} else if (typeof expected === "function") {
				assert.throws(actual as () => void, expected as new (...args: any[]) => Error);
			} else if (expected instanceof RegExp) {
				assert.throws(actual as () => void, { message: expected });
			} else {
				assert.throws(actual as () => void, { message: expected });
			}
		},
		toHaveBeenCalled() {
			const fn = actual as any;
			assert.ok(fn.mock && fn.mock.calls.length > 0, `Expected function to have been called`);
		},
		toHaveBeenCalledTimes(n: number) {
			const fn = actual as any;
			assert.strictEqual(
				fn.mock.calls.length,
				n,
				`Expected function to have been called ${n} times, but was called ${fn.mock.calls.length} times`,
			);
		},
		toHaveBeenCalledWith(...args: unknown[]) {
			const fn = actual as any;
			const calls = fn.mock.calls;
			const found = calls.some((call: any) => {
				try {
					assert.deepStrictEqual(call.arguments, args);
					return true;
				} catch {
					return false;
				}
			});
			assert.ok(found, `Expected function to have been called with ${JSON.stringify(args)}`);
		},
		not: {} as any, // filled below
	};

	methods.not = {
		toBe(expected: unknown) {
			assert.notStrictEqual(actual, expected);
		},
		toEqual(expected: unknown) {
			assert.notDeepStrictEqual(actual, expected);
		},
		toContain(needle: unknown) {
			if (typeof actual === "string") {
				assert.ok(
					!actual.includes(needle as string),
					`Expected string NOT to contain "${needle}", but it does`,
				);
			} else if (Array.isArray(actual)) {
				assert.ok(!actual.includes(needle), `Expected array NOT to contain ${JSON.stringify(needle)}`);
			} else {
				assert.fail(`not.toContain: actual is neither string nor array`);
			}
		},
		toContainNormalized(needle: string) {
			assert.ok(
				typeof actual === "string",
				`not.toContainNormalized: actual must be a string, got ${typeof actual}`,
			);
			const normalize = (s: string) =>
				s
					.replace(/\s+/g, " ")
					.replace(/([(\[{])\s+/g, "$1")
					.replace(/\s+([)\]},])/g, "$1")
					.replace(/,([)\]}])/g, "$1")
					.trim();
			const hayN = normalize(actual as string);
			const needleN = normalize(needle);
			assert.ok(
				!hayN.includes(needleN),
				`Expected (whitespace-normalized) string NOT to contain "${needleN}"`,
			);
		},
		toHaveLength(n: number) {
			assert.notStrictEqual((actual as any).length, n);
		},
		toBeDefined() {
			assert.strictEqual(actual, undefined);
		},
		toBeUndefined() {
			assert.notStrictEqual(actual, undefined);
		},
		toBeNull() {
			assert.notStrictEqual(actual, null);
		},
		toBeTruthy() {
			assert.ok(!actual, `Expected falsy value, got: ${actual}`);
		},
		toBeFalsy() {
			assert.ok(actual, `Expected truthy value, got: ${actual}`);
		},
		toBeGreaterThan(n: number) {
			assert.ok((actual as number) <= n, `Expected ${actual} to NOT be greater than ${n}`);
		},
		toBeGreaterThanOrEqual(n: number) {
			assert.ok((actual as number) < n, `Expected ${actual} to NOT be >= ${n}`);
		},
		toBeLessThan(n: number) {
			assert.ok((actual as number) >= n, `Expected ${actual} to NOT be less than ${n}`);
		},
		toBeLessThanOrEqual(n: number) {
			assert.ok((actual as number) > n, `Expected ${actual} to NOT be <= ${n}`);
		},
		toBeCloseTo(expected: number, numDigits: number = 2) {
			const precision = 10 ** -numDigits / 2;
			assert.ok(
				Math.abs((actual as number) - expected) >= precision,
				`Expected ${actual} NOT to be close to ${expected}`,
			);
		},
		toMatch(re: RegExp | string) {
			if (typeof re === "string") {
				assert.ok(
					!(actual as string).includes(re),
					`Expected string NOT to match "${re}", but it does`,
				);
			} else {
				assert.doesNotMatch(actual as string, re);
			}
		},
		toBeInstanceOf(cls: unknown) {
			assert.ok(
				!(actual instanceof (cls as any)),
				`Expected NOT to be instance of ${(cls as any).name}`,
			);
		},
		toHaveProperty(key: string) {
			assert.ok(
				actual == null || !(key in (actual as object)),
				`Expected object NOT to have property "${key}"`,
			);
		},
		toThrow(expected?: string | RegExp | (new (...args: any[]) => Error)) {
			assert.doesNotThrow(actual as () => void);
		},
		toHaveBeenCalled() {
			const fn = actual as any;
			assert.ok(fn.mock && fn.mock.calls.length === 0, `Expected function NOT to have been called`);
		},
		toHaveBeenCalledTimes(n: number) {
			const fn = actual as any;
			assert.notStrictEqual(
				fn.mock.calls.length,
				n,
				`Expected function NOT to have been called ${n} times`,
			);
		},
		toHaveBeenCalledWith(...args: unknown[]) {
			const fn = actual as any;
			const calls = fn.mock.calls;
			const found = calls.some((call: any) => {
				try {
					assert.deepStrictEqual(call.arguments, args);
					return true;
				} catch {
					return false;
				}
			});
			assert.ok(!found, `Expected function NOT to have been called with ${JSON.stringify(args)}`);
		},
	} as Omit<ExpectMethods, "not">;

	return methods;
}

// TP-195: attach `unreachable` as a static method on `expect` so call sites
// can write `expect.unreachable(...)` per Vitest's API. The function type
// is the call signature `(actual: unknown) => ExpectMethods`; we widen it
// to include the static slot via a typed assignment + a declaration merge.
(expect as unknown as { unreachable: typeof expectUnreachable }).unreachable = expectUnreachable;

// Type declaration so consumers can call `expect.unreachable(...)` without
// a TS error. Mirrors Vitest's surface for this single static method.
export declare namespace expect {
	export function unreachable(message?: string): never;
}
