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
import { AgentProviders } from "./agent-providers";
import { ResearchProvider } from "./research-provider";
import { WorkspaceForm } from "./workspace-form";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("settings.general") };
}

export default async function GeneralSettingsPage() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.workspace.get.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.agentProviders.queryOptions()),
		queryClient.prefetchQuery(trpc.settings.researchProvider.queryOptions()),
	]);

	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>
						<TranslatedText k="settings.general" />
					</PageShellTitle>
					<PageShellDescription>
						<TranslatedText k="settings.generalDescription" />
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<HydrateClient>
					<div className="flex max-w-3xl flex-col gap-6">
						<WorkspaceForm />
						<ResearchProvider />
						<AgentProviders />
					</div>
				</HydrateClient>
			</PageShellContent>
		</PageShell>
	);
}
