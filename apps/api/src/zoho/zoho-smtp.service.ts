import type { Db } from "@crm/db";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import nodemailer from "nodemailer";
import { requireWorkspaceRole } from "../crm/access";
import { InjectDatabase } from "../database/database.constants";
import { ZohoCredentialsService } from "./zoho-credentials.service";

const SMTP_PORT = 465;
const SMTP_HOSTS: Record<string, string> = {
	"imap.zoho.com": "smtp.zoho.com",
	"imap.zoho.eu": "smtp.zoho.eu",
	"imap.zoho.in": "smtp.zoho.in",
	"imap.zoho.com.au": "smtp.zoho.com.au",
	"imap.zoho.jp": "smtp.zoho.jp",
	"imap.zoho.com.cn": "smtp.zoho.com.cn",
	"imap.zoho.sa": "smtp.zoho.sa",
};

export type ZohoMailDraft = {
	to: string[];
	cc?: string[];
	bcc?: string[];
	subject: string;
	body: string;
	inReplyTo?: string;
	references?: string;
	messageId?: string;
	attachments?: {
		filename: string;
		content: Buffer;
		contentType?: string | null;
	}[];
};

export type ZohoMailSendResult = {
	messageId: string;
	from: string;
	to: string[];
	subject: string;
};

@Injectable()
export class ZohoSmtpService {
	private readonly logger = new Logger(ZohoSmtpService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly credentials: ZohoCredentialsService,
	) {}

	async send(
		userId: string,
		draft: ZohoMailDraft,
	): Promise<ZohoMailSendResult> {
		await requireWorkspaceRole(this.db, userId);
		const mailbox = await this.db.zohoMailbox.findUnique({
			where: { userId },
		});
		if (!mailbox) {
			throw new NotFoundException(
				"Zoho Mail is not connected. Connect a mailbox before sending.",
			);
		}

		const password = this.credentials.decrypt(mailbox.encryptedPassword);
		const smtpHost = SMTP_HOSTS[mailbox.host] ?? "smtp.zoho.com";

		const transporter = nodemailer.createTransport({
			host: smtpHost,
			port: SMTP_PORT,
			secure: true,
			auth: {
				user: mailbox.email,
				pass: password,
			},
			connectionTimeout: 20_000,
			socketTimeout: 60_000,
		});

		const to = [...new Set(draft.to.map((address) => address.trim()))].filter(
			Boolean,
		);
		if (to.length === 0) {
			throw new NotFoundException("A recipient is required to send mail.");
		}

		const subject = draft.subject.trim() || "(no subject)";
		const message: nodemailer.SendMailOptions = {
			from: mailbox.email,
			to,
			subject,
			text: draft.body,
		};
		if (draft.messageId) message.messageId = draft.messageId;
		if (draft.attachments?.length) {
			message.attachments = draft.attachments.map((attachment) => ({
				filename: attachment.filename,
				content: attachment.content,
				contentType: attachment.contentType ?? undefined,
			}));
		}
		if (draft.cc?.length) {
			message.cc = [
				...new Set(draft.cc.map((address) => address.trim())),
			].filter(Boolean);
		}
		if (draft.bcc?.length) {
			message.bcc = [
				...new Set(draft.bcc.map((address) => address.trim())),
			].filter(Boolean);
		}
		if (draft.inReplyTo) {
			message.inReplyTo = draft.inReplyTo;
		}
		if (draft.references) {
			message.references = draft.references;
		}

		let info: nodemailer.SentMessageInfo;
		try {
			info = await transporter.sendMail(message);
		} catch (error) {
			this.logger.warn({
				message: "Zoho Mail send failed",
				userId,
				to,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			transporter.close();
		}

		const messageId = info.messageId ?? draft.messageId ?? "";
		this.logger.log({
			message: "Zoho Mail sent",
			userId,
			to,
			subject,
			messageId: messageId || null,
		});

		return {
			messageId,
			from: mailbox.email,
			to,
			subject,
		};
	}
}
