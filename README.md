# pi-claude-bridge

[![npm version](https://img.shields.io/npm/v/pi-claude-bridge)](https://www.npmjs.com/package/pi-claude-bridge)

Pi extension that integrates Claude Code via the [Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript).

> Built on [claude-agent-sdk-pi](https://github.com/prateekmedia/claude-agent-sdk-pi) by Prateek Sunal — the provider skeleton, tool name mapping, and settings loading originate from that project. This fork adds streaming, MCP tool bridging, custom pi tool bridging, session resume/persistence, context sync, thinking support, skills forwarding, and the AskClaude tool.

1. **Provider** — Use Opus/Sonnet/Haiku as models in pi, with all tool calls flowing through pi's TUI
2. **AskClaude tool** — Delegate tasks or questions to Claude Code when using another provider

Uses your Claude Max/Pro subscription. I believe this is compliant with Anthropic's terms because only the real Claude Code is touching the API and it's to enable [local development](https://x.com/trq212/status/2024212380142752025) not to steal API calls for some other commerical purpose. That said, obviously this extension is not endorsed or supported by Anthropic.
<p>
<a href="assets/claude-bridge1.png"><img src="assets/claude-bridge1.png" width="49%"></a>&nbsp;
<a href="assets/claude-bridge2.png"><img src="assets/claude-bridge2.png" width="49%"></a>
</p>

## Install

```
pi install npm:pi-claude-bridge
```

## Provider

Use `/model` to select `claude-bridge/claude-opus-4-8`, `claude-bridge/claude-opus-4-7`, `claude-bridge/claude-opus-4-6`, `claude-bridge/claude-sonnet-4-6`, or `claude-bridge/claude-haiku-4-5`.

Behind the scenes, pi's tools are bridged to Claude Code but it should all work like normal in pi. Bash commands get a 120-second default timeout (matching Claude Code's default) since pi's bash has no timeout by default. Skills in pi are copied over to Claude Code's system prompt so should work as they would with any other pi provider.

## AskClaude Tool

Available when using any non-claude-bridge provider. Pi's LLM can delegate tasks to Claude Code and wait for it to answer a question or perform a task. Examples of how to use:

- "Ask Claude to plan a fix"
- "If you get stuck, ask claude for help"
- "Ask claude to review the plan in @foo.md, implement it, then ask an isolated=true claude to review the implementation"
- "Ask claude to poke holes in this theory"
- "Find all the places in the codebase that handle auth"

You could also create skills or add something to AGENTS.md to e.g. "Always call Ask Claude to review complicated feature implementations before considering the task complete."

### Parameters

- **`prompt`** — the question or task for Claude Code
- **`mode`** — `read` (default, read files and search/fetch on web), `none`, or `full` (read+write+bash, disable this mode with `allowFullMode: false` in config)
- **`model`** — `opus` (default), `sonnet`, `haiku`, or a full model ID
- **`thinking`** — effort level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`
- **`isolated`** — when `true`, Claude gets a clean session with no conversation history (default: `false`)

## Configuration

Config: `~/.pi/agent/claude-bridge.json` (global) or `.pi/claude-bridge.json` (project; merged over global).

```json
{
  "askClaude": {
    "enabled": true,
    "allowFullMode": true,
    "defaultIsolated": false,
    "description": "Custom tool description override"
  },
  "provider": {
    "strictMcpConfig": true,
    "pathToClaudeCodeExecutable": "/home/you/.nix-profile/bin/claude"
  },
  "models": [
    { "id": "claude-opus-4-9" },
    { "id": "claude-sonnet-4-6", "maxTokens": 96000 }
  ]
}
```

`askClaude`:
- `enabled` — register the AskClaude tool (default `true`)
- `name`, `label`, `description` — overrides for the tool's pi-side name, TUI label, and description
- `defaultMode` — `"read"` (default), `"none"`, or `"full"`
- `defaultIsolated` — start each call in a fresh session (default `false`)
- `allowFullMode` — allow `mode: "full"`; set `false` to lock it out
- `appendSkills` — forward pi's skills block into the system prompt (default `true`)

### System prompt

The bridge always uses Anthropic's `claude_code` preset as the system prompt, with a short pi-identity blurb appended so the model knows it's running inside the pi harness. AGENTS.md and the skills block are also appended when `appendSystemPrompt` is enabled.

This is **not configurable**. Anthropic classifies third-party clients by shape-matching the system prompt content; anything beyond a small append on the preset (e.g. forwarding pi's full prompt, or using a custom string) downgrades the request to "extra usage" billing and typically 400s on subscription plans. Since the whole point of this extension is to drive Claude with your Claude subscription, modes that break that billing path aren't exposed.

`provider` (low-level SDK plumbing, most users can ignore):
- `appendSystemPrompt` — append pi's AGENTS.md and skills block to the preset (default `true`). The pi-identity blurb is always appended regardless.
- `settingSources` — CC filesystem settings to load; only applied when `appendSystemPrompt` is `false`.
- `strictMcpConfig` — block MCP servers from `~/.claude.json` / `.mcp.json` (default `true`). Cloud MCP (Gmail/Drive via claude.ai OAuth) is always blocked.
- `pathToClaudeCodeExecutable` — path to the `claude` binary. Required on **NixOS** (and other non-FHS systems) where the SDK's bundled musl/glibc binaries can't run. Set to your Nix-installed binary, e.g. `"/home/you/.nix-profile/bin/claude"`.

### Models

The bridge ships its own baked-in list of Claude models (`DEFAULT_MODELS` in `src/models.ts`), so models are available regardless of which pi-ai version the host pi bundles. The `models` field lets you add or override entries without waiting on a host-pi or extension update — handy for using a brand-new Claude model the day it ships.

**Baked-in defaults** (the `opus` shortcut resolves to the first opus, currently 4.8):

| id | context window | max output |
|---|---|---|
| `claude-opus-4-8` | 200K | 128K |
| `claude-opus-4-7` | 200K | 128K |
| `claude-opus-4-6` | 200K | 128K |
| `claude-sonnet-4-6` | 200K | 64K |
| `claude-haiku-4-5` | 200K | 64K |

Run `pi --list-models | grep claude-bridge` any time to see the **effective** list (defaults merged with your overrides) — that's the runtime source of truth.

**Override behavior.** Each entry needs an `id`; all other fields (`name`, `reasoning`, `input`, `contextWindow`, `maxTokens`, `thinkingLevelMap`) are optional.

- **New id → prepended.** An id not in the defaults is added to the front of the list, so it becomes the overall default and wins the shortcut resolution (e.g. `{ "id": "claude-opus-4-9" }` makes `opus` resolve to `claude-opus-4-9`). Omitted fields fall back to sane defaults (`name`=id, `reasoning`=true, `input`=`["text","image"]`, `contextWindow`=200000, `maxTokens`=64000).
- **Matching id → overrides in place.** An id that already exists overrides only the fields you provide and keeps its position (e.g. `{ "id": "claude-sonnet-4-6", "maxTokens": 96000 }` just bumps sonnet's max output tokens).

Global entries are applied first, then project entries, so a project `.pi/claude-bridge.json` wins on id collisions.

#### Context window (200K default + larger windows)

Every model defaults to a **200K** `contextWindow` — the window Claude Code grants without the 1M beta. This is deliberate: pi sizes compaction to `contextWindow` and the bridge disables Claude Code's own auto-compaction, so advertising a window larger than Claude Code actually grants makes pi let the prompt grow past the real ceiling, yielding `Prompt is too long` with no compaction.

To use a model's larger window, raise its `contextWindow` above 200K in config — the bridge then sends the `context-1m-2025-08-07` beta so Claude Code accepts the bigger prompt (requires a plan with 1M access in Claude Code, e.g. Max). Cap it wherever you want pi to compact (500K is a good cost-bounded middle ground):

```json
{ "models": [
  { "id": "claude-opus-4-7", "contextWindow": 500000 },
  { "id": "claude-opus-4-6", "contextWindow": 500000 }
] }
```

> **opus-4-8 exception:** Claude Opus 4.8's 1M window is gated behind a Claude Code rollout experiment (`tengu_amber_redwood2`) that is active in interactive Claude Code but **not yet on the headless/SDK path the bridge uses**, so it is server-capped at 200K here regardless of the beta — raising its `contextWindow` just reintroduces `Prompt is too long`. Leave opus-4-8 at 200K and use opus-4-7 for large-context work; recheck after Claude Code updates, then bump it like the others. (See [issue #22](https://github.com/elidickinson/pi-claude-bridge/issues/22).)

## Tests

`npm run test:unit` for offline tests (`tests/unit-*.mjs`: queue, import, skills). 

`npm test` for the full suite, which adds integration tests that hit APIs (`tests/int-*.{sh,mjs}`: smoke, multi-turn, cache, session-resume, session-rebuild, tool-message). Set `CLAUDE_BRIDGE_TESTING_ALT_MODEL` in `.env.test` for the alt-provider smoke test (e.g. `openrouter/z-ai/glm-4.7-flash`).

## Debugging

Set `CLAUDE_BRIDGE_DEBUG=1` to enable debug output:

- **Bridge log** at `~/.pi/agent/claude-bridge.log` — every provider call, session sync decision, tool result delivery, and CC's stderr. Override location with `CLAUDE_BRIDGE_DEBUG_PATH`.
- **Per-query Claude Code CLI logs** at `~/.pi/agent/cc-cli-logs/<timestamp>-<tag>-<seq>.log` — the CC subprocess's own debug stream, one file per `query()` call. Tags are `provider` (main turn), `continuation` (steer replay), or `askclaude` (sub-delegation). Useful when a resume fails or CC misbehaves internally — shows the CLI's own view of session loading, API requests, and tool calls.

When filing a bug about a session-resume failure (e.g. "No conversation found"), the most useful attachments are the `syncResult:` lines from the bridge log plus the matching `cc-cli-logs/` file for the failing query.

## Maintenance

After a Claude Code release, review `MODE_DISALLOWED_TOOLS` in `src/index.ts` — it gates which CC tools the AskClaude subagent may invoke per mode (`read` / `full` / `none`). Add new agentic tools (PlanMode, Task spawning, etc.) to the appropriate mode lists if they shouldn't be available to subagents.
