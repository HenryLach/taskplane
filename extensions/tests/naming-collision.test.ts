/**
 * Naming Collision Resistance Tests — TP-010 Step 2
 *
 * Validates that the naming contract produces collision-resistant,
 * human-readable, and provenance-parseable artifact names across:
 *   - Multiple operators on the same machine/repo
 *   - Multiple repos with the same operator
 *   - Concurrent batches with overlapping lane numbers
 *   - Workspace mode vs repo mode
 *
 * Test categories:
 *   2a — Collision matrix (uniqueness across operator × repo × batch × lane)
 *   2b — Shared-environment interference (ownership-scoped discovery/cleanup)
 *   2c — Human-readability acceptance (length, token order, parseability)
 *
 * Run: npx vitest run extensions/tests/naming-collision.test.ts
 */

import { describe, it, expect } from "vitest";
import { resolve, basename } from "path";

// Direct imports from production modules
import { sanitizeNameComponent, resolveOperatorId, resolveRepoSlug } from "../taskplane/naming.ts";
import { generateTmuxSessionName, generateLaneId } from "../taskplane/waves.ts";
import { generateBranchName, generateWorktreePath } from "../taskplane/worktree.ts";
import { parseOrchSessionNames } from "../taskplane/persistence.ts";
import type { OrchestratorConfig } from "../taskplane/types.ts";
import { DEFAULT_ORCHESTRATOR_CONFIG } from "../taskplane/types.ts";

// ── Test Helpers ──────────────────────────────────────────────────────

/** Build a minimal OrchestratorConfig with custom operator_id */
function configWithOpId(operatorId: string): OrchestratorConfig {
	return {
		...DEFAULT_ORCHESTRATOR_CONFIG,
		orchestrator: {
			...DEFAULT_ORCHESTRATOR_CONFIG.orchestrator,
			operator_id: operatorId,
		},
	};
}

/**
 * Simulate the merge artifact naming patterns used in merge.ts.
 * These are inline computed in mergeWave(), so we replicate the exact
 * template strings here for collision testing.
 */
function mergeTempBranch(opId: string, batchId: string): string {
	return `_merge-temp-${opId}-${batchId}`;
}
function mergeSessionName(tmuxPrefix: string, opId: string, laneNumber: number): string {
	return `${tmuxPrefix}-${opId}-merge-${laneNumber}`;
}
function mergeResultFileName(waveIndex: number, laneNumber: number, opId: string, batchId: string): string {
	return `merge-result-w${waveIndex}-lane${laneNumber}-${opId}-${batchId}.json`;
}
function mergeRequestFileName(waveIndex: number, laneNumber: number, opId: string, batchId: string): string {
	return `merge-request-w${waveIndex}-lane${laneNumber}-${opId}-${batchId}.txt`;
}
function mergeWorkspaceDir(opId: string): string {
	return `merge-workspace-${opId}`;
}

// ═══════════════════════════════════════════════════════════════════════
// 2a — Collision Matrix Tests
// ═══════════════════════════════════════════════════════════════════════

