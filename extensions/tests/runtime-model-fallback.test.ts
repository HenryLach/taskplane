/**
 * Runtime Model Fallback Tests — TP-055 Step 4
 *
 * Tests for the runtime model fallback feature:
 *
 *   1.x — Exit classification: model_access_error correctly classified
 *   2.x — Config loading: modelFallback defaults and overrides
 *   3.x — Fallback logic: source-based verification of retry-without-model pattern
 *   4.x — Edge cases: fallback disabled, non-model errors don't trigger, budget limits
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/runtime-model-fallback.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
	classifyExit,
	EXIT_CLASSIFICATIONS,
	isModelAccessError,
	MODEL_ACCESS_ERROR_PATTERNS,
	type ExitClassificationInput,
	type ExitSummary,
	type ExitClassification,
} from "../taskplane/diagnostics.ts";

import {
	TIER0_RETRYABLE_CLASSIFICATIONS,
	TIER0_RETRY_BUDGETS,
	tier0ScopeKey,
} from "../taskplane/types.ts";

import type {
	Tier0RecoveryPattern,
} from "../taskplane/types.ts";

import {
	DEFAULT_TASK_RUNNER_SECTION,
} from "../taskplane/config-schema.ts";

import type {
	ModelFallbackMode,
} from "../taskplane/config-schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read source file for source-based pattern tests. */
function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8").replace(/\r\n/g, "\n");
}

/** Build a minimal valid ExitSummary with overrides. */
function makeSummary(overrides: Partial<ExitSummary> = {}): ExitSummary {
	return {
		exitCode: 0,
		exitSignal: null,
		tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
		cost: 0.01,
		toolCalls: 1,
		retries: [],
		compactions: 0,
		durationSec: 10,
		lastToolCall: "bash: echo hello",
		error: null,
		...overrides,
	};
}

/** Build a minimal ExitClassificationInput with overrides. */
function makeInput(overrides: Partial<ExitClassificationInput> = {}): ExitClassificationInput {
	return {
		exitSummary: makeSummary(),
		doneFileFound: false,
		timerKilled: false,
		stallDetected: false,
		userKilled: false,
		contextPct: null,
		...overrides,
	};
}

// ── 1. Exit Classification: model_access_error ───────────────────────

