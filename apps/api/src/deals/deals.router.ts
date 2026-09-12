import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import {
	dealCreateInput,
	dealIdInput,
	dealListInput,
	dealUpdateArgs,
	orderCreateInput,
	orderIdInput,
	orderUpdateArgs,
	paymentCreateInput,
	paymentIdInput,
	paymentUpdateArgs,
	quotationCreateInput,
	quotationIdInput,
	quotationUpdateArgs,
	sampleCreateInput,
	sampleIdInput,
	sampleUpdateArgs,
	setQuotationStatusInput,
	setStageInput,
} from "./deals.contracts";
import { DealsService } from "./deals.service";

@Router({ alias: "deals" })
@UseMiddlewares(AuthMiddleware)
export class DealsRouter {
	constructor(@Inject(DealsService) private readonly deals: DealsService) {}

	@Query({ input: dealListInput })
	async list(@Input() input: z.infer<typeof dealListInput>) {
		return this.deals.list(input);
	}

	@Query({ input: dealIdInput })
	async byId(@Input("id") id: string) {
		return this.deals.byId(id);
	}

	@Mutation({ input: dealCreateInput })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealCreateInput>,
	) {
		return this.deals.create(input, ctx.user.id);
	}

	@Mutation({ input: dealUpdateArgs })
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof dealUpdateArgs>,
	) {
		return this.deals.update(input.id, input.data, ctx.user.id);
	}

	@Mutation({ input: dealIdInput })
	async delete(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.deals.delete(id, ctx.user.id);
	}

	@Mutation({ input: setStageInput })
	async setStage(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setStageInput>,
	) {
		return this.deals.setStage(input, ctx.user.id);
	}

	@Mutation({ input: quotationCreateInput })
	async createQuotation(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof quotationCreateInput>,
	) {
		return this.deals.createQuotation(input, ctx.user.id);
	}

	@Mutation({ input: quotationUpdateArgs })
	async updateQuotation(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof quotationUpdateArgs>,
	) {
		return this.deals.updateQuotation(input.id, input.data, ctx.user.id);
	}

	@Mutation({ input: setQuotationStatusInput })
	async setQuotationStatus(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setQuotationStatusInput>,
	) {
		return this.deals.setQuotationStatus(input.id, input.status, ctx.user.id);
	}

	@Mutation({ input: quotationIdInput })
	async deleteQuotation(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("id") id: string,
	) {
		return this.deals.deleteQuotation(id, ctx.user.id);
	}

	@Mutation({ input: quotationIdInput })
	async convertQuotationToOrder(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("id") id: string,
	) {
		return this.deals.convertQuotationToOrder(id, ctx.user.id);
	}

	@Query({ input: dealIdInput })
	async samples(@Input("id") dealId: string) {
		return this.deals.samples(dealId);
	}

	@Mutation({ input: sampleCreateInput })
	async createSample(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof sampleCreateInput>,
	) {
		return this.deals.createSample(input, ctx.user.id);
	}

	@Mutation({ input: sampleUpdateArgs })
	async updateSample(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof sampleUpdateArgs>,
	) {
		return this.deals.updateSample(input.id, input.data, ctx.user.id);
	}

	@Mutation({ input: sampleIdInput })
	async deleteSample(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.deals.deleteSample(id, ctx.user.id);
	}

	@Query({ input: dealIdInput })
	async orders(@Input("id") dealId: string) {
		return this.deals.orders(dealId);
	}

	@Mutation({ input: orderCreateInput })
	async createOrder(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof orderCreateInput>,
	) {
		return this.deals.createOrder(input, ctx.user.id);
	}

	@Mutation({ input: orderUpdateArgs })
	async updateOrder(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof orderUpdateArgs>,
	) {
		return this.deals.updateOrder(input.id, input.data, ctx.user.id);
	}

	@Mutation({ input: orderIdInput })
	async deleteOrder(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.deals.deleteOrder(id, ctx.user.id);
	}

	@Mutation({ input: paymentCreateInput })
	async createPayment(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof paymentCreateInput>,
	) {
		return this.deals.createPayment(input, ctx.user.id);
	}

	@Mutation({ input: paymentUpdateArgs })
	async updatePayment(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof paymentUpdateArgs>,
	) {
		return this.deals.updatePayment(input.id, input.data, ctx.user.id);
	}

	@Mutation({ input: paymentIdInput })
	async deletePayment(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.deals.deletePayment(id, ctx.user.id);
	}
}
