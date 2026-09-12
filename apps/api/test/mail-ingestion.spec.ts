import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { EmailDirection } from "@crm/db";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import {
	MailIngestionService,
	type NormalizedMailMessage,
} from "../src/mail/mail-ingestion.service";

const NOOP_AGENT = {
	mailReceived: async () => undefined,
	inquiryChanged: async () => undefined,
} as never;

type IngestionState = {
	threadCreate?: Record<string, unknown>;
	messageCreate?: Record<string, unknown>;
	messageSync?: Record<string, unknown>;
	messageUpdate?: Record<string, unknown>;
	attachmentCreates?: Record<string, unknown>[];
	activityCreate?: Record<string, unknown>;
};

function ingestionDb(
	state: IngestionState,
	existingMessage?: {
		id: string;
		threadId: string;
		bodyHtml: string | null;
		attachmentCount: number;
	},
	racesOnCreate = false,
	knownContact?: { id: string; email: string; companyId: string },
	filedThread?: { companyId: string; contactId: string | null },
	inquiries: string[] = [],
): Db {
	let messageLookups = 0;
	return {
		user: { findMany: async () => [] },
		zohoMailbox: { findMany: async () => [] },
		suppressedDomain: { findMany: async () => [] },
		suppressedContact: { findMany: async () => [] },
		contact: {
			findMany: async () => (knownContact ? [knownContact] : []),
			findFirst: async () => knownContact ?? null,
			updateMany: async () => ({ count: knownContact ? 1 : 0 }),
		},
		company: {
			findMany: async () => [],
			updateMany: async () => ({ count: knownContact ? 1 : 0 }),
		},
		deal: {
			findMany: async () => inquiries.map((id) => ({ id })),
			updateMany: async () => ({ count: inquiries.length }),
		},
		emailMessage: {
			findUnique: async () => {
				messageLookups += 1;
				if (!existingMessage || (racesOnCreate && messageLookups === 1)) {
					return null;
				}
				return {
					id: existingMessage.id,
					threadId: existingMessage.threadId,
					bodyHtml: existingMessage.bodyHtml,
					_count: { attachments: existingMessage.attachmentCount },
					thread: { companyId: null, contactId: null },
				};
			},
			findFirst: async () => null,
			create: async (args: { data: Record<string, unknown> }) => {
				state.messageCreate = args.data;
				if (racesOnCreate) throw { code: "P2002" };
				return { id: "message-1" };
			},
			update: async (args: { data: Record<string, unknown> }) => {
				state.messageUpdate = args.data;
				return { id: existingMessage?.id ?? "message-1" };
			},
			aggregate: async () => ({
				_count: { _all: 1 },
				_min: { sentAt: new Date("2026-08-24T10:00:00.000Z") },
				_max: { sentAt: new Date("2026-08-24T10:00:00.000Z") },
			}),
		},
		emailMessageSync: {
			createMany: async (args: { data: Record<string, unknown> }) => {
				state.messageSync = args.data;
				return { count: 1 };
			},
		},
		emailAttachment: {
			createMany: async (args: { data: Record<string, unknown>[] }) => {
				state.attachmentCreates = args.data;
				return { count: args.data.length };
			},
		},
		emailThread: {
			findUnique: async () =>
				filedThread
					? {
							id: "thread-1",
							companyId: filedThread.companyId,
							contactId: filedThread.contactId,
							activity: { dealId: null },
						}
					: null,
			upsert: async (args: { create: Record<string, unknown> }) => {
				state.threadCreate = args.create;
				return { id: "thread-1" };
			},
			update: async () => ({ id: "thread-1" }),
		},
		activity: {
			upsert: async (args: { create: Record<string, unknown> }) => {
				state.activityCreate = args.create;
				return { id: "activity-1" };
			},
		},
	} as unknown as Db;
}

