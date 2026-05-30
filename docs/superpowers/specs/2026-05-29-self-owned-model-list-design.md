# Self-owned model list with config override

**Date:** 2026-05-29
**Status:** Approved

## Context

pi-claude-bridge currently builds its provider model list from pi-ai's
`getModels("anthropic")` (`src/models.ts` → `buildModels`, called in
`src/index.ts`). It declares `@earendil-works/pi-ai` as a **peerDependency**, so
at runtime the list is governed by whatever pi-ai the **host pi** bundles — not
the extension's own deps.

This coupling caused a concrete failure: `claude-opus-4-8` (usable by the Claude
Agent SDK from its id alone) never appeared in the picker because the host pi
(0.74.0) bundled pi-ai 0.74.0, which had no such definition — and `buildModels`
silently drops unknown ids. Adding a model required upgrading the global pi.

Nothing about *using* a model requires pi-ai to know it: the bridge runs models
through the Claude Agent SDK, which needs only the model **id string**.
Everything else pulled from pi-ai is cosmetic (`name`, `contextWindow`,
`maxTokens`, `reasoning`, `input`), already zeroed (`cost`), or has a fallback
(`thinkingLevelMap` → generic `REASONING_TO_EFFORT` table in `index.ts`).

**Outcome:** decouple the model list from pi-ai. Ship a baked-in default list so
models are available regardless of host pi version, and let users add/override
models via existing config so a brand-new Claude model can be used the day it
ships, without waiting on an extension or host-pi update.

## Design

### 1. `src/models.ts` — source of truth

Replace `MODEL_IDS_IN_ORDER` (string[]) + the pi-ai projection with a baked-in
ordered list of full model objects.

```ts
export interface BridgeModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Record<string, string>;
}

export const DEFAULT_MODELS: BridgeModel[] = [
  { id: "claude-opus-4-8",   name: "Claude Opus 4.8",   reasoning: true, input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 128_000, thinkingLevelMap: { xhigh: "xhigh" } },
  { id: "claude-opus-4-7",   name: "Claude Opus 4.7",   reasoning: true, input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 128_000, thinkingLevelMap: { xhigh: "xhigh" } },
  { id: "claude-opus-4-6",   name: "Claude Opus 4.6",   reasoning: true, input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 128_000, thinkingLevelMap: { xhigh: "max" } },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", reasoning: true, input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 64_000 },
  { id: "claude-haiku-4-5",  name: "Claude Haiku 4.5",  reasoning: true, input: ["text", "image"], contextWindow: 200_000,   maxTokens: 64_000 },
];
```

Metadata above is taken from pi-ai 0.77.0. Note `opus-4-6` maps `xhigh→max`
while `4-7`/`4-8` map `xhigh→xhigh`; sonnet/haiku carry no map (generic fallback
applies). The `getModels("anthropic")` dependency for the model list is dropped.
`@earendil-works/pi-coding-agent` remains a peer dep (used for `ExtensionAPI`,
`buildSessionContext`, `keyHint`, etc.).

### 2. Merge logic — `mergeModels(defaults, overrides?)`

- Override entry whose `id` matches a default → override that default's provided
  fields **in place** (position preserved).
- Override entry with a **new** `id` → **prepended** in override order, so it
  wins shortcut resolution (`opus` → first opus) and becomes the bridge default
  (first model overall).
- A bare `{ id }` fills omitted fields with defaults: `name`=id,
  `reasoning`=true, `input`=["text","image"], `contextWindow`=200_000,
  `maxTokens`=64_000, no `thinkingLevelMap`.

### 3. `src/config.ts`

Add top-level `models?: Array<Partial<BridgeModel> & { id: string }>` to
`Config`. In `loadConfig`, combine global then project entries into one override
list (`[...(global.models ?? []), ...(project.models ?? [])]`) so project entries
come later and win on `id` collisions. Existing `askClaude` / `provider`
sections unchanged.

### 4. `src/index.ts`

```ts
const MODELS = buildModels(mergeModels(DEFAULT_MODELS, config.models));
```

`buildModels` shrinks to a finalizer: zero `cost`
(`{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`) and emit exactly the
provider fields. Remove the now-unused `getModels` import. The `thinkingLevelMap`
effort path (`index.ts` ~990) is unchanged — our model objects carry the map.

### 5. Tests — `tests/unit-models.mjs` (rewrite)

- `DEFAULT_MODELS` order and shape (opus-4-8 first; opus-4-6 map is `xhigh→max`).
- `mergeModels`: override-existing-in-place (position kept, fields updated);
  new id prepended; multiple new ids keep override order; project-over-global.
- `buildModels`: `cost` zeroed; only expected provider fields emitted.
- `resolveModelId`: `opus` → `claude-opus-4-8`; after prepending a new opus id,
  `opus` → that new id; full id passes through; no-match falls through.
- Remove the old pi-ai-mock and "silently drops ids missing from pi-ai" tests.

### 6. Docs

- README: document the `claude-bridge.json` `models` field with an example
  (adding a new model; overriding a field on a default).
- CHANGELOG: entry describing the decoupling and config override.

## Verification

- `npm run typecheck` clean.
- `node --import tsx --test tests/unit-*.mjs` — all pass, including new
  merge/resolve cases.
- Ground truth: `pi --list-models | grep claude-bridge` shows the default models
  (opus-4-8 first). With a `~/.pi/agent/claude-bridge.json` containing
  `{"models":[{"id":"claude-opus-4-9"}]}`, the list shows `claude-opus-4-9` and
  `opus` resolves to it — without any pi-ai/host-pi change.

## Non-goals / trade-offs

- The bridge no longer auto-tracks pi-ai metadata changes; `DEFAULT_MODELS` is
  hand-maintained. Intended: Claude model specs are stable and decoupling is the
  point.
- No `replaceModels` flag, `modelOrder` field, or per-model removal — merge-by-id
  with prepend-new covers the use cases (YAGNI).
