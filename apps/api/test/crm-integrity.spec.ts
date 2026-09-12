import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureWorkspaceMembership } from "@crm/auth";
import { ActivityType, db, EmailDirection } from "@crm/db";
import { AgentQueueService } from "../src/agent/agent-queue.service";
import { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { AiExtractService } from "../src/agent/ai-extract.service";
import { CompaniesService } from "../src/companies/companies.service";
import { CompanyDirectoryService } from "../src/companies/company-directory.service";
import { FaviconService } from "../src/companies/favicon.service";
import { ContactsService } from "../src/contacts/contacts.service";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { DealsService } from "../src/deals/deals.service";
import { GoogleConnectionService } from "../src/google/google-connection.service";

const suffix = process.env.TEST_RUN_ID ?? "crm-integrity-spec";
const existingDomain = `existing-${suffix}.test`;
const concurrentCompanyDomain = `concurrent-${suffix}.test`;
const concurrentContactEmail = `contact-${suffix}@gmail.com`;
const existingContactEmail = `existing-${suffix}@gmail.com`;
const quotationDomain = `quotation-${suffix}.test`;
const conversionDomain = `conversion-${suffix}.test`;
const threadRoot = `<root-${suffix}@example.test>`;
const sharedThreadRoot = `<shared-root-${suffix}@example.test>`;
const sharedCalendarUid = `shared-calendar-${suffix}@example.test`;
const userA = `integrity-a-${suffix}`;
const userB = `integrity-b-${suffix}`;

const agent = {
	contactCreated: async () => undefined,
	companyCreated: async () => undefined,
	companyRequested: async () => undefined,
} as unknown as AgentTriggerService;

const stamp = new ActivityStampService(db);
const directory = new CompanyDirectoryService(db, agent);
const queue = new AgentQueueService(db);
const contacts = new ContactsService(db, directory, agent, queue, stamp);
const companies = new CompaniesService(
	db,
	agent,
	queue,
	{ backfill: async () => undefined } as unknown as FaviconService,
	stamp,
	{ extract: async () => null } as unknown as AiExtractService,
);
const deals = new DealsService(db, stamp);
const google = new GoogleConnectionService(
	db,
	{} as never,
	{} as never,
	{} as never,
	{ recomputeAll: async () => undefined } as never,
);

async function clean() {
	await db.emailThread.deleteMany({
		where: { rootMessageId: { in: [threadRoot, sharedThreadRoot] } },
	});
	await db.calendarEvent.deleteMany({ where: { iCalUid: sharedCalendarUid } });
	await db.company.deleteMany({
		where: {
			domain: {
				in: [
					existingDomain,
					concurrentCompanyDomain,
					quotationDomain,
					conversionDomain,
				],
			},
		},
	});
	await db.contact.deleteMany({
		where: {
			OR: [{ email: existingContactEmail }, { email: concurrentContactEmail }],
		},
	});
	await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
}

beforeAll(async () => {
	await clean();
	await db.user.createMany({
		data: [
			{ id: userA, name: "Integrity A", email: `${userA}@example.test` },
			{ id: userB, name: "Integrity B", email: `${userB}@example.test` },
		],
	});
	await ensureWorkspaceMembership(userA);
});

afterAll(clean);

describe("CRM write integrity", () => {
	it("connects an existing contact without creating a duplicate company or contact", async () => {
		const email = existingContactEmail;
		const contact = await contacts.create({ firstName: "Existing", email });
		const company = await companies.create({
			name: "Existing Company",
			domain: existingDomain,
			contact: { firstName: "Existing", email },
		});

		const stored = await db.contact.findUnique({
			where: { id: contact.id },
			select: { companyId: true },
		});
		const linked = await db.company.findUnique({
			where: { id: company.id },
			select: { primaryContactId: true },
		});

		expect(stored).toEqual({ companyId: company.id });
		expect(linked).toEqual({ primaryContactId: contact.id });
		expect(await db.contact.count({ where: { email } })).toBe(1);
		expect(await db.company.count({ where: { domain: existingDomain } })).toBe(
			1,
		);
	});

	it("translates concurrent company and contact uniqueness races", async () => {
		const companiesCreated = await Promise.allSettled(
			["One", "Two"].map((name) =>
				companies.create({ name, domain: concurrentCompanyDomain }),
			),
		);
		const contactsCreated = await Promise.allSettled(
			["One", "Two"].map((firstName) =>
				contacts.create({ firstName, email: concurrentContactEmail }),
			),
		);

		expect(
			companiesCreated.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			companiesCreated.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		expect(
			contactsCreated.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			contactsCreated.filter((result) => result.status === "rejected"),
		).toHaveLength(1);
		expect(
			await db.company.count({ where: { domain: concurrentCompanyDomain } }),
		).toBe(1);
		expect(
			await db.contact.count({ where: { email: concurrentContactEmail } }),
		).toBe(1);
	});

	it("serializes quotation versions under concurrent writes", async () => {
		const company = await db.company.create({
			data: { name: "Quotation Company", domain: quotationDomain },
			select: { id: true },
		});
		const deal = await db.deal.create({
			data: {
				name: "Quotation Inquiry",
				companyId: company.id,
				ownerId: userA,
			},
			select: { id: true },
		});
		const input = {
			dealId: deal.id,
			items: [
				{
					productName: "Widget",
					quantity: 1,
					unitPriceCents: 100,
				},
			],
		};

		const created = await Promise.all(
			Array.from({ length: 5 }, () => deals.createQuotation(input, userA)),
		);
		const versions = created
			.map((quotation) => quotation.version)
			.sort((a, b) => a - b);

		expect(versions).toEqual([1, 2, 3, 4, 5]);
		expect(await db.quotation.count({ where: { dealId: deal.id } })).toBe(5);
	});

	it("converts a quotation to a proforma invoice once, items and all", async () => {
		const company = await db.company.create({
			data: { name: "Conversion Company", domain: conversionDomain },
			select: { id: true },
		});
		const deal = await db.deal.create({
			data: {
				name: "Conversion Inquiry",
				companyId: company.id,
				ownerId: userA,
			},
			select: { id: true },
		});
		const quotation = await deals.createQuotation(
			{
				dealId: deal.id,
				items: [
					{
						productName: "Tumbler",
						specification: "500ml",
						quantity: 500,
						unitPriceCents: 120,
					},
					{ productName: "Decanter", quantity: 100, unitPriceCents: 480 },
				],
			},
			userA,
		);

		const first = await deals.convertQuotationToOrder(quotation.id, userA);
		expect(first.created).toBe(true);

		const order = await db.salesOrder.findUniqueOrThrow({
			where: { id: first.id },
			include: { items: true },
		});
		expect(order.dealId).toBe(deal.id);
		expect(order.quotationId).toBe(quotation.id);
		expect(order.items).toHaveLength(2);
		expect(Number(order.totalAmount)).toBe(1080);

		const storedDeal = await db.deal.findUniqueOrThrow({
			where: { id: deal.id },
		});
		expect(storedDeal.stage).toBe("PROFORMA_INVOICE");

		const stageChange = await db.activity.findFirst({
			where: { dealId: deal.id, type: ActivityType.STAGE_CHANGE },
		});
		expect(stageChange?.createdById).toBe(userA);

		const again = await deals.convertQuotationToOrder(quotation.id, userA);
		expect(again).toMatchObject({ id: first.id, created: false });
		expect(await db.salesOrder.count({ where: { dealId: deal.id } })).toBe(1);
	});
});

describe("synced mail cleanup", () => {
	it("keeps a shared thread and another user's message", async () => {
		const first = new Date("2026-08-01T10:00:00.000Z");
		const second = new Date("2026-08-01T11:00:00.000Z");
		const thread = await db.emailThread.create({
			data: {
				rootMessageId: threadRoot,
				firstMessageAt: first,
				lastMessageAt: second,
				messageCount: 2,
			},
			select: { id: true },
		});
		await db.emailMessage.createMany({
			data: [
				{
					threadId: thread.id,
					rfcMessageId: `<a-${suffix}@example.test>`,
					syncedByUserId: userA,
					direction: EmailDirection.OUTBOUND,
					fromEmail: `${userA}@example.test`,
					recipients: [],
					sentAt: first,
				},
				{
					threadId: thread.id,
					rfcMessageId: `<b-${suffix}@example.test>`,
					syncedByUserId: userB,
					direction: EmailDirection.INBOUND,
					fromEmail: "customer@example.test",
					recipients: [],
					sentAt: second,
				},
			],
		});

		expect(await google.purgeSyncedData(userA)).toEqual({ purged: 1 });
		expect(
			await db.emailMessage.findMany({
				where: { threadId: thread.id },
				select: { syncedByUserId: true },
			}),
		).toEqual([{ syncedByUserId: userB }]);
		expect(
			await db.emailThread.findUnique({
				where: { id: thread.id },
				select: {
					messageCount: true,
					firstMessageAt: true,
					lastMessageAt: true,
				},
			}),
		).toEqual({
			messageCount: 1,
			firstMessageAt: second,
			lastMessageAt: second,
		});
	});

	it("keeps records that another user also synced", async () => {
		const sentAt = new Date("2026-08-02T10:00:00.000Z");
		const thread = await db.emailThread.create({
			data: {
				rootMessageId: sharedThreadRoot,
				firstMessageAt: sentAt,
				lastMessageAt: sentAt,
				messageCount: 1,
			},
			select: { id: true },
		});
		const message = await db.emailMessage.create({
			data: {
				threadId: thread.id,
				rfcMessageId: `<shared-${suffix}@example.test>`,
				syncedByUserId: userA,
				direction: EmailDirection.INBOUND,
				fromEmail: "customer@example.test",
				recipients: [],
				sentAt,
				syncs: {
					create: [
						{ userId: userA, source: "gmail" },
						{ userId: userB, source: "gmail" },
					],
				},
			},
			select: { id: true },
		});
		const event = await db.calendarEvent.create({
			data: {
				iCalUid: sharedCalendarUid,
				originalStartTime: sentAt,
				startsAt: sentAt,
				endsAt: new Date("2026-08-02T11:00:00.000Z"),
				status: "confirmed",
				syncedByUserId: userA,
				syncs: { create: [{ userId: userA }, { userId: userB }] },
			},
			select: { id: true },
		});

		expect(await google.purgeSyncedData(userA)).toEqual({ purged: 0 });
		expect(
			await db.emailMessage.findUnique({ where: { id: message.id } }),
		).not.toBeNull();
		expect(
			await db.calendarEvent.findUnique({ where: { id: event.id } }),
		).not.toBeNull();
		expect(
			await db.emailMessageSync.findMany({
				where: { messageId: message.id },
				select: { userId: true },
			}),
		).toEqual([{ userId: userB }]);
		expect(
			await db.calendarEventSync.findMany({
				where: { eventId: event.id },
				select: { userId: true },
			}),
		).toEqual([{ userId: userB }]);
	});
});
