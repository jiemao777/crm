import { ActivityType, type Db, EmailDirection } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { snippetOf } from "../google/mime";
import type { Participant } from "../google/participants";

export type MailSource = "gmail" | "zoho";

export type NormalizedMailMessage = {
	rfcMessageId: string;
	rootMessageId: string;
	subject: string | null;
	from: Participant;
	recipients: {
		email: string;
		name: string | null;
		kind: "to" | "cc" | "bcc";
	}[];
	body: string;
	bodyHtml: string | null;
	sentAt: Date;
	direction: EmailDirection;
	providerMessageId: string | null;
	folderId: string | null;
	isRead: boolean;
	starred: boolean;
	attachments: {
		filename: string;
		mimeType: string | null;
		size: number | null;
		content: Buffer;
		contentId: string | null;
	}[];
};

export type MailIngestionResult = {
	status: "written" | "existing";
	threadId: string;
	messageId: string;
	linked: boolean;
};

export type MailboxIngestionSession = {
	ingest(message: NormalizedMailMessage): Promise<MailIngestionResult>;
};

type MailboxConfig = {
	source: MailSource;
	userId: string;
	mailboxAddress: string;
	autoCreate: boolean;
};

@Injectable()
export class MailIngestionService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly stamp: ActivityStampService,
		private readonly agent: AgentTriggerService,
	) {}

	async forMailbox(config: MailboxConfig): Promise<MailboxIngestionSession> {
		return {
			ingest: (message) => this.ingest(config, message),
		};
	}

	private async ingest(
		config: MailboxConfig,
		message: NormalizedMailMessage,
	): Promise<MailIngestionResult> {
		const existingMessage = await this.mergeExisting(config, message);
		if (existingMessage) return existingMessage;

		const existingThread = await this.db.emailThread.findUnique({
			where: { rootMessageId: message.rootMessageId },
			select: {
				id: true,
				companyId: true,
				contactId: true,
				activity: { select: { dealId: true } },
			},
		});
		const companyId = existingThread?.companyId ?? null;
		const contactId = existingThread?.contactId ?? null;
		let dealId = existingThread?.activity?.dealId ?? null;
		let allowCreate = false;

		if (!companyId && !contactId) {
			const repliedTo =
				message.direction === EmailDirection.OUTBOUND ||
				(await this.hasOutboundInThread(
					message.rootMessageId,
					config.mailboxAddress,
				));
			allowCreate = config.autoCreate && repliedTo;
		}

		if (!dealId && companyId) {
			dealId = await this.inquiryFor(companyId, message);
		}

		const thread = await this.db.emailThread.upsert({
			where: { rootMessageId: message.rootMessageId },
			create: {
				rootMessageId: message.rootMessageId,
				subject: message.subject,
				companyId,
				contactId,
				firstMessageAt: message.sentAt,
				lastMessageAt: message.sentAt,
				messageCount: 0,
			},
			update:
				existingThread && (companyId || contactId)
					? { companyId, contactId }
					: {},
			select: { id: true },
		});

		let stored: { id: string };
		try {
			stored = await this.db.emailMessage.create({
				data: {
					threadId: thread.id,
					rfcMessageId: message.rfcMessageId,
					syncedByUserId: config.userId,
					syncs: {
						create: { userId: config.userId, source: config.source },
					},
					gmailMessageId:
						config.source === "gmail" ? message.providerMessageId : null,
					zohoMessageId:
						config.source === "zoho" ? message.providerMessageId : null,
					zohoMailboxFolderId:
						config.source === "zoho" ? message.folderId : null,
					direction: message.direction,
					fromEmail: message.from.email,
					fromName: message.from.name,
					recipients: message.recipients,
					subject: message.subject,
					snippet: snippetOf(message.body),
					body: message.body || null,
					bodyHtml: message.bodyHtml,
					sentAt: message.sentAt,
					isRead: message.isRead,
					starred: message.starred,
				},
				select: { id: true },
			});
		} catch (error) {
			if (isUniqueViolation(error)) {
				const winner = await this.mergeExisting(config, message);
				if (winner) return winner;
			}
			throw error;
		}

		await this.storeAttachments(stored.id, message.attachments);

		const stats = await this.db.emailMessage.aggregate({
			where: { threadId: thread.id },
			_count: { _all: true },
			_min: { sentAt: true },
			_max: { sentAt: true },
		});
		const firstMessageAt = stats._min.sentAt ?? message.sentAt;
		const lastMessageAt = stats._max.sentAt ?? message.sentAt;

		await this.db.emailThread.update({
			where: { id: thread.id },
			data: {
				messageCount: stats._count._all,
				firstMessageAt,
				lastMessageAt,
				...(message.sentAt <= firstMessageAt
					? { subject: message.subject }
					: {}),
			},
		});

		await this.db.activity.upsert({
			where: { emailThreadId: thread.id },
			create: {
				type: ActivityType.EMAIL,
				subject: message.subject ?? "(no subject)",
				body: snippetOf(message.body),
				occurredAt: lastMessageAt,
				companyId,
				contactId,
				dealId,
				createdById: config.userId,
				emailThreadId: thread.id,
				meta: {
					synced: true,
					source: config.source === "zoho" ? "zoho-imap" : "gmail",
				},
			},
			update: {
				subject: message.subject ?? "(no subject)",
				body: snippetOf(message.body),
				occurredAt: lastMessageAt,
				companyId,
				contactId,
				...(dealId ? { dealId } : {}),
			},
		});

		await this.stamp.touch({ companyId, contactId, dealId }, lastMessageAt);
		if (!companyId && !contactId) {
			await this.agent.mailReceived({
				threadId: thread.id,
				userId: config.userId,
				allowCreate,
			});
		} else if (dealId) {
			await this.agent.inquiryChanged(
				dealId,
				"New mail landed on this inquiry",
				30 * 60_000,
			);
		}

		return {
			status: "written",
			threadId: thread.id,
			messageId: stored.id,
			linked: Boolean(companyId || contactId),
		};
	}

	private async hasOutboundInThread(
		rootMessageId: string,
		mailboxAddress: string,
	): Promise<boolean> {
		const found = await this.db.emailMessage.findFirst({
			where: {
				thread: { rootMessageId },
				fromEmail: mailboxAddress,
			},
			select: { id: true },
		});
		return found !== null;
	}

	private async inquiryFor(
		companyId: string,
		message: Pick<NormalizedMailMessage, "subject" | "body">,
	): Promise<string | null> {
		const inquiryNumbers = [
			...new Set(
				`${message.subject ?? ""}\n${message.body}`
					.match(/\bINQ-[A-Z0-9-]+\b/gi)
					?.map((value) => value.toUpperCase()) ?? [],
			),
		];
		if (inquiryNumbers.length === 0) return null;

		const matches = await this.db.deal.findMany({
			where: { companyId, inquiryNo: { in: inquiryNumbers } },
			select: { id: true },
		});
		return matches.length === 1 ? (matches[0]?.id ?? null) : null;
	}

	private async mergeExisting(
		config: MailboxConfig,
		message: NormalizedMailMessage,
	): Promise<MailIngestionResult | null> {
		const existing = await this.db.emailMessage.findUnique({
			where: { rfcMessageId: message.rfcMessageId },
			select: {
				id: true,
				threadId: true,
				bodyHtml: true,
				gmailMessageId: true,
				zohoMessageId: true,
				zohoMailboxFolderId: true,
				_count: { select: { attachments: true } },
				thread: { select: { companyId: true, contactId: true } },
			},
		});
		if (!existing) return null;

		await this.db.emailMessageSync.createMany({
			data: {
				messageId: existing.id,
				userId: config.userId,
				source: config.source,
			},
			skipDuplicates: true,
		});
		const enrichment: {
			bodyHtml?: string;
			gmailMessageId?: string;
			zohoMessageId?: string;
			zohoMailboxFolderId?: string;
		} = {};
		if (!existing.bodyHtml && message.bodyHtml) {
			enrichment.bodyHtml = message.bodyHtml;
		}
		if (
			config.source === "gmail" &&
			!existing.gmailMessageId &&
			message.providerMessageId
		) {
			enrichment.gmailMessageId = message.providerMessageId;
		}
		if (
			config.source === "zoho" &&
			!existing.zohoMessageId &&
			message.providerMessageId
		) {
			enrichment.zohoMessageId = message.providerMessageId;
		}
		if (
			config.source === "zoho" &&
			!existing.zohoMailboxFolderId &&
			message.folderId
		) {
			enrichment.zohoMailboxFolderId = message.folderId;
		}
		if (Object.keys(enrichment).length > 0) {
			await this.db.emailMessage.update({
				where: { id: existing.id },
				data: enrichment,
			});
		}
		if (existing._count.attachments === 0) {
			await this.storeAttachments(existing.id, message.attachments);
		}

		return {
			status: "existing",
			threadId: existing.threadId,
			messageId: existing.id,
			linked: Boolean(existing.thread.companyId || existing.thread.contactId),
		};
	}

	private async storeAttachments(
		messageId: string,
		attachments: NormalizedMailMessage["attachments"],
	): Promise<void> {
		if (attachments.length === 0) return;
		await this.db.emailAttachment.createMany({
			data: attachments.map((attachment) => ({
				messageId,
				filename: attachment.filename,
				mimeType: attachment.mimeType,
				size: attachment.size,
				content: Buffer.from(attachment.content),
				contentId: attachment.contentId,
			})),
		});
	}
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "P2002"
	);
}
