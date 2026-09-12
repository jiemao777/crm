"use client";

import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { formatMoney } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import {
	CLOSING_OPTIONS,
	closingWindowLabel,
} from "@/components/crm/closing-window";
import { CompanyCell } from "@/components/crm/company-cell";
import {
	DEAL_STAGE_OPTIONS,
	dealStageLabel,
} from "@/components/crm/deal-stage";
import { OwnerCell } from "@/components/crm/owner-cell";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { DealStageMenu } from "@/components/crm/stage-change";
import { ListSearch } from "@/components/data-table/list-search";
import {
	LocalizedDataTable as DataTable,
	type DataTableColumn,
	type DataTableFacet,
} from "@/components/data-table/localized-data-table";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import {
	formatRelativeTime,
	type Language,
	type Locale,
} from "@/lib/i18n-core";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { dealsSearchParams } from "./deals-search-params";

type DealRow = RouterOutputs["deals"]["list"]["rows"][number];

const makeColumns = (
	t: (key: TranslationKey) => string,
	language: Language,
	locale: Locale,
): DataTableColumn<DealRow>[] => [
	{
		id: "name",
		header: t("deal.inquiry"),
		sortable: true,
		hideable: false,
		width: "w-[24%]",
		cell: (row) => <span className="truncate font-medium">{row.name}</span>,
	},
	{
		id: "company",
		header: t("deal.customer"),
		sortable: true,
		width: "w-[18%]",
		cell: (row) => <CompanyCell company={row.company} />,
	},
	{
		id: "stage",
		header: t("deal.stage"),
		sortable: true,
		width: "w-[18%]",
		cell: (row) => <DealStageMenu dealId={row.id} stage={row.stage} />,
	},
	{
		id: "amount",
		header: t("deal.estValue"),
		sortable: true,
		align: "right",
		width: "w-[12%]",
		hideBelow: "sm",
		cell: (row) =>
			row.amountCents === null ? (
				<EmptyCellValue />
			) : (
				<span className="tabular-nums">
					{formatMoney(row.amountCents, row.currency)}
				</span>
			),
	},
	{
		id: "owner",
		header: t("deal.owner"),
		sortable: true,
		width: "w-[14%]",
		hideBelow: "md",
		cell: (row) => <OwnerCell owner={row.owner} />,
	},
	{
		id: "expectedOrderDate",
		header: t("deal.orderDate"),
		sortable: true,
		width: "w-[12%]",
		hideBelow: "lg",
		cell: (row) =>
			row.expectedOrderDate ? (
				<span className="text-muted-foreground">
					{new Intl.DateTimeFormat(locale, {
						month: "short",
						day: "numeric",
						year: "numeric",
					}).format(new Date(row.expectedOrderDate))}
				</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "createdAt",
		header: t("deal.created"),
		label: t("deal.createdDate"),
		sortable: true,
		align: "right",
		width: "w-[10%]",
		defaultHidden: true,
		cell: (row) => (
			<span className="text-muted-foreground" suppressHydrationWarning>
				{formatRelativeTime(row.createdAt, language)}
			</span>
		),
	},
	{
		id: "lastActivity",
		header: t("deal.lastActivity"),
		sortable: true,
		align: "right",
		width: "w-[12%]",
		hideBelow: "lg",
		cell: (row) => (
			<span className="text-muted-foreground" suppressHydrationWarning>
				{formatRelativeTime(row.lastActivityAt, language)}
			</span>
		),
	},
];

export function DealsTable() {
	const { language, locale, t } = useLanguage();
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const prefetchRecord = usePrefetchRecord();
	const { query, input } = useTableQuery(dealsSearchParams);

	const deals = useQuery({
		...trpc.deals.list.queryOptions(input),
		placeholderData: (previous) => previous,
	});
	const users = useQuery(trpc.users.list.queryOptions());

	const facetCounts = deals.data?.facetCounts;

	const facets: DataTableFacet[] = [
		{
			id: "owner",
			label: t("deal.owner"),
			options: (users.data ?? [])
				.map((user) => ({ value: user.id, label: user.name }))
				.filter((option) => (facetCounts?.owner?.[option.value] ?? 0) > 0),
		},
		{
			id: "stage",
			label: t("deal.stage"),
			options: DEAL_STAGE_OPTIONS.filter(
				(option) => (facetCounts?.stage?.[option.value] ?? 0) > 0,
			).map((option) => ({
				...option,
				label: dealStageLabel(option.value, language),
			})),
		},
		{
			id: "closing",
			label: t("deal.closing"),
			options: CLOSING_OPTIONS.filter(
				(option) => (facetCounts?.closing?.[option.value] ?? 0) > 0,
			).map((option) => ({
				value: option.value,
				label: closingWindowLabel(option.value, language),
			})),
		},
	];

	const openValue = deals.data?.openValue;
	const openValueText =
		openValue && openValue.length > 0
			? openValue
					.map((entry) => formatMoney(entry.valueCents, entry.currency))
					.join(" + ")
			: undefined;

	return (
		<DataTable
			query={query}
			search={<ListSearch placeholder={t("deal.search")} />}
			columns={makeColumns(t, language, locale)}
			rows={deals.data?.rows ?? []}
			total={deals.data?.total ?? 0}
			facetCounts={facetCounts}
			facets={facets}
			tabs={{
				id: "status",
				allLabel: t("deal.all"),
				options: [
					{ value: "open", label: t("deal.active") },
					{ value: "closed", label: t("deal.closed") },
				],
			}}
			getRowId={(row) => row.id}
			loading={deals.isFetching}
			onRowHover={(row) => prefetchRecord({ kind: "deal", id: row.id })}
			onRowClick={(row) => openRecord({ kind: "deal", id: row.id })}
			empty={t("deal.empty")}
			meta={
				openValueText === undefined ? undefined : (
					<span>
						{t("deal.pipelineMeta", {
							count: deals.data?.total ?? 0,
							amount: openValueText,
						})}
					</span>
				)
			}
		/>
	);
}
