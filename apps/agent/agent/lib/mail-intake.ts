import {
	ActivityType,
	type Db,
	db,
	type EmailThreadCategory,
	EnrichmentStatus,
	RecordSource,
} from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";

export type FileMailThreadInput = {
	threadId: string;
	category: EmailThreadCategory;
	evidence: string;
	companyId?: string | null;
	contactId?: string | null;
	newCustomer?: {
		name: string;
		domain?: string | null;
		email: string;
		personName?: string | null;
		phone?: string | null;
	};
};

export type FileMailThreadResult =
	| { filed: false; reason: string }
	| {
			filed: true;
			threadId: string;
			category: EmailThreadCategory;
			companyId: string | null;
			contactId: string | null;
			created: boolean;
	  };

export async function fileMailThread(
	input: FileMailThreadInput,
	actorId: string,
	allowCreate: boolean,
	client: Db = db,
): Promise<FileMailThreadResult> {
	if (input.newCustomer && !allowCreate) {
		return {
			filed: false,
			reason: "Customer creation is disabled for this mailbox task.",
		};
	}
	const actor = await client.user.findUnique({
		where: { id: actorId },
		select: { id: true },
	});
	if (!actor)
		return { filed: false, reason: "The mailbox owner no longer exists." };
	const member = await client.member.findUnique({
		where: {
			organizationId_userId: {
				organizationId: WORKSPACE_ID,
				userId: actorId,
			},
		},
		select: { id: true, role: true },
	});
	if (!member) {
		return { filed: false, reason: "The mailbox owner left the workspace." };
	}
	const workspaceAdmin = member.role === "owner" || member.role === "admin";

	const thread = await client.emailThread.findUnique({
		where: { id: input.threadId },
		select: {
			id: true,
			subject: true,
			lastMessageAt: true,
			companyId: true,
			contactId: true,
			messages: {
				orderBy: { sentAt: "desc" },
				take: 1,
				select: { body: true },
			},
		},
	});
	if (!thread)
		return { filed: false, reason: "The email thread no longer exists." };
	if (input.newCustomer) {
		return createCustomerAndFile(
			{ ...input, newCustomer: input.newCustomer },
			actorId,
			workspaceAdmin,
			thread,
			client,
		);
	}

	let companyId = thread.companyId ?? input.companyId ?? null;
	const contactId = thread.contactId ?? input.contactId ?? null;

	if (contactId) {
		const contact = await client.contact.findUnique({
			where: { id: contactId },
			select: { id: true, companyId: true, ownerId: true },
		});
		if (!contact) {
			return { filed: false, reason: "The selected contact no longer exists." };
		}
		if (!workspaceAdmin && contact.ownerId !== actorId) {
			return {
				filed: false,
				reason: "The selected contact belongs to another rep.",
			};
		}
		if (companyId && contact.companyId && companyId !== contact.companyId) {
			return {
				filed: false,
				reason: "The selected contact belongs to a different company.",
			};
		}
		companyId = companyId ?? contact.companyId;
	}
	if (companyId) {
		const company = await client.company.findUnique({
			where: { id: companyId },
			select: { id: true, ownerId: true },
		});
		if (!company) {
			return { filed: false, reason: "The selected company no longer exists." };
		}
		if (!workspaceAdmin && company.ownerId !== actorId) {
			return {
				filed: false,
				reason: "The selected company belongs to another rep.",
			};
		}
	}

	const stale = {
		OR: [
			{ lastActivityAt: null },
			{ lastActivityAt: { lt: thread.lastMessageAt } },
		],
	};
	await client.$transaction([
		client.emailThread.update({
			where: { id: thread.id },
			data: { category: input.category, companyId, contactId },
		}),
		client.activity.upsert({
			where: { emailThreadId: thread.id },
			create: {
				type: ActivityType.EMAIL,
				subject: thread.subject ?? "(no subject)",
				body: latestBody(thread.messages[0]?.body),
				occurredAt: thread.lastMessageAt,
				companyId,
				contactId,
				createdById: actorId,
				emailThreadId: thread.id,
				meta: {
					synced: true,
					source: "mail-intake-agent",
					evidence: input.evidence,
				},
			},
			update: {
				companyId,
				contactId,
				meta: {
					synced: true,
					source: "mail-intake-agent",
					evidence: input.evidence,
				},
			},
		}),
		...(companyId
			? [
					client.company.updateMany({
						where: { id: companyId, ...stale },
						data: { lastActivityAt: thread.lastMessageAt },
					}),
				]
			: []),
		...(contactId
			? [
					client.contact.updateMany({
						where: { id: contactId, ...stale },
						data: { lastActivityAt: thread.lastMessageAt },
					}),
				]
			: []),
	]);

	return {
		filed: true,
		threadId: thread.id,
		category: input.category,
		companyId,
		contactId,
		created: false,
	};
}

