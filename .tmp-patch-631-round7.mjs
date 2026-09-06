import { readFileSync, writeFileSync } from "node:fs";
function patch(f, pairs) {
	let s = readFileSync(f, "utf8");
	for (const [a, b, count = 1] of pairs) {
		const n = s.split(a).length - 1;
		if (n !== count) {
			console.error("anchor count", n, "expected", count, "in", f, ":", a.slice(0, 90));
			process.exit(1);
		}
		s = s.split(a).join(b);
	}
	writeFileSync(f, s);
	console.log("patched", f);
}

// ── worktree.ts: deleteStaleBranches becomes BATCH-SCOPED for task/ and saved/task/ too ──
{
	const f = "extensions/taskplane/worktree.ts";
	let s = readFileSync(f, "utf8");
	const start = s.indexOf("export function deleteStaleBranches(");
	const sec1 = s.indexOf("// 1. Delete task/{opId}-lane-* branches", start);
	const sec2 = s.indexOf("// 2. Delete saved/task/{opId}-lane-* branches", start);
	const sec3 = s.indexOf("// 3. Delete saved/{opId}-*-{batchId} branches", start);
	if (start < 0 || sec1 < 0 || sec2 < 0 || sec3 < 0) {
		console.error("worktree markers", start, sec1, sec2, sec3);
		process.exit(1);
	}
	const seg1 = s.slice(sec1, sec2);
	const seg2 = s.slice(sec2, sec3);
	const scope = (seg, header) => {
		// insert a batch-suffix filter into the `for (const branch of branches)` loop
		const loopIdx = seg.indexOf("for (const branch of branches) {");
		if (loopIdx < 0) {
			console.error("no loop in", header);
			process.exit(1);
		}
		const insertAt = loopIdx + "for (const branch of branches) {".length;
		return (
			seg.slice(0, insertAt) +
			`
			// #631: BATCH-SCOPED. Lane branches carry a \`-{batchId}\` suffix
			// (task/{opId}-lane-{N}-{batchId}); an operator-wide sweep deleted the
			// refs of OTHER batches — including one whose engine was still alive and
			// never passed the ownership gate. Only this batch's refs are cleaned.
			if (!branch.endsWith(\`-\${batchId}\`)) continue;` +
			seg.slice(insertAt)
		);
	};
	s = s.slice(0, sec1) + scope(seg1, "sec1") + scope(seg2, "sec2") + s.slice(sec3);
	writeFileSync(f, s);
	console.log("patched", f);
}

