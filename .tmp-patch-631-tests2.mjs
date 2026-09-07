import { readFileSync, writeFileSync } from "node:fs";
function patch(f, pairs) {
	let s = readFileSync(f, "utf8");
	for (const [a, b] of pairs) {
		const n = s.split(a).length - 1;
		if (n !== 1) {
			console.error("anchor count", n, "in", f, ":", a.slice(0, 80));
			process.exit(1);
		}
		s = s.replace(a, b);
	}
	writeFileSync(f, s);
	console.log("patched", f);
}

// ── issue-631 test: rewrite the extension wiring tests ──
{
	const f = "extensions/tests/issue-631-inherited-engine.test.ts";
	let s = readFileSync(f, "utf8");
	const start = s.indexOf('\tit("extension.ts: engine identity recorded on first state-sync');
	const end = s.indexOf('\tit("extension.ts: takeover records priorSupervisor');
	if (start < 0 || end < 0) {
		console.error("wiring block markers", start, end);
		process.exit(1);
	}
	const replacement = `	it("extension.ts: engine identity is published BEFORE init for BOTH modes (preallocated batchId); start refused if it cannot be", () => {
		const src = readSrc("extension.ts");
		const flat = src.replace(/\\s+/g, " ");
		// The identity write precedes child.send(init).
		const writeIdx = src.indexOf("const published = writeEngineIdentity(engineStateRoot, {");
		const initIdx = src.indexOf('child.send({ type: "init", data: wkData });');
		expect(writeIdx).toBeGreaterThan(-1);
		expect(initIdx).toBeGreaterThan(writeIdx);
		expect(flat).toContain("if (!published) {");
		expect(flat).toContain("Engine start refused: could not publish engine identity");
		// The engine adopts the parent's preallocated id (fresh) / the gated target (resume).
		expect(flat).toContain("const authorizedBatchId = generateBatchId(); orchBatchState.batchId = authorizedBatchId;");
		expect(flat).toContain("authorizedBatchId: resumeTargetBatchId ?? undefined,");
		// No more first-state-sync identity hook.
		expect(src).not.toContain("recordEngineIdentity(");
		// Exit marking is pid-scoped.
		expect(flat).toContain(
			'markEngineExited(engineStateRoot, engineIdentityBatchId, { pid: enginePid, exitCode: code, exitReason: "child-exit", })',
		);
	});

	it("engine adopts the authorized batchId; resume refuses a target mismatch", () => {
		const worker = readSrc("engine-worker.ts").replace(/\\s+/g, " ");
		expect(worker).toContain("authorizedBatchId?: string;");
		expect(worker).toContain("if (data.authorizedBatchId) batchState.batchId = data.authorizedBatchId;");
		const engine = readSrc("engine.ts").replace(/\\s+/g, " ");
		expect(engine).toContain("batchState.batchId = batchState.batchId || generateBatchId();");
		const resume = readSrc("resume.ts").replace(/\\s+/g, " ");
		expect(resume).toContain("if (batchState.batchId && persistedState.batchId !== batchState.batchId) {");
		expect(resume).toContain("resume target mismatch");
	});

	it("extension.ts: main-thread fallback engine publishes its own identity and is tracked as attached", () => {
		const flat = readSrc("extension.ts").replace(/\\s+/g, " ");
		expect(flat).toContain("let fallbackEngineActive = false;");
		expect(flat).toContain("fallbackEngineActive = true; startBatchAsync(fallbackFn, batchState, ctx, updateWidget, () => { fallbackEngineActive = false;");
		expect(flat).toContain('markEngineExited(fbStateRoot, fbBatchId, { pid: process.pid, exitReason: "fallback-settled" })');
		expect(flat).toContain("if (isFallbackEngineActive()) return true;");
		// engineAttachedHere uses actual termination evidence, not \`killed\` (signal dispatched).
		expect(flat).toContain("activeWorker !== null && activeWorker.exitCode === null && activeWorker.signalCode === null");
	});

	it("extension.ts: ONE ownership gate, applied to resume/retry/skip/force-merge/admin-pause against the actual target", () => {
		const src = readSrc("extension.ts");
		const flat = src.replace(/\\s+/g, " ");
		for (const op of ["orch_resume", "orch_retry_task", "orch_skip_task", "orch_force_merge", "orch_pause (administrative)"]) {
			expect(flat.includes(\`recoveryOwnershipGate("\${op}"\`) || flat.includes(\`recoveryOwnershipGate( "\${op}"\`)).toBe(true);
		}
		// The old partial guards are gone.
		expect(src).not.toContain("function activePhaseGuard(");
		expect(src).not.toContain("function foreignEngineAliveRefusal(");
		expect(/Cannot retry task while batch is \\$\\{orchBatchState\\.phase\\}\\. Pause or wait/.test(src)).toBe(false);
		expect(/Cannot skip task while batch is \\$\\{orchBatchState\\.phase\\}\\. Pause or wait/.test(src)).toBe(false);
		expect(/Cannot force merge while batch is \\$\\{orchBatchState\\.phase\\}\\. Pause or wait/.test(src)).toBe(false);
		expect(/A batch is currently \\$\\{orchBatchState\\.phase\\} \\(\\$\\{orchBatchState\\.batchId\\}\\)\\. Cannot resume\\./.test(src)).toBe(false);
		// Case 1: a locally attached engine refuses even when the cached phase is terminal (teardown race).
		expect(flat).toContain("is still shutting down");
		// Target resolution includes force-resume reconstruction so the gated batch == the resumed batch.
		expect(flat).toContain("function resolveRecoveryTarget(");
		expect(flat).toContain("const r = reconstructBatchStateFromRuntime(stateRoot);");
		expect(flat).toContain("const resumeTarget = resolveRecoveryTarget(resumeStateRoot, force);");
	});

	it("extension.ts: orch_confirm_engine_shutdown tool + /orch-confirm-engine-shutdown command share one audited helper", () => {
		const flat = readSrc("extension.ts").replace(/\\s+/g, " ");
		expect(flat).toContain('name: "orch_confirm_engine_shutdown"');
		expect(flat).toContain('pi.registerCommand("orch-confirm-engine-shutdown"');
		expect(flat.split("doOrchConfirmEngineShutdown(").length - 1).toBe(3); // def + tool + command
		expect(flat).toContain("recordOperatorConfirmedShutdown(stateRoot, batchId, {");
		expect(flat).toContain('action: "confirm_engine_shutdown"');
	});

`;
	s = s.slice(0, start) + replacement + s.slice(end);
	writeFileSync(f, s);
	console.log("patched", f);
}

