import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { ForbiddenException } from "@nestjs/common";
import { DealsService } from "../src/deals/deals.service";

function accessDb(options: {
	memberRole: string;
	dealOwnerId: string;
	onDealCreate?: () => void;
	onDealUpdate?: () => void;
	onSampleCreate?: () => void;
	onSampleUpdate?: () => void;
	onSampleDelete?: () => void;
	onOrderCreate?: () => void;
	onOrderUpdate?: () => void;
	onOrderDelete?: () => void;
	onPaymentCreate?: () => void;
	onPaymentUpdate?: () => void;
	onPaymentDelete?: () => void;
	onQuotationDelete?: () => void;
}): Db {
	return {
		member: {
			findUnique: async (args: unknown) => {
				const userId = (
					args as { where: { organizationId_userId: { userId?: string } } }
				).where.organizationId_userId.userId;
				return userId ? { role: options.memberRole } : null;
			},
		},
		company: {
			findUnique: async () => ({
				id: "company-1",
				ownerId: options.dealOwnerId,
			}),
		},
		deal: {
			findUnique: async () => ({
				id: "inquiry-1",
				ownerId: options.dealOwnerId,
			}),
			create: async () => {
				options.onDealCreate?.();
				return {
					id: "inquiry-1",
					name: "Glassware inquiry",
					companyId: "company-1",
				};
			},
			update: async () => {
				options.onDealUpdate?.();
				return { id: "inquiry-1", name: "Updated inquiry" };
			},
		},
		sample: {
			findUnique: async () => ({
				id: "sample-1",
				dealId: "inquiry-1",
				deal: { ownerId: options.dealOwnerId },
			}),
			create: async () => {
				options.onSampleCreate?.();
				return { id: "sample-1" };
			},
			update: async () => {
				options.onSampleUpdate?.();
				return { id: "sample-1" };
			},
			delete: async () => {
				options.onSampleDelete?.();
				return { id: "sample-1" };
			},
		},
		salesOrder: {
			findUnique: async () => ({
				id: "order-1",
				dealId: "inquiry-1",
				deal: { ownerId: options.dealOwnerId },
			}),
			create: async () => {
				options.onOrderCreate?.();
				return { id: "order-1", orderNumber: "SO-1" };
			},
			update: async () => {
				options.onOrderUpdate?.();
				return { id: "order-1" };
			},
			delete: async () => {
				options.onOrderDelete?.();
				return { id: "order-1" };
			},
		},
		payment: {
			findUnique: async () => ({
				id: "payment-1",
				orderId: "order-1",
				order: { deal: { ownerId: options.dealOwnerId } },
			}),
			create: async () => {
				options.onPaymentCreate?.();
				return { id: "payment-1" };
			},
			update: async () => {
				options.onPaymentUpdate?.();
				return { id: "payment-1" };
			},
			delete: async () => {
				options.onPaymentDelete?.();
				return { id: "payment-1" };
			},
		},
		quotation: {
			findUnique: async () => ({
				id: "quotation-1",
				dealId: "inquiry-1",
				deal: { ownerId: options.dealOwnerId },
			}),
			delete: async () => {
				options.onQuotationDelete?.();
				return { id: "quotation-1", quoteNumber: "QT-1" };
			},
		},
	} as unknown as Db;
}

function deals(db: Db): DealsService {
	return new DealsService(db, {} as never);
}

describe("inquiry mutation access", () => {
	it("does not let inquiry creation omit its actor", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "member-1",
				onDealCreate: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.create(
				{
					name: "Glassware inquiry",
					companyId: "company-1",
					ownerId: "member-1",
				},
				undefined as never,
			),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let inquiry updates omit their actor", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "member-1",
				onDealUpdate: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.update(
				"inquiry-1",
				{ name: "Updated inquiry" },
				undefined as never,
			),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let inquiry deletion omit its actor", async () => {
		const service = deals(
			accessDb({ memberRole: "member", dealOwnerId: "member-1" }),
		);

		await expect(
			service.delete("inquiry-1", undefined as never),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("does not let a member create a sample for someone else's inquiry", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "another-member",
				onSampleCreate: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.createSample(
				{
					dealId: "inquiry-1",
					product: "Glass tumbler",
					quantity: 1,
				},
				"member-1",
			),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let a member update a sample on someone else's inquiry", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "another-member",
				onSampleUpdate: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.updateSample("sample-1", { status: "SHIPPED" }, "member-1"),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let a member delete a sample on someone else's inquiry", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "another-member",
				onSampleDelete: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.deleteSample("sample-1", "member-1"),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let a member create a sales order for someone else's inquiry", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "another-member",
				onOrderCreate: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.createOrder(
				{
					dealId: "inquiry-1",
					currency: "USD",
					items: [{ description: "Glass tumbler", quantity: 1, unitPrice: 8 }],
				},
				"member-1",
			),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let a member update a sales order on someone else's inquiry", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "another-member",
				onOrderUpdate: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.updateOrder("order-1", { status: "IN_PRODUCTION" }, "member-1"),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let a member delete a sales order on someone else's inquiry", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "another-member",
				onOrderDelete: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.deleteOrder("order-1", "member-1"),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let a member record a payment on someone else's inquiry", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "another-member",
				onPaymentCreate: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.createPayment(
				{ orderId: "order-1", kind: "DEPOSIT", amountCents: 300_000 },
				"member-1",
			),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let a member update a payment on someone else's inquiry", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "another-member",
				onPaymentUpdate: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.updatePayment(
				"payment-1",
				{ receivedAt: "2026-08-28" },
				"member-1",
			),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let a member delete a payment on someone else's inquiry", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "another-member",
				onPaymentDelete: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.deletePayment("payment-1", "member-1"),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let a quotation mutation omit its actor", async () => {
		let writeReached = false;
		const service = deals(
			accessDb({
				memberRole: "member",
				dealOwnerId: "member-1",
				onQuotationDelete: () => {
					writeReached = true;
				},
			}),
		);

		await expect(
			service.deleteQuotation("quotation-1", undefined as never),
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(writeReached).toBe(false);
	});

	it("does not let converting a quotation to a PI omit its actor", async () => {
		const service = deals(
			accessDb({ memberRole: "member", dealOwnerId: "member-1" }),
		);

		await expect(
			service.convertQuotationToOrder("quotation-1", undefined as never),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("does not let quotation creation omit its actor", async () => {
		const service = deals(
			accessDb({ memberRole: "member", dealOwnerId: "member-1" }),
		);

		await expect(
			service.createQuotation(
				{
					dealId: "inquiry-1",
					items: [
						{ productName: "Glass tumbler", quantity: 1, unitPriceCents: 800 },
					],
				},
				undefined as never,
			),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("does not let quotation updates omit their actor", async () => {
		const service = deals(
			accessDb({ memberRole: "member", dealOwnerId: "member-1" }),
		);

		await expect(
			service.updateQuotation(
				"quotation-1",
				{ notes: "Updated terms" },
				undefined as never,
			),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("does not let quotation status changes omit their actor", async () => {
		const service = deals(
			accessDb({ memberRole: "member", dealOwnerId: "member-1" }),
		);

		await expect(
			service.setQuotationStatus("quotation-1", "SENT", undefined as never),
		).rejects.toBeInstanceOf(ForbiddenException);
	});
});
