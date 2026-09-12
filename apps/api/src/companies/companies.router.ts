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
	aiExtractInput,
	companyCreateInput,
	companyIdInput,
	companyListInput,
	companyMergeInput,
	companyOptionsInput,
	companyUpdateArgs,
	setPrimaryContactInput,
} from "./companies.contracts";
import { CompaniesService } from "./companies.service";

@Router({ alias: "companies" })
@UseMiddlewares(AuthMiddleware)
export class CompaniesRouter {
	constructor(
		@Inject(CompaniesService) private readonly companies: CompaniesService,
	) {}

	@Query({ input: companyListInput })
	async list(@Input() input: z.infer<typeof companyListInput>) {
		return this.companies.list(input);
	}

	@Query({ input: companyIdInput })
	async byId(@Input("id") id: string) {
		return this.companies.byId(id);
	}

	@Query({ input: companyOptionsInput })
	async options(@Input("q") q: string) {
		return this.companies.options(q);
	}

	@Mutation({ input: aiExtractInput })
	async aiExtract(@Input("text") text: string) {
		return this.companies.aiExtract(text);
	}

	@Mutation({ input: companyCreateInput })
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof companyCreateInput>,
	) {
		return this.companies.create(input, ctx.user.id);
	}

	@Mutation({ input: companyUpdateArgs })
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof companyUpdateArgs>,
	) {
		return this.companies.update(input.id, input.data, ctx.user.id);
	}

	@Mutation({ input: companyIdInput })
	async delete(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.companies.delete(id, ctx.user.id);
	}

	@Query()
	async duplicates() {
		return this.companies.duplicates();
	}

	@Mutation({ input: companyMergeInput })
	async merge(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof companyMergeInput>,
	) {
		return this.companies.merge(input.keepId, input.mergeId, ctx.user.id);
	}

	@Mutation({ input: companyIdInput })
	async enrich(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.companies.enrich(id, ctx.user.id);
	}

	@Mutation({ input: companyIdInput })
	async research(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.companies.research(id, ctx.user.id);
	}

	@Mutation({ input: setPrimaryContactInput })
	async setPrimaryContact(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setPrimaryContactInput>,
	) {
		return this.companies.setPrimaryContact(
			input.companyId,
			input.contactId,
			ctx.user.id,
		);
	}
}