// ── issue-631 test: rewrite the extension wiring tests ──
{
	const f = "extensions/tests/issue-631-inherited-engine.test.ts";
	let s = readFileSync(f, "utf8");
	const start = s.indexOf('\tit("extension.ts: engine identity recorded on first state-sync');
	const end = s.indexOf('\tit("extension.ts: takeover records priorSupervisor');
	if (start < 0 || end < 0) {
		console.error("wiring block markers", start, end);
		process.exit(1);
	}
	const replacement = `	it("extension.ts: engine identity is published BEFORE init for BOTH modes (preallocated batchId); start refused if it cannot be", () => {
		const src = readSrc("extension.ts");
		const flat = src.replace(/\\s+/g, " ");
		// The identity write precedes child.send(init).
		const writeIdx = src.indexOf("const published = writeEngineIdentity(engineStateRoot, {");
		const initIdx = src.indexOf('child.send({ type: "init", data: wkData });');
		expect(writeIdx).toBeGreaterThan(-1);
		expect(initIdx).toBeGreaterThan(writeIdx);
		expect(flat).toContain("if (!published) {");
		expect(flat).toContain("Engine start refused: could not publish engine identity");
		// The engine adopts the parent's preallocated id (fresh) / the gated target (resume).
		expect(flat).toContain("const authorizedBatchId = generateBatchId(); orchBatchState.batchId = authorizedBatchId;");
		expect(flat).toContain("authorizedBatchId: resumeTargetBatchId ?? undefined,");
		// No more first-state-sync identity hook.
		expect(src).not.toContain("recordEngineIdentity(");
		// Exit marking is pid-scoped.
		expect(flat).toContain(
			'markEngineExited(engineStateRoot, engineIdentityBatchId, { pid: enginePid, exitCode: code, exitReason: "child-exit", })',
		);
	});

	it("engine adopts the authorized batchId; resume refuses a target mismatch", () => {
		const worker = readSrc("engine-worker.ts").replace(/\\s+/g, " ");
		expect(worker).toContain("authorizedBatchId?: string;");
		expect(worker).toContain("if (data.authorizedBatchId) batchState.batchId = data.authorizedBatchId;");
		const engine = readSrc("engine.ts").replace(/\\s+/g, " ");
		expect(engine).toContain("batchState.batchId = batchState.batchId || generateBatchId();");
		const resume = readSrc("resume.ts").replace(/\\s+/g, " ");
		expect(resume).toContain("if (batchState.batchId && persistedState.batchId !== batchState.batchId) {");
		expect(resume).toContain("resume target mismatch");
	});

	it("extension.ts: main-thread fallback engine publishes its own identity and is tracked as attached", () => {
		const flat = readSrc("extension.ts").replace(/\\s+/g, " ");
		expect(flat).toContain("let fallbackEngineActive = false;");
		expect(flat).toContain("fallbackEngineActive = true; startBatchAsync(fallbackFn, batchState, ctx, updateWidget, () => { fallbackEngineActive = false;");
		expect(flat).toContain('markEngineExited(fbStateRoot, fbBatchId, { pid: process.pid, exitReason: "fallback-settled" })');
		expect(flat).toContain("if (isFallbackEngineActive()) return true;");
		// engineAttachedHere uses actual termination evidence, not \`killed\` (signal dispatched).
		expect(flat).toContain("activeWorker !== null && activeWorker.exitCode === null && activeWorker.signalCode === null");
	});

	it("extension.ts: ONE ownership gate, applied to resume/retry/skip/force-merge/admin-pause against the actual target", () => {
		const src = readSrc("extension.ts");
		const flat = src.replace(/\\s+/g, " ");
		for (const op of ["orch_resume", "orch_retry_task", "orch_skip_task", "orch_force_merge", "orch_pause (administrative)"]) {
			expect(flat.includes(\`recoveryOwnershipGate("\${op}"\`) || flat.includes(\`recoveryOwnershipGate( "\${op}"\`)).toBe(true);
		}
		// The old partial guards are gone.
		expect(src).not.toContain("function activePhaseGuard(");
		expect(src).not.toContain("function foreignEngineAliveRefusal(");
		expect(/Cannot retry task while batch is \\$\\{orchBatchState\\.phase\\}\\. Pause or wait/.test(src)).toBe(false);
		expect(/Cannot skip task while batch is \\$\\{orchBatchState\\.phase\\}\\. Pause or wait/.test(src)).toBe(false);
		expect(/Cannot force merge while batch is \\$\\{orchBatchState\\.phase\\}\\. Pause or wait/.test(src)).toBe(false);
		expect(/A batch is currently \\$\\{orchBatchState\\.phase\\} \\(\\$\\{orchBatchState\\.batchId\\}\\)\\. Cannot resume\\./.test(src)).toBe(false);
		// Case 1: a locally attached engine refuses even when the cached phase is terminal (teardown race).
		expect(flat).toContain("is still shutting down");
		// Target resolution includes force-resume reconstruction so the gated batch == the resumed batch.
		expect(flat).toContain("function resolveRecoveryTarget(");
		expect(flat).toContain("const r = reconstructBatchStateFromRuntime(stateRoot);");
		expect(flat).toContain("const resumeTarget = resolveRecoveryTarget(resumeStateRoot, force);");
	});

	it("extension.ts: orch_confirm_engine_shutdown tool + /orch-confirm-engine-shutdown command share one audited helper", () => {
		const flat = readSrc("extension.ts").replace(/\\s+/g, " ");
		expect(flat).toContain('name: "orch_confirm_engine_shutdown"');
		expect(flat).toContain('pi.registerCommand("orch-confirm-engine-shutdown"');
		expect(flat.split("doOrchConfirmEngineShutdown(").length - 1).toBe(3); // def + tool + command
		expect(flat).toContain("recordOperatorConfirmedShutdown(stateRoot, batchId, {");
		expect(flat).toContain('action: "confirm_engine_shutdown"');
	});

`;
	s = s.slice(0, start) + replacement + s.slice(end);
	// drop the now-duplicated/obsolete later tests in the same block
	for (const title of [
		'	it("extension.ts: ownership is checked against the PERSISTED target',
		'	it("extension.ts: orch_confirm_engine_shutdown tool is registered',
	]) {
		const a = s.indexOf(title);
		if (a < 0) {
			console.error("missing", title);
			process.exit(1);
		}
		const b = s.indexOf("\n\t});\n", a) + "\n\t});\n".length;
		s = s.slice(0, a) + s.slice(b).replace(/^\n/, "");
	}
	writeFileSync(f, s);
	console.log("patched", f);
}

