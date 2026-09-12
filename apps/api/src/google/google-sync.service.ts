import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { CalendarSyncService } from "./calendar-sync.service";
import { GmailSyncService } from "./gmail-sync.service";
import type { SyncSource } from "./google.constants";
import { GoogleConnectionService } from "./google-connection.service";
import { SyncStateService } from "./sync-state.service";
import { ZohoConnectionService } from "./zoho-connection.service";

const TICK_BUDGET_MS = 60_000;

export type TickSummary = {
	attempted: number;
	synced: number;
	skipped: number;
	failed: number;
	durationMs: number;
};

@Injectable()
export class GoogleSyncService {
	private readonly logger = new Logger(GoogleSyncService.name);

	constructor(
		private readonly state: SyncStateService,
		private readonly calendar: CalendarSyncService,
		private readonly gmail: GmailSyncService,
		private readonly connections: GoogleConnectionService,
		private readonly zoho: ZohoConnectionService,
	) {}

	async runDue(): Promise<TickSummary> {
		const startedAt = Date.now();
		const summary: TickSummary = {
			attempted: 0,
			synced: 0,
			skipped: 0,
			failed: 0,
			durationMs: 0,
		};

		await this.connections.reconcileAll();

		const due = await this.state.due(new Date());

		for (const row of due) {
			if (Date.now() - startedAt > TICK_BUDGET_MS) {
				this.logger.log({
					message: "Sync tick budget reached",
					remaining: due.length - summary.attempted,
				});
				break;
			}

			summary.attempted += 1;

			try {
				const outcome = await this.runOne(row.userId, row.source as SyncSource);

				if (outcome === null || outcome.status === "skipped") {
					summary.skipped += 1;
				} else if (
					outcome.status === "failed" ||
					outcome.status === "reconnect"
				) {
					summary.failed += 1;
				} else {
					summary.synced += 1;
				}
			} catch (error) {
				summary.failed += 1;
				await this.state.markFailed(
					row.id,
					error instanceof Error ? error.message : String(error),
				);
				this.logger.error(
					{
						message: "Sync threw",
						userId: row.userId,
						source: row.source,
					},
					error instanceof Error ? error.stack : String(error),
				);
			}
		}

		if (Date.now() - startedAt <= TICK_BUDGET_MS) {
			try {
				const zoho = await this.zoho.runDue(
					new Date(),
					startedAt + TICK_BUDGET_MS,
				);
				summary.attempted += zoho.attempted;
				summary.synced += zoho.synced;
				summary.skipped += zoho.skipped;
				summary.failed += zoho.failed;
			} catch (error) {
				summary.failed += 1;
				this.logger.error(
					{ message: "Zoho IMAP sync tick threw" },
					error instanceof Error ? error.stack : String(error),
				);
			}
		}

		summary.durationMs = Date.now() - startedAt;

		this.logger.log({
			message: "Google sync tick",
			attempted: summary.attempted,
			synced: summary.synced,
			skipped: summary.skipped,
			failed: summary.failed,
			durationMs: summary.durationMs,
		});

		return summary;
	}

	async runOne(userId: string, source: SyncSource) {
		const row = await this.state.get(userId, source);
		if (!row) return null;

		return source === "calendar"
			? this.calendar.sync(row)
			: this.gmail.sync(row);
	}

	async runForUser(userId: string): Promise<void> {
		for (const source of ["calendar", "gmail"] as const) {
			await this.runOne(userId, source);
		}
	}

	async refreshMail(userId: string): Promise<{ providers: string[] }> {
		const [google, zoho] = await Promise.all([
			this.connections.status(userId),
			this.zoho.status(userId),
		]);
		const providers: string[] = [];
		if (
			google.sources.some(
				(source) => source.source === "gmail" && source.connected,
			)
		) {
			await this.runOne(userId, "gmail");
			providers.push("gmail");
		}
		if (zoho.connected) {
			await this.zoho.syncNow(userId);
			providers.push("zoho");
		}
		if (providers.length === 0) {
			throw new NotFoundException(
				"Connect Gmail or Zoho Mail before refreshing.",
			);
		}
		return { providers };
	}
}
