"use client";

import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { useQuery } from "@tanstack/react-query";
import { CompanyCell } from "@/components/crm/company-cell";
import { contactName } from "@/components/crm/contact-name";
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
import { contactsSearchParams } from "./contacts-search-params";

type ContactRow = RouterOutputs["contacts"]["list"]["rows"][number];

const makeColumns = (
	t: (key: TranslationKey) => string,
	language: Language,
): DataTableColumn<ContactRow>[] => [
	{
		id: "name",
		header: t("contact.name"),
		sortable: true,
		hideable: false,
		width: "w-[22%]",
		cell: (row) => (
			<span className="flex min-w-0 items-center gap-2">
				<PersonAvatar
					src={row.imageUrl}
					name={contactName(row)}
					email={row.email}
					size="sm"
				/>
				<span className="truncate font-medium">{contactName(row)}</span>
			</span>
		),
	},
	{
		id: "title",
		header: t("contact.titleField"),
		sortable: true,
		width: "w-[20%]",
		hideBelow: "lg",
		cell: (row) =>
			row.title ? (
				<span className="truncate">{row.title}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "email",
		header: t("contact.email"),
		sortable: true,
		width: "w-[24%]",
		hideBelow: "md",
		cell: (row) =>
			row.email ? (
				<span className="truncate text-muted-foreground">{row.email}</span>
			) : (
				<EmptyCellValue />
			),
	},
	{
		id: "company",
		header: t("contact.company"),
		sortable: true,
		width: "w-[18%]",
		cell: (row) => <CompanyCell company={row.company} />,
	},
	{
		id: "owner",
		header: t("contact.owner"),
		sortable: true,
		width: "w-[16%]",
		hideBelow: "md",
		cell: (row) => <OwnerCell owner={row.owner} />,
	},
	{
		id: "createdAt",
		header: t("contact.created"),
		label: t("contact.createdDate"),
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
		header: t("contact.lastActivity"),
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
];

export function ContactsTable() {
	const { language, t } = useLanguage();
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const prefetchRecord = usePrefetchRecord();
	const { query, input } = useTableQuery(contactsSearchParams);

	const contacts = useQuery({
		...trpc.contacts.list.queryOptions(input),
		placeholderData: (previous) => previous,
	});
	const users = useQuery(trpc.users.list.queryOptions());
	const companies = useQuery(trpc.companies.options.queryOptions({ q: "" }));

	const facetCounts = contacts.data?.facetCounts;

	const facets: DataTableFacet[] = [
		{
			id: "owner",
			label: t("contact.owner"),
			options: [
				{ value: "unassigned", label: t("common.unassigned") },
				...(users.data ?? []).map((user) => ({
					value: user.id,
					label: user.name,
				})),
			].filter((option) => (facetCounts?.owner?.[option.value] ?? 0) > 0),
		},
		{
			id: "company",
			label: t("contact.company"),
			options: [
				{ value: "none", label: t("common.noCompany") },
				...(companies.data ?? []).map((company) => ({
					value: company.id,
					label: company.name,
				})),
			].filter((option) => (facetCounts?.company?.[option.value] ?? 0) > 0),
		},
	];

	return (
		<DataTable
			query={query}
			search={<ListSearch placeholder={t("contact.search")} />}
			columns={makeColumns(t, language)}
			rows={contacts.data?.rows ?? []}
			total={contacts.data?.total ?? 0}
			facetCounts={facetCounts}
			facets={facets}
			getRowId={(row) => row.id}
			loading={contacts.isFetching}
			onRowHover={(row) => prefetchRecord({ kind: "contact", id: row.id })}
			onRowClick={(row) => openRecord({ kind: "contact", id: row.id })}
			empty={t("contact.empty")}
		/>
	);
}
