import { ActivityType, db } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { spend } from "../lib/focus";
import { extract } from "../lib/research-provider";

const RESEARCH_SCHEMA = z.object({
	positioning: z
		.string()
		.max(2_000)
		.describe("One paragraph: what they sell and who to."),
	pricingModel: z
		.string()
		.max(1_000)
		.optional()
		.describe("How they charge — per seat, usage, flat, enterprise-only."),
	targetCustomer: z
		.string()
		.max(1_000)
		.optional()
		.describe("The customer they describe themselves as serving."),
	notableCustomers: z
		.array(z.string().max(200))
		.max(30)
		.optional()
		.describe("Named customers or logos on the site."),
	recentNews: z
		.array(z.string().max(500))
		.max(20)
		.optional()
		.describe("Recent announcements, funding, or launches."),
});

type ResearchBrief = z.infer<typeof RESEARCH_SCHEMA>;

const RESEARCH_INSTRUCTIONS =
	"Read this company's marketing site and answer as a salesperson preparing " +
	"for a first call. Be specific and factual; leave a field empty rather than " +
	"guessing.";

export default defineTool({
	description:
		"Read a company's marketing site and write a research brief to its timeline: positioning, pricing, who they sell to, notable customers, recent news.",
	inputSchema: z.object({
		companyId: z.string(),
	}),
	async execute({ companyId }) {
		const company = await db.company.findUnique({
			where: { id: companyId },
			select: {
				id: true,
				name: true,
				domain: true,
				website: true,
				ownerId: true,
			},
		});

		if (!company)
			return { written: false as const, reason: "No such company." };

		const url =
			company.website ?? (company.domain ? `https://${company.domain}` : null);

		if (!url) {
			return {
				written: false as const,
				reason: "This company has no website.",
			};
		}

		const charge = spend(2);
		if (!charge.ok) return { written: false as const, reason: charge.reason };

		const result = await extract(url, RESEARCH_SCHEMA, RESEARCH_INSTRUCTIONS);

		if (result.outcome === "failed") {
			return { written: false as const, reason: result.reason };
		}

		const author =
			company.ownerId ??
			(await db.user.findFirst({ select: { id: true } }))?.id ??
			null;

		if (!author)
			return { written: false as const, reason: "No user to attribute to." };

		const activity = await db.activity.create({
			data: {
				type: ActivityType.ENRICHMENT,
				subject: `Research brief — ${company.name}`,
				body: formatBrief(result.data),
				occurredAt: new Date(),
				companyId: company.id,
				createdById: author,
				meta: {
					source: result.source,
					endpoint: result.source === "context.dev" ? "web/extract" : "search",
					creditCost: result.source === "context.dev" ? 10 : 2,
					agent: "people-research",
				},
			},
			select: { id: true },
		});

		await db.company.update({
			where: { id: companyId },
			data: { lastActivityAt: new Date() },
		});

		return { written: true as const, activityId: activity.id };
	},
});

function formatBrief(brief: ResearchBrief): string {
	const lines = [brief.positioning.trim()];
	if (brief.pricingModel?.trim()) {
		lines.push(`Pricing: ${brief.pricingModel.trim()}`);
	}
	if (brief.targetCustomer?.trim()) {
		lines.push(`Sells to: ${brief.targetCustomer.trim()}`);
	}
	if (brief.notableCustomers?.length) {
		lines.push(`Customers: ${brief.notableCustomers.join(", ")}`);
	}
	if (brief.recentNews?.length) {
		lines.push(
			`Recently:\n${brief.recentNews.map((item) => `• ${item}`).join("\n")}`,
		);
	}
	return lines.join("\n\n");
}
