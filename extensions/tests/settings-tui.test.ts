/**
 * Settings TUI Pure Function Tests — TP-018 Step 2
 *
 * Tests for the pure/testable functions exported from settings-tui.ts:
 *   - detectFieldSource: source badge precedence with type guards
 *   - getFieldDisplayValue: merged config → display string
 *   - validateFieldInput: input validation per field type
 *
 * These functions are the core logic of the /settings TUI — testing them
 * ensures source badges are accurate, values display correctly, and
 * validation matches the declared contract.
 *
 * Test categories:
 *   9.x  — detectFieldSource: source badge precedence and type guards
 *   10.x — getFieldDisplayValue: value display formatting
 *   11.x — validateFieldInput: input validation per field type
 *
 * Run: npx vitest run tests/settings-tui.test.ts
 */

import { describe, it, expect } from "vitest";

import {
	detectFieldSource,
	getFieldDisplayValue,
	validateFieldInput,
	SECTIONS,
} from "../taskplane/settings-tui.ts";
import type { FieldDef, FieldSource } from "../taskplane/settings-tui.ts";
import {
	DEFAULT_PROJECT_CONFIG,
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
