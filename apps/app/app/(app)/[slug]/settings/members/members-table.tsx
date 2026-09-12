"use client";

import OverflowMenuHorizontal from "@carbon/icons-react/es/OverflowMenuHorizontal";
import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Icon } from "@crm/ui/components/icon";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListSearch } from "@/components/data-table/list-search";
import {
	LocalizedDataTable as DataTable,
	type DataTableColumn,
	type DataTableFacet,
} from "@/components/data-table/localized-data-table";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { formatRelativeTime, type Language } from "@/lib/i18n-core";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { membersSearchParams } from "./members-search-params";

const ROLE_LABEL = {
	owner: "settings.role.owner",
	admin: "settings.role.admin",
	member: "settings.role.member",
} as const satisfies Record<string, TranslationKey>;

type Role = keyof typeof ROLE_LABEL;

type MemberRow = RouterOutputs["workspace"]["members"]["rows"][number];

function columns(
	t: (key: TranslationKey, values?: Record<string, string | number>) => string,
	language: Language,
	canChangeRoles: boolean,
	onChangeRole: (member: MemberRow, role: Role) => void,
	pending: boolean,
): DataTableColumn<MemberRow>[] {
	return [
		{
			id: "name",
			header: t("common.name"),
			sortable: true,
			hideable: false,
			width: "w-[34%]",
			cell: (row) => (
				<span className="flex min-w-0 items-center gap-2">
					<PersonAvatar
						size="sm"
						src={row.image}
						name={row.name}
						email={row.email}
					/>
					<span className="truncate font-medium">{row.name}</span>
					{row.isViewer ? (
						<span className="text-muted-foreground text-xs">
							{t("settings.you")}
						</span>
					) : null}
				</span>
			),
		},
		{
			id: "email",
			header: t("common.email"),
			sortable: true,
			width: "w-[32%]",
			hideBelow: "md",
			cell: (row) => (
				<span className="truncate text-muted-foreground">{row.email}</span>
			),
		},
		{
			id: "role",
			header: t("settings.role"),
			sortable: true,
			width: "w-[14%]",
			cell: (row) => (
				<span className="text-muted-foreground">{t(ROLE_LABEL[row.role])}</span>
			),
		},
		{
			id: "joinedAt",
			header: t("settings.joined"),
			label: t("settings.joinedDate"),
			sortable: true,
			align: "right",
			width: "w-[14%]",
			hideBelow: "sm",
			cell: (row) => (
				<span className="text-muted-foreground" suppressHydrationWarning>
					{formatRelativeTime(row.joinedAt, language)}
				</span>
			),
		},
		{
			id: "actions",
			header: <span className="sr-only">{t("settings.actions")}</span>,
			label: t("settings.actions"),
			hideable: false,
			align: "right",
			width: "w-[6%]",
			cell: (row) =>
				canChangeRoles ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" disabled={pending}>
								<Icon icon={OverflowMenuHorizontal} />
								<span className="sr-only">
									{t("settings.changeRole", { name: row.name })}
								</span>
							</Button>
						</DropdownMenuTrigger>

						<DropdownMenuContent align="end">
							{(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
								<DropdownMenuItem
									key={role}
									data-checked={row.role === role}
									onSelect={() => {
										if (row.role === role) return;
										onChangeRole(row, role);
									}}
								>
									{t(ROLE_LABEL[role])}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				) : null,
		},
	];
}

export function MembersTable() {
	const { language, t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const { query, input } = useTableQuery(membersSearchParams);

	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const members = useQuery({
		...trpc.workspace.members.queryOptions(input),
		placeholderData: (previous) => previous,
	});

	const setRole = useMutation(
		trpc.workspace.setMemberRole.mutationOptions({
			onSuccess: async () => {
				await cache.workspace();
				toast.success(t("settings.roleChanged"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const facetCounts = members.data?.facetCounts;

	const facets: DataTableFacet[] = [
		{
			id: "role",
			label: t("settings.role"),
			options: (Object.keys(ROLE_LABEL) as Role[])
				.map((role) => ({ value: role, label: t(ROLE_LABEL[role]) }))
				.filter((option) => (facetCounts?.role?.[option.value] ?? 0) > 0),
		},
	];

	return (
		<DataTable
			query={query}
			search={<ListSearch placeholder={t("settings.memberSearch")} />}
			columns={columns(
				t,
				language,
				workspace.data?.canChangeRoles ?? false,
				(member, role) => setRole.mutate({ memberId: member.id, role }),
				setRole.isPending,
			)}
			rows={members.data?.rows ?? []}
			total={members.data?.total ?? 0}
			facetCounts={facetCounts}
			facets={facets}
			getRowId={(row) => row.id}
			loading={members.isFetching}
			empty={t("settings.memberEmpty")}
		/>
	);
}
