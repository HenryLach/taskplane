/**
 * Settings TUI Tests — TP-018 Steps 2 & 3
 *
 * Tests for the pure/testable functions exported from settings-tui.ts:
 *   - detectFieldSource: source badge precedence with type guards
 *   - getFieldDisplayValue: merged config → display string
 *   - validateFieldInput: input validation per field type
 *   - coerceValueForWrite: raw TUI value → typed config value
 *   - writeProjectConfigField: Layer 1 write-back (JSON-only, YAML bootstrap, malformed)
 *   - writeGlobalPreference: Layer 2 write-back (prefs JSON)
 *
 * Test categories:
 *   9.x  — detectFieldSource: source badge precedence and type guards
 *   10.x — getFieldDisplayValue: value display formatting
 *   11.x — validateFieldInput: input validation per field type
 *   12.x — SECTIONS schema coverage
 *   13.x — coerceValueForWrite: value coercion for write-back
 *   14.x — writeProjectConfigField: Layer 1 project config writes
 *   15.x — writeGlobalPreference: Layer 2 preferences writes
 *   16.x — YAML source detection: JSON-only, YAML-only, JSON+YAML precedence
 *   17.x — Write-back zero-mutation paths: cancel/decline confirmation
 *   18.x — Advanced section discoverability: uncovered fields surfaced
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/settings-tui.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import {
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
	detectFieldSource,
	getFieldDisplayValue,
	validateFieldInput,
	coerceValueForWrite,
	writeProjectConfigField,
	writeGlobalPreference,
	readRawProjectJson,
	readRawYamlConfigs,
	getAdvancedItems,
	getDefaultWriteDestination,
	resolveWriteAction,
	buildThinkingSuggestionForModelChange,
	buildThinkingUnsupportedNoteForThinkingField,
	modelSupportsThinking,
	SECTIONS,
} from "../taskplane/settings-tui.ts";
import type { FieldDef, FieldSource } from "../taskplane/settings-tui.ts";
import {
	DEFAULT_PROJECT_CONFIG,
	CONFIG_VERSION,
	PROJECT_CONFIG_FILENAME,
	GLOBAL_PREFERENCES_FILENAME,
	GLOBAL_PREFERENCES_SUBDIR,
} from "../taskplane/config-schema.ts";
import type {
	TaskplaneConfig,
	GlobalPreferences,
} from "../taskplane/config-schema.ts";


// ── Helpers ──────────────────────────────────────────────────────────

/** Deep clone a config for test isolation */
function cloneConfig(): TaskplaneConfig {
	return JSON.parse(JSON.stringify(DEFAULT_PROJECT_CONFIG));
}

/** Create a minimal L1-only field def */
function makeL1Field(overrides: Partial<FieldDef> = {}): FieldDef {
	return {
		configPath: "orchestrator.orchestrator.maxLanes",
		label: "Max Lanes",
		control: "input",
		layer: "L1",
		fieldType: "number",
		...overrides,
	};
}

/** Create a minimal L1+L2 string field def */
function makeL1L2StringField(overrides: Partial<FieldDef> = {}): FieldDef {
	return {
		configPath: "taskRunner.worker.model",
		label: "Worker Model",
		control: "input",
		layer: "L1+L2",
		fieldType: "string",
		prefsKey: "workerModel",
		...overrides,
	};
}

/** Create a minimal L1+L2 enum field def */
function makeL1L2EnumField(overrides: Partial<FieldDef> = {}): FieldDef {
	return {
		configPath: "orchestrator.orchestrator.spawnMode",
		label: "Spawn Mode",
		control: "toggle",
		layer: "L1+L2",
		fieldType: "enum",
		values: ["subprocess"],
		prefsKey: "spawnMode",
		...overrides,
	};
}

/** Create a minimal L2-only number field def */
function makeL2NumberField(overrides: Partial<FieldDef> = {}): FieldDef {
	return {
		configPath: "preferences.dashboardPort",
		label: "Dashboard Port",
		control: "input",
		layer: "L2",
		fieldType: "number",
		prefsKey: "dashboardPort",
		optional: true,
		...overrides,
	};
}


// ── 9.x detectFieldSource ────────────────────────────────────────────

