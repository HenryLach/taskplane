import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import {
	parsePiListModelsOutput,
	queryAvailableModelsFromPi,
} from "../../bin/taskplane.mjs";

describe("init model discovery helpers", () => {
	it("parses pi --list-models output into structured model rows", () => {
		const raw = [
			"provider   model   context  max-out  thinking  images",
			"anthropic  claude-sonnet-4-6  1M  64K  yes  yes",
			"openai     gpt-5.3-codex      400K 128K yes yes",
			"anthropic  claude-sonnet-4-6  1M  64K  yes  yes",
		].join("\n");

		const parsed = parsePiListModelsOutput(raw);
		expect(parsed).toEqual([
			{
				provider: "anthropic",
				id: "claude-sonnet-4-6",
				displayName: "anthropic/claude-sonnet-4-6",
			},
			{
				provider: "openai",
				id: "gpt-5.3-codex",
				displayName: "openai/gpt-5.3-codex",
			},
		]);
	});

	it("returns graceful fallback when pi is unavailable", () => {
		const result = queryAvailableModelsFromPi({
			commandExistsImpl: () => false,
		});

		expect(result.available).toBe(false);
		expect(result.models).toEqual([]);
		expect(result.error).toContain("not available");
	});

	it("returns graceful fallback when list command fails", () => {
		const result = queryAvailableModelsFromPi({
			commandExistsImpl: () => true,
			execFileSyncImpl: () => {
				const err = new Error("list failed");
				(err as any).stderr = Buffer.from("backend timeout");
				throw err;
			},
		});

		expect(result.available).toBe(false);
		expect(result.models).toEqual([]);
		expect(result.error).toContain("backend timeout");
	});

	it("returns available models when list command succeeds", () => {
		const result = queryAvailableModelsFromPi({
			commandExistsImpl: () => true,
			execFileSyncImpl: () => [
				"provider   model   context",
				"openai gpt-5.3-codex 400K",
			].join("\n"),
		});

		expect(result.available).toBe(true);
		expect(result.error).toBeNull();
		expect(result.models).toEqual([
			{
				provider: "openai",
				id: "gpt-5.3-codex",
				displayName: "openai/gpt-5.3-codex",
			},
		]);
	});
});
