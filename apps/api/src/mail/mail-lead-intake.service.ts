import { ActivityType, type Db, EnrichmentStatus, RecordSource } from "@crm/db";
import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { AiExtractService } from "../agent/ai-extract.service";
import { domainFromEmail, normalizeDomain } from "../companies/domain";
import {
	assertCompanyAccess,
	assertContactAccess,
	requireWorkspaceRole,
} from "../crm/access";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { normalizeEmail } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import type { ManualLeadInput } from "../google/google.contracts";

export type MailLeadIntakeOutcome =
	| { status: "unavailable" | "needs-review" }
	| {
			status: "already-linked" | "matched" | "created";
			companyId: string | null;
			contactId: string | null;
	  };

type IntakeThread = {
	id: string;
	subject: string | null;
	lastMessageAt: Date;
	companyId: string | null;
	contactId: string | null;
	messages: {
		fromEmail: string;
		fromName: string | null;
		subject: string | null;
		body: string | null;
	}[];
};

type LeadFields = {
	name: string;
	domain: string | null;
	email: string;
	personName: string | null;
	phone: string | null;
	leadSource: string | null;
	productInterest: string | null;
};

@Injectable()
export class MailLeadIntakeService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly extraction: AiExtractService,
		private readonly agent: AgentTriggerService,
		private readonly stamp: ActivityStampService,
	) {}

	async createCustomerFromThread(
		threadId: string,
		ownerId: string,
	): Promise<MailLeadIntakeOutcome> {
		const thread = await this.unlinkedThread(threadId, ownerId);
		if ("status" in thread) return thread;

		const extracted = await this.extraction.extract(this.transcript(thread));
		if (!extracted) return { status: "unavailable" };

		const email = normalizeEmail(extracted.email ?? "");
		if (!email) return { status: "needs-review" };

		return this.persist(
			thread,
			{
				name: extracted.name,
				domain: normalizeDomain(extracted.domain),
				email,
				personName: extracted.personName,
				phone: extracted.phone,
				leadSource: extracted.leadSource ?? "Email",
				productInterest: extracted.productInterest,
			},
			ownerId,
		);
	}

	async createCustomerFromThreadManual(
		threadId: string,
		input: ManualLeadInput,
		ownerId: string,
	): Promise<MailLeadIntakeOutcome> {
		const thread = await this.unlinkedThread(threadId, ownerId);
		if ("status" in thread) return thread;

		const email = normalizeEmail(input.email);
		if (!email) {
			throw new BadRequestException("A valid email address is required.");
		}

		return this.persist(
			thread,
			{
				name: input.companyName,
				domain: normalizeDomain(input.domain) ?? domainFromEmail(email),
				email,
				personName:
					[input.firstName, input.lastName].filter(Boolean).join(" ").trim() ||
					null,
				phone: input.phone ?? null,
				leadSource: "Email",
				productInterest: null,
			},
			ownerId,
		);
	}

	private async unlinkedThread(threadId: string, ownerId: string) {
		await requireWorkspaceRole(this.db, ownerId);
		const thread = await this.thread(threadId);
		if (thread.companyId || thread.contactId) {
			return {
				status: "already-linked" as const,
				companyId: thread.companyId,
				contactId: thread.contactId,
			};
		}
		return thread;
	}

	private async persist(
		thread: IntakeThread,
		fields: LeadFields,
		ownerId: string,
	): Promise<MailLeadIntakeOutcome> {
		const email = fields.email;
		const domain = fields.domain;
		const [existingContact, existingCompany] = await Promise.all([
			this.db.contact.findUnique({
				where: { email },
				select: { id: true, companyId: true },
			}),
			domain
				? this.db.company.findUnique({
						where: { domain },
						select: { id: true },
					})
				: null,
		]);

		if (existingContact) {
			await assertContactAccess(this.db, ownerId, existingContact.id);
		}
		if (existingContact?.companyId) {
			await this.link(
				thread,
				existingContact.companyId,
				existingContact.id,
				ownerId,
			);
			return {
				status: "matched",
				companyId: existingContact.companyId,
				contactId: existingContact.id,
			};
		}
		if (existingCompany) {
			await assertCompanyAccess(this.db, ownerId, existingCompany.id);
		}

		const person = splitPersonName(fields.personName, email);
		const companyName =
			fields.name.trim() || fields.personName?.trim() || email;
		const created = await this.db.$transaction(async (tx) => {
			const company = existingCompany
				? existingCompany
				: await tx.company.create({
						data: {
							name: companyName,
							domain,
							website: domain ? `https://${domain}` : null,
							ownerId,
							customerType: "LEAD",
							leadSource: fields.leadSource,
							productInterest: fields.productInterest,
							enrichmentStatus: EnrichmentStatus.PENDING,
							source: RecordSource.EMAIL,
						},
						select: { id: true },
					});
			const contact = existingContact
				? await tx.contact.update({
						where: { id: existingContact.id },
						data: { companyId: company.id, ownerId },
						select: { id: true },
					})
				: await tx.contact.create({
						data: {
							firstName: person.firstName,
							lastName: person.lastName,
							email,
							phone: fields.phone,
							companyId: company.id,
							ownerId,
							source: RecordSource.EMAIL,
						},
						select: { id: true },
					});

			await tx.company.updateMany({
				where: { id: company.id, primaryContactId: null },
				data: { primaryContactId: contact.id },
			});
			await tx.emailThread.update({
				where: { id: thread.id },
				data: { companyId: company.id, contactId: contact.id },
			});
			await tx.activity.upsert({
				where: { emailThreadId: thread.id },
				create: {
					type: ActivityType.EMAIL,
					subject: thread.subject ?? "(no subject)",
					body: latestBody(thread),
					occurredAt: thread.lastMessageAt,
					companyId: company.id,
					contactId: contact.id,
					createdById: ownerId,
					emailThreadId: thread.id,
					meta: { synced: true, source: "mail-lead-intake" },
				},
				update: { companyId: company.id, contactId: contact.id },
			});

			return {
				companyId: company.id,
				contactId: contact.id,
				companyCreated: existingCompany === null,
				contactCreated: existingContact === null,
			};
		});

		await this.stamp.touch(
			{ companyId: created.companyId, contactId: created.contactId },
			thread.lastMessageAt,
		);
		if (created.contactCreated) {
			await this.agent.contactCreated(
				created.contactId,
				"Created from a confirmed email lead",
			);
		}
		if (created.companyCreated) {
			await this.agent.companyCreated(
				created.companyId,
				"Created from a confirmed email lead",
			);
		}

		return {
			status: created.companyCreated ? "created" : "matched",
			companyId: created.companyId,
			contactId: created.contactId,
		};
	}

	private async thread(threadId: string): Promise<IntakeThread> {
		const thread = await this.db.emailThread.findUnique({
			where: { id: threadId },
			select: {
				id: true,
				subject: true,
				lastMessageAt: true,
				companyId: true,
				contactId: true,
				messages: {
					orderBy: { sentAt: "asc" },
					select: {
						fromEmail: true,
						fromName: true,
						subject: true,
						body: true,
					},
				},
			},
		});
		if (!thread) {
			throw new NotFoundException(`No email thread with id ${threadId}.`);
		}
		return thread;
	}

	private transcript(thread: IntakeThread): string {
		return thread.messages
			.map(
				(message) =>
					`From: ${message.fromName ?? ""} <${message.fromEmail}>\nSubject: ${message.subject ?? thread.subject ?? ""}\n${message.body ?? ""}`,
			)
			.join("\n\n");
	}

	private async link(
		thread: IntakeThread,
		companyId: string,
		contactId: string,
		ownerId: string,
	): Promise<void> {
		await this.db.$transaction([
			this.db.emailThread.update({
				where: { id: thread.id },
				data: { companyId, contactId },
			}),
			this.db.activity.upsert({
				where: { emailThreadId: thread.id },
				create: {
					type: ActivityType.EMAIL,
					subject: thread.subject ?? "(no subject)",
					body: latestBody(thread),
					occurredAt: thread.lastMessageAt,
					companyId,
					contactId,
					createdById: ownerId,
					emailThreadId: thread.id,
					meta: { synced: true, source: "mail-lead-intake" },
				},
				update: { companyId, contactId },
			}),
		]);
		await this.stamp.touch({ companyId, contactId }, thread.lastMessageAt);
	}
}

function splitPersonName(
	personName: string | null,
	email: string,
): { firstName: string; lastName: string | null } {
	const parts = personName?.trim().split(/\s+/).filter(Boolean) ?? [];
	return {
		firstName: parts[0] ?? email.split("@")[0] ?? "Lead",
		lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
	};
}

function latestBody(thread: IntakeThread): string | null {
	const body = thread.messages.at(-1)?.body?.trim();
	return body ? body.slice(0, 200) : null;
}