function message(): NormalizedMailMessage {
	return {
		rfcMessageId: "buyer-1@example.test",
		rootMessageId: "buyer-1@example.test",
		subject: "New glass inquiry",
		from: { email: "buyer@gmail.com", name: "Buyer" },
		recipients: [{ email: "sales@example.test", name: null, kind: "to" }],
		body: "Please quote 500 tumblers.",
		bodyHtml: null,
		sentAt: new Date("2026-08-24T10:00:00.000Z"),
		direction: EmailDirection.INBOUND,
		providerMessageId: "gmail-1",
		folderId: null,
		isRead: false,
		starred: false,
		attachments: [],
	};
}

describe("mailbox ingestion", () => {
	it("stores an unmatched Gmail message for later filing", async () => {
		const state: IngestionState = {};
		let reported: Record<string, unknown> | undefined;
		const db = ingestionDb(state);
		const ingestion = new MailIngestionService(
			db,
			new ActivityStampService(db),
			{
				mailReceived: async (input: Record<string, unknown>) => {
					reported = input;
				},
			} as never,
		);
		const mailbox = await ingestion.forMailbox({
			source: "gmail",
			userId: "member-1",
			mailboxAddress: "sales@example.test",
			autoCreate: false,
		});

		const result = await mailbox.ingest(message());

		expect(result).toEqual({
			status: "written",
			threadId: "thread-1",
			messageId: "message-1",
			linked: false,
		});
		expect(state.threadCreate).toMatchObject({
			rootMessageId: "buyer-1@example.test",
			companyId: null,
			contactId: null,
		});
		expect(state.messageCreate).toMatchObject({
			threadId: "thread-1",
			rfcMessageId: "buyer-1@example.test",
			gmailMessageId: "gmail-1",
			direction: EmailDirection.INBOUND,
		});
		expect(state.activityCreate).toMatchObject({
			emailThreadId: "thread-1",
			companyId: null,
			contactId: null,
		});
		expect(reported).toEqual({
			threadId: "thread-1",
			userId: "member-1",
			allowCreate: false,
		});
	});

	it("merges richer Zoho data into a message already stored by Gmail", async () => {
		const state: IngestionState = {};
		const db = ingestionDb(state, {
			id: "message-1",
			threadId: "thread-1",
			bodyHtml: null,
			attachmentCount: 0,
		});
		const ingestion = new MailIngestionService(
			db,
			new ActivityStampService(db),
			NOOP_AGENT,
		);
		const mailbox = await ingestion.forMailbox({
			source: "zoho",
			userId: "member-1",
			mailboxAddress: "sales@example.test",
			autoCreate: false,
		});

		const result = await mailbox.ingest({
			...message(),
			bodyHtml: "<p>Please quote 500 tumblers.</p>",
			providerMessageId: "42",
			folderId: "inbox-folder",
			attachments: [
				{
					filename: "drawing.pdf",
					mimeType: "application/pdf",
					size: 7,
					content: Buffer.from("drawing"),
					contentId: null,
				},
			],
		});

		expect(result).toEqual({
			status: "existing",
			threadId: "thread-1",
			messageId: "message-1",
			linked: false,
		});
		expect(state.messageCreate).toBeUndefined();
		expect(state.messageSync).toEqual({
			messageId: "message-1",
			userId: "member-1",
			source: "zoho",
		});
		expect(state.messageUpdate).toEqual({
			bodyHtml: "<p>Please quote 500 tumblers.</p>",
			zohoMessageId: "42",
			zohoMailboxFolderId: "inbox-folder",
		});
		expect(state.attachmentCreates).toHaveLength(1);
	});

	it("stores attachments on the first provider write", async () => {
		const state: IngestionState = {};
		const db = ingestionDb(state);
		const ingestion = new MailIngestionService(
			db,
			new ActivityStampService(db),
			NOOP_AGENT,
		);
		const mailbox = await ingestion.forMailbox({
			source: "zoho",
			userId: "member-1",
			mailboxAddress: "sales@example.test",
			autoCreate: false,
		});

		await mailbox.ingest({
			...message(),
			providerMessageId: "43",
			folderId: "inbox-folder",
			attachments: [
				{
					filename: "specification.pdf",
					mimeType: "application/pdf",
					size: 13,
					content: Buffer.from("specification"),
					contentId: null,
				},
			],
		});

		expect(state.attachmentCreates).toEqual([
			expect.objectContaining({
				messageId: "message-1",
				filename: "specification.pdf",
			}),
		]);
	});

	it("joins the winner when two providers store the same message", async () => {
		const state: IngestionState = {};
		const db = ingestionDb(
			state,
			{
				id: "winning-message",
				threadId: "thread-1",
				bodyHtml: null,
				attachmentCount: 0,
			},
			true,
		);
		const ingestion = new MailIngestionService(
			db,
			new ActivityStampService(db),
			NOOP_AGENT,
		);
		const mailbox = await ingestion.forMailbox({
			source: "zoho",
			userId: "member-1",
			mailboxAddress: "sales@example.test",
			autoCreate: false,
		});

		const result = await mailbox.ingest(message());

		expect(result).toMatchObject({
			status: "existing",
			messageId: "winning-message",
		});
		expect(state.messageSync).toEqual({
			messageId: "winning-message",
			userId: "member-1",
			source: "zoho",
		});
	});

	it("leaves identity interpretation to the Agent", async () => {
		const state: IngestionState = {};
		let reported: Record<string, unknown> | undefined;
		const db = ingestionDb(state, undefined, false, {
			id: "contact-1",
			email: "buyer@gmail.com",
			companyId: "company-1",
		});
		const ingestion = new MailIngestionService(
			db,
			new ActivityStampService(db),
			{
				mailReceived: async (input: Record<string, unknown>) => {
					reported = input;
				},
			} as never,
		);
		const mailbox = await ingestion.forMailbox({
			source: "gmail",
			userId: "member-1",
			mailboxAddress: "sales@example.test",
			autoCreate: false,
		});

		const result = await mailbox.ingest({
			...message(),
			body: "Regarding INQ-2026-001, please confirm the price.",
		});

		expect(result.linked).toBe(false);
		expect(state.activityCreate).toMatchObject({
			companyId: null,
			contactId: null,
		});
		expect(reported).toMatchObject({ threadId: "thread-1" });
	});

	it("links a filed thread's message to the inquiry its INQ number names", async () => {
		const state: IngestionState = {};
		let reported: Record<string, unknown> | undefined;
		const db = ingestionDb(
			state,
			undefined,
			false,
			undefined,
			{ companyId: "company-1", contactId: "contact-1" },
			["inquiry-1"],
		);
		const ingestion = new MailIngestionService(
			db,
			new ActivityStampService(db),
			{
				mailReceived: async (input: Record<string, unknown>) => {
					reported = input;
				},
				inquiryChanged: async () => undefined,
			} as never,
		);
		const mailbox = await ingestion.forMailbox({
			source: "gmail",
			userId: "member-1",
			mailboxAddress: "sales@example.test",
			autoCreate: false,
		});

		const result = await mailbox.ingest({
			...message(),
			body: "Regarding INQ-2026-001, please confirm the price.",
		});

		expect(result.linked).toBe(true);
		expect(state.activityCreate).toMatchObject({
			companyId: "company-1",
			contactId: "contact-1",
			dealId: "inquiry-1",
		});
		expect(reported).toBeUndefined();
	});

	it("leaves the inquiry unset when the INQ number is ambiguous", async () => {
		const state: IngestionState = {};
		const db = ingestionDb(
			state,
			undefined,
			false,
			undefined,
			{ companyId: "company-1", contactId: "contact-1" },
			["inquiry-1", "inquiry-2"],
		);
		const ingestion = new MailIngestionService(
			db,
			new ActivityStampService(db),
			NOOP_AGENT,
		);
		const mailbox = await ingestion.forMailbox({
			source: "gmail",
			userId: "member-1",
			mailboxAddress: "sales@example.test",
			autoCreate: false,
		});

		const result = await mailbox.ingest({
			...message(),
			body: "Regarding INQ-2026-001, please confirm the price.",
		});

		expect(result.linked).toBe(true);
		expect(state.activityCreate).toMatchObject({
			companyId: "company-1",
			dealId: null,
		});
	});
});