patch("extensions/tests/non-blocking-engine.test.ts", [
	[
		`\t\texpect(resumeHelper.replace(/\\s+/g, " ")).toContain('activePhaseGuard( "orch_resume"');
		const guardHelper = extSource.substring(
			extSource.indexOf("function activePhaseGuard("),
			extSource.indexOf("function activePhaseGuard(") + 1200,
		);
		expect(guardHelper).toContain('"launching"');
		expect(/Cannot \\$\\{operation\\} while batch is/.test(guardHelper)).toBe(true);`,
		`\t\t// #631: doOrchResume runs the single ownership gate against the resolved target;
		// case 1 of the gate refuses while an engine is attached to this process in
		// ANY active phase (launching included) — the double-start guard.
		expect(resumeHelper.replace(/\\s+/g, " ")).toContain('recoveryOwnershipGate("orch_resume"');
		const gate = extSource.substring(
			extSource.indexOf("function recoveryOwnershipGate("),
			extSource.indexOf("function recoveryOwnershipGate(") + 1800,
		);
		expect(gate).toContain("if (engineAttachedHere()) {");
		expect(/Cannot \\$\\{operation\\} while batch/.test(gate)).toBe(true);`,
	],
]);

patch("extensions/tests/supervisor-force-merge.test.ts", [
	[
		`\t\t// #631: delegated to the shared activePhaseGuard (active phases listed there).
		expect(fnBlock).toContain('activePhaseGuard("orch_force_merge"');
		const guardStart = extensionSource.indexOf("function activePhaseGuard(");
		const guardBlock = extensionSource.slice(guardStart, guardStart + 1200);
		expect(guardBlock).toContain("activePhases");
		expect(guardBlock).toContain("launching");
		expect(guardBlock).toContain("executing");
		expect(guardBlock).toContain("merging");`,
		`\t\t// #631: delegated to the single ownership gate (refuses while an engine is
		// attached to this process — launching/executing/merging included).
		expect(fnBlock).toContain('recoveryOwnershipGate("orch_force_merge"');
		const gateStart = extensionSource.indexOf("function recoveryOwnershipGate(");
		expect(extensionSource.slice(gateStart, gateStart + 1800)).toContain("if (engineAttachedHere()) {");`,
	],
]);

patch("extensions/tests/supervisor-recovery-tools.test.ts", [
	[
		`\t\t// #631: active-phase rejection delegated to the shared activePhaseGuard.
		expect(block).toContain('activePhaseGuard("orch_retry_task"');
		const g = extensionSource.indexOf("function activePhaseGuard(");
		const guard = extensionSource.slice(g, g + 1200);
		for (const p of ["launching", "executing", "merging", "planning"]) expect(guard).toContain(p);`,
		`\t\t// #631: rejection while the engine runs is case 1 of the single ownership gate.
		expect(block).toContain('recoveryOwnershipGate("orch_retry_task"');
		const g = extensionSource.indexOf("function recoveryOwnershipGate(");
		expect(extensionSource.slice(g, g + 1800)).toContain("if (engineAttachedHere()) {");`,
	],
	[
		`\t\t// #631: active-phase rejection delegated to the shared activePhaseGuard.
		expect(block).toContain('activePhaseGuard("orch_skip_task"');`,
		`\t\t// #631: rejection while the engine runs is case 1 of the single ownership gate.
		expect(block).toContain('recoveryOwnershipGate("orch_skip_task"');`,
	],
]);
