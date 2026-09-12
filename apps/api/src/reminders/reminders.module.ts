import { Module } from "@nestjs/common";
import { LocalReminderSchedulerService } from "./local-reminder-scheduler.service";
import { RemindersController } from "./reminders.controller";
import { RemindersService } from "./reminders.service";

@Module({
	controllers: [RemindersController],
	providers: [RemindersService, LocalReminderSchedulerService],
})
export class RemindersModule {}
