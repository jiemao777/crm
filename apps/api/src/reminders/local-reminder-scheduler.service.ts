import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { RemindersService } from "./reminders.service";

const LOCAL_REMINDER_INTERVAL_MS = 6 * 60 * 60_000;

@Injectable()
export class LocalReminderSchedulerService
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private readonly logger = new Logger(LocalReminderSchedulerService.name);
	private timer: ReturnType<typeof setInterval> | null = null;
	private running: Promise<unknown> | null = null;

	constructor(
		private readonly reminders: RemindersService,
		private readonly config: ConfigService<EnvironmentVariables, true>,
	) {}

	onApplicationBootstrap(): void {
		if (this.config.get("NODE_ENV", { infer: true }) !== "development") {
			return;
		}

		this.timer = setInterval(() => {
			this.scheduleRun();
		}, LOCAL_REMINDER_INTERVAL_MS);
		this.timer.unref();

		this.logger.log({
			message: "Local reminder sweep scheduled",
			intervalMs: LOCAL_REMINDER_INTERVAL_MS,
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
		this.running = this.reminders
			.runDue()
			.catch((error: unknown) => {
				this.logger.error({
					message: "Local reminder sweep failed",
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				this.running = null;
			});
	}
}
