import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ensureWorkspaceMembership } from "@crm/auth";
import { db, EmailDirection, EmailDraftStatus } from "@crm/db";
import { ActivityStampService } from "../src/crm/activity-stamp.service";
import { ConversationService } from "../src/google/conversation.service";
import {
	assertAttachmentSize,
	EmailDraftService,
	MAX_ATTACHMENT_BYTES,
	MAX_MESSAGE_BYTES,
} from "../src/google/email-draft.service";
import { MailLeadIntakeService } from "../src/mail/mail-lead-intake.service";
import type {
	ZohoMailDraft,
	ZohoMailSendResult,
} from "../src/zoho/zoho-smtp.service";
import { ZohoSmtpService } from "../src/zoho/zoho-smtp.service";

const suffix = `${process.env.TEST_RUN_ID ?? "mail-center-spec"}-${Date.now()}`;
const userId = `mail-center-user-${suffix}`;
const userEmail = `${userId}@example.test`;
const companyDomain = `mail-center-${suffix}.test`;
const recipientEmail = `recipient@${companyDomain}`;
const forwardedCustomerEmail = `buyer-${suffix}@gmail.com`;
const roots = [
	`mail-center-inbox-${suffix}`,
	`mail-center-linked-${suffix}`,
	`mail-center-trash-${suffix}`,
	`mail-center-outbound-${suffix}@example.test`,
	`mail-center-forwarded-${suffix}`,
];

let conversation: ConversationService;
let draftService: EmailDraftService;
let inboxThreadId = "";
let linkedThreadId = "";
let trashThreadId = "";
let forwardedThreadId = "";

async function clean(): Promise<void> {
	const forwardedContact = await db.contact.findUnique({
		where: { email: forwardedCustomerEmail },
		select: { companyId: true },
	});
	await db.emailThread.deleteMany({
		where: {
			OR: [
				{ rootMessageId: { in: roots } },
				{ messages: { some: { syncedByUserId: userId } } },
			],
		},
	});
	await db.contact.deleteMany({
		where: { email: { in: [recipientEmail, forwardedCustomerEmail] } },
	});
	if (forwardedContact?.companyId) {
		await db.company.delete({ where: { id: forwardedContact.companyId } });
	}
	await db.company.deleteMany({ where: { domain: companyDomain } });
	await db.user.deleteMany({ where: { id: userId } });
}

async function createThread(input: {
	root: string;
	subject: string;
	fromEmail: string;
	isRead: boolean;
	starred: boolean;
	deletedAt?: Date | null;
	companyId?: string | null;
}): Promise<string> {
	const sentAt = new Date("2026-08-07T08:00:00.000Z");
	const thread = await db.emailThread.create({
		data: {
			rootMessageId: input.root,
			subject: input.subject,
			companyId: input.companyId ?? null,
			firstMessageAt: sentAt,
			lastMessageAt: sentAt,
			messageCount: 1,
		},
		select: { id: true },
	});
	await db.emailMessage.create({
		data: {
			threadId: thread.id,
			rfcMessageId: `${input.root}@example.test`,
			syncedByUserId: userId,
			direction: EmailDirection.INBOUND,
			fromEmail: input.fromEmail,
			fromName: "Mail Center Test",
			recipients: [{ email: userEmail, name: null, kind: "to" }],
			subject: input.subject,
			snippet: input.subject,
			body: input.subject,
			sentAt,
			isRead: input.isRead,
			starred: input.starred,
			deletedAt: input.deletedAt ?? null,
		},
	});
	return thread.id;
}

