import {
	type Db,
	EmailDirection,
	GoogleSyncStatus,
	type ZohoMailboxModel as ZohoMailbox,
	type ZohoMailboxFolderModel as ZohoMailboxFolder,
} from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { InjectDatabase } from "../database/database.constants";
import { normaliseMessageId, stripQuotedHistory } from "../google/mime";
import type { Participant } from "../google/participants";
import {
	type MailboxIngestionSession,
	MailIngestionService,
	type NormalizedMailMessage,
} from "../mail/mail-ingestion.service";
import { ZohoCredentialsService } from "./zoho-credentials.service";

const MAX_MESSAGES_PER_TICK = 80;
const CONNECTION_TIMEOUT_MS = 20_000;
const SOCKET_TIMEOUT_MS = 60_000;
const MAX_LITERAL_SIZE = 10 * 1024 * 1024;
const MAX_BODY_LENGTH = 1_000_000;
const MAX_HTML_LENGTH = 500_000;
const RETRY_DELAY_MS = 60_000;
const STALE_SYNC_MS = 15 * 60_000;

type ZohoMailboxWithFolders = ZohoMailbox & { folders: ZohoMailboxFolder[] };

type FolderSnapshot = {
	uidValidity: string;
	lastUid: number;
};

type ParsedMessage = Omit<
	NormalizedMailMessage,
	"direction" | "providerMessageId" | "folderId"
> & { zohoMessageId: string };

type MessageFlags = {
	seen: boolean;
	flagged: boolean;
};

export type ZohoSyncOutcome = {
	userId: string;
	status: "synced" | "skipped" | "reconnect" | "failed";
	messagesWritten?: number;
	reason?: string;
};

@Injectable()
export class ZohoMailService {
	private readonly logger = new Logger(ZohoMailService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly credentials: ZohoCredentialsService,
		private readonly ingestion: MailIngestionService,
	) {}

	async verify(input: {
		email: string;
		host: string;
		password: string;
	}): Promise<{
		folders: {
			kind: "INBOX" | "SENT" | "OTHER";
			path: string;
			snapshot: FolderSnapshot;
		}[];
	}> {
		const client = this.client(input);
		try {
			await client.connect();
			const folders = await client.list();
			const inbox = folders.find(
				(folder) =>
					folder.specialUse?.toLowerCase() === "\\inbox" ||
					folder.path.toLowerCase() === "inbox",
			);
			const sent = folders.find(
				(folder) =>
					folder.specialUse?.toLowerCase() === "\\sent" ||
					/sent|outbox/i.test(folder.path),
			);
			if (!inbox) throw new Error("Zoho IMAP did not expose an INBOX folder.");
			if (!sent) throw new Error("Zoho IMAP did not expose a Sent folder.");

			const synced: {
				kind: "INBOX" | "SENT" | "OTHER";
				path: string;
				snapshot: FolderSnapshot;
			}[] = [];

			for (const folder of folders) {
				const special = folder.specialUse?.toLowerCase() ?? "";
				if (
					isNoiseFolder(folder.path, special) ||
					folder.path === inbox.path ||
					folder.path === sent.path
				) {
					continue;
				}
				const mailbox = await client.mailboxOpen(folder.path, {
					readOnly: true,
				});
				if (mailbox.exists > 0 || mailbox.uidNext > 1) {
					synced.push({
						kind: "OTHER",
						path: folder.path,
						snapshot: snapshotOf(mailbox),
					});
				}
			}

			const inboxMailbox = await client.mailboxOpen(inbox.path, {
				readOnly: true,
			});
			const sentMailbox = await client.mailboxOpen(sent.path, {
				readOnly: true,
			});

			return {
				folders: [
					{
						kind: "INBOX",
						path: inbox.path,
						snapshot: snapshotOf(inboxMailbox),
					},
					{ kind: "SENT", path: sent.path, snapshot: snapshotOf(sentMailbox) },
					...synced,
				],
			};
		} finally {
			await close(client);
		}
	}

