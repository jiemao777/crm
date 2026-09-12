import type { Db } from "@crm/db";
import {
	AGENT_PROVIDER_PRESETS,
	type AgentProviderRuntimeConfig,
	agentProviderPreset,
} from "@crm/db/agent-provider";
import {
	RESEARCH_PROVIDER_PRESETS,
	readStoredResearchProvider,
} from "@crm/db/research-provider";
import { maskKey, readAgentModel, SETTINGS_ID } from "@crm/db/settings";
import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
} from "@nestjs/common";
import { AgentProviderVerificationService } from "../agent/agent-provider-verification.service";
import { ResearchProviderVerificationService } from "../agent/research-provider-verification.service";
import { BackfillService } from "../backfill/backfill.service";
import { requireWorkspaceAdmin } from "../crm/access";
import { InjectDatabase } from "../database/database.constants";
import type {
	AgentProviderInput,
	SetResearchProviderInput,
} from "./settings.contracts";
import { SettingsCredentialsService } from "./settings-credentials.service";

export interface ResearchProviderSettings {
	configured: boolean;
	kind: "context" | "tavily" | null;
	hint: string | null;
	keyless: boolean;
	credentialStorageAvailable: boolean;
	presets: typeof RESEARCH_PROVIDER_PRESETS;
}

export interface AgentProviderSettings {
	activeProviderId: string | null;
	credentialStorageAvailable: boolean;
	legacyModelId: string;
	presets: typeof AGENT_PROVIDER_PRESETS;
	providers: {
		id: string;
		name: string;
		kind: string;
		protocol: string;
		baseUrl: string | null;
		apiKeyHint: string | null;
		modelId: string;
		contextWindowTokens: number;
		updatedAt: string;
	}[];
}

@Injectable()
export class SettingsService {
	private readonly logger = new Logger(SettingsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly researchVerification: ResearchProviderVerificationService,
		private readonly providerVerification: AgentProviderVerificationService,
		@Inject(SettingsCredentialsService)
		private readonly credentials: SettingsCredentialsService,
		private readonly backfill: BackfillService,
	) {}

	async agentProviders(): Promise<AgentProviderSettings> {
		const [setting, providers, model] = await Promise.all([
			this.db.appSetting.findUnique({
				where: { id: SETTINGS_ID },
				select: { agentProviderId: true },
			}),
			this.db.agentModelProvider.findMany({ orderBy: { createdAt: "asc" } }),
			readAgentModel(this.db),
		]);

		return {
			activeProviderId: setting?.agentProviderId ?? null,
			credentialStorageAvailable: this.credentials.isConfigured(),
			legacyModelId: process.env.ZAI_MODEL?.trim() || model.id,
			presets: AGENT_PROVIDER_PRESETS,
			providers: providers.map((provider) => ({
				id: provider.id,
				name: provider.name,
				kind: provider.kind,
				protocol: provider.protocol,
				baseUrl: provider.baseUrl,
				apiKeyHint: provider.apiKeyHint,
				modelId: provider.modelId,
				contextWindowTokens: provider.contextWindowTokens,
				updatedAt: provider.updatedAt.toISOString(),
			})),
		};
	}

	async saveAgentProvider(
		input: AgentProviderInput,
		actingUserId: string,
	): Promise<AgentProviderSettings> {
		await requireWorkspaceAdmin(this.db, actingUserId);
		const normalized = await this.normalizeProvider(input);
		const encryptedApiKey = normalized.apiKey
			? this.credentials.encrypt(normalized.apiKey)
			: null;
		const apiKeyHint = normalized.apiKey ? maskKey(normalized.apiKey) : null;

		await this.db.$transaction(async (tx) => {
			const provider = input.id
				? await tx.agentModelProvider.update({
						where: { id: input.id },
						data: {
							name: input.name,
							kind: normalized.runtime.kind,
							protocol: normalized.runtime.protocol,
							baseUrl: normalized.runtime.baseUrl,
							encryptedApiKey,
							apiKeyHint,
							modelId: normalized.runtime.modelId,
							contextWindowTokens: normalized.runtime.contextWindowTokens,
						},
					})
				: await tx.agentModelProvider.create({
						data: {
							name: input.name,
							kind: normalized.runtime.kind,
							protocol: normalized.runtime.protocol,
							baseUrl: normalized.runtime.baseUrl,
							encryptedApiKey,
							apiKeyHint,
							modelId: normalized.runtime.modelId,
							contextWindowTokens: normalized.runtime.contextWindowTokens,
						},
					});

			await tx.appSetting.upsert({
				where: { id: SETTINGS_ID },
				create: { id: SETTINGS_ID, agentProviderId: provider.id },
				update: { agentProviderId: provider.id },
			});
		});

		this.logger.log({
			message: "Agent model provider saved",
			providerId: input.id ?? "new",
			kind: normalized.runtime.kind,
			modelId: normalized.runtime.modelId,
		});
		return this.agentProviders();
	}

	async testAgentProvider(input: AgentProviderInput, actingUserId: string) {
		await requireWorkspaceAdmin(this.db, actingUserId);
		const normalized = await this.normalizeProvider(input);
		return this.providerVerification.verify(normalized.runtime);
	}

