import {
	ActivityType,
	type Db,
	type EnrichmentStatus,
	type Prisma,
	Prisma as PrismaNamespace,
	RecordSource,
} from "@crm/db";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentQueueService } from "../agent/agent-queue.service";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { AiExtractService } from "../agent/ai-extract.service";
import {
	assertCompanyAccess,
	assertContactAccess,
	resolveOwnerId,
} from "../crm/access";
import {
	ActivityStampService,
	type StampTargets,
} from "../crm/activity-stamp.service";
import { blankToNull, toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { OPEN_INQUIRY_STAGES } from "../deals/deal-stage";
import {
	countsByKey,
	FACET_ALL,
	FACET_UNASSIGNED,
	type ListResult,
	ownerFilter,
	paginate,
	resolveOrderBy,
} from "../trpc/list-input";
import type {
	CompanyCreateInput,
	CompanyListInput,
	CompanyUpdateInput,
} from "./companies.contracts";
import { normalizeDomain, rootDomain } from "./domain";
import { FaviconService } from "./favicon.service";

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const MERGE_ADOPTABLE = [
	"domain",
	"website",
	"description",
	"industry",
	"subIndustry",
	"city",
	"stateCode",
	"country",
	"countryCode",
	"phone",
	"email",
	"linkedinUrl",
	"twitterUrl",
	"githubUrl",
	"pricingUrl",
	"careersUrl",
	"customerLevel",
	"leadSource",
	"productInterest",
	"targetMarkets",
	"language",
	"timezone",
	"logoUrl",
	"logoDarkUrl",
	"iconUrl",
	"iconDarkUrl",
	"iconTone",
	"brandColor",
] as const;

export type CompanyRow = {
	id: string;
	name: string;
	domain: string | null;
	iconUrl: string | null;
	iconDarkUrl: string | null;
	iconTone: string | null;
	logoUrl: string | null;
	brandColor: string | null;
	industry: string | null;
	customerType: "LEAD" | "BUYER" | "DISTRIBUTOR" | "AGENT" | "CUSTOMER";
	customerLevel: string | null;
	leadSource: string | null;
	productInterest: string | null;
	enrichmentStatus: EnrichmentStatus;
	queued: boolean;
	source: RecordSource;
	owner: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
	contactCount: number;
	openDealCount: number;
	lastActivityAt: string | null;
	createdAt: string;
};

const SORTABLE: Record<
	string,
	(dir: Prisma.SortOrder) => Prisma.CompanyOrderByWithRelationInput
> = {
	name: (dir) => ({ name: dir }),
	domain: (dir) => ({ domain: dir }),
	industry: (dir) => ({ industry: dir }),
	createdAt: (dir) => ({ createdAt: dir }),
	contacts: (dir) => ({ contacts: { _count: dir } }),
	deals: (dir) => ({ deals: { _count: dir } }),
	owner: (dir) => ({ owner: { name: dir } }),
	lastActivity: (dir) => ({ lastActivityAt: { sort: dir, nulls: "last" } }),
};

@Injectable()
export class CompaniesService {
	private readonly logger = new Logger(CompaniesService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
		private readonly queue: AgentQueueService,
		private readonly favicon: FaviconService,
		private readonly stamp: ActivityStampService,
		private readonly ai: AiExtractService,
	) {}

	async aiExtract(text: string) {
		return this.ai.extract(text);
	}

	async list(input: CompanyListInput): Promise<ListResult<CompanyRow>> {
		const where = this.buildWhere(input);
		const { skip, take } = paginate(input);

		const [rows, total, facetCounts] = await Promise.all([
			this.db.company.findMany({
				where,
				skip,
				take,
				orderBy: resolveOrderBy(input, SORTABLE, {
					createdAt: "desc",
				}),
				select: {
					id: true,
					name: true,
					domain: true,
					iconUrl: true,
					iconDarkUrl: true,
					iconTone: true,
					logoUrl: true,
					brandColor: true,
					industry: true,
					customerType: true,
					customerLevel: true,
					leadSource: true,
					productInterest: true,
					enrichmentStatus: true,
					source: true,
					owner: { select: OWNER_SELECT },
					_count: {
						select: {
							contacts: true,
							deals: { where: { stage: { in: [...OPEN_INQUIRY_STAGES] } } },
						},
					},
					lastActivityAt: true,
					createdAt: true,
				},
			}),
			this.db.company.count({ where }),
			this.facetCounts(input),
		]);

		const queued = await this.queue.queuedCompanies(rows.map((row) => row.id));

		return {
			rows: rows.map((row) => ({
				id: row.id,
				name: row.name,
				domain: row.domain,
				iconUrl: row.iconUrl,
				iconDarkUrl: row.iconDarkUrl,
				iconTone: row.iconTone,
				logoUrl: row.logoUrl,
				brandColor: row.brandColor,
				industry: row.industry,
				customerType: row.customerType,
				customerLevel: row.customerLevel,
				leadSource: row.leadSource,
				productInterest: row.productInterest,
				enrichmentStatus: row.enrichmentStatus,
				queued: queued.has(row.id),
				source: row.source,
				owner: row.owner,
				contactCount: row._count.contacts,
				openDealCount: row._count.deals,
				lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
				createdAt: row.createdAt.toISOString(),
			})),
			total,
			facetCounts,
		};
	}

	async byId(id: string) {
		const company = await this.db.company.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				domain: true,
				website: true,
				description: true,
				logoUrl: true,
				logoDarkUrl: true,
				iconUrl: true,
				iconDarkUrl: true,
				iconTone: true,
				brandColor: true,
				industry: true,
				customerType: true,
				customerLevel: true,
				leadSource: true,
				productInterest: true,
				targetMarkets: true,
				language: true,
				timezone: true,
				subIndustry: true,
				city: true,
				stateCode: true,
				country: true,
				countryCode: true,
				phone: true,
				email: true,
				linkedinUrl: true,
				twitterUrl: true,
				githubUrl: true,
				pricingUrl: true,
				careersUrl: true,
				enrichmentStatus: true,
				enrichedAt: true,
				enrichmentError: true,
				source: true,
				createdAt: true,
				owner: { select: OWNER_SELECT },
				primaryContact: {
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						phone: true,
						title: true,
					},
				},
				contacts: {
					orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						title: true,
						imageUrl: true,
						owner: { select: OWNER_SELECT },
					},
				},
				deals: {
					orderBy: [{ stage: "asc" }, { expectedOrderDate: "asc" }],
					select: {
						id: true,
						name: true,
						stage: true,
						amount: true,
						currency: true,
						expectedOrderDate: true,
						owner: { select: OWNER_SELECT },
					},
				},
			},
		});

		if (!company) {
			throw new NotFoundException(`No company with id ${id}.`);
		}

		const { deals, primaryContact, enrichedAt, createdAt, ...rest } = company;

		return {
			...rest,
			queued: await this.queue.isQueued({ companyId: id }),
			createdAt: createdAt.toISOString(),
			enrichedAt: enrichedAt?.toISOString() ?? null,
			primaryContactId: primaryContact?.id ?? null,
			primaryContact,
			deals: deals.map((deal) => ({
				...deal,
				amount: undefined,
				amountCents: toCents(deal.amount),
				expectedOrderDate: deal.expectedOrderDate?.toISOString() ?? null,
			})),
		};
	}

	async options(q: string) {
		return this.db.company.findMany({
			where: this.searchFilter(q),
			select: { id: true, name: true, domain: true, iconUrl: true },
			orderBy: { name: "asc" },
			take: 100,
		});
	}

	async create(input: CompanyCreateInput, actingUserId?: string) {
		const domain = normalizeDomain(input.domain);
		const ownerId = actingUserId
			? await resolveOwnerId(this.db, actingUserId, input.ownerId)
			: (input.ownerId ?? null);
		const email = input.contact?.email?.trim().toLowerCase() || null;
		const existingContact = email
			? await this.db.contact.findUnique({
					where: { email },
					select: { id: true, companyId: true },
				})
			: null;

		if (existingContact?.companyId) {
			throw new ConflictException(
				`A contact with ${email} already belongs to another customer.`,
			);
		}
		if (actingUserId && existingContact) {
			await assertContactAccess(this.db, actingUserId, existingContact.id);
		}

		if (domain) {
			const existing = await this.db.company.findUnique({
				where: { domain },
				select: { id: true, name: true },
			});
			if (existing) {
				throw new ConflictException(
					`${existing.name} already uses the domain ${domain}.`,
				);
			}
		}

		let created: {
			company: { id: string; name: string; domain: string | null };
			contactId: string | null;
			contactCreated: boolean;
		};

		try {
			created = await this.db.$transaction(async (tx) => {
				const company = await tx.company.create({
					data: {
						name: input.name.trim(),
						domain,
						website: domain ? `https://${domain}` : null,
						ownerId,
						customerType: input.customerType ?? "LEAD",
						customerLevel: input.customerLevel ?? null,
						leadSource: input.leadSource ?? null,
						productInterest: input.productInterest ?? null,
					},
					select: { id: true, name: true, domain: true },
				});

				if (!input.contact?.firstName) {
					return { company, contactId: null, contactCreated: false };
				}

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
								phone: input.contact.phone?.trim() || null,
								companyId: company.id,
								ownerId,
								source: RecordSource.MANUAL,
							},
							select: { id: true },
						});

				await tx.company.update({
					where: { id: company.id },
					data: { primaryContactId: contact.id },
				});

				return {
					company,
					contactId: contact.id,
					contactCreated: !existingContact,
				};
			});
		} catch (error) {
			throw this.translate(error, "new");
		}
		const { company } = created;

		if (created.contactId) {
			if (created.contactCreated) {
				await this.agent.contactCreated(
					created.contactId,
					"Added together with a new customer",
				);
			}
			if (email) {
				await this.relinkThreadsFor(
					company.id,
					created.contactId,
					email,
					ownerId,
				);
			}
		} else if (domain) {
			const relinked = await this.db.emailThread.updateMany({
				where: {
					companyId: null,
					contactId: null,
					messages: { some: { fromEmail: { endsWith: `@${domain}` } } },
				},
				data: { companyId: company.id },
			});
			if (relinked.count > 0) {
				await this.db.activity.updateMany({
					where: {
						companyId: null,
						emailThread: {
							messages: { some: { fromEmail: { endsWith: `@${domain}` } } },
						},
					},
					data: { companyId: company.id },
				});
				this.logger.log({
					message: "Unmatched threads linked by domain",
					companyId: company.id,
					domain,
					count: relinked.count,
				});
			}
		}

		this.logger.log({
			message: "Company created",
			companyId: company.id,
			domain: company.domain,
		});

		await this.agent.companyCreated(company.id);

		void this.favicon.backfill(company.id, company.domain);

		return company;
	}

	private async relinkThreadsFor(
		companyId: string,
		contactId: string,
		email: string,
		ownerId?: string | null,
	): Promise<void> {
		const threads = await this.db.emailThread.findMany({
			where: {
				companyId: null,
				contactId: null,
				messages: {
					some: { fromEmail: { equals: email, mode: "insensitive" } },
				},
			},
			select: {
				id: true,
				subject: true,
				lastMessageAt: true,
				messages: {
					orderBy: { sentAt: "desc" },
					take: 1,
					select: { body: true },
				},
			},
		});
		if (threads.length === 0) return;

		await this.db.emailThread.updateMany({
			where: { id: { in: threads.map((thread) => thread.id) } },
			data: { companyId, contactId },
		});
		for (const thread of threads) {
			await this.db.activity.upsert({
				where: { emailThreadId: thread.id },
				create: {
					type: ActivityType.EMAIL,
					subject: thread.subject ?? "(no subject)",
					body: (thread.messages[0]?.body ?? "").slice(0, 200) || null,
					occurredAt: thread.lastMessageAt,
					companyId,
					contactId,
					createdById: ownerId ?? (await this.firstUserId()),
					emailThreadId: thread.id,
					meta: { synced: true, source: "zoho-imap" },
				},
				update: { companyId, contactId },
			});
		}

		this.logger.log({
			message: "Unmatched threads linked to a new customer",
			companyId,
			contactId,
			email,
			count: threads.length,
		});
	}

	private async firstUserId(): Promise<string> {
		const user = await this.db.user.findFirst({
			select: { id: true },
			orderBy: { createdAt: "asc" },
		});
		return user?.id ?? "system";
	}

	async update(id: string, input: CompanyUpdateInput, actingUserId?: string) {
		if (actingUserId) await assertCompanyAccess(this.db, actingUserId, id);
		const data: Prisma.CompanyUpdateInput = {};

		if (input.name !== undefined) data.name = input.name.trim();
		if (input.website !== undefined) data.website = blankToNull(input.website);
		if (input.description !== undefined) {
			data.description = blankToNull(input.description);
		}
		if (input.industry !== undefined)
			data.industry = blankToNull(input.industry);
		if (input.customerType !== undefined)
			data.customerType = input.customerType;
		if (input.customerLevel !== undefined)
			data.customerLevel = blankToNull(input.customerLevel ?? "");
		if (input.leadSource !== undefined)
			data.leadSource = blankToNull(input.leadSource ?? "");
		if (input.productInterest !== undefined)
			data.productInterest = blankToNull(input.productInterest ?? "");
		if (input.targetMarkets !== undefined)
			data.targetMarkets = blankToNull(input.targetMarkets ?? "");
		if (input.language !== undefined)
			data.language = blankToNull(input.language ?? "");
		if (input.timezone !== undefined)
			data.timezone = blankToNull(input.timezone ?? "");
		if (input.city !== undefined) data.city = blankToNull(input.city);
		if (input.stateCode !== undefined) {
			data.stateCode = blankToNull(input.stateCode);
		}
		if (input.country !== undefined) data.country = blankToNull(input.country);
		if (input.phone !== undefined) data.phone = blankToNull(input.phone);
		if (input.email !== undefined) data.email = blankToNull(input.email);
		if (input.linkedinUrl !== undefined) {
			data.linkedinUrl = blankToNull(input.linkedinUrl);
		}
		if (input.ownerId !== undefined) {
			const ownerId = actingUserId
				? await resolveOwnerId(this.db, actingUserId, input.ownerId)
				: input.ownerId;
			data.owner = ownerId
				? { connect: { id: ownerId } }
				: { disconnect: true };
		}

		if (input.domain !== undefined) {
			const domain = normalizeDomain(input.domain);
			if (input.domain.trim() && !domain) {
				throw new BadRequestException(
					`"${input.domain}" is not a domain — try something like "stripe.com".`,
				);
			}
			data.domain = domain;
			const current = await this.db.company.findUnique({
				where: { id },
				select: { domain: true },
			});
			if (current && current.domain !== domain) {
				data.enrichmentStatus = "PENDING";
				data.enrichmentError = null;
				data.iconUrl = null;
				data.iconDarkUrl = null;
				data.iconTone = null;
			}
		}

		try {
			const updated = await this.db.company.update({
				where: { id },
				data,
				select: { id: true, name: true, domain: true },
			});

			if (data.enrichmentStatus === "PENDING") {
				await this.agent.companyCreated(
					id,
					"Domain changed — anything we knew was about a different company",
				);
				void this.favicon.backfill(id, updated.domain);
			}

			return updated;
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	async delete(
		id: string,
		actingUserId?: string,
	): Promise<{ id: string; name: string }> {
		if (actingUserId) await assertCompanyAccess(this.db, actingUserId, id);
		let deleted: { targets: StampTargets; name: string };

		try {
			deleted = await this.db.$transaction(async (tx) => {
				const targets = await this.stamp.targetsOf(
					{ OR: [{ companyId: id }, { deal: { companyId: id } }] },
					tx,
				);

				await tx.agentTask.deleteMany({ where: { companyId: id } });

				const company = await tx.company.delete({
					where: { id },
					select: { name: true },
				});

				return { targets, name: company.name };
			});
		} catch (error) {
			throw this.translate(error, id);
		}

		await this.stamp.recomputeAfterDelete(deleted.targets, { companyId: id });

		this.logger.log({
			message: "Company deleted",
			companyId: id,
			name: deleted.name,
		});

		return { id, name: deleted.name };
	}

	async duplicates() {
		const rows = await this.db.company.findMany({
			where: { domain: { not: null } },
			select: {
				id: true,
				name: true,
				domain: true,
				_count: {
					select: { contacts: true, deals: true, emailThreads: true },
				},
			},
		});

		const groups = new Map<string, typeof rows>();
		for (const row of rows) {
			const root = rootDomain(row.domain);
			if (!root) continue;
			const members = groups.get(root) ?? [];
			members.push(row);
			groups.set(root, members);
		}

		return [...groups.entries()]
			.filter(([, members]) => members.length > 1)
			.map(([root, members]) => ({
				root,
				members: members
					.map((member) => ({
						id: member.id,
						name: member.name,
						domain: member.domain,
						contacts: member._count.contacts,
						deals: member._count.deals,
						threads: member._count.emailThreads,
						records:
							member._count.contacts +
							member._count.deals +
							member._count.emailThreads,
					}))
					.sort((a, b) => b.records - a.records),
			}))
			.sort((a, b) => b.members.length - a.members.length);
	}

	async merge(keepId: string, mergeId: string, actingUserId: string) {
		if (keepId === mergeId) {
			throw new BadRequestException("Choose two different companies to merge.");
		}
		await assertCompanyAccess(this.db, actingUserId, keepId);
		await assertCompanyAccess(this.db, actingUserId, mergeId);

		const result = await this.db.$transaction(async (tx) => {
			const include = { enrichment: { select: { companyId: true } } } as const;
			const [keep, merge] = await Promise.all([
				tx.company.findUnique({ where: { id: keepId }, include }),
				tx.company.findUnique({ where: { id: mergeId }, include }),
			]);
			if (!keep) throw new NotFoundException(`No company with id ${keepId}.`);
			if (!merge) {
				throw new NotFoundException(`No company with id ${mergeId}.`);
			}

			await tx.contact.updateMany({
				where: { companyId: mergeId },
				data: { companyId: keepId },
			});
			await tx.deal.updateMany({
				where: { companyId: mergeId },
				data: { companyId: keepId },
			});
			await tx.activity.updateMany({
				where: { companyId: mergeId },
				data: { companyId: keepId },
			});
			await tx.emailThread.updateMany({
				where: { companyId: mergeId },
				data: { companyId: keepId },
			});
			await tx.calendarEvent.updateMany({
				where: { companyId: mergeId },
				data: { companyId: keepId },
			});
			await tx.agentConversation.updateMany({
				where: { companyId: mergeId },
				data: { companyId: keepId },
			});
			await tx.agentTask.updateMany({
				where: { companyId: mergeId },
				data: { companyId: keepId },
			});

			if (!keep.enrichment && merge.enrichment) {
				await tx.companyEnrichment.update({
					where: { companyId: mergeId },
					data: { companyId: keepId },
				});
			}

			const data: Prisma.CompanyUpdateInput = {};
			for (const field of MERGE_ADOPTABLE) {
				const incoming = merge[field];
				if (keep[field] === null && incoming !== null) {
					(data as Record<string, string>)[field] = incoming;
				}
			}
			if (keep.customerType === "LEAD" && merge.customerType !== "LEAD") {
				data.customerType = merge.customerType;
			}
			const lastActivityAt =
				keep.lastActivityAt && merge.lastActivityAt
					? keep.lastActivityAt > merge.lastActivityAt
						? keep.lastActivityAt
						: merge.lastActivityAt
					: (keep.lastActivityAt ?? merge.lastActivityAt);
			data.lastActivityAt = lastActivityAt;

			await tx.company.update({
				where: { id: mergeId },
				data: { domain: null, primaryContactId: null },
			});
			if (keep.primaryContactId === null && merge.primaryContactId !== null) {
				data.primaryContact = { connect: { id: merge.primaryContactId } };
			}
			await tx.company.update({ where: { id: keepId }, data });
			await tx.company.delete({ where: { id: mergeId } });

			return { keepName: keep.name, mergedName: merge.name };
		});

		this.logger.log({
			message: "Company merged",
			keepId,
			mergeId,
			mergedName: result.mergedName,
		});

		return { id: keepId, name: result.keepName, merged: result.mergedName };
	}

	async enrich(
		id: string,
		actingUserId?: string,
	): Promise<{ id: string; queued: boolean }> {
		if (actingUserId) await assertCompanyAccess(this.db, actingUserId, id);
		const company = await this.db.company.findUnique({
			where: { id },
			select: { id: true },
		});

		if (!company) {
			throw new NotFoundException(`No company with id ${id}.`);
		}

		await this.db.company.update({
			where: { id },
			data: { enrichmentStatus: "PENDING", enrichmentError: null },
		});
		await this.agent.companyRequested(id, "A rep asked for a fresh look");

		return { id, queued: true };
	}

	async research(id: string, actingUserId: string) {
		await assertCompanyAccess(this.db, actingUserId, id);
		const company = await this.db.company.findUnique({
			where: { id },
			select: { id: true, domain: true },
		});

		if (!company) {
			throw new NotFoundException(`No company with id ${id}.`);
		}

		if (!company.domain) {
			throw new BadRequestException(
				"There is nothing to read without a domain — add one first.",
			);
		}

		await this.agent.companyRequested(
			id,
			`Briefing requested by a rep (${actingUserId})`,
		);

		return { ok: true as const, queued: true as const };
	}

	async setPrimaryContact(
		companyId: string,
		contactId: string | null,
		actingUserId?: string,
	) {
		if (actingUserId) {
			await assertCompanyAccess(this.db, actingUserId, companyId);
			if (contactId) {
				await assertContactAccess(this.db, actingUserId, contactId);
			}
		}
		if (contactId) {
			const contact = await this.db.contact.findUnique({
				where: { id: contactId },
				select: { companyId: true },
			});
			if (!contact) {
				throw new NotFoundException(`No contact with id ${contactId}.`);
			}
			if (contact.companyId !== companyId) {
				throw new BadRequestException(
					"That contact does not work at this company.",
				);
			}
		}

		try {
			return await this.db.company.update({
				where: { id: companyId },
				data: { primaryContactId: contactId },
				select: { id: true, primaryContactId: true },
			});
		} catch (error) {
			throw this.translate(error, companyId);
		}
	}

	private searchFilter(q: string): Prisma.CompanyWhereInput {
		const term = q.trim();
		if (!term) return {};

		return {
			OR: [
				{ name: { contains: term, mode: "insensitive" } },
				{ domain: { contains: term, mode: "insensitive" } },
			],
		};
	}

	private buildWhere(input: CompanyListInput): Prisma.CompanyWhereInput {
		const where: Prisma.CompanyWhereInput = {
			...this.searchFilter(input.q),
			...ownerFilter(input.owner),
		};

		if (input.industry !== FACET_ALL) {
			where.industry = input.industry;
		}

		if (input.customerType !== FACET_ALL) {
			where.customerType = input.customerType as
				| "LEAD"
				| "BUYER"
				| "DISTRIBUTOR"
				| "AGENT"
				| "CUSTOMER";
		}

		if (input.enrichment !== FACET_ALL) {
			where.enrichmentStatus = input.enrichment as EnrichmentStatus;
		}

		if (input.source !== FACET_ALL) {
			where.source = input.source as RecordSource;
		}

		return where;
	}

	private async facetCounts(input: CompanyListInput) {
		const where = this.searchFilter(input.q);

		const [owners, industries, customerTypes, enrichment, sources] =
			await Promise.all([
				this.db.company.groupBy({
					by: ["ownerId"],
					where,
					_count: { _all: true },
				}),
				this.db.company.groupBy({
					by: ["industry"],
					where,
					_count: { _all: true },
				}),
				this.db.company.groupBy({
					by: ["customerType"],
					where,
					_count: { _all: true },
				}),
				this.db.company.groupBy({
					by: ["enrichmentStatus"],
					where,
					_count: { _all: true },
				}),
				this.db.company.groupBy({
					by: ["source"],
					where,
					_count: { _all: true },
				}),
			]);

		return {
			owner: countsByKey(owners, "ownerId", FACET_UNASSIGNED),
			industry: countsByKey(industries, "industry"),
			customerType: countsByKey(customerTypes, "customerType"),
			enrichment: countsByKey(enrichment, "enrichmentStatus"),
			source: countsByKey(sources, "source"),
		};
	}

	private translate(error: unknown, id: string): unknown {
		if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
			if (error.code === "P2025") {
				return new NotFoundException(`No company with id ${id}.`);
			}
			if (error.code === "P2002") {
				return new ConflictException(
					"Another company already uses that domain.",
				);
			}
		}
		return error;
	}
}
