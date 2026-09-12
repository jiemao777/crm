import { type Db, GoogleSyncStatus } from "@crm/db";
import {
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from "@nestjs/common";
import { requireWorkspaceRole } from "../crm/access";
import { InjectDatabase } from "../database/database.constants";
import { ZohoCredentialsService } from "../zoho/zoho-credentials.service";
import { ZohoMailService } from "../zoho/zoho-mail.service";

const BACKFILL_BUDGET_MS = 90_000;

export type ZohoStatus = {
	configured: boolean;
	connected: boolean;
	canSend: boolean;
	email: string | null;
	host: string | null;
	port: number | null;
	folders: { kind: "INBOX" | "SENT" | "OTHER"; path: string }[];
	status: GoogleSyncStatus | null;
	lastSyncedAt: string | null;
	lastError: string | null;
	autoCreate: boolean;
};

@Injectable()
export class ZohoConnectionService {
	private readonly logger = new Logger(ZohoConnectionService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly credentials: ZohoCredentialsService,
		private readonly mail: ZohoMailService,
	) {}

	async status(userId: string): Promise<ZohoStatus> {
		await requireWorkspaceRole(this.db, userId);
		const mailbox = await this.db.zohoMailbox.findUnique({
			where: { userId },
			include: { folders: { select: { kind: true, path: true } } },
		});

		return {
			configured: this.credentials.isConfigured(),
			connected: mailbox !== null,
			canSend: mailbox !== null && this.credentials.isConfigured(),
			email: mailbox?.email ?? null,
			host: mailbox?.host ?? null,
			port: mailbox?.port ?? null,
			folders:
				mailbox?.folders.map((folder) => ({
					kind: folder.kind,
					path: folder.path,
				})) ?? [],
			status: mailbox?.status ?? null,
			lastSyncedAt: mailbox?.lastSyncedAt?.toISOString() ?? null,
			lastError: mailbox?.lastError ?? null,
			autoCreate: mailbox?.autoCreate ?? false,
		};
	}

	async connect(
		userId: string,
		input: { email: string; password: string; host: string },
	): Promise<ZohoStatus> {
		await requireWorkspaceRole(this.db, userId);
		if (!this.credentials.isConfigured()) {
			throw new ServiceUnavailableException(
				"Zoho Mail is not configured. Set CREDENTIALS_ENCRYPTION_KEY and restart.",
			);
		}

		const email = input.email.trim().toLowerCase();
		const host = input.host.trim().toLowerCase();
		const folders = await this.mail.verify({ ...input, email, host });
		const encryptedPassword = this.credentials.encrypt(input.password);
		const previous = await this.db.zohoMailbox.findUnique({
			where: { userId },
			include: { folders: { select: { kind: true, path: true } } },
		});
		const changedMailbox =
			previous !== null && (previous.email !== email || previous.host !== host);

		const mailbox = await this.db.zohoMailbox.upsert({
			where: { userId },
			create: {
				userId,
				email,
				host,
				port: 993,
				secure: true,
				encryptedPassword,
				status: GoogleSyncStatus.IDLE,
				autoCreate: false,
			},
			update: {
				email,
				host,
				port: 993,
				secure: true,
				encryptedPassword,
				status: GoogleSyncStatus.IDLE,
				lastError: null,
				retryAfter: null,
			},
			select: { id: true },
		});

		await this.db.$transaction([
			...folders.folders.map((folder) => {
				const previousFolder = previous?.folders.find(
					(previous) =>
						previous.path === folder.path && previous.kind === folder.kind,
				);
				const folderChanged = changedMailbox || previousFolder === undefined;
				return this.db.zohoMailboxFolder.upsert({
					where: {
						mailboxId_path: { mailboxId: mailbox.id, path: folder.path },
					},
					create: {
						mailboxId: mailbox.id,
						kind: folder.kind,
						path: folder.path,
						uidValidity: folder.snapshot.uidValidity,
						lastUid: folder.snapshot.lastUid,
					},
					update: {
						kind: folder.kind,
						...(folderChanged
							? {
									uidValidity: folder.snapshot.uidValidity,
									lastUid: folder.snapshot.lastUid,
								}
							: {}),
					},
				});
			}),
			this.db.zohoMailboxFolder.deleteMany({
				where: {
					mailboxId: mailbox.id,
					path: { notIn: folders.folders.map((folder) => folder.path) },
				},
			}),
		]);

		this.logger.log({ message: "Zoho Mail connected", userId, email, host });
		return this.status(userId);
	}

	async disconnect(userId: string): Promise<{ disconnected: boolean }> {
		await requireWorkspaceRole(this.db, userId);
		const result = await this.db.zohoMailbox.deleteMany({ where: { userId } });
		this.logger.log({ message: "Zoho Mail disconnected", userId });
		return { disconnected: result.count > 0 };
	}

	async syncNow(userId: string): Promise<ZohoStatus> {
		await requireWorkspaceRole(this.db, userId);
		const mailbox = await this.db.zohoMailbox.findUnique({
			where: { userId },
			include: { folders: true },
		});
		if (!mailbox) throw new NotFoundException("Zoho Mail is not connected.");
		await this.mail.sync(mailbox);
		return this.status(userId);
	}

	async backfill(userId: string): Promise<ZohoStatus> {
		await requireWorkspaceRole(this.db, userId);
		const mailbox = await this.db.zohoMailbox.findUnique({
			where: { userId },
			include: { folders: true },
		});
		if (!mailbox) throw new NotFoundException("Zoho Mail is not connected.");
		if (mailbox.folders.length === 0)
			throw new NotFoundException("Zoho Mail has no folders to backfill.");

		await this.db.$transaction(
			mailbox.folders.map((folder) =>
				this.db.zohoMailboxFolder.update({
					where: { id: folder.id },
					data: { lastUid: 0 },
				}),
			),
		);

		const deadline = Date.now() + BACKFILL_BUDGET_MS;
		let total = 0;

		for (;;) {
			if (Date.now() >= deadline) break;

			const refreshed = await this.db.zohoMailbox.findUnique({
				where: { userId },
				include: { folders: true },
			});
			if (!refreshed) break;

			const outcome = await this.mail.sync(refreshed);
			if (outcome.status !== "synced") break;

			const written = outcome.messagesWritten ?? 0;
			total += written;
			if (written === 0) break;
		}

		this.logger.log({
			message: "Zoho Mail history backfill",
			userId,
			messagesWritten: total,
		});
		return this.status(userId);
	}

	async setAutoCreate(userId: string, enabled: boolean): Promise<ZohoStatus> {
		await requireWorkspaceRole(this.db, userId);
		const result = await this.db.zohoMailbox.updateMany({
			where: { userId },
			data: { autoCreate: enabled },
		});
		if (result.count === 0)
			throw new NotFoundException("Zoho Mail is not connected.");
		return this.status(userId);
	}

	async runDue(
		now: Date,
		deadline: number = Number.POSITIVE_INFINITY,
	): Promise<{
		attempted: number;
		synced: number;
		failed: number;
		skipped: number;
	}> {
		const rows = await this.db.zohoMailbox.findMany({
			where: {
				status: { not: GoogleSyncStatus.NEEDS_RECONNECT },
				OR: [{ retryAfter: null }, { retryAfter: { lte: now } }],
			},
			include: { folders: true },
			orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }],
		});
		const summary = { attempted: 0, synced: 0, failed: 0, skipped: 0 };

		for (const row of rows) {
			if (Date.now() >= deadline) break;
			summary.attempted += 1;
			const outcome = await this.mail.sync(row);
			if (outcome.status === "synced") summary.synced += 1;
			else if (outcome.status === "skipped") summary.skipped += 1;
			else summary.failed += 1;
		}

		return summary;
	}
}
