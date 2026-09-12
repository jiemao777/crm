import { isGoogleConfigured, signsInWithGoogle } from "@crm/auth";
import { type Db, GoogleSyncStatus } from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { normalizeDomain } from "../companies/domain";
import { requireWorkspaceAdmin } from "../crm/access";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import {
	GOOGLE_PROVIDER_ID,
	SCOPE_FOR_SOURCE,
	SYNC_SOURCES,
	type SyncSource,
} from "./google.constants";
import { GoogleMatchService } from "./google-match.service";
import { GoogleTokenService } from "./google-token.service";
import { SyncStateService } from "./sync-state.service";

export type SourceStatus = {
	source: SyncSource;
	connected: boolean;
	status: GoogleSyncStatus | null;
	lastSyncedAt: string | null;
	lastError: string | null;
	autoCreate: boolean;
};

export type ConnectionStatus = {
	configured: boolean;
	linked: boolean;
	required: boolean;
	hasRefreshToken: boolean;
	sources: SourceStatus[];
};

@Injectable()
export class GoogleConnectionService {
	private readonly logger = new Logger(GoogleConnectionService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly tokens: GoogleTokenService,
		private readonly state: SyncStateService,
		private readonly match: GoogleMatchService,
		private readonly stamp: ActivityStampService,
	) {}

	async status(userId: string): Promise<ConnectionStatus> {
		await this.onConnected(userId);

		const [granted, rows, hasRefreshToken, accounts] = await Promise.all([
			this.tokens.grantedScopes(userId),
			this.state.listForUser(userId),
			this.tokens.hasRefreshToken(userId),
			this.tokens.signInAccounts(userId),
		]);

		const bySource = new Map(rows.map((row) => [row.source, row]));

		const sources = SYNC_SOURCES.map((source): SourceStatus => {
			const row = bySource.get(source);
			const connected = granted.includes(SCOPE_FOR_SOURCE[source]);

			return {
				source,
				connected,
				status: row?.status ?? null,
				lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
				lastError: row?.lastError ?? null,
				autoCreate: row?.autoCreate ?? false,
			};
		});

		return {
			configured: isGoogleConfigured(),
			linked: accounts.some(
				(account) => account.providerId === GOOGLE_PROVIDER_ID,
			),
			required: signsInWithGoogle(accounts),
			hasRefreshToken,
			sources,
		};
	}

	async onConnected(userId: string): Promise<void> {
		const [granted, existing] = await Promise.all([
			this.tokens.grantedScopes(userId),
			this.state.listForUser(userId),
		]);

		const known = new Set(existing.map((row) => row.source));

		const added: string[] = [];

		for (const source of SYNC_SOURCES) {
			if (!granted.includes(SCOPE_FOR_SOURCE[source])) continue;
			if (known.has(source)) continue;

			await this.state.ensure(userId, source, {
				autoCreate: source === "calendar",
			});

			added.push(source);
		}

		if (added.length > 0) {
			this.logger.log({ message: "Google connected", userId, sources: added });
		}
	}

	async reconcileAll(): Promise<void> {
		const accounts = await this.db.account.findMany({
			where: {
				providerId: "google",
				OR: SYNC_SOURCES.map((source) => ({
					scope: { contains: SCOPE_FOR_SOURCE[source] },
				})),
			},
			select: { userId: true },
		});

		for (const account of new Set(accounts.map((row) => row.userId))) {
			await this.onConnected(account);
		}
	}

