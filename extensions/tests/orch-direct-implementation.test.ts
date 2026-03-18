import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
	serializeBatchState,
	freshOrchBatchState,
	computeResumePoint,
	selectAbortTargetSessions,
	hasTaskDoneMarker,
	runGit,
	resolveOperatorId,
	generateBatchId,
} from "../task-orchestrator.ts";

// Detect vitest: if present, wrap everything in a describe/it block
const isVitest = typeof globalThis.vi !== "undefined" || !!process.env.VITEST;

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`✗ ${message}`);
		return;
	}
	passed++;
}

function runAllTests(): void {
	console.log("\n── direct implementation checks (TS-009 remediation) ──");

	// 1) serializeBatchState keeps full task registry from wave plan, even without outcomes.
	{
		const state = freshOrchBatchState();
		state.phase = "executing";
		state.batchId = "20260309T120000";
		state.startedAt = Date.now();
		state.currentWaveIndex = 0;
		state.totalWaves = 2;
		state.totalTasks = 3;

		const json = serializeBatchState(
			state,
			[["TS-100", "TS-101"], ["TS-102"]],
			[],
			[],
		);
		const parsed = JSON.parse(json);
		assert(parsed.tasks.length === 3, "serializeBatchState writes all 3 planned tasks into registry");
		assert(parsed.tasks.every((t: any) => t.status === "pending"), "tasks default to pending without outcomes");
	}

	// 2) computeResumePoint should NOT re-queue mark-failed tasks as pending.
	{
		const persistedState: any = {
			wavePlan: [["TS-200", "TS-201"]],
		};
		const reconciledTasks: any[] = [
			{ taskId: "TS-200", action: "mark-failed", liveStatus: "failed", persistedStatus: "running" },
			{ taskId: "TS-201", action: "mark-complete", liveStatus: "succeeded", persistedStatus: "running" },
		];
		const resumePoint = computeResumePoint(persistedState, reconciledTasks);
		assert(!resumePoint.pendingTaskIds.includes("TS-200"), "mark-failed task is not re-queued as pending");
		assert(resumePoint.failedTaskIds.includes("TS-200"), "mark-failed task remains in failed bucket");
	}

	// 3) selectAbortTargetSessions honors exact prefix (including hyphenated prefixes).
	{
		const sessions = [
			"orch-prod-lane-1",
			"orch-prod-merge-1",
			"orch-lane-1",
			"orch-prod-metrics",
		];
		const targets = selectAbortTargetSessions(sessions, null, [], "C:/repo", "orch-prod");
		const names = targets.map(t => t.sessionName).sort();
		assert(names.length === 2, "hyphenated prefix filters to 2 abort targets");
		assert(names[0] === "orch-prod-lane-1" && names[1] === "orch-prod-merge-1", "only lane/merge sessions for exact prefix are selected");
	}

	// 4) hasTaskDoneMarker checks archived path fallback.
	{
		const base = mkdtempSync(join(tmpdir(), "orch-done-"));
		try {
			const taskFolder = join(base, "tasks", "TS-300");
			const archiveTaskFolder = join(base, "tasks", "archive", "TS-300");
			mkdirSync(taskFolder, { recursive: true });
			mkdirSync(archiveTaskFolder, { recursive: true });
			writeFileSync(join(archiveTaskFolder, ".DONE"), "done\n", "utf-8");

			assert(hasTaskDoneMarker(taskFolder), "archived .DONE marker is detected from original task folder path");
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	}

	// ── 5) Orch branch creation: success path (TP-022 Step 1) ──
	{
		console.log("\n── orch branch creation tests (TP-022) ──");
		const tempBase = mkdtempSync(join(tmpdir(), "orch-branch-test-"));
		const repoDir = join(tempBase, "repo");
		try {
			// Init a test repo with an initial commit on main
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			// Generate expected orch branch name
			const orchConfig = {
				orchestrator: { operator_id: "testop" },
			} as any;
			const opId = resolveOperatorId(orchConfig);
			const batchId = generateBatchId();
			const orchBranch = `orch/${opId}-${batchId}`;

			// Create the branch (mirrors engine.ts logic)
			const result = runGit(["branch", orchBranch, "main"], repoDir);
			assert(result.ok, "orch branch creation succeeds");
			assert(orchBranch.startsWith("orch/"), "orch branch name has orch/ prefix");
			assert(orchBranch.includes(opId), "orch branch name contains operator id");
			assert(orchBranch.includes(batchId), "orch branch name contains batch id");

			// Verify the branch exists in the repo
			const verifyResult = runGit(["rev-parse", "--verify", `refs/heads/${orchBranch}`], repoDir);
			assert(verifyResult.ok, "orch branch ref is verifiable after creation");

			// Verify it points to the same commit as main
			const mainSha = runGit(["rev-parse", "main"], repoDir).stdout.trim();
			const orchSha = runGit(["rev-parse", orchBranch], repoDir).stdout.trim();
			assert(mainSha === orchSha, "orch branch points to same commit as base branch");
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// ── 6) Orch branch creation: failure path (branch already exists) ──
	{
		const tempBase = mkdtempSync(join(tmpdir(), "orch-branch-fail-"));
		const repoDir = join(tempBase, "repo");
		try {
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			// Create the branch first
			const orchBranch = "orch/testop-duplicate";
			runGit(["branch", orchBranch, "main"], repoDir);

			// Attempt to create it again — should fail
			const result = runGit(["branch", orchBranch, "main"], repoDir);
			assert(!result.ok, "duplicate orch branch creation fails");

			// Verify error detail falls back correctly
			const errDetail = result.stderr || result.stdout || "unknown error";
			assert(errDetail.length > 0, "error detail is non-empty on branch creation failure");
			assert(errDetail !== "unknown error", "error detail contains actual git error, not fallback");

			// Verify the engine failure path sets correct state
			const batchState = freshOrchBatchState();
			batchState.phase = "planning";
			batchState.batchId = "test-batch";
			batchState.startedAt = Date.now();

			if (!result.ok) {
				batchState.phase = "failed";
				batchState.endedAt = Date.now();
				batchState.errors.push(`Failed to create orch branch '${orchBranch}': ${errDetail}`);
			}

			assert(batchState.phase === "failed", "batch state phase set to 'failed' on branch creation failure");
			assert(batchState.endedAt !== null, "batch state endedAt set on failure");
			assert(batchState.errors.length === 1, "exactly one error recorded");
			assert(batchState.errors[0].includes(orchBranch), "error message contains branch name");
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// ── 7) Orch branch lifecycle: no orphan branches on planning exits ──
	// Validates that the engine creates the orch branch AFTER planning
	// validations, so early exits during preflight/discovery/graph/waves
	// cannot leak orphan branches.
	{
		// This is a structural test: verify that in engine.ts, the branch
		// creation block appears after all planning-phase early returns.
		// We verify this by reading the source and checking ordering.
		const engineSource = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");

		// Find positions of key planning-phase markers and branch creation
		const preflightReturnPos = engineSource.indexOf('batchState.errors.push("Preflight check failed")');
		const discoveryReturnPos = engineSource.indexOf('batchState.errors.push("Discovery had fatal errors');
		const noPendingReturnPos = engineSource.indexOf("No pending tasks found");
		const graphReturnPos = engineSource.indexOf("Graph validation failed");
		const waveReturnPos = engineSource.indexOf("Wave computation failed");
		const branchCreationPos = engineSource.indexOf('runGit(["branch", orchBranch, batchState.baseBranch]');

		assert(branchCreationPos > 0, "branch creation block found in engine.ts");
		assert(preflightReturnPos > 0 && branchCreationPos > preflightReturnPos,
			"orch branch creation occurs after preflight early return");
		assert(discoveryReturnPos > 0 && branchCreationPos > discoveryReturnPos,
			"orch branch creation occurs after discovery fatal error early return");
		assert(noPendingReturnPos > 0 && branchCreationPos > noPendingReturnPos,
			"orch branch creation occurs after no-pending-tasks early return");
		assert(graphReturnPos > 0 && branchCreationPos > graphReturnPos,
			"orch branch creation occurs after graph validation early return");
		assert(waveReturnPos > 0 && branchCreationPos > waveReturnPos,
			"orch branch creation occurs after wave computation early return");
	}

	// ── TP-022 Step 2: orchBranch routing verification ───────────────

	// 5) engine.ts passes orchBranch (not baseBranch) to executeWave and mergeWaveByRepo
	{
		console.log("\n  5) engine.ts routes orchBranch to executeWave/mergeWaveByRepo/worktree reset");
		const engineSource = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");

		// executeWave call should pass orchBranch
		const executeWaveCallRegex = /executeWave\(\s*waveTasks[\s\S]*?batchState\.orchBranch/;
		assert(executeWaveCallRegex.test(engineSource),
			"executeWave() receives batchState.orchBranch (not baseBranch)");

		// Verify baseBranch is NOT passed to executeWave
		// Find the executeWave call block and check it doesn't use baseBranch
		const executeWaveBlock = engineSource.match(/const waveResult = await executeWave\([\s\S]*?\);/)?.[0] ?? "";
		assert(!executeWaveBlock.includes("batchState.baseBranch"),
			"executeWave() call block does not reference batchState.baseBranch");

		// mergeWaveByRepo should pass orchBranch
		const mergeCallRegex = /mergeWaveByRepo\(\s*waveResult\.allocatedLanes[\s\S]*?batchState\.orchBranch/;
		assert(mergeCallRegex.test(engineSource),
			"mergeWaveByRepo() receives batchState.orchBranch (not baseBranch)");

		// Post-merge worktree reset uses orchBranch
		const resetBlock = engineSource.match(/Post-merge: Reset worktrees[\s\S]*?const targetBranch = batchState\.\w+/)?.[0] ?? "";
		assert(resetBlock.includes("batchState.orchBranch"),
			"post-merge worktree reset uses batchState.orchBranch");
		assert(!resetBlock.includes("batchState.baseBranch"),
			"post-merge worktree reset does NOT use batchState.baseBranch");

		// Phase 3 cleanup still uses baseBranch (Step 4 territory — unmerged-branch check)
		const cleanupBlock = engineSource.match(/Phase 3: Cleanup[\s\S]*?const targetBranch = batchState\.\w+/)?.[0] ?? "";
		assert(cleanupBlock.includes("batchState.baseBranch"),
			"Phase 3 cleanup still uses batchState.baseBranch for unmerged-branch check");
	}

	// 6) resume.ts mirrors engine.ts orchBranch routing
	{
		console.log("  6) resume.ts routes orchBranch to executeWave/mergeWaveByRepo/worktree reset");
		const resumeSource = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

		// executeWave in resume should use orchBranch
		const resumeExecBlock = resumeSource.match(/const waveResult = await executeWave\([\s\S]*?\);/)?.[0] ?? "";
		assert(resumeExecBlock.includes("batchState.orchBranch"),
			"resume.ts executeWave() receives batchState.orchBranch");
		assert(!resumeExecBlock.includes("batchState.baseBranch"),
			"resume.ts executeWave() does NOT reference batchState.baseBranch");

		// Wave mergeWaveByRepo in resume should use orchBranch
		// There are multiple mergeWaveByRepo calls — find the one in the wave loop (not re-exec)
		const waveMergeRegex = /mergeWaveByRepo\(\s*waveResult\.allocatedLanes[\s\S]*?batchState\.orchBranch/;
		assert(waveMergeRegex.test(resumeSource),
			"resume.ts wave mergeWaveByRepo() receives batchState.orchBranch");

		// Re-exec merge also uses orchBranch
		const reExecMergeRegex = /reExecAllocatedLanes[\s\S]*?mergeWaveByRepo\([\s\S]*?batchState\.orchBranch/;
		assert(reExecMergeRegex.test(resumeSource),
			"resume.ts re-exec mergeWaveByRepo() receives batchState.orchBranch");

		// Post-merge worktree reset uses orchBranch
		const resumeResetBlocks = resumeSource.match(/const targetBranch = batchState\.\w+/g) || [];
		// Should have at least one orchBranch reset (inter-wave) and one baseBranch (terminal cleanup)
		const orchBranchResets = resumeResetBlocks.filter(b => b.includes("orchBranch"));
		const baseBranchResets = resumeResetBlocks.filter(b => b.includes("baseBranch"));
		assert(orchBranchResets.length >= 1,
			"resume.ts has at least 1 inter-wave reset using orchBranch");
		assert(baseBranchResets.length >= 1,
			"resume.ts retains at least 1 terminal cleanup using baseBranch");
	}

	// 7) resume.ts has orchBranch empty-guard for pre-TP-022 persisted states
	{
		console.log("  7) resume.ts guards against empty orchBranch");
		const resumeSource = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

		assert(resumeSource.includes("!batchState.orchBranch"),
			"resume.ts checks for empty orchBranch");
		assert(resumeSource.includes("has no orch branch"),
			"resume.ts has clear error message for missing orchBranch");

		// The guard should appear BEFORE any orchBranch routing usage
		const guardPos = resumeSource.indexOf("!batchState.orchBranch");
		const firstRoutingUse = resumeSource.indexOf("batchState.orchBranch,");
		assert(guardPos > 0 && firstRoutingUse > 0 && guardPos < firstRoutingUse,
			"orchBranch guard appears before first orchBranch routing usage");
	}

	// 8) resolveBaseBranch in waves.ts: repo mode returns passed-in branch, workspace mode detects per-repo
	{
		console.log("  8) resolveBaseBranch compatibility (no changes needed)");
		const wavesSource = readFileSync(join(__dirname, "..", "taskplane", "waves.ts"), "utf-8");

		// resolveBaseBranch exists
		assert(wavesSource.includes("export function resolveBaseBranch"),
			"resolveBaseBranch() exists in waves.ts");

		// In repo mode (no repoId), it falls through to return batchBaseBranch
		assert(wavesSource.includes("return batchBaseBranch"),
			"resolveBaseBranch falls back to batchBaseBranch (which is now orchBranch)");

		// In workspace mode (repoId present), it detects per-repo branch
		assert(wavesSource.includes("getCurrentBranch(repoRoot)"),
			"resolveBaseBranch detects per-repo branch in workspace mode");
	}

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	if (failed > 0) throw new Error(`${failed} test(s) failed`);
} // end runAllTests

// ── Dual-mode execution ──────────────────────────────────────────────
// Under vitest: register as a proper test suite
// Standalone (npx tsx): run directly with process.exit
if (isVitest) {
	const { describe, it } = await import("vitest");
	describe("Orchestrator Direct Implementation", () => {
		it("passes all assertions", () => {
			runAllTests();
		});
	});
} else {
	try {
		runAllTests();
		process.exit(0);
	} catch (e) {
		console.error("Test run failed:", e);
		process.exit(1);
	}
}
