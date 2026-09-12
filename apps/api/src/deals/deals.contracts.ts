import { INQUIRY_STAGES } from "@crm/db/deal-stage";
import { z } from "zod";
import { listInput } from "../trpc/list-input";

export const CLOSING_WINDOWS = [
	"overdue",
	"this-month",
	"next-month",
	"later",
	"none",
] as const;

export type ClosingWindow = (typeof CLOSING_WINDOWS)[number];

export const dealListInput = listInput.extend({
	status: z.string().default("all"),
	owner: z.string().default("all"),
	stage: z.string().default("all"),
	closing: z.string().default("all"),
});

export type DealListInput = z.infer<typeof dealListInput>;

const stageEnum = z.enum(INQUIRY_STAGES);

const optionalText = z.string().trim().max(2_000).nullable().optional();

const tradeTermsInput = z.object({
	productSummary: optionalText,
	specification: optionalText,
	quantity: z.string().trim().max(100).nullable().optional(),
	unit: z.string().trim().max(30).nullable().optional(),
	targetPriceCents: z.number().int().min(0).nullable().optional(),
	incoterm: z
		.enum(["EXW", "FOB", "CFR", "CIF", "DAP", "DDP", "OTHER"])
		.nullable()
		.optional(),
	originPort: z.string().trim().max(120).nullable().optional(),
	destinationPort: z.string().trim().max(120).nullable().optional(),
	paymentTerms: z.string().trim().max(500).nullable().optional(),
	quoteValidUntil: z.string().nullable().optional(),
	requiredDeliveryDate: z.string().nullable().optional(),
});

export const dealCreateInput = z
	.object({
		name: z.string().trim().min(1, "An inquiry needs a name."),
		companyId: z.string().min(1, "An inquiry belongs to a customer."),
		ownerId: z.string().min(1, "An inquiry needs an owner."),
		stage: stageEnum.optional(),
		amountCents: z.number().int().min(0).nullable().optional(),
		currency: z.string().length(3).optional(),
		expectedOrderDate: z.string().nullable().optional(),
		expectedCloseDate: z.string().nullable().optional(),
		inquiryReceivedAt: z.string().nullable().optional(),
	})
	.extend(tradeTermsInput.shape);

export type DealCreateInput = z.infer<typeof dealCreateInput>;

const dealUpdateInput = z
	.object({
		name: z.string().trim().min(1).optional(),
		companyId: z.string().optional(),
		ownerId: z.string().optional(),
		amountCents: z.number().int().min(0).nullable().optional(),
		currency: z.string().length(3).optional(),
		expectedOrderDate: z.string().nullable().optional(),
		expectedCloseDate: z.string().nullable().optional(),
		inquiryReceivedAt: z.string().nullable().optional(),
	})
	.extend(tradeTermsInput.shape);

export type DealUpdateInput = z.infer<typeof dealUpdateInput>;

export const dealUpdateArgs = z.object({
	id: z.string(),
	data: dealUpdateInput,
});

export const dealIdInput = z.object({ id: z.string() });

export const setStageInput = z.object({
	id: z.string(),
	stage: stageEnum,
	closedReason: z.string().trim().optional(),
});

export type SetStageInput = z.infer<typeof setStageInput>;

const quotationStatusEnum = z.enum([
	"DRAFT",
	"SENT",
	"ACCEPTED",
	"DECLINED",
	"EXPIRED",
]);

const quotationItemInput = z.object({
	productName: z.string().trim().min(1, "A line needs a product name."),
	sku: z.string().trim().max(120).nullable().optional(),
	specification: z.string().trim().max(2_000).nullable().optional(),
	quantity: z.number().positive("Quantity must be greater than zero."),
	unit: z.string().trim().max(30).nullable().optional(),
	unitPriceCents: z.number().int().min(0),
});

const quotationTermsInput = z.object({
	currency: z.string().length(3).optional(),
	incoterm: z
		.enum(["EXW", "FOB", "CFR", "CIF", "DAP", "DDP", "OTHER"])
		.nullable()
		.optional(),
	originPort: z.string().trim().max(120).nullable().optional(),
	destinationPort: z.string().trim().max(120).nullable().optional(),
	paymentTerms: z.string().trim().max(500).nullable().optional(),
	leadTimeDays: z.number().int().min(0).max(9_999).nullable().optional(),
	validUntil: z.string().nullable().optional(),
	notes: z.string().trim().max(5_000).nullable().optional(),
});

export const quotationCreateInput = quotationTermsInput.extend({
	dealId: z.string(),
	items: z.array(quotationItemInput).min(1, "Add at least one line item."),
});

