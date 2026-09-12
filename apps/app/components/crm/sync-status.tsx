"use client";

import type { GoogleSyncStatus } from "@crm/db/enums";
import {
	StatusIndicator,
	type StatusTone,
} from "@crm/ui/components/status-indicator";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n-core";

const PRESENTATION: Record<
	GoogleSyncStatus,
	{ key: TranslationKey; tone: StatusTone; busy?: boolean }
> = {
	IDLE: { key: "sync.connected", tone: "success" },
	RUNNING: { key: "sync.syncing", tone: "info", busy: true },
	NEEDS_RECONNECT: { key: "sync.reconnect", tone: "warning" },
	FAILED: { key: "sync.failed", tone: "error" },
};

export function SyncIndicator({
	status,
	title,
	className,
}: {
	status: GoogleSyncStatus | null;
	title?: string | null;
	className?: string;
}) {
	const { t } = useLanguage();

	if (status === null) {
		return (
			<StatusIndicator
				tone="neutral"
				label={t("sync.notConnected")}
				className={className}
			/>
		);
	}

	const { key, tone, busy } = PRESENTATION[status];

	return (
		<StatusIndicator
			tone={tone}
			busy={busy}
			label={t(key)}
			title={title ?? undefined}
			className={className}
		/>
	);
}

export function isSyncing(status: GoogleSyncStatus | null): boolean {
	return status === "RUNNING";
}

export const SYNC_POLL_MS = 5_000;
