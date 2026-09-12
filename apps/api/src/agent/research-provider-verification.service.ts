import type { ResearchProviderKind } from "@crm/db/research-provider";
import { Injectable, Logger } from "@nestjs/common";
import { bridge } from "./bridge";

const VERIFY_TIMEOUT_MS = 20_000;

export type ResearchProviderCheck =
	| { outcome: "valid" }
	| { outcome: "invalid"; reason: string }
	| { outcome: "unknown"; reason: string };

@Injectable()
export class ResearchProviderVerificationService {
	private readonly logger = new Logger(
		ResearchProviderVerificationService.name,
	);

	async verify(provider: {
		kind: ResearchProviderKind;
		apiKey: string | null;
	}): Promise<ResearchProviderCheck> {
		const agent = bridge();
		if (!agent) {
			return {
				outcome: "unknown",
				reason:
					"This install has no AGENT_BRIDGE_SECRET, so nothing can check.",
			};
		}

		try {
			const response = await fetch(
				agent.url("/internal/crm/verify-research-provider"),
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

			if (!response.ok) {
				return this.cannotTell(`The agent answered ${response.status}.`);
			}

			const body = (await response.json().catch(() => null)) as {
				outcome?: unknown;
				reason?: unknown;
			} | null;
			if (body?.outcome === "valid") return { outcome: "valid" };
			if (body?.outcome === "invalid") {
				return {
					outcome: "invalid",
					reason:
						typeof body.reason === "string" && body.reason
							? body.reason
							: "The research provider rejected that API key.",
				};
			}
			return this.cannotTell(
				typeof body?.reason === "string" ? body.reason : "No answer.",
			);
		} catch (error) {
			return this.cannotTell(
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	private cannotTell(reason: string): ResearchProviderCheck {
		this.logger.warn({
			message: "Could not check the research provider; saving it unverified",
			reason,
		});
		return { outcome: "unknown", reason };
	}
}
