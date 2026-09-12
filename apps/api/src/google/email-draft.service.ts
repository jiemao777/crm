import { type Db, EmailDraftStatus, type Prisma } from "@crm/db";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { requireWorkspaceRole } from "../crm/access";
import { InjectDatabase } from "../database/database.constants";
import { ZohoSmtpService } from "../zoho/zoho-smtp.service";
import { ConversationService } from "./conversation.service";
import type { DraftRecipientInput, SaveDraftInput } from "./google.contracts";
import { normaliseMessageId } from "./mime";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_BYTES = 20 * 1024 * 1024;

const DRAFT_SELECT = {
	id: true,
	userId: true,
	threadId: true,
	inReplyTo: true,
	references: true,
	to: true,
	cc: true,
	bcc: true,
	subject: true,
	body: true,
	status: true,
	lastError: true,
	sentMessageId: true,
	sentFrom: true,
	sentAt: true,
	createdAt: true,
	updatedAt: true,
	attachments: {
		select: { id: true, filename: true, mimeType: true, size: true },
		orderBy: { filename: "asc" as const },
	},
} as const;

const DRAFT_SEND_SELECT = {
	...DRAFT_SELECT,
	attachments: {
		select: {
			id: true,
			filename: true,
			mimeType: true,
			size: true,
			content: true,
		},
		orderBy: { filename: "asc" as const },
	},
} as const;

type DraftAddress = { email: string; name: string | null };
type DraftSendRow = Prisma.EmailDraftGetPayload<{
	select: typeof DRAFT_SEND_SELECT;
}>;

