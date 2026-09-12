import { describe, expect, it } from "bun:test";
import {
	AGENT_PROVIDER_KINDS,
	AGENT_PROVIDER_PRESETS,
	AGENT_PROVIDER_PROTOCOLS,
	agentProviderPreset,
} from "../src/agent-provider";

describe("Agent provider presets", () => {
	it("defines every provider kind exactly once", () => {
		expect(AGENT_PROVIDER_PRESETS.map((preset) => preset.kind)).toEqual(
			AGENT_PROVIDER_KINDS,
		);
		expect(new Set(AGENT_PROVIDER_KINDS).size).toBe(
			AGENT_PROVIDER_KINDS.length,
		);
	});

	it("uses supported protocols and valid provider URLs", () => {
		for (const preset of AGENT_PROVIDER_PRESETS) {
			expect(AGENT_PROVIDER_PROTOCOLS).toContain(preset.protocol);
			if (preset.baseUrl)
				expect(new URL(preset.baseUrl).protocol).toBe("https:");
		}
	});

	it("keeps keyless endpoints behind the custom provider", () => {
		expect(
			AGENT_PROVIDER_PRESETS.filter((preset) => !preset.apiKeyRequired).map(
				(preset) => preset.kind,
			),
		).toEqual(["custom"]);
		expect(agentProviderPreset("openai").protocol).toBe("openai-responses");
	});
});