async function createForwardedThread(): Promise<string> {
	const sentAt = new Date("2026-08-07T08:15:00.000Z");
	const thread = await db.emailThread.create({
		data: {
			rootMessageId: roots[4] as string,
			subject: "Forwarded customer thread",
			firstMessageAt: sentAt,
			lastMessageAt: new Date(sentAt.getTime() + 3 * 60 * 60 * 1000),
			messageCount: 4,
		},
		select: { id: true },
	});

	await db.emailMessage.createMany({
		data: [
			{
				threadId: thread.id,
				rfcMessageId: `${roots[4]}-1@example.test`,
				syncedByUserId: userId,
				direction: EmailDirection.INBOUND,
				fromEmail: "chensong77777@gmail.com",
				fromName: "Forwarder",
				recipients: [{ email: userEmail, name: null, kind: "to" }],
				subject: "Forwarded customer thread",
				snippet: "",
				body: null,
				sentAt,
				isRead: true,
				starred: false,
			},
			{
				threadId: thread.id,
				rfcMessageId: `${roots[4]}-2@example.test`,
				syncedByUserId: userId,
				direction: EmailDirection.OUTBOUND,
				fromEmail: userEmail,
				fromName: "Mail Center Test",
				recipients: [{ email: forwardedCustomerEmail, name: null, kind: "to" }],
				subject: "Re: Forwarded customer thread",
				snippet: "Best regards",
				body: `Best regards, ${userEmail}`,
				sentAt: new Date(sentAt.getTime() + 60 * 60 * 1000),
				isRead: true,
				starred: false,
			},
			{
				threadId: thread.id,
				rfcMessageId: `${roots[4]}-3@example.test`,
				syncedByUserId: userId,
				direction: EmailDirection.INBOUND,
				fromEmail: forwardedCustomerEmail,
				fromName: "Buyer",
				recipients: [{ email: userEmail, name: null, kind: "to" }],
				subject: "Re: Forwarded customer thread",
				snippet: "Please quote",
				body: "Please quote this item.",
				sentAt: new Date(sentAt.getTime() + 2 * 60 * 60 * 1000),
				isRead: true,
				starred: false,
			},
			{
				threadId: thread.id,
				rfcMessageId: `${roots[4]}-4@example.test`,
				syncedByUserId: userId,
				direction: EmailDirection.OUTBOUND,
				fromEmail: userEmail,
				fromName: "Mail Center Test",
				recipients: [{ email: forwardedCustomerEmail, name: null, kind: "to" }],
				subject: "Re: Forwarded customer thread",
				snippet: "Quote sent",
				body: `Quote sent. Best regards, ${userEmail}`,
				sentAt: new Date(sentAt.getTime() + 3 * 60 * 60 * 1000),
				isRead: true,
				starred: false,
			},
		],
	});

	return thread.id;
}

function makeSmtpStub(options: { fail: () => boolean }) {
	const calls: ZohoMailDraft[] = [];
	const smtp = {
		send: async (
			_userId: string,
			draft: ZohoMailDraft,
		): Promise<ZohoMailSendResult> => {
			calls.push(draft);
			if (options.fail()) throw new Error("SMTP unavailable");
			return {
				messageId: draft.messageId ?? "fallback@example.test",
				from: userEmail,
				to: draft.to,
				subject: draft.subject,
			};
		},
	} as unknown as ZohoSmtpService;
	return { smtp, calls };
}

beforeAll(async () => {
	await clean();
	await db.user.create({
		data: { id: userId, name: "Mail Center Test", email: userEmail },
	});
	await ensureWorkspaceMembership(userId);
	const company = await db.company.create({
		data: { name: "Mail Center Company", domain: companyDomain },
		select: { id: true },
	});
	await db.contact.create({
		data: {
			firstName: "Mail",
			lastName: "Recipient",
			email: recipientEmail,
			companyId: company.id,
			ownerId: userId,
		},
	});
	inboxThreadId = await createThread({
		root: roots[0] as string,
		subject: `Inbox thread ${suffix}`,
		fromEmail: `buyer@${companyDomain}`,
		isRead: false,
		starred: true,
	});
	linkedThreadId = await createThread({
		root: roots[1] as string,
		subject: `Linked thread ${suffix}`,
		fromEmail: `linked@${companyDomain}`,
		isRead: true,
		starred: false,
		companyId: company.id,
	});
	trashThreadId = await createThread({
		root: roots[2] as string,
		subject: `Trash thread ${suffix}`,
		fromEmail: `trash@${companyDomain}`,
		isRead: false,
		starred: false,
		deletedAt: new Date("2026-08-07T08:30:00.000Z"),
	});
	forwardedThreadId = await createForwardedThread();
	conversation = new ConversationService(
		db,
		{} as never,
		new ActivityStampService(db),
	);
	const { smtp } = makeSmtpStub({ fail: () => false });
	draftService = new EmailDraftService(db, smtp, conversation);
});

afterAll(clean);

