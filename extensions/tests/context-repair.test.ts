/**
 * Context ordering-repair tests — issue #621 (defense in depth).
 *
 * repairToolResultOrdering() reorders the outgoing pi context so every assistant
 * tool_use is immediately followed by its matching toolResult(s), relocating any
 * spliced-in custom/user messages to after the tool-result group. This is the
 * in-memory equivalent of the on-disk session heal, applied before every
 * provider request via the pi `context` event.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/context-repair.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { repairToolResultOrdering } from "../taskplane/context-repair.ts";

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const custom = (text: string) => ({ role: "custom", customType: "supervisor-x", content: [{ type: "text", text }] });
const asst = (id: string, text = "") => ({
	role: "assistant",
	content: [
		{ type: "text", text },
		{ type: "toolCall", id, name: "orch_status" },
	],
});
const asstMulti = (...ids: string[]) => ({
	role: "assistant",
	content: ids.map((id) => ({ type: "toolCall", id, name: "orch_status" })),
});
const result = (id: string) => ({ role: "toolResult", toolCallId: id, content: [{ type: "text", text: "ok" }] });

function roles(msgs: Array<Record<string, unknown>>): string[] {
	return msgs.map((m) => (m.role === "toolResult" ? `R:${m.toolCallId}` : m.role === "assistant" ? `A:${toolIds(m)}` : String(m.role)));
}
function toolIds(m: Record<string, unknown>): string {
	const c = m.content as Array<{ type: string; id?: string }>;
	return c.filter((b) => b.type === "toolCall").map((b) => b.id).join(",");
}

describe("#621 — repairToolResultOrdering", () => {
	it("returns the same array reference when already well-formed", () => {
		const msgs = [user("hi"), asst("t1"), result("t1"), user("next")];
		expect(repairToolResultOrdering(msgs) === msgs).toBe(true);
	});

	it("moves a single spliced custom message to after the tool_result", () => {
		const msgs = [user("hi"), asst("t1"), custom("batch summary"), result("t1"), user("next")];
		const out = repairToolResultOrdering(msgs);
		expect(out === msgs).toBe(false);
		expect(roles(out)).toEqual(["user", "A:t1", "R:t1", "custom", "user"]);
	});

	it("moves multiple spliced messages to after the tool_result", () => {
		const msgs = [asst("t1"), custom("a"), custom("b"), result("t1")];
		const out = repairToolResultOrdering(msgs);
		expect(roles(out)).toEqual(["A:t1", "R:t1", "custom", "custom"]);
	});

	it("preserves grouped parallel tool_results already in place", () => {
		const msgs = [asstMulti("t1", "t2", "t3"), result("t1"), result("t2"), result("t3"), user("x")];
		expect(repairToolResultOrdering(msgs) === msgs).toBe(true);
	});

	it("repairs a splice within a parallel tool-result group", () => {
		const msgs = [asstMulti("t1", "t2", "t3"), result("t1"), result("t2"), custom("splice"), result("t3")];
		const out = repairToolResultOrdering(msgs);
		expect(roles(out)).toEqual(["A:t1,t2,t3", "R:t1", "R:t2", "R:t3", "custom"]);
	});

	it("repairs multiple independent splices in one pass", () => {
		const msgs = [
			asst("t1"),
			custom("s1"),
			result("t1"),
			asst("t2"),
			custom("s2"),
			result("t2"),
		];
		const out = repairToolResultOrdering(msgs);
		expect(roles(out)).toEqual(["A:t1", "R:t1", "custom", "A:t2", "R:t2", "custom"]);
	});

	it("leaves a genuinely unanswered tool_use as-is (not repairable)", () => {
		const msgs = [asst("t1"), user("no result came")];
		expect(repairToolResultOrdering(msgs) === msgs).toBe(true);
	});

	it("is idempotent (repairing twice yields the same order)", () => {
		const msgs = [asst("t1"), custom("s"), result("t1"), user("x")];
		const once = repairToolResultOrdering(msgs);
		const twice = repairToolResultOrdering(once);
		expect(twice === once).toBe(true);
		expect(roles(twice)).toEqual(["A:t1", "R:t1", "custom", "user"]);
	});

	it("handles trivially small arrays without error", () => {
		expect(repairToolResultOrdering([]).length).toBe(0);
		const one = [asst("t1")];
		expect(repairToolResultOrdering(one) === one).toBe(true);
	});
});
