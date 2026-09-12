"use client";

import { Button } from "@crm/ui/components/button";
import { Checkbox } from "@crm/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader } from "@crm/ui/components/empty";
import { Input } from "@crm/ui/components/input";
import { Skeleton } from "@crm/ui/components/skeleton";
import { Spinner } from "@crm/ui/components/spinner";
import { ThreadMessage } from "@crm/ui/components/thread-message";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { cn } from "@crm/ui/lib/utils";
import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	Archive,
	ArrowDownLeft,
	ArrowLeft,
	ArrowUpRight,
	Circle,
	FileText,
	Forward,
	Inbox,
	Link2,
	Mail,
	MailOpen,
	Menu,
	Paperclip,
	Plus,
	RefreshCw,
	Reply,
	Search,
	Send,
	Star,
	StarOff,
	Trash2,
	Undo2,
	Unlink,
	UserRound,
	UsersRound,
	X,
} from "lucide-react";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { API_URL } from "@/lib/env";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import {
	type ComposeAddress,
	ComposeDialog,
	type ComposeDraft,
} from "./compose-dialog";
import { ManualLeadDialog, type ManualLeadPrefill } from "./manual-lead-dialog";

type MailView = "all" | "unread" | "starred";
type LinkView = "all" | "linked" | "unlinked";

const MAILBOX_POLL_INTERVAL_MS = 30_000;

function folderLabel(
	value: string,
	kind: string | undefined,
	t: (key: TranslationKey) => string,
): string {
	if (value === "all") return t("mail.allMail");
	if (value === "inbox" || value === "收件箱") return t("mail.inbox");
	if (value === "sent" || value === "已发送邮件") return t("mail.sent");
	if (value === "drafts") return t("mail.drafts");
	if (value === "crm-trash") return t("mail.recycleBin");
	if (value === "垃圾邮件") return t("mail.spam");
	if (value === "已删除邮件") return t("mail.trash");
	if (kind === "INBOX") return t("mail.inbox");
	if (kind === "SENT") return t("mail.sent");
	return value;
}

function canonicalFolder(value: string): string {
	if (!value.trim()) return "inbox";
	const lower = value.toLowerCase();
	if (lower === "inbox" || value === "收件箱") return "inbox";
	if (lower === "sent" || value === "已发送邮件") return "sent";
	return value;
}

