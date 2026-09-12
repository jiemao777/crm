import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Logger,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { GoogleSyncService } from "./google-sync.service";

@Controller("internal/sync")
export class SyncController {
	private readonly logger = new Logger(SyncController.name);
	private readonly secret: string | undefined;

	constructor(
		private readonly sync: GoogleSyncService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("google")
	@AllowAnonymous()
	async googleViaGet(@Headers("authorization") authorization?: string) {
		return this.google(authorization);
	}

	@Post("google")
	@AllowAnonymous()
	async googleViaPost(@Headers("authorization") authorization?: string) {
		return this.google(authorization);
	}

	private async google(authorization?: string) {
		assertCronAuthorized(
			authorization,
			this.secret,
			this.logger,
			"google sync",
		);
		return this.sync.runDue();
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}

export function assertCronAuthorized(
	authorization: string | undefined,
	secret: string | undefined,
	logger: Logger,
	route: string,
): void {
	if (!secret) {
		logger.error({
			message: `CRON_SECRET is not set — refusing to run ${route}.`,
		});
		throw new ServiceUnavailableException("Cron route is not configured.");
	}

	if (!timingSafeEquals(authorization ?? "", `Bearer ${secret}`)) {
		throw new ForbiddenException();
	}
}
