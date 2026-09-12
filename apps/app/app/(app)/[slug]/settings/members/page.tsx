import type { Metadata } from "next";
import type { SearchParams } from "nuqs/server";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { TranslatedText } from "@/components/translated-text";
import { getRequestTranslation } from "@/lib/i18n-server";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { membersSearchParams } from "./members-search-params";
import { MembersTable } from "./members-table";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("settings.members") };
}

export default async function MembersSettingsPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();

	const values = await membersSearchParams.load(searchParams);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.workspace.get.queryOptions()),
		queryClient.prefetchQuery(
			trpc.workspace.members.queryOptions(membersSearchParams.toInput(values)),
		),
	]);

	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>
						<TranslatedText k="settings.members" />
					</PageShellTitle>
					<PageShellDescription>
						<TranslatedText k="settings.membersDescription" />
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<MembersTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
