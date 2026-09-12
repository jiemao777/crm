"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { PageShellDescription, PageShellTitle } from "@/components/page-shell";
import { useLanguage } from "@/lib/i18n";
import { useTRPC } from "@/lib/trpc/client";
import { overviewParsers } from "./overview-search-params";

export function OverviewGreeting() {
	const trpc = useTRPC();
	const { t } = useLanguage();
	const { data: me } = useSuspenseQuery(trpc.users.me.queryOptions());
	const [scope] = useQueryState("scope", overviewParsers.scope);

	return (
		<>
			<PageShellTitle>
				{t("dashboard.welcome", { name: me.name.split(" ")[0] ?? me.name })}
			</PageShellTitle>
			<PageShellDescription>
				{scope === "me" ? t("dashboard.subtitle") : t("dashboard.teamSubtitle")}
			</PageShellDescription>
		</>
	);
}
