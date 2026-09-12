import {
	AGENT_PROVIDER_KINDS,
	AGENT_PROVIDER_PROTOCOLS,
} from "@crm/db/agent-provider";
import { RESEARCH_PROVIDER_KINDS } from "@crm/db/research-provider";
import { z } from "zod";

const providerUrl = z
	.string()
	.trim()
	.max(500)
	.refine((value) => {
		try {
			const url = new URL(value);
			return (
				["http:", "https:"].includes(url.protocol) &&
				!url.username &&
				!url.password
			);
		} catch {
			return false;
		}
	}, "Enter a complete HTTP or HTTPS URL without embedded credentials.");

export const agentProviderInput = z.object({
	id: z.string().trim().min(1).max(100).optional(),
	name: z.string().trim().min(1).max(100),
	kind: z.enum(AGENT_PROVIDER_KINDS),
	protocol: z.enum(AGENT_PROVIDER_PROTOCOLS),
	baseUrl: providerUrl.nullable(),
	apiKey: z.string().trim().max(2_000).nullable(),
	modelId: z.string().trim().min(1).max(200),
	contextWindowTokens: z.number().int().min(4_096).max(10_000_000),
});

export type AgentProviderInput = z.infer<typeof agentProviderInput>;

export const activateAgentProviderInput = z.object({
	providerId: z.string().trim().min(1).max(100).nullable(),
});

export const deleteAgentProviderInput = z.object({
	providerId: z.string().trim().min(1).max(100),
});

const researchApiKey = z
	.string()
	.trim()
	.min(8, "That does not look like a research API key — it is too short.")
	.max(2_000, "That does not look like a research API key — it is too long.")
	.refine(
		(value) => !/\s/.test(value),
		"An API key has no spaces in it. Paste the whole key on its own.",
	);

export const setResearchProviderInput = z
	.object({
		kind: z.enum(RESEARCH_PROVIDER_KINDS),
		apiKey: researchApiKey.nullable(),
	})
	.superRefine((input, context) => {
		if (input.kind === "context" && !input.apiKey) {
			context.addIssue({
				code: "custom",
				path: ["apiKey"],
				message: "Context.dev requires an API key.",
			});
		}
	});

export type SetResearchProviderInput = z.infer<typeof setResearchProviderInput>;