	async activateAgentProvider(
		providerId: string | null,
		actingUserId: string,
	): Promise<AgentProviderSettings> {
		await requireWorkspaceAdmin(this.db, actingUserId);
		if (providerId) {
			const provider = await this.db.agentModelProvider.findUnique({
				where: { id: providerId },
				select: { id: true },
			});
			if (!provider)
				throw new BadRequestException("That provider no longer exists.");
		}
		await this.db.appSetting.upsert({
			where: { id: SETTINGS_ID },
			create: { id: SETTINGS_ID, agentProviderId: providerId },
			update: { agentProviderId: providerId },
		});
		this.logger.log({ message: "Agent model provider changed", providerId });
		return this.agentProviders();
	}

	async deleteAgentProvider(
		providerId: string,
		actingUserId: string,
	): Promise<AgentProviderSettings> {
		await requireWorkspaceAdmin(this.db, actingUserId);
		const provider = await this.db.agentModelProvider.findUnique({
			where: { id: providerId },
			select: { id: true },
		});
		if (!provider)
			throw new BadRequestException("That provider no longer exists.");
		await this.db.agentModelProvider.delete({ where: { id: providerId } });
		this.logger.log({ message: "Agent model provider removed", providerId });
		return this.agentProviders();
	}

	async researchProvider(): Promise<ResearchProviderSettings> {
		const provider = await readStoredResearchProvider(this.db);
		const configured = provider
			? provider.kind === "tavily" ||
				Boolean(provider.encryptedApiKey || provider.legacyApiKey)
			: false;
		return {
			configured,
			kind: provider?.kind ?? null,
			hint:
				provider?.apiKeyHint ??
				(provider?.legacyApiKey ? maskKey(provider.legacyApiKey) : null),
			keyless:
				configured && provider?.kind === "tavily" && !provider.encryptedApiKey,
			credentialStorageAvailable: this.credentials.isConfigured(),
			presets: RESEARCH_PROVIDER_PRESETS,
		};
	}

	private async normalizeProvider(input: AgentProviderInput): Promise<{
		runtime: AgentProviderRuntimeConfig;
		apiKey: string | null;
	}> {
		const preset = agentProviderPreset(input.kind);
		const existing = input.id
			? await this.db.agentModelProvider.findUnique({ where: { id: input.id } })
			: null;
		if (input.id && !existing) {
			throw new BadRequestException("That provider no longer exists.");
		}

		const protocol = input.kind === "custom" ? input.protocol : preset.protocol;
		if (input.kind === "custom" && protocol === "gateway") {
			throw new BadRequestException(
				"A custom provider must use OpenAI, Anthropic, or Google protocol compatibility.",
			);
		}
		const baseUrl = input.baseUrl ?? preset.baseUrl;
		if (!baseUrl) {
			throw new BadRequestException("Enter the provider base URL.");
		}

		const suppliedApiKey = input.apiKey?.trim() || null;
		const apiKey = suppliedApiKey
			? suppliedApiKey
			: existing?.encryptedApiKey
				? this.credentials.decrypt(existing.encryptedApiKey)
				: null;
		if (preset.apiKeyRequired && !apiKey) {
			throw new BadRequestException("Enter an API key for this provider.");
		}
		if (!apiKey && !["openai-chat", "openai-responses"].includes(protocol)) {
			throw new BadRequestException(
				"Keyless custom providers must use an OpenAI-compatible protocol.",
			);
		}

		return {
			apiKey,
			runtime: {
				kind: input.kind,
				protocol,
				baseUrl,
				apiKey,
				modelId: input.modelId,
				contextWindowTokens: input.contextWindowTokens,
			},
		};
	}

	async setResearchProvider(
		input: SetResearchProviderInput,
		actingUserId: string,
	): Promise<ResearchProviderSettings> {
		await requireWorkspaceAdmin(this.db, actingUserId);
		const apiKey = input.apiKey?.trim() || null;
		if (input.kind === "context" && !apiKey) {
			throw new BadRequestException("Context.dev requires an API key.");
		}

		const encryptedResearchApiKey = apiKey
			? this.credentials.encrypt(apiKey)
			: null;
		const researchApiKeyHint = apiKey ? maskKey(apiKey) : null;
		const check = await this.researchVerification.verify({
			kind: input.kind,
			apiKey,
		});
		if (check.outcome === "invalid") {
			throw new BadRequestException(check.reason);
		}
		await this.db.appSetting.upsert({
			where: { id: SETTINGS_ID },
			create: {
				id: SETTINGS_ID,
				researchProviderKind: input.kind,
				encryptedResearchApiKey,
				researchApiKeyHint,
				contextDevApiKey: null,
			},
			update: {
				researchProviderKind: input.kind,
				encryptedResearchApiKey,
				researchApiKeyHint,
				contextDevApiKey: null,
			},
		});

		this.logger.log({
			message: "Research provider saved",
			kind: input.kind,
			keyless: apiKey === null,
			verified: check.outcome === "valid",
		});

		void this.backfill
			.run("companies")
			.then(({ queued, remaining }) => {
				if (queued > 0) {
					this.logger.log({
						message: "Queued research waiting on a provider",
						queued,
						remaining,
					});
				}
			})
			.catch((error: unknown) => {
				this.logger.warn(
					{ message: "Could not queue the waiting research" },
					error instanceof Error ? error.stack : String(error),
				);
			});

		return this.researchProvider();
	}
}
