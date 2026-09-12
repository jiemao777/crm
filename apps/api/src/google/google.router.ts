import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import { z } from "zod";
import { MailLeadIntakeService } from "../mail/mail-lead-intake.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { ZohoSmtpService } from "../zoho/zoho-smtp.service";
import { ConversationService } from "./conversation.service";
import { EmailDraftService } from "./email-draft.service";
import {
	attachmentInput,
	bulkThreadStateInput,
	calendarEventInput,
	draftAttachmentDeleteInput,
	draftAttachmentInput,
	draftInput,
	manualLeadInput,
	markThreadReadInput,
	recipientSuggestionInput,
	saveDraftInput,
	sendDraftInput,
	sendZohoMailInput,
	setAutoCreateInput,
	suppressDomainInput,
	threadInput,
	threadListInput,
	threadStateInput,
	zohoConnectInput,
} from "./google.contracts";
import { GoogleConnectionService } from "./google-connection.service";
import { GoogleSyncService } from "./google-sync.service";
import { ZohoConnectionService } from "./zoho-connection.service";

@Router({ alias: "google" })
@UseMiddlewares(AuthMiddleware)
export class GoogleRouter {
	constructor(
		@Inject(GoogleConnectionService)
		private readonly connection: GoogleConnectionService,
		@Inject(GoogleSyncService) private readonly sync: GoogleSyncService,
		@Inject(ConversationService)
		private readonly conversations: ConversationService,
		@Inject(MailLeadIntakeService)
		private readonly leadIntake: MailLeadIntakeService,
		@Inject(ZohoConnectionService)
		private readonly zoho: ZohoConnectionService,
		@Inject(ZohoSmtpService) private readonly smtp: ZohoSmtpService,
		@Inject(EmailDraftService)
		private readonly draftService: EmailDraftService,
	) {}

	@Query()
	async status(@Ctx() ctx: AuthedTrpcContext) {
		return this.connection.status(ctx.user.id);
	}

	@Mutation()
	async purgeSyncedData(@Ctx() ctx: AuthedTrpcContext) {
		return this.connection.purgeSyncedData(ctx.user.id);
	}

	@Mutation()
	async revokeAccess(@Ctx() ctx: AuthedTrpcContext) {
		return this.connection.revoke(ctx.user.id);
	}

	@Mutation()
	async syncNow(@Ctx() ctx: AuthedTrpcContext) {
		await this.sync.runForUser(ctx.user.id);
		return this.connection.status(ctx.user.id);
	}

	@Mutation()
	async refreshMail(@Ctx() ctx: AuthedTrpcContext) {
		return this.sync.refreshMail(ctx.user.id);
	}

	@Mutation({ input: setAutoCreateInput })
	async setAutoCreate(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof setAutoCreateInput>,
	) {
		await this.connection.setAutoCreate(
			ctx.user.id,
			input.source,
			input.enabled,
		);
		return this.connection.status(ctx.user.id);
	}

	@Query()
	async zohoStatus(@Ctx() ctx: AuthedTrpcContext) {
		return this.zoho.status(ctx.user.id);
	}

	@Mutation({ input: zohoConnectInput })
	async connectZoho(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof zohoConnectInput>,
	) {
		return this.zoho.connect(ctx.user.id, input);
	}

	@Mutation()
	async disconnectZoho(@Ctx() ctx: AuthedTrpcContext) {
		return this.zoho.disconnect(ctx.user.id);
	}

	@Mutation()
	async syncZohoNow(@Ctx() ctx: AuthedTrpcContext) {
		return this.zoho.syncNow(ctx.user.id);
	}

	@Mutation({ input: sendZohoMailInput })
	async sendZohoMail(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof sendZohoMailInput>,
	) {
		return this.smtp.send(ctx.user.id, input);
	}

	@Query()
	async drafts(@Ctx() ctx: AuthedTrpcContext) {
		return this.draftService.list(ctx.user.id);
	}

