/**
 * Settings TUI Tests — TP-018 Steps 2 & 3
 *
 * Tests for the pure/testable functions exported from settings-tui.ts:
 *   - detectFieldSource: source badge precedence with type guards
 *   - getFieldDisplayValue: merged config → display string
 *   - validateFieldInput: input validation per field type
 *   - coerceValueForWrite: raw TUI value → typed config value
 *   - writeProjectConfigField: Layer 1 write-back (JSON-only, YAML bootstrap, malformed)
 *   - writeUserPreference: Layer 2 write-back (prefs JSON)
 *
 * Test categories:
 *   9.x  — detectFieldSource: source badge precedence and type guards
 *   10.x — getFieldDisplayValue: value display formatting
 *   11.x — validateFieldInput: input validation per field type
 *   12.x — SECTIONS schema coverage
 *   13.x — coerceValueForWrite: value coercion for write-back
 *   14.x — writeProjectConfigField: Layer 1 project config writes
 *   15.x — writeUserPreference: Layer 2 preferences writes
 *
 * Run: npx vitest run tests/settings-tui.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
	writeUserPreference,
	SECTIONS,
} from "../taskplane/settings-tui.ts";
import type { FieldDef, FieldSource } from "../taskplane/settings-tui.ts";
import {
	DEFAULT_PROJECT_CONFIG,
	CONFIG_VERSION,
	PROJECT_CONFIG_FILENAME,
	USER_PREFERENCES_FILENAME,
	USER_PREFERENCES_SUBDIR,
} from "../taskplane/config-schema.ts";
import type {
	TaskplaneConfig,
	UserPreferences,
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
		values: ["tmux", "subprocess"],
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
			expect(detectFieldSource(field, rawProject, null)).toBe("default");
		});

		it("9.1.3 returns 'default' when raw project config is null", () => {
			const field = makeL1Field();
			expect(detectFieldSource(field, null, null)).toBe("default");
		});

		it("9.1.4 ignores user prefs for L1-only fields", () => {
			const field = makeL1Field();
			const rawProject = {};
			const rawPrefs = { maxLanes: 10 };
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("default");
		});
	});

	// 9.2 — L1+L2 string fields (type-specific guards)

	describe("9.2 L1+L2 string fields", () => {
		it("9.2.1 returns 'user' when string pref is non-empty", () => {
			const field = makeL1L2StringField();
			const rawPrefs = { workerModel: "claude-4-opus" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("user");
		});

		it("9.2.2 returns 'default' when string pref is empty string (cleared)", () => {
			const field = makeL1L2StringField();
			const rawPrefs = { workerModel: "" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
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
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});

		it("9.2.5 rejects non-string pref values (type guard)", () => {
			const field = makeL1L2StringField();
			// If prefs has a number where a string is expected, reject it
			const rawPrefs = { workerModel: 42 };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});

		it("9.2.6 rejects boolean pref values for string fields (type guard)", () => {
			const field = makeL1L2StringField();
			const rawPrefs = { workerModel: true };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});
	});

	// 9.3 — L1+L2 enum fields (type-specific guards)

	describe("9.3 L1+L2 enum fields", () => {
		it("9.3.1 returns 'user' when enum pref is valid value", () => {
			const field = makeL1L2EnumField();
			const rawPrefs = { spawnMode: "tmux" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("user");
		});

		it("9.3.2 returns 'user' for other valid enum value", () => {
			const field = makeL1L2EnumField();
			const rawPrefs = { spawnMode: "subprocess" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("user");
		});

		it("9.3.3 rejects invalid enum value — falls to default", () => {
			const field = makeL1L2EnumField();
			// "invalid" is not in values ["tmux", "subprocess"]
			const rawPrefs = { spawnMode: "invalid" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});

		it("9.3.4 rejects non-string enum value (type guard)", () => {
			const field = makeL1L2EnumField();
			const rawPrefs = { spawnMode: 123 };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});

		it("9.3.5 returns 'default' when enum pref is undefined", () => {
			const field = makeL1L2EnumField();
			const rawPrefs = {};
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});

		it("9.3.6 returns 'project' when enum pref is invalid but project has value", () => {
			const field = makeL1L2EnumField();
			const rawProject = { orchestrator: { orchestrator: { spawnMode: "tmux" } } };
			const rawPrefs = { spawnMode: "bogus" };
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("project");
		});
	});

	// 9.4 — L2-only number fields (type-specific guards)

	describe("9.4 L2-only number fields", () => {
		it("9.4.1 returns 'user' when number pref is valid finite number", () => {
			const field = makeL2NumberField();
			const rawPrefs = { dashboardPort: 8080 };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("user");
		});

		it("9.4.2 returns 'default' when number pref is undefined", () => {
			const field = makeL2NumberField();
			const rawPrefs = {};
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});

		it("9.4.3 rejects string value for number field (type guard)", () => {
			const field = makeL2NumberField();
			const rawPrefs = { dashboardPort: "8080" };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});

		it("9.4.4 rejects NaN for number field (type guard)", () => {
			const field = makeL2NumberField();
			const rawPrefs = { dashboardPort: NaN };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});

		it("9.4.5 rejects Infinity for number field (type guard)", () => {
			const field = makeL2NumberField();
			const rawPrefs = { dashboardPort: Infinity };
			expect(detectFieldSource(field, null, rawPrefs)).toBe("default");
		});
	});

	// 9.5 — Precedence cascading

	describe("9.5 Precedence cascading", () => {
		it("9.5.1 user prefs win over project config for L1+L2 string fields", () => {
			const field = makeL1L2StringField();
			const rawProject = { taskRunner: { worker: { model: "gpt-4" } } };
			const rawPrefs = { workerModel: "claude-4-opus" };
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("user");
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
			expect(detectFieldSource(field, rawProject, rawPrefs)).toBe("default");
		});
	});
});


// ── 10.x getFieldDisplayValue ────────────────────────────────────────

describe("10. getFieldDisplayValue", () => {
	const emptyPrefs: UserPreferences = {};

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
		config.orchestrator.orchestrator.spawnMode = "tmux";
		const field = makeL1L2EnumField();
		expect(getFieldDisplayValue(field, config, emptyPrefs)).toBe("tmux");
	});

	it("10.4 displays dashboardPort from preferences (L2-only)", () => {
		const config = cloneConfig();
		const prefs: UserPreferences = { dashboardPort: 9090 };
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
			values: ["(inherit)", "subprocess", "tmux"],
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
			expect(validateFieldInput(enumField, "tmux").valid).toBe(true);
		});

		it("11.2.2 accepts other valid enum value", () => {
			expect(validateFieldInput(enumField, "subprocess").valid).toBe(true);
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
	it("12.1 has 12 sections defined", () => {
		expect(SECTIONS).toHaveLength(12);
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
		expect(coerceValueForWrite(field, "tmux")).toBe("tmux");
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
			values: ["(inherit)", "subprocess", "tmux"],
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

	it("13.10 strips '(user)' source badge", () => {
		const field = makeL1L2EnumField();
		expect(coerceValueForWrite(field, "tmux  (user)")).toBe("tmux");
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
		expect(result.taskRunner.worker.spawnMode).toBeUndefined();
		expect("spawnMode" in result.taskRunner.worker).toBe(false);
	});

	it("14.4 throws on malformed JSON with descriptive error", () => {
		const dir = makeWriteTestDir("malformed");
		writePiFile(dir, PROJECT_CONFIG_FILENAME, "{ bad json !!!");

		expect(() =>
			writeProjectConfigField(dir, "orchestrator.orchestrator.maxLanes", 5),
		).toThrow(/malformed JSON/i);
	});

	it("14.5 bootstraps JSON from YAML-only project (preserves YAML values)", () => {
		const dir = makeWriteTestDir("yaml-only");
		// Write a YAML config with a custom value
		writePiFile(dir, "task-orchestrator.yaml", `
orchestrator:
  max_lanes: 7
  spawn_mode: tmux
`);

		writeProjectConfigField(dir, "orchestrator.orchestrator.worktreePrefix", "test-wt");

		const jsonPath = join(dir, ".pi", PROJECT_CONFIG_FILENAME);
		expect(existsSync(jsonPath)).toBe(true);
		const result = readJsonFile(jsonPath);
		// The edited field
		expect(result.orchestrator.orchestrator.worktreePrefix).toBe("test-wt");
		// YAML-sourced values are preserved in the bootstrapped JSON
		expect(result.orchestrator.orchestrator.maxLanes).toBe(7);
		expect(result.orchestrator.orchestrator.spawnMode).toBe("tmux");
		// YAML file is still there
		expect(existsSync(join(dir, ".pi", "task-orchestrator.yaml"))).toBe(true);
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
});


// ── 15.x writeUserPreference ─────────────────────────────────────────

describe("15. writeUserPreference", () => {
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
		return join(writeTestRoot, USER_PREFERENCES_SUBDIR, USER_PREFERENCES_FILENAME);
	}

	function writePrefs(obj: any): void {
		const prefsDir = join(writeTestRoot, USER_PREFERENCES_SUBDIR);
		mkdirSync(prefsDir, { recursive: true });
		writeFileSync(getPrefsPath(), JSON.stringify(obj, null, 2), "utf-8");
	}

	it("15.1 writes a new preference value", () => {
		writePrefs({});

		writeUserPreference("dashboardPort", 9090);

		const result = readJsonFile(getPrefsPath());
		expect(result.dashboardPort).toBe(9090);
	});

	it("15.2 updates an existing preference value", () => {
		writePrefs({ dashboardPort: 8080, workerModel: "gpt-4" });

		writeUserPreference("dashboardPort", 9090);

		const result = readJsonFile(getPrefsPath());
		expect(result.dashboardPort).toBe(9090);
		expect(result.workerModel).toBe("gpt-4"); // preserved
	});

	it("15.3 deletes preference when value is undefined", () => {
		writePrefs({ dashboardPort: 8080, workerModel: "gpt-4" });

		writeUserPreference("dashboardPort", undefined);

		const result = readJsonFile(getPrefsPath());
		expect("dashboardPort" in result).toBe(false);
		expect(result.workerModel).toBe("gpt-4"); // preserved
	});

	it("15.4 creates prefs directory and file when they don't exist", () => {
		const prefsPath = getPrefsPath();
		expect(existsSync(prefsPath)).toBe(false);

		writeUserPreference("workerModel", "claude-4-opus");

		expect(existsSync(prefsPath)).toBe(true);
		const result = readJsonFile(prefsPath);
		expect(result.workerModel).toBe("claude-4-opus");
	});

	it("15.5 recovers from malformed prefs file (starts fresh)", () => {
		const prefsDir = join(writeTestRoot, USER_PREFERENCES_SUBDIR);
		mkdirSync(prefsDir, { recursive: true });
		writeFileSync(getPrefsPath(), "NOT VALID JSON!!", "utf-8");

		writeUserPreference("spawnMode", "tmux");

		const result = readJsonFile(getPrefsPath());
		expect(result.spawnMode).toBe("tmux");
	});

	it("15.6 writes string preference correctly", () => {
		writePrefs({});

		writeUserPreference("operatorId", "alice");

		const result = readJsonFile(getPrefsPath());
		expect(result.operatorId).toBe("alice");
	});

	it("15.7 sets string to empty (clear semantics)", () => {
		writePrefs({ workerModel: "gpt-4" });

		writeUserPreference("workerModel", "");

		const result = readJsonFile(getPrefsPath());
		expect(result.workerModel).toBe("");
	});

	it("15.8 no .tmp file left after successful write", () => {
		writePrefs({});

		writeUserPreference("dashboardPort", 3000);

		const tmpPath = getPrefsPath() + ".tmp";
		expect(existsSync(tmpPath)).toBe(false);
	});
});