@Injectable()
export class EmailDraftService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly smtp: ZohoSmtpService,
		private readonly conversations: ConversationService,
	) {}

	async list(userId: string) {
		await requireWorkspaceRole(this.db, userId);
		const rows = await this.db.emailDraft.findMany({
			where: {
				userId,
				status: {
					in: [
						EmailDraftStatus.DRAFT,
						EmailDraftStatus.SENDING,
						EmailDraftStatus.FAILED,
					],
				},
			},
			orderBy: { updatedAt: "desc" },
			select: DRAFT_SELECT,
		});
		return rows.map((row) => presentDraft(row));
	}

	async get(draftId: string, userId: string) {
		const row = await this.findOwned(draftId, userId, DRAFT_SELECT);
		return presentDraft(row);
	}

	async save(input: SaveDraftInput, userId: string) {
		await requireWorkspaceRole(this.db, userId);
		const data = {
			threadId: input.threadId ?? null,
			inReplyTo: input.inReplyTo ?? null,
			references: input.references ?? null,
			to: cleanAddresses(input.to),
			cc: cleanAddresses(input.cc),
			bcc: cleanAddresses(input.bcc),
			subject: input.subject ?? "",
			body: input.body ?? "",
			status: EmailDraftStatus.DRAFT,
			lastError: null,
		};

		if (input.draftId) {
			const current = await this.findOwned(input.draftId, userId, {
				id: true,
				status: true,
			});
			if (
				current.status === EmailDraftStatus.SENT ||
				current.status === EmailDraftStatus.SENDING
			) {
				throw new ConflictException(
					current.status === EmailDraftStatus.SENDING
						? "This draft is being sent and cannot be edited."
						: "A sent message cannot be edited as a draft.",
				);
			}
			const row = await this.db.emailDraft.update({
				where: { id: input.draftId },
				data,
				select: DRAFT_SELECT,
			});
			return presentDraft(row);
		}

		const row = await this.db.emailDraft.create({
			data: { userId, ...data },
			select: DRAFT_SELECT,
		});
		return presentDraft(row);
	}

	async addAttachment(
		input: {
			draftId: string;
			filename: string;
			mimeType?: string | null;
			contentBase64: string;
		},
		userId: string,
	) {
		const draft = await this.findOwned(input.draftId, userId, {
			id: true,
			status: true,
			attachments: { select: { size: true } },
		});
		if (
			draft.status === EmailDraftStatus.SENT ||
			draft.status === EmailDraftStatus.SENDING
		) {
			throw new ConflictException(
				draft.status === EmailDraftStatus.SENDING
					? "This draft is being sent and cannot be changed."
					: "A sent message cannot receive attachments.",
			);
		}
		const content = decodeAttachment(input.contentBase64);
		if (content.length === 0) {
			throw new BadRequestException("The attachment is empty.");
		}
		const total = draft.attachments.reduce((sum, item) => sum + item.size, 0);
		assertAttachmentSize(content.length, total);

		const attachment = await this.db.emailDraftAttachment.create({
			data: {
				draftId: input.draftId,
				filename: input.filename.trim(),
				mimeType: input.mimeType?.trim() || null,
				size: content.length,
				content: new Uint8Array(content),
			},
			select: { id: true, filename: true, mimeType: true, size: true },
		});
		await this.db.emailDraft.update({
			where: { id: input.draftId },
			data: {
				status: EmailDraftStatus.DRAFT,
				lastError: null,
				updatedAt: new Date(),
			},
		});
		return attachment;
	}

	async removeAttachment(
		input: { draftId: string; attachmentId: string },
		userId: string,
	) {
		const draft = await this.findOwned(input.draftId, userId, {
			id: true,
			status: true,
		});
		if (
			draft.status === EmailDraftStatus.SENT ||
			draft.status === EmailDraftStatus.SENDING
		) {
			throw new ConflictException(
				draft.status === EmailDraftStatus.SENDING
					? "This draft is being sent and cannot be changed."
					: "A sent message cannot be changed.",
			);
		}
		const result = await this.db.emailDraftAttachment.deleteMany({
			where: { id: input.attachmentId, draftId: draft.id },
		});
		if (result.count === 0)
			throw new NotFoundException("Attachment not found.");
		await this.db.emailDraft.update({
			where: { id: draft.id },
			data: { updatedAt: new Date() },
		});
		return { deleted: true };
	}

	async remove(draftId: string, userId: string) {
		await requireWorkspaceRole(this.db, userId);
		const result = await this.db.emailDraft.deleteMany({
			where: { id: draftId, userId },
		});
		if (result.count === 0) throw new NotFoundException("Draft not found.");
		return { deleted: true };
	}

	async send(draftId: string, userId: string) {
		let draft = await this.findOwned(draftId, userId, DRAFT_SEND_SELECT);
		if (draft.status === EmailDraftStatus.SENT && draft.sentMessageId) {
			return this.recordSentDraft(draft, userId);
		}

		const to = addressesOf(draft.to);
		const cc = addressesOf(draft.cc);
		const bcc = addressesOf(draft.bcc);
		if (to.length === 0)
			throw new BadRequestException("A recipient is required to send mail.");

		const sentMessageId = normaliseMessageId(
			draft.sentMessageId ?? `crm-${draft.id}@crm.local`,
		);
		const claim = await this.db.emailDraft.updateMany({
			where: {
				id: draft.id,
				userId,
				status: { in: [EmailDraftStatus.DRAFT, EmailDraftStatus.FAILED] },
			},
			data: {
				status: EmailDraftStatus.SENDING,
				sentMessageId,
				lastError: null,
			},
		});
		if (claim.count === 0) {
			draft = await this.findOwned(draftId, userId, DRAFT_SEND_SELECT);
			if (draft.status === EmailDraftStatus.SENT && draft.sentMessageId) {
				return this.recordSentDraft(draft, userId);
			}
			throw new ConflictException("This draft is already being sent.");
		}

		try {
			const result = await this.smtp.send(userId, {
				to: to.map((entry) => entry.email),
				cc: cc.map((entry) => entry.email),
				bcc: bcc.map((entry) => entry.email),
				subject: draft.subject,
				body: draft.body,
				inReplyTo: draft.inReplyTo ?? undefined,
				references: draft.references ?? undefined,
				messageId: `<${sentMessageId}>`,
				attachments: draft.attachments.map((attachment) => ({
					filename: attachment.filename,
					content: Buffer.from(attachment.content),
					contentType: attachment.mimeType,
				})),
			});
			await this.db.emailDraft.update({
				where: { id: draft.id },
				data: {
					status: EmailDraftStatus.SENT,
					sentMessageId: normaliseMessageId(result.messageId) || sentMessageId,
					sentFrom: result.from,
					sentAt: new Date(),
					lastError: null,
				},
			});
			draft = await this.findOwned(draftId, userId, DRAFT_SEND_SELECT);
			return this.recordSentDraft(draft, userId);
		} catch (error) {
			await this.db.emailDraft.updateMany({
				where: { id: draft.id, status: EmailDraftStatus.SENDING },
				data: {
					status: EmailDraftStatus.FAILED,
					lastError:
						error instanceof Error
							? error.message.slice(0, 500)
							: String(error),
				},
			});
			throw error;
		}
	}

	private async recordSentDraft(draft: DraftSendRow, userId: string) {
		if (!draft.sentMessageId)
			throw new ConflictException("Sent draft has no Message-ID.");
		const user = await this.db.user.findUnique({
			where: { id: userId },
			select: { name: true, email: true },
		});
		const fromEmail = draft.sentFrom ?? user?.email;
		if (!fromEmail)
			throw new ConflictException("Sent draft has no sender address.");
		const message = await this.conversations.recordOutbound(
			{
				messageId: draft.sentMessageId,
				fromEmail,
				fromName: user?.name ?? null,
				to: addressesOf(draft.to),
				cc: addressesOf(draft.cc),
				bcc: addressesOf(draft.bcc),
				subject: draft.subject,
				body: draft.body,
				sentAt: draft.sentAt ?? new Date(),
				threadId: draft.threadId,
				inReplyTo: draft.inReplyTo,
				attachments: draft.attachments.map((attachment) => ({
					filename: attachment.filename,
					mimeType: attachment.mimeType,
					size: attachment.size,
					content: Buffer.from(attachment.content),
				})),
			},
			userId,
		);
		return {
			messageId: draft.sentMessageId,
			threadId: message.threadId,
			status: EmailDraftStatus.SENT,
		};
	}

	private async findOwned<T extends Prisma.EmailDraftSelect>(
		draftId: string,
		userId: string,
		select: T,
	): Promise<Prisma.EmailDraftGetPayload<{ select: T }>> {
		await requireWorkspaceRole(this.db, userId);
		const row = await this.db.emailDraft.findFirst({
			where: { id: draftId, userId },
			select,
		});
		if (!row) throw new NotFoundException("Draft not found.");
		return row as Prisma.EmailDraftGetPayload<{ select: T }>;
	}
}

