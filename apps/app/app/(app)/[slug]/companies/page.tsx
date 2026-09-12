import type { Metadata } from "next";
import type { SearchParams } from "nuqs/server";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import {
	TranslatedDescription,
	TranslatedTitle,
} from "@/components/translated-text";
import { getRequestTranslation } from "@/lib/i18n-server";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { companiesSearchParams } from "./companies-search-params";
import { CompaniesTable } from "./companies-table";
import { CreateCompanySheet } from "./create-company-sheet";
import { DuplicatesDialog } from "./duplicates-dialog";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("company.title") };
}

export default async function CompaniesPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();

	const values = await companiesSearchParams.load(searchParams);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.companies.list.queryOptions(companiesSearchParams.toInput(values)),
	);
	void queryClient.prefetchQuery(trpc.users.list.queryOptions());

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>
						<TranslatedTitle k="company.title" />
					</PageShellTitle>
					<PageShellDescription>
						<TranslatedDescription k="company.subtitle" />
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<DuplicatesDialog />
					<CreateCompanySheet />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<CompaniesTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