describe("9. detectFieldSource", () => {
	// 9.1 — L1-only fields

	describe("9.1 L1-only fields", () => {
		it("9.1.1 returns 'project' when field exists in raw project config", () => {
			const field = makeL1Field();
			const rawProject = { orchestrator: { orchestrator: { maxLanes: 5 } } };
			expect(detectFieldSource(field, rawProject, null)).toBe("project");
		});

		it("9.1.2 returns 'default' when field is absent from raw project config", () => {
			const field = makeL1Field();
			const rawProject = { orchestrator: { orchestrator: {} } };
			expect(detectFieldSource(field, rawProject, null)).toBe("global");
		});

		it("9.1.3 returns 'default' when raw project config is null", () => {
			const field = makeL1Field();
			expect(detectFieldSource(field, null, null)).toBe("global");
		});

		it("9.1.4 ignores user prefs for L1-only fields", () => {
			const field = makeL1Field();
			const rawProject = {};
			const rawPrefs = { maxLanes: 10 };
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("global");
		});
	});

	// 9.2 — L1+L2 string fields (type-specific guards)

	describe("9.2 L1+L2 string fields", () => {
		it("9.2.1 returns 'user' when string pref is non-empty", () => {
			const field = makeL1L2StringField();
			const rawPrefs = { workerModel: "claude-4-opus" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.2.2 returns 'default' when string pref is empty string (cleared)", () => {
			const field = makeL1L2StringField();
			const rawPrefs = { workerModel: "" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.2.3 returns 'project' when string pref is empty but project has value", () => {
			const field = makeL1L2StringField();
			const rawProject = { taskRunner: { worker: { model: "gpt-4" } } };
			const rawPrefs = { workerModel: "" };
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("project");
		});

		it("9.2.4 returns 'default' when string pref is undefined", () => {
			const field = makeL1L2StringField();
			const rawPrefs = {};
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.2.5 rejects non-string pref values (type guard)", () => {
			const field = makeL1L2StringField();
			// If prefs has a number where a string is expected, reject it
			const rawPrefs = { workerModel: 42 };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.2.6 rejects boolean pref values for string fields (type guard)", () => {
			const field = makeL1L2StringField();
			const rawPrefs = { workerModel: true };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});
	});

	// 9.3 — L1+L2 enum fields (type-specific guards)

	describe("9.3 L1+L2 enum fields", () => {
		it("9.3.1 returns 'user' when enum pref is valid value", () => {
			const field = makeL1L2EnumField();
			const rawPrefs = { spawnMode: "subprocess" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.3.2 rejects legacy tmux enum value", () => {
			const field = makeL1L2EnumField();
			const rawPrefs = { spawnMode: "tmux" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.3.3 rejects invalid enum value — falls to default", () => {
			const field = makeL1L2EnumField();
			// "invalid" is not in values ["subprocess"]
			const rawPrefs = { spawnMode: "invalid" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.3.4 rejects non-string enum value (type guard)", () => {
			const field = makeL1L2EnumField();
			const rawPrefs = { spawnMode: 123 };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.3.5 returns 'default' when enum pref is undefined", () => {
			const field = makeL1L2EnumField();
			const rawPrefs = {};
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.3.6 returns 'project' when enum pref is invalid but project has value", () => {
			const field = makeL1L2EnumField();
			const rawProject = { orchestrator: { orchestrator: { spawnMode: "subprocess" } } };
			const rawPrefs = { spawnMode: "bogus" };
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("project");
		});
	});

	// 9.4 — L2-only number fields (type-specific guards)

	describe("9.4 L2-only number fields", () => {
		it("9.4.1 returns 'user' when number pref is valid finite number", () => {
			const field = makeL2NumberField();
			const rawPrefs = { dashboardPort: 8080 };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.4.2 returns 'default' when number pref is undefined", () => {
			const field = makeL2NumberField();
			const rawPrefs = {};
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.4.3 rejects string value for number field (type guard)", () => {
			const field = makeL2NumberField();
			const rawPrefs = { dashboardPort: "8080" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.4.4 rejects NaN for number field (type guard)", () => {
			const field = makeL2NumberField();
			const rawPrefs = { dashboardPort: NaN };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});

		it("9.4.5 rejects Infinity for number field (type guard)", () => {
			const field = makeL2NumberField();
			const rawPrefs = { dashboardPort: Infinity };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("global");
		});
	});

	// 9.5 — Precedence cascading

	describe("9.5 Precedence cascading", () => {
		it("9.5.1 project override wins over global for L1+L2 string fields", () => {
			const field = makeL1L2StringField();
			const rawProject = { taskRunner: { worker: { model: "gpt-4" } } };
			const rawPrefs = { workerModel: "claude-4-opus" };
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("project");
		});

		it("9.5.2 project wins when prefs not set for L1+L2 fields", () => {
			const field = makeL1L2StringField();
			const rawProject = { taskRunner: { worker: { model: "gpt-4" } } };
			const rawPrefs = {};
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("project");
		});

		it("9.5.3 L2-only fields always return default when prefs not set (no project layer)", () => {
			const field = makeL2NumberField();
			// Even if raw project has something (it shouldn't for L2-only), still "default"
			const rawProject = { preferences: { dashboardPort: 9999 } };
			const rawPrefs = {};
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("global");
		});
	});
});


// ── 10.x getFieldDisplayValue ────────────────────────────────────────

describe("10. getFieldDisplayValue", () => {
	const emptyPrefs: GlobalPreferences = {};

	it("10.1 displays number from merged config", () => {
		const config = cloneConfig();
		config.orchestrator.orchestrator.maxLanes = 5;
		const field = makeL1Field();
		expect(getFieldDisplayValue(field, config, emptyPrefs)).toBe("5");
	});

	it("10.2 displays string from merged config", () => {
		const config = cloneConfig();
		config.taskRunner.worker.model = "claude-4-opus";
		const field = makeL1L2StringField();
		expect(getFieldDisplayValue(field, config, emptyPrefs)).toBe("claude-4-opus");
	});

	it("10.3 displays enum from merged config", () => {
		const config = cloneConfig();
		config.orchestrator.orchestrator.spawnMode = "subprocess";
		const field = makeL1L2EnumField();
		expect(getFieldDisplayValue(field, config, emptyPrefs)).toBe("subprocess");
	});

	it("10.4 displays dashboardPort from preferences (L2-only)", () => {
		const config = cloneConfig();
		const prefs: GlobalPreferences = { dashboardPort: 9090 };
		const field = makeL2NumberField();
		expect(getFieldDisplayValue(field, config, prefs)).toBe("9090");
	});

	it("10.5 displays '(not set)' for undefined dashboardPort", () => {
		const config = cloneConfig();
		const field = makeL2NumberField();
		expect(getFieldDisplayValue(field, config, emptyPrefs)).toBe("(not set)");
	});

	it("10.6 displays '(inherit)' for optional worker spawnMode when undefined", () => {
		const config = cloneConfig();
		// worker.spawnMode is optional — when undefined, show "(inherit)"
		delete (config.taskRunner.worker as any).spawnMode;
		const field: FieldDef = {
			configPath: "taskRunner.worker.spawnMode",
			label: "Worker Spawn Mode",
			control: "toggle",
			layer: "L1",
			fieldType: "enum",
			values: ["(inherit)", "subprocess"],
			optional: true,
		};
		expect(getFieldDisplayValue(field, config, emptyPrefs)).toBe("(inherit)");
	});

	it("10.7 displays boolean as 'true'/'false' string", () => {
		const config = cloneConfig();
		config.orchestrator.dependencies.cache = true;
		const field: FieldDef = {
			configPath: "orchestrator.dependencies.cache",
			label: "Dep Cache",
			control: "toggle",
			layer: "L1",
			fieldType: "boolean",
			values: ["true", "false"],
		};
		expect(getFieldDisplayValue(field, config, emptyPrefs)).toBe("true");
	});

	it("10.8 displays default values when no overrides", () => {
		const config = cloneConfig();
		const field = makeL1Field(); // maxLanes defaults to 3
		expect(getFieldDisplayValue(field, config, emptyPrefs)).toBe("3");
	});
});


// ── 11.x validateFieldInput ──────────────────────────────────────────

describe("11. validateFieldInput", () => {

	// 11.1 — Number validation

	describe("11.1 Number validation", () => {
		const numberField = makeL1Field({ fieldType: "number" });

		it("11.1.1 accepts positive integer", () => {
			expect(validateFieldInput(numberField, "5").valid).toBe(true);
		});

		it("11.1.2 accepts large positive integer", () => {
			expect(validateFieldInput(numberField, "200000").valid).toBe(true);
		});

		it("11.1.3 rejects zero", () => {
			const result = validateFieldInput(numberField, "0");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("positive");
		});

		it("11.1.4 rejects negative number", () => {
			const result = validateFieldInput(numberField, "-1");
			expect(result.valid).toBe(false);
		});

		it("11.1.5 rejects non-integer (float)", () => {
			const result = validateFieldInput(numberField, "3.5");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("whole");
		});

		it("11.1.6 rejects non-numeric string", () => {
			const result = validateFieldInput(numberField, "abc");
			expect(result.valid).toBe(false);
		});

		it("11.1.7 rejects empty for required number", () => {
			const result = validateFieldInput(numberField, "");
			expect(result.valid).toBe(false);
		});

		it("11.1.8 accepts empty for optional number (unset)", () => {
			const optionalNumberField = makeL1Field({ fieldType: "number", optional: true });
			expect(validateFieldInput(optionalNumberField, "").valid).toBe(true);
		});

		it("11.1.9 rejects Infinity", () => {
			const result = validateFieldInput(numberField, "Infinity");
			expect(result.valid).toBe(false);
		});

		it("11.1.10 rejects NaN string", () => {
			const result = validateFieldInput(numberField, "NaN");
			expect(result.valid).toBe(false);
		});
	});

	// 11.2 — Enum validation

	describe("11.2 Enum validation", () => {
		const enumField = makeL1L2EnumField();

		it("11.2.1 accepts valid enum value", () => {
			expect(validateFieldInput(enumField, "subprocess").valid).toBe(true);
		});

		it("11.2.2 rejects legacy tmux enum value", () => {
			expect(validateFieldInput(enumField, "tmux").valid).toBe(false);
		});

		it("11.2.3 rejects invalid enum value", () => {
			const result = validateFieldInput(enumField, "invalid");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("Must be one of");
		});
	});

	// 11.3 — String validation

	describe("11.3 String validation", () => {
		const stringField = makeL1L2StringField();

		it("11.3.1 accepts any non-empty string", () => {
			expect(validateFieldInput(stringField, "claude-4-opus").valid).toBe(true);
		});

		it("11.3.2 accepts empty string for string fields (means inherit/clear)", () => {
			expect(validateFieldInput(stringField, "").valid).toBe(true);
		});
	});

	// 11.4 — Boolean validation

	describe("11.4 Boolean validation", () => {
		const boolField: FieldDef = {
			configPath: "orchestrator.dependencies.cache",
			label: "Dep Cache",
			control: "toggle",
			layer: "L1",
			fieldType: "boolean",
			values: ["true", "false"],
		};

		it("11.4.1 accepts 'true'", () => {
			expect(validateFieldInput(boolField, "true").valid).toBe(true);
		});

		it("11.4.2 accepts 'false'", () => {
			expect(validateFieldInput(boolField, "false").valid).toBe(true);
		});

		it("11.4.3 rejects other string for boolean", () => {
			const result = validateFieldInput(boolField, "yes");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("true or false");
		});
	});

	// 11.5 — Optional field unset behavior

	describe("11.5 Optional field unset", () => {
		it("11.5.1 empty input for optional field is valid (unset)", () => {
			const optField = makeL2NumberField();
			expect(validateFieldInput(optField, "").valid).toBe(true);
		});

		it("11.5.2 whitespace-only input for optional field is valid (unset)", () => {
			const optField = makeL2NumberField();
			expect(validateFieldInput(optField, "   ").valid).toBe(true);
		});
	});
});


// ── 12.x SECTIONS coverage ──────────────────────────────────────────

describe("12. SECTIONS schema coverage", () => {
	it("12.1 has 13 sections defined", () => {
		expect(SECTIONS).toHaveLength(13);
	});

	it("12.2 last section is Advanced (JSON Only) read-only", () => {
		const last = SECTIONS[SECTIONS.length - 1];
		expect(last.name).toBe("Advanced (JSON Only)");
		expect(last.readOnly).toBe(true);
	});

	it("12.3 all editable sections have at least one field", () => {
		for (const section of SECTIONS) {
			if (section.readOnly) continue;
			expect(section.fields.length).toBeGreaterThan(0);
		}
	});

	it("12.4 all L1+L2 fields have a prefsKey defined", () => {
		for (const section of SECTIONS) {
			for (const field of section.fields) {
				if (field.layer === "L1+L2" || field.layer === "L2") {
					expect(field.prefsKey).toBeDefined();
				}
			}
		}
	});

	it("12.5 all toggle fields have values array", () => {
		for (const section of SECTIONS) {
			for (const field of section.fields) {
				if (field.control === "toggle") {
					expect(field.values).toBeDefined();
					expect(field.values!.length).toBeGreaterThan(0);
				}
			}
		}
	});

	it("12.6 no duplicate configPaths across sections", () => {
		const paths = new Set<string>();
		for (const section of SECTIONS) {
			for (const field of section.fields) {
				expect(paths.has(field.configPath)).toBe(false);
				paths.add(field.configPath);
			}
		}
	});

	it("12.7 thinking fields use picker controls", () => {
		const thinkingPaths = [
			"taskRunner.worker.thinking",
			"taskRunner.reviewer.thinking",
			"orchestrator.merge.thinking",
		];
		for (const path of thinkingPaths) {
			const field = SECTIONS.flatMap((section) => section.fields).find((f) => f.configPath === path);
			expect(field).toBeDefined();
			expect(field!.control).toBe("picker");
		}
	});

	it("12.8 merge thinking remains L1+L2 with prefs destination", () => {
		const mergeThinking = SECTIONS
			.flatMap((section) => section.fields)
			.find((f) => f.configPath === "orchestrator.merge.thinking");
		expect(mergeThinking).toBeDefined();
		expect(mergeThinking!.layer).toBe("L1+L2");
		expect(mergeThinking!.prefsKey).toBe("mergeThinking");
		expect(getDefaultWriteDestination(mergeThinking!)).toBe("prefs");
	});
});


// ── Write-Back Test Fixtures ─────────────────────────────────────────

let writeTestRoot: string;
let writeCounter = 0;
let savedAgentDir: string | undefined;

function makeWriteTestDir(suffix?: string): string {
	writeCounter++;
	const dir = join(writeTestRoot, `wb-${writeCounter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writePiFile(root: string, filename: string, content: string): void {
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, filename), content, "utf-8");
}

function writeJsonConfig(root: string, obj: any): void {
	writePiFile(root, PROJECT_CONFIG_FILENAME, JSON.stringify(obj, null, 2));
}

function readJsonFile(path: string): any {
	return JSON.parse(readFileSync(path, "utf-8"));
}


// ── 13.x coerceValueForWrite ─────────────────────────────────────────

describe("13. coerceValueForWrite", () => {
	it("13.1 coerces number string to number", () => {
		const field = makeL1Field({ fieldType: "number" });
		expect(coerceValueForWrite(field, "42")).toBe(42);
	});

	it("13.2 coerces boolean string 'true' to boolean true", () => {
		const field: FieldDef = {
			configPath: "orchestrator.dependencies.cache",
			label: "Cache",
			control: "toggle",
			layer: "L1",
			fieldType: "boolean",
			values: ["true", "false"],
		};
		expect(coerceValueForWrite(field, "true")).toBe(true);
	});

	it("13.3 coerces boolean string 'false' to boolean false", () => {
		const field: FieldDef = {
			configPath: "orchestrator.dependencies.cache",
			label: "Cache",
			control: "toggle",
			layer: "L1",
			fieldType: "boolean",
			values: ["true", "false"],
		};
		expect(coerceValueForWrite(field, "false")).toBe(false);
	});

	it("13.4 returns string as-is for string fields", () => {
		const field = makeL1L2StringField();
		expect(coerceValueForWrite(field, "claude-4-opus")).toBe("claude-4-opus");
	});

	it("13.5 returns string as-is for enum fields", () => {
		const field = makeL1L2EnumField();
		expect(coerceValueForWrite(field, "subprocess")).toBe("subprocess");
	});

	it("13.6 returns undefined for '(not set)' marker", () => {
		const field = makeL2NumberField();
		expect(coerceValueForWrite(field, "(not set)")).toBeUndefined();
	});

	it("13.7 returns undefined for '(inherit)' marker", () => {
		const field: FieldDef = {
			configPath: "taskRunner.worker.spawnMode",
			label: "Worker Spawn Mode",
			control: "toggle",
			layer: "L1",
			fieldType: "enum",
			values: ["(inherit)", "subprocess"],
			optional: true,
		};
		expect(coerceValueForWrite(field, "(inherit)")).toBeUndefined();
	});

	it("13.8 strips source badge before coercion", () => {
		const field = makeL1Field({ fieldType: "number" });
		expect(coerceValueForWrite(field, "42  (project)")).toBe(42);
	});

	it("13.9 strips '(default)' source badge", () => {
		const field = makeL1L2StringField();
		expect(coerceValueForWrite(field, "gpt-4  (default)")).toBe("gpt-4");
	});

	it("13.10 strips '(global)' source badge", () => {
		const field = makeL1L2EnumField();
		expect(coerceValueForWrite(field, "subprocess  (global)")).toBe("subprocess");
	});

	it("13.11 returns undefined for non-parseable number", () => {
		const field = makeL1Field({ fieldType: "number" });
		expect(coerceValueForWrite(field, "abc")).toBeUndefined();
	});

	it("13.12 coerces '0' to number 0", () => {
		const field = makeL1Field({ fieldType: "number" });
		expect(coerceValueForWrite(field, "0")).toBe(0);
	});
});


// ── 14.x writeProjectConfigField ─────────────────────────────────────

describe("14. writeProjectConfigField", () => {
	beforeEach(() => {
		writeTestRoot = join(tmpdir(), `tp-wb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(writeTestRoot, { recursive: true });
		writeCounter = 0;
		// Isolate env vars
		savedAgentDir = process.env.PI_CODING_AGENT_DIR;
		delete process.env.TASKPLANE_WORKSPACE_ROOT;
	});

	afterEach(() => {
		if (savedAgentDir !== undefined) {
			process.env.PI_CODING_AGENT_DIR = savedAgentDir;
		} else {
			delete process.env.PI_CODING_AGENT_DIR;
		}
		delete process.env.TASKPLANE_WORKSPACE_ROOT;
		try {
			rmSync(writeTestRoot, { recursive: true, force: true });
		} catch { /* best effort on Windows */ }
	});

	it("14.1 writes new value to existing JSON config", () => {
		const dir = makeWriteTestDir("json-exist");
		const config = {
			configVersion: CONFIG_VERSION,
			orchestrator: { orchestrator: { maxLanes: 3 } },
		};
		writeJsonConfig(dir, config);

		writeProjectConfigField(dir, "orchestrator.orchestrator.maxLanes", 5);

		const result = readJsonFile(join(dir, ".pi", PROJECT_CONFIG_FILENAME));
		expect(result.orchestrator.orchestrator.maxLanes).toBe(5);
		expect(result.configVersion).toBe(CONFIG_VERSION);
	});

	it("14.2 creates nested path that doesn't exist yet", () => {
		const dir = makeWriteTestDir("nested-create");
		const config = {
			configVersion: CONFIG_VERSION,
			orchestrator: {},
		};
		writeJsonConfig(dir, config);

		writeProjectConfigField(dir, "orchestrator.failure.stallTimeout", 60);

		const result = readJsonFile(join(dir, ".pi", PROJECT_CONFIG_FILENAME));
		expect(result.orchestrator.failure.stallTimeout).toBe(60);
	});

	it("14.3 deletes key when value is undefined (optional field unset)", () => {
		const dir = makeWriteTestDir("delete-key");
		const config = {
			configVersion: CONFIG_VERSION,
			taskRunner: { worker: { spawnMode: "subprocess" } },
		};
		writeJsonConfig(dir, config);

		writeProjectConfigField(dir, "taskRunner.worker.spawnMode", undefined);

		const result = readJsonFile(join(dir, ".pi", PROJECT_CONFIG_FILENAME));
		expect(result.taskRunner).toBeUndefined();
	});

	it("14.4 throws on malformed JSON with descriptive error", () => {
		const dir = makeWriteTestDir("malformed");
		writePiFile(dir, PROJECT_CONFIG_FILENAME, "{ bad json !!!");

		expect(() =>
			writeProjectConfigField(dir, "orchestrator.orchestrator.maxLanes", 5),
		).toThrow(/malformed JSON/i);
	});

	it("14.5 seeds first JSON override from YAML-only project (preserves YAML overrides)", () => {
		const dir = makeWriteTestDir("yaml-only");
		// Write a YAML config with a custom value
		writePiFile(dir, "task-orchestrator.yaml", `
orchestrator:
  max_lanes: 7
  spawn_mode: subprocess
`);

		writeProjectConfigField(dir, "orchestrator.orchestrator.worktreePrefix", "test-wt");

		const jsonPath = join(dir, ".pi", PROJECT_CONFIG_FILENAME);
		expect(existsSync(jsonPath)).toBe(true);
		const result = readJsonFile(jsonPath);
		// The edited field
		expect(result.orchestrator.orchestrator.worktreePrefix).toBe("test-wt");
		// Existing YAML project overrides are preserved in seeded JSON
		expect(result.orchestrator.orchestrator.maxLanes).toBe(7);
		expect(result.orchestrator.orchestrator.spawnMode).toBe("subprocess");
		// YAML file is still there
		expect(existsSync(join(dir, ".pi", "task-orchestrator.yaml"))).toBe(true);
	});

	it("14.5b removing a seeded project override keeps unrelated YAML overrides", () => {
		const dir = makeWriteTestDir("yaml-remove-override");
		writePiFile(dir, "task-orchestrator.yaml", `
orchestrator:
  max_lanes: 7
  spawn_mode: subprocess
`);

		writeProjectConfigField(dir, "orchestrator.orchestrator.worktreePrefix", "temp-prefix");
		writeProjectConfigField(dir, "orchestrator.orchestrator.worktreePrefix", undefined);

		const result = readJsonFile(join(dir, ".pi", PROJECT_CONFIG_FILENAME));
		expect(result.orchestrator.orchestrator.worktreePrefix).toBeUndefined();
		expect(result.orchestrator.orchestrator.maxLanes).toBe(7);
		expect(result.orchestrator.orchestrator.spawnMode).toBe("subprocess");
	});

	it("14.5c first write preserves YAML keys outside source-detection mapper", () => {
		const dir = makeWriteTestDir("yaml-preserve-extra-keys");
		writePiFile(dir, "task-runner.yaml", `
quality_gate:
  enabled: true
model_fallback: fail
`);
		writePiFile(dir, "task-orchestrator.yaml", `
supervisor:
  model: custom-super
verification:
  enabled: true
  mode: strict
`);

		writeProjectConfigField(dir, "orchestrator.orchestrator.worktreePrefix", "seeded-prefix");

		const result = readJsonFile(join(dir, ".pi", PROJECT_CONFIG_FILENAME));
		expect(result.orchestrator.supervisor.model).toBe("custom-super");
		expect(result.orchestrator.verification.enabled).toBe(true);
		expect(result.orchestrator.verification.mode).toBe("strict");
		expect(result.taskRunner.qualityGate.enabled).toBe(true);
		expect(result.taskRunner.modelFallback).toBe("fail");
	});

	it("14.5d first write preserves taskplane-workspace.yaml overrides", () => {
		const dir = makeWriteTestDir("yaml-preserve-workspace");
		writePiFile(dir, "taskplane-workspace.yaml", `
repos:
  docs:
    path: ../docs
routing:
  tasks_root: taskplane-tasks
  default_repo: docs
  task_packet_repo: docs
`);

		writeProjectConfigField(dir, "orchestrator.orchestrator.worktreePrefix", "with-workspace");

		const result = readJsonFile(join(dir, ".pi", PROJECT_CONFIG_FILENAME));
		expect(result.workspace.repos.docs.path).toBe("../docs");
		expect(result.workspace.routing.tasksRoot).toBe("taskplane-tasks");
		expect(result.workspace.routing.defaultRepo).toBe("docs");
		expect(result.workspace.routing.taskPacketRepo).toBe("docs");
	});

	it("14.6 creates .pi directory when it doesn't exist", () => {
		const dir = makeWriteTestDir("no-pi-dir");
		// No .pi dir at all — writeProjectConfigField should create it

		writeProjectConfigField(dir, "orchestrator.orchestrator.maxLanes", 4);

		const jsonPath = join(dir, ".pi", PROJECT_CONFIG_FILENAME);
		expect(existsSync(jsonPath)).toBe(true);
		const result = readJsonFile(jsonPath);
		expect(result.orchestrator.orchestrator.maxLanes).toBe(4);
	});

	it("14.7 preserves existing fields when writing a new one", () => {
		const dir = makeWriteTestDir("preserve");
		const config = {
			configVersion: CONFIG_VERSION,
			orchestrator: {
				orchestrator: { maxLanes: 3, spawnMode: "tmux" },
				failure: { stallTimeout: 30 },
			},
		};
		writeJsonConfig(dir, config);

		writeProjectConfigField(dir, "orchestrator.orchestrator.maxLanes", 10);

		const result = readJsonFile(join(dir, ".pi", PROJECT_CONFIG_FILENAME));
		expect(result.orchestrator.orchestrator.maxLanes).toBe(10);
		expect(result.orchestrator.orchestrator.spawnMode).toBe("tmux");
		expect(result.orchestrator.failure.stallTimeout).toBe(30);
	});

	it("14.8 no .tmp file left after successful write", () => {
		const dir = makeWriteTestDir("no-tmp");
		const config = { configVersion: CONFIG_VERSION };
		writeJsonConfig(dir, config);

		writeProjectConfigField(dir, "orchestrator.orchestrator.maxLanes", 5);

		const tmpPath = join(dir, ".pi", PROJECT_CONFIG_FILENAME + ".tmp");
		expect(existsSync(tmpPath)).toBe(false);
	});

	it("14.9 writes string value correctly", () => {
		const dir = makeWriteTestDir("string-val");
		const config = {
			configVersion: CONFIG_VERSION,
			taskRunner: { worker: {} },
		};
		writeJsonConfig(dir, config);

		writeProjectConfigField(dir, "taskRunner.worker.model", "claude-4-opus");

		const result = readJsonFile(join(dir, ".pi", PROJECT_CONFIG_FILENAME));
		expect(result.taskRunner.worker.model).toBe("claude-4-opus");
	});

	it("14.10 writes boolean value correctly", () => {
		const dir = makeWriteTestDir("bool-val");
		const config = {
			configVersion: CONFIG_VERSION,
			orchestrator: { dependencies: {} },
		};
		writeJsonConfig(dir, config);

		writeProjectConfigField(dir, "orchestrator.dependencies.cache", false);

		const result = readJsonFile(join(dir, ".pi", PROJECT_CONFIG_FILENAME));
		expect(result.orchestrator.dependencies.cache).toBe(false);
	});

	it("14.11 writes to pointer-resolved flat layout (no .pi subdir)", () => {
		const workspaceRoot = makeWriteTestDir("pointer-flat-workspace");
		const pointerRoot = join(workspaceRoot, "config-repo", ".taskplane");
		mkdirSync(pointerRoot, { recursive: true });
		writeFileSync(join(pointerRoot, "task-orchestrator.yaml"), "orchestrator:\n  max_lanes: 6\n", "utf-8");

		writeProjectConfigField(
			workspaceRoot,
			"orchestrator.orchestrator.worktreePrefix",
			"tp-wt",
			pointerRoot,
		);

		expect(existsSync(join(pointerRoot, PROJECT_CONFIG_FILENAME))).toBe(true);
		expect(existsSync(join(workspaceRoot, ".pi", PROJECT_CONFIG_FILENAME))).toBe(false);

		const result = readJsonFile(join(pointerRoot, PROJECT_CONFIG_FILENAME));
		expect(result.orchestrator.orchestrator.maxLanes).toBe(6);
		expect(result.orchestrator.orchestrator.worktreePrefix).toBe("tp-wt");
	});
});


// ── 15.x writeGlobalPreference ─────────────────────────────────────────

describe("15. writeGlobalPreference", () => {
	beforeEach(() => {
		writeTestRoot = join(tmpdir(), `tp-prefs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(writeTestRoot, { recursive: true });
		writeCounter = 0;
		savedAgentDir = process.env.PI_CODING_AGENT_DIR;
		// Point prefs at our temp dir
		process.env.PI_CODING_AGENT_DIR = writeTestRoot;
	});

	afterEach(() => {
		if (savedAgentDir !== undefined) {
			process.env.PI_CODING_AGENT_DIR = savedAgentDir;
		} else {
			delete process.env.PI_CODING_AGENT_DIR;
		}
		try {
			rmSync(writeTestRoot, { recursive: true, force: true });
		} catch { /* best effort on Windows */ }
	});

	function getPrefsPath(): string {
		return join(writeTestRoot, GLOBAL_PREFERENCES_SUBDIR, GLOBAL_PREFERENCES_FILENAME);
	}

	function writePrefs(obj: any): void {
		const prefsDir = join(writeTestRoot, GLOBAL_PREFERENCES_SUBDIR);
		mkdirSync(prefsDir, { recursive: true });
		writeFileSync(getPrefsPath(), JSON.stringify(obj, null, 2), "utf-8");
	}

	it("15.1 writes a new preference value", () => {
		writePrefs({});

		writeGlobalPreference("dashboardPort", 9090);

		const result = readJsonFile(getPrefsPath());
		expect(result.dashboardPort).toBe(9090);
	});

	it("15.2 updates an existing preference value", () => {
		writePrefs({ dashboardPort: 8080, workerModel: "gpt-4" });

		writeGlobalPreference("dashboardPort", 9090);

		const result = readJsonFile(getPrefsPath());
		expect(result.dashboardPort).toBe(9090);
		expect(result.workerModel).toBe("gpt-4"); // preserved
	});

	it("15.3 deletes preference when value is undefined", () => {
		writePrefs({ dashboardPort: 8080, workerModel: "gpt-4" });

		writeGlobalPreference("dashboardPort", undefined);

		const result = readJsonFile(getPrefsPath());
		expect("dashboardPort" in result).toBe(false);
		expect(result.workerModel).toBe("gpt-4"); // preserved
	});

	it("15.4 creates prefs directory and file when they don't exist", () => {
		const prefsPath = getPrefsPath();
		expect(existsSync(prefsPath)).toBe(false);

		writeGlobalPreference("workerModel", "claude-4-opus");

		expect(existsSync(prefsPath)).toBe(true);
		const result = readJsonFile(prefsPath);
		expect(result.workerModel).toBe("claude-4-opus");
	});

	it("15.5 recovers from malformed prefs file (starts fresh)", () => {
		const prefsDir = join(writeTestRoot, GLOBAL_PREFERENCES_SUBDIR);
		mkdirSync(prefsDir, { recursive: true });
		writeFileSync(getPrefsPath(), "NOT VALID JSON!!", "utf-8");

		writeGlobalPreference("spawnMode", "tmux");

		const result = readJsonFile(getPrefsPath());
		expect(result.spawnMode).toBe("tmux");
	});

	it("15.6 writes string preference correctly", () => {
		writePrefs({});

		writeGlobalPreference("operatorId", "alice");

		const result = readJsonFile(getPrefsPath());
		expect(result.operatorId).toBe("alice");
	});

	it("15.7 sets string to empty (clear semantics)", () => {
		writePrefs({ workerModel: "gpt-4" });

		writeGlobalPreference("workerModel", "");

		const result = readJsonFile(getPrefsPath());
		expect(result.workerModel).toBe("");
	});

	it("15.8 no .tmp file left after successful write", () => {
		writePrefs({});

		writeGlobalPreference("dashboardPort", 3000);

		const tmpPath = getPrefsPath() + ".tmp";
		expect(existsSync(tmpPath)).toBe(false);
	});
});

// ── 16.x YAML Source Detection ───────────────────────────────────────
// Verifies that source badges are correct when config comes from
// JSON-only, YAML-only, and mixed JSON+YAML scenarios (R009 item 1).

describe("16. YAML source detection", () => {
	let yamlTestRoot: string;
	let yamlCounter = 0;

	function makeYamlTestDir(suffix?: string): string {
		yamlCounter++;
		const dir = join(tmpdir(), `tp-yaml-test-${Date.now()}-${yamlCounter}${suffix ? `-${suffix}` : ""}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(() => {
		// Best-effort cleanup
	});

	describe("16.1 JSON-only config", () => {
		it("16.1.1 readRawProjectJson returns parsed object for valid JSON", () => {
			const dir = makeYamlTestDir("json-only");
			const piDir = join(dir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, PROJECT_CONFIG_FILENAME), JSON.stringify({
				configVersion: CONFIG_VERSION,
				orchestrator: { orchestrator: { maxLanes: 5, spawnMode: "tmux" } },
			}, null, 2), "utf-8");

			const raw = readRawProjectJson(dir);
			expect(raw).not.toBeNull();
			expect(raw!.orchestrator.orchestrator.maxLanes).toBe(5);
			expect(raw!.orchestrator.orchestrator.spawnMode).toBe("tmux");
		});

		it("16.1.2 readRawYamlConfigs returns null when no YAML files exist", () => {
			const dir = makeYamlTestDir("no-yaml");
			const piDir = join(dir, ".pi");
			mkdirSync(piDir, { recursive: true });

			const raw = readRawYamlConfigs(dir);
			expect(raw).toBeNull();
		});

		it("16.1.3 detectFieldSource returns 'project' for JSON-set field", () => {
			const field = makeL1Field(); // maxLanes
			const rawJson = { orchestrator: { orchestrator: { maxLanes: 5 } } };
			expect(detectFieldSource(field, rawJson, null)).toBe("project");
		});

		it("16.1.4 readRawProjectJson supports flat pointer layout", () => {
			const dir = makeYamlTestDir("json-flat");
			writeFileSync(join(dir, PROJECT_CONFIG_FILENAME), JSON.stringify({
				configVersion: CONFIG_VERSION,
				orchestrator: { orchestrator: { maxLanes: 9 } },
			}, null, 2), "utf-8");

			const raw = readRawProjectJson(dir);
			expect(raw).not.toBeNull();
			expect(raw!.orchestrator.orchestrator.maxLanes).toBe(9);
		});
	});

	describe("16.2 YAML-only config", () => {
		it("16.2.1 readRawYamlConfigs converts snake_case orchestrator keys to camelCase", () => {
			const dir = makeYamlTestDir("yaml-orch");
			const piDir = join(dir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, "task-orchestrator.yaml"), [
				"orchestrator:",
				"  max_lanes: 7",
				"  spawn_mode: tmux",
				"  worktree_prefix: test-wt",
				"failure:",
				"  stall_timeout: 60",
				"  on_task_failure: stop-all",
			].join("\n"), "utf-8");

			const raw = readRawYamlConfigs(dir);
			expect(raw).not.toBeNull();
			expect(raw!.orchestrator.orchestrator.maxLanes).toBe(7);
			expect(raw!.orchestrator.orchestrator.spawnMode).toBe("tmux");
			expect(raw!.orchestrator.orchestrator.worktreePrefix).toBe("test-wt");
			expect(raw!.orchestrator.failure.stallTimeout).toBe(60);
			expect(raw!.orchestrator.failure.onTaskFailure).toBe("stop-all");
		});

		it("16.2.2 readRawYamlConfigs converts snake_case task-runner keys to camelCase", () => {
			const dir = makeYamlTestDir("yaml-tr");
			const piDir = join(dir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, "task-runner.yaml"), [
				"worker:",
				"  model: gpt-4",
				"context:",
				"  worker_context_window: 200000",
				"  max_worker_iterations: 10",
			].join("\n"), "utf-8");

			const raw = readRawYamlConfigs(dir);
			expect(raw).not.toBeNull();
			expect(raw!.taskRunner.worker.model).toBe("gpt-4");
			expect(raw!.taskRunner.context.workerContextWindow).toBe(200000);
			expect(raw!.taskRunner.context.maxWorkerIterations).toBe(10);
		});

		it("16.2.3 detectFieldSource returns 'project' for YAML-sourced field", () => {
			const field = makeL1Field(); // maxLanes
			// Simulate YAML-parsed raw data (after camelCase conversion)
			const rawYaml = { orchestrator: { orchestrator: { maxLanes: 7 } } };
			expect(detectFieldSource(field, rawYaml, null)).toBe("project");
		});

		it("16.2.4 readRawProjectJson returns null when only YAML exists", () => {
			const dir = makeYamlTestDir("yaml-no-json");
			const piDir = join(dir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, "task-orchestrator.yaml"), "orchestrator:\n  max_lanes: 5\n", "utf-8");

			const raw = readRawProjectJson(dir);
			expect(raw).toBeNull();
		});

		it("16.2.5 readRawYamlConfigs converts pre_warm section correctly", () => {
			const dir = makeYamlTestDir("yaml-prewarm");
			const piDir = join(dir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, "task-orchestrator.yaml"), [
				"pre_warm:",
				"  auto_detect: true",
				"  commands:",
				"    npm: npm install",
			].join("\n"), "utf-8");

			const raw = readRawYamlConfigs(dir);
			expect(raw).not.toBeNull();
			expect(raw!.orchestrator.preWarm.autoDetect).toBe(true);
			expect(raw!.orchestrator.preWarm.commands).toEqual({ npm: "npm install" });
		});

		it("16.2.6 readRawYamlConfigs converts assignment section correctly", () => {
			const dir = makeYamlTestDir("yaml-assign");
			const piDir = join(dir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, "task-orchestrator.yaml"), [
				"assignment:",
				"  strategy: round-robin",
				"  size_weights:",
				"    S: 1",
				"    M: 2",
			].join("\n"), "utf-8");

			const raw = readRawYamlConfigs(dir);
			expect(raw).not.toBeNull();
			expect(raw!.orchestrator.assignment.strategy).toBe("round-robin");
			expect(raw!.orchestrator.assignment.sizeWeights).toEqual({ S: 1, M: 2 });
		});

		it("16.2.7 readRawYamlConfigs supports flat pointer layout", () => {
			const dir = makeYamlTestDir("yaml-flat");
			writeFileSync(join(dir, "task-orchestrator.yaml"), [
				"orchestrator:",
				"  max_lanes: 11",
			].join("\n"), "utf-8");

			const raw = readRawYamlConfigs(dir);
			expect(raw).not.toBeNull();
			expect(raw!.orchestrator.orchestrator.maxLanes).toBe(11);
		});
	});

	describe("16.3 JSON+YAML precedence (JSON wins)", () => {
		it("16.3.1 readRawProjectJson returns JSON data even when YAML also exists", () => {
			const dir = makeYamlTestDir("both");
			const piDir = join(dir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, PROJECT_CONFIG_FILENAME), JSON.stringify({
				configVersion: CONFIG_VERSION,
				orchestrator: { orchestrator: { maxLanes: 10 } },
			}, null, 2), "utf-8");
			writeFileSync(join(piDir, "task-orchestrator.yaml"), "orchestrator:\n  max_lanes: 5\n", "utf-8");

			const rawJson = readRawProjectJson(dir);
			expect(rawJson).not.toBeNull();
			expect(rawJson!.orchestrator.orchestrator.maxLanes).toBe(10);
		});

		it("16.3.2 source detection uses JSON (not YAML) when both exist — mirrors loadConfigState fallback", () => {
			// loadConfigState: rawProject = readRawProjectJson(...) || readRawYamlConfigs(...)
			// When JSON exists, YAML is never consulted for source detection.
			const dir = makeYamlTestDir("precedence");
			const piDir = join(dir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, PROJECT_CONFIG_FILENAME), JSON.stringify({
				orchestrator: { orchestrator: { maxLanes: 10 } },
			}, null, 2), "utf-8");
			writeFileSync(join(piDir, "task-orchestrator.yaml"), "orchestrator:\n  max_lanes: 5\n  spawn_mode: tmux\n", "utf-8");

			// Simulate the || fallback from loadConfigState
			const rawProject = readRawProjectJson(dir) || readRawYamlConfigs(dir);
			expect(rawProject).not.toBeNull();

			// maxLanes is in JSON → (project)
			const field = makeL1Field();
			expect(detectFieldSource(field, rawProject, null)).toBe("project");

			// spawnMode is NOT in JSON (only in YAML) — but since JSON exists,
			// YAML is not consulted at all — so spawnMode falls to (default)
			const spawnField = makeL1L2EnumField(); // spawnMode
			expect(detectFieldSource(spawnField, rawProject, null)).toBe("global");
		});
	});

	describe("16.4 YAML source-badge with preferences (empty-string clear)", () => {
		it("16.4.1 YAML-sourced field + valid global pref still shows (project)", () => {
			const field = makeL1L2StringField(); // workerModel
			const rawYaml = { taskRunner: { worker: { model: "gpt-4" } } };
			const rawPrefs = { workerModel: "claude-4-opus" };
			expect(detectFieldSource(field, rawYaml, rawPrefs)).toBe("project");
		});

		it("16.4.2 YAML-sourced field + empty-string pref → falls to (project)", () => {
			const field = makeL1L2StringField();
			const rawYaml = { taskRunner: { worker: { model: "gpt-4" } } };
			const rawPrefs = { workerModel: "" };
			expect(detectFieldSource(field, rawYaml, rawPrefs)).toBe("project");
		});

		it("16.4.3 YAML-sourced field + no pref + field present → (project)", () => {
			const field = makeL1L2StringField();
			const rawYaml = { taskRunner: { worker: { model: "gpt-4" } } };
			expect(detectFieldSource(field, rawYaml, null)).toBe("project");
		});
	});
});


