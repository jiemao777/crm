import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { bridge } from "./bridge";

const EXTRACT_TIMEOUT_MS = 45_000;

const extractedLeadSchema = z.object({
	name: z.string().max(200),
	domain: z.string().max(253),
	email: z.string().max(320).nullable(),
	personName: z.string().max(200).nullable(),
	phone: z.string().max(100).nullable(),
	leadSource: z.string().max(100).nullable(),
	productInterest: z.string().max(500).nullable(),
	targetMarket: z.string().max(200).nullable(),
	uncertain: z.array(z.string()).max(5),
});

export type AiExtractedLead = z.infer<typeof extractedLeadSchema>;

const responseSchema = z.object({ result: extractedLeadSchema.nullable() });

@Injectable()
export class AiExtractService {
	private readonly logger = new Logger(AiExtractService.name);

	async extract(text: string): Promise<AiExtractedLead | null> {
		const agent = bridge();
		if (!agent) return null;

		try {
			const response = await fetch(agent.url("/internal/crm/extract-lead"), {
				method: "POST",
				headers: {
					authorization: `Bearer ${agent.secret}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ text: text.slice(0, 10_000) }),
				signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
			});

			if (!response.ok) {
				this.logger.warn({
					message: "AI extract endpoint failed",
					status: response.status,
				});
				return null;
			}

			const parsed = responseSchema.safeParse(await response.json());
			if (!parsed.success) {
				this.logger.warn({ message: "AI extract response was invalid" });
				return null;
			}

			return parsed.data.result;
		} catch (error) {
			this.logger.warn({
				message: "AI extract failed",
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}
}