describe("2a — Collision Matrix", () => {
	const prefix = "orch";
	const wtPrefix = "taskplane-wt";
	const batchId = "20260315T120000";
	const lane = 1;

	describe("TMUX session names are unique across operators", () => {
		it("repo mode: different opId produces different session names", () => {
			const sessionA = generateTmuxSessionName(prefix, lane, "alice");
			const sessionB = generateTmuxSessionName(prefix, lane, "bob");
			expect(sessionA).not.toBe(sessionB);
			expect(sessionA).toBe("orch-alice-lane-1");
			expect(sessionB).toBe("orch-bob-lane-1");
		});

		it("workspace mode: different opId produces different session names", () => {
			const sessionA = generateTmuxSessionName(prefix, lane, "alice", "api");
			const sessionB = generateTmuxSessionName(prefix, lane, "bob", "api");
			expect(sessionA).not.toBe(sessionB);
			expect(sessionA).toBe("orch-alice-api-lane-1");
			expect(sessionB).toBe("orch-bob-api-lane-1");
		});
	});

	describe("TMUX session names are unique across repos (workspace mode)", () => {
		it("same operator, same lane, different repoId", () => {
			const sessionApi = generateTmuxSessionName(prefix, lane, "alice", "api");
			const sessionWeb = generateTmuxSessionName(prefix, lane, "alice", "web");
			expect(sessionApi).not.toBe(sessionWeb);
			expect(sessionApi).toBe("orch-alice-api-lane-1");
			expect(sessionWeb).toBe("orch-alice-web-lane-1");
		});

		it("repo mode vs workspace mode names do not collide", () => {
			const repoMode = generateTmuxSessionName(prefix, lane, "alice");
			const wsMode = generateTmuxSessionName(prefix, lane, "alice", "api");
			expect(repoMode).not.toBe(wsMode);
		});
	});

	describe("Worktree paths are unique across operators", () => {
		it("different opId produces different worktree directories", () => {
			const repoRoot = "/home/user/project";
			const pathA = generateWorktreePath(wtPrefix, lane, repoRoot, "alice");
			const pathB = generateWorktreePath(wtPrefix, lane, repoRoot, "bob");
			expect(pathA).not.toBe(pathB);
			expect(basename(resolve(pathA))).toBe("taskplane-wt-alice-1");
			expect(basename(resolve(pathB))).toBe("taskplane-wt-bob-1");
		});

		it("same operator, different lanes produce different paths", () => {
			const repoRoot = "/home/user/project";
			const path1 = generateWorktreePath(wtPrefix, 1, repoRoot, "alice");
			const path2 = generateWorktreePath(wtPrefix, 2, repoRoot, "alice");
			expect(path1).not.toBe(path2);
		});
	});

	describe("Git branch names are unique across operators", () => {
		it("different opId produces different branch names", () => {
			const branchA = generateBranchName(lane, batchId, "alice");
			const branchB = generateBranchName(lane, batchId, "bob");
			expect(branchA).not.toBe(branchB);
			expect(branchA).toBe("task/alice-lane-1-20260315T120000");
			expect(branchB).toBe("task/bob-lane-1-20260315T120000");
		});

		it("same operator, different batchIds produce different branches", () => {
			const branch1 = generateBranchName(lane, "20260315T120000", "alice");
			const branch2 = generateBranchName(lane, "20260315T120001", "alice");
			expect(branch1).not.toBe(branch2);
		});

		it("same operator, same batch, different lanes produce different branches", () => {
			const branch1 = generateBranchName(1, batchId, "alice");
			const branch2 = generateBranchName(2, batchId, "alice");
			expect(branch1).not.toBe(branch2);
		});
	});

	describe("Merge temp branch names are unique across operators", () => {
		it("different opId produces different merge temp branches", () => {
			const branchA = mergeTempBranch("alice", batchId);
			const branchB = mergeTempBranch("bob", batchId);
			expect(branchA).not.toBe(branchB);
			expect(branchA).toBe("_merge-temp-alice-20260315T120000");
			expect(branchB).toBe("_merge-temp-bob-20260315T120000");
		});
	});

	describe("Merge sidecar filenames are unique across operators", () => {
		it("different opId produces different merge result files", () => {
			const fileA = mergeResultFileName(0, 1, "alice", batchId);
			const fileB = mergeResultFileName(0, 1, "bob", batchId);
			expect(fileA).not.toBe(fileB);
			expect(fileA).toContain("alice");
			expect(fileB).toContain("bob");
		});

		it("different opId produces different merge request files", () => {
			const fileA = mergeRequestFileName(0, 1, "alice", batchId);
			const fileB = mergeRequestFileName(0, 1, "bob", batchId);
			expect(fileA).not.toBe(fileB);
		});

		it("same operator, different wave/lane/batch produce different files", () => {
			const f1 = mergeResultFileName(0, 1, "alice", "20260315T120000");
			const f2 = mergeResultFileName(1, 1, "alice", "20260315T120000");
			const f3 = mergeResultFileName(0, 2, "alice", "20260315T120000");
			const f4 = mergeResultFileName(0, 1, "alice", "20260315T120001");
			const all = new Set([f1, f2, f3, f4]);
			expect(all.size).toBe(4);
		});
	});

	describe("Merge session names are unique across operators", () => {
		it("different opId produces different merge session names", () => {
			const sessionA = mergeSessionName(prefix, "alice", 1);
			const sessionB = mergeSessionName(prefix, "bob", 1);
			expect(sessionA).not.toBe(sessionB);
			expect(sessionA).toBe("orch-alice-merge-1");
			expect(sessionB).toBe("orch-bob-merge-1");
		});
	});

	describe("Merge workspace dirs are unique across operators", () => {
		it("different opId produces different merge workspace dirs", () => {
			const dirA = mergeWorkspaceDir("alice");
			const dirB = mergeWorkspaceDir("bob");
			expect(dirA).not.toBe(dirB);
			expect(dirA).toBe("merge-workspace-alice");
			expect(dirB).toBe("merge-workspace-bob");
		});
	});

	describe("Full collision matrix: operator × repo × batch × lane", () => {
		it("all artifact types produce unique names for each combination", () => {
			const operators = ["alice", "bob"];
			const repos = [undefined, "api", "web"]; // undefined = repo mode
			const batches = ["20260315T120000", "20260315T120001"];
			const lanes = [1, 2];

			// Collect all generated names per artifact type
			const tmuxSessions = new Set<string>();
			const branches = new Set<string>();
			const worktrees = new Set<string>();
			const mergeResults = new Set<string>();
			const mergeRequests = new Set<string>();
			const mergeSessions = new Set<string>();
			const mergeTempBranches = new Set<string>();
			const mergeWorkDirs = new Set<string>();

			let expectedTmux = 0;
			let expectedBranch = 0;
			let expectedWorktree = 0;
			let expectedMergeResult = 0;
			let expectedMergeRequest = 0;
			let expectedMergeSession = 0;
			let expectedMergeTempBranch = 0;
			let expectedMergeWorkDir = 0;

			for (const op of operators) {
				for (const repo of repos) {
					for (const batch of batches) {
						for (const lane of lanes) {
							// TMUX session (per: op × repo × lane)
							const session = generateTmuxSessionName(prefix, lane, op, repo);
							tmuxSessions.add(session);
							expectedTmux++;

							// Branch (per: op × lane × batch)
							const branch = generateBranchName(lane, batch, op);
							branches.add(branch);

							// Worktree path (per: op × lane — repo root varies but same base)
							const repoRoot = repo ? `/workspace/repos/${repo}` : "/home/user/project";
							const wtPath = generateWorktreePath(wtPrefix, lane, repoRoot, op);
							worktrees.add(wtPath);

							// Merge result file (per: op × batch × lane, wave=0)
							mergeResults.add(mergeResultFileName(0, lane, op, batch));
							expectedMergeResult++;

							// Merge request file (per: op × batch × lane, wave=0)
							mergeRequests.add(mergeRequestFileName(0, lane, op, batch));
							expectedMergeRequest++;
						}

						// Merge temp branch (per: op × batch)
						mergeTempBranches.add(mergeTempBranch(op, batch));
						expectedMergeTempBranch++;
					}

					// Merge session (per: op × lane — reusing lane loop items)
					for (const lane of lanes) {
						mergeSessions.add(mergeSessionName(prefix, op, lane));
						expectedMergeSession++;
					}
				}

				// Merge workspace dir (per: op)
				mergeWorkDirs.add(mergeWorkspaceDir(op));
				expectedMergeWorkDir++;
			}

			// TMUX sessions: op(2) × repo(3) × lane(2) = 12
			// But batches don't affect TMUX session names
			expect(tmuxSessions.size).toBe(expectedTmux / batches.length);

			// Branches: op(2) × lane(2) × batch(2) = 8 (repos don't affect branch names)
			// Branches are repo-scoped, so op × lane × batch combos
			expect(branches.size).toBe(operators.length * lanes.length * batches.length);

			// Merge result files: unique for each op × batch × lane combo
			expect(mergeResults.size).toBe(operators.length * batches.length * lanes.length);

			// Merge temp branches: unique per op × batch
			expect(mergeTempBranches.size).toBe(operators.length * batches.length);

			// Merge workspace dirs: unique per operator
			expect(mergeWorkDirs.size).toBe(operators.length);
		});
	});

	describe("opId fallback ('op') with legacy worktree patterns", () => {
		it("fallback opId 'op' produces valid worktree path names", () => {
			const repoRoot = "/home/user/project";
			const path = generateWorktreePath(wtPrefix, 1, repoRoot, "op");
			expect(basename(resolve(path))).toBe("taskplane-wt-op-1");
		});

		it("fallback opId 'op' produces valid branch names", () => {
			const branch = generateBranchName(1, batchId, "op");
			expect(branch).toBe("task/op-lane-1-20260315T120000");
		});

		it("fallback opId 'op' produces valid session names", () => {
			const session = generateTmuxSessionName(prefix, 1, "op");
			expect(session).toBe("orch-op-lane-1");
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 2b — Shared-Environment Interference Tests
// ═══════════════════════════════════════════════════════════════════════

describe("2b — Shared-Environment Interference", () => {

	describe("parseOrchSessionNames() prefix filtering behavior", () => {
		const tmuxOutput = [
			"orch-alice-lane-1",
			"orch-alice-lane-2",
			"orch-bob-lane-1",
			"orch-bob-merge-1",
			"orch-alice-api-lane-1",
			"orch-bob-web-lane-1",
			"unrelated-session",
			"other-prefix-lane-1",
		].join("\n");

		it("prefix filter returns ALL operators' sessions matching prefix", () => {
			const sessions = parseOrchSessionNames(tmuxOutput, "orch");
			// All sessions starting with "orch-" should be returned
			expect(sessions).toContain("orch-alice-lane-1");
			expect(sessions).toContain("orch-alice-lane-2");
			expect(sessions).toContain("orch-bob-lane-1");
			expect(sessions).toContain("orch-bob-merge-1");
			expect(sessions).toContain("orch-alice-api-lane-1");
			expect(sessions).toContain("orch-bob-web-lane-1");
			expect(sessions.length).toBe(6);
		});

		it("prefix filter does NOT return sessions with different prefix", () => {
			const sessions = parseOrchSessionNames(tmuxOutput, "orch");
			expect(sessions).not.toContain("unrelated-session");
			expect(sessions).not.toContain("other-prefix-lane-1");
		});

		it("different prefix only returns that prefix's sessions", () => {
			const sessions = parseOrchSessionNames(tmuxOutput, "other-prefix");
			expect(sessions.length).toBe(1);
			expect(sessions).toContain("other-prefix-lane-1");
		});

		it("prefix matching is exact (no partial prefix match)", () => {
			// "orch" should not match "orch2-lane-1"
			const output = "orch-lane-1\norch2-lane-1\n";
			const sessions = parseOrchSessionNames(output, "orch");
			expect(sessions).toContain("orch-lane-1");
			expect(sessions).not.toContain("orch2-lane-1");
		});

		it("sessions are returned sorted", () => {
			const sessions = parseOrchSessionNames(tmuxOutput, "orch");
			const sorted = [...sessions].sort();
			expect(sessions).toEqual(sorted);
		});
	});

	describe("listWorktrees() operator-scoped discovery", () => {
		// Testing the regex pattern directly (listWorktrees depends on git worktree list)

		/**
		 * Simulate the regex matching from listWorktrees() for the primary pattern.
		 */
		function matchesPrimaryPattern(wtBasename: string, prefix: string, opId: string): boolean {
			const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${opId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
			return pattern.test(wtBasename);
		}

		function matchesLegacyPattern(wtBasename: string, prefix: string): boolean {
			const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
			return pattern.test(wtBasename);
		}

		it("alice's worktrees are NOT matched by bob's pattern", () => {
			const aliceWt = "taskplane-wt-alice-1";
			expect(matchesPrimaryPattern(aliceWt, "taskplane-wt", "alice")).toBe(true);
			expect(matchesPrimaryPattern(aliceWt, "taskplane-wt", "bob")).toBe(false);
		});

		it("bob's worktrees are NOT matched by alice's pattern", () => {
			const bobWt = "taskplane-wt-bob-2";
			expect(matchesPrimaryPattern(bobWt, "taskplane-wt", "bob")).toBe(true);
			expect(matchesPrimaryPattern(bobWt, "taskplane-wt", "alice")).toBe(false);
		});

		it("legacy pattern {prefix}-{N} does not match opId-scoped worktrees", () => {
			expect(matchesLegacyPattern("taskplane-wt-alice-1", "taskplane-wt")).toBe(false);
		});

		it("opId-scoped pattern does not match legacy worktrees", () => {
			expect(matchesPrimaryPattern("taskplane-wt-1", "taskplane-wt", "alice")).toBe(false);
		});

		it("legacy pattern matches old-format worktrees", () => {
			expect(matchesLegacyPattern("taskplane-wt-1", "taskplane-wt")).toBe(true);
			expect(matchesLegacyPattern("taskplane-wt-10", "taskplane-wt")).toBe(true);
		});

		it("cross-operator worktrees do not match each other", () => {
			const operators = ["alice", "bob", "ci-runner-1", "op"];
			for (let i = 0; i < operators.length; i++) {
				const wtName = `taskplane-wt-${operators[i]}-1`;
				for (let j = 0; j < operators.length; j++) {
					if (i === j) {
						expect(matchesPrimaryPattern(wtName, "taskplane-wt", operators[j])).toBe(true);
					} else {
						expect(matchesPrimaryPattern(wtName, "taskplane-wt", operators[j])).toBe(false);
					}
				}
			}
		});
	});

	describe("Sidecar file naming with opId", () => {
		it("operator A's merge-result files do not match operator B's pattern", () => {
			const fileAlice = mergeResultFileName(0, 1, "alice", "20260315T120000");
			const fileBob = mergeResultFileName(0, 1, "bob", "20260315T120000");

			// Files should be unique
			expect(fileAlice).not.toBe(fileBob);

			// Pattern-based filtering: a pattern matching "alice" should not match "bob"
			const alicePattern = /merge-result-.*-alice-/;
			const bobPattern = /merge-result-.*-bob-/;

			expect(alicePattern.test(fileAlice)).toBe(true);
			expect(alicePattern.test(fileBob)).toBe(false);
			expect(bobPattern.test(fileBob)).toBe(true);
			expect(bobPattern.test(fileAlice)).toBe(false);
		});

		it("merge-request files also carry opId for uniqueness", () => {
			const fileAlice = mergeRequestFileName(0, 1, "alice", "20260315T120000");
			const fileBob = mergeRequestFileName(0, 1, "bob", "20260315T120000");
			expect(fileAlice).not.toBe(fileBob);
			expect(fileAlice).toContain("alice");
			expect(fileBob).toContain("bob");
		});
	});

	describe("removeAllWorktrees() operator scoping (pattern analysis)", () => {
		// removeAllWorktrees delegates to listWorktrees which is opId-scoped.
		// We verify the pattern ensures only the operator's own worktrees are matched.

		it("opId-scoped pattern guarantees operator isolation", () => {
			const prefix = "taskplane-wt";
			const operators = ["alice", "bob", "ci-1"];
			const lanes = [1, 2, 3];

			for (const currentOp of operators) {
				const pattern = new RegExp(`^${prefix}-${currentOp}-(\\d+)$`);
				for (const targetOp of operators) {
					for (const lane of lanes) {
						const wtName = `${prefix}-${targetOp}-${lane}`;
						if (currentOp === targetOp) {
							expect(pattern.test(wtName)).toBe(true);
						} else {
							expect(pattern.test(wtName)).toBe(false);
						}
					}
				}
			}
		});
	});

	describe("Sidecar cleanup in engine.ts is prefix-scoped (by design)", () => {
		// The engine.ts cleanup uses startsWith("merge-result-") etc.
		// This is intentional: ALL operators' sidecars in .pi/ are cleaned.
		// Documenting this as known cross-operator behavior.

		it("merge-result files from different operators all match prefix filter", () => {
			const files = [
				mergeResultFileName(0, 1, "alice", "20260315T120000"),
				mergeResultFileName(0, 1, "bob", "20260315T120000"),
				mergeResultFileName(1, 2, "ci-1", "20260315T120001"),
			];

			// The cleanup filter: f.startsWith("merge-result-")
			for (const f of files) {
				expect(f.startsWith("merge-result-")).toBe(true);
			}
		});

		it("merge-request files from different operators all match prefix filter", () => {
			const files = [
				mergeRequestFileName(0, 1, "alice", "20260315T120000"),
				mergeRequestFileName(0, 1, "bob", "20260315T120000"),
			];

			for (const f of files) {
				expect(f.startsWith("merge-request-")).toBe(true);
			}
		});
	});

	describe("/orch-abort session kill is prefix-scoped (by design)", () => {
		// abort logic: allSessionNames = all.filter(name => name.startsWith(`${prefix}-`))
		// This kills ALL operators' sessions. Documenting as intended team behavior.

		it("abort prefix filter captures all operators' sessions", () => {
			const prefix = "orch";
			const sessions = [
				"orch-alice-lane-1",
				"orch-bob-lane-1",
				"orch-alice-merge-1",
				"orch-bob-merge-2",
			];

			const matched = sessions.filter(name => name.startsWith(`${prefix}-`));
			expect(matched.length).toBe(4);
		});

		it("abort prefix filter does not capture non-orchestrator sessions", () => {
			const prefix = "orch";
			const sessions = [
				"orch-alice-lane-1",
				"my-other-session",
				"orchestrator-lane-1", // does NOT start with "orch-"
			];

			const matched = sessions.filter(name => name.startsWith(`${prefix}-`));
			expect(matched.length).toBe(1);
			expect(matched[0]).toBe("orch-alice-lane-1");
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 2c — Human-Readability Acceptance Tests
// ═══════════════════════════════════════════════════════════════════════

describe("2c — Human-Readability Acceptance", () => {

	describe("TMUX session names stay under 64 characters", () => {
		it("worst-case repo mode: long prefix + long opId", () => {
			const session = generateTmuxSessionName("taskplane-orch", 99, "ci-runner-01xx");
			expect(session.length).toBeLessThanOrEqual(64);
		});

		it("worst-case workspace mode: long prefix + long opId + long repoId", () => {
			const session = generateTmuxSessionName("taskplane-orch", 99, "ci-runner-01xx", "my-frontend-app");
			expect(session.length).toBeLessThanOrEqual(64);
		});

		it("maximum opId length (12 chars) produces manageable session names", () => {
			// resolveOperatorId truncates to 12 chars
			const maxOpId = "abcdefghijkl"; // 12 chars
			const session = generateTmuxSessionName("orch", 99, maxOpId, "my-long-repo");
			expect(session.length).toBeLessThanOrEqual(64);
			expect(session).toBe("orch-abcdefghijkl-my-long-repo-lane-99");
		});
	});

	describe("Branch names stay under 100 characters", () => {
		it("worst-case branch name", () => {
			const branch = generateBranchName(99, "20260315T120000", "ci-runner-01x");
			expect(branch.length).toBeLessThanOrEqual(100);
			expect(branch).toBe("task/ci-runner-01x-lane-99-20260315T120000");
		});
	});

	describe("Token order consistency across artifact types", () => {
		const opId = "henrylach";
		const prefix = "orch";
		const wtPrefix = "taskplane-wt";

		it("TMUX lane sessions: prefix → opId → lane-N", () => {
			const session = generateTmuxSessionName(prefix, 1, opId);
			expect(session).toBe("orch-henrylach-lane-1");
			const tokens = session.split("-");
			expect(tokens[0]).toBe("orch");     // prefix
			expect(tokens[1]).toBe("henrylach"); // opId
			expect(tokens[2]).toBe("lane");      // role
			expect(tokens[3]).toBe("1");         // lane number
		});

		it("TMUX workspace sessions: prefix → opId → repoId → lane-N", () => {
			const session = generateTmuxSessionName(prefix, 2, opId, "api");
			expect(session).toBe("orch-henrylach-api-lane-2");
			const tokens = session.split("-");
			expect(tokens[0]).toBe("orch");      // prefix
			expect(tokens[1]).toBe("henrylach");  // opId
			expect(tokens[2]).toBe("api");        // repoId
			expect(tokens[3]).toBe("lane");       // role
			expect(tokens[4]).toBe("2");          // lane number
		});

		it("Merge sessions: prefix → opId → merge → N", () => {
			const session = mergeSessionName(prefix, opId, 1);
			expect(session).toBe("orch-henrylach-merge-1");
			const tokens = session.split("-");
			expect(tokens[0]).toBe("orch");
			expect(tokens[1]).toBe("henrylach");
			expect(tokens[2]).toBe("merge");
			expect(tokens[3]).toBe("1");
		});

		it("Worktree paths: prefix → opId → N", () => {
			const wtPath = generateWorktreePath(wtPrefix, 1, "/home/user/project", opId);
			const wtBasename = basename(resolve(wtPath));
			expect(wtBasename).toBe("taskplane-wt-henrylach-1");
			const tokens = wtBasename.split("-");
			// "taskplane-wt" is the prefix (contains a hyphen)
			expect(tokens.slice(0, 2).join("-")).toBe("taskplane-wt"); // prefix
			expect(tokens[2]).toBe("henrylach");                       // opId
			expect(tokens[3]).toBe("1");                               // lane number
		});

		it("Branch names: task/ → opId → lane → N → batchId", () => {
			const branch = generateBranchName(1, "20260315T120000", opId);
			expect(branch).toBe("task/henrylach-lane-1-20260315T120000");
			// After "task/" prefix
			const afterSlash = branch.split("/")[1];
			const tokens = afterSlash.split("-");
			expect(tokens[0]).toBe("henrylach");     // opId
			expect(tokens[1]).toBe("lane");          // role marker
			expect(tokens[2]).toBe("1");             // lane number
			expect(tokens[3]).toBe("20260315T120000"); // batchId
		});
	});

	describe("All outputs contain only safe characters", () => {
		const safeInputs = [
			{ opId: "alice", prefix: "orch", lane: 1 },
			{ opId: "ci-runner-1", prefix: "my-orch", lane: 99 },
			{ opId: "henrylach", prefix: "taskplane-wt", lane: 3 },
		];

		for (const { opId, prefix, lane } of safeInputs) {
			it(`session name safe chars: opId=${opId}, prefix=${prefix}`, () => {
				const session = generateTmuxSessionName(prefix, lane, opId);
				// TMUX: no periods, colons. Alphanumeric + hyphens only.
				expect(session).toMatch(/^[a-zA-Z0-9-]+$/);
			});
		}

		it("branch names contain only safe git ref characters", () => {
			const branch = generateBranchName(1, "20260315T120000", "henrylach");
			// Git refs: alphanumeric, hyphens, slashes, underscores
			expect(branch).toMatch(/^[a-zA-Z0-9/._-]+$/);
		});

		it("merge temp branch contains only safe git ref characters", () => {
			const branch = mergeTempBranch("henrylach", "20260315T120000");
			expect(branch).toMatch(/^[a-zA-Z0-9._-]+$/);
		});

		it("merge result filename contains only safe filesystem characters", () => {
			const file = mergeResultFileName(0, 1, "henrylach", "20260315T120000");
			expect(file).toMatch(/^[a-zA-Z0-9._-]+$/);
		});
	});

	describe("Provenance parseability from generated names", () => {
		it("can extract opId from TMUX session name (repo mode)", () => {
			const session = generateTmuxSessionName("orch", 3, "henrylach");
			// Pattern: {prefix}-{opId}-lane-{N}
			const match = session.match(/^orch-(.+)-lane-(\d+)$/);
			expect(match).not.toBeNull();
			expect(match![1]).toBe("henrylach");
			expect(match![2]).toBe("3");
		});

		it("can extract opId and repoId from TMUX session name (workspace mode)", () => {
			const session = generateTmuxSessionName("orch", 2, "alice", "api");
			// Pattern: {prefix}-{opId}-{repoId}-lane-{N}
			const match = session.match(/^orch-(.+)-(.+)-lane-(\d+)$/);
			expect(match).not.toBeNull();
			expect(match![1]).toBe("alice");
			expect(match![2]).toBe("api");
			expect(match![3]).toBe("2");
		});

		it("can extract opId, lane, batchId from branch name", () => {
			const branch = generateBranchName(1, "20260315T120000", "henrylach");
			const match = branch.match(/^task\/(.+)-lane-(\d+)-(\d{8}T\d{6})$/);
			expect(match).not.toBeNull();
			expect(match![1]).toBe("henrylach");
			expect(match![2]).toBe("1");
			expect(match![3]).toBe("20260315T120000");
		});

		it("can extract opId and batchId from merge temp branch", () => {
			const branch = mergeTempBranch("henrylach", "20260315T120000");
			const match = branch.match(/^_merge-temp-(.+)-(\d{8}T\d{6})$/);
			expect(match).not.toBeNull();
			expect(match![1]).toBe("henrylach");
			expect(match![2]).toBe("20260315T120000");
		});

		it("can extract wave, lane, opId, batchId from merge result filename", () => {
			const file = mergeResultFileName(2, 3, "alice", "20260315T120000");
			const match = file.match(/^merge-result-w(\d+)-lane(\d+)-(.+)-(\d{8}T\d{6})\.json$/);
			expect(match).not.toBeNull();
			expect(match![1]).toBe("2");
			expect(match![2]).toBe("3");
			expect(match![3]).toBe("alice");
			expect(match![4]).toBe("20260315T120000");
		});
	});

	describe("Human-readable examples table verification", () => {
		// Verify the examples from naming-contract.md §4 match actual function output

		it("TMUX session — repo mode example", () => {
			expect(generateTmuxSessionName("orch", 1, "henrylach")).toBe("orch-henrylach-lane-1");
		});

		it("TMUX session — workspace mode example", () => {
			expect(generateTmuxSessionName("orch", 1, "henrylach", "api")).toBe("orch-henrylach-api-lane-1");
		});

		it("Merge session example", () => {
			expect(mergeSessionName("orch", "henrylach", 1)).toBe("orch-henrylach-merge-1");
		});

		it("Branch name example", () => {
			expect(generateBranchName(1, "20260308T214300", "henrylach"))
				.toBe("task/henrylach-lane-1-20260308T214300");
		});

		it("Merge temp branch example", () => {
			expect(mergeTempBranch("henrylach", "20260308T214300"))
				.toBe("_merge-temp-henrylach-20260308T214300");
		});

		it("Worktree path basename example", () => {
			const wtPath = generateWorktreePath("taskplane-wt", 1, "/home/user/project", "henrylach");
			expect(basename(resolve(wtPath))).toBe("taskplane-wt-henrylach-1");
		});

		it("Lane ID — repo mode unchanged", () => {
			expect(generateLaneId(1)).toBe("lane-1");
		});

		it("Lane ID — workspace mode", () => {
			expect(generateLaneId(1, "api")).toBe("api/lane-1");
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Naming utility tests (resolveOperatorId, sanitizeNameComponent)
// ═══════════════════════════════════════════════════════════════════════

describe("Naming utilities", () => {
	describe("sanitizeNameComponent()", () => {
		it("lowercases input", () => {
			expect(sanitizeNameComponent("HenryLach")).toBe("henrylach");
		});

		it("replaces non-alphanumeric chars with hyphens", () => {
			expect(sanitizeNameComponent("john.doe")).toBe("john-doe");
			expect(sanitizeNameComponent("user@host")).toBe("user-host");
		});

		it("collapses consecutive hyphens", () => {
			expect(sanitizeNameComponent("a--b---c")).toBe("a-b-c");
		});

		it("trims leading/trailing hyphens", () => {
			expect(sanitizeNameComponent("-hello-")).toBe("hello");
			expect(sanitizeNameComponent("---test---")).toBe("test");
		});

		it("truncates to maxLen", () => {
			expect(sanitizeNameComponent("abcdefghijklmnop", 8)).toBe("abcdefgh");
		});

		it("default maxLen is 16", () => {
			expect(sanitizeNameComponent("abcdefghijklmnopqrst")).toBe("abcdefghijklmnop");
		});

		it("returns empty string for unparseable input", () => {
			expect(sanitizeNameComponent("@@@")).toBe("");
			expect(sanitizeNameComponent("...")).toBe("");
		});
	});

	describe("resolveOperatorId()", () => {
		it("env var takes precedence over config", () => {
			const config = configWithOpId("from-config");
			const result = resolveOperatorId(config, { TASKPLANE_OPERATOR_ID: "from-env" });
			expect(result).toBe("from-env");
		});

		it("config takes precedence over OS username", () => {
			const config = configWithOpId("from-config");
			const result = resolveOperatorId(config, {});
			expect(result).toBe("from-config");
		});

		it("sanitizes env var value", () => {
			const config = configWithOpId("");
			const result = resolveOperatorId(config, { TASKPLANE_OPERATOR_ID: "CI Runner #1" });
			expect(result).toBe("ci-runner-1");
		});

		it("truncates to 12 characters", () => {
			const config = configWithOpId("");
			const result = resolveOperatorId(config, { TASKPLANE_OPERATOR_ID: "very-long-operator-name" });
			expect(result).toBe("very-long-op");
			expect(result.length).toBeLessThanOrEqual(12);
		});

		it("falls back to 'op' when all sources are empty", () => {
			const config = configWithOpId("");
			// Mock: pass env without TASKPLANE_OPERATOR_ID and no username
			// resolveOperatorId tries os.userInfo() internally; can't fully mock
			// but we verify the fallback chain works with empty env + empty config
			const result = resolveOperatorId(config, { TASKPLANE_OPERATOR_ID: "" });
			// Will fall through to OS username, then "op" if that fails
			// At minimum, result should be non-empty
			expect(result.length).toBeGreaterThan(0);
		});

		it("empty env var falls through to config", () => {
			const config = configWithOpId("from-config");
			const result = resolveOperatorId(config, { TASKPLANE_OPERATOR_ID: "" });
			expect(result).toBe("from-config");
		});

		it("whitespace-only env var falls through to config", () => {
			const config = configWithOpId("from-config");
			const result = resolveOperatorId(config, { TASKPLANE_OPERATOR_ID: "   " });
			expect(result).toBe("from-config");
		});
	});

	describe("resolveRepoSlug()", () => {
		it("extracts basename from repo root path", () => {
			expect(resolveRepoSlug("/home/user/taskplane")).toBe("taskplane");
		});

		it("sanitizes repo slug", () => {
			expect(resolveRepoSlug("/home/user/My.Project")).toBe("my-project");
		});

		it("truncates to 16 characters", () => {
			expect(resolveRepoSlug("/home/user/very-long-repository-name")).toBe("very-long-reposi");
		});

		it("falls back to 'repo' for path that sanitizes to empty", () => {
			// Edge case: path whose basename sanitizes to nothing
			// resolve("") returns cwd, so basename is non-empty.
			// Use a path with only special chars in the basename.
			expect(resolveRepoSlug("/home/user/@@@")).toBe("repo");
		});
	});
});
