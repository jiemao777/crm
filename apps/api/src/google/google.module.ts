import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { MailModule } from "../mail/mail.module";
import { TrpcModule } from "../trpc/trpc.module";
import { ZohoCredentialsService } from "../zoho/zoho-credentials.service";
import { ZohoMailService } from "../zoho/zoho-mail.service";
import { ZohoSmtpService } from "../zoho/zoho-smtp.service";
import { CalendarClient } from "./calendar.client";
import { CalendarSyncService } from "./calendar-sync.service";
import { ConversationService } from "./conversation.service";
import { EmailDraftService } from "./email-draft.service";
import { GmailClient } from "./gmail.client";
import { GmailSyncService } from "./gmail-sync.service";
import { GoogleRouter } from "./google.router";
import { GoogleApiClient } from "./google-api.client";
import { GoogleConnectionService } from "./google-connection.service";
import { GoogleSyncService } from "./google-sync.service";
import { GoogleTokenService } from "./google-token.service";
import { LocalSyncSchedulerService } from "./local-sync-scheduler.service";
import { MailAttachmentController } from "./mail-attachment.controller";
import { SyncController } from "./sync.controller";
import { SyncStateService } from "./sync-state.service";
import { ZohoConnectionService } from "./zoho-connection.service";

@Module({
	imports: [TrpcModule, AgentModule, MailModule],
	controllers: [SyncController, MailAttachmentController],
	providers: [
		GoogleApiClient,
		GoogleTokenService,
		SyncStateService,
		CalendarClient,
		CalendarSyncService,
		GmailClient,
		GmailSyncService,
		GoogleSyncService,
		LocalSyncSchedulerService,
		GoogleConnectionService,
		ZohoCredentialsService,
		ZohoMailService,
		ZohoConnectionService,
		ZohoSmtpService,
		ConversationService,
		EmailDraftService,
		GoogleRouter,
	],
	exports: [GoogleSyncService, GoogleConnectionService],
})
export class GoogleModule {}
