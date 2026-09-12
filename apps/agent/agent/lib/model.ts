import "@crm/env/load";

import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { db } from "@crm/db";
import { DEFAULT_AGENT_MODEL, readAgentModel } from "@crm/db/settings";
import type { LanguageModel } from "ai";
import { configuredAgentModel } from "./model-provider";

const apiKey = process.env.ZAI_API_KEY?.trim();
const baseURL = process.env.ZAI_API_BASE_URL?.trim();
const fallbackProviderModelId =
	process.env.ZAI_MODEL?.trim() || "deepseek-v4-flash";

const provider: OpenAIProvider | null =
	apiKey && baseURL
		? createOpenAI({
				apiKey,
				baseURL,
			})
		: null;

export interface ModelSelection {
	model: string;
	modelContextWindowTokens: number;
}

export type RuntimeModel = string | LanguageModel;

export function customProviderConfigured(): boolean {
	return provider !== null;
}

function providerModel(id: string): LanguageModel {
	if (!provider) throw new Error("The custom provider is not configured.");
	return provider.chat(id.replace(/^zai\//, ""));
}

export function fallbackModel(): RuntimeModel {
	return provider
		? providerModel(fallbackProviderModelId)
		: DEFAULT_AGENT_MODEL.id;
}

export async function activeModel(): Promise<RuntimeModel> {
	const configured = await configuredAgentModel();
	if (configured) return configured.model;
	const selection = await selectedModel();
	if (!selection) return fallbackModel();
	if (provider && selection.model.startsWith("zai/")) {
		return providerModel(selection.model);
	}
	return selection.model;
}

export async function selectedModel(): Promise<ModelSelection | null> {
	try {
		const setting = await readAgentModel(db);

		if (setting.isDefault) return null;

		return {
			model: setting.id,
			modelContextWindowTokens: setting.contextWindowTokens,
		};
	} catch (error) {
		console.error(
			`[agent] could not read the configured model, falling back: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return null;
	}
}
