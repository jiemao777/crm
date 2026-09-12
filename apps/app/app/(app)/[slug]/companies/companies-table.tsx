"use client";

import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	EntityLogo,
	type EntityLogoTone,
} from "@crm/ui/components/entity-logo";
import { useQuery } from "@tanstack/react-query";
import {
	ENRICHMENT_FACET_OPTIONS,
	ENRICHMENT_POLL_MS,
	EnrichmentIndicator,
	enrichmentLabel,
	isEnriching,
} from "@/components/crm/enrichment-status";
import { OwnerCell } from "@/components/crm/owner-cell";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { ListSearch } from "@/components/data-table/list-search";
import {
	LocalizedDataTable as DataTable,
	type DataTableColumn,
	type DataTableFacet,
} from "@/components/data-table/localized-data-table";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { formatRelativeTime, type Language } from "@/lib/i18n-core";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { companiesSearchParams } from "./companies-search-params";

type CompanyRow = RouterOutputs["companies"]["list"]["rows"][number];

const CUSTOMER_TYPE_KEYS = {
	LEAD: "company.type.lead",
	BUYER: "company.type.buyer",
	DISTRIBUTOR: "company.type.distributor",
	AGENT: "company.type.agent",
	CUSTOMER: "company.type.customer",
} as const satisfies Record<string, TranslationKey>;

const makeColumns = (
	t: (key: TranslationKey) => string,
	language: Language,
): DataTableColumn<CompanyRow>[] => [
	{
		id: "name",
		header: t("company.name"),
		sortable: true,
		hideable: false,
		width: "w-[26%]",
		cell: (row) => (
			<span className="flex min-w-0 items-center gap-2.5">
				<EntityLogo
					src={row.iconUrl ?? row.logoUrl}
					darkSrc={row.iconDarkUrl}
					tone={row.iconTone as EntityLogoTone | null | undefined}
					name={row.name}
					size="sm"
				/>
				<span className="truncate font-medium">{row.name}</span>
			</span>
		),
	},
	{
		id: "domain",
		header: t("company.domain"),
		sortable: true,
		width: "w-[16%]",
		hideBelow: "md",
		cell: (row) =>
			row.domain ? (
				<span className="truncate text-muted-foreground">{row.domain}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "customerType",
		header: t("company.type"),
		width: "w-[12%]",
		hideBelow: "lg",
		cell: (row) => (
			<span className="truncate">
				{t(CUSTOMER_TYPE_KEYS[row.customerType])}
			</span>
		),
	},
	{
		id: "productInterest",
		header: t("company.productInterest"),
		width: "w-[18%]",
		hideBelow: "lg",
		cell: (row) =>
			row.productInterest ? (
				<span className="truncate">{row.productInterest}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "owner",
		header: t("company.owner"),
		sortable: true,
		width: "w-[16%]",
		hideBelow: "md",
		cell: (row) => <OwnerCell owner={row.owner} />,
	},
	{
		id: "contacts",
		header: t("company.contacts"),
		sortable: true,
		align: "right",
		width: "w-[9%]",
		hideBelow: "lg",
		cell: (row) => <span className="tabular-nums">{row.contactCount}</span>,
	},
	{
		id: "deals",
		header: t("company.openDeals"),
		sortable: true,
		align: "right",
		width: "w-[9%]",
		cell: (row) => <span className="tabular-nums">{row.openDealCount}</span>,
	},
	{
		id: "createdAt",
		header: t("company.created"),
		label: t("company.createdDate"),
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
		header: t("company.lastActivity"),
		sortable: true,
		align: "right",
		width: "w-[12%]",
		hideBelow: "sm",
		cell: (row) => (
			<span className="text-muted-foreground" suppressHydrationWarning>
				{formatRelativeTime(row.lastActivityAt, language)}
			</span>
		),
	},
	{
		id: "enrichment",
		header: t("company.enrichment"),
		label: t("company.enrichmentStatus"),
		defaultHidden: true,
		width: "w-[14%]",
		cell: (row) => (
			<EnrichmentIndicator status={row.enrichmentStatus} queued={row.queued} />
		),
	},
];

export function CompaniesTable() {
	const { language, t } = useLanguage();
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const prefetchRecord = usePrefetchRecord();
	const { query, input } = useTableQuery(companiesSearchParams);

	const companies = useQuery({
		...trpc.companies.list.queryOptions(input),
		placeholderData: (previous) => previous,
		refetchInterval: (query) =>
			query.state.data?.rows.some((row) =>
				isEnriching(row.enrichmentStatus, row.queued),
			)
				? ENRICHMENT_POLL_MS
				: false,
	});
	const users = useQuery(trpc.users.list.queryOptions());

	const facetCounts = companies.data?.facetCounts;

	const facets: DataTableFacet[] = [
		{
			id: "owner",
			label: t("company.owner"),
			options: [
				{ value: "unassigned", label: t("common.unassigned") },
				...(users.data ?? []).map((user) => ({
					value: user.id,
					label: user.name,
				})),
			].filter((option) => (facetCounts?.owner?.[option.value] ?? 0) > 0),
		},
		{
			id: "customerType",
			label: t("company.customerType"),
			options: Object.keys(facetCounts?.customerType ?? {}).map((value) => ({
				value,
				label: t(CUSTOMER_TYPE_KEYS[value as keyof typeof CUSTOMER_TYPE_KEYS]),
			})),
		},
		{
			id: "industry",
			label: t("company.industry"),
			options: Object.keys(facetCounts?.industry ?? {})
				.sort()
				.map((value) => ({ value, label: value })),
		},
		{
			id: "enrichment",
			label: t("company.enrichment"),
			options: ENRICHMENT_FACET_OPTIONS.filter(
				(option) => (facetCounts?.enrichment?.[option.value] ?? 0) > 0,
			).map((option) => ({
				...option,
				label: enrichmentLabel(option.value, language),
			})),
		},
	];

	return (
		<DataTable
			query={query}
			search={<ListSearch placeholder={t("company.search")} />}
			columns={makeColumns(t, language)}
			rows={companies.data?.rows ?? []}
			total={companies.data?.total ?? 0}
			facetCounts={facetCounts}
			facets={facets}
			getRowId={(row) => row.id}
			loading={companies.isFetching}
			onRowHover={(row) => prefetchRecord({ kind: "company", id: row.id })}
			onRowClick={(row) => openRecord({ kind: "company", id: row.id })}
			empty={t("company.empty")}
		/>
	);
}
