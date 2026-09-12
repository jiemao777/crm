import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import type { AgentProviderRuntimeConfig } from "@crm/db/agent-provider";
import type { AgentProviderVerificationService } from "../src/agent/agent-provider-verification.service";
import type { ResearchProviderVerificationService } from "../src/agent/research-provider-verification.service";
import type { BackfillService } from "../src/backfill/backfill.service";
import type { AgentProviderInput } from "../src/settings/settings.contracts";
import { SettingsService } from "../src/settings/settings.service";
import type { SettingsCredentialsService } from "../src/settings/settings-credentials.service";

type Provider = {
	id: string;
	name: string;
	kind: string;
	protocol: string;
	baseUrl: string | null;
	encryptedApiKey: string | null;
	apiKeyHint: string | null;
	modelId: string;
	contextWindowTokens: number;
	createdAt: Date;
	updatedAt: Date;
};

function settingsHarness() {
	let activeProviderId: string | null = null;
	const providers: Provider[] = [];
	let verified: AgentProviderRuntimeConfig | null = null;
	const now = new Date("2026-08-27T10:00:00.000Z");

	const providerTable = {
		findMany: async () => providers,
		findUnique: async ({ where }: { where: { id: string } }) =>
			providers.find((provider) => provider.id === where.id) ?? null,
		create: async ({
			data,
		}: {
			data: Omit<Provider, "id" | "createdAt" | "updatedAt">;
		}) => {
			const provider = {
				id: `provider-${providers.length + 1}`,
				...data,
				createdAt: now,
				updatedAt: now,
			};
			providers.push(provider);
			return provider;
		},
		update: async ({
			where,
			data,
		}: {
			where: { id: string };
			data: Partial<Provider>;
		}) => {
			const provider = providers.find((item) => item.id === where.id);
			if (!provider) throw new Error("Provider not found");
			Object.assign(provider, data, { updatedAt: now });
			return provider;
		},
		delete: async ({ where }: { where: { id: string } }) => {
			const index = providers.findIndex((provider) => provider.id === where.id);
			if (index === -1) throw new Error("Provider not found");
			const [removed] = providers.splice(index, 1);
			if (activeProviderId === where.id) activeProviderId = null;
			return removed;
		},
	};
	const db = {
		member: { findUnique: async () => ({ role: "owner" }) },
		agentModelProvider: providerTable,
		appSetting: {
			findUnique: async () => ({
				agentProviderId: activeProviderId,
				agentModelId: null,
				agentModelContextWindow: null,
			}),
			findFirst: async () => ({ updatedAt: now }),
			upsert: async ({
				create,
				update,
			}: {
				create: { agentProviderId?: string | null };
				update: { agentProviderId?: string | null };
			}) => {
				activeProviderId = Object.hasOwn(update, "agentProviderId")
					? (update.agentProviderId ?? null)
					: (create.agentProviderId ?? activeProviderId);
				return { id: "app", agentProviderId: activeProviderId };
			},
		},
		$transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
	} as unknown as Db;
	const credentials = {
		isConfigured: () => true,
		encrypt: (value: string) => `encrypted:${value}`,
		decrypt: (value: string) => value.replace(/^encrypted:/, ""),
	} as SettingsCredentialsService;
	const verification = {
		verify: async (provider: AgentProviderRuntimeConfig) => {
			verified = provider;
			return { outcome: "valid" as const };
		},
	} as AgentProviderVerificationService;
	const service = new SettingsService(
		db,
		{} as ResearchProviderVerificationService,
		verification,
		credentials,
		{} as BackfillService,
	);

	return {
		service,
		providers,
		verified: () => verified,
		activeProviderId: () => activeProviderId,
	};
}

const openai: AgentProviderInput = {
	name: "Primary OpenAI",
	kind: "openai",
	protocol: "openai-chat",
	baseUrl: null,
	apiKey: "sk-test-provider",
	modelId: "gpt-test",
	contextWindowTokens: 128_000,
};

describe("Agent provider settings", () => {
	it("encrypts, normalizes, and activates a saved provider", async () => {
		const harness = settingsHarness();
		const result = await harness.service.saveAgentProvider(openai, "owner-1");

		expect(harness.providers).toHaveLength(1);
		expect(harness.providers[0]).toMatchObject({
			protocol: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			encryptedApiKey: "encrypted:sk-test-provider",
			apiKeyHint: "••••ider",
		});
		expect(JSON.stringify(result)).not.toContain("sk-test-provider");
		const provider = harness.providers[0];
		if (!provider) throw new Error("The provider was not saved.");
		expect(result.activeProviderId).toBe(provider.id);
	});

	it("reuses the encrypted key when testing an edited provider", async () => {
		const harness = settingsHarness();
		await harness.service.saveAgentProvider(openai, "owner-1");
		const provider = harness.providers[0];
		if (!provider) throw new Error("The provider was not saved.");

		await harness.service.testAgentProvider(
			{ ...openai, id: provider.id, apiKey: null },
			"owner-1",
		);

		expect(harness.verified()).toMatchObject({
			apiKey: "sk-test-provider",
			protocol: "openai-responses",
		});
	});

	it("activates saved providers and can return to the legacy fallback", async () => {
		const harness = settingsHarness();
		await harness.service.saveAgentProvider(openai, "owner-1");
		const first = harness.providers[0];
		if (!first) throw new Error("The first provider was not saved.");
		await harness.service.saveAgentProvider(
			{ ...openai, name: "Second OpenAI", modelId: "gpt-test-2" },
			"owner-1",
		);

		await harness.service.activateAgentProvider(first.id, "owner-1");
		expect(harness.activeProviderId()).toBe(first.id);
		await harness.service.activateAgentProvider(null, "owner-1");
		expect(harness.activeProviderId()).toBeNull();
	});

	it("allows a keyless custom OpenAI-compatible provider", async () => {
		const harness = settingsHarness();
		await harness.service.saveAgentProvider(
			{
				name: "Local Ollama",
				kind: "custom",
				protocol: "openai-chat",
				baseUrl: "http://127.0.0.1:11434/v1",
				apiKey: null,
				modelId: "qwen-local",
				contextWindowTokens: 32_000,
			},
			"owner-1",
		);

		const provider = harness.providers[0];
		if (!provider) throw new Error("The provider was not saved.");
		expect(provider).toMatchObject({
			encryptedApiKey: null,
			apiKeyHint: null,
		});
		expect(harness.activeProviderId()).toBe(provider.id);
	});
});
