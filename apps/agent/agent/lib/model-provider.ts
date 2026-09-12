import "@crm/env/load";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { db } from "@crm/db";
import {
	type AgentProviderRuntimeConfig,
	type AgentProviderVerificationReason,
	isAgentProviderKind,
	isAgentProviderProtocol,
	readActiveAgentProvider,
} from "@crm/db/agent-provider";
import { credentialCipher, credentialEncryptionKey } from "@crm/db/credentials";
import { generateText, type LanguageModel, tool } from "ai";
import { z } from "zod";

export type ResolvedAgentModel = {
	model: LanguageModel;
	modelContextWindowTokens: number;
};

export function modelForProvider(
	config: AgentProviderRuntimeConfig,
): LanguageModel {
	if (config.protocol === "gateway") {
		return createGateway({
			apiKey: requireApiKey(config),
			...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
		}).chat(config.modelId);
	}

	if (config.protocol === "anthropic-messages") {
		return createAnthropic({
			apiKey: requireApiKey(config),
			...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
			name: `crm.${config.kind}`,
		}).messages(config.modelId);
	}

	if (config.protocol === "google-generative-ai") {
		return createGoogle({
			apiKey: requireApiKey(config),
			...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
			name: `crm.${config.kind}`,
		}).chat(config.modelId);
	}

	const openai = createOpenAI({
		apiKey: config.apiKey ?? "local",
		...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
		name: `crm.${config.kind}`,
	});
	return config.protocol === "openai-responses"
		? openai.responses(config.modelId)
		: openai.chat(config.modelId);
}

export type ModelProviderVerification =
	| { outcome: "valid" }
	| {
			outcome: "invalid" | "unknown";
			reason: AgentProviderVerificationReason;
	  };

export async function verifyModelProvider(
	config: AgentProviderRuntimeConfig,
): Promise<ModelProviderVerification> {
	try {
		return verdict(await probeProvider(config, true));
	} catch (error) {
		const status = statusCodeOf(error);
		console.error(
			`[agent] provider verification failed: ${describeVerificationError(error, status)}`,
		);
		if (status === 401) {
			return {
				outcome: "invalid",
				reason: "provider-invalid-key",
			};
		}
		if (status === 400 && toolChoiceUnsupported(error)) {
			try {
				return verdict(await probeProvider(config, false));
			} catch (retryError) {
				const retryStatus = statusCodeOf(retryError);
				console.error(
					`[agent] provider verification retry failed: ${describeVerificationError(retryError, retryStatus)}`,
				);
				return retryStatus === 401
					? { outcome: "invalid", reason: "provider-invalid-key" }
					: { outcome: "unknown", reason: "provider-unavailable" };
			}
		}
		return {
			outcome: "unknown",
			reason: "provider-unavailable",
		};
	}
}

async function probeProvider(
	config: AgentProviderRuntimeConfig,
	forceToolCall: boolean,
) {
	return generateText({
		model: modelForProvider(config),
		prompt: forceToolCall
			? "Call provider_test once."
			: "Call the provider_test tool once, then stop.",
		tools: {
			provider_test: tool({
				description: "Verify that this model supports tool calls.",
				inputSchema: z.object({}),
			}),
		},
		toolChoice: forceToolCall
			? { type: "tool", toolName: "provider_test" }
			: "auto",
		maxOutputTokens: forceToolCall ? 32 : 4_096,
		maxRetries: 0,
		timeout: { totalMs: 30_000 },
	});
}

function verdict(result: { toolCalls: unknown[] }): ModelProviderVerification {
	return result.toolCalls.length > 0
		? { outcome: "valid" }
		: {
				outcome: "unknown",
				reason: "provider-empty-response",
			};
}

function toolChoiceUnsupported(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /tool[_\s-]?choice/i.test(message);
}

function describeVerificationError(error: unknown, status: number | null) {
	const message = error instanceof Error ? error.message : String(error);
	const scrubbed = message
		.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
		.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
		.slice(0, 300);
	return status ? `status ${status}: ${scrubbed}` : scrubbed;
}

export async function configuredAgentModel(): Promise<ResolvedAgentModel | null> {
	try {
		const provider = await readActiveAgentProvider(db);
		if (!provider) return null;
		if (
			!isAgentProviderKind(provider.kind) ||
			!isAgentProviderProtocol(provider.protocol)
		) {
			throw new Error("The active provider has an unsupported adapter.");
		}

		let apiKey: string | null = null;
		if (provider.encryptedApiKey) {
			const cipher = credentialCipher(credentialEncryptionKey());
			if (!cipher) {
				throw new Error("CREDENTIALS_ENCRYPTION_KEY is not configured.");
			}
			apiKey = cipher.decrypt(provider.encryptedApiKey);
		}

		return {
			model: modelForProvider({
				kind: provider.kind,
				protocol: provider.protocol,
				baseUrl: provider.baseUrl,
				apiKey,
				modelId: provider.modelId,
				contextWindowTokens: provider.contextWindowTokens,
			}),
			modelContextWindowTokens: provider.contextWindowTokens,
		};
	} catch (error) {
		console.error(
			`[agent] could not resolve the configured model provider: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return null;
	}
}

function requireApiKey(config: AgentProviderRuntimeConfig): string {
	if (config.apiKey) return config.apiKey;
	throw new Error(`${config.kind} requires an API key.`);
}

function statusCodeOf(error: unknown): number | null {
	let current: unknown = error;
	for (let depth = 0; depth < 5; depth += 1) {
		if (!current || typeof current !== "object") return null;
		if ("statusCode" in current && typeof current.statusCode === "number") {
			return current.statusCode;
		}
		if ("lastError" in current) {
			current = current.lastError;
			continue;
		}
		if ("cause" in current) {
			current = current.cause;
			continue;
		}
		return null;
	}
	return null;
}