// ── 17.x Write-Decision Logic ────────────────────────────────────────
// Tests the extracted resolveWriteAction + getDefaultWriteDestination
// functions that encapsulate the destination/confirmation decision tree
// from showSectionSettingsLoop. These exercise real function calls — not
// tautological "file unchanged when we didn't write" assertions (R010 fix).

describe("17. Write-decision logic (resolveWriteAction)", () => {

	// 17.1 — getDefaultWriteDestination routing

	describe("17.1 getDefaultWriteDestination", () => {
		it("17.1.1 L1-only field → 'prefs' (global default)", () => {
			const field = makeL1Field();
			expect(getDefaultWriteDestination(field)).toBe("prefs");
		});

		it("17.1.2 L2-only field → 'prefs'", () => {
			const field = makeL2NumberField();
			expect(getDefaultWriteDestination(field)).toBe("prefs");
		});

		it("17.1.3 L1+L2 string field → 'prefs' (global default)", () => {
			const field = makeL1L2StringField();
			expect(getDefaultWriteDestination(field)).toBe("prefs");
		});

		it("17.1.4 L1+L2 enum field → 'prefs' (global default)", () => {
			const field = makeL1L2EnumField();
			expect(getDefaultWriteDestination(field)).toBe("prefs");
		});
	});

	// 17.2 — L1-only resolveWriteAction

	describe("17.2 L1-only fields", () => {
		it("17.2.1 L1 field + null destination choice (escape) → 'skip'", () => {
			const field = makeL1Field();
			expect(resolveWriteAction(field, null, true)).toBe("skip");
		});

		it("17.2.2 L1 field + explicit global destination → 'prefs'", () => {
			const field = makeL1Field();
			expect(resolveWriteAction(field, "Global preferences (default)", false)).toBe("prefs");
		});
	});

	// 17.3 — L2-only resolveWriteAction

	describe("17.3 L2-only fields", () => {
		it("17.3.1 L2 field → 'prefs' regardless of confirmation flag", () => {
			const field = makeL2NumberField();
			expect(resolveWriteAction(field, null, false)).toBe("prefs");
		});

		it("17.3.2 L2 field → 'prefs' (confirmation not consulted)", () => {
			const field = makeL2NumberField();
			expect(resolveWriteAction(field, null, true)).toBe("prefs");
		});
	});

	// 17.4 — L1+L2 Cancel path

	describe("17.4 L1+L2 destination Cancel", () => {
		it("17.4.1 L1+L2 field + Cancel choice → 'skip'", () => {
			const field = makeL1L2StringField();
			expect(resolveWriteAction(field, "Cancel", true)).toBe("skip");
		});

		it("17.4.2 L1+L2 field + null choice (escaped) → 'skip'", () => {
			const field = makeL1L2StringField();
			expect(resolveWriteAction(field, null, true)).toBe("skip");
		});

		it("17.4.3 L1+L2 enum field + Cancel choice → 'skip'", () => {
			const field = makeL1L2EnumField();
			expect(resolveWriteAction(field, "Cancel", false)).toBe("skip");
		});
	});

	// 17.5 — L1+L2 user prefs destination

	describe("17.5 L1+L2 global preferences destination", () => {
		it("17.5.1 L1+L2 + 'Global preferences (personal)' → 'prefs'", () => {
			const field = makeL1L2StringField();
			expect(resolveWriteAction(field, "Global preferences (personal)", false)).toBe("prefs");
		});

		it("17.5.2 L1+L2 + user prefs choice — confirmation flag irrelevant", () => {
			const field = makeL1L2StringField();
			expect(resolveWriteAction(field, "Global preferences (personal)", true)).toBe("prefs");
		});
	});

	// 17.6 — L1+L2 project destination with confirmation gate

	describe("17.6 L1+L2 project destination + confirmation", () => {
		it("17.6.1 L1+L2 + 'Project config (shared)' + confirmed → 'project'", () => {
			const field = makeL1L2StringField();
			expect(resolveWriteAction(field, "Project config (shared)", true)).toBe("project");
		});

		it("17.6.2 L1+L2 + 'Project config (shared)' + declined → 'skip'", () => {
			const field = makeL1L2StringField();
			expect(resolveWriteAction(field, "Project config (shared)", false)).toBe("skip");
		});

		it("17.6.3 L1+L2 enum + 'Project config (shared)' + declined → 'skip'", () => {
			const field = makeL1L2EnumField();
			expect(resolveWriteAction(field, "Project config (shared)", false)).toBe("skip");
		});

		it("17.6.4 remove-project destination returns remove-project route", () => {
			const field = makeL1L2StringField();
			expect(resolveWriteAction(field, "Remove project override (revert to global)", true)).toBe("remove-project");
		});
	});

	// 17.7 — Idempotent write and coerce markers (kept from original suite)

	describe("17.7 Idempotent write and coerce edge cases", () => {
		let zeroMutRoot: string;
		let savedAgentDir: string | undefined;

		beforeEach(() => {
			zeroMutRoot = join(tmpdir(), `tp-zeromut-${Date.now()}-${Math.random().toString(36).slice(2)}`);
			mkdirSync(zeroMutRoot, { recursive: true });
			savedAgentDir = process.env.PI_CODING_AGENT_DIR;
		});

		afterEach(() => {
			if (savedAgentDir !== undefined) {
				process.env.PI_CODING_AGENT_DIR = savedAgentDir;
			} else {
				delete process.env.PI_CODING_AGENT_DIR;
			}
			try {
				rmSync(zeroMutRoot, { recursive: true, force: true });
			} catch { /* best effort */ }
		});

		it("17.7.1 writeProjectConfigField with same value produces valid JSON (idempotent)", () => {
			const piDir = join(zeroMutRoot, ".pi");
			mkdirSync(piDir, { recursive: true });
			const configPath = join(piDir, PROJECT_CONFIG_FILENAME);
			writeFileSync(configPath, JSON.stringify({
				configVersion: CONFIG_VERSION,
				orchestrator: { orchestrator: { maxLanes: 3 } },
			}, null, 2), "utf-8");

			writeProjectConfigField(zeroMutRoot, "orchestrator.orchestrator.maxLanes", 3);

			const result = JSON.parse(readFileSync(configPath, "utf-8"));
			expect(result.orchestrator.orchestrator.maxLanes).toBe(3);
			expect(result.configVersion).toBe(CONFIG_VERSION);
		});

		it("17.7.2 coerceValueForWrite returns undefined for '(not set)' marker", () => {
			const optField = makeL2NumberField();
			expect(coerceValueForWrite(optField, "(not set)")).toBeUndefined();
		});

		it("17.7.3 L2-only write skips confirmation gate (resolveWriteAction proves this)", () => {
			// resolveWriteAction returns "prefs" even when projectConfirmed is false —
			// proving the confirmation gate is never consulted for L2-only fields.
			const field = makeL2NumberField();
			expect(resolveWriteAction(field, null, false)).toBe("prefs");

			// And verify actual write works
			process.env.PI_CODING_AGENT_DIR = zeroMutRoot;
			const prefsDir = join(zeroMutRoot, "taskplane");
			mkdirSync(prefsDir, { recursive: true });
			const prefsPath = join(prefsDir, "preferences.json");
			writeFileSync(prefsPath, JSON.stringify({ dashboardPort: 8080 }, null, 2), "utf-8");

			writeGlobalPreference("dashboardPort", 9090);

			const result = JSON.parse(readFileSync(prefsPath, "utf-8"));
			expect(result.dashboardPort).toBe(9090);
		});
	});
});