// ── extension.ts ──
patch("extensions/taskplane/extension.ts", [
	// resolver: explicit branch arg that differs from persisted state must not carry that state's batchId
	[
		`\t// Source 2: CLI positional branch arg overrides or fills in
	if (parsed.orchBranchArg) {
		orchBranch = parsed.orchBranchArg;
	}`,
		`\t// Source 2: CLI positional branch arg overrides or fills in
	if (parsed.orchBranchArg) {
		// #631: an explicit branch that differs from the persisted batch's branch
		// must NOT inherit that batch's id — cleanup/history/ownership would then
		// target an unrelated batch. The batch behind the selected branch (if any)
		// is looked up from runtime artifacts by the caller.
		if (orchBranch && batchId && orchBranch !== parsed.orchBranchArg) {
			notices.push(
				\`ℹ️ Persisted batch \${batchId} belongs to \${orchBranch}; integrating \${parsed.orchBranchArg} instead — \` +
					\`batch-scoped cleanup/history will use the batch associated with that branch, if any.\`,
			);
			batchId = "";
		}
		orchBranch = parsed.orchBranchArg;
	}`,
	],
	// integrate: after the gate, bind batchId to the branch's associated batch when unique
	[
		`\t\t\t// No batch is associated with this branch (pure branch integration):
			// nothing an engine could be driving — proceed.
		}
`,
		`\t\t\t// No batch is associated with this branch (pure branch integration):
			// nothing an engine could be driving — proceed.

			// Bind cleanup/history to the batch behind THIS branch. The resolver
			// leaves batchId empty when an explicit branch differs from persisted
			// state; a unique associated runtime batch fills it in. Ambiguous (>1)
			// → leave empty: batch-scoped cleanup is skipped rather than guessed.
			if (!batchId) {
				const branchBound = [...associated.values()].filter((t) => t.phase !== "completed" || true);
				if (branchBound.length === 1) batchId = branchBound[0].batchId;
			}
		}
`,
	],
	[
		`\t\tconst { orchBranch, baseBranch, batchId, currentBranch, notices } =
			resolution as IntegrationContext;`,
		`\t\tconst { orchBranch, baseBranch, currentBranch, notices } = resolution as IntegrationContext;
		let batchId = (resolution as IntegrationContext).batchId;`,
	],
	// confirm: explicit target selector (batchId) → persisted → reconstructed → cached
	[
		`\tfunction doOrchConfirmEngineShutdown(note: string, stateRoot: string): string {
		// Resolve the SAME target the recovery gates use: persisted state first,
		// then runtime reconstruction (force-resume with no state file), and only
		// then a cached id — a stale cached id must not confirm the wrong batch.
		const target = resolveRecoveryTarget(stateRoot, true);
		const batchId = target?.batchId || orchBatchState.batchId || supervisorState.batchId || "";
		if (!batchId) return "❌ No batch to confirm shutdown for (no batch on disk, nothing reconstructable, nothing in memory).";`,
		`\tfunction doOrchConfirmEngineShutdown(note: string, stateRoot: string, explicitBatchId?: string): string {
		// Target: an EXPLICIT batchId (exactly the batch a refusal named — works for
		// meta-only legacy batches that are not reconstructable), else the same
		// target the recovery gates use: persisted → reconstructed → cached.
		const explicit = (explicitBatchId ?? "").trim();
		if (explicit && !/^[A-Za-z0-9._-]+$/.test(explicit)) {
			return \`❌ Invalid batchId "\${explicit}".\`;
		}
		const target = explicit ? null : resolveRecoveryTarget(stateRoot, true);
		const batchId =
			explicit || target?.batchId || orchBatchState.batchId || supervisorState.batchId || "";
		if (!batchId) {
			return (
				"❌ No batch to confirm shutdown for (no batch on disk, nothing reconstructable, nothing in memory). " +
				"Pass the batchId named by the refusal explicitly."
			);
		}`,
	],
	// tool: optional batchId param
	[
		`\t\tparameters: Type.Object({
			note: Type.String({
				description: "What was verified and how (e.g. 'no engine-worker processes in Get-CimInstance output at 21:32')",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const text = doOrchConfirmEngineShutdown(params.note, resolveToolStateRoot(ctx));`,
		`\t\tparameters: Type.Object({
			note: Type.String({
				description: "What was verified and how (e.g. 'no engine-worker processes in Get-CimInstance output at 21:32')",
			}),
			batchId: Type.Optional(
				Type.String({
					description:
						"Exact batchId to confirm (the one named by the refusal). Omit to use the persisted/reconstructed batch.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const text = doOrchConfirmEngineShutdown(params.note, resolveToolStateRoot(ctx), params.batchId);`,
	],
	// command: --batch <id>
	[
		`\t\thandler: async (args, ctx) => {
			const note = (args ?? "").trim();
			const stateRoot = execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd;
			const result = doOrchConfirmEngineShutdown(note, stateRoot);`,
		`\t\thandler: async (args, ctx) => {
			// Syntax: /orch-confirm-engine-shutdown [--batch <batchId>] <note>
			let raw = (args ?? "").trim();
			let explicitBatchId: string | undefined;
			const m = /(?:^|\\s)--batch\\s+(\\S+)/.exec(raw);
			if (m) {
				explicitBatchId = m[1];
				raw = raw.replace(m[0], " ").trim();
			}
			const stateRoot = execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd;
			const result = doOrchConfirmEngineShutdown(raw, stateRoot, explicitBatchId);`,
	],
	[
		`\t\tdescription:
			"Record operator-verified engine shutdown for a batch with no engine identity (#631): /orch-confirm-engine-shutdown <what you verified>",`,
		`\t\tdescription:
			"Record operator-verified engine shutdown for a batch with no engine identity (#631): /orch-confirm-engine-shutdown [--batch <batchId>] <what you verified>",`,
	],
]);
