import { Controller, Get, Headers, Logger, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { assertCronAuthorized } from "../google/sync.controller";
import { RemindersService } from "./reminders.service";

@Controller("internal/sync")
export class RemindersController {
	private readonly logger = new Logger(RemindersController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly reminders: RemindersService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("reminders")
	@AllowAnonymous()
	async remindersViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("reminders")
	@AllowAnonymous()
	async remindersViaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	private async run(authorization?: string) {
		assertCronAuthorized(authorization, this.secret, this.logger, "reminders");
		return this.reminders.runDue();
	}
}