	async purgeSyncedData(userId: string): Promise<{ purged: number }> {
		const result = await this.db.$transaction(async (tx) => {
			const messageLinks = await tx.emailMessageSync.findMany({
				where: { userId, source: "gmail" },
				select: { messageId: true },
			});
			await tx.emailMessageSync.deleteMany({
				where: { userId, source: "gmail" },
			});

			const legacyMessages = await tx.emailMessage.findMany({
				where: { syncedByUserId: userId, syncs: { none: {} } },
				select: { id: true, threadId: true },
			});
			const candidateMessageIds = new Set([
				...messageLinks.map((link) => link.messageId),
				...legacyMessages.map((message) => message.id),
			]);
			const messages =
				candidateMessageIds.size === 0
					? []
					: await tx.emailMessage.findMany({
							where: {
								id: { in: [...candidateMessageIds] },
								syncs: { none: {} },
							},
							select: { id: true, threadId: true },
						});
			const threadIds = [
				...new Set(messages.map((message) => message.threadId)),
			];
			const eventsLinks = await tx.calendarEventSync.findMany({
				where: { userId },
				select: { eventId: true },
			});
			await tx.calendarEventSync.deleteMany({ where: { userId } });
			const legacyEvents = await tx.calendarEvent.findMany({
				where: { syncedByUserId: userId, syncs: { none: {} } },
				select: { id: true },
			});
			const candidateEventIds = new Set([
				...eventsLinks.map((link) => link.eventId),
				...legacyEvents.map((event) => event.id),
			]);
			const events =
				candidateEventIds.size === 0
					? { count: 0 }
					: await tx.calendarEvent.deleteMany({
							where: {
								id: { in: [...candidateEventIds] },
								syncs: { none: {} },
							},
						});
			await tx.emailMessage.deleteMany({
				where: {
					id: { in: messages.map((message) => message.id) },
					syncs: { none: {} },
				},
			});

			for (const threadId of threadIds) {
				const stats = await tx.emailMessage.aggregate({
					where: { threadId },
					_count: { _all: true },
					_min: { sentAt: true },
					_max: { sentAt: true },
				});
				if (stats._count._all === 0) {
					await tx.emailThread.delete({ where: { id: threadId } });
					continue;
				}
				const firstMessageAt = stats._min.sentAt;
				const lastMessageAt = stats._max.sentAt;
				if (!firstMessageAt || !lastMessageAt) continue;
				await tx.emailThread.update({
					where: { id: threadId },
					data: {
						messageCount: stats._count._all,
						firstMessageAt,
						lastMessageAt,
					},
				});
			}

			return { messages: messages.length, events: events.count };
		});

		await this.stamp.recomputeAll();

		const purged = result.messages + result.events;

		this.logger.log({ message: "Synced data purged", userId, purged });

		return { purged };
	}

	async revoke(userId: string): Promise<{ revoked: boolean }> {
		await this.state.remove(userId);
		const revoked = await this.tokens.revoke(userId);
		return { revoked };
	}

	async setAutoCreate(
		userId: string,
		source: SyncSource,
		enabled: boolean,
	): Promise<void> {
		const row = await this.state.get(userId, source);
		if (!row) {
			throw new NotFoundException(`${source} is not connected.`);
		}

		await this.state.setAutoCreate(userId, source, enabled);
	}

	async suppressDomain(
		domain: string,
		options: { reason?: string; purge: boolean },
		actingUserId?: string,
	): Promise<{ domain: string; purged: number }> {
		if (actingUserId) await requireWorkspaceAdmin(this.db, actingUserId);
		const normalised = normalizeDomain(domain);
		if (!normalised) {
			throw new NotFoundException(`"${domain}" is not a domain.`);
		}

		const ours = await this.match.internalIdentity();
		if (ours.domains.has(normalised)) {
			throw new NotFoundException(
				"That is our own domain — it is already excluded.",
			);
		}

		await this.db.suppressedDomain.upsert({
			where: { domain: normalised },
			create: { domain: normalised, reason: options.reason ?? null },
			update: { reason: options.reason ?? null },
		});

		if (!options.purge) return { domain: normalised, purged: 0 };

		const company = await this.db.company.findUnique({
			where: { domain: normalised },
			select: { id: true },
		});

		if (!company) return { domain: normalised, purged: 0 };

		const [threads, events] = await this.db.$transaction([
			this.db.emailThread.deleteMany({ where: { companyId: company.id } }),
			this.db.calendarEvent.deleteMany({ where: { companyId: company.id } }),
		]);

		await this.stamp.recomputeAll();

		this.logger.log({
			message: "Domain suppressed",
			domain: normalised,
			purged: threads.count + events.count,
		});

		return { domain: normalised, purged: threads.count + events.count };
	}
}