describe("mail center conversation state", () => {
	it("files the Agent's customer instead of the forwarding sender", async () => {
		const intake = new MailLeadIntakeService(
			db,
			{
				extract: async () => ({
					name: "Buyer",
					domain: "",
					email: forwardedCustomerEmail,
					personName: "Buyer",
					phone: null,
					leadSource: "Email",
					productInterest: "Quote request",
					targetMarket: null,
					uncertain: [],
				}),
			} as never,
			{
				contactCreated: async () => undefined,
				companyCreated: async () => undefined,
			} as never,
			new ActivityStampService(db),
		);

		const result = await intake.createCustomerFromThread(
			forwardedThreadId,
			userId,
		);
		const [thread, contact, activity] = await Promise.all([
			db.emailThread.findUnique({
				where: { id: forwardedThreadId },
				select: { companyId: true, contactId: true },
			}),
			db.contact.findUnique({
				where: { email: forwardedCustomerEmail },
				select: { id: true, companyId: true },
			}),
			db.activity.findUnique({
				where: { emailThreadId: forwardedThreadId },
				select: { companyId: true, contactId: true },
			}),
		]);

		expect(result.status).toBe("created");
		expect(thread?.companyId).toBeTruthy();
		expect(thread?.contactId).toBe(contact?.id);
		expect(contact?.companyId).toBe(thread?.companyId);
		expect(activity?.companyId).toBe(thread?.companyId);
		expect(activity?.contactId).toBe(contact?.id);
	});

	it("links a new outbound message to an existing recipient", async () => {
		const sentAt = new Date("2026-08-07T09:00:00.000Z");
		const sent = await conversation.recordOutbound(
			{
				messageId: roots[3] as string,
				fromEmail: userEmail,
				fromName: "Mail Center Test",
				to: [{ email: recipientEmail, name: "Mail Recipient" }],
				cc: [],
				bcc: [],
				subject: `Outbound thread ${suffix}`,
				body: "A locally sent message",
				sentAt,
			},
			userId,
		);
		const [thread, activity, contact] = await Promise.all([
			db.emailThread.findUnique({
				where: { id: sent.threadId },
				select: { companyId: true, contactId: true },
			}),
			db.activity.findUnique({
				where: { emailThreadId: sent.threadId },
				select: { companyId: true, contactId: true },
			}),
			db.contact.findUnique({
				where: { email: recipientEmail },
				select: { lastActivityAt: true },
			}),
		]);
		expect(thread?.companyId).toBeTruthy();
		expect(thread?.contactId).toBeTruthy();
		expect(activity?.companyId).toBe(thread?.companyId);
		expect(activity?.contactId).toBe(thread?.contactId);
		expect(contact?.lastActivityAt).toEqual(sentAt);
	});

	it("filters active, unread, starred, linked, unlinked and CRM trash threads", async () => {
		const active = await conversation.threads(
			{ folder: "inbox", limit: 100, q: suffix },
			userId,
		);
		expect(active.threads.map((thread) => thread.id)).toEqual(
			expect.arrayContaining([inboxThreadId, linkedThreadId]),
		);
		expect(active.threads.map((thread) => thread.id)).not.toContain(
			trashThreadId,
		);

		const unread = await conversation.threads(
			{ folder: "inbox", unreadOnly: true, q: suffix },
			userId,
		);
		expect(unread.threads.map((thread) => thread.id)).toEqual([inboxThreadId]);

		const starred = await conversation.threads(
			{ folder: "inbox", starredOnly: true, q: suffix },
			userId,
		);
		expect(starred.threads.map((thread) => thread.id)).toEqual([inboxThreadId]);

		const linked = await conversation.threads(
			{ folder: "inbox", link: "linked", q: suffix },
			userId,
		);
		expect(linked.threads.map((thread) => thread.id)).toEqual(
			expect.arrayContaining([forwardedThreadId, linkedThreadId]),
		);

		const unlinked = await conversation.threads(
			{ folder: "inbox", link: "unlinked", q: suffix },
			userId,
		);
		expect(unlinked.threads.map((thread) => thread.id)).toEqual([
			inboxThreadId,
		]);

		const trash = await conversation.threads(
			{ folder: "crm-trash", q: suffix },
			userId,
		);
		expect(trash.threads.map((thread) => thread.id)).toEqual([trashThreadId]);
	});

	it("updates selected threads in bulk and restores them locally", async () => {
		expect(
			await conversation.bulkThreadState(
				{ threadIds: [inboxThreadId], action: "read" },
				userId,
			),
		).toEqual({ updated: 1 });
		expect(
			await db.emailMessage.findFirst({
				where: { threadId: inboxThreadId },
				select: { isRead: true },
			}),
		).toEqual({ isRead: true });

		await conversation.bulkThreadState(
			{ threadIds: [inboxThreadId, linkedThreadId], action: "star" },
			userId,
		);
		const starred = await db.emailMessage.findMany({
			where: { threadId: { in: [inboxThreadId, linkedThreadId] } },
			select: { starred: true },
		});
		expect(starred.every((message) => message.starred)).toBe(true);

		await conversation.bulkThreadState(
			{ threadIds: [inboxThreadId], action: "trash" },
			userId,
		);
		const inTrash = await conversation.threads(
			{ folder: "crm-trash", q: suffix },
			userId,
		);
		expect(inTrash.threads.map((thread) => thread.id)).toContain(inboxThreadId);

		await conversation.bulkThreadState(
			{ threadIds: [inboxThreadId], action: "restore" },
			userId,
		);
		const restored = await conversation.threads(
			{ folder: "inbox", q: suffix },
			userId,
		);
		expect(restored.threads.map((thread) => thread.id)).toContain(
			inboxThreadId,
		);
	});
});