describe("model_access_error classification", () => {
	describe("isModelAccessError — positive matches", () => {
		const positivePatterns = [
			"HTTP 401 Unauthorized",
			"HTTP 403 Forbidden",
			"Error 429: rate limit exceeded",
			"model not found: gpt-5-turbo",
			"model_not_found",
			"model is unavailable",
			"model unavailable in this region",
			"model has been deprecated",
			"api key expired",
			"api_key_invalid",
			"api key revoked",
			"invalid api key",
			"invalid_api_key",
			"authentication failed",
			"authentication error",
			"authentication required",
			"authorization failed",
			"authorization denied",
			"access denied",
			"access_denied",
			"permission denied",
			"permission_denied",
			"quota exceeded",
			"quota_exceeded",
			"rate limit hit",
			"rate_limit_exceeded",
			"insufficient quota",
			"insufficient_quota",
		];

		for (const pattern of positivePatterns) {
			it(`matches: "${pattern}"`, () => {
				expect(isModelAccessError(pattern)).toBe(true);
			});
		}
	});

	describe("isModelAccessError — negative controls (should NOT match)", () => {
		const negativePatterns = [
			"internal server error",
			"server_overloaded_please_retry",
			"connection timeout",
			"network error",
			"overloaded",
			"service unavailable",  // generic, not model-specific
			"unknown error occurred",
			"context window exceeded",
			"max tokens exceeded",
			"",
		];

		for (const pattern of negativePatterns) {
			it(`does NOT match: "${pattern || '(empty string)'}"`, () => {
				expect(isModelAccessError(pattern)).toBe(false);
			});
		}
	});

	describe("classifyExit — model_access_error via retries", () => {
		it("classifies model_access_error when last retry error matches pattern", () => {
			const input = makeInput({
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "rate_limit_exceeded", delayMs: 5000, succeeded: false },
					],
				}),
			});
			expect(classifyExit(input)).toBe("model_access_error");
		});

		it("classifies model_access_error for 401 error in retries", () => {
			const input = makeInput({
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "HTTP 401 Unauthorized", delayMs: 1000, succeeded: false },
					],
				}),
			});
			expect(classifyExit(input)).toBe("model_access_error");
		});

		it("classifies model_access_error for model not found", () => {
			const input = makeInput({
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "model not found: gpt-5-turbo", delayMs: 1000, succeeded: false },
					],
				}),
			});
			expect(classifyExit(input)).toBe("model_access_error");
		});

		it("classifies api_error for non-model retry errors", () => {
			const input = makeInput({
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "internal_server_error", delayMs: 1000, succeeded: false },
					],
				}),
			});
			expect(classifyExit(input)).toBe("api_error");
		});
	});

	describe("classifyExit — model_access_error via error message (no retries)", () => {
		it("classifies model_access_error from exit summary error field", () => {
			const input = makeInput({
				exitSummary: makeSummary({
					error: "api key expired",
				}),
			});
			expect(classifyExit(input)).toBe("model_access_error");
		});

		it("does NOT classify model_access_error for generic error messages", () => {
			const input = makeInput({
				exitSummary: makeSummary({
					error: "connection reset by peer",
				}),
			});
			// Should be unknown (exitCode=0, no retries, no model error)
			expect(classifyExit(input)).toBe("unknown");
		});
	});

	describe("classifyExit — model_access_error precedence", () => {
		it(".DONE beats model_access_error", () => {
			const input = makeInput({
				doneFileFound: true,
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "rate_limit_exceeded", delayMs: 1000, succeeded: false },
					],
				}),
			});
			expect(classifyExit(input)).toBe("completed");
		});

		it("model_access_error beats context_overflow", () => {
			const input = makeInput({
				exitSummary: makeSummary({
					compactions: 2,
					retries: [
						{ attempt: 1, error: "model not found", delayMs: 1000, succeeded: false },
					],
				}),
				contextPct: 95,
			});
			expect(classifyExit(input)).toBe("model_access_error");
		});

		it("model_access_error beats wall_clock_timeout", () => {
			const input = makeInput({
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "authentication failed", delayMs: 1000, succeeded: false },
					],
				}),
				timerKilled: true,
			});
			expect(classifyExit(input)).toBe("model_access_error");
		});
	});

	describe("EXIT_CLASSIFICATIONS — includes model_access_error", () => {
		it("model_access_error is in the classifications array", () => {
			expect(EXIT_CLASSIFICATIONS).toContain("model_access_error");
		});

		it("total count is 10 (9 original + model_access_error)", () => {
			expect(EXIT_CLASSIFICATIONS).toHaveLength(10);
		});
	});
});

// ── 2. Config: modelFallback defaults and loading ────────────────────

describe("modelFallback config", () => {
	it("DEFAULT_TASK_RUNNER_SECTION has modelFallback set to 'inherit'", () => {
		expect(DEFAULT_TASK_RUNNER_SECTION.modelFallback).toBe("inherit");
	});

	it("ModelFallbackMode type allows 'inherit' and 'fail'", () => {
		const inherit: ModelFallbackMode = "inherit";
		const fail: ModelFallbackMode = "fail";
		expect(inherit).toBe("inherit");
		expect(fail).toBe("fail");
	});

	describe("config-schema source verification", () => {
		it("TaskRunnerSection interface includes modelFallback field", () => {
			const source = readSource("config-schema.ts");
			expect(source).toContain("modelFallback: ModelFallbackMode");
		});

		it("default config has modelFallback: 'inherit'", () => {
			const source = readSource("config-schema.ts");
			expect(source).toContain('modelFallback: "inherit"');
		});
	});

	describe("config-loader source verification", () => {
		it("YAML loader maps model_fallback to modelFallback", () => {
			const source = readSource("config-loader.ts");
			expect(source).toContain("model_fallback");
			expect(source).toContain("modelFallback");
		});

		it("TaskRunnerConfig output includes model_fallback", () => {
			const source = readSource("config-loader.ts");
			// The loader should set model_fallback in the output
			expect(source).toMatch(/model_fallback.*modelFallback/s);
		});
	});
});

