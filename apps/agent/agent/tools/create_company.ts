import { db, RecordSource } from "@crm/db";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

function normaliseDomain(input: string | undefined | null): string | null {
	const value = input
		?.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "");
	if (!value) return null;
	const withoutPath = value.split("/")[0]?.split("?")[0];
	if (!withoutPath) return null;
	return withoutPath.includes(".") ? withoutPath : null;
}

export default defineTool({
	description:
		"Create a new customer in the CRM from information the rep provided (pasted text, email signature, website, business card). Creates the company, optionally the first contact, and returns their ids. Requires the rep's confirmation before it runs. Never fabricate details — only record what the rep actually told you.",
	approval: always(),
	inputSchema: z.object({
		name: z.string().describe("Company or customer name, as the rep wrote it."),
		domain: z
			.string()
			.optional()
			.describe("Domain if you can derive one from an email or website."),
		website: z.string().optional(),
		industry: z.string().optional(),
		customerType: z
			.enum(["LEAD", "BUYER", "DISTRIBUTOR", "AGENT", "CUSTOMER"])
			.default("LEAD"),
		leadSource: z.string().optional().describe("Where the rep found them."),
		productInterest: z.string().optional(),
		targetMarkets: z.string().optional(),
		contact: z
			.object({
				firstName: z.string(),
				lastName: z.string().optional(),
				email: z.string().email(),
				title: z.string().optional(),
				phone: z.string().optional(),
			})
			.optional()
			.describe("The first contact, if the rep provided one."),
	}),
	async execute(input, ctx) {
		const ownerId =
			typeof ctx.session?.auth?.current?.principalId === "string"
				? ctx.session.auth.current.principalId
				: null;

		const domain = input.domain ? normaliseDomain(input.domain) : null;
		if (domain) {
			const existing = await db.company.findUnique({
				where: { domain },
				select: { id: true, name: true },
			});
			if (existing) {
				return {
					created: false as const,
					reason: `${existing.name} already uses the domain ${domain}.`,
					companyId: existing.id,
				};
			}
		}

		const email = input.contact?.email.toLowerCase() ?? null;
		const existingContact = email
			? await db.contact.findUnique({
					where: { email },
					select: { id: true, companyId: true },
				})
			: null;
		if (existingContact?.companyId) {
			return {
				created: false as const,
				reason: `A contact with ${email} already belongs to another customer.`,
				contactId: existingContact.id,
			};
		}

		const { company, contactId } = await db.$transaction(async (tx) => {
			const company = await tx.company.create({
				data: {
					name: input.name.trim(),
					domain,
					website: input.website?.trim() || null,
					industry: input.industry?.trim() || null,
					ownerId,
					customerType: input.customerType,
					leadSource: input.leadSource?.trim() || null,
					productInterest: input.productInterest?.trim() || null,
					targetMarkets: input.targetMarkets?.trim() || null,
					source: RecordSource.EMAIL,
				},
				select: { id: true, name: true, domain: true },
			});

			if (!input.contact) return { company, contactId: null };

			const contact = existingContact
				? await tx.contact.update({
						where: { id: existingContact.id },
						data: { companyId: company.id },
						select: { id: true },
					})
				: await tx.contact.create({
						data: {
							firstName: input.contact.firstName.trim(),
							lastName: input.contact.lastName?.trim() || null,
							email,
							title: input.contact.title?.trim() || null,
							phone: input.contact.phone?.trim() || null,
							companyId: company.id,
							ownerId,
							source: RecordSource.EMAIL,
						},
						select: { id: true },
					});

			await tx.company.update({
				where: { id: company.id },
				data: { primaryContactId: contact.id },
			});
			return { company, contactId: contact.id };
		});

		return {
			created: true as const,
			companyId: company.id,
			companyName: company.name,
			domain: company.domain,
			contactId,
		};
	},
});
