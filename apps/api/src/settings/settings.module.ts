import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { BackfillModule } from "../backfill/backfill.module";
import { TrpcModule } from "../trpc/trpc.module";
import { SettingsRouter } from "./settings.router";
import { SettingsService } from "./settings.service";
import { SettingsCredentialsService } from "./settings-credentials.service";

@Module({
	imports: [TrpcModule, AgentModule, BackfillModule],
	providers: [SettingsCredentialsService, SettingsService, SettingsRouter],
	exports: [SettingsService],
})
export class SettingsModule {}
