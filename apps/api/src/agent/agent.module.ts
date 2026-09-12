import { Module } from "@nestjs/common";
import { AgentProviderVerificationService } from "./agent-provider-verification.service";
import { AgentQueueService } from "./agent-queue.service";
import { AgentTriggerService } from "./agent-trigger.service";
import { AiExtractService } from "./ai-extract.service";
import { ResearchProviderVerificationService } from "./research-provider-verification.service";

@Module({
	providers: [
		AgentProviderVerificationService,
		AgentTriggerService,
		AgentQueueService,
		ResearchProviderVerificationService,
		AiExtractService,
	],
	exports: [
		AgentProviderVerificationService,
		AgentTriggerService,
		AgentQueueService,
		ResearchProviderVerificationService,
		AiExtractService,
	],
})
export class AgentModule {}
