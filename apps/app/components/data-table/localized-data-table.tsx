"use client";

import { DataTable, type DataTableProps } from "@crm/ui/components/data-table";
import { useLanguage } from "@/lib/i18n";

export type {
	DataTableColumn,
	DataTableExpandable,
	DataTableFacet,
	DataTableLabels,
	DataTableProps,
	DataTableTabs,
} from "@crm/ui/components/data-table";

export function LocalizedDataTable<TRow, TSub = unknown>(
	props: DataTableProps<TRow, TSub>,
) {
	const { t } = useLanguage();
	const labels = {
		all: t("table.all"),
		filters: t("table.filters"),
		sort: t("table.sort"),
		sortBy: t("table.sortBy"),
		detail: t("common.detail"),
		ascending: t("table.ascending"),
		descending: t("table.descending"),
		columns: t("table.columns"),
		toggleColumns: t("table.toggleColumns"),
		noResults: t("common.noResults"),
		...props.labels,
		pagination: {
			noResults: t("common.noResults"),
			showing: (start: string, end: string, total: string) =>
				t("common.showingResults", { start, end, total }),
			previous: t("common.previous"),
			next: t("common.next"),
			...props.labels?.pagination,
		},
	};

	return <DataTable {...props} labels={labels} />;
}
