import type { Db } from "./client";
import { SETTINGS_ID } from "./settings";

export const RESEARCH_PROVIDER_KINDS = ["context", "tavily"] as const;

export type ResearchProviderKind = (typeof RESEARCH_PROVIDER_KINDS)[number];

export type ResearchProviderPreset = {
	kind: ResearchProviderKind;
	name: string;
	signupUrl: string;
	apiKeyRequired: boolean;
};

export const RESEARCH_PROVIDER_PRESETS: readonly ResearchProviderPreset[] = [
	{
		kind: "tavily",
		name: "Tavily",
		signupUrl: "https://app.tavily.com/",
		apiKeyRequired: false,
	},
	{
		kind: "context",
		name: "Context.dev",
		signupUrl: "https://link.context.dev/crm",
		apiKeyRequired: true,
	},
];

export type StoredResearchProvider = {
	kind: ResearchProviderKind;
	encryptedApiKey: string | null;
	apiKeyHint: string | null;
	legacyApiKey: string | null;
};

export function isResearchProviderKind(
	value: string | null | undefined,
): value is ResearchProviderKind {
	return (
		typeof value === "string" &&
		(RESEARCH_PROVIDER_KINDS as readonly string[]).includes(value)
	);
}

export async function readStoredResearchProvider(
	db: Db,
): Promise<StoredResearchProvider | null> {
	const row = await db.appSetting.findUnique({
		where: { id: SETTINGS_ID },
		select: {
			researchProviderKind: true,
			encryptedResearchApiKey: true,
			researchApiKeyHint: true,
			contextDevApiKey: true,
		},
	});

	const legacyApiKey = row?.contextDevApiKey?.trim() || null;
	if (isResearchProviderKind(row?.researchProviderKind)) {
		return {
			kind: row.researchProviderKind,
			encryptedApiKey: row.encryptedResearchApiKey,
			apiKeyHint: row.researchApiKeyHint,
			legacyApiKey:
				row.researchProviderKind === "context" ? legacyApiKey : null,
		};
	}

	return legacyApiKey
		? {
				kind: "context",
				encryptedApiKey: null,
				apiKeyHint: null,
				legacyApiKey,
			}
		: null;
}
