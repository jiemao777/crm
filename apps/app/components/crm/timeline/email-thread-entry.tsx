"use client";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@crm/ui/components/accordion";
import { Button } from "@crm/ui/components/button";
import { Skeleton } from "@crm/ui/components/skeleton";
import { ThreadMessage } from "@crm/ui/components/thread-message";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useLanguage } from "@/lib/i18n";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type ThreadMessageData = RouterOutputs["google"]["thread"]["messages"][number];

export function EmailThreadEntry({
	threadId,
	messageCount,
}: {
	threadId: string;
	messageCount: number;
}) {
	const { locale, t } = useLanguage();
	const timeFormat = new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const [opened, setOpened] = useState(false);

	const thread = useQuery({
		...trpc.google.thread.queryOptions({ threadId }),
		enabled: opened,
	});

	const messages = thread.data?.messages ?? [];
	const latest = messages.at(-1);
	const earlier = latest ? messages.slice(0, -1) : [];

	const renderMessage = (message: ThreadMessageData) => (
		<ThreadMessage
			key={message.id}
			from={message.fromName ?? message.fromEmail}
			fromEmail={message.fromEmail}
			fromImageUrl={message.fromImageUrl}
			sentAt={timeFormat.format(new Date(message.sentAt))}
			direction={message.direction}
			body={message.body}
			action={
				message.gmailUrl ? (
					<a
						href={message.gmailUrl}
						target="_blank"
						rel="noreferrer"
						className="text-muted-foreground underline underline-offset-3 hover:text-foreground"
					>
						{t("timeline.openGmail")}
					</a>
				) : null
			}
		/>
	);

	return (
		<Accordion
			type="single"
			collapsible
			onValueChange={(value) => {
				if (value) setOpened(true);
			}}
		>
			<AccordionItem value={threadId}>
				<div className="flex items-center gap-1">
					<AccordionTrigger variant="subtle">
						{t("timeline.messages", { count: messageCount })}
					</AccordionTrigger>

					<Tooltip>
						<TooltipTrigger asChild>
							<Button asChild size="icon-xs" variant="ghost">
								<Link
									href={workspaceUrl(
										`/mail?thread=${encodeURIComponent(threadId)}`,
									)}
									aria-label={t("timeline.openMailbox")}
								>
									<ExternalLink />
									<span className="sr-only">{t("timeline.openMailbox")}</span>
								</Link>
							</Button>
						</TooltipTrigger>
						<TooltipContent>{t("timeline.openMailbox")}</TooltipContent>
					</Tooltip>
				</div>

				<AccordionContent>
					{thread.isPending ? (
						<div className="flex flex-col gap-2">
							<Skeleton className="h-4 w-1/3" />
							<Skeleton className="h-4 w-2/3" />
						</div>
					) : thread.isError ? (
						<p className="text-muted-foreground text-xs">
							{thread.error.message}
						</p>
					) : (
						<div className="flex flex-col">
							{latest ? renderMessage(latest) : null}

							{earlier.length > 0 ? (
								<Accordion type="single" collapsible>
									<AccordionItem value={`${threadId}-earlier`}>
										<AccordionTrigger variant="subtle">
											{t("timeline.earlierMessages", { count: earlier.length })}
										</AccordionTrigger>
										<AccordionContent>
											<div className="flex flex-col">
												{earlier.map(renderMessage)}
											</div>
										</AccordionContent>
									</AccordionItem>
								</Accordion>
							) : null}
						</div>
					)}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}
