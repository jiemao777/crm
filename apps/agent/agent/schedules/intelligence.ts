import { db } from "@crm/db";
import { PRIORITY } from "@crm/db/agent-tasks";
import { OPEN_INQUIRY_STAGES } from "@crm/db/deal-stage";
import { defineSchedule } from "eve/schedules";
import { scheduleTask } from "../lib/tasks";

export default defineSchedule({
	cron: "23 3 * * *",
	async run() {
		const open = await db.deal.findMany({
			where: { stage: { in: [...OPEN_INQUIRY_STAGES] } },
			select: { id: true },
		});

		for (const inquiry of open) {
			await scheduleTask({
				dealId: inquiry.id,
				kind: "inquiry-intelligence",
				reason: "Nightly intelligence sweep",
				dueAt: new Date(),
				priority: PRIORITY.sweep,
				budget: 4,
			});
		}
	},
});
