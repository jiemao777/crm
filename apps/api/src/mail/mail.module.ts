import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CompaniesModule } from "../companies/companies.module";
import { GoogleMatchService } from "../google/google-match.service";
import { MailIngestionService } from "./mail-ingestion.service";
import { MailLeadIntakeService } from "./mail-lead-intake.service";

@Module({
	imports: [AgentModule, CompaniesModule],
	providers: [GoogleMatchService, MailIngestionService, MailLeadIntakeService],
	exports: [GoogleMatchService, MailIngestionService, MailLeadIntakeService],
})
export class MailModule {}
