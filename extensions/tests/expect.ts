/**
 * expect() compatibility wrapper — maps vitest's expect API to node:assert.
 *
 * This exists solely to minimize the migration diff when moving from vitest
 * to node:test.  New tests should use node:assert directly.
 */
import assert from "node:assert";

interface ExpectMethods {
	toBe(expected: unknown): void;
	toEqual(expected: unknown): void;
	toContain(needle: unknown): void;
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
				assert.ok(
					actual.includes(needle),
					`Expected array to contain ${JSON.stringify(needle)}`,
				);
			} else {
				assert.fail(`toContain: actual is neither string nor array`);
			}
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
			assert.ok(
				(actual as number) > n,
				`Expected ${actual} > ${n}`,
			);
		},
		toBeGreaterThanOrEqual(n: number) {
			assert.ok(
				(actual as number) >= n,
				`Expected ${actual} >= ${n}`,
			);
		},
		toBeLessThan(n: number) {
			assert.ok(
				(actual as number) < n,
				`Expected ${actual} < ${n}`,
			);
		},
		toBeLessThanOrEqual(n: number) {
			assert.ok(
				(actual as number) <= n,
				`Expected ${actual} <= ${n}`,
			);
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
			assert.ok(
				fn.mock && fn.mock.calls.length > 0,
				`Expected function to have been called`,
			);
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
				assert.ok(
					!actual.includes(needle),
					`Expected array NOT to contain ${JSON.stringify(needle)}`,
				);
			} else {
				assert.fail(`not.toContain: actual is neither string nor array`);
			}
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
			assert.ok(
				(actual as number) <= n,
				`Expected ${actual} to NOT be greater than ${n}`,
			);
		},
		toBeGreaterThanOrEqual(n: number) {
			assert.ok(
				(actual as number) < n,
				`Expected ${actual} to NOT be >= ${n}`,
			);
		},
		toBeLessThan(n: number) {
			assert.ok(
				(actual as number) >= n,
				`Expected ${actual} to NOT be less than ${n}`,
			);
		},
		toBeLessThanOrEqual(n: number) {
			assert.ok(
				(actual as number) > n,
				`Expected ${actual} to NOT be <= ${n}`,
			);
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
			assert.ok(
				fn.mock && fn.mock.calls.length === 0,
				`Expected function NOT to have been called`,
			);
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
