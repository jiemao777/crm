import { ActivityType, type Db, type Prisma } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { OPEN_INQUIRY_STAGES } from "../deals/deal-stage";

const STALE_INQUIRY_DAYS = 5;
const QUOTE_EXPIRING_DAYS = 3;
const QUOTE_EXPIRED_GRACE_DAYS = 1;
const SAMPLE_FOLLOW_UP_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

const REMINDER_STALE = "stale-inquiry";
const REMINDER_QUOTE = "quote-expiring";
const REMINDER_SAMPLE = "sample-follow-up";

@Injectable()
export class RemindersService {
	private readonly logger = new Logger(RemindersService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async runDue(now = new Date()) {
		const staleCutoff = new Date(now.getTime() - STALE_INQUIRY_DAYS * DAY_MS);
		const quoteHorizon = new Date(now.getTime() + QUOTE_EXPIRING_DAYS * DAY_MS);
		const quoteFloor = new Date(
			now.getTime() - QUOTE_EXPIRED_GRACE_DAYS * DAY_MS,
		);
		const sampleCutoff = new Date(
			now.getTime() - SAMPLE_FOLLOW_UP_DAYS * DAY_MS,
		);

		const [
			staleDeals,
			expiringQuotes,
			deliveredSamples,
			recentStale,
			reminded,
		] = await Promise.all([
			this.db.deal.findMany({
				where: {
					stage: { in: [...OPEN_INQUIRY_STAGES] },
					OR: [
						{ lastActivityAt: { lt: staleCutoff } },
						{ lastActivityAt: null, createdAt: { lt: staleCutoff } },
					],
				},
				select: {
					id: true,
					name: true,
					ownerId: true,
					companyId: true,
					lastActivityAt: true,
					createdAt: true,
				},
			}),
			this.db.quotation.findMany({
				where: {
					status: "SENT",
					validUntil: { gte: quoteFloor, lte: quoteHorizon },
				},
				select: {
					id: true,
					quoteNumber: true,
					validUntil: true,
					dealId: true,
					deal: {
						select: { name: true, ownerId: true, companyId: true },
					},
				},
			}),
			this.db.sample.findMany({
				where: {
					status: "DELIVERED",
					deliveredAt: { lte: sampleCutoff },
				},
				select: {
					id: true,
					product: true,
					deliveredAt: true,
					dealId: true,
					deal: {
						select: { name: true, ownerId: true, companyId: true },
					},
				},
			}),
			this.db.activity.findMany({
				where: {
					type: ActivityType.TASK,
					createdAt: { gt: staleCutoff },
					meta: { path: ["reminder"], equals: REMINDER_STALE },
				},
				select: { dealId: true },
			}),
			this.db.activity.findMany({
				where: {
					type: ActivityType.TASK,
					OR: [
						{ meta: { path: ["reminder"], equals: REMINDER_QUOTE } },
						{ meta: { path: ["reminder"], equals: REMINDER_SAMPLE } },
					],
				},
				select: { meta: true },
			}),
		]);

		const remindedDeals = new Set(recentStale.map((row) => row.dealId));
		const remindedQuotes = new Set<string>();
		const remindedSamples = new Set<string>();
		for (const row of reminded) {
			const meta = row.meta as Record<string, unknown> | null;
			if (
				meta?.reminder === REMINDER_QUOTE &&
				typeof meta.quotationId === "string"
			) {
				remindedQuotes.add(meta.quotationId);
			}
			if (
				meta?.reminder === REMINDER_SAMPLE &&
				typeof meta.sampleId === "string"
			) {
				remindedSamples.add(meta.sampleId);
			}
		}

		const tasks: Prisma.ActivityCreateManyInput[] = [];

		for (const deal of staleDeals) {
			if (remindedDeals.has(deal.id)) continue;
			const idleDays = Math.floor(
				(now.getTime() - (deal.lastActivityAt ?? deal.createdAt).getTime()) /
					DAY_MS,
			);
			tasks.push({
				type: ActivityType.TASK,
				subject: `Follow up "${deal.name}" — no activity for ${idleDays} days`,
				dueAt: now,
				companyId: deal.companyId,
				dealId: deal.id,
				createdById: deal.ownerId,
				meta: { reminder: REMINDER_STALE, idleDays },
			});
		}

		for (const quote of expiringQuotes) {
			if (remindedQuotes.has(quote.id) || !quote.validUntil) continue;
			tasks.push({
				type: ActivityType.TASK,
				subject: `Quotation ${quote.quoteNumber} (${quote.deal.name}) expires ${quote.validUntil.toISOString().slice(0, 10)}`,
				dueAt: quote.validUntil,
				companyId: quote.deal.companyId,
				dealId: quote.dealId,
				createdById: quote.deal.ownerId,
				meta: { reminder: REMINDER_QUOTE, quotationId: quote.id },
			});
		}

		for (const sample of deliveredSamples) {
			if (remindedSamples.has(sample.id) || !sample.deliveredAt) continue;
			const days = Math.floor(
				(now.getTime() - sample.deliveredAt.getTime()) / DAY_MS,
			);
			tasks.push({
				type: ActivityType.TASK,
				subject: `Sample "${sample.product}" delivered ${days} days ago — ask for feedback`,
				dueAt: now,
				companyId: sample.deal.companyId,
				dealId: sample.dealId,
				createdById: sample.deal.ownerId,
				meta: { reminder: REMINDER_SAMPLE, sampleId: sample.id },
			});
		}

		if (tasks.length > 0) {
			await this.db.activity.createMany({ data: tasks });
		}

		this.logger.log({
			message: "Reminder sweep finished",
			created: tasks.length,
			staleCandidates: staleDeals.length,
			quoteCandidates: expiringQuotes.length,
			sampleCandidates: deliveredSamples.length,
		});

		return {
			created: tasks.length,
			candidates: {
				stale: staleDeals.length,
				quotes: expiringQuotes.length,
				samples: deliveredSamples.length,
			},
		};
	}
}