	async sync(row: ZohoMailboxWithFolders): Promise<ZohoSyncOutcome> {
		if (!this.credentials.isConfigured()) {
			return {
				userId: row.userId,
				status: "skipped",
				reason: "Zoho Mail encryption is not configured.",
			};
		}

		const claimed = await this.db.zohoMailbox.updateMany({
			where: {
				id: row.id,
				OR: [
					{ status: { not: GoogleSyncStatus.RUNNING } },
					{
						status: GoogleSyncStatus.RUNNING,
						updatedAt: { lt: new Date(Date.now() - STALE_SYNC_MS) },
					},
				],
			},
			data: { status: GoogleSyncStatus.RUNNING, lastError: null },
		});
		if (claimed.count === 0) {
			return {
				userId: row.userId,
				status: "skipped",
				reason: "A Zoho Mail sync is already running.",
			};
		}

		let client: ImapFlow | null = null;

		try {
			const password = this.credentials.decrypt(row.encryptedPassword);
			client = this.client({
				email: row.email,
				host: row.host,
				password,
			});
			await client.connect();
			const session = await this.ingestion.forMailbox({
				source: "zoho",
				userId: row.userId,
				mailboxAddress: row.email.toLowerCase(),
				autoCreate: row.autoCreate,
			});
			let messagesWritten = 0;

			const folders = [...row.folders].sort(
				(left, right) =>
					Number(right.kind === "SENT") - Number(left.kind === "SENT"),
			);
			for (const folder of folders) {
				messagesWritten += await this.syncFolder(client, row, folder, session);
			}

			await this.db.zohoMailbox.update({
				where: { id: row.id },
				data: {
					status: GoogleSyncStatus.IDLE,
					lastSyncedAt: new Date(),
					lastError: null,
					retryAfter: null,
				},
			});

			if (messagesWritten > 0) {
				this.logger.log({
					message: "Zoho IMAP sync",
					userId: row.userId,
					messagesWritten,
				});
			}

			return { userId: row.userId, status: "synced", messagesWritten };
		} catch (error) {
			return this.handleFailure(row, error);
		} finally {
			if (client) await close(client);
		}
	}

	private async syncFolder(
		client: ImapFlow,
		row: ZohoMailbox,
		folder: ZohoMailboxFolder,
		session: MailboxIngestionSession,
	): Promise<number> {
		const mailbox = await client.mailboxOpen(folder.path, { readOnly: true });
		const uidValidity = mailbox.uidValidity.toString();
		if (folder.uidValidity !== uidValidity || folder.lastUid === null) {
			await this.db.zohoMailboxFolder.update({
				where: { id: folder.id },
				data: { uidValidity, lastUid: mailbox.uidNext - 1 },
			});
			return 0;
		}

		const ids = await this.messageIds(client, folder.lastUid);
		const batch = ids.slice(0, MAX_MESSAGES_PER_TICK);
		let lastUid = Math.max(folder.lastUid, batch.at(-1) ?? folder.lastUid);
		let written = 0;

		for await (const message of client.fetch(
			batch,
			{
				uid: true,
				flags: true,
				source: { maxLength: MAX_LITERAL_SIZE },
			},
			{ uid: true },
		)) {
			lastUid = Math.max(lastUid, message.uid);
			if (!message.source) continue;

			let parsed: ParsedMessage | null;
			try {
				parsed = await this.parse(message.source, message.uid, {
					seen: message.flags?.has("\\Seen") ?? false,
					flagged: message.flags?.has("\\Flagged") ?? false,
				});
			} catch {
				this.logger.warn({
					message: "Zoho IMAP message could not be parsed",
					userId: row.userId,
					folder: folder.kind,
					uid: message.uid,
				});
				continue;
			}
			if (!parsed) continue;
			const stored = await session.ingest({
				...parsed,
				direction:
					folder.kind === "SENT" ||
					parsed.from.email === row.email.toLowerCase()
						? EmailDirection.OUTBOUND
						: EmailDirection.INBOUND,
				providerMessageId: parsed.zohoMessageId,
				folderId: folder.id,
			});
			if (stored.status === "written") written += 1;
		}

		await this.db.zohoMailboxFolder.update({
			where: { id: folder.id },
			data: { uidValidity, lastUid },
		});

		return written;
	}

	private client(input: {
		email: string;
		host: string;
		password: string;
	}): ImapFlow {
		return new ImapFlow({
			host: input.host,
			port: 993,
			secure: true,
			auth: { user: input.email, pass: input.password },
			disableAutoIdle: true,
			connectionTimeout: CONNECTION_TIMEOUT_MS,
			socketTimeout: SOCKET_TIMEOUT_MS,
			maxLiteralSize: MAX_LITERAL_SIZE,
			logger: false,
		});
	}

	private async messageIds(
		client: ImapFlow,
		lastUid: number | null,
	): Promise<number[]> {
		const result = await client.search(
			lastUid === null ? { all: true } : { uid: `${lastUid + 1}:*` },
			{ uid: true },
		);
		return result === false ? [] : result.sort((a, b) => a - b);
	}

