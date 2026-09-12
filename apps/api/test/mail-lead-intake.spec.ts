import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import type { AiExtractService } from "../src/agent/ai-extract.service";
import { MailLeadIntakeService } from "../src/mail/mail-lead-intake.service";

function intakeDb(onCompanyCreate: () => void): Db {
	return {
		member: {
			findUnique: async () => ({ role: "member" }),
		},
		emailThread: {
			findUnique: async () => ({
				id: "thread-1",
				subject: "Website inquiry",
				lastMessageAt: new Date("2026-08-24T10:00:00.000Z"),
				companyId: null,
				contactId: null,
				messages: [
					{
						fromEmail: "forms@example.test",
						fromName: "Website",
						subject: "Website inquiry",
						body: "Name: Ada Buyer\nEmail: ada@example.com",
					},
				],
			}),
		},
		company: {
			create: async () => {
				onCompanyCreate();
				return { id: "company-1" };
			},
		},
	} as unknown as Db;
}

describe("mail lead intake", () => {
	it("keeps an unmatched thread intact when Agent extraction is unavailable", async () => {
		let companyWriteReached = false;
		const service = new MailLeadIntakeService(
			intakeDb(() => {
				companyWriteReached = true;
			}),
			{ extract: async () => null } as unknown as AiExtractService,
			{} as AgentTriggerService,
			{} as never,
		);

		const result = await service.createCustomerFromThread(
			"thread-1",
			"member-1",
		);

		expect(result).toEqual({ status: "unavailable" });
		expect(companyWriteReached).toBe(false);
	});

	it("files the Agent result instead of interpreting the mail in Nest", async () => {
		const state: {
			company?: Record<string, unknown>;
			contact?: Record<string, unknown>;
			thread?: Record<string, unknown>;
			activity?: Record<string, unknown>;
		} = {};
		const db = {
			member: { findUnique: async () => ({ role: "member" }) },
			emailThread: {
				findUnique: async () => ({
					id: "thread-1",
					subject: "Website inquiry",
					lastMessageAt: new Date("2026-08-24T10:00:00.000Z"),
					companyId: null,
					contactId: null,
					messages: [
						{
							fromEmail: "forms@example.test",
							fromName: "Website",
							subject: "Website inquiry",
							body: "This body deliberately contains no structured fields.",
						},
					],
				}),
				update: async (args: { data: Record<string, unknown> }) => {
					state.thread = args.data;
					return { id: "thread-1" };
				},
			},
			company: {
				findUnique: async () => null,
				create: async (args: { data: Record<string, unknown> }) => {
					state.company = args.data;
					return { id: "company-1" };
				},
				updateMany: async () => ({ count: 1 }),
			},
			contact: {
				findUnique: async () => null,
				create: async (args: { data: Record<string, unknown> }) => {
					state.contact = args.data;
					return { id: "contact-1" };
				},
			},
			activity: {
				upsert: async (args: { create: Record<string, unknown> }) => {
					state.activity = args.create;
					return { id: "activity-1" };
				},
			},
			$transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
		} as unknown as Db;
		const triggered: string[] = [];
		const service = new MailLeadIntakeService(
			db,
			{
				extract: async () => ({
					name: "Agent Chosen Imports",
					domain: "agent-chosen.example",
					email: "ada@agent-chosen.example",
					personName: "Ada Buyer",
					phone: "+1 555 0100",
					leadSource: "Website inquiry",
					productInterest: "Borosilicate tumblers",
					targetMarket: null,
					uncertain: [],
				}),
			} as unknown as AiExtractService,
			{
				companyCreated: async () => {
					triggered.push("company");
				},
				contactCreated: async () => {
					triggered.push("contact");
				},
			} as unknown as AgentTriggerService,
			{ touch: async () => undefined } as never,
		);

		const result = await service.createCustomerFromThread(
			"thread-1",
			"member-1",
		);

		expect(result).toEqual({
			status: "created",
			companyId: "company-1",
			contactId: "contact-1",
		});
		expect(state.company).toMatchObject({
			name: "Agent Chosen Imports",
			domain: "agent-chosen.example",
			ownerId: "member-1",
		});
		expect(state.contact).toMatchObject({
			firstName: "Ada",
			lastName: "Buyer",
			email: "ada@agent-chosen.example",
		});
		expect(state.thread).toEqual({
			companyId: "company-1",
			contactId: "contact-1",
		});
		expect(state.activity).toMatchObject({
			companyId: "company-1",
			contactId: "contact-1",
		});
		expect(triggered).toEqual(["contact", "company"]);
	});

	it("creates a customer from manual input without calling the Agent", async () => {
		let extractCalled = false;
		const state: {
			company?: Record<string, unknown>;
			contact?: Record<string, unknown>;
			thread?: Record<string, unknown>;
		} = {};
		const db = {
			member: { findUnique: async () => ({ role: "member" }) },
			emailThread: {
				findUnique: async () => ({
					id: "thread-1",
					subject: "Quote request",
					lastMessageAt: new Date("2026-08-24T10:00:00.000Z"),
					companyId: null,
					contactId: null,
					messages: [
						{
							fromEmail: "buyer@acme-glass.com",
							fromName: "Ada Buyer",
							subject: "Quote request",
							body: "Please quote 5000 tumblers.",
						},
					],
				}),
				update: async (args: { data: Record<string, unknown> }) => {
					state.thread = args.data;
					return { id: "thread-1" };
				},
			},
			company: {
				findUnique: async () => null,
				create: async (args: { data: Record<string, unknown> }) => {
					state.company = args.data;
					return { id: "company-1" };
				},
				updateMany: async () => ({ count: 1 }),
			},
			contact: {
				findUnique: async () => null,
				create: async (args: { data: Record<string, unknown> }) => {
					state.contact = args.data;
					return { id: "contact-1" };
				},
			},
			activity: {
				upsert: async () => ({ id: "activity-1" }),
			},
			$transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
		} as unknown as Db;
		const service = new MailLeadIntakeService(
			db,
			{
				extract: async () => {
					extractCalled = true;
					return null;
				},
			} as unknown as AiExtractService,
			{
				contactCreated: async () => undefined,
				companyCreated: async () => undefined,
			} as unknown as AgentTriggerService,
			{ touch: async () => undefined } as never,
		);

		const result = await service.createCustomerFromThreadManual(
			"thread-1",
			{
				threadId: "thread-1",
				companyName: "Acme Glass",
				email: "Buyer@Acme-Glass.com",
				firstName: "Ada",
				lastName: "Buyer",
			},
			"member-1",
		);

		expect(extractCalled).toBe(false);
		expect(result).toEqual({
			status: "created",
			companyId: "company-1",
			contactId: "contact-1",
		});
		expect(state.company).toMatchObject({
			name: "Acme Glass",
			domain: "acme-glass.com",
			ownerId: "member-1",
		});
		expect(state.contact).toMatchObject({
			firstName: "Ada",
			lastName: "Buyer",
			email: "buyer@acme-glass.com",
		});
		expect(state.thread).toEqual({
			companyId: "company-1",
			contactId: "contact-1",
		});
	});
});
