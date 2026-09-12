import "@crm/env/load";

import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { type AgentDefinition, defineAgent, defineDynamic } from "eve";
import { logCapabilities } from "./lib/capabilities";
import {
	customProviderConfigured,
	fallbackModel,
	selectedModel,
} from "./lib/model";
import { configuredAgentModel } from "./lib/model-provider";

void logCapabilities();

const agent: AgentDefinition = defineAgent({
	model: defineDynamic({
		fallback: fallbackModel(),
		events: {
			"session.started": async () => {
				const selection = await selectedModel();
				if (!selection) return null;
				return selection;
			},
			"step.started": async () => configuredAgentModel(),
		},
	}),
	modelContextWindowTokens: customProviderConfigured()
		? DEFAULT_AGENT_MODEL.contextWindowTokens
		: undefined,
	compaction: {
		thresholdPercent: 0.6,
	},
});

export default agent;
