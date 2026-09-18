/**
 * Dashboard SSE backpressure + liveness — heap-OOM fix.
 *
 * A stalled SSE client used to accumulate every broadcast in its write buffer
 * (res.write never throws), reaching V8's heap limit after ~39 h of a penster
 * batch. The broadcast path must skip stalled clients, drop them after a
 * bounded number of stalled ticks, and the SSE handler must remove clients on
 * close/error from either side and ping so dead peers surface.
 */

import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "..", "..", "dashboard", "server.cjs"), "utf-8").replace(
	/\r\n/g,
	"\n",
);

function extract(startMarker: string, endMarker: string): string {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start);
	if (start < 0 || end < 0) throw new Error(`cannot extract ${startMarker}`);
	return source.slice(start, end);
}

// Pull the constants + writeToSseClients as a pure module.
const block = extract("const SSE_MAX_BUFFERED_BYTES", "function handleSSE(req, res) {");
const factory = new Function(
	`${block}\nreturn { writeToSseClients, SSE_MAX_BUFFERED_BYTES, SSE_MAX_STALLED_TICKS };`,
);
const { writeToSseClients, SSE_MAX_BUFFERED_BYTES, SSE_MAX_STALLED_TICKS } = factory() as {
	writeToSseClients: (
		clients: Set<any>,
		payload: string,
		opts?: any,
	) => { written: number; skipped: number; dropped: number };
	SSE_MAX_BUFFERED_BYTES: number;
	SSE_MAX_STALLED_TICKS: number;
};

function fakeClient(over: Record<string, unknown> = {}) {
	const c: any = {
		writes: [] as string[],
		destroyed: false,
		writableLength: 0,
		writableNeedDrain: false,
		write(p: string) {
			c.writes.push(p);
			return true;
		},
		destroy() {
			c.destroyed = true;
		},
		...over,
	};
	return c;
}

describe("dashboard SSE — writeToSseClients", () => {
	it("writes to healthy clients and resets their stall counter", () => {
		const a = fakeClient();
		const b = fakeClient({ _sseStalledTicks: 3 });
		const clients = new Set([a, b]);
		const r = writeToSseClients(clients, "data: x\n\n");
		expect(r).toEqual({ written: 2, skipped: 0, dropped: 0 });
		expect(a.writes.length).toBe(1);
		expect(b._sseStalledTicks).toBe(0);
	});

	it("SKIPS a client whose buffer is over the cap or that needs drain — nothing is appended to its buffer", () => {
		const bloated = fakeClient({ writableLength: SSE_MAX_BUFFERED_BYTES + 1 });
		const draining = fakeClient({ writableNeedDrain: true });
		const clients = new Set([bloated, draining]);
		const r = writeToSseClients(clients, "data: x\n\n");
		expect(r).toEqual({ written: 0, skipped: 2, dropped: 0 });
		expect(bloated.writes.length).toBe(0);
		expect(draining.writes.length).toBe(0);
		expect(clients.size).toBe(2);
		expect(bloated._sseStalledTicks).toBe(1);
	});

	it("DROPS (destroy + remove) a client stalled for more than SSE_MAX_STALLED_TICKS consecutive ticks; a recovered client survives", () => {
		const dead = fakeClient({ writableNeedDrain: true });
		const flaky = fakeClient({ writableNeedDrain: true });
		const clients = new Set([dead, flaky]);
		for (let i = 0; i < SSE_MAX_STALLED_TICKS; i++) writeToSseClients(clients, "d");
		expect(clients.size).toBe(2); // at the cap, not yet dropped
		flaky.writableNeedDrain = false; // peer caught up
		const r = writeToSseClients(clients, "d");
		expect(r).toEqual({ written: 1, skipped: 0, dropped: 1 });
		expect(dead.destroyed).toBe(true);
		expect(clients.has(dead)).toBe(false);
		expect(clients.has(flaky)).toBe(true);
		expect(flaky._sseStalledTicks).toBe(0);
		expect(flaky.writes.length).toBe(1);
	});

	it("a write that throws removes the client (existing behaviour preserved)", () => {
		const boom = fakeClient({
			write() {
				throw new Error("EPIPE");
			},
		});
		const clients = new Set([boom]);
		const r = writeToSseClients(clients, "d");
		expect(r.dropped).toBe(1);
		expect(clients.size).toBe(0);
	});

	it("39-hour scenario: a permanently stalled client never accumulates more than the cap", () => {
		let buffered = 0;
		const stalled = fakeClient({
			write(p: string) {
				buffered += p.length;
				stalled.writableLength = buffered;
				return false;
			},
		});
		const clients = new Set([stalled]);
		const payload = "x".repeat(60_000);
		for (let i = 0; i < 70_000 && clients.size > 0; i++) writeToSseClients(clients, payload);
		expect(clients.size).toBe(0);
		expect(buffered).toBeLessThan(SSE_MAX_BUFFERED_BYTES + 60_000 * 2);
		expect(stalled.destroyed).toBe(true);
	});
});

describe("dashboard SSE — handler wiring", () => {
	it("handleSSE pings, sets a socket timeout, and removes the client on close/error from req AND res", () => {
		const fn = extract("function handleSSE(req, res) {", "function broadcastState() {");
		expect(fn).toContain('res.write(": ping\\n\\n");');
		expect(fn).toContain("res.socket.setTimeout(SSE_SOCKET_TIMEOUT_MS");
		expect(fn).toContain('req.on("close", remove);');
		expect(fn).toContain('req.on("error", remove);');
		expect(fn).toContain('res.on("close", remove);');
		expect(fn).toContain('res.on("error", remove);');
		expect(fn).toContain("clearInterval(ping);");
	});

	it("broadcastState goes through writeToSseClients and logs drops", () => {
		const fn = extract("function broadcastState() {", "// ─── Batch History API");
		expect(fn).toContain("const r = writeToSseClients(sseClients, payload);");
		expect(fn).toContain("dropped $" + "{r.dropped} stalled SSE client(s)");
	});
});
