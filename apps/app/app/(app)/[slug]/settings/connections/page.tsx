import type { Metadata } from "next";
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
import { GoogleConnection } from "./google-connection";
import { ZohoConnection } from "./zoho-connection";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("settings.connections") };
}

export default async function ConnectionsSettingsPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string | string[] }>;
}) {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	const [{ error }] = await Promise.all([
		searchParams,
		queryClient.prefetchQuery(trpc.google.status.queryOptions()),
		queryClient.prefetchQuery(trpc.google.zohoStatus.queryOptions()),
	]);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>
						<TranslatedText k="settings.connections" />
					</PageShellTitle>
					<PageShellDescription>
						<TranslatedText k="settings.connectionsDescription" />
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<div className="flex max-w-3xl flex-col gap-6">
						<GoogleConnection
							connectError={Array.isArray(error) ? error[0] : error}
						/>
						<ZohoConnection />
					</div>
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
