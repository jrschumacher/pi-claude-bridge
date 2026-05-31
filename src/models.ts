// Self-owned model list for the claude-bridge provider, decoupled from pi-ai.
// DEFAULT_MODELS is the baked-in source of truth (ordered for the picker);
// users add/override entries via claude-bridge.json `models`. mergeModels folds
// overrides into the defaults (new ids prepend, matching ids override in place),
// buildModels finalizes the provider shape, and resolveModelId returns the first
// partial match so `opus` resolves to the first-listed opus entry.

export interface BridgeModel {
	id: string;
	name: string;
	reasoning: boolean;
	input: string[];
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Record<string, string>;
}

// Metadata taken from pi-ai 0.77.0. Note opus-4-6 maps xhigh→max while
// 4-7/4-8 map xhigh→xhigh; sonnet/haiku carry no map (generic fallback applies).
//
// contextWindow defaults to 200K (not the models' 1M ceiling) ON PURPOSE. pi sizes
// compaction to contextWindow (shouldCompact: tokens > contextWindow - reserve) and
// the bridge disables CC's own auto-compact (DISABLE_AUTO_COMPACT=1), so advertising a
// window larger than what Claude Code actually grants makes pi let the prompt grow past
// the real ceiling → "Prompt is too long" with no compaction. The bridge DOES send the
// context-1m-2025-08-07 beta when a model is configured >200K (see enable1mContext in
// index.ts), so opus-4-7 / sonnet-4-6 CAN be opted up to their real 1M via
// claude-bridge.json `models`.
//
// EXCEPTION — claude-opus-4-8 stays 200K even though it's a 1M model: its 1M is gated
// behind a Claude Code Statsig experiment (`tengu_amber_redwood2`, hardcoded for that
// id in the CLI binary) that is active in interactive Claude Code but NOT on the
// headless/SDK path the bridge uses — so the server hard-caps it at 200K here, beta or
// not. Opting it up in config just reintroduces the overflow. Recheck after CC updates;
// once the rollout reaches the SDK surface, bump it like the others. See
// elidickinson/pi-claude-bridge#22.
export const DEFAULT_MODELS: BridgeModel[] = [
	// opus-4-8: leave at 200K — Statsig-gated 1M not yet on the SDK path (see note above).
	{ id: "claude-opus-4-8", name: "Claude Opus 4.8", reasoning: true, input: ["text", "image"], contextWindow: 200_000, maxTokens: 128_000, thinkingLevelMap: { xhigh: "xhigh" } },
	{ id: "claude-opus-4-7", name: "Claude Opus 4.7", reasoning: true, input: ["text", "image"], contextWindow: 200_000, maxTokens: 128_000, thinkingLevelMap: { xhigh: "xhigh" } },
	{ id: "claude-opus-4-6", name: "Claude Opus 4.6", reasoning: true, input: ["text", "image"], contextWindow: 200_000, maxTokens: 128_000, thinkingLevelMap: { xhigh: "max" } },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", reasoning: true, input: ["text", "image"], contextWindow: 200_000, maxTokens: 64_000 },
	{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5", reasoning: true, input: ["text", "image"], contextWindow: 200_000, maxTokens: 64_000 },
];

// Defaults used to fill omitted fields of a bare/partial override.
const FALLBACK = {
	reasoning: true,
	input: ["text", "image"],
	contextWindow: 200_000,
	maxTokens: 64_000,
};

// Fold config overrides into the defaults. Overrides matching an existing id
// update only the provided fields and keep their position; overrides with a new
// id are prepended in override order (so they win shortcut resolution and become
// first overall). Inputs are not mutated.
export function mergeModels(
	defaults: BridgeModel[],
	overrides?: Array<Partial<BridgeModel> & { id: string }>,
): BridgeModel[] {
	if (!overrides || overrides.length === 0) return defaults.map((m) => ({ ...m }));

	const defaultIds = new Set(defaults.map((m) => m.id));

	// Override-in-place for matching ids (position preserved).
	const merged: BridgeModel[] = defaults.map((m) => {
		const ov = overrides.find((o) => o.id === m.id);
		return ov ? { ...m, ...ov } : { ...m };
	});

	// Prepend new ids in override order, filling omitted fields with fallbacks.
	const seen = new Set<string>();
	const prepended: BridgeModel[] = [];
	for (const ov of overrides) {
		if (defaultIds.has(ov.id) || seen.has(ov.id)) continue;
		seen.add(ov.id);
		prepended.push({
			id: ov.id,
			name: ov.name ?? ov.id,
			reasoning: ov.reasoning ?? FALLBACK.reasoning,
			input: ov.input ?? [...FALLBACK.input],
			contextWindow: ov.contextWindow ?? FALLBACK.contextWindow,
			maxTokens: ov.maxTokens ?? FALLBACK.maxTokens,
			...(ov.thinkingLevelMap ? { thinkingLevelMap: ov.thinkingLevelMap } : {}),
		});
	}

	return [...prepended, ...merged];
}

// Finalize the provider shape: emit exactly the fields pi's registerProvider
// expects and zero out cost (billing is handled first-party by the Agent SDK).
export function buildModels(models: BridgeModel[]) {
	return models.map(({ id, name, reasoning, input, contextWindow, maxTokens, thinkingLevelMap }) => ({
		id, name, reasoning,
		// pi's ProviderModelConfig expects the ("text"|"image")[] literal union;
		// BridgeModel.input is the wider string[] (config-supplied), so narrow here.
		input: input as Array<"text" | "image">,
		contextWindow, maxTokens, thinkingLevelMap,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	}));
}

export function resolveModelId(models: Array<{ id: string }>, input: string): string {
	const lower = input.toLowerCase();
	const match = models.find((m) => m.id === lower || m.id.includes(lower));
	return match ? match.id : input;
}
