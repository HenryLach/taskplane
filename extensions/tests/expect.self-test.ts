/**
 * Self-test for the expect() compatibility wrapper.
 * Run: node --experimental-strip-types --no-warnings --test tests/expect.self-test.ts
 */
import { describe, it } from "node:test";
import { expect } from "./expect.ts";

describe("expect wrapper self-test", () => {
	// ── toBe ──────────────────────────────────────────────────────
	it("toBe passes for identical values", () => {
		expect(1).toBe(1);
		expect("hello").toBe("hello");
		expect(null).toBe(null);
		expect(true).toBe(true);
	});

	it("not.toBe passes for different values", () => {
		expect(1).not.toBe(2);
		expect("a").not.toBe("b");
	});

	// ── toEqual ───────────────────────────────────────────────────
	it("toEqual with deep objects", () => {
		expect({ a: 1, b: [2, 3] }).toEqual({ a: 1, b: [2, 3] });
	});

	it("not.toEqual with different objects", () => {
		expect({ a: 1 }).not.toEqual({ a: 2 });
	});

	// ── toContain ────────────────────────────────────────────────
	it("toContain for strings", () => {
		expect("hello world").toContain("world");
	});

	it("toContain for arrays", () => {
		expect([1, 2, 3]).toContain(2);
	});

	it("not.toContain for strings", () => {
		expect("hello").not.toContain("xyz");
	});

	it("not.toContain for arrays", () => {
		expect([1, 2, 3]).not.toContain(99);
	});

	// ── toHaveLength ──────────────────────────────────────────────
	it("toHaveLength", () => {
		expect([1, 2]).toHaveLength(2);
		expect("abc").toHaveLength(3);
	});

	// ── toBeDefined / toBeUndefined ──────────────────────────────
	it("toBeDefined", () => {
		expect(42).toBeDefined();
		expect("").toBeDefined();
	});

	it("toBeUndefined", () => {
		expect(undefined).toBeUndefined();
	});

	it("not.toBeDefined means undefined", () => {
		expect(undefined).not.toBeDefined();
	});

	// ── toBeNull / not.toBeNull ──────────────────────────────────
	it("toBeNull", () => {
		expect(null).toBeNull();
	});

	it("not.toBeNull", () => {
		expect(42).not.toBeNull();
		expect(undefined).not.toBeNull();
	});

	// ── toBeTruthy / toBeFalsy ───────────────────────────────────
	it("toBeTruthy", () => {
		expect(1).toBeTruthy();
		expect("x").toBeTruthy();
		expect(true).toBeTruthy();
	});

	it("toBeFalsy", () => {
		expect(0).toBeFalsy();
		expect("").toBeFalsy();
		expect(null).toBeFalsy();
	});

	// ── comparison matchers ──────────────────────────────────────
	it("toBeGreaterThan", () => {
		expect(5).toBeGreaterThan(3);
	});

	it("toBeGreaterThanOrEqual", () => {
		expect(5).toBeGreaterThanOrEqual(5);
		expect(6).toBeGreaterThanOrEqual(5);
	});

	it("toBeLessThan", () => {
		expect(3).toBeLessThan(5);
	});

	it("toBeLessThanOrEqual", () => {
		expect(5).toBeLessThanOrEqual(5);
		expect(4).toBeLessThanOrEqual(5);
	});

	it("toBeCloseTo", () => {
		expect(0.1 + 0.2).toBeCloseTo(0.3, 5);
		expect(1.005).toBeCloseTo(1.0, 1);
	});

	// ── toMatch ──────────────────────────────────────────────────
	it("toMatch with RegExp", () => {
		expect("hello world").toMatch(/world/);
	});

	it("toMatch with string", () => {
		expect("hello world").toMatch("world");
	});

	it("not.toMatch", () => {
		expect("hello").not.toMatch(/xyz/);
		expect("hello").not.toMatch("xyz");
	});

	// ── toBeInstanceOf ──────────────────────────────────────────
	it("toBeInstanceOf", () => {
		expect(new Error("x")).toBeInstanceOf(Error);
		expect([]).toBeInstanceOf(Array);
	});

	// ── toHaveProperty ──────────────────────────────────────────
	it("toHaveProperty", () => {
		expect({ a: 1, b: 2 }).toHaveProperty("a");
	});

	it("toHaveProperty with value", () => {
		expect({ a: 1, b: 2 }).toHaveProperty("a", 1);
	});

	it("not.toHaveProperty", () => {
		expect({ a: 1 }).not.toHaveProperty("z");
	});

	// ── toThrow ──────────────────────────────────────────────────
	it("toThrow without argument", () => {
		expect(() => {
			throw new Error("boom");
		}).toThrow();
	});

	it("toThrow with RegExp", () => {
		expect(() => {
			throw new Error("boom bang");
		}).toThrow(/boom/);
	});

	it("toThrow with constructor", () => {
		expect(() => {
			throw new TypeError("bad");
		}).toThrow(TypeError);
	});

	it("not.toThrow", () => {
		expect(() => {
			/* no-op */
		}).not.toThrow();
	});
});
