import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { APP_AUTH } from "../agent/lib/app-auth";
import { fileMailThread } from "../agent/lib/mail-intake";
import { approveMailFiling } from "../agent/tools/file_mail_thread";

describe("agent mail intake", () => {
	it("denies unattended customer creation unless the mailbox enabled it", () => {
		const decision = approveMailFiling({
			session: {
				auth: {
					current: {
						...APP_AUTH,
						attributes: {
							taskKind: "mail-intake",
							emailThreadId: "thread-1",
							allowCreate: "false",
						},
					},
				},
			},
			toolInput: {
				threadId: "thread-1",
				category: "INQUIRY",
				evidence: "Buyer asked for a quote.",
				newCustomer: {
					name: "Buyer Imports",
					email: "buyer@example.test",
				},
			},
		} as never);

		expect(decision).toEqual({
			type: "denied",
			reason: "Customer creation is disabled for this mailbox task.",
		});
	});

	it("does not create a customer when the mailbox policy forbids it", async () => {
		const result = await fileMailThread(
			{
				threadId: "thread-1",
				category: "INQUIRY",
				evidence: "The buyer asked for a quotation.",
				newCustomer: {
					name: "Buyer Imports",
					email: "buyer@example.test",
				},
			},
			"member-1",
			false,
			{} as Db,
		);

		expect(result).toEqual({
			filed: false,
			reason: "Customer creation is disabled for this mailbox task.",
		});
	});

	it("classifies a thread without inventing a CRM link", async () => {
		let threadUpdate: Record<string, unknown> | undefined;
		let activityCreate: Record<string, unknown> | undefined;
		const client = {
			user: { findUnique: async () => ({ id: "member-1" }) },
			member: { findUnique: async () => ({ id: "membership-1" }) },
			emailThread: {
				findUnique: async () => ({
					id: "thread-1",
					subject: "Newsletter",
					lastMessageAt: new Date("2026-08-24T10:00:00.000Z"),
					companyId: null,
					contactId: null,
					messages: [{ body: "August product newsletter" }],
				}),
				update: async (args: { data: Record<string, unknown> }) => {
					threadUpdate = args.data;
					return { id: "thread-1" };
				},
			},
			activity: {
				upsert: async (args: { create: Record<string, unknown> }) => {
					activityCreate = args.create;
					return { id: "activity-1" };
				},
			},
			$transaction: async (operations: Promise<unknown>[]) =>
				Promise.all(operations),
		} as unknown as Db;

		const result = await fileMailThread(
			{
				threadId: "thread-1",
				category: "PROMOTION",
				evidence: "The message calls itself a monthly newsletter.",
			},
			"member-1",
			false,
			client,
		);

		expect(result).toEqual({
			filed: true,
			threadId: "thread-1",
			category: "PROMOTION",
			companyId: null,
			contactId: null,
			created: false,
		});
		expect(threadUpdate).toEqual({
			category: "PROMOTION",
			companyId: null,
			contactId: null,
		});
		expect(activityCreate).toMatchObject({
			emailThreadId: "thread-1",
			meta: {
				synced: true,
				source: "mail-intake-agent",
				evidence: "The message calls itself a monthly newsletter.",
			},
		});
	});

	it("creates and links a customer only when the mailbox policy allows it", async () => {
		let companyCreate: Record<string, unknown> | undefined;
		let contactCreate: Record<string, unknown> | undefined;
		let threadUpdate: Record<string, unknown> | undefined;
		const client = {
			user: { findUnique: async () => ({ id: "member-1" }) },
			member: { findUnique: async () => ({ id: "membership-1" }) },
			emailThread: {
				findUnique: async () => ({
					id: "thread-1",
					subject: "Quotation request",
					lastMessageAt: new Date("2026-08-24T10:00:00.000Z"),
					companyId: null,
					contactId: null,
					messages: [{ body: "Please quote 500 tumblers." }],
				}),
				update: async (args: { data: Record<string, unknown> }) => {
					threadUpdate = args.data;
					return { id: "thread-1" };
				},
			},
			company: {
				findUnique: async () => null,
				create: async (args: { data: Record<string, unknown> }) => {
					companyCreate = args.data;
					return { id: "company-1" };
				},
				updateMany: async () => ({ count: 1 }),
			},
			contact: {
				findUnique: async () => null,
				create: async (args: { data: Record<string, unknown> }) => {
					contactCreate = args.data;
					return { id: "contact-1" };
				},
				updateMany: async () => ({ count: 1 }),
			},
			activity: { upsert: async () => ({ id: "activity-1" }) },
			$transaction: async (
				run: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[],
			) => (Array.isArray(run) ? Promise.all(run) : run(client)),
		} as unknown as Db;

		const result = await fileMailThread(
			{
				threadId: "thread-1",
				category: "INQUIRY",
				evidence: "The sender asks for a quotation from their own address.",
				newCustomer: {
					name: "Buyer Imports",
					domain: "buyer.example",
					email: "ada@buyer.example",
					personName: "Ada Buyer",
					phone: "+1 555 0100",
				},
			},
			"member-1",
			true,
			client,
		);

		expect(result).toEqual({
			filed: true,
			threadId: "thread-1",
			category: "INQUIRY",
			companyId: "company-1",
			contactId: "contact-1",
			created: true,
		});
		expect(companyCreate).toMatchObject({
			name: "Buyer Imports",
			domain: "buyer.example",
			ownerId: "member-1",
		});
		expect(contactCreate).toMatchObject({
			firstName: "Ada",
			lastName: "Buyer",
			email: "ada@buyer.example",
		});
		expect(threadUpdate).toMatchObject({
			category: "INQUIRY",
			companyId: "company-1",
			contactId: "contact-1",
		});
	});
});
