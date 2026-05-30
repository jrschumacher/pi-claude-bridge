/**
 * Tests for the self-owned model list: DEFAULT_MODELS shape/order, mergeModels
 * (override-in-place + prepend-new), buildModels finalizer (cost zeroed, exact
 * fields), and resolveModelId (first partial match; new prepended ids win).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MODELS, mergeModels, buildModels, resolveModelId } from "../src/models.js";

describe("DEFAULT_MODELS", () => {
	it("lists claude-opus-4-8 first", () => {
		assert.equal(DEFAULT_MODELS[0].id, "claude-opus-4-8");
	});

	it("maps opus-4-8 xhigh→xhigh and opus-4-6 xhigh→max", () => {
		const m48 = DEFAULT_MODELS.find((m) => m.id === "claude-opus-4-8");
		const m46 = DEFAULT_MODELS.find((m) => m.id === "claude-opus-4-6");
		assert.deepEqual(m48.thinkingLevelMap, { xhigh: "xhigh" });
		assert.deepEqual(m46.thinkingLevelMap, { xhigh: "max" });
	});
});

describe("mergeModels", () => {
	it("overrides an existing id's fields but keeps its position", () => {
		const merged = mergeModels(DEFAULT_MODELS, [{ id: "claude-sonnet-4-6", maxTokens: 99000 }]);
		const idx = merged.findIndex((m) => m.id === "claude-sonnet-4-6");
		const defIdx = DEFAULT_MODELS.findIndex((m) => m.id === "claude-sonnet-4-6");
		assert.equal(idx, defIdx);
		assert.equal(merged[idx].maxTokens, 99000);
		// Untouched fields preserved.
		assert.equal(merged[idx].name, "Claude Sonnet 4.6");
	});

	it("prepends a new id (becomes index 0)", () => {
		const merged = mergeModels(DEFAULT_MODELS, [{ id: "claude-opus-4-9" }]);
		assert.equal(merged[0].id, "claude-opus-4-9");
		assert.equal(merged.length, DEFAULT_MODELS.length + 1);
	});

	it("keeps the given order of multiple new ids at the front", () => {
		const merged = mergeModels(DEFAULT_MODELS, [{ id: "model-a" }, { id: "model-b" }]);
		assert.equal(merged[0].id, "model-a");
		assert.equal(merged[1].id, "model-b");
		assert.equal(merged[2].id, "claude-opus-4-8");
	});

	it("fills a bare {id} with default fields", () => {
		const merged = mergeModels(DEFAULT_MODELS, [{ id: "brand-new" }]);
		const m = merged[0];
		assert.equal(m.name, "brand-new");
		assert.equal(m.reasoning, true);
		assert.deepEqual(m.input, ["text", "image"]);
		assert.equal(m.contextWindow, 200000);
		assert.equal(m.maxTokens, 64000);
		assert.equal(m.thinkingLevelMap, undefined);
	});

	it("does not mutate the inputs", () => {
		const defaultsSnapshot = JSON.parse(JSON.stringify(DEFAULT_MODELS));
		const overrides = [{ id: "claude-sonnet-4-6", maxTokens: 1 }, { id: "new-one" }];
		const overridesSnapshot = JSON.parse(JSON.stringify(overrides));
		mergeModels(DEFAULT_MODELS, overrides);
		assert.deepEqual(DEFAULT_MODELS, defaultsSnapshot);
		assert.deepEqual(overrides, overridesSnapshot);
	});

	it("returns defaults unchanged when overrides empty/undefined", () => {
		assert.deepEqual(mergeModels(DEFAULT_MODELS).map((m) => m.id), DEFAULT_MODELS.map((m) => m.id));
		assert.deepEqual(mergeModels(DEFAULT_MODELS, []).map((m) => m.id), DEFAULT_MODELS.map((m) => m.id));
	});
});

describe("buildModels", () => {
	it("zeros out cost", () => {
		const models = buildModels(DEFAULT_MODELS);
		for (const m of models) {
			assert.deepEqual(m.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
		}
	});

	it("emits only the expected provider keys", () => {
		const models = buildModels(DEFAULT_MODELS);
		const expected = ["id", "name", "reasoning", "input", "contextWindow", "maxTokens", "thinkingLevelMap", "cost"];
		for (const m of models) {
			assert.deepEqual(Object.keys(m).sort(), [...expected].sort());
		}
	});
});

describe("resolveModelId", () => {
	const models = buildModels(DEFAULT_MODELS);

	it("opus shortcut resolves to claude-opus-4-8 (first opus)", () => {
		assert.equal(resolveModelId(models, "opus"), "claude-opus-4-8");
	});

	it("a prepended new opus id wins the opus shortcut", () => {
		const merged = buildModels(mergeModels(DEFAULT_MODELS, [{ id: "claude-opus-4-9" }]));
		assert.equal(resolveModelId(merged, "opus"), "claude-opus-4-9");
	});

	it("full id passes through unchanged", () => {
		assert.equal(resolveModelId(models, "claude-opus-4-6"), "claude-opus-4-6");
	});

	it("falls through to input when no match", () => {
		assert.equal(resolveModelId(models, "gpt-9"), "gpt-9");
	});
});
