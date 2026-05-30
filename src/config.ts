// User-facing extension config. Loaded once at extension registration from
// ~/.pi/agent/claude-bridge.json and .pi/claude-bridge.json, project overriding
// global. Missing or unparseable files are ignored (error to console.error,
// empty object returned) so the extension always starts.

import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";
import type { BridgeModel } from "./models.js";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface Config {
	askClaude?: {
		enabled?: boolean;
		name?: string;
		label?: string;
		description?: string;
		defaultMode?: "full" | "read" | "none";
		defaultIsolated?: boolean;
		allowFullMode?: boolean;
		appendSkills?: boolean;
	};
	/** Low-level Claude Agent SDK plumbing. Most users won't need these. */
	provider?: {
		/**
		 * When false, skip appending pi's AGENTS.md and skills block to the
		 * claude_code preset. The pi-identity blurb is always appended. Default true.
		 */
		appendSystemPrompt?: boolean;
		settingSources?: SettingSource[];
		strictMcpConfig?: boolean;
		pathToClaudeCodeExecutable?: string;
	};
	/**
	 * Add or override models in the bridge's baked-in DEFAULT_MODELS list. Each
	 * entry must carry an `id`; remaining BridgeModel fields are optional. A new
	 * id is prepended (so it wins shortcut resolution); a matching id overrides
	 * the default's provided fields in place. Decouples the model list from
	 * pi-ai / host-pi version.
	 */
	models?: Array<Partial<BridgeModel> & { id: string }>;
}

export function tryParseJson(path: string): Partial<Config> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch (e) {
		console.error(`claude-bridge: failed to parse ${path}: ${e}`);
		return {};
	}
}

export function loadConfig(cwd: string): Config {
	const global = tryParseJson(join(homedir(), ".pi", "agent", "claude-bridge.json"));
	const project = tryParseJson(join(cwd, ".pi", "claude-bridge.json"));
	return {
		askClaude: { ...global.askClaude, ...project.askClaude },
		provider: { ...global.provider, ...project.provider },
		// Global first, project later so project entries win on id collisions.
		models: [...(global.models ?? []), ...(project.models ?? [])],
	};
}