function cleanAddresses(value: readonly DraftRecipientInput[]): DraftAddress[] {
	const seen = new Set<string>();
	const result: DraftAddress[] = [];
	for (const entry of value) {
		const email = entry.email.trim().toLowerCase();
		if (!email || seen.has(email)) continue;
		seen.add(email);
		result.push({ email, name: entry.name?.trim() || null });
	}
	return result;
}

function addressesOf(value: unknown): DraftAddress[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const record = entry as Record<string, unknown>;
		if (typeof record.email !== "string") return [];
		return [
			{
				email: record.email.trim().toLowerCase(),
				name: typeof record.name === "string" ? record.name : null,
			},
		];
	});
}

function decodeAttachment(value: string): Buffer {
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length % 4 === 1 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) ||
		(normalized.includes("=") && !/=+$/.test(normalized))
	) {
		throw new BadRequestException(
			"The attachment content is not valid base64.",
		);
	}

	const content = Buffer.from(normalized, "base64");
	const canonical = content.toString("base64").replace(/=+$/, "");
	const inputCanonical = normalized.replace(/=+$/, "");
	if (canonical !== inputCanonical) {
		throw new BadRequestException(
			"The attachment content is not valid base64.",
		);
	}

	return content;
}

export function assertAttachmentSize(size: number, total: number): void {
	if (size > MAX_ATTACHMENT_BYTES) {
		throw new BadRequestException("Each attachment must be 10 MB or smaller.");
	}
	if (total + size > MAX_MESSAGE_BYTES) {
		throw new BadRequestException(
			"Attachments in one message cannot exceed 20 MB.",
		);
	}
}

function presentDraft(draft: {
	id: string;
	threadId: string | null;
	inReplyTo: string | null;
	references: string | null;
	to: unknown;
	cc: unknown;
	bcc: unknown;
	subject: string;
	body: string;
	status: EmailDraftStatus;
	lastError: string | null;
	sentMessageId: string | null;
	sentFrom: string | null;
	sentAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
	attachments: {
		id: string;
		filename: string;
		mimeType: string | null;
		size: number;
	}[];
}) {
	return {
		id: draft.id,
		threadId: draft.threadId,
		inReplyTo: draft.inReplyTo,
		references: draft.references,
		to: addressesOf(draft.to),
		cc: addressesOf(draft.cc),
		bcc: addressesOf(draft.bcc),
		subject: draft.subject,
		body: draft.body,
		status: draft.status,
		lastError: draft.lastError,
		sentMessageId: draft.sentMessageId,
		sentFrom: draft.sentFrom,
		sentAt: draft.sentAt?.toISOString() ?? null,
		createdAt: draft.createdAt.toISOString(),
		updatedAt: draft.updatedAt.toISOString(),
		attachments: draft.attachments,
	};
}
