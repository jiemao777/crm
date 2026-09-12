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
import { CreateDealSheet } from "./create-deal-sheet";
import { dealsSearchParams } from "./deals-search-params";
import { DealsTable } from "./deals-table";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("deal.title") };
}

export default async function DealsPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();

	const values = await dealsSearchParams.load(searchParams);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.deals.list.queryOptions(dealsSearchParams.toInput(values)),
	);
	void queryClient.prefetchQuery(trpc.users.list.queryOptions());
	void queryClient.prefetchQuery(
		trpc.companies.options.queryOptions({ q: "" }),
	);

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>
						<TranslatedTitle k="deal.title" />
					</PageShellTitle>
					<PageShellDescription>
						<TranslatedDescription k="deal.subtitle" />
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<CreateDealSheet />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<DealsTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