function formatBytes(bytes: number | null): string {
	if (!bytes) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PREVIEWABLE_MIME = /^(image\/|application\/pdf$)/;

function AttachmentLink({
	attachment,
}: {
	attachment: {
		id: string;
		filename: string;
		mimeType: string | null;
		size: number | null;
	};
}) {
	const { t } = useLanguage();
	const url = `/api/mail/attachments/${encodeURIComponent(attachment.id)}`;
	const previewable =
		attachment.mimeType !== null && PREVIEWABLE_MIME.test(attachment.mimeType);

	return (
		<span className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
			<Paperclip className="size-3.5 shrink-0" />
			<a
				href={previewable ? `${url}?preview=1` : url}
				target={previewable ? "_blank" : undefined}
				download={previewable ? undefined : attachment.filename}
				rel={previewable ? "noreferrer" : undefined}
				className="max-w-56 truncate hover:text-foreground hover:underline"
				title={
					previewable
						? `${attachment.filename} (${t("mail.previewAttachment")})`
						: attachment.filename
				}
			>
				{attachment.filename}
			</a>
			{attachment.size ? (
				<span className="shrink-0 text-[10px]">
					{formatBytes(attachment.size)}
				</span>
			) : null}
			{previewable ? (
				<a
					href={url}
					download={attachment.filename}
					className="shrink-0 rounded px-1 text-[10px] hover:bg-muted hover:text-foreground"
					title={t("common.download")}
				>
					{t("mail.saveAttachment")}
				</a>
			) : null}
		</span>
	);
}

function composeFromDraft(draft: {
	id: string;
	threadId: string | null;
	inReplyTo: string | null;
	references: string | null;
	to: ComposeAddress[];
	cc: ComposeAddress[];
	bcc: ComposeAddress[];
	subject: string;
	body: string;
	attachments: {
		id: string;
		filename: string;
		mimeType: string | null;
		size: number;
	}[];
}): ComposeDraft {
	return {
		draftId: draft.id,
		threadId: draft.threadId ?? undefined,
		inReplyTo: draft.inReplyTo ?? undefined,
		references: draft.references ?? undefined,
		to: draft.to,
		cc: draft.cc,
		bcc: draft.bcc,
		subject: draft.subject,
		body: draft.body,
		attachments: draft.attachments,
	};
}

export function Mailbox() {
	const { locale, t } = useLanguage();
	const timeFormat = new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const queryClient = useQueryClient();
	const [folder, setFolder] = useQueryState(
		"folder",
		parseAsString.withDefault("inbox"),
	);
	const [search, setSearch] = useQueryState("q", parseAsString.withDefault(""));
	const [selected, setSelected] = useQueryState("thread", parseAsString);
	const [view, setView] = useQueryState(
		"filter",
		parseAsString.withDefault("all"),
	);
	const [link, setLink] = useQueryState(
		"link",
		parseAsString.withDefault("all"),
	);
	const [category, setCategory] = useQueryState(
		"category",
		parseAsString.withDefault("all"),
	);
	const [selection, setSelection] = useState<string[]>([]);
	const [composeOpen, setComposeOpen] = useState(false);
	const [composeDraft, setComposeDraft] = useState<ComposeDraft | null>(null);
	const [manualLead, setManualLead] = useState<ManualLeadPrefill | null>(null);

	const normalizedFolder = canonicalFolder(folder);
	const normalizedView: MailView =
		view === "unread" || view === "starred" ? view : "all";
	const normalizedLink: LinkView =
		link === "linked" || link === "unlinked" ? link : "all";
	const crmTrash = normalizedFolder === "crm-trash";

	const list = useInfiniteQuery(
		trpc.google.threads.infiniteQueryOptions(
			{
				folder: crmTrash ? "all" : normalizedFolder,
				q: search.trim() || undefined,
				unreadOnly: normalizedView === "unread" || undefined,
				starredOnly: normalizedView === "starred" || undefined,
				state: crmTrash ? "trash" : "active",
				link: normalizedLink,
				category:
					category !== "all"
						? (category as "INQUIRY" | "PROMOTION" | "NOTIFICATION" | "OTHER")
						: undefined,
			},
			{
				getNextPageParam: (last) => last.nextCursor ?? undefined,
				refetchInterval: MAILBOX_POLL_INTERVAL_MS,
			},
		),
	);

	const counts = useQuery({
		...trpc.google.mailCounts.queryOptions(),
		refetchInterval: MAILBOX_POLL_INTERVAL_MS,
	});
	const drafts = useQuery(trpc.google.drafts.queryOptions());
	const connection = useQuery({
		...trpc.google.zohoStatus.queryOptions(),
		select: (status) => ({
			connected: status.connected,
			canSend: status.canSend,
			email: status.email,
			folders: status.folders,
		}),
	});
	const google = useQuery({
		...trpc.google.status.queryOptions(),
		select: (status) => ({
			connected: status.sources.some(
				(source) => source.source === "gmail" && source.connected,
			),
		}),
	});
	const thread = useQuery({
		...trpc.google.thread.queryOptions({ threadId: selected ?? "" }),
		enabled: Boolean(selected),
		refetchInterval: selected ? MAILBOX_POLL_INTERVAL_MS : false,
	});

	function invalidateMail() {
		return Promise.all([
			queryClient.invalidateQueries({
				queryKey: trpc.google.threads.pathKey(),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.google.mailCounts.pathKey(),
			}),
			queryClient.invalidateQueries({ queryKey: trpc.google.thread.pathKey() }),
		]);
	}

	const refresh = useMutation(
		trpc.google.refreshMail.mutationOptions({
			onSuccess: () => {
				toast.success(t("mail.refreshed"));
				void invalidateMail();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const markRead = useMutation(
		trpc.google.markThreadRead.mutationOptions({
			onSuccess: () => void invalidateMail(),
			onError: (error) => toast.error(error.message),
		}),
	);
	const toggleStar = useMutation(
		trpc.google.toggleThreadStar.mutationOptions({
			onSuccess: () => void invalidateMail(),
			onError: (error) => toast.error(error.message),
		}),
	);
	const trash = useMutation(
		trpc.google.trashThread.mutationOptions({
			onSuccess: () => {
				void setSelected(null);
				void invalidateMail();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const restore = useMutation(
		trpc.google.restoreThread.mutationOptions({
			onSuccess: () => void invalidateMail(),
			onError: (error) => toast.error(error.message),
		}),
	);
	const bulk = useMutation(
		trpc.google.bulkThreadState.mutationOptions({
			onSuccess: (result) => {
				setSelection([]);
				toast.success(t("mail.updated", { count: result.updated }));
				void invalidateMail();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const createCustomer = useMutation(
		trpc.google.createCustomerFromThread.mutationOptions({
			onSuccess: (result) => {
				if (result.status === "created") {
					toast.success(t("mail.customerCreated"));
				} else if (result.status === "matched") {
					toast.success(t("mail.customerMatched"));
				} else if (result.status === "already-linked") {
					toast.info(t("mail.alreadyLinked"));
				} else {
					openManualLead(
						result.status === "unavailable" ? "unavailable" : "unidentified",
					);
				}
				void invalidateMail();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const relink = useMutation(
		trpc.google.relinkUnmatched.mutationOptions({
			onSuccess: (result) => {
				toast.success(t("mail.relinked", { count: result.relinked }));
				void invalidateMail();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const threads = list.data?.pages.flatMap((page) => page.threads) ?? [];
	const selectedThread = threads.find((entry) => entry.id === selected) ?? null;
	const anyConnected = connection.data?.connected || google.data?.connected;
	const canSend = connection.data?.canSend ?? false;
	const countByPath = new Map(
		(counts.data ?? []).map((item) => [item.path, item]),
	);
	const inboxCount = counts.data?.find((item) => item.kind === "INBOX")?.unread;
	const sentCount = counts.data?.find((item) => item.kind === "SENT")?.unread;
	const folderItems = [
		{
			value: "all",
			label: t("mail.allMail"),
			icon: Mail,
			count: countByPath.get("all")?.unread,
		},
		{ value: "inbox", label: t("mail.inbox"), icon: Inbox, count: inboxCount },
		{ value: "sent", label: t("mail.sent"), icon: Send, count: sentCount },
		...(connection.data?.folders ?? [])
			.filter((item) => item.kind === "OTHER")
			.map((item) => ({
				value: item.path,
				label: folderLabel(item.path, item.kind, t),
				icon: Archive,
				count: countByPath.get(item.path)?.unread,
			})),
		{
			value: "drafts",
			label: t("mail.drafts"),
			icon: FileText,
			count: drafts.data?.length,
		},
		{
			value: "crm-trash",
			label: t("mail.recycleBin"),
			icon: Trash2,
			count: countByPath.get("crm-trash")?.unread,
		},
	];

	function openCompose(initial: ComposeDraft | null) {
		setComposeDraft(initial);
		setComposeOpen(true);
	}

	function openManualLead(reason: ManualLeadPrefill["reason"]) {
		if (!selected || !thread.data) return;
		const inbound = thread.data.messages.find(
			(message) => message.direction === "INBOUND",
		);
		const nameParts = (inbound?.fromName ?? "")
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		setManualLead({
			threadId: selected,
			reason,
			email: inbound?.fromEmail ?? "",
			firstName: nameParts[0] ?? "",
			lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : "",
		});
	}

	function openFolder(next: string) {
		void setFolder(next);
		void setSelected(null);
		setSelection([]);
	}

	function openThread(id: string, unread: boolean) {
		void setSelected(id);
		if (unread) markRead.mutate({ threadId: id, read: true });
	}

	function toggleSelection(id: string, checked: boolean) {
		setSelection((current) =>
			checked
				? [...new Set([...current, id])]
				: current.filter((value) => value !== id),
		);
	}

	function selectAll() {
		setSelection(
			selection.length === threads.length
				? []
				: threads.map((entry) => entry.id),
		);
	}

	function replyToThread(mode: "reply" | "reply-all" | "forward") {
		const messages = thread.data?.messages ?? [];
		const last = messages[0];
		if (!last || !thread.data) return;
		if (mode === "forward") {
			const subject = thread.data.subject?.replace(/^(Fwd:\s*)+/i, "") ?? "";
			openCompose({
				threadId: thread.data.id,
				to: [],
				cc: [],
				bcc: [],
				subject: subject ? `Fwd: ${subject}` : "",
				body: `\n\n---------- Forwarded message ----------\nFrom: ${last.fromName ?? last.fromEmail} <${last.fromEmail}>\nDate: ${timeFormat.format(new Date(last.sentAt))}\nSubject: ${thread.data.subject ?? ""}\n\n${last.body ?? ""}`,
				buyerTimezone: thread.data.company?.timezone ?? null,
			});
			return;
		}
		const replyAll = mode === "reply-all";
		const ownEmail = connection.data?.email?.toLowerCase() ?? null;
		const sender = {
			email: last.fromEmail.toLowerCase(),
			name: last.fromName,
		};
		const seen = new Set<string>();
		const recipients = (last.recipients ?? [])
			.filter((entry) => entry.kind === "to" || entry.kind === "cc")
			.map((entry) => ({
				email: entry.email.toLowerCase(),
				name: entry.name,
			}))
			.filter((entry) => {
				if (ownEmail && entry.email === ownEmail) return false;
				if (seen.has(entry.email)) return false;
				seen.add(entry.email);
				return true;
			});
		const to = last.direction === "INBOUND" ? [sender] : recipients.slice(0, 1);
		const cc = replyAll
			? last.direction === "INBOUND"
				? recipients.filter((entry) => entry.email !== sender.email)
				: recipients.slice(1)
			: [];
		const subject = thread.data.subject ?? "";
		const references = messages
			.map((message) => message.rfcMessageId)
			.filter((messageId): messageId is string => Boolean(messageId))
			.map((messageId) => `<${messageId.replace(/[<>]/g, "")}>`)
			.join(" ");
		openCompose({
			threadId: thread.data.id,
			to,
			cc,
			bcc: [],
			subject: /^re:/i.test(subject)
				? subject
				: subject
					? `Re: ${subject}`
					: "",
			body: `\n\nOn ${timeFormat.format(new Date(last.sentAt))} ${last.fromEmail} wrote:\n${last.body ?? ""}`,
			buyerTimezone: thread.data.company?.timezone ?? null,
			...(last.rfcMessageId
				? {
						inReplyTo: `<${last.rfcMessageId.replace(/[<>]/g, "")}>`,
						references,
					}
				: {}),
		});
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			{!anyConnected ? (
				<div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
					<Empty>
						<EmptyHeader>
							<p className="font-medium text-sm">{t("mail.noMailbox")}</p>
							<EmptyDescription>
								{t("mail.noMailboxDescription")}
								<Link
									className="ml-1 underline underline-offset-4"
									href={workspaceUrl("/settings/connections")}
								>
									{t("mail.openConnections")}
								</Link>
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				</div>
			) : (
				<div className="grid min-h-0 flex-1 grid-cols-[12rem_minmax(18rem,23rem)_minmax(0,1fr)] max-lg:grid-cols-1">
					<aside className="hidden min-h-0 flex-col gap-2 overflow-y-auto border-r p-2 lg:flex">
						{canSend ? (
							<Button
								className="w-full justify-center"
								onClick={() => openCompose(null)}
							>
								<Plus data-icon="inline-start" /> {t("mail.compose")}
							</Button>
						) : (
							<Button
								asChild
								variant="outline"
								className="w-full justify-center"
							>
								<Link href={workspaceUrl("/settings/connections")}>
									{t("mail.connectZoho")}
								</Link>
							</Button>
						)}
						<div className="flex flex-col gap-0.5">
							{folderItems.map((item) => {
								const active = normalizedFolder === item.value;
								return (
									<button
										key={item.value}
										type="button"
										onClick={() => openFolder(item.value)}
										className={cn(
											"flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
											active
												? "bg-muted font-medium text-foreground"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
										)}
									>
										<item.icon className="size-3.5 shrink-0" />
										<span className="min-w-0 flex-1 truncate">
											{item.label}
										</span>
										{item.count ? (
											<span className="tabular-nums text-[10px]">
												{item.count}
											</span>
										) : null}
									</button>
								);
							})}
						</div>
						<div className="mt-auto flex flex-col gap-1 border-t pt-2 text-[10px] text-muted-foreground">
							<span>{t("mail.localStateNote")}</span>
							<span>{t("mail.providerStateNote")}</span>
						</div>
					</aside>

					<section
						className={cn(
							"flex min-h-0 min-w-0 flex-col border-r",
							selected ? "hidden lg:flex" : "flex",
						)}
					>
						<div className="flex shrink-0 flex-col gap-2 border-b p-2">
							<div className="flex items-center gap-1.5">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											className="lg:hidden"
											size="icon-sm"
											variant="ghost"
											aria-label={t("mail.folders")}
											title={t("mail.folders")}
										>
											<Menu />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start">
										{folderItems.map((item) => (
											<DropdownMenuItem
												key={item.value}
												onSelect={() => openFolder(item.value)}
											>
												<item.icon />
												{item.label}
												{item.count ? (
													<span className="ml-auto tabular-nums text-muted-foreground">
														{item.count}
													</span>
												) : null}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
								<div className="relative min-w-0 flex-1">
									<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
									<Input
										value={search}
										onChange={(event) => void setSearch(event.target.value)}
										placeholder={t("mail.search")}
										className="pl-8"
									/>
								</div>
								<Button
									size="icon-sm"
									variant="ghost"
									onClick={() => refresh.mutate()}
									disabled={refresh.isPending}
									aria-label={t("mail.refresh")}
									title={t("mail.refresh")}
								>
									<RefreshCw
										className={cn(refresh.isPending && "animate-spin")}
									/>
								</Button>
							</div>
							<div className="flex items-center justify-between gap-2">
								<ToggleGroup
									type="single"
									value={normalizedView}
									onValueChange={(next) => next && void setView(next)}
									size="sm"
									spacing={0}
								>
									<ToggleGroupItem value="all">{t("mail.all")}</ToggleGroupItem>
									<ToggleGroupItem value="unread">
										{t("mail.unread")}
									</ToggleGroupItem>
									<ToggleGroupItem value="starred">
										<Star className="size-3" /> {t("mail.starred")}
									</ToggleGroupItem>
								</ToggleGroup>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => relink.mutate()}
									disabled={relink.isPending}
									title={t("mail.linkToCustomers")}
								>
									<Link2 data-icon="inline-start" />
									{relink.isPending
										? t("common.loading")
										: t("mail.linkToCustomers")}
								</Button>
							</div>
							<ToggleGroup
								type="single"
								value={normalizedLink}
								onValueChange={(next) => next && void setLink(next)}
								size="sm"
								spacing={0}
							>
								<ToggleGroupItem value="all">
									{t("mail.allConversations")}
								</ToggleGroupItem>
								<ToggleGroupItem value="linked">
									<Link2 className="size-3" /> {t("mail.linked")}
								</ToggleGroupItem>
								<ToggleGroupItem value="unlinked">
									<Unlink className="size-3" /> {t("mail.unlinked")}
								</ToggleGroupItem>
							</ToggleGroup>
							<ToggleGroup
								type="single"
								value={category}
								onValueChange={(next) => next && void setCategory(next)}
								size="sm"
								spacing={0}
							>
								<ToggleGroupItem value="all">
									{t("mail.allTypes")}
								</ToggleGroupItem>
								<ToggleGroupItem value="INQUIRY">
									{t("mail.inquiries")}
								</ToggleGroupItem>
								<ToggleGroupItem value="PROMOTION">
									{t("mail.promotions")}
								</ToggleGroupItem>
								<ToggleGroupItem value="NOTIFICATION">
									{t("mail.notifications")}
								</ToggleGroupItem>
								<ToggleGroupItem value="OTHER">
									{t("mail.other")}
								</ToggleGroupItem>
							</ToggleGroup>
						</div>
						{selection.length > 0 ? (
							<div className="flex shrink-0 items-center gap-1 border-b bg-muted/40 px-2 py-1.5">
								<span className="mr-auto text-xs text-muted-foreground">
									{t("mail.selected", { count: selection.length })}
								</span>
								<Button
									size="icon-sm"
									variant="ghost"
									onClick={() =>
										bulk.mutate({ threadIds: selection, action: "read" })
									}
									title={t("mail.markRead")}
									aria-label={t("mail.markRead")}
								>
									<MailOpen />
								</Button>
								<Button
									size="icon-sm"
									variant="ghost"
									onClick={() =>
										bulk.mutate({ threadIds: selection, action: "unread" })
									}
									title={t("mail.markUnread")}
									aria-label={t("mail.markUnread")}
								>
									<Mail />
								</Button>
								<Button
									size="icon-sm"
									variant="ghost"
									onClick={() =>
										bulk.mutate({ threadIds: selection, action: "star" })
									}
									title={t("mail.star")}
									aria-label={t("mail.star")}
								>
									<Star />
								</Button>
								<Button
									size="icon-sm"
									variant="ghost"
									onClick={() =>
										bulk.mutate({
											threadIds: selection,
											action: crmTrash ? "restore" : "trash",
										})
									}
									title={
										crmTrash ? t("mail.restore") : t("mail.moveToRecycleBin")
									}
									aria-label={
										crmTrash ? t("mail.restore") : t("mail.moveToRecycleBin")
									}
								>
									{crmTrash ? <Undo2 /> : <Trash2 />}
								</Button>
								<Button
									size="icon-sm"
									variant="ghost"
									onClick={() => setSelection([])}
									title={t("mail.clearSelection")}
									aria-label={t("mail.clearSelection")}
								>
									<X />
								</Button>
							</div>
						) : null}
						<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
							{normalizedFolder === "drafts" ? (
								<div className="flex flex-col">
									<div className="flex items-center gap-2 border-b px-3 py-1.5 text-[10px] text-muted-foreground">
										<FileText className="size-3" /> {t("mail.drafts")}
									</div>
									{(drafts.data ?? []).length === 0 ? (
										<Empty className="rounded-none border-0 py-16">
											<EmptyHeader>
												<p className="font-medium text-sm">
													{t("mail.noDrafts")}
												</p>
												<EmptyDescription>
													{t("mail.noDraftsDescription")}
												</EmptyDescription>
											</EmptyHeader>
										</Empty>
									) : (
										(drafts.data ?? []).map((draft) => (
											<button
												key={draft.id}
												type="button"
												onClick={() => openCompose(composeFromDraft(draft))}
												className="flex min-w-0 flex-col gap-1 border-b px-3 py-3 text-left hover:bg-muted/50"
											>
												<div className="flex items-center justify-between gap-2">
													<span className="truncate text-xs font-medium">
														{draft.subject || t("mail.noSubject")}
													</span>
													<span className="shrink-0 text-[10px] text-muted-foreground">
														{timeFormat.format(new Date(draft.updatedAt))}
													</span>
												</div>
												<span className="truncate text-[10px] text-muted-foreground">
													{draft.to.length
														? draft.to
																.map((entry) => entry.name || entry.email)
																.join(", ")
														: t("mail.noRecipient")}
												</span>
												<span className="truncate text-[10px] text-muted-foreground">
													{draft.body || t("mail.emptyMessage")}
												</span>
											</button>
										))
									)}
								</div>
							) : list.isPending ? (
								<div className="flex flex-col gap-2 p-3">
									<Skeleton className="h-16 w-full" />
									<Skeleton className="h-16 w-full" />
									<Skeleton className="h-16 w-full" />
								</div>
							) : threads.length === 0 ? (
								<Empty className="rounded-none border-0 py-16">
									<EmptyHeader>
										<p className="font-medium text-sm">
											{t("mail.noConversations")}
										</p>
										<EmptyDescription>
											{t("mail.noConversationsDescription")}
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							) : (
								<div className="flex flex-col">
									<div className="flex items-center gap-2 border-b px-3 py-1.5 text-[10px] text-muted-foreground">
										<Checkbox
											checked={
												selection.length === threads.length &&
												threads.length > 0
											}
											onCheckedChange={() => selectAll()}
											aria-label={t("mail.selectAll")}
										/>
										<span>{folderLabel(normalizedFolder, undefined, t)}</span>
									</div>
									{threads.map((entry) => {
										const latest = entry.latest;
										const checked = selection.includes(entry.id);
										const active = selected === entry.id;
										return (
											<div
												key={entry.id}
												className={cn(
													"flex min-w-0 gap-2 border-b px-2.5 py-2",
													active ? "bg-muted" : "hover:bg-muted/50",
													entry.unread && "bg-primary/5",
												)}
											>
												<div className="pt-1">
													<Checkbox
														checked={checked}
														onCheckedChange={(value) =>
															toggleSelection(entry.id, value === true)
														}
														aria-label={t("mail.selectNamed", {
															name: entry.subject ?? t("mail.conversation"),
														})}
													/>
												</div>
												<button
													type="button"
													onClick={() => openThread(entry.id, entry.unread)}
													className="flex min-w-0 flex-1 flex-col gap-1 text-left"
												>
													<div className="flex min-w-0 items-center gap-2">
														<span
															className={cn(
																"min-w-0 flex-1 truncate text-xs",
																entry.unread
																	? "font-semibold text-foreground"
																	: "text-muted-foreground",
															)}
														>
															{latest?.fromName ??
																latest?.fromEmail ??
																t("mail.unknownSender")}
														</span>
														<span className="shrink-0 text-[10px] text-muted-foreground">
															{timeFormat.format(new Date(entry.lastMessageAt))}
														</span>
													</div>
													<div className="flex min-w-0 items-center gap-1.5">
														{entry.unread ? (
															<Circle className="size-1.5 shrink-0 fill-primary text-primary" />
														) : null}
														<span
															className={cn(
																"min-w-0 flex-1 truncate text-xs",
																entry.unread
																	? "font-medium"
																	: "text-foreground/80",
															)}
														>
															{entry.subject || t("mail.noSubject")}
														</span>
														{entry.starred ? (
															<Star className="size-3 shrink-0 fill-amber-400 text-amber-500" />
														) : null}
													</div>
													<div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
														{latest?.direction === "OUTBOUND" ? (
															<ArrowUpRight className="size-3 shrink-0" />
														) : (
															<ArrowDownLeft className="size-3 shrink-0" />
														)}
														<span className="min-w-0 flex-1 truncate">
															{latest?.snippet ||
																t("mail.messages", {
																	count: entry.messageCount,
																})}
														</span>
														{entry.linked ? (
															<Link2 className="size-3 shrink-0 text-primary" />
														) : (
															<Unlink className="size-3 shrink-0 opacity-50" />
														)}
													</div>
												</button>
												<Button
													size="icon-xs"
													variant="ghost"
													onClick={() =>
														toggleStar.mutate({ threadId: entry.id })
													}
													title={
														entry.starred ? t("mail.unstar") : t("mail.star")
													}
													aria-label={
														entry.starred ? t("mail.unstar") : t("mail.star")
													}
												>
													{entry.starred ? (
														<Star className="fill-amber-400 text-amber-500" />
													) : (
														<StarOff />
													)}
												</Button>
											</div>
										);
									})}
									{list.hasNextPage ? (
										<Button
											variant="ghost"
											size="sm"
											className="m-2"
											onClick={() => void list.fetchNextPage()}
											disabled={list.isFetchingNextPage}
										>
											{list.isFetchingNextPage ? <Spinner /> : null}{" "}
											{t("mail.loadMore")}
										</Button>
									) : null}
								</div>
							)}
						</div>
					</section>

					<section
						className={cn(
							"min-h-0 min-w-0 flex-col overflow-y-auto",
							selected ? "flex" : "hidden lg:flex",
						)}
					>
						{!selected ? (
							<div className="flex h-full items-center justify-center p-6">
								<Empty className="border-0">
									<EmptyHeader>
										<p className="font-medium text-sm">
											{t("mail.selectConversation")}
										</p>
										<EmptyDescription>
											{t("mail.selectConversationDescription")}
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							</div>
						) : thread.isPending ? (
							<div className="flex min-h-0 flex-1 items-center justify-center">
								<Spinner />
							</div>
						) : thread.isError ? (
							<div className="p-5 text-xs text-destructive">
								{thread.error.message}
							</div>
						) : thread.data ? (
							<div className="flex min-h-full flex-col">
								<header className="sticky top-0 z-10 flex shrink-0 items-start gap-3 border-b bg-background px-4 py-3">
									<Button
										size="icon-sm"
										variant="ghost"
										className="lg:hidden"
										onClick={() => void setSelected(null)}
										aria-label={t("mail.backToConversations")}
										title={t("common.back")}
									>
										<ArrowLeft />
									</Button>
									<div className="min-w-0 flex-1">
										<h2 className="truncate text-sm font-semibold">
											{thread.data.subject || t("mail.noSubject")}
										</h2>
										<p className="mt-1 text-[10px] text-muted-foreground">
											{t("mail.messages", { count: thread.data.messageCount })}{" "}
											· {timeFormat.format(new Date(thread.data.lastMessageAt))}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-0.5">
										<Button
											size="icon-sm"
											variant="ghost"
											onClick={() =>
												selected && toggleStar.mutate({ threadId: selected })
											}
											title={
												selectedThread?.starred
													? t("mail.unstar")
													: t("mail.star")
											}
											aria-label={
												selectedThread?.starred
													? t("mail.unstar")
													: t("mail.star")
											}
										>
											{selectedThread?.starred ? (
												<Star className="fill-amber-400 text-amber-500" />
											) : (
												<StarOff />
											)}
										</Button>
										<Button
											size="icon-sm"
											variant="ghost"
											onClick={() =>
												selected &&
												markRead.mutate({
													threadId: selected,
													read: Boolean(selectedThread?.unread),
												})
											}
											title={
												selectedThread?.unread
													? t("mail.markRead")
													: t("mail.markUnread")
											}
											aria-label={
												selectedThread?.unread
													? t("mail.markRead")
													: t("mail.markUnread")
											}
										>
											{selectedThread?.unread ? <MailOpen /> : <Mail />}
										</Button>
										<Button
											size="icon-sm"
											variant="ghost"
											onClick={() =>
												selected &&
												(crmTrash
													? restore.mutate({ threadId: selected })
													: trash.mutate({ threadId: selected }))
											}
											title={
												crmTrash
													? t("mail.restore")
													: t("mail.moveToRecycleBin")
											}
											aria-label={
												crmTrash
													? t("mail.restore")
													: t("mail.moveToRecycleBin")
											}
										>
											{crmTrash ? <Undo2 /> : <Trash2 />}
										</Button>
									</div>
								</header>
								<div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
									{thread.data.company ? (
										<Link
											className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
											href={workspaceUrl(
												`/companies/${thread.data.company.id}`,
											)}
										>
											<UsersRound className="size-3.5" />
											{thread.data.company.name}
										</Link>
									) : null}
									{thread.data.contact ? (
										<Link
											className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
											href={workspaceUrl(`/contacts/${thread.data.contact.id}`)}
										>
											<UserRound className="size-3.5" />
											{thread.data.contact.firstName}{" "}
											{thread.data.contact.lastName}
										</Link>
									) : null}
									{!thread.data.company && !thread.data.contact ? (
										<>
											<Button
												size="sm"
												variant="outline"
												onClick={() =>
													selected &&
													createCustomer.mutate({ threadId: selected })
												}
												disabled={createCustomer.isPending}
											>
												<Plus data-icon="inline-start" />
												{createCustomer.isPending
													? t("common.creating")
													: t("mail.createCustomer")}
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onClick={() => openManualLead("unidentified")}
											>
												{t("mail.manualCreate")}
											</Button>
										</>
									) : null}
									{crmTrash ? (
										<span className="text-[10px] text-muted-foreground">
											{t("mail.recycleNote")}
										</span>
									) : null}
								</div>
								<div className="flex flex-wrap items-center gap-1 border-b px-4 py-2">
									{canSend ? (
										<>
											<Button
												size="sm"
												variant="outline"
												onClick={() => replyToThread("reply")}
											>
												<Reply data-icon="inline-start" /> {t("mail.reply")}
											</Button>
											<Button
												size="sm"
												variant="outline"
												onClick={() => replyToThread("reply-all")}
											>
												<UsersRound data-icon="inline-start" />{" "}
												{t("mail.replyAll")}
											</Button>
											<Button
												size="sm"
												variant="outline"
												onClick={() => replyToThread("forward")}
											>
												<Forward data-icon="inline-start" /> {t("mail.forward")}
											</Button>
										</>
									) : null}
								</div>
								<div className="flex flex-col gap-4 px-4 py-3">
									{thread.data.messages.map((message) => (
										<div key={message.id} className="flex flex-col gap-1.5">
											<ThreadMessage
												from={message.fromName ?? message.fromEmail}
												fromEmail={message.fromEmail}
												fromImageUrl={message.fromImageUrl}
												sentAt={timeFormat.format(new Date(message.sentAt))}
												direction={message.direction}
												body={message.body}
												html={message.bodyHtml}
												attachments={message.attachments}
												attachmentBaseUrl={API_URL}
											/>
											{message.attachments?.length ? (
												<div className="flex flex-wrap gap-2 pl-3">
													{message.attachments.map((attachment) => (
														<AttachmentLink
															key={attachment.id}
															attachment={attachment}
														/>
													))}
												</div>
											) : null}
										</div>
									))}
								</div>
							</div>
						) : null}
					</section>
				</div>
			)}

			{composeOpen && canSend ? (
				<ComposeDialog
					key={composeDraft?.draftId ?? composeDraft?.threadId ?? "new"}
					initial={composeDraft}
					onOpenChange={(open) => {
						setComposeOpen(open);
						if (!open) setComposeDraft(null);
					}}
					onSent={() => {
						void invalidateMail();
						void drafts.refetch();
					}}
				/>
			) : null}

			{manualLead ? (
				<ManualLeadDialog
					key={manualLead.threadId}
					prefill={manualLead}
					onClose={() => setManualLead(null)}
					onCreated={() => void invalidateMail()}
				/>
			) : null}
		</div>
	);
}
