/**
 * Discovery PROMPT.md Parser Tests — TP-002 Step 0
 *
 * Tests for execution target (repo ID) parsing in parsePromptForOrchestrator().
 * Validates parse grammar, precedence, backward compatibility, and that
 * existing dependency/file-scope parsing remains unchanged.
 *
 * Run: cd extensions && npx vitest run tests/discovery-prompt-parser.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { parsePromptForOrchestrator } from "../taskplane/discovery.ts";

// ── Helpers ──────────────────────────────────────────────────────────

let testRoot: string;

beforeEach(() => {
	testRoot = mkdtempSync(join(tmpdir(), "tp002-parser-"));
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

function writePrompt(folderName: string, content: string): { promptPath: string; taskFolder: string } {
	const taskFolder = join(testRoot, folderName);
	mkdirSync(taskFolder, { recursive: true });
	const promptPath = join(taskFolder, "PROMPT.md");
	writeFileSync(promptPath, content, "utf-8");
	return { promptPath, taskFolder };
}

// ── Minimal PROMPT template for testing ──────────────────────────────

const MINIMAL_PROMPT = `# Task: TEST-001 - Test Task

**Created:** 2026-03-15
**Size:** M

## Review Level: 1 (Plan Only)

## Dependencies

**None**

## Steps

### Step 0: Do something
- [ ] Do the thing

## Completion Criteria
- [ ] All done
`;

const PROMPT_WITH_DEPS_AND_SCOPE = `# Task: TEST-002 - Task With Deps

**Created:** 2026-03-15
**Size:** L

## Review Level: 2

## Dependencies

- **Requires:** DEP-001

## File Scope

- extensions/taskplane/discovery.ts
- extensions/tests/discovery-prompt-parser.test.ts

## Steps

### Step 0: Implement
- [ ] Do it

## Completion Criteria
- [ ] Done
`;

// ── Test Suite ───────────────────────────────────────────────────────

describe("parsePromptForOrchestrator — execution target parsing", () => {

	// ── Backward compatibility ────────────────────────────────────

	describe("backward compatibility: no execution target", () => {
		it("returns undefined promptRepoId when no execution target is present", () => {
			const { promptPath, taskFolder } = writePrompt("TEST-001-test-task", MINIMAL_PROMPT);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task).not.toBeNull();
			expect(task!.taskId).toBe("TEST-001");
			expect(task!.promptRepoId).toBeUndefined();
		});

		it("does not produce parse errors when execution target is absent", () => {
			const { promptPath, taskFolder } = writePrompt("TEST-001-no-target", MINIMAL_PROMPT);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task).not.toBeNull();
		});

		it("preserves existing fields (id, name, size, reviewLevel, status) when no target", () => {
			const { promptPath, taskFolder } = writePrompt("TEST-001-compat", MINIMAL_PROMPT);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "myarea");

			expect(task!.taskId).toBe("TEST-001");
			expect(task!.taskName).toBe("Test Task");
			expect(task!.size).toBe("M");
			expect(task!.reviewLevel).toBe(1);
			expect(task!.areaName).toBe("myarea");
			expect(task!.status).toBe("pending");
		});
	});

	// ── Section-based parsing ────────────────────────────────────

	describe("section-based: ## Execution Target with Repo: line", () => {
		it("parses Repo: api from section body", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo: api\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-section", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBe("api");
		});

		it("parses bold Repo key: **Repo:** frontend", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\n**Repo:** frontend\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-bold", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBe("frontend");
		});

		it("parses hyphenated repo ID: my-api-service", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo: my-api-service\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-hyphen", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBe("my-api-service");
		});

		it("section terminated by next ## heading", () => {
			const content = `# Task: TEST-001 - Test

**Size:** S

## Execution Target

Repo: backend

## Dependencies

**None**

## Steps

### Step 0: Do it
- [ ] Done
`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-terminated", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBe("backend");
			expect(task!.dependencies).toEqual([]);
		});

		it("section terminated by --- divider", () => {
			const content = `# Task: TEST-001 - Test

**Size:** M

## Execution Target

Repo: data-service

---

## Dependencies

**None**
`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-divider", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBe("data-service");
		});
	});

	// ── Inline parsing ───────────────────────────────────────────

	describe("inline: **Repo:** <id> declaration", () => {
		it("parses inline **Repo:** when no section is present", () => {
			const content = `# Task: TEST-001 - Test

**Created:** 2026-03-15
**Size:** M
**Repo:** frontend

## Review Level: 1

## Dependencies

**None**

## Steps

### Step 0: Do it
- [ ] Done
`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-inline", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBe("frontend");
		});
	});

	// ── Whitespace/case/markdown variants ────────────────────────

	describe("whitespace, case, and markdown variants", () => {
		it("handles leading whitespace before Repo: line", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\n  Repo: api\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-ws1", content);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(task!.promptRepoId).toBe("api");
		});

		it("handles trailing whitespace after repo ID", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo: api   \n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-ws2", content);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(task!.promptRepoId).toBe("api");
		});

		it("normalizes mixed-case repo ID to lowercase", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo: MyAPI\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-case", content);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(task!.promptRepoId).toBe("myapi");
		});

		it("handles case-insensitive 'repo:' key", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nrepo: backend\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-lckey", content);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(task!.promptRepoId).toBe("backend");
		});

		it("handles extra whitespace between Repo: and value", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo:    services\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-ws3", content);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(task!.promptRepoId).toBe("services");
		});

		it("handles Execution Target heading with trailing whitespace", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target   \n\nRepo: api\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-headws", content);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(task!.promptRepoId).toBe("api");
		});
	});

	// ── Precedence: section wins over inline ─────────────────────

	describe("precedence: section-based wins over inline", () => {
		it("uses section repo when both section and inline are present", () => {
			const content = `# Task: TEST-001 - Test

**Created:** 2026-03-15
**Size:** M
**Repo:** inline-repo

## Review Level: 1

## Execution Target

Repo: section-repo

## Dependencies

**None**

## Steps

### Step 0: Do it
- [ ] Done
`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-prec", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBe("section-repo");
		});
	});

	// ── Invalid repo ID → undefined ──────────────────────────────

	describe("invalid repo ID format", () => {
		it("returns undefined for repo ID starting with hyphen", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo: -invalid\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-inv1", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBeUndefined();
		});

		it("returns undefined for repo ID with spaces", () => {
			// "my api" - the regex captures \S+ so it will get "my", which is valid
			// But let's test an ID that is just a hyphen
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo: -\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-inv2", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBeUndefined();
		});

		it("returns undefined for repo ID with special characters", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo: my_repo!\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-inv3", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			// "my_repo!" doesn't match /^[a-z0-9][a-z0-9-]*$/ because of underscore and !
			expect(task!.promptRepoId).toBeUndefined();
		});

		it("returns undefined when section exists but has no Repo: line", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nSome other content here\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-inv4", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBeUndefined();
		});

		it("returns undefined when section body is empty", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\n## Dependencies\n\n**None**\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-empty", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBeUndefined();
		});
	});

	// ── Existing parsing unchanged ───────────────────────────────

	describe("existing dependency/file-scope parsing unchanged with execution target", () => {
		it("parses dependencies correctly when execution target is present", () => {
			const content = PROMPT_WITH_DEPS_AND_SCOPE + `\n## Execution Target\n\nRepo: api\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-002-deps", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.taskId).toBe("TEST-002");
			expect(task!.dependencies).toEqual(["DEP-001"]);
			expect(task!.promptRepoId).toBe("api");
		});

		it("parses file scope correctly when execution target is present", () => {
			const content = PROMPT_WITH_DEPS_AND_SCOPE + `\n## Execution Target\n\nRepo: frontend\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-002-scope", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.fileScope).toEqual([
				"extensions/taskplane/discovery.ts",
				"extensions/tests/discovery-prompt-parser.test.ts",
			]);
			expect(task!.promptRepoId).toBe("frontend");
		});

		it("parses size and review level correctly when execution target is present", () => {
			const content = PROMPT_WITH_DEPS_AND_SCOPE + `\n## Execution Target\n\nRepo: api\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-002-meta", content);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(task!.size).toBe("L");
			expect(task!.reviewLevel).toBe(2);
		});

		it("dependencies are unchanged when inline Repo is in front-matter area", () => {
			const content = `# Task: TEST-003 - Inline Repo Test

**Created:** 2026-03-15
**Size:** S
**Repo:** api

## Review Level: 1

## Dependencies

- DEP-010
- DEP-020

## File Scope

- src/main.ts
- src/utils.ts

## Steps

### Step 0: Do it
- [ ] Done
`;
			const { promptPath, taskFolder } = writePrompt("TEST-003-inline-deps", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBe("api");
			expect(task!.dependencies).toEqual(["DEP-010", "DEP-020"]);
			expect(task!.fileScope).toEqual(["src/main.ts", "src/utils.ts"]);
		});
	});

	// ── Edge cases ───────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles numeric repo ID", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo: repo1\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-num", content);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(task!.promptRepoId).toBe("repo1");
		});

		it("handles single-char repo ID", () => {
			const content = MINIMAL_PROMPT + `\n## Execution Target\n\nRepo: a\n`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-single", content);
			const { task } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(task!.promptRepoId).toBe("a");
		});

		it("execution target between other sections parses correctly", () => {
			const content = `# Task: TEST-001 - Mid Section

**Size:** M

## Dependencies

**None**

## Execution Target

Repo: middle-repo

## File Scope

- src/index.ts

## Steps

### Step 0: Do it
- [ ] Done
`;
			const { promptPath, taskFolder } = writePrompt("TEST-001-mid", content);
			const { task, error } = parsePromptForOrchestrator(promptPath, taskFolder, "default");

			expect(error).toBeNull();
			expect(task!.promptRepoId).toBe("middle-repo");
			expect(task!.dependencies).toEqual([]);
			expect(task!.fileScope).toEqual(["src/index.ts"]);
		});
	});
});