describe("mail center drafts", () => {
	it("saves, reloads and keeps recipient and attachment state", async () => {
		const draft = await draftService.save(
			{
				to: [
					{ email: "Buyer@Example.test", name: " Buyer " },
					{ email: "buyer@example.test", name: "Duplicate" },
				],
				cc: [],
				bcc: [],
				subject: "Saved subject",
				body: "Saved body",
			},
			userId,
		);
		const attachment = await draftService.addAttachment(
			{
				draftId: draft.id,
				filename: "quote.txt",
				mimeType: "text/plain",
				contentBase64: Buffer.from("quote").toString("base64"),
			},
			userId,
		);
		const reloaded = await draftService.get(draft.id, userId);
		expect(reloaded).toMatchObject({
			id: draft.id,
			subject: "Saved subject",
			body: "Saved body",
			to: [{ email: "buyer@example.test", name: "Buyer" }],
		});
		expect(reloaded.attachments).toEqual([attachment]);
		let invalidError: unknown;
		try {
			await draftService.addAttachment(
				{
					draftId: draft.id,
					filename: "bad.bin",
					contentBase64: "not base64",
				},
				userId,
			);
		} catch (error) {
			invalidError = error;
		}
		expect(invalidError).toBeInstanceOf(Error);
		expect((invalidError as Error).message).toContain("valid base64");
	});

	it("enforces 10 MB per attachment and 20 MB per draft", () => {
		expect(() => assertAttachmentSize(MAX_ATTACHMENT_BYTES, 0)).not.toThrow();
		expect(() => assertAttachmentSize(MAX_ATTACHMENT_BYTES + 1, 0)).toThrow(
			"10 MB",
		);
		expect(() => assertAttachmentSize(1, MAX_MESSAGE_BYTES)).toThrow("20 MB");
		expect(MAX_MESSAGE_BYTES).toBe(MAX_ATTACHMENT_BYTES * 2);
	});

	it("keeps a failed SMTP draft and deduplicates a successful retry", async () => {
		let fail = true;
		const { smtp, calls } = makeSmtpStub({ fail: () => fail });
		const service = new EmailDraftService(db, smtp, conversation);
		const draft = await service.save(
			{
				to: [{ email: "retry@example.test" }],
				cc: [],
				bcc: [],
				subject: "Retry subject",
				body: "Retry body",
			},
			userId,
		);
		await service.addAttachment(
			{
				draftId: draft.id,
				filename: "retry.txt",
				contentBase64: Buffer.from("keep me").toString("base64"),
			},
			userId,
		);

		let sendError: unknown;
		try {
			await service.send(draft.id, userId);
		} catch (error) {
			sendError = error;
		}
		expect(sendError).toBeInstanceOf(Error);
		expect((sendError as Error).message).toContain("SMTP unavailable");
		const failed = await db.emailDraft.findUnique({
			where: { id: draft.id },
			select: {
				status: true,
				lastError: true,
				sentMessageId: true,
				attachments: { select: { filename: true } },
			},
		});
		expect(failed?.status).toBe(EmailDraftStatus.FAILED);
		expect(failed?.lastError).toContain("SMTP unavailable");
		expect(failed?.sentMessageId).toBeTruthy();
		expect(failed?.attachments).toEqual([{ filename: "retry.txt" }]);

		fail = false;
		const firstSent = await service.send(draft.id, userId);
		const secondSent = await service.send(draft.id, userId);
		expect(firstSent.threadId).toBe(secondSent.threadId);
		expect(calls).toHaveLength(2);
		const stored = await db.emailDraft.findUnique({
			where: { id: draft.id },
			select: { status: true, sentMessageId: true },
		});
		expect(stored?.status).toBe(EmailDraftStatus.SENT);
		expect(
			await db.emailMessage.count({
				where: { rfcMessageId: stored?.sentMessageId ?? "" },
			}),
		).toBe(1);
	});
});
