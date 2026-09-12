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
import { contactsSearchParams } from "./contacts-search-params";
import { ContactsTable } from "./contacts-table";
import { CreateContactSheet } from "./create-contact-sheet";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("contact.title") };
}

export default async function ContactsPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	await requireSession();

	const values = await contactsSearchParams.load(searchParams);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.contacts.list.queryOptions(contactsSearchParams.toInput(values)),
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
						<TranslatedTitle k="contact.title" />
					</PageShellTitle>
					<PageShellDescription>
						<TranslatedDescription k="contact.subtitle" />
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<CreateContactSheet />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<HydrateClient>
					<ContactsTable />
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
