import { describe, expect, it } from "bun:test";
import type { Db } from "../src/client";
import {
	isResearchProviderKind,
	RESEARCH_PROVIDER_PRESETS,
	readStoredResearchProvider,
} from "../src/research-provider";

function database(row: Record<string, unknown> | null): Db {
	return {
		appSetting: {
			findUnique: async () => row,
		},
	} as unknown as Db;
}

describe("research provider settings", () => {
	it("reads a saved keyless Tavily provider", async () => {
		const provider = await readStoredResearchProvider(
			database({
				researchProviderKind: "tavily",
				encryptedResearchApiKey: null,
				researchApiKeyHint: null,
				contextDevApiKey: "legacy-context-key",
			}),
		);

		expect(provider).toEqual({
			kind: "tavily",
			encryptedApiKey: null,
			apiKeyHint: null,
			legacyApiKey: null,
		});
	});

	it("keeps an existing Context key as an upgrade fallback", async () => {
		const provider = await readStoredResearchProvider(
			database({
				researchProviderKind: null,
				encryptedResearchApiKey: null,
				researchApiKeyHint: null,
				contextDevApiKey: " legacy-context-key ",
			}),
		);

		expect(provider).toEqual({
			kind: "context",
			encryptedApiKey: null,
			apiKeyHint: null,
			legacyApiKey: "legacy-context-key",
		});
	});

	it("rejects unknown kinds and exposes stable presets", () => {
		expect(isResearchProviderKind("other")).toBe(false);
		expect(
			RESEARCH_PROVIDER_PRESETS.find((item) => item.kind === "tavily"),
		).toMatchObject({
			apiKeyRequired: false,
			signupUrl: "https://app.tavily.com/",
		});
	});
});
