import type { auth } from "@crm/auth";
import { Controller, Get, Header, Param, Query, Res } from "@nestjs/common";
import {
	AllowAnonymous,
	Session,
	type UserSession,
} from "@thallesp/nestjs-better-auth";
import type { Response } from "express";
import { ConversationService } from "./conversation.service";

type CrmSession = UserSession<typeof auth>;

const PREVIEWABLE = /^(image\/|application\/pdf$|text\/)/;

@Controller("api/mail/attachments")
export class MailAttachmentController {
	constructor(private readonly conversations: ConversationService) {}

	@Get(":attachmentId")
	@AllowAnonymous()
	@Header("Cache-Control", "private, no-store")
	async download(
		@Param("attachmentId") attachmentId: string,
		@Query("preview") preview: string | undefined,
		@Session() session: CrmSession | null,
		@Res() response: Response,
	) {
		const row = await this.conversations.attachmentContent(
			attachmentId,
			session?.user?.id,
		);

		const mime = row.mimeType ?? "application/octet-stream";
		const inline = preview === "1" && PREVIEWABLE.test(mime);
		response.setHeader(
			"Content-Disposition",
			`${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
		);
		response.setHeader("Content-Type", mime);
		if (row.size !== null)
			response.setHeader("Content-Length", String(row.size));
		response.send(row.content ?? Buffer.alloc(0));
	}
}