async function createCustomerAndFile(
	input: FileMailThreadInput & {
		newCustomer: NonNullable<FileMailThreadInput["newCustomer"]>;
	},
	actorId: string,
	workspaceAdmin: boolean,
	thread: {
		id: string;
		subject: string | null;
		lastMessageAt: Date;
		messages: { body: string | null }[];
	},
	client: Db,
): Promise<FileMailThreadResult> {
	const email = input.newCustomer.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return { filed: false, reason: "The proposed customer email is invalid." };
	}
	const domain = normalizeDomain(input.newCustomer.domain);
	const [existingContact, existingCompany] = await Promise.all([
		client.contact.findUnique({
			where: { email },
			select: {
				id: true,
				companyId: true,
				ownerId: true,
				company: { select: { ownerId: true } },
			},
		}),
		domain
			? client.company.findUnique({
					where: { domain },
					select: { id: true, ownerId: true },
				})
			: null,
	]);
	if (
		!workspaceAdmin &&
		existingContact?.ownerId !== undefined &&
		existingContact.ownerId !== actorId
	) {
		return {
			filed: false,
			reason: "That email belongs to another rep's contact.",
		};
	}
	if (
		!workspaceAdmin &&
		existingContact?.company?.ownerId !== undefined &&
		existingContact.company.ownerId !== actorId
	) {
		return {
			filed: false,
			reason: "That contact belongs to another rep's company.",
		};
	}
	if (
		!workspaceAdmin &&
		existingCompany &&
		existingCompany.ownerId !== actorId
	) {
		return {
			filed: false,
			reason: "That domain belongs to another rep's company.",
		};
	}
	const person = splitName(input.newCustomer.personName, email);

	return client.$transaction(async (tx) => {
		const existingCompanyId = existingContact?.companyId ?? existingCompany?.id;
		const company = existingCompanyId
			? { id: existingCompanyId }
			: await tx.company.create({
					data: {
						name: input.newCustomer.name.trim() || email,
						domain,
						website: domain ? `https://${domain}` : null,
						ownerId: actorId,
						customerType: "LEAD",
						leadSource: "Email",
						enrichmentStatus: EnrichmentStatus.PENDING,
						source: RecordSource.EMAIL,
					},
					select: { id: true },
				});
		const contact = existingContact
			? existingContact.companyId
				? { id: existingContact.id }
				: await tx.contact.update({
						where: { id: existingContact.id },
						data: { companyId: company.id, ownerId: actorId },
						select: { id: true },
					})
			: await tx.contact.create({
					data: {
						firstName: person.firstName,
						lastName: person.lastName,
						email,
						phone: input.newCustomer.phone?.trim() || null,
						companyId: company.id,
						ownerId: actorId,
						enrichmentStatus: EnrichmentStatus.PENDING,
						source: RecordSource.EMAIL,
					},
					select: { id: true },
				});

		await tx.company.updateMany({
			where: { id: company.id, primaryContactId: null },
			data: {
				primaryContactId: contact.id,
				lastActivityAt: thread.lastMessageAt,
			},
		});
		await tx.contact.updateMany({
			where: { id: contact.id },
			data: { lastActivityAt: thread.lastMessageAt },
		});
		await tx.emailThread.update({
			where: { id: thread.id },
			data: {
				category: input.category,
				companyId: company.id,
				contactId: contact.id,
			},
		});
		await tx.activity.upsert({
			where: { emailThreadId: thread.id },
			create: {
				type: ActivityType.EMAIL,
				subject: thread.subject ?? "(no subject)",
				body: latestBody(thread.messages[0]?.body),
				occurredAt: thread.lastMessageAt,
				companyId: company.id,
				contactId: contact.id,
				createdById: actorId,
				emailThreadId: thread.id,
				meta: {
					synced: true,
					source: "mail-intake-agent",
					evidence: input.evidence,
				},
			},
			update: {
				companyId: company.id,
				contactId: contact.id,
				meta: {
					synced: true,
					source: "mail-intake-agent",
					evidence: input.evidence,
				},
			},
		});

		return {
			filed: true as const,
			threadId: thread.id,
			category: input.category,
			companyId: company.id,
			contactId: contact.id,
			created: existingCompanyId === undefined,
		};
	});
}

function normalizeDomain(input: string | null | undefined): string | null {
	const value = input
		?.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.split("/")[0];
	return value && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value) ? value : null;
}

function splitName(
	personName: string | null | undefined,
	email: string,
): { firstName: string; lastName: string | null } {
	const parts = personName?.trim().split(/\s+/).filter(Boolean) ?? [];
	return {
		firstName: parts[0] ?? email.split("@")[0] ?? "Lead",
		lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
	};
}

function latestBody(body: string | null | undefined): string | null {
	const value = body?.trim();
	return value ? value.slice(0, 200) : null;
}
