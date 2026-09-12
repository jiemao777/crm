import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import type { AgentProviderVerificationService } from "../src/agent/agent-provider-verification.service";
import type {
	ResearchProviderCheck,
	ResearchProviderVerificationService,
} from "../src/agent/research-provider-verification.service";
import type { BackfillService } from "../src/backfill/backfill.service";
import { SettingsService } from "../src/settings/settings.service";
import type { SettingsCredentialsService } from "../src/settings/settings-credentials.service";

function harness(outcome: ResearchProviderCheck = { outcome: "valid" }) {
	let row = {
		id: "app",
		researchProviderKind: null as string | null,
		encryptedResearchApiKey: null as string | null,
		researchApiKeyHint: null as string | null,
		contextDevApiKey: "legacy-context-key" as string | null,
	};
	let verified: { kind: string; apiKey: string | null } | null = null;
	const db = {
		member: { findUnique: async () => ({ role: "owner" }) },
		appSetting: {
			findUnique: async () => row,
			upsert: async ({
				create,
				update,
			}: {
				create: Partial<typeof row>;
				update: Partial<typeof row>;
			}) => {
				row = { ...row, ...create, ...update };
				return row;
			},
		},
	} as unknown as Db;
	const researchVerification = {
		verify: async (provider: { kind: string; apiKey: string | null }) => {
			verified = provider;
			return outcome;
		},
	} as ResearchProviderVerificationService;
	const credentials = {
		isConfigured: () => true,
		encrypt: (value: string) => `encrypted:${value}`,
		decrypt: (value: string) => value.replace(/^encrypted:/, ""),
	} as SettingsCredentialsService;
	const service = new SettingsService(
		db,
		researchVerification,
		{} as AgentProviderVerificationService,
		credentials,
		{
			run: async () => ({ queued: 0, remaining: 0 }),
		} as unknown as BackfillService,
	);
	return { service, row: () => row, verified: () => verified };
}

describe("research provider settings", () => {
	it("activates official Tavily keyless access without credential storage", async () => {
		const test = harness();
		const result = await test.service.setResearchProvider(
			{ kind: "tavily", apiKey: null },
			"owner-1",
		);

		expect(test.verified()).toEqual({ kind: "tavily", apiKey: null });
		expect(test.row()).toMatchObject({
			researchProviderKind: "tavily",
			encryptedResearchApiKey: null,
			researchApiKeyHint: null,
			contextDevApiKey: null,
		});
		expect(result).toMatchObject({
			configured: true,
			kind: "tavily",
			keyless: true,
		});
	});

	it("encrypts keyed research providers and never returns the key", async () => {
		const test = harness();
		const result = await test.service.setResearchProvider(
			{ kind: "context", apiKey: "context-secret-key" },
			"owner-1",
		);

		expect(test.row()).toMatchObject({
			researchProviderKind: "context",
			encryptedResearchApiKey: "encrypted:context-secret-key",
			researchApiKeyHint: "••••-key",
		});
		expect(JSON.stringify(result)).not.toContain("context-secret-key");
		expect(result.keyless).toBe(false);
	});

	it("refuses a key rejected by the Agent", async () => {
		const test = harness({ outcome: "invalid", reason: "Wrong key." });

		await expect(
			test.service.setResearchProvider(
				{ kind: "context", apiKey: "context-wrong-key" },
				"owner-1",
			),
		).rejects.toThrow("Wrong key.");
		expect(test.row().researchProviderKind).toBeNull();
	});

	it("reads an existing Context key through the legacy seam", async () => {
		const test = harness();
		const result = await test.service.researchProvider();

		expect(result).toMatchObject({
			configured: true,
			kind: "context",
			hint: "••••-key",
			keyless: false,
		});
		expect(JSON.stringify(result)).not.toContain("legacy-context-key");
	});
});
