"use client";

import {
	INQUIRY_STAGES,
	isClosedInquiryStage,
	OPEN_INQUIRY_STAGES,
} from "@crm/db/deal-stage";
import { DealStage } from "@crm/db/enums";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";
import { useLanguage } from "@/lib/i18n";
import { type Language, type TranslationKey, translate } from "@/lib/i18n-core";

const ORDER = INQUIRY_STAGES;

const PRESENTATION: Record<
	DealStage,
	{ key: TranslationKey; tone: StatusTone }
> = {
	NEW_INQUIRY: { key: "deal.stage.newInquiry", tone: "neutral" },
	CONTACTED: { key: "deal.stage.contacted", tone: "info" },
	REPLIED: { key: "deal.stage.replied", tone: "info" },
	RFQ_RECEIVED: { key: "deal.stage.rfqReceived", tone: "info" },
	QUOTED: { key: "deal.stage.quoted", tone: "warning" },
	SAMPLE: { key: "deal.stage.sample", tone: "warning" },
	NEGOTIATING: { key: "deal.stage.negotiating", tone: "warning" },
	PROFORMA_INVOICE: { key: "deal.stage.proformaInvoice", tone: "warning" },
	WON: { key: "deal.stage.won", tone: "success" },
	LOST: { key: "deal.stage.lost", tone: "error" },
	UNQUALIFIED: { key: "deal.stage.unqualified", tone: "neutral" },
};

export const OPEN_STAGES: readonly DealStage[] = OPEN_INQUIRY_STAGES;
export const isClosedStage = isClosedInquiryStage;

export const LOSING_STAGES: readonly DealStage[] = [
	DealStage.LOST,
	DealStage.UNQUALIFIED,
];

export const DEAL_STAGE_OPTIONS = ORDER.map((value) => ({
	value,
	label: translate("en", PRESENTATION[value].key),
}));

const OPEN_STAGE_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
] as const;

export function dealStageColor(stage: DealStage): string {
	return OPEN_STAGE_COLORS[OPEN_STAGES.indexOf(stage)] ?? "var(--chart-5)";
}

export function dealStageLabel(
	stage: DealStage,
	language: Language = "en",
): string {
	return translate(language, PRESENTATION[stage].key);
}

export function DealStageIndicator({
	stage,
	className,
}: {
	stage: DealStage;
	className?: string;
}) {
	const { language } = useLanguage();
	const { tone } = PRESENTATION[stage];
	return (
		<StatusIndicator
			tone={tone}
			label={dealStageLabel(stage, language)}
			className={className}
		/>
	);
}