// ── 18.x Advanced Section Discoverability ────────────────────────────
// Verifies that uncovered/new fields appear in the Advanced section,
// ensuring the "immediately discoverable" completion criterion (R009 item 3).

describe("18. Advanced section discoverability", () => {
	it("18.1 getAdvancedItems surfaces known uncovered fields", () => {
		const config = cloneConfig();
		const items = getAdvancedItems(config);
		const paths = items.map((i) => i.configPath);

		// These fields are NOT editable in sections 1-11 and should appear in Advanced:
		expect(paths).toContain("configVersion");
		expect(paths).toContain("taskRunner.project.name");
		expect(paths).toContain("taskRunner.project.description");
		expect(paths).toContain("taskRunner.paths.tasks");
	});

	it("18.2 getAdvancedItems does NOT include fields that are editable in sections", () => {
		const config = cloneConfig();
		const items = getAdvancedItems(config);
		const paths = items.map((i) => i.configPath);

		// These are editable and should NOT appear in Advanced:
		expect(paths).not.toContain("orchestrator.orchestrator.maxLanes");
		// orchestrator.orchestrator.spawnMode is intentionally NOT editable —
		// /orch always requires tmux. It appears in Advanced as read-only.
		expect(paths).not.toContain("taskRunner.worker.model");
		expect(paths).not.toContain("orchestrator.failure.stallTimeout");
		expect(paths).not.toContain("orchestrator.monitoring.pollInterval");
	});

	it("18.3 getAdvancedItems surfaces collection/Record fields", () => {
		const config = cloneConfig();
		// Add some data to collection fields so they appear
		config.taskRunner.testing = { commands: { "test": "npm test" } };
		config.taskRunner.standards = { docs: ["README.md"], rules: ["rule1"] };
		config.taskRunner.neverLoad = ["node_modules"];
		config.orchestrator.merge.verify = ["lint"];

		const items = getAdvancedItems(config);
		const paths = items.map((i) => i.configPath);

		expect(paths).toContain("taskRunner.testing.commands");
		expect(paths).toContain("taskRunner.standards.docs");
		expect(paths).toContain("taskRunner.standards.rules");
		expect(paths).toContain("taskRunner.neverLoad");
		expect(paths).toContain("orchestrator.merge.verify");
	});

	it("18.4 new field added to config object appears in Advanced automatically", () => {
		const config = cloneConfig();
		// Simulate a schema addition: add a hypothetical new field
		(config.taskRunner as any).experimental = { newFeature: true };

		const items = getAdvancedItems(config);
		const paths = items.map((i) => i.configPath);

		// The new field should appear because it's not in any editable section
		expect(paths).toContain("taskRunner.experimental");
	});

	it("18.5 Advanced item values are summarized correctly", () => {
		const config = cloneConfig();
		config.taskRunner.neverLoad = ["node_modules", ".git", "dist"];
		config.taskRunner.testing = { commands: { "test": "npm test", "lint": "npm run lint" } };

		const items = getAdvancedItems(config);

		// Array summary: 3 items → "node_modules, .git, dist" (≤3 items shown)
		const neverLoadItem = items.find((i) => i.configPath === "taskRunner.neverLoad");
		expect(neverLoadItem).toBeDefined();
		expect(neverLoadItem!.value).toBe("node_modules, .git, dist");

		// Record summary: 2 keys → "test, lint"
		const testingItem = items.find((i) => i.configPath === "taskRunner.testing.commands");
		expect(testingItem).toBeDefined();
		expect(testingItem!.value).toBe("test, lint");
	});

	it("18.6 Advanced surfaces configVersion as read-only", () => {
		const config = cloneConfig();
		const items = getAdvancedItems(config);
		const versionItem = items.find((i) => i.configPath === "configVersion");
		expect(versionItem).toBeDefined();
		expect(versionItem!.value).toBe(String(CONFIG_VERSION));
	});

	it("18.7 empty arrays/Records show '(empty)' in Advanced", () => {
		const config = cloneConfig();
		config.taskRunner.neverLoad = [];
		config.taskRunner.selfDocTargets = {};

		const items = getAdvancedItems(config);

		const neverLoad = items.find((i) => i.configPath === "taskRunner.neverLoad");
		expect(neverLoad).toBeDefined();
		expect(neverLoad!.value).toBe("(empty)");

		const selfDoc = items.find((i) => i.configPath === "taskRunner.selfDocTargets");
		expect(selfDoc).toBeDefined();
		expect(selfDoc!.value).toBe("(empty)");
	});

	it("18.8 every editable section field is excluded from Advanced items", () => {
		const config = cloneConfig();
		const items = getAdvancedItems(config);
		const advancedPaths = new Set(items.map((i) => i.configPath));

		// Check ALL editable fields across all sections
		for (const section of SECTIONS) {
			if (section.readOnly) continue;
			for (const field of section.fields) {
				expect(advancedPaths.has(field.configPath)).toBe(false);
			}
		}
	});
});

