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
	`${block}\nreturn { writeToSseClients, teardownSseClient, SSE_MAX_BUFFERED_BYTES, SSE_MAX_STALLED_MS };`,
);
const { writeToSseClients, teardownSseClient, SSE_MAX_BUFFERED_BYTES, SSE_MAX_STALLED_MS } =
	factory() as {
		writeToSseClients: (
			clients: Set<any>,
			payload: string,
			opts?: any,
		) => { written: number; skipped: number; dropped: number };
		teardownSseClient: (clients: Set<any>, client: any) => void;
		SSE_MAX_BUFFERED_BYTES: number;
		SSE_MAX_STALLED_MS: number;
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
	const T0 = 1_000_000;

	it("writes to healthy clients and clears their stall mark", () => {
		const a = fakeClient();
		const b = fakeClient({ _sseStalledSince: T0 - 5000 });
		const clients = new Set([a, b]);
		const r = writeToSseClients(clients, "data: x\n\n", { now: T0 });
		expect(r).toEqual({ written: 2, skipped: 0, dropped: 0 });
		expect(a.writes.length).toBe(1);
		expect(b._sseStalledSince).toBe(null);
	});

	it("SKIPS a client whose buffer is over the cap or that needs drain — nothing is appended; stall clock starts", () => {
		const bloated = fakeClient({ writableLength: SSE_MAX_BUFFERED_BYTES + 1 });
		const draining = fakeClient({ writableNeedDrain: true });
		const clients = new Set([bloated, draining]);
		const r = writeToSseClients(clients, "data: x\n\n", { now: T0 });
		expect(r).toEqual({ written: 0, skipped: 2, dropped: 0 });
		expect(bloated.writes.length).toBe(0);
		expect(clients.size).toBe(2);
		expect(bloated._sseStalledSince).toBe(T0);
	});

	it("eviction is ELAPSED-TIME based (Sage): 100 bursty broadcasts inside 3 s do not evict; > SSE_MAX_STALLED_MS does; a recovered client survives", () => {
		const dead = fakeClient({ writableNeedDrain: true });
		const flaky = fakeClient({ writableNeedDrain: true });
		const clients = new Set([dead, flaky]);
		// fs.watch debounce storm: 100 broadcasts in 3 seconds
		for (let i = 0; i < 100; i++) writeToSseClients(clients, "d", { now: T0 + i * 30 });
		expect(clients.size).toBe(2);
		// at the boundary: still kept
		writeToSseClients(clients, "d", { now: T0 + SSE_MAX_STALLED_MS });
		expect(clients.size).toBe(2);
		flaky.writableNeedDrain = false; // peer caught up just in time
		const r = writeToSseClients(clients, "d", { now: T0 + SSE_MAX_STALLED_MS + 1 });
		expect(r).toEqual({ written: 1, skipped: 0, dropped: 1 });
		expect(dead.destroyed).toBe(true);
		expect(dead._sseTornDown).toBe(true);
		expect(clients.has(dead)).toBe(false);
		expect(clients.has(flaky)).toBe(true);
		expect(flaky._sseStalledSince).toBe(null);
	});

	it("a write that throws goes through the SAME teardown: removed, destroyed, ping timer cleared (Sage)", () => {
		let cleared = false;
		const realClear = globalThis.clearInterval;
		const boom = fakeClient({
			_ssePing: 42,
			write() {
				throw new Error("EPIPE");
			},
		});
		(globalThis as any).clearInterval = (h: unknown) => {
			if (h === 42) cleared = true;
		};
		try {
			const clients = new Set([boom]);
			const r = writeToSseClients(clients, "d", { now: T0 });
			expect(r.dropped).toBe(1);
			expect(clients.size).toBe(0);
			expect(boom.destroyed).toBe(true);
			expect(boom._ssePing).toBe(null);
			expect(cleared).toBe(true);
		} finally {
			(globalThis as any).clearInterval = realClear;
		}
	});

	it("teardownSseClient is idempotent (repeated close/error events)", () => {
		let destroys = 0;
		const c = fakeClient({
			destroy() {
				destroys++;
			},
		});
		const clients = new Set([c]);
		teardownSseClient(clients, c);
		teardownSseClient(clients, c);
		teardownSseClient(clients, c);
		expect(destroys).toBe(1);
		expect(clients.size).toBe(0);
	});

	it("39-hour scenario: a permanently stalled client never accumulates more than the cap and is destroyed", () => {
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
		for (let i = 0; i < 70_000 && clients.size > 0; i++) {
			writeToSseClients(clients, payload, { now: T0 + i * 2000 });
		}
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
		// every exit path is the one teardown
		expect(fn).toContain("const remove = () => teardownSseClient(sseClients, res);");
		expect(fn).toContain(
			"res.socket.setTimeout(SSE_SOCKET_TIMEOUT_MS, () => teardownSseClient(sseClients, res));",
		);
		expect(fn).toContain("teardownSseClient(sseClients, res);"); // ping write failure
		expect(fn).not.toContain("sseClients.delete(res)");
	});

	it("broadcastState goes through writeToSseClients and logs drops", () => {
		const fn = extract("function broadcastState() {", "// ─── Batch History API");
		expect(fn).toContain("const r = writeToSseClients(sseClients, payload);");
		expect(fn).toContain("dropped $" + "{r.dropped} stalled SSE client(s)");
	});
});