	@Query({ input: draftInput })
	async draft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("draftId") draftId: string,
	) {
		return this.draftService.get(draftId, ctx.user.id);
	}

	@Mutation({ input: saveDraftInput })
	async saveDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof saveDraftInput>,
	) {
		return this.draftService.save(input, ctx.user.id);
	}

	@Mutation({ input: draftAttachmentInput })
	async addDraftAttachment(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof draftAttachmentInput>,
	) {
		return this.draftService.addAttachment(input, ctx.user.id);
	}

	@Mutation({ input: draftAttachmentDeleteInput })
	async removeDraftAttachment(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof draftAttachmentDeleteInput>,
	) {
		return this.draftService.removeAttachment(input, ctx.user.id);
	}

	@Mutation({ input: draftInput })
	async deleteDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("draftId") draftId: string,
	) {
		return this.draftService.remove(draftId, ctx.user.id);
	}

	@Mutation({ input: sendDraftInput })
	async sendDraft(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("draftId") draftId: string,
	) {
		return this.draftService.send(draftId, ctx.user.id);
	}

	@Query({ input: recipientSuggestionInput })
	async recipientSuggestions(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof recipientSuggestionInput>,
	) {
		return this.conversations.recipientSuggestions(input, ctx.user.id);
	}

	@Mutation()
	async backfillZoho(@Ctx() ctx: AuthedTrpcContext) {
		return this.zoho.backfill(ctx.user.id);
	}

	@Mutation({ input: z.object({ enabled: z.boolean() }) })
	async setZohoAutoCreate(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: { enabled: boolean },
	) {
		return this.zoho.setAutoCreate(ctx.user.id, input.enabled);
	}

	@Mutation({ input: suppressDomainInput })
	async suppressDomain(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof suppressDomainInput>,
	) {
		return this.connection.suppressDomain(
			input.domain,
			{
				reason: input.reason,
				purge: input.purge,
			},
			ctx.user.id,
		);
	}

	@Query({ input: threadInput })
	async thread(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("threadId") threadId: string,
	) {
		return this.conversations.thread(threadId, ctx.user.id);
	}

	@Query({ input: attachmentInput })
	async attachment(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("attachmentId") attachmentId: string,
	) {
		return this.conversations.attachment(attachmentId, ctx.user.id);
	}

	@Query({ input: threadListInput })
	async threads(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("folder") folder: string,
		@Input("cursor") cursor?: string,
		@Input("limit") limit?: number,
		@Input("q") q?: string,
		@Input("unreadOnly") unreadOnly?: boolean,
		@Input("starredOnly") starredOnly?: boolean,
		@Input("state") state?: "active" | "trash",
		@Input("link") link?: "all" | "linked" | "unlinked",
		@Input("category") category?:
			| "INQUIRY"
			| "PROMOTION"
			| "NOTIFICATION"
			| "OTHER",
	) {
		return this.conversations.threads(
			{
				folder,
				cursor,
				limit,
				q,
				unreadOnly,
				starredOnly,
				state,
				link,
				category,
			},
			ctx.user.id,
		);
	}

	@Query()
	async mailCounts(@Ctx() ctx: AuthedTrpcContext) {
		return this.conversations.folderCounts(ctx.user.id);
	}

	@Mutation()
	async relinkUnmatched(@Ctx() ctx: AuthedTrpcContext) {
		return this.conversations.relinkUnmatched(200, ctx.user.id);
	}

	@Mutation({ input: threadStateInput })
	async createCustomerFromThread(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("threadId") threadId: string,
	) {
		return this.leadIntake.createCustomerFromThread(threadId, ctx.user.id);
	}

	@Mutation({ input: manualLeadInput })
	async createCustomerFromThreadManual(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof manualLeadInput>,
	) {
		return this.leadIntake.createCustomerFromThreadManual(
			input.threadId,
			input,
			ctx.user.id,
		);
	}

	@Mutation({ input: markThreadReadInput })
	async markThreadRead(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("threadId") threadId: string,
		@Input("read") read: boolean,
	) {
		return this.conversations.markThreadRead(threadId, read, ctx.user.id);
	}

	@Mutation({ input: threadStateInput })
	async toggleThreadStar(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("threadId") threadId: string,
	) {
		return this.conversations.toggleThreadStar(threadId, ctx.user.id);
	}

	@Mutation({ input: threadStateInput })
	async trashThread(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("threadId") threadId: string,
	) {
		return this.conversations.trashThread(threadId, ctx.user.id);
	}

	@Mutation({ input: threadStateInput })
	async restoreThread(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("threadId") threadId: string,
	) {
		return this.conversations.restoreThread(threadId, ctx.user.id);
	}

	@Mutation({ input: bulkThreadStateInput })
	async bulkThreadState(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof bulkThreadStateInput>,
	) {
		return this.conversations.bulkThreadState(input, ctx.user.id);
	}

	@Query({ input: calendarEventInput })
	async event(
		@Ctx() ctx: AuthedTrpcContext,
		@Input("eventId") eventId: string,
	) {
		return this.conversations.event(eventId, ctx.user.id);
	}
}
