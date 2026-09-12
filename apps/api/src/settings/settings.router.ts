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
	activateAgentProviderInput,
	agentProviderInput,
	deleteAgentProviderInput,
	setResearchProviderInput,
} from "./settings.contracts";
import { SettingsService } from "./settings.service";

@Router({ alias: "settings" })
@UseMiddlewares(AuthMiddleware)
export class SettingsRouter {
	constructor(
		@Inject(SettingsService) private readonly settings: SettingsService,
	) {}

	@Query()
	async agentProviders() {
		return this.settings.agentProviders();
	}

	@Mutation({ input: agentProviderInput })
	async saveAgentProvider(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof agentProviderInput>,
	) {
		return this.settings.saveAgentProvider(input, ctx.user.id);
	}

	@Mutation({ input: agentProviderInput })
	async testAgentProvider(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof agentProviderInput>,
	) {
		return this.settings.testAgentProvider(input, ctx.user.id);
	}

	@Mutation({ input: activateAgentProviderInput })
	async activateAgentProvider(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof activateAgentProviderInput>,
	) {
		return this.settings.activateAgentProvider(input.providerId, ctx.user.id);
	}

	@Mutation({ input: deleteAgentProviderInput })
	async deleteAgentProvider(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof deleteAgentProviderInput>,
	) {
		return this.settings.deleteAgentProvider(input.providerId, ctx.user.id);
	}

	@Query()
	async researchProvider() {
		return this.settings.researchProvider();
	}

	@Mutation({ input: setResearchProviderInput })
	async setResearchProvider(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setResearchProviderInput>,
	) {
		return this.settings.setResearchProvider(input, ctx.user.id);
	}
}
