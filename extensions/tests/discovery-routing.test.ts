/**
 * Discovery Routing Tests — TP-002 Step 0
 *
 * Tests for execution target (repo ID) parsing from PROMPT.md metadata.
 *
 * Test categories:
 *   1.x — Prompt with no execution target (backward compat)
 *   2.x — Section-based `## Execution Target` with `Repo:` line
 *   3.x — Inline `**Repo:** <id>` declaration
 *   4.x — Whitespace/case/markdown decoration variants
 *   5.x — Both section + inline present (section wins)
 *   6.x — Invalid repo ID format (non-matching = undefined)
 *   7.x — Existing dependency/file-scope parsing unchanged
 *
 * Run: npx vitest run tests/discovery-routing.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { parsePromptForOrchestrator } from "../taskplane/discovery.ts";

// ── Test Fixtures ────────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `test-${counter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writePrompt(dir: string, content: string): string {
	const promptPath = join(dir, "PROMPT.md");
	writeFileSync(promptPath, content, "utf-8");
	return promptPath;
}

/** Minimal valid PROMPT.md with just a task ID heading */
function minimalPrompt(extra: string = ""): string {
	return `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M

## Dependencies

**None**

${extra}

## Steps

### Step 0: Do something

- [ ] Something

---
`;
}

