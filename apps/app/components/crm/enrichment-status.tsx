"use client";

import type { EnrichmentStatus } from "@crm/db/enums";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";
import { useLanguage } from "@/lib/i18n";
import { type Language, type TranslationKey, translate } from "@/lib/i18n-core";

const PRESENTATION: Record<
	EnrichmentStatus,
	{ key: TranslationKey; tone: StatusTone; busy?: boolean }
> = {
	PENDING: { key: "enrichment.pending", tone: "neutral" },
	RUNNING: { key: "enrichment.running", tone: "info", busy: true },
	COMPLETE: { key: "enrichment.complete", tone: "success" },
	FAILED: { key: "enrichment.failed", tone: "error" },
	SKIPPED: { key: "enrichment.skipped", tone: "neutral" },
};

const QUEUED = {
	key: "enrichment.queued" as TranslationKey,
	tone: "neutral" as StatusTone,
	busy: false,
};

function present(status: EnrichmentStatus, queued: boolean) {
	return status === "PENDING" && queued ? QUEUED : PRESENTATION[status];
}

export function enrichmentLabel(
	status: EnrichmentStatus,
	language: Language,
	queued = false,
): string {
	return translate(language, present(status, queued).key);
}

export function EnrichmentIndicator({
	status,
	queued = false,
	title,
	className,
}: {
	status: EnrichmentStatus;
	queued?: boolean;
	title?: string | null;
	className?: string;
}) {
	const { language } = useLanguage();
	const { tone, busy } = present(status, queued);

	return (
		<StatusIndicator
			tone={tone}
			busy={busy}
			label={enrichmentLabel(status, language, queued)}
			title={title ?? undefined}
			className={className}
		/>
	);
}

export function isEnriching(status: EnrichmentStatus, queued = false): boolean {
	return status === "RUNNING" || (status === "PENDING" && queued);
}

export const ENRICHMENT_POLL_MS = 3_000;

export const ENRICHMENT_FACET_OPTIONS = (
	Object.keys(PRESENTATION) as EnrichmentStatus[]
).map((value) => ({
	value,
	label: enrichmentLabel(value, "en"),
}));
