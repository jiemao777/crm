"use client";

import { Button } from "@crm/ui/components/button";
import Logo from "@crm/ui/components/logo";
import { Spinner } from "@crm/ui/components/spinner";
import { cn } from "@crm/ui/lib/utils";
import { Maximize2, MessageSquare, Minimize2, X } from "lucide-react";
import { useState } from "react";
import {
	ConversationPicker,
	useConversations,
} from "@/components/crm/agent-conversations";
import { AgentThreadWithHistory } from "@/components/crm/agent-thread";
import { NEW_THREAD } from "@/lib/agent-transcript";
import { useLanguage } from "@/lib/i18n";

const DEVTOOLS_PRESENT = process.env.NODE_ENV === "development";

export function GlobalChatButton() {
	const { t } = useLanguage();
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState(false);

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className={cn(
					"fixed right-4 z-50 flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-transform hover:scale-105",
					DEVTOOLS_PRESENT ? "bottom-20" : "bottom-4",
				)}
				aria-label={open ? t("chat.close") : t("chat.open")}
			>
				{open ? <X className="size-5" /> : <MessageSquare className="size-5" />}
			</button>
			<GlobalChatPanel
				onClose={() => setOpen(false)}
				hidden={!open}
				expanded={expanded}
				onToggleExpand={() => setExpanded((value) => !value)}
			/>
		</>
	);
}

function GlobalChatPanel({
	onClose,
	hidden,
	expanded,
	onToggleExpand,
}: {
	onClose: () => void;
	hidden: boolean;
	expanded: boolean;
	onToggleExpand: () => void;
}) {
	const { t } = useLanguage();
	const suggestions = [
		t("chat.suggestion.inquiries"),
		t("chat.suggestion.customers"),
		t("chat.suggestion.mail"),
	];
	const conversations = useConversations({});
	const [selected, setSelected] = useState<string | null>(null);
	const history = conversations.data ?? [];
	const current =
		selected === NEW_THREAD
			? null
			: selected
				? (history.find((conversation) => conversation.id === selected) ?? null)
				: (history[0] ?? null);
	const openId = selected ?? current?.id ?? NEW_THREAD;

	return (
		<div
			className={cn(
				"fixed z-50 flex flex-col overflow-hidden rounded-xl border bg-background shadow-xl",
				expanded
					? "inset-0 rounded-none"
					: cn(
							"right-4 h-[480px] w-96",
							DEVTOOLS_PRESENT ? "bottom-36" : "bottom-20",
						),
				hidden && "hidden",
			)}
		>
			<div className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-2">
					<span className="flex size-6 items-center justify-center bg-foreground text-background">
						<Logo className="size-3.5" />
					</span>
					<span className="font-medium text-sm">{t("chat.title")}</span>
				</div>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={onToggleExpand}
						aria-label={expanded ? t("chat.minimize") : t("chat.expand")}
					>
						{expanded ? (
							<Minimize2 className="size-4" />
						) : (
							<Maximize2 className="size-4" />
						)}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={onClose}
						aria-label={t("chat.close")}
					>
						<X className="size-4" />
					</Button>
				</div>
			</div>

			{conversations.isPending ? (
				<div className="flex min-h-0 flex-1 items-center justify-center">
					<Spinner />
				</div>
			) : (
				<>
					<ConversationPicker
						conversations={history}
						current={current}
						onSelect={(conversation) => setSelected(conversation.id)}
						onNew={() => setSelected(NEW_THREAD)}
						busy={false}
					/>

					<AgentThreadWithHistory
						key={openId}
						conversation={current}
						copy={{
							title: t("chat.title"),
							blurb: t("chat.empty"),
							placeholder: t("chat.placeholder"),
							suggestions,
						}}
						onNewThread={() => setSelected(NEW_THREAD)}
					/>
				</>
			)}
		</div>
	);
}
