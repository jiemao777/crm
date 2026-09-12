import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { GoogleSyncService } from "./google-sync.service";

export const LOCAL_SYNC_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class LocalSyncSchedulerService
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private readonly logger = new Logger(LocalSyncSchedulerService.name);
	private timer: ReturnType<typeof setInterval> | null = null;
	private running: Promise<void> | null = null;

	constructor(
		private readonly sync: GoogleSyncService,
		private readonly config: ConfigService<EnvironmentVariables, true>,
	) {}

	onApplicationBootstrap(): void {
		if (this.config.get("NODE_ENV", { infer: true }) !== "development") {
			return;
		}

		this.timer = setInterval(() => {
			this.scheduleRun();
		}, LOCAL_SYNC_INTERVAL_MS);
		this.timer.unref();

		this.logger.log({
			message: "Local mailbox sync scheduled",
			intervalMs: LOCAL_SYNC_INTERVAL_MS,
		});
		this.scheduleRun();
	}

	async onApplicationShutdown(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		await this.running;
	}

	private scheduleRun(): void {
		if (this.running) return;
		this.running = this.run().finally(() => {
			this.running = null;
		});
	}

	private async run(): Promise<void> {
		try {
			await this.sync.runDue();
		} catch (error) {
			this.logger.error(
				{ message: "Local mailbox sync failed" },
				error instanceof Error ? error.stack : String(error),
			);
		}
	}
}