beforeEach(() => {
	testRoot = join(tmpdir(), `tp002-discovery-${Date.now()}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

// ── 1.x: No execution target (backward compat) ──────────────────────

describe("1.x: No execution target", () => {
	it("1.1: prompt without any repo metadata returns undefined promptRepoId", () => {
		const dir = makeTestDir("no-repo");
		const promptPath = writePrompt(dir, minimalPrompt());
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task).not.toBeNull();
		expect(result.task!.taskId).toBe("TP-100");
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("1.2: prompt with unrelated sections does not produce promptRepoId", () => {
		const dir = makeTestDir("unrelated-sections");
		const content = minimalPrompt(`
## Environment

- **Workspace:** Test workspace
- **Services required:** None

## File Scope

- src/main.ts
- src/utils.ts
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task).not.toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("1.3: existing fields (taskId, size, reviewLevel) are unchanged", () => {
		const dir = makeTestDir("fields-intact");
		const content = `# Task: TP-200 - Important Task

**Created:** 2026-03-15
**Size:** L

## Review Level: 3 (Full Review)

## Dependencies

**None**

## Steps

### Step 0: Do it

- [ ] Do the thing

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "test-area");

		expect(result.error).toBeNull();
		expect(result.task!.taskId).toBe("TP-200");
		expect(result.task!.taskName).toBe("Important Task");
		expect(result.task!.size).toBe("L");
		expect(result.task!.reviewLevel).toBe(3);
		expect(result.task!.areaName).toBe("test-area");
		expect(result.task!.promptRepoId).toBeUndefined();
	});
});

// ── 2.x: Section-based `## Execution Target` ────────────────────────

describe("2.x: Section-based execution target", () => {
	it("2.1: parses repo from ## Execution Target section with Repo: line", () => {
		const dir = makeTestDir("section-repo");
		const content = minimalPrompt(`
## Execution Target

Repo: api
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("2.2: parses multi-word section with description", () => {
		const dir = makeTestDir("section-with-desc");
		const content = minimalPrompt(`
## Execution Target

This task targets the frontend repository.

Repo: frontend
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("frontend");
	});

	it("2.3: handles bold Repo key in section", () => {
		const dir = makeTestDir("section-bold-repo");
		const content = minimalPrompt(`
## Execution Target

**Repo:** backend-service
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("backend-service");
	});

	it("2.4: handles hyphenated repo IDs", () => {
		const dir = makeTestDir("section-hyphens");
		const content = minimalPrompt(`
## Execution Target

Repo: my-cool-service-2
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("my-cool-service-2");
	});
});

// ── 3.x: Inline `**Repo:** <id>` declaration ────────────────────────

describe("3.x: Inline repo declaration", () => {
	it("3.1: parses inline **Repo:** field", () => {
		const dir = makeTestDir("inline-repo");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M
**Repo:** api

## Dependencies

**None**

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("3.2: parses inline repo with trailing whitespace", () => {
		const dir = makeTestDir("inline-trailing");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Repo:** frontend   

## Dependencies

**None**

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("frontend");
	});
});

// ── 4.x: Whitespace/case/markdown variants ──────────────────────────

describe("4.x: Whitespace/case/markdown variants", () => {
	it("4.1: uppercase Repo value is lowercased", () => {
		const dir = makeTestDir("case-upper");
		const content = minimalPrompt(`
## Execution Target

Repo: API
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("4.2: mixed-case Repo value is lowercased", () => {
		const dir = makeTestDir("case-mixed");
		const content = minimalPrompt(`
## Execution Target

Repo: Frontend-App
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("frontend-app");
	});

	it("4.3: leading spaces on Repo line are tolerated", () => {
		const dir = makeTestDir("leading-spaces");
		const content = minimalPrompt(`
## Execution Target

  Repo: api
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("4.4: Repo: with colon and extra spaces", () => {
		const dir = makeTestDir("extra-spaces");
		const content = minimalPrompt(`
## Execution Target

Repo:   backend
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("backend");
	});

	it("4.5: section header with trailing whitespace", () => {
		const dir = makeTestDir("header-trailing-ws");
		// Note: the regex in the impl uses \s* after "Execution Target"
		const content = `# Task: TP-100 - Test Task

**Size:** M

## Dependencies

**None**

## Execution Target   

Repo: api

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});
});

// ── 5.x: Both section + inline present (section wins) ───────────────

describe("5.x: Precedence (section > inline)", () => {
	it("5.1: section-based repo takes precedence over inline", () => {
		const dir = makeTestDir("precedence");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M
**Repo:** inline-repo

## Dependencies

**None**

## Execution Target

Repo: section-repo

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("section-repo");
	});

	it("5.2: inline repo is used when section has no Repo: line", () => {
		const dir = makeTestDir("section-empty-fallback");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M
**Repo:** inline-repo

## Dependencies

**None**

## Execution Target

This section exists but has no Repo: line.

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("inline-repo");
	});
});

// ── 6.x: Invalid repo ID format ─────────────────────────────────────

describe("6.x: Invalid repo ID format", () => {
	it("6.1: repo ID with underscores is rejected (undefined)", () => {
		const dir = makeTestDir("invalid-underscore");
		const content = minimalPrompt(`
## Execution Target

Repo: my_repo
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("6.2: repo ID starting with hyphen is rejected", () => {
		const dir = makeTestDir("invalid-leading-hyphen");
		const content = minimalPrompt(`
## Execution Target

Repo: -invalid
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("6.3: repo ID with special characters is rejected", () => {
		const dir = makeTestDir("invalid-special");
		const content = minimalPrompt(`
## Execution Target

Repo: my.repo/v2
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		// The regex captures first \S+ which would be "my.repo/v2", which fails validation
		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("6.4: empty Repo: value results in undefined", () => {
		const dir = makeTestDir("invalid-empty");
		const content = minimalPrompt(`
## Execution Target

Repo:
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("6.5: no parse errors produced for invalid repo IDs", () => {
		const dir = makeTestDir("invalid-no-error");
		const content = minimalPrompt(`
## Execution Target

Repo: INVALID_REPO!!
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		// Must be non-fatal: no error, task is valid, just no repo parsed
		expect(result.error).toBeNull();
		expect(result.task).not.toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});
});

// ── 7.x: Existing parsing unchanged ─────────────────────────────────

describe("7.x: Existing parsing unchanged with repo metadata", () => {
	it("7.1: dependencies still parsed correctly when repo is present", () => {
		const dir = makeTestDir("deps-with-repo");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M

## Review Level: 2

## Dependencies

- **Requires:** TP-050 (workspace context)
- TP-051 (routing foundation)

## Execution Target

Repo: api

## File Scope

- extensions/taskplane/discovery.ts
- extensions/tests/discovery-routing.test.ts

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "test-area");

		expect(result.error).toBeNull();
		expect(result.task!.taskId).toBe("TP-100");
		expect(result.task!.dependencies).toContain("TP-050");
		expect(result.task!.dependencies).toContain("TP-051");
		expect(result.task!.fileScope).toContain("extensions/taskplane/discovery.ts");
		expect(result.task!.fileScope).toContain("extensions/tests/discovery-routing.test.ts");
		expect(result.task!.reviewLevel).toBe(2);
		expect(result.task!.size).toBe("M");
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("7.2: file scope parsing unaffected by repo metadata", () => {
		const dir = makeTestDir("scope-with-repo");
		const content = `# Task: TP-100 - Test Task

**Size:** S
**Repo:** frontend

## Dependencies

**None**

## File Scope

- src/App.tsx
- src/components/Header.tsx

## Steps

### Step 0: Build it

- [ ] Build

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.fileScope).toEqual(["src/App.tsx", "src/components/Header.tsx"]);
		expect(result.task!.promptRepoId).toBe("frontend");
		expect(result.task!.size).toBe("S");
	});

	it("7.3: cross-area dependency refs still parsed with repo", () => {
		const dir = makeTestDir("cross-area-deps");
		const content = `# Task: TP-100 - Test Task

**Size:** M

## Dependencies

- **Requires:** other-area/OA-001 (cross-area dep)

## Execution Target

Repo: api

## Steps

### Step 0: Implement

- [ ] Do it

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.dependencies).toContain("other-area/OA-001");
		expect(result.task!.promptRepoId).toBe("api");
	});
});
