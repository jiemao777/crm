import {
	ActivityType,
	type Db,
	type DealStage,
	type Incoterm,
	type Prisma,
	Prisma as PrismaNamespace,
	type QuotationStatus,
} from "@crm/db";
import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import {
	assertCompanyAccess,
	assertDealAccess,
	assertPaymentAccess,
	assertQuotationAccess,
	assertSalesOrderAccess,
	assertSampleAccess,
	resolveOwnerId,
} from "../crm/access";
import {
	ActivityStampService,
	type StampTargets,
} from "../crm/activity-stamp.service";
import { blankToNull, fromCents, toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import {
	countsByKey,
	FACET_ALL,
	FACET_UNASSIGNED,
	type ListResult,
	paginate,
	resolveOrderBy,
} from "../trpc/list-input";
import {
	CLOSED_INQUIRY_STAGES,
	isClosedInquiryStage,
	isLosingInquiryStage,
	OPEN_INQUIRY_STAGES,
} from "./deal-stage";
import type {
	ClosingWindow,
	DealCreateInput,
	DealListInput,
	DealUpdateInput,
	OrderCreateInput,
	OrderUpdateInput,
	PaymentCreateInput,
	PaymentUpdateInput,
	QuotationCreateInput,
	QuotationUpdateInput,
	SampleCreateInput,
	SampleUpdateInput,
	SetStageInput,
} from "./deals.contracts";
import { CLOSING_WINDOWS } from "./deals.contracts";

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const COMPANY_SELECT = {
	id: true,
	name: true,
	domain: true,
	iconUrl: true,
	iconDarkUrl: true,
	iconTone: true,
	logoUrl: true,
} as const;

const SORTABLE: Record<
	string,
	(dir: Prisma.SortOrder) => Prisma.DealOrderByWithRelationInput[]
> = {
	name: (dir) => [{ name: dir }],
	company: (dir) => [{ company: { name: dir } }, { name: "asc" }],
	stage: (dir) => [{ stage: dir }, { expectedOrderDate: "asc" }],
	amount: (dir) => [{ amount: dir }],
	expectedOrderDate: (dir) => [{ expectedOrderDate: dir }],
	createdAt: (dir) => [{ createdAt: dir }],
	owner: (dir) => [{ owner: { name: dir } }, { name: "asc" }],
	lastActivity: (dir) => [{ lastActivityAt: { sort: dir, nulls: "last" } }],
};

@Injectable()
export class DealsService {
	private readonly logger = new Logger(DealsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly stamp: ActivityStampService,
		private readonly agent: AgentTriggerService,
	) {}

	async list(input: DealListInput) {
		const where = this.buildWhere(input);
		const { skip, take } = paginate(input);

		const [rows, total, facetCounts, openValue] = await Promise.all([
			this.db.deal.findMany({
				where,
				skip,
				take,
				orderBy: resolveOrderBy(input, SORTABLE, [{ createdAt: "desc" }]),
				select: {
					id: true,
					name: true,
					inquiryNo: true,
					productSummary: true,
					stage: true,
					amount: true,
					currency: true,
					expectedOrderDate: true,
					quoteValidUntil: true,
					closedAt: true,
					company: { select: COMPANY_SELECT },
					owner: { select: OWNER_SELECT },
					lastActivityAt: true,
					createdAt: true,
				},
			}),
			this.db.deal.count({ where }),
			this.facetCounts(input),
			this.db.deal.groupBy({
				by: ["currency"],
				where: { ...where, stage: { in: [...OPEN_INQUIRY_STAGES] } },
				_sum: { amount: true },
			}),
		]);

		return {
			rows: rows.map(
				({
					amount,
					expectedOrderDate,
					quoteValidUntil,
					closedAt,
					lastActivityAt,
					createdAt,
					...row
				}) => ({
					...row,
					amountCents: toCents(amount),
					expectedOrderDate: expectedOrderDate?.toISOString() ?? null,
					quoteValidUntil: quoteValidUntil?.toISOString() ?? null,
					closedAt: closedAt?.toISOString() ?? null,
					lastActivityAt: lastActivityAt?.toISOString() ?? null,
					createdAt: createdAt.toISOString(),
				}),
			),
			total,
			facetCounts,
			openValue: openValue
				.map((row) => ({
					currency: row.currency,
					valueCents: toCents(row._sum.amount) ?? 0,
				}))
				.filter((row) => row.valueCents !== 0)
				.sort((a, b) => a.currency.localeCompare(b.currency)),
		} satisfies ListResult<unknown> & {
			openValue: { currency: string; valueCents: number }[];
		};
	}

	async byId(id: string) {
		const deal = await this.db.deal.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				inquiryNo: true,
				stage: true,
				stageChangedAt: true,
				amount: true,
				currency: true,
				inquiryReceivedAt: true,
				expectedOrderDate: true,
				requiredDeliveryDate: true,
				productSummary: true,
				specification: true,
				quantity: true,
				unit: true,
				targetPrice: true,
				incoterm: true,
				originPort: true,
				destinationPort: true,
				paymentTerms: true,
				quoteValidUntil: true,
				quotedAt: true,
				closedAt: true,
				closedReason: true,
				createdAt: true,
				company: { select: { ...COMPANY_SELECT, industry: true } },
				owner: { select: OWNER_SELECT },
				contacts: {
					select: {
						role: true,
						contact: {
							select: {
								id: true,
								firstName: true,
								lastName: true,
								email: true,
								title: true,
								imageUrl: true,
							},
						},
					},
				},
				quotations: {
					orderBy: { version: "desc" },
					select: {
						id: true,
						quoteNumber: true,
						version: true,
						status: true,
						currency: true,
						incoterm: true,
						originPort: true,
						destinationPort: true,
						paymentTerms: true,
						leadTimeDays: true,
						validUntil: true,
						notes: true,
						subtotal: true,
						total: true,
						sentAt: true,
						createdAt: true,
						items: {
							orderBy: { sortOrder: "asc" },
							select: {
								id: true,
								productName: true,
								sku: true,
								specification: true,
								quantity: true,
								unit: true,
								unitPrice: true,
								lineTotal: true,
							},
						},
					},
				},
			},
		});

		if (!deal) {
			throw new NotFoundException(`No inquiry with id ${id}.`);
		}

		const { contacts, quotations, amount, targetPrice, ...rest } = deal;

		return {
			...rest,
			amountCents: toCents(amount),
			targetPriceCents: toCents(targetPrice),
			stageChangedAt: deal.stageChangedAt.toISOString(),
			inquiryReceivedAt: deal.inquiryReceivedAt.toISOString(),
			expectedOrderDate: deal.expectedOrderDate?.toISOString() ?? null,
			requiredDeliveryDate: deal.requiredDeliveryDate?.toISOString() ?? null,
			quoteValidUntil: deal.quoteValidUntil?.toISOString() ?? null,
			quotedAt: deal.quotedAt?.toISOString() ?? null,
			closedAt: deal.closedAt?.toISOString() ?? null,
			createdAt: deal.createdAt.toISOString(),
			contacts: contacts.map(({ role, contact }) => ({ ...contact, role })),
			quotations: quotations.map(
				({
					subtotal,
					total,
					validUntil,
					sentAt,
					createdAt,
					items,
					...quotation
				}) => ({
					...quotation,
					subtotalCents: toCents(subtotal) ?? 0,
					totalCents: toCents(total) ?? 0,
					validUntil: validUntil?.toISOString() ?? null,
					sentAt: sentAt?.toISOString() ?? null,
					createdAt: createdAt.toISOString(),
					items: items.map(({ quantity, unitPrice, lineTotal, ...item }) => ({
						...item,
						quantity: Number(quantity),
						unitPriceCents: toCents(unitPrice) ?? 0,
						lineTotalCents: toCents(lineTotal) ?? 0,
					})),
				}),
			),
		};
	}

	async create(input: DealCreateInput, actingUserId: string) {
		await assertCompanyAccess(this.db, actingUserId, input.companyId);
		const ownerId = await resolveOwnerId(this.db, actingUserId, input.ownerId);
		const stage = input.stage ?? "NEW_INQUIRY";
		const now = new Date();
		const receivedAt = parseDate(input.inquiryReceivedAt) ?? now;

		try {
			const inquiryNo = inquiryNumber(receivedAt);
			const deal = await this.db.deal.create({
				data: {
					name: input.name.trim(),
					inquiryNo,
					companyId: input.companyId,
					ownerId: ownerId ?? input.ownerId,
					stage,
					stageChangedAt: now,
					closedAt: isClosedInquiryStage(stage) ? now : null,
					amount: fromCents(input.amountCents),
					currency: (input.currency ?? "USD").toUpperCase(),
					inquiryReceivedAt: receivedAt,
					expectedOrderDate: parseDate(
						input.expectedOrderDate ?? input.expectedCloseDate,
					),
					expectedCloseDate: parseDate(
						input.expectedOrderDate ?? input.expectedCloseDate,
					),
					requiredDeliveryDate: parseDate(input.requiredDeliveryDate),
					productSummary: textValue(input.productSummary),
					specification: textValue(input.specification),
					quantity: textValue(input.quantity),
					unit: textValue(input.unit),
					targetPrice: fromCents(input.targetPriceCents),
					incoterm: input.incoterm ?? null,
					originPort: textValue(input.originPort),
					destinationPort: textValue(input.destinationPort),
					paymentTerms: textValue(input.paymentTerms),
					quoteValidUntil: parseDate(input.quoteValidUntil),
				},
				select: { id: true, name: true, companyId: true },
			});

			this.logger.log({
				message: "Inquiry created",
				dealId: deal.id,
				inquiryNo,
				stage,
			});

			return deal;
		} catch (error) {
			throw this.translateRelations(error);
		}
	}

	async update(id: string, input: DealUpdateInput, actingUserId: string) {
		await assertDealAccess(this.db, actingUserId, id);
		if (input.companyId) {
			await assertCompanyAccess(this.db, actingUserId, input.companyId);
		}
		const data: Prisma.DealUpdateInput = {};

		if (input.name !== undefined) data.name = input.name.trim();
		if (input.companyId !== undefined) {
			data.company = { connect: { id: input.companyId } };
		}
		if (input.ownerId !== undefined) {
			const ownerId = await resolveOwnerId(
				this.db,
				actingUserId,
				input.ownerId,
			);
			data.owner = { connect: { id: ownerId ?? input.ownerId } };
		}
		if (input.amountCents !== undefined)
			data.amount = fromCents(input.amountCents);
		if (input.currency !== undefined)
			data.currency = input.currency.toUpperCase();
		if (input.inquiryReceivedAt !== undefined) {
			data.inquiryReceivedAt = parseDate(input.inquiryReceivedAt) ?? new Date();
		}
		if (
			input.expectedOrderDate !== undefined ||
			input.expectedCloseDate !== undefined
		) {
			const expectedOrderDate = parseDate(
				input.expectedOrderDate ?? input.expectedCloseDate,
			);
			data.expectedOrderDate = expectedOrderDate;
			data.expectedCloseDate = expectedOrderDate;
		}
		if (input.requiredDeliveryDate !== undefined) {
			data.requiredDeliveryDate = parseDate(input.requiredDeliveryDate);
		}
		if (input.productSummary !== undefined) {
			data.productSummary = textValue(input.productSummary);
		}
		if (input.specification !== undefined) {
			data.specification = textValue(input.specification);
		}
		if (input.quantity !== undefined) data.quantity = textValue(input.quantity);
		if (input.unit !== undefined) data.unit = textValue(input.unit);
		if (input.targetPriceCents !== undefined) {
			data.targetPrice = fromCents(input.targetPriceCents);
		}
		if (input.incoterm !== undefined) data.incoterm = input.incoterm;
		if (input.originPort !== undefined)
			data.originPort = textValue(input.originPort);
		if (input.destinationPort !== undefined) {
			data.destinationPort = textValue(input.destinationPort);
		}
		if (input.paymentTerms !== undefined) {
			data.paymentTerms = textValue(input.paymentTerms);
		}
		if (input.quoteValidUntil !== undefined) {
			data.quoteValidUntil = parseDate(input.quoteValidUntil);
		}

		try {
			return await this.db.deal.update({
				where: { id },
				data,
				select: { id: true, name: true },
			});
		} catch (error) {
			throw this.translate(error, id);
		}
	}

	async createQuotation(input: QuotationCreateInput, actingUserId: string) {
		await assertDealAccess(this.db, actingUserId, input.dealId);
		const deal = await this.db.deal.findUnique({
			where: { id: input.dealId },
			select: {
				id: true,
				currency: true,
				incoterm: true,
				originPort: true,
				destinationPort: true,
				paymentTerms: true,
			},
		});
		if (!deal)
			throw new NotFoundException(`No inquiry with id ${input.dealId}.`);

		const result = await this.db.$transaction(async (tx) => {
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.dealId}))`;
			const latest = await tx.quotation.findFirst({
				where: { dealId: input.dealId },
				orderBy: { version: "desc" },
				select: { version: true },
			});
			const version = (latest?.version ?? 0) + 1;
			const lines = quotationLines(input.items);
			const totalCents = lines.reduce(
				(total, line) => total + line.lineTotalCents,
				0,
			);
			const quote = await tx.quotation.create({
				data: {
					quoteNumber: quotationNumber(),
					dealId: input.dealId,
					version,
					currency: (input.currency ?? deal.currency).toUpperCase(),
					incoterm: input.incoterm ?? deal.incoterm,
					originPort: textValue(input.originPort) ?? deal.originPort,
					destinationPort:
						textValue(input.destinationPort) ?? deal.destinationPort,
					paymentTerms: textValue(input.paymentTerms) ?? deal.paymentTerms,
					leadTimeDays: input.leadTimeDays ?? null,
					validUntil: parseDate(input.validUntil),
					notes: textValue(input.notes),
					subtotal: fromCents(totalCents) ?? 0,
					total: fromCents(totalCents) ?? 0,
					items: {
						create: lines.map((line, sortOrder) => ({
							productName: line.productName,
							sku: line.sku,
							specification: line.specification,
							quantity: line.quantity,
							unit: line.unit,
							unitPrice: fromCents(line.unitPriceCents) ?? 0,
							lineTotal: fromCents(line.lineTotalCents) ?? 0,
							sortOrder,
						})),
					},
				},
				select: { id: true, quoteNumber: true, version: true, total: true },
			});
			await tx.deal.update({
				where: { id: input.dealId },
				data: {
					amount: quote.total,
					currency: (input.currency ?? deal.currency).toUpperCase(),
				},
			});
			return quote;
		});

		this.logger.log({
			message: "Quotation created",
			dealId: input.dealId,
			quotationId: result.id,
			quoteNumber: result.quoteNumber,
		});
		return { ...result, totalCents: toCents(result.total) ?? 0 };
	}

	async updateQuotation(
		id: string,
		input: QuotationUpdateInput,
		actingUserId: string,
	) {
		await assertQuotationAccess(this.db, actingUserId, id);
		try {
			return await this.db.$transaction(async (tx) => {
				const existing = await tx.quotation.findUnique({
					where: { id },
					select: { id: true, dealId: true },
				});
				if (!existing)
					throw new NotFoundException(`No quotation with id ${id}.`);

				const lines = input.items ? quotationLines(input.items) : null;
				const totalCents = lines?.reduce(
					(total, line) => total + line.lineTotalCents,
					0,
				);
				const quotation = await tx.quotation.update({
					where: { id },
					data: {
						...(input.currency !== undefined
							? { currency: input.currency.toUpperCase() }
							: {}),
						...(input.incoterm !== undefined
							? { incoterm: input.incoterm }
							: {}),
						...(input.originPort !== undefined
							? { originPort: textValue(input.originPort) }
							: {}),
						...(input.destinationPort !== undefined
							? { destinationPort: textValue(input.destinationPort) }
							: {}),
						...(input.paymentTerms !== undefined
							? { paymentTerms: textValue(input.paymentTerms) }
							: {}),
						...(input.leadTimeDays !== undefined
							? { leadTimeDays: input.leadTimeDays }
							: {}),
						...(input.validUntil !== undefined
							? { validUntil: parseDate(input.validUntil) }
							: {}),
						...(input.notes !== undefined
							? { notes: textValue(input.notes) }
							: {}),
						...(totalCents === undefined
							? {}
							: {
									subtotal: fromCents(totalCents) ?? 0,
									total: fromCents(totalCents) ?? 0,
									items: {
										deleteMany: {},
										create:
											lines?.map((line, sortOrder) => ({
												productName: line.productName,
												sku: line.sku,
												specification: line.specification,
												quantity: line.quantity,
												unit: line.unit,
												unitPrice: fromCents(line.unitPriceCents) ?? 0,
												lineTotal: fromCents(line.lineTotalCents) ?? 0,
												sortOrder,
											})) ?? [],
									},
								}),
					},
					select: { id: true, dealId: true, total: true, currency: true },
				});
				if (totalCents !== undefined) {
					await tx.deal.update({
						where: { id: quotation.dealId },
						data: { amount: quotation.total, currency: quotation.currency },
					});
				}
				return { ...quotation, totalCents: toCents(quotation.total) ?? 0 };
			});
		} catch (error) {
			throw this.translateQuotation(error, id);
		}
	}

	async deleteQuotation(id: string, actingUserId: string) {
		await assertQuotationAccess(this.db, actingUserId, id);
		try {
			const quotation = await this.db.quotation.delete({
				where: { id },
				select: { id: true, quoteNumber: true },
			});
			return quotation;
		} catch (error) {
			throw this.translateQuotation(error, id);
		}
	}

	async convertQuotationToOrder(id: string, actingUserId: string) {
		await assertQuotationAccess(this.db, actingUserId, id);
		try {
			const result = await this.db.$transaction(async (tx) => {
				const quotation = await tx.quotation.findUnique({
					where: { id },
					select: {
						id: true,
						quoteNumber: true,
						currency: true,
						incoterm: true,
						originPort: true,
						destinationPort: true,
						paymentTerms: true,
						notes: true,
						total: true,
						dealId: true,
						deal: { select: { stage: true, companyId: true } },
						items: { orderBy: { sortOrder: "asc" } },
					},
				});
				if (!quotation) {
					throw new NotFoundException(`No quotation with id ${id}.`);
				}

				const existing = await tx.salesOrder.findUnique({
					where: { quotationId: id },
					select: { id: true, orderNumber: true },
				});
				if (existing) {
					return {
						...existing,
						created: false,
						companyId: quotation.deal.companyId,
						dealId: quotation.dealId,
					};
				}

				const now = new Date();
				const order = await tx.salesOrder.create({
					data: {
						orderNumber: proformaNumber(),
						dealId: quotation.dealId,
						quotationId: id,
						currency: quotation.currency,
						incoterm: quotation.incoterm,
						paymentTerms: quotation.paymentTerms,
						notes: quotation.notes,
						totalAmount: quotation.total,
						items: {
							create: quotation.items.map((item) => ({
								sku: item.sku,
								description: [item.productName, item.specification]
									.filter(Boolean)
									.join(" — "),
								quantity: item.quantity,
								unitPrice: item.unitPrice,
								totalPrice: item.lineTotal,
							})),
						},
					},
					select: { id: true, orderNumber: true },
				});

				if (
					!isClosedInquiryStage(quotation.deal.stage) &&
					quotation.deal.stage !== "PROFORMA_INVOICE"
				) {
					await tx.deal.update({
						where: { id: quotation.dealId },
						data: { stage: "PROFORMA_INVOICE", stageChangedAt: now },
					});
					await tx.activity.create({
						data: {
							type: ActivityType.STAGE_CHANGE,
							subject: "Inquiry stage changed",
							occurredAt: now,
							companyId: quotation.deal.companyId,
							dealId: quotation.dealId,
							createdById: actingUserId,
							meta: { from: quotation.deal.stage, to: "PROFORMA_INVOICE" },
						},
					});
				}

				return {
					...order,
					created: true,
					companyId: quotation.deal.companyId,
					dealId: quotation.dealId,
				};
			});

			if (result.created) {
				this.logger.log({
					message: "Quotation converted to proforma invoice",
					quotationId: id,
					orderId: result.id,
					orderNumber: result.orderNumber,
				});
				await this.stamp.touch(
					{ companyId: result.companyId, dealId: result.dealId },
					new Date(),
				);
				await this.agent.inquiryChanged(
					result.dealId,
					"A quotation became a proforma invoice",
				);
			}

			return result;
		} catch (error) {
			throw this.translateQuotation(error, id);
		}
	}

	async samples(dealId: string) {
		const rows = await this.db.sample.findMany({
			where: { dealId },
			orderBy: { createdAt: "desc" },
		});
		return rows.map((row) => ({
			...row,
			sentAt: row.shippedAt?.toISOString() ?? null,
			deliveredAt: row.deliveredAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		}));
	}

	async createSample(input: SampleCreateInput, actingUserId: string) {
		await assertDealAccess(this.db, actingUserId, input.dealId);
		const row = await this.db.sample.create({
			data: {
				dealId: input.dealId,
				product: input.product.trim(),
				variant: input.variant?.trim() ?? null,
				quantity: input.quantity,
				shipTo: input.shipTo?.trim() ?? null,
				courier: input.courier?.trim() ?? null,
				trackingNo: input.trackingNo?.trim() ?? null,
				notes: input.notes?.trim() ?? null,
			},
			select: { id: true },
		});
		return row;
	}

	async updateSample(
		id: string,
		input: SampleUpdateInput,
		actingUserId: string,
	) {
		await assertSampleAccess(this.db, actingUserId, id);
		const data: Prisma.SampleUpdateInput = {};
		if (input.status !== undefined) data.status = input.status;
		if (input.product !== undefined) data.product = input.product.trim();
		if (input.variant !== undefined)
			data.variant = input.variant?.trim() ?? null;
		if (input.quantity !== undefined) data.quantity = input.quantity;
		if (input.shipTo !== undefined) data.shipTo = input.shipTo?.trim() ?? null;
		if (input.courier !== undefined)
			data.courier = input.courier?.trim() ?? null;
		if (input.trackingNo !== undefined)
			data.trackingNo = input.trackingNo?.trim() ?? null;
		if (input.notes !== undefined) data.notes = input.notes?.trim() ?? null;
		if (input.status === "SHIPPED") data.shippedAt = new Date();
		if (input.status === "DELIVERED") data.deliveredAt = new Date();
		return this.db.sample.update({
			where: { id },
			data,
			select: { id: true },
		});
	}

	async deleteSample(id: string, actingUserId: string) {
		await assertSampleAccess(this.db, actingUserId, id);
		return this.db.sample.delete({ where: { id }, select: { id: true } });
	}

	async orders(dealId: string) {
		const rows = await this.db.salesOrder.findMany({
			where: { dealId },
			orderBy: { createdAt: "desc" },
			include: {
				items: true,
				payments: { orderBy: [{ expectedAt: "asc" }, { createdAt: "asc" }] },
			},
		});
		return rows.map((row) => {
			const {
				payments: rawPayments,
				items,
				totalAmount,
				createdAt,
				updatedAt,
				productionStart,
				productionEnd,
				shipDate,
				deliveryDate,
				...rest
			} = row;
			const payments = rawPayments.map((payment) => ({
				id: payment.id,
				kind: payment.kind,
				amountCents: toCents(payment.amount) ?? 0,
				expectedAt: payment.expectedAt?.toISOString() ?? null,
				receivedAt: payment.receivedAt?.toISOString() ?? null,
				reference: payment.reference,
				notes: payment.notes,
				createdAt: payment.createdAt.toISOString(),
			}));
			const receivedCents = payments.reduce(
				(total, payment) =>
					total + (payment.receivedAt === null ? 0 : payment.amountCents),
				0,
			);
			return {
				...rest,
				totalAmount: Number(totalAmount),
				totalCents: toCents(totalAmount) ?? 0,
				receivedCents,
				createdAt: createdAt.toISOString(),
				updatedAt: updatedAt.toISOString(),
				productionStart: productionStart?.toISOString() ?? null,
				productionEnd: productionEnd?.toISOString() ?? null,
				shipDate: shipDate?.toISOString() ?? null,
				deliveryDate: deliveryDate?.toISOString() ?? null,
				items: items.map((item) => ({
					...item,
					quantity: Number(item.quantity),
					unitPrice: Number(item.unitPrice),
					totalPrice: Number(item.totalPrice),
					createdAt: item.createdAt.toISOString(),
				})),
				payments,
			};
		});
	}

	async createOrder(input: OrderCreateInput, actingUserId: string) {
		await assertDealAccess(this.db, actingUserId, input.dealId);
		const total = input.items.reduce(
			(sum, item) => sum + item.quantity * item.unitPrice,
			0,
		);
		const orderNumber = `SO-${Date.now().toString(36).toUpperCase()}`;
		const row = await this.db.salesOrder.create({
			data: {
				orderNumber,
				dealId: input.dealId,
				currency: input.currency,
				incoterm: input.incoterm as Incoterm | undefined,
				paymentTerms: input.paymentTerms?.trim() ?? null,
				notes: input.notes?.trim() ?? null,
				totalAmount: total,
				items: {
					create: input.items.map((item) => ({
						sku: item.sku?.trim() ?? null,
						description: item.description.trim(),
						quantity: item.quantity,
						unitPrice: item.unitPrice,
						totalPrice: item.quantity * item.unitPrice,
					})),
				},
			},
			select: { id: true, orderNumber: true },
		});
		return row;
	}

	async updateOrder(id: string, input: OrderUpdateInput, actingUserId: string) {
		await assertSalesOrderAccess(this.db, actingUserId, id);
		const data: Prisma.SalesOrderUpdateInput = {};
		if (input.status !== undefined) data.status = input.status;
		if (input.currency !== undefined) data.currency = input.currency.trim();
		if (input.incoterm !== undefined)
			data.incoterm = input.incoterm as Incoterm | null | undefined;
		if (input.paymentTerms !== undefined)
			data.paymentTerms = input.paymentTerms?.trim() ?? null;
		if (input.notes !== undefined) data.notes = input.notes?.trim() ?? null;
		if (input.productionStart !== undefined)
			data.productionStart = input.productionStart
				? new Date(input.productionStart)
				: null;
		if (input.productionEnd !== undefined)
			data.productionEnd = input.productionEnd
				? new Date(input.productionEnd)
				: null;
		if (input.shipDate !== undefined)
			data.shipDate = input.shipDate ? new Date(input.shipDate) : null;
		if (input.deliveryDate !== undefined)
			data.deliveryDate = input.deliveryDate
				? new Date(input.deliveryDate)
				: null;
		return this.db.salesOrder.update({
			where: { id },
			data,
			select: { id: true },
		});
	}

	async deleteOrder(id: string, actingUserId: string) {
		await assertSalesOrderAccess(this.db, actingUserId, id);
		return this.db.salesOrder.delete({ where: { id }, select: { id: true } });
	}

	async createPayment(input: PaymentCreateInput, actingUserId: string) {
		await assertSalesOrderAccess(this.db, actingUserId, input.orderId);
		const row = await this.db.payment.create({
			data: {
				orderId: input.orderId,
				kind: input.kind,
				amount: fromCents(input.amountCents) ?? 0,
				expectedAt: parseDate(input.expectedAt),
				receivedAt: parseDate(input.receivedAt),
				reference: textValue(input.reference),
				notes: textValue(input.notes),
			},
			select: { id: true },
		});
		this.logger.log({
			message: "Payment recorded",
			orderId: input.orderId,
			paymentId: row.id,
			kind: input.kind,
		});
		return row;
	}

	async updatePayment(
		id: string,
		input: PaymentUpdateInput,
		actingUserId: string,
	) {
		await assertPaymentAccess(this.db, actingUserId, id);
		const data: Prisma.PaymentUpdateInput = {};
		if (input.kind !== undefined) data.kind = input.kind;
		if (input.amountCents !== undefined) {
			data.amount = fromCents(input.amountCents) ?? 0;
		}
		if (input.expectedAt !== undefined) {
			data.expectedAt = parseDate(input.expectedAt);
		}
		if (input.receivedAt !== undefined) {
			data.receivedAt = parseDate(input.receivedAt);
		}
		if (input.reference !== undefined) {
			data.reference = textValue(input.reference);
		}
		if (input.notes !== undefined) data.notes = textValue(input.notes);
		try {
			return await this.db.payment.update({
				where: { id },
				data,
				select: { id: true },
			});
		} catch (error) {
			throw this.translatePayment(error, id);
		}
	}

	async deletePayment(id: string, actingUserId: string) {
		await assertPaymentAccess(this.db, actingUserId, id);
		try {
			return await this.db.payment.delete({
				where: { id },
				select: { id: true },
			});
		} catch (error) {
			throw this.translatePayment(error, id);
		}
	}

	async setQuotationStatus(
		id: string,
		status: QuotationStatus,
		actingUserId: string,
	) {
		await assertQuotationAccess(this.db, actingUserId, id);
		try {
			return await this.db.$transaction(async (tx) => {
				const quotation = await tx.quotation.findUnique({
					where: { id },
					select: { id: true, dealId: true, status: true },
				});
				if (!quotation)
					throw new NotFoundException(`No quotation with id ${id}.`);
				const now = new Date();
				const updated = await tx.quotation.update({
					where: { id },
					data: { status, sentAt: status === "SENT" ? now : undefined },
					select: { id: true, status: true, dealId: true },
				});
				if (status === "SENT") {
					await tx.deal.updateMany({
						where: {
							id: quotation.dealId,
							stage: {
								in: ["NEW_INQUIRY", "CONTACTED", "REPLIED", "RFQ_RECEIVED"],
							},
						},
						data: { stage: "QUOTED", stageChangedAt: now, quotedAt: now },
					});
				}
				return updated;
			});
		} catch (error) {
			throw this.translateQuotation(error, id);
		}
	}

	async delete(
		id: string,
		actingUserId: string,
	): Promise<{ id: string; name: string }> {
		await assertDealAccess(this.db, actingUserId, id);
		let deleted: { targets: StampTargets; name: string };

		try {
			deleted = await this.db.$transaction(async (tx) => {
				const targets = await this.stamp.targetsOf({ dealId: id }, tx);

				const deal = await tx.deal.delete({
					where: { id },
					select: { name: true },
				});

				return { targets, name: deal.name };
			});
		} catch (error) {
			throw this.translate(error, id);
		}

		await this.stamp.recomputeAfterDelete(deleted.targets, { dealId: id });

		this.logger.log({
			message: "Inquiry deleted",
			dealId: id,
			name: deleted.name,
		});

		return { id, name: deleted.name };
	}

	async setStage(input: SetStageInput, actingUserId: string) {
		await assertDealAccess(this.db, actingUserId, input.id);
		const deal = await this.db.deal.findUnique({
			where: { id: input.id },
			select: { id: true, stage: true, companyId: true },
		});

		if (!deal) {
			throw new NotFoundException(`No inquiry with id ${input.id}.`);
		}

		if (deal.stage === input.stage) {
			return { id: deal.id, stage: deal.stage, changed: false };
		}

		const closedReason = input.closedReason?.trim();
		if (isLosingInquiryStage(input.stage) && !closedReason) {
			throw new BadRequestException(
				"Say why it was lost — an inquiry with no reason teaches nobody anything.",
			);
		}

		const now = new Date();
		const closed = isClosedInquiryStage(input.stage);

		const [updated] = await this.db.$transaction([
			this.db.deal.update({
				where: { id: input.id },
				data: {
					stage: input.stage,
					stageChangedAt: now,
					closedAt: closed ? now : null,
					closedReason: closed ? (closedReason ?? null) : null,
				},
				select: { id: true, stage: true },
			}),
			this.db.activity.create({
				data: {
					type: ActivityType.STAGE_CHANGE,
					subject: "Inquiry stage changed",
					body: closedReason ?? null,
					occurredAt: now,
					companyId: deal.companyId,
					dealId: deal.id,
					createdById: actingUserId,
					meta: { from: deal.stage, to: input.stage },
				},
			}),
		]);

		await this.stamp.touch(
			{ companyId: deal.companyId, dealId: deal.id },
			new Date(),
		);

		this.logger.log({
			message: "Inquiry stage changed",
			dealId: deal.id,
			from: deal.stage,
			to: input.stage,
		});

		await this.agent.inquiryChanged(
			deal.id,
			`Stage changed from ${deal.stage} to ${input.stage}`,
		);

		return { ...updated, changed: true };
	}

	private searchFilter(q: string): Prisma.DealWhereInput {
		const term = q.trim();
		if (!term) return {};

		return {
			OR: [
				{ name: { contains: term, mode: "insensitive" } },
				{ inquiryNo: { contains: term, mode: "insensitive" } },
				{ productSummary: { contains: term, mode: "insensitive" } },
				{ company: { name: { contains: term, mode: "insensitive" } } },
			],
		};
	}

	private buildWhere(input: DealListInput): Prisma.DealWhereInput {
		const clauses: Prisma.DealWhereInput[] = [this.searchFilter(input.q)];

		if (input.owner !== FACET_ALL) {
			clauses.push({
				ownerId: input.owner === FACET_UNASSIGNED ? { in: [] } : input.owner,
			});
		}

		if (input.status === "open") {
			clauses.push({ stage: { in: [...OPEN_INQUIRY_STAGES] } });
		} else if (input.status === "closed") {
			clauses.push({ stage: { in: [...CLOSED_INQUIRY_STAGES] } });
		}

		if (input.stage !== FACET_ALL) {
			clauses.push({ stage: input.stage as DealStage });
		}

		if (input.closing !== FACET_ALL) {
			clauses.push(closingFilter(input.closing as ClosingWindow));
		}

		return { AND: clauses };
	}

	private async facetCounts(input: DealListInput) {
		const where = this.searchFilter(input.q);

		const [owners, stages, ...closingCounts] = await Promise.all([
			this.db.deal.groupBy({ by: ["ownerId"], where, _count: { _all: true } }),
			this.db.deal.groupBy({ by: ["stage"], where, _count: { _all: true } }),
			...CLOSING_WINDOWS.map((window) =>
				this.db.deal.count({ where: { ...where, ...closingFilter(window) } }),
			),
		]);

		const stageCounts = countsByKey(stages, "stage");
		const openCount = OPEN_INQUIRY_STAGES.reduce(
			(total, stage) => total + (stageCounts[stage] ?? 0),
			0,
		);
		const closedCount = CLOSED_INQUIRY_STAGES.reduce(
			(total, stage) => total + (stageCounts[stage] ?? 0),
			0,
		);

		return {
			status: { open: openCount, closed: closedCount },
			owner: countsByKey(owners, "ownerId", FACET_UNASSIGNED),
			stage: stageCounts,
			closing: Object.fromEntries(
				CLOSING_WINDOWS.map((window, index) => [
					window,
					closingCounts[index] ?? 0,
				]),
			),
		};
	}

	private translateQuotation(error: unknown, id: string): unknown {
		if (
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			error.code === "P2025"
		) {
			return new NotFoundException(`No quotation with id ${id}.`);
		}
		return error;
	}

	private translatePayment(error: unknown, id: string): unknown {
		if (
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			error.code === "P2025"
		) {
			return new NotFoundException(`No payment with id ${id}.`);
		}
		return error;
	}

	private translate(error: unknown, id: string): unknown {
		if (
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			error.code === "P2025"
		) {
			return new NotFoundException(`No deal with id ${id}.`);
		}
		return this.translateRelations(error);
	}

	private translateRelations(error: unknown): unknown {
		if (
			error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
			(error.code === "P2003" || error.code === "P2025")
		) {
			return new BadRequestException(
				"That company or owner does not exist any more.",
			);
		}
		return error;
	}
}

function closingFilter(window: ClosingWindow): Prisma.DealWhereInput {
	const now = new Date();
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	const startOfMonthAfter = new Date(now.getFullYear(), now.getMonth() + 2, 1);

	switch (window) {
		case "overdue":
			return {
				expectedOrderDate: { lt: now },
				stage: { in: [...OPEN_INQUIRY_STAGES] },
			};
		case "this-month":
			return {
				expectedOrderDate: { gte: startOfMonth, lt: startOfNextMonth },
			};
		case "next-month":
			return {
				expectedOrderDate: { gte: startOfNextMonth, lt: startOfMonthAfter },
			};
		case "later":
			return { expectedOrderDate: { gte: startOfMonthAfter } };
		case "none":
			return { expectedOrderDate: null };
	}
}

function parseDate(value: string | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new BadRequestException(`"${value}" is not a date.`);
	}
	return date;
}

function textValue(value: string | null | undefined): string | null {
	return value === null || value === undefined ? null : blankToNull(value);
}

function inquiryNumber(receivedAt: Date): string {
	const stamp = receivedAt
		.toISOString()
		.replace(/[-:TZ.]/g, "")
		.slice(0, 14);
	return `INQ-${stamp}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

function quotationNumber(): string {
	const now = new Date();
	const stamp = now
		.toISOString()
		.replace(/[-:TZ.]/g, "")
		.slice(0, 14);
	return `QT-${stamp}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

function proformaNumber(): string {
	const now = new Date();
	const stamp = now
		.toISOString()
		.replace(/[-:TZ.]/g, "")
		.slice(0, 14);
	return `PI-${stamp}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

function quotationLines(
	items: QuotationCreateInput["items"],
): Array<QuotationCreateInput["items"][number] & { lineTotalCents: number }> {
	return items.map((item) => ({
		...item,
		lineTotalCents: Math.round(item.quantity * item.unitPriceCents),
	}));
}
