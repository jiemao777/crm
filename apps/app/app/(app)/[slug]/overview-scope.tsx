"use client";

import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useQueryState } from "nuqs";
import { useLanguage } from "@/lib/i18n";
import {
	OVERVIEW_SCOPES,
	type OverviewScope,
	overviewParsers,
} from "./overview-search-params";

function isScope(value: string): value is OverviewScope {
	return (OVERVIEW_SCOPES as readonly string[]).includes(value);
}

export function OverviewScopeToggle() {
	const { t } = useLanguage();
	const [scope, setScope] = useQueryState("scope", overviewParsers.scope);
	const labels: Record<OverviewScope, string> = {
		me: t("dashboard.me"),
		everyone: t("dashboard.everyone"),
	};

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			spacing={0}
			value={scope}
			onValueChange={(next) => {
				if (isScope(next)) void setScope(next);
			}}
			aria-label={t("dashboard.scopeLabel")}
		>
			{OVERVIEW_SCOPES.map((value) => (
				<ToggleGroupItem key={value} value={value}>
					{labels[value]}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