	private async parse(
		source: Buffer,
		uid: number,
		flags: MessageFlags,
	): Promise<ParsedMessage | null> {
		const message = await simpleParser(source, {
			skipImageLinks: true,
			maxHtmlLengthToParse: 1_000_000,
		});
		const rawMessageId = message.messageId;
		const from = participantOf(message.from);
		const sentAt = message.date;
		const rfcMessageId = rawMessageId ? normaliseMessageId(rawMessageId) : "";
		if (!rfcMessageId || !from || !sentAt || Number.isNaN(sentAt.getTime()))
			return null;

		const references = Array.isArray(message.references)
			? message.references
			: message.references
				? [message.references]
				: [];
		const root = references[0] ?? message.inReplyTo ?? rawMessageId;

		const rootId = normaliseMessageId(root ?? rfcMessageId) || rfcMessageId;
		const body = stripQuotedHistory(message.text ?? "");

		return {
			rfcMessageId,
			rootMessageId: rootId,
			subject: message.subject?.trim() || null,
			from,
			recipients: [
				...recipientsOf(message.to, "to"),
				...recipientsOf(message.cc, "cc"),
			],
			body: body.slice(0, MAX_BODY_LENGTH),
			bodyHtml:
				typeof message.html === "string"
					? message.html.slice(0, MAX_HTML_LENGTH)
					: null,
			sentAt,
			zohoMessageId: String(uid),
			isRead: flags.seen,
			starred: flags.flagged,
			attachments: (message.attachments ?? [])
				.filter((attachment) => attachment.content)
				.map((attachment) => ({
					filename: attachment.filename?.trim() || "attachment",
					mimeType: attachment.contentType || null,
					size: attachment.content?.length ?? null,
					content: Buffer.from(attachment.content),
					contentId: attachment.contentId ?? null,
				})),
		};
	}

	private async handleFailure(
		row: ZohoMailbox,
		error: unknown,
	): Promise<ZohoSyncOutcome> {
		const reason = error instanceof Error ? error.message : String(error);
		const reconnect =
			(error instanceof Error &&
				error.constructor.name === "AuthenticationFailure") ||
			(typeof error === "object" &&
				error !== null &&
				"authenticationFailed" in error &&
				error.authenticationFailed === true) ||
			/auth(?:entication)? failed|invalid credentials|login failed/i.test(
				reason,
			);
		const safe = safeReason(reason);
		await this.db.zohoMailbox.update({
			where: { id: row.id },
			data: {
				status: reconnect
					? GoogleSyncStatus.NEEDS_RECONNECT
					: GoogleSyncStatus.FAILED,
				lastError: safe,
				retryAfter: reconnect ? null : new Date(Date.now() + RETRY_DELAY_MS),
			},
		});
		this.logger.warn({
			message: "Zoho IMAP sync failed",
			userId: row.userId,
			reconnect,
		});
		return {
			userId: row.userId,
			status: reconnect ? "reconnect" : "failed",
			reason: safe,
		};
	}
}

type Address = { value: Array<{ address?: string; name?: string }> };

function participantOf(value: Address | undefined): Participant | null {
	const item = value?.value[0];
	const email = item?.address?.trim().toLowerCase();
	if (!email || !isEmail(email)) return null;
	return { email, name: item?.name?.trim() || null };
}

function recipientsOf(
	value: Address | Address[] | undefined,
	kind: "to" | "cc",
): { email: string; name: string | null; kind: "to" | "cc" }[] {
	const groups = Array.isArray(value) ? value : value ? [value] : [];
	const seen = new Set<string>();
	return groups.flatMap((group) =>
		group.value.flatMap((item) => {
			const email = item.address?.trim().toLowerCase();
			if (!email || seen.has(email) || !isEmail(email)) return [];
			seen.add(email);
			return [{ email, name: item.name?.trim() || null, kind }];
		}),
	);
}

function isEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function snapshotOf(mailbox: {
	uidValidity: bigint;
	uidNext: number;
}): FolderSnapshot {
	return {
		uidValidity: mailbox.uidValidity.toString(),
		lastUid: Math.max(0, mailbox.uidNext - 1),
	};
}

function isNoiseFolder(path: string, specialUse: string): boolean {
	const normalized = path.toLowerCase();
	if (
		/nest|archive|all mail|starred|flagged|important|draft|template|\bprojects\b/i.test(
			normalized,
		)
	) {
		return true;
	}
	if (specialUse && /\\drafts|\\archive/i.test(specialUse)) {
		return true;
	}
	return false;
}

async function close(client: ImapFlow): Promise<void> {
	try {
		if (client.usable) await client.logout();
		else client.close();
	} catch {
		client.close();
	}
}

function safeReason(value: string): string {
	if (
		/auth(?:entication)? failed|invalid credentials|login failed/i.test(value)
	) {
		return "Zoho Mail rejected the app password. Reconnect with a new app password.";
	}
	if (/timed? out|connect|socket|network|enotfound|econn/i.test(value)) {
		return "Zoho Mail could not be reached. Verify the selected region and try again.";
	}
	return "Zoho Mail did not complete the sync. Try again later.";
}
