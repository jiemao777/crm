import type { Metadata } from "next";
import { getRequestTranslation } from "@/lib/i18n-server";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { Mailbox } from "./mailbox";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("mail.title") };
}

function canonicalFolder(value: string): string {
	if (!value.trim()) return "inbox";
	const lower = value.toLowerCase();
	if (lower === "inbox" || value === "收件箱") return "inbox";
	if (lower === "sent" || value === "已发送邮件") return "sent";
	return value;
}

export default async function MailPage({
	searchParams,
}: {
	searchParams: Promise<{
		folder?: string | string[];
		q?: string | string[];
		filter?: string | string[];
		link?: string | string[];
	}>;
}) {
	await requireSession();
	const params = await searchParams;
	const firstParam = (value: string | string[] | undefined) =>
		Array.isArray(value) ? value[0] : value;
	const selectedFolder = canonicalFolder(firstParam(params.folder) ?? "inbox");
	const selectedFilter = firstParam(params.filter);
	const selectedLink = firstParam(params.link);
	const threadFolder = selectedFolder === "crm-trash" ? "all" : selectedFolder;

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await Promise.all([
		queryClient.prefetchInfiniteQuery(
			trpc.google.threads.infiniteQueryOptions(
				{
					folder: threadFolder,
					q: firstParam(params.q) || undefined,
					unreadOnly: selectedFilter === "unread" || undefined,
					starredOnly: selectedFilter === "starred" || undefined,
					state: selectedFolder === "crm-trash" ? "trash" : "active",
					link:
						selectedLink === "linked" || selectedLink === "unlinked"
							? selectedLink
							: "all",
				},
				{ getNextPageParam: (last) => last.nextCursor ?? undefined },
			),
		),
		queryClient.prefetchQuery(trpc.google.zohoStatus.queryOptions()),
		queryClient.prefetchQuery(trpc.google.status.queryOptions()),
	]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<HydrateClient>
				<Mailbox />
			</HydrateClient>
		</div>
	);
}
