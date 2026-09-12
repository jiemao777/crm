import type { Db } from "./client";
import { SETTINGS_ID } from "./settings";

export const AGENT_PROVIDER_KINDS = [
	"vercel",
	"openai",
	"anthropic",
	"google",
	"xai",
	"deepseek",
	"openrouter",
	"zai",
	"opencode",
	"qwen",
	"moonshot",
	"minimax",
	"custom",
] as const;

export const AGENT_PROVIDER_PROTOCOLS = [
	"gateway",
	"openai-chat",
	"openai-responses",
	"anthropic-messages",
	"google-generative-ai",
] as const;

export const AGENT_PROVIDER_VERIFICATION_REASONS = [
	"agent-not-configured",
	"agent-unreachable",
	"invalid-configuration",
	"provider-invalid-key",
	"provider-empty-response",
	"provider-unavailable",
	"verification-failed",
] as const;

export type AgentProviderKind = (typeof AGENT_PROVIDER_KINDS)[number];
export type AgentProviderProtocol = (typeof AGENT_PROVIDER_PROTOCOLS)[number];
export type AgentProviderVerificationReason =
	(typeof AGENT_PROVIDER_VERIFICATION_REASONS)[number];

export type AgentProviderPreset = {
	kind: AgentProviderKind;
	name: string;
	protocol: AgentProviderProtocol;
	baseUrl: string | null;
	apiKeyRequired: boolean;
};

export const AGENT_PROVIDER_PRESETS: readonly AgentProviderPreset[] = [
	{
		kind: "vercel",
		name: "Vercel AI Gateway",
		protocol: "gateway",
		baseUrl: "https://ai-gateway.vercel.sh/v4/ai",
		apiKeyRequired: true,
	},
	{
		kind: "openai",
		name: "OpenAI",
		protocol: "openai-responses",
		baseUrl: "https://api.openai.com/v1",
		apiKeyRequired: true,
	},
	{
		kind: "anthropic",
		name: "Anthropic",
		protocol: "anthropic-messages",
		baseUrl: "https://api.anthropic.com/v1",
		apiKeyRequired: true,
	},
	{
		kind: "google",
		name: "Google Gemini",
		protocol: "google-generative-ai",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		apiKeyRequired: true,
	},
	{
		kind: "xai",
		name: "xAI",
		protocol: "openai-chat",
		baseUrl: "https://api.x.ai/v1",
		apiKeyRequired: true,
	},
	{
		kind: "deepseek",
		name: "DeepSeek",
		protocol: "openai-chat",
		baseUrl: "https://api.deepseek.com",
		apiKeyRequired: true,
	},
	{
		kind: "openrouter",
		name: "OpenRouter",
		protocol: "openai-chat",
		baseUrl: "https://openrouter.ai/api/v1",
		apiKeyRequired: true,
	},
	{
		kind: "zai",
		name: "ZAI",
		protocol: "openai-chat",
		baseUrl: "https://api.z.ai/api/paas/v4",
		apiKeyRequired: true,
	},
	{
		kind: "opencode",
		name: "OpenCode",
		protocol: "openai-chat",
		baseUrl: "https://opencode.ai/zen/go/v1",
		apiKeyRequired: true,
	},
	{
		kind: "qwen",
		name: "Alibaba Cloud Model Studio",
		protocol: "openai-chat",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		apiKeyRequired: true,
	},
	{
		kind: "moonshot",
		name: "Moonshot AI",
		protocol: "openai-chat",
		baseUrl: "https://api.moonshot.cn/v1",
		apiKeyRequired: true,
	},
	{
		kind: "minimax",
		name: "MiniMax",
		protocol: "openai-chat",
		baseUrl: "https://api.minimax.io/v1",
		apiKeyRequired: true,
	},
	{
		kind: "custom",
		name: "Custom provider",
		protocol: "openai-chat",
		baseUrl: null,
		apiKeyRequired: false,
	},
];

export type AgentProviderRuntimeConfig = {
	kind: AgentProviderKind;
	protocol: AgentProviderProtocol;
	baseUrl: string | null;
	apiKey: string | null;
	modelId: string;
	contextWindowTokens: number;
};

export type StoredAgentProvider = {
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

export function isAgentProviderKind(value: string): value is AgentProviderKind {
	return (AGENT_PROVIDER_KINDS as readonly string[]).includes(value);
}

export function isAgentProviderProtocol(
	value: string,
): value is AgentProviderProtocol {
	return (AGENT_PROVIDER_PROTOCOLS as readonly string[]).includes(value);
}

export function agentProviderPreset(
	kind: AgentProviderKind,
): AgentProviderPreset {
	const preset = AGENT_PROVIDER_PRESETS.find((item) => item.kind === kind);
	if (!preset) throw new Error(`Unknown Agent provider kind: ${kind}`);
	return preset;
}

export async function readActiveAgentProvider(
	db: Db,
): Promise<StoredAgentProvider | null> {
	const setting = await db.appSetting.findUnique({
		where: { id: SETTINGS_ID },
		select: { agentProvider: true },
	});
	return setting?.agentProvider ?? null;
}