// ── 3. Fallback Logic: source-based verification ─────────────────────

describe("model fallback retry logic", () => {
	describe("Tier 0 recovery pattern registration", () => {
		it("model_fallback is a registered Tier0RecoveryPattern", () => {
			const source = readSource("types.ts");
			expect(source).toContain('"model_fallback"');
		});

		it("model_access_error is in TIER0_RETRYABLE_CLASSIFICATIONS", () => {
			expect(TIER0_RETRYABLE_CLASSIFICATIONS.has("model_access_error")).toBe(true);
		});

		it("model_fallback has a retry budget with maxRetries=1", () => {
			const budget = TIER0_RETRY_BUDGETS.model_fallback;
			expect(budget).toBeDefined();
			expect(budget.maxRetries).toBe(1);
		});
	});

	describe("engine.ts — attemptModelFallbackRetry structure", () => {
		const engineSource = readSource("engine.ts");

		it("has attemptModelFallbackRetry function", () => {
			expect(engineSource).toContain("attemptModelFallbackRetry");
		});

		it("checks runnerConfig.model_fallback for mode", () => {
			// Must read from runnerConfig, not orchConfig
			expect(engineSource).toContain("runnerConfig?.model_fallback");
		});

		it("short-circuits when mode is not inherit", () => {
			expect(engineSource).toContain('modelFallbackMode !== "inherit"');
		});

		it("only processes model_access_error tasks", () => {
			expect(engineSource).toContain('classification !== "model_access_error"');
		});

		it("sets TASKPLANE_MODEL_FALLBACK env var for retry", () => {
			expect(engineSource).toContain("TASKPLANE_MODEL_FALLBACK");
			expect(engineSource).toContain('"1"');
		});

		it("uses model_fallback scope key for budget tracking", () => {
			expect(engineSource).toContain('tier0ScopeKey("model_fallback"');
		});

		it("emits Tier 0 events for attempt/success/exhaustion", () => {
			expect(engineSource).toContain("tier0_recovery_attempt");
			expect(engineSource).toContain("tier0_recovery_success");
			expect(engineSource).toContain("tier0_recovery_exhausted");
		});
	});

	describe("engine.ts — worker crash retry skips model_access_error", () => {
		const engineSource = readSource("engine.ts");

		it("attemptWorkerCrashRetry skips model_access_error tasks", () => {
			expect(engineSource).toContain('classification === "model_access_error"');
			// The skip should be in attemptWorkerCrashRetry, not attemptModelFallbackRetry
			// Check that the skip message references deferring to model fallback
			expect(engineSource).toContain("deferring to model fallback handler");
		});
	});

	describe("engine.ts — model fallback called before worker crash retry", () => {
		const engineSource = readSource("engine.ts");

		it("attemptModelFallbackRetry is called in executeOrchBatch", () => {
			expect(engineSource).toContain("attemptModelFallbackRetry(");
		});

		it("model fallback runs before worker crash retry", () => {
			const fallbackIdx = engineSource.indexOf("attemptModelFallbackRetry(");
			const crashIdx = engineSource.indexOf("attemptWorkerCrashRetry(", fallbackIdx);
			// The first occurrence of attemptModelFallbackRetry in the main flow
			// should come before attemptWorkerCrashRetry in the main flow
			// Find the occurrences in the executeOrchBatch context
			const mainFlowIdx = engineSource.indexOf("TP-055: Tier 0 — Model fallback retry");
			expect(mainFlowIdx).toBeGreaterThan(-1);
			const mainCrashIdx = engineSource.indexOf("TP-039: Tier 0 — Worker crash retry", mainFlowIdx);
			expect(mainCrashIdx).toBeGreaterThan(mainFlowIdx);
		});
	});

	describe("execution.ts — executeLaneV2 extraEnvVars threading", () => {
		const executionSource = readSource("execution.ts");

		it("executeLaneV2 accepts extraEnvVars parameter", () => {
			const match = executionSource.match(/export async function executeLaneV2\([^)]*extraEnvVars/s);
			expect(match).not.toBeNull();
		});

		it("executeLaneV2 reads ORCH_BATCH_ID from extraEnvVars", () => {
			expect(executionSource).toContain("extraEnvVars?.ORCH_BATCH_ID");
		});

		it("executeLaneV2 batchId resolution preserves config-first fallback chain", () => {
			expect(executionSource).toContain("config.orchestrator?.batchId || extraEnvVars?.ORCH_BATCH_ID || String(Date.now())");
		});
	});

	describe("task-runner.ts — TASKPLANE_MODEL_FALLBACK env handling", () => {
		const taskRunnerSource = readFileSync(
			join(__dirname, "..", "task-runner.ts"),
			"utf-8",
		).replace(/\r\n/g, "\n");

		it("reads TASKPLANE_MODEL_FALLBACK env var", () => {
			expect(taskRunnerSource).toContain("TASKPLANE_MODEL_FALLBACK");
		});

		it("checks for value '1' to activate fallback", () => {
			expect(taskRunnerSource).toContain('TASKPLANE_MODEL_FALLBACK === "1"');
		});

		it("applies fallback to worker model", () => {
			// The task-runner should skip configured model when fallback active
			expect(taskRunnerSource).toContain("modelFallbackActive");
		});

		it("applies fallback to reviewer model", () => {
			expect(taskRunnerSource).toContain("reviewerModelFallback");
		});
	});
});