export type QuotationCreateInput = z.infer<typeof quotationCreateInput>;

export const quotationUpdateArgs = z.object({
	id: z.string(),
	data: quotationTermsInput.extend({
		items: z.array(quotationItemInput).min(1).optional(),
	}),
});

export type QuotationUpdateInput = z.infer<typeof quotationUpdateArgs>["data"];

export const quotationIdInput = z.object({ id: z.string() });

export const setQuotationStatusInput = z.object({
	id: z.string(),
	status: quotationStatusEnum,
});

export const sampleStatusEnum = z.enum([
	"REQUESTED",
	"PREPARING",
	"SHIPPED",
	"DELIVERED",
	"APPROVED",
	"REJECTED",
]);

export const sampleCreateInput = z.object({
	dealId: z.string(),
	product: z.string().trim().min(1),
	variant: z.string().trim().nullable().optional(),
	quantity: z.number().int().min(1).default(1),
	shipTo: z.string().trim().nullable().optional(),
	courier: z.string().trim().nullable().optional(),
	trackingNo: z.string().trim().nullable().optional(),
	notes: z.string().trim().nullable().optional(),
});

export const sampleUpdateArgs = z.object({
	id: z.string(),
	data: z.object({
		status: sampleStatusEnum.optional(),
		product: z.string().trim().optional(),
		variant: z.string().trim().nullable().optional(),
		quantity: z.number().int().min(1).optional(),
		shipTo: z.string().trim().nullable().optional(),
		courier: z.string().trim().nullable().optional(),
		trackingNo: z.string().trim().nullable().optional(),
		notes: z.string().trim().nullable().optional(),
	}),
});

export const sampleIdInput = z.object({ id: z.string() });

export const orderStatusEnum = z.enum([
	"DRAFT",
	"CONFIRMED",
	"IN_PRODUCTION",
	"READY_TO_SHIP",
	"SHIPPED",
	"DELIVERED",
	"COMPLETED",
	"CANCELLED",
]);

export const orderItemInput = z.object({
	sku: z.string().trim().nullable().optional(),
	description: z.string().trim().min(1),
	quantity: z.number().positive(),
	unitPrice: z.number().nonnegative(),
});

export const orderCreateInput = z.object({
	dealId: z.string(),
	currency: z.string().trim().default("USD"),
	incoterm: z.string().trim().nullable().optional(),
	paymentTerms: z.string().trim().nullable().optional(),
	notes: z.string().trim().nullable().optional(),
	items: z.array(orderItemInput).min(1, "Add at least one line item."),
});

export const orderUpdateArgs = z.object({
	id: z.string(),
	data: z.object({
		status: orderStatusEnum.optional(),
		currency: z.string().trim().optional(),
		incoterm: z.string().trim().nullable().optional(),
		paymentTerms: z.string().trim().nullable().optional(),
		notes: z.string().trim().nullable().optional(),
		productionStart: z.string().nullable().optional(),
		productionEnd: z.string().nullable().optional(),
		shipDate: z.string().nullable().optional(),
		deliveryDate: z.string().nullable().optional(),
	}),
});

export const orderIdInput = z.object({ id: z.string() });

export const paymentKindEnum = z.enum(["DEPOSIT", "BALANCE", "INSTALLMENT"]);

export const paymentCreateInput = z.object({
	orderId: z.string(),
	kind: paymentKindEnum.default("INSTALLMENT"),
	amountCents: z.number().int().positive("An amount greater than zero."),
	expectedAt: z.string().nullable().optional(),
	receivedAt: z.string().nullable().optional(),
	reference: z.string().trim().max(200).nullable().optional(),
	notes: z.string().trim().max(2_000).nullable().optional(),
});

export const paymentUpdateArgs = z.object({
	id: z.string(),
	data: z.object({
		kind: paymentKindEnum.optional(),
		amountCents: z.number().int().positive().optional(),
		expectedAt: z.string().nullable().optional(),
		receivedAt: z.string().nullable().optional(),
		reference: z.string().trim().max(200).nullable().optional(),
		notes: z.string().trim().max(2_000).nullable().optional(),
	}),
});

export const paymentIdInput = z.object({ id: z.string() });

export type SampleCreateInput = z.infer<typeof sampleCreateInput>;
export type SampleUpdateInput = z.infer<typeof sampleUpdateArgs>["data"];
export type OrderCreateInput = z.infer<typeof orderCreateInput>;
export type OrderUpdateInput = z.infer<typeof orderUpdateArgs>["data"];
export type PaymentCreateInput = z.infer<typeof paymentCreateInput>;
export type PaymentUpdateInput = z.infer<typeof paymentUpdateArgs>["data"];
