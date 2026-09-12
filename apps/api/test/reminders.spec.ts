import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { RemindersService } from "../src/reminders/reminders.service";

const NOW = new Date("2026-08-29T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function remindersDb(options: {
	deals?: unknown[];
	quotes?: unknown[];
	samples?: unknown[];
	recentStaleDealIds?: string[];
	remindedMeta?: Record<string, unknown>[];
}): { db: Db; created: () => Record<string, unknown>[] } {
	const created: Record<string, unknown>[] = [];
	const db = {
		deal: { findMany: async () => options.deals ?? [] },
		quotation: { findMany: async () => options.quotes ?? [] },
		sample: { findMany: async () => options.samples ?? [] },
		activity: {
			findMany: async (args: {
				where: { createdAt?: unknown; meta?: { equals?: unknown } };
			}) => {
				if (args.where.meta?.equals === "stale-inquiry") {
					return (options.recentStaleDealIds ?? []).map((dealId) => ({
						dealId,
					}));
				}
				return (options.remindedMeta ?? []).map((meta) => ({ meta }));
			},
			createMany: async (args: { data: Record<string, unknown>[] }) => {
				created.push(...args.data);
				return { count: args.data.length };
			},
		},
	} as unknown as Db;
	return { db, created: () => created };
}

describe("reminders", () => {
	it("creates a follow-up task for a stale open inquiry", async () => {
		const { db, created } = remindersDb({
			deals: [
				{
					id: "deal-1",
					name: "Tumblers RFQ",
					ownerId: "user-1",
					companyId: "company-1",
					lastActivityAt: new Date(NOW.getTime() - 9 * DAY),
					createdAt: new Date(NOW.getTime() - 20 * DAY),
				},
			],
		});
		const service = new RemindersService(db);

		const result = await service.runDue(NOW);

		expect(result.created).toBe(1);
		expect(created()[0]).toMatchObject({
			type: "TASK",
			dealId: "deal-1",
			companyId: "company-1",
			createdById: "user-1",
			meta: { reminder: "stale-inquiry", idleDays: 9 },
		});
		expect(String(created()[0]?.subject)).toContain("9 days");
	});

	it("does not re-remind a deal touched by a reminder within the window", async () => {
		const { db, created } = remindersDb({
			deals: [
				{
					id: "deal-1",
					name: "Tumblers RFQ",
					ownerId: "user-1",
					companyId: "company-1",
					lastActivityAt: new Date(NOW.getTime() - 9 * DAY),
					createdAt: new Date(NOW.getTime() - 20 * DAY),
				},
			],
			recentStaleDealIds: ["deal-1"],
		});
		const service = new RemindersService(db);

		const result = await service.runDue(NOW);

		expect(result.created).toBe(0);
		expect(created()).toHaveLength(0);
	});

	it("creates a quote-expiry task due at the quote's validUntil, once per quote", async () => {
		const validUntil = new Date(NOW.getTime() + 2 * DAY);
		const quote = {
			id: "quote-1",
			quoteNumber: "QT-1",
			validUntil,
			dealId: "deal-1",
			deal: { name: "Tumblers RFQ", ownerId: "user-1", companyId: "company-1" },
		};
		const { db, created } = remindersDb({ quotes: [quote] });
		const service = new RemindersService(db);

		const result = await service.runDue(NOW);

		expect(result.created).toBe(1);
		expect(created()[0]).toMatchObject({
			dealId: "deal-1",
			dueAt: validUntil,
			meta: { reminder: "quote-expiring", quotationId: "quote-1" },
		});

		const again = remindersDb({
			quotes: [quote],
			remindedMeta: [{ reminder: "quote-expiring", quotationId: "quote-1" }],
		});
		const second = new RemindersService(again.db);
		expect((await second.runDue(NOW)).created).toBe(0);
	});

	it("creates a sample follow-up task three days after delivery, once per sample", async () => {
		const sample = {
			id: "sample-1",
			product: "Glass tumbler",
			deliveredAt: new Date(NOW.getTime() - 4 * DAY),
			dealId: "deal-1",
			deal: { name: "Tumblers RFQ", ownerId: "user-1", companyId: "company-1" },
		};
		const { db, created } = remindersDb({ samples: [sample] });
		const service = new RemindersService(db);

		const result = await service.runDue(NOW);

		expect(result.created).toBe(1);
		expect(created()[0]).toMatchObject({
			meta: { reminder: "sample-follow-up", sampleId: "sample-1" },
		});
		expect(String(created()[0]?.subject)).toContain("4 days");

		const again = remindersDb({
			samples: [sample],
			remindedMeta: [{ reminder: "sample-follow-up", sampleId: "sample-1" }],
		});
		const second = new RemindersService(again.db);
		expect((await second.runDue(NOW)).created).toBe(0);
	});
});
