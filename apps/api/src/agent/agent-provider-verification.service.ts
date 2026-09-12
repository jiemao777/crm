import {
	AGENT_PROVIDER_VERIFICATION_REASONS,
	type AgentProviderRuntimeConfig,
} from "@crm/db/agent-provider";
import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { bridge } from "./bridge";

const VERIFY_TIMEOUT_MS = 45_000;

const verificationSchema = z.discriminatedUnion("outcome", [
	z.object({ outcome: z.literal("valid") }),
	z.object({
		outcome: z.literal("invalid"),
		reason: z.enum(AGENT_PROVIDER_VERIFICATION_REASONS),
	}),
	z.object({
		outcome: z.literal("unknown"),
		reason: z.enum(AGENT_PROVIDER_VERIFICATION_REASONS),
	}),
]);

export type AgentProviderVerification = z.infer<typeof verificationSchema>;

@Injectable()
export class AgentProviderVerificationService {
	private readonly logger = new Logger(AgentProviderVerificationService.name);

	async verify(
		provider: AgentProviderRuntimeConfig,
	): Promise<AgentProviderVerification> {
		const agent = bridge();
		if (!agent) {
			return {
				outcome: "unknown",
				reason: "agent-not-configured",
			};
		}

		try {
			const response = await fetch(
				agent.url("/internal/crm/verify-model-provider"),
				{
					method: "POST",
					headers: {
						authorization: `Bearer ${agent.secret}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(provider),
					signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
				},
			);
			const parsed = verificationSchema.safeParse(
				await response.json().catch(() => null),
			);
			if (response.ok && parsed.success) return parsed.data;

			this.logger.warn({
				message: "Agent provider verification failed",
				status: response.status,
			});
			return {
				outcome: "unknown",
				reason: "verification-failed",
			};
		} catch (error) {
			this.logger.warn({
				message: "Agent provider verification was unavailable",
				reason: error instanceof Error ? error.message : String(error),
			});
			return {
				outcome: "unknown",
				reason: "agent-unreachable",
			};
		}
	}
}