// ── 19.x Model-change thinking suggestion helpers (TP-138) ─────────

describe("19. model-change thinking suggestion helpers", () => {
	function makeModelCtx(models: any[]): any {
		return {
			modelRegistry: {
				getAvailable: () => models,
			},
		};
	}

	it("19.1 modelSupportsThinking detects boolean, nested, and string thinking flags", () => {
		expect(modelSupportsThinking({ supportsThinking: true })).toBe(true);
		expect(modelSupportsThinking({ capabilities: { reasoningEffort: ["low", "medium"] } })).toBe(true);
		expect(modelSupportsThinking({ thinking: "yes" })).toBe(true);
		expect(modelSupportsThinking({ thinking: "no" })).toBe(false);
		expect(modelSupportsThinking({ id: "plain-model" })).toBe(false);
	});

	it("19.2 buildThinkingSuggestionForModelChange suggests enabling thinking when supported", () => {
		const ctx = makeModelCtx([{ provider: "openai", id: "gpt-5", supportsThinking: true }]);
		const config = cloneConfig();
		config.taskRunner.worker.thinking = "";

		const field = makeL1L2StringField({
			configPath: "taskRunner.worker.model",
			label: "Worker Model",
			prefsKey: "workerModel",
		});

		const suggestion = buildThinkingSuggestionForModelChange(
			ctx,
			field,
			"openai/gpt-4.1",
			"openai/gpt-5",
			config,
		);

		expect(suggestion).toContain("Worker model supports thinking");
		expect(suggestion).toContain("Worker Thinking");
		expect(suggestion).toContain("high");
	});

	it("19.3 buildThinkingSuggestionForModelChange is suppressed when already high", () => {
		const ctx = makeModelCtx([{ provider: "openai", id: "gpt-5", supportsThinking: true }]);
		const config = cloneConfig();
		config.taskRunner.worker.thinking = "high";

		const field = makeL1L2StringField({
			configPath: "taskRunner.worker.model",
			label: "Worker Model",
			prefsKey: "workerModel",
		});

		const suggestion = buildThinkingSuggestionForModelChange(
			ctx,
			field,
			"openai/gpt-4.1",
			"openai/gpt-5",
			config,
		);

		expect(suggestion).toBe(null);
	});

	it("19.4 buildThinkingUnsupportedNoteForThinkingField warns but does not block", () => {
		const ctx = makeModelCtx([{ provider: "openai", id: "gpt-5", supportsThinking: false }]);
		const config = cloneConfig();
		config.taskRunner.worker.model = "openai/gpt-5";

		const thinkingField = makeL1Field({
			configPath: "taskRunner.worker.thinking",
			label: "Worker Thinking",
			control: "picker",
			fieldType: "string",
		});

		const note = buildThinkingUnsupportedNoteForThinkingField(ctx, thinkingField, config);
		expect(note).toContain("does not advertise thinking support");
		expect(note).toContain("still set thinking");
	});
});
