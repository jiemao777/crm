import { db } from "@crm/db";
import { scoreInquiry } from "@crm/db/inquiry-score";
import { type Approval, defineTool } from "eve/tools";
import { z } from "zod";
import { isAutomated } from "../lib/approval";

const inputSchema = z.object({
	dealId: z.string(),
	scoreSummary: z
		.string()
		.trim()
		.min(1)
		.max(500)
		.describe(
			"One short paragraph explaining the score from the timeline: what is moving, what is stalling.",
		),
	forecastContext: z
		.string()
		.trim()
		.min(1)
		.max(4_000)
		.describe(
			"A rolling summary of where this inquiry stands: the story so far and the next concrete step.",
		),
});

type WriteInquiryIntelligenceInput = z.infer<typeof inputSchema>;

export const approveInquiryIntelligence: Approval<
	WriteInquiryIntelligenceInput
> = ({ session, toolInput }) => {
	if (!isAutomated(session)) return "user-approval";

	const attributes = session.auth.current?.attributes ?? {};
	if (
		attributes.taskKind !== "inquiry-intelligence" ||
		attributes.dealId !== toolInput?.dealId
	) {
		return {
			type: "denied",
			reason: "This automated session was not opened for that inquiry.",
		};
	}
	return "not-applicable";
};

export default defineTool({
	description:
		"Write an inquiry's health score and forecast summary. The score itself is computed from the record, never from what you claim — you supply the explanation and the summary. Never touches a summary the rep wrote by hand.",
	inputSchema,
	approval: approveInquiryIntelligence,
	async execute(input, ctx) {
		const attributes = ctx.session.auth.current?.attributes ?? {};
		const automated = isAutomated(ctx.session);
		if (
			automated &&
			(attributes.taskKind !== "inquiry-intelligence" ||
				attributes.dealId !== input.dealId)
		) {
			return {
				written: false as const,
				reason: "The task does not own this inquiry.",
			};
		}

		const deal = await db.deal.findUnique({
			where: { id: input.dealId },
			select: {
				id: true,
				stage: true,
				stageChangedAt: true,
				lastActivityAt: true,
				amount: true,
				quantity: true,
				incoterm: true,
				paymentTerms: true,
				contacts: { select: { role: true } },
			},
		});
		if (!deal) {
			return {
				written: false as const,
				reason: "The inquiry no longer exists.",
			};
		}

		const assessed = scoreInquiry({
			stage: deal.stage,
			stageChangedAt: deal.stageChangedAt,
			lastActivityAt: deal.lastActivityAt,
			contactCount: deal.contacts.length,
			contactsWithRole: deal.contacts.filter((contact) => contact.role).length,
			hasAmount: deal.amount !== null,
			hasQuantity: deal.quantity !== null,
			hasTradeTerms: deal.incoterm !== null || deal.paymentTerms !== null,
			now: new Date(),
		});

		const now = new Date();
		await db.deal.update({
			where: { id: deal.id },
			data: {
				score: assessed?.score ?? null,
				scoreSummary: assessed ? input.scoreSummary : null,
				scoredAt: assessed ? now : null,
				forecastContext: input.forecastContext,
				forecastUpdatedAt: now,
			},
		});

		return {
			written: true as const,
			score: assessed?.score ?? null,
			breakdown: assessed?.breakdown ?? null,
			stalled: assessed?.stalled ?? null,
			daysInStage: assessed?.daysInStage ?? null,
			daysSinceActivity: assessed?.daysSinceActivity ?? null,
		};
	},
});