// ── 4. Edge Cases ────────────────────────────────────────────────────

describe("model fallback edge cases", () => {
	describe("fallback disabled (fail mode)", () => {
		it("engine short-circuits when mode is fail", () => {
			const engineSource = readSource("engine.ts");
			// When modelFallbackMode !== "inherit", returns early
			expect(engineSource).toContain("retriedCount: 0, succeededRetries: [], failedRetries: []");
		});
	});

	describe("non-model errors do NOT trigger model fallback", () => {
		it("api_error (generic) is not model_access_error", () => {
			const input = makeInput({
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "overloaded", delayMs: 1000, succeeded: false },
					],
				}),
			});
			expect(classifyExit(input)).toBe("api_error");
		});

		it("process_crash is not model_access_error", () => {
			const input = makeInput({
				exitSummary: makeSummary({ exitCode: 1 }),
			});
			expect(classifyExit(input)).toBe("process_crash");
		});

		it("context_overflow is not model_access_error", () => {
			const input = makeInput({
				exitSummary: makeSummary({ compactions: 3 }),
				contextPct: 95,
			});
			expect(classifyExit(input)).toBe("context_overflow");
		});

		it("session_vanished is not model_access_error", () => {
			const input = makeInput({ exitSummary: null });
			expect(classifyExit(input)).toBe("session_vanished");
		});
	});

	describe("scope key generation", () => {
		it("generates correct scope key for model_fallback", () => {
			const key = tier0ScopeKey("model_fallback", "TP-055", 0);
			expect(key).toContain("model_fallback");
			expect(key).toContain("TP-055");
		});
	});

	describe("isModelAccessError edge cases", () => {
		it("returns false for null-like inputs", () => {
			expect(isModelAccessError("")).toBe(false);
		});

		it("is case-insensitive for text patterns", () => {
			expect(isModelAccessError("Model Not Found")).toBe(true);
			expect(isModelAccessError("MODEL NOT FOUND")).toBe(true);
			expect(isModelAccessError("model not found")).toBe(true);
		});

		it("matches patterns with underscores and spaces interchangeably", () => {
			expect(isModelAccessError("model_not_found")).toBe(true);
			expect(isModelAccessError("model not found")).toBe(true);
		});

		it("does not false-positive on partial word matches", () => {
			// "401" must be a word boundary, not embedded in a number like "14012"
			expect(isModelAccessError("error code 401")).toBe(true);
			expect(isModelAccessError("error code 14012")).toBe(false);
		});
	});
});
