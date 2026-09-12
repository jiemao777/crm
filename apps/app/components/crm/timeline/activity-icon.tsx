import ArrowRight from "@carbon/icons-react/es/ArrowRight";
import Chat from "@carbon/icons-react/es/Chat";
import Email from "@carbon/icons-react/es/Email";
import Events from "@carbon/icons-react/es/Events";
import MagicWand from "@carbon/icons-react/es/MagicWand";
import Phone from "@carbon/icons-react/es/Phone";
import Task from "@carbon/icons-react/es/Task";
import type { ActivityType } from "@crm/db/enums";
import type { CarbonIcon } from "@crm/ui/components/icon";
import { Icon } from "@crm/ui/components/icon";
import { type Language, type TranslationKey, translate } from "@/lib/i18n-core";

const PRESENTATION: Record<
	ActivityType,
	{ icon: CarbonIcon; key: TranslationKey }
> = {
	NOTE: { icon: Chat, key: "activity.note" },
	CALL: { icon: Phone, key: "activity.call" },
	EMAIL: { icon: Email, key: "activity.email" },
	MEETING: { icon: Events, key: "activity.meeting" },
	TASK: { icon: Task, key: "activity.task" },
	STAGE_CHANGE: { icon: ArrowRight, key: "activity.stageChange" },
	ENRICHMENT: { icon: MagicWand, key: "activity.enrichment" },
};

export function activityLabel(
	type: ActivityType,
	language: Language = "en",
): string {
	return translate(language, PRESENTATION[type].key);
}

export function ActivityIcon({ type }: { type: ActivityType }) {
	return <Icon icon={PRESENTATION[type].icon} />;
}
