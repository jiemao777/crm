import { z } from "zod";
import { listInput } from "../trpc/list-input";

export const companyListInput = listInput.extend({
	owner: z.string().default("all"),
	industry: z.string().default("all"),
	customerType: z.string().default("all"),
	enrichment: z.string().default("all"),
	source: z.string().default("all"),
});

export const aiExtractInput = z.object({
	text: z.string().min(1).max(10_000),
});

export type CompanyListInput = z.infer<typeof companyListInput>;

export const companyCreateInput = z.object({
	name: z.string().trim().min(1, "A customer needs a name."),
	domain: z.string().trim().optional(),
	ownerId: z.string().nullable().optional(),
	customerType: z
		.enum(["LEAD", "BUYER", "DISTRIBUTOR", "AGENT", "CUSTOMER"])
		.optional(),
	customerLevel: z.string().trim().max(20).nullable().optional(),
	leadSource: z.string().trim().max(100).nullable().optional(),
	productInterest: z.string().trim().max(500).nullable().optional(),
	contact: z
		.object({
			firstName: z.string().trim().min(1),
			lastName: z.string().trim().optional(),
			email: z
				.string()
				.trim()
				.email("That is not an email address.")
				.optional()
				.or(z.literal("")),
			phone: z.string().trim().optional(),
		})
		.optional(),
});

export type CompanyCreateInput = z.infer<typeof companyCreateInput>;

const companyUpdateInput = z.object({
	name: z.string().trim().min(1).optional(),
	domain: z.string().optional(),
	website: z.string().optional(),
	description: z.string().optional(),
	industry: z.string().optional(),
	customerType: z
		.enum(["LEAD", "BUYER", "DISTRIBUTOR", "AGENT", "CUSTOMER"])
		.optional(),
	customerLevel: z.string().trim().max(20).nullable().optional(),
	leadSource: z.string().trim().max(100).nullable().optional(),
	productInterest: z.string().trim().max(500).nullable().optional(),
	targetMarkets: z.string().trim().max(500).nullable().optional(),
	language: z.string().trim().max(100).nullable().optional(),
	timezone: z.string().trim().max(100).nullable().optional(),
	city: z.string().optional(),
	stateCode: z.string().optional(),
	country: z.string().optional(),
	phone: z.string().optional(),
	email: z.string().optional(),
	linkedinUrl: z.string().optional(),
	ownerId: z.string().nullable().optional(),
});

export type CompanyUpdateInput = z.infer<typeof companyUpdateInput>;

export const companyUpdateArgs = z.object({
	id: z.string(),
	data: companyUpdateInput,
});

export const companyIdInput = z.object({ id: z.string() });

export const companyMergeInput = z.object({
	keepId: z.string(),
	mergeId: z.string(),
});

export const setPrimaryContactInput = z.object({
	companyId: z.string(),
	contactId: z.string().nullable(),
});

export const companyOptionsInput = z.object({
	q: z.string().default(""),
});
