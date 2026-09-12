"use client";

import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMountEffect } from "@crm/ui/hooks/use-mount-effect";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ChevronDown,
	FileUp,
	Paperclip,
	Send,
	Signature,
	Trash2,
	X,
} from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { buyerLocalTime, isBuyerWorkingHours } from "@/lib/timezones";
import { useTRPC } from "@/lib/trpc/client";

export type ComposeAddress = { email: string; name: string | null };

export type ComposeDraft = {
	draftId?: string;
	threadId?: string;
	inReplyTo?: string;
	references?: string;
	to: ComposeAddress[];
	cc?: ComposeAddress[];
	bcc?: ComposeAddress[];
	subject: string;
	body: string;
	buyerTimezone?: string | null;
	attachments?: {
		id: string;
		filename: string;
		mimeType: string | null;
		size: number;
	}[];
};

type ComposeForm = {
	threadId: string | null;
	inReplyTo: string | null;
	references: string | null;
	to: ComposeAddress[];
	cc: ComposeAddress[];
	bcc: ComposeAddress[];
	subject: string;
	body: string;
};

type RecipientField = "to" | "cc" | "bcc";
type SavedDraft = { id: string };

const templates = [
	{
		labelKey: "mail.template.inquiry" as TranslationKey,
		subject: "Thank you for your inquiry",
		body: "Hello,\n\nThank you for your inquiry. Please let us know the quantities, destination and any product requirements so we can prepare the right offer.\n\nBest regards,",
	},
	{
		labelKey: "mail.template.quotation" as TranslationKey,
		subject: "Following up on the quotation",
		body: "Hello,\n\nI am following up on the quotation we sent. Please let me know if you would like to review pricing, lead time or shipping options.\n\nBest regards,",
	},
	{
		labelKey: "mail.template.sample" as TranslationKey,
		subject: "Sample confirmation",
		body: "Hello,\n\nWe are ready to arrange the sample. Please confirm the delivery address, contact name and telephone number.\n\nBest regards,",
	},
];

function toForm(initial: ComposeDraft | null): ComposeForm {
	return {
		threadId: initial?.threadId ?? null,
		inReplyTo: initial?.inReplyTo ?? null,
		references: initial?.references ?? null,
		to: initial?.to ?? [],
		cc: initial?.cc ?? [],
		bcc: initial?.bcc ?? [],
		subject: initial?.subject ?? "",
		body: initial?.body ?? "",
	};
}

function parseAddresses(value: string): ComposeAddress[] {
	const entries = value
		.split(/[;,\n]/)
		.map((entry) => entry.trim())
		.filter(Boolean);
	const result: ComposeAddress[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		const angled = entry.match(/^(.*)<([^<>]+)>$/);
		const email = (angled?.[2] ?? entry).trim().toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) continue;
		seen.add(email);
		const name = angled?.[1]?.trim().replace(/^"(.*)"$/, "$1") || null;
		result.push({ email, name });
	}
	return result;
}

function mergeAddresses(
	current: ComposeAddress[],
	incoming: ComposeAddress[],
): ComposeAddress[] {
	const seen = new Set(current.map((entry) => entry.email.toLowerCase()));
	return [
		...current,
		...incoming.filter((entry) => !seen.has(entry.email.toLowerCase())),
	];
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}

export function ComposeDialog({
	onOpenChange,
	initial,
	onSent,
}: {
	onOpenChange: (open: boolean) => void;
	initial: ComposeDraft | null;
	onSent: () => void;
}) {
	const { locale, t } = useLanguage();
	const trpc = useTRPC();
	const buyerTimezone = initial?.buyerTimezone ?? null;
	const workingHours =
		buyerTimezone === null ? null : isBuyerWorkingHours(buyerTimezone);
	const attachmentInputId = useId();
	const [form, setForm] = useState<ComposeForm>(() => toForm(initial));
	const formRef = useRef(form);
	const [draftId, setDraftId] = useState<string | null>(
		initial?.draftId ?? null,
	);
	const draftIdRef = useRef(draftId);
	const [attachments, setAttachments] = useState(initial?.attachments ?? []);
	const [showCc, setShowCc] = useState(Boolean(initial?.cc?.length));
	const [showBcc, setShowBcc] = useState(Boolean(initial?.bcc?.length));
	const [discarding, setDiscarding] = useState(false);
	const [activeField, setActiveField] = useState<RecipientField | null>(null);
	const [recipientInput, setRecipientInput] = useState<
		Record<RecipientField, string>
	>({ to: "", cc: "", bcc: "" });
	const saveTimer = useRef<number | null>(null);
	const discardingRef = useRef(false);
	const saveChain = useRef<Promise<SavedDraft | undefined>>(
		Promise.resolve(undefined),
	);

	const save = useMutation(
		trpc.google.saveDraft.mutationOptions({
			onError: (error) => toast.error(error.message),
		}),
	);
	const addAttachment = useMutation(
		trpc.google.addDraftAttachment.mutationOptions({
			onError: (error) => toast.error(error.message),
		}),
	);
	const removeAttachment = useMutation(
		trpc.google.removeDraftAttachment.mutationOptions({
			onError: (error) => toast.error(error.message),
		}),
	);
	const deleteDraft = useMutation(
		trpc.google.deleteDraft.mutationOptions({
			onError: (error) => toast.error(error.message),
		}),
	);
	const send = useMutation(
		trpc.google.sendDraft.mutationOptions({
			onError: (error) => toast.error(error.message),
		}),
	);
	const mailbox = useQuery({
		...trpc.google.zohoStatus.queryOptions(),
		select: (status) => status.email,
	});
	const suggestionQuery = recipientInput[activeField ?? "to"];
	const suggestions = useQuery({
		...trpc.google.recipientSuggestions.queryOptions({
			q: suggestionQuery,
			limit: 8,
		}),
		enabled: activeField !== null && suggestionQuery.trim().length >= 2,
	});

	async function saveNow(next = formRef.current) {
		const saved = await save.mutateAsync({
			...(draftIdRef.current ? { draftId: draftIdRef.current } : {}),
			threadId: next.threadId,
			inReplyTo: next.inReplyTo,
			references: next.references,
			to: next.to,
			cc: next.cc,
			bcc: next.bcc,
			subject: next.subject,
			body: next.body,
		});
		draftIdRef.current = saved.id;
		setDraftId(saved.id);
		return saved;
	}

	function queueSave(next: ComposeForm, delay = 450) {
		if (discardingRef.current) return;
		if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(() => {
			saveChain.current = saveChain.current
				.catch(() => undefined)
				.then(() => saveNow(next));
		}, delay);
	}

	function updateForm(patch: Partial<ComposeForm>) {
		const next = { ...formRef.current, ...patch };
		formRef.current = next;
		setForm(next);
		queueSave(next);
	}

	function flushSave() {
		if (saveTimer.current !== null) {
			window.clearTimeout(saveTimer.current);
			saveTimer.current = null;
		}
		saveChain.current = saveChain.current
			.catch(() => undefined)
			.then(() => saveNow());
		return saveChain.current as Promise<SavedDraft>;
	}

	useMountEffect(() => {
		queueSave(formRef.current, 120);
		return () => {
			if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
		};
	});

	function addRecipients(field: RecipientField, raw: string) {
		const parsed = parseAddresses(raw);
		if (raw.trim() && parsed.length === 0) {
			toast.error(t("mail.invalidAddress"));
			return;
		}
		if (parsed.length > 0)
			updateForm({ [field]: mergeAddresses(formRef.current[field], parsed) });
		setRecipientInput((current) => ({ ...current, [field]: "" }));
	}

	async function uploadFiles(files: FileList | null) {
		if (!files?.length) return;
		try {
			const draft = await flushSave();
			for (const file of Array.from(files)) {
				const attachment = await addAttachment.mutateAsync({
					draftId: draft.id,
					filename: file.name,
					mimeType: file.type || null,
					contentBase64: await fileToBase64(file),
				});
				setAttachments((current) => [...current, attachment]);
			}
		} catch {}
	}

	function applyTemplate(template: (typeof templates)[number]) {
		const current = formRef.current;
		updateForm({
			subject: current.subject || template.subject,
			body: current.body
				? `${current.body.trimEnd()}\n\n${template.body}`
				: template.body,
		});
	}

	function appendSignature() {
		const email = mailbox.data;
		if (!email) return;
		const signature = `--\n${email}`;
		if (!formRef.current.body.includes(signature)) {
			updateForm({
				body: `${formRef.current.body.trimEnd()}\n\n${signature}`.trimStart(),
			});
		}
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		try {
			const draft = await flushSave();
			await send.mutateAsync({ draftId: draft.id });
			toast.success(t("mail.sentSuccess"));
			onSent();
			onOpenChange(false);
		} catch {}
	}

	async function discard() {
		if (discardingRef.current) return;
		discardingRef.current = true;
		setDiscarding(true);
		if (saveTimer.current !== null) {
			window.clearTimeout(saveTimer.current);
			saveTimer.current = null;
		}
		try {
			await saveChain.current.catch(() => undefined);
			const id = draftIdRef.current;
			if (id) await deleteDraft.mutateAsync({ draftId: id });
			onOpenChange(false);
		} catch {
		} finally {
			discardingRef.current = false;
			setDiscarding(false);
		}
	}

	function close() {
		if (discardingRef.current) return;
		void flushSave();
		onOpenChange(false);
	}

	const sending = send.isPending;
	const saving =
		save.isPending || addAttachment.isPending || removeAttachment.isPending;
	const complete = form.to.length > 0 && !sending;

	function recipientField(
		field: RecipientField,
		label: string,
		visible = true,
	) {
		if (!visible) return null;
		const value = form[field];
		const input = recipientInput[field];
		const open = activeField === field && input.trim().length >= 2;
		return (
			<div className="relative flex min-w-0 items-start gap-2 border-b px-5 py-2">
				<span className="w-12 shrink-0 pt-1.5 text-xs text-muted-foreground">
					{label}
				</span>
				<div className="flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-1">
					{value.map((entry) => (
						<span
							key={entry.email}
							className="inline-flex max-w-full items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs"
						>
							<span className="max-w-48 truncate">
								{entry.name || entry.email}
							</span>
							<button
								type="button"
								onClick={() =>
									updateForm({
										[field]: value.filter((item) => item.email !== entry.email),
									})
								}
								className="text-muted-foreground hover:text-foreground"
								aria-label={t("mail.removeRecipient", { email: entry.email })}
							>
								<X className="size-3" />
							</button>
						</span>
					))}
					<input
						value={input}
						onFocus={() => setActiveField(field)}
						onChange={(event) =>
							setRecipientInput((current) => ({
								...current,
								[field]: event.target.value,
							}))
						}
						onBlur={() =>
							window.setTimeout(
								() =>
									setActiveField((current) =>
										current === field ? null : current,
									),
								120,
							)
						}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" ||
								event.key === "Tab" ||
								event.key === ","
							) {
								event.preventDefault();
								addRecipients(field, input);
							}
							if (event.key === "Backspace" && !input && value.length)
								updateForm({ [field]: value.slice(0, -1) });
						}}
						onPaste={(event) => {
							const pasted = event.clipboardData.getData("text");
							if (/[;,\n]/.test(pasted)) {
								event.preventDefault();
								addRecipients(field, pasted);
							}
						}}
						placeholder={value.length ? "" : "name@example.com"}
						className="h-7 min-w-32 flex-1 bg-transparent px-0 text-xs outline-none placeholder:text-muted-foreground"
					/>
				</div>
				{open ? (
					<div className="absolute top-full left-17 z-20 max-h-52 w-[min(28rem,calc(100%-4rem))] overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
						{suggestions.isPending ? (
							<div className="p-2">
								<Spinner className="size-3" />
							</div>
						) : null}
						{(suggestions.data ?? []).map((entry) => (
							<button
								key={entry.email}
								type="button"
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => {
									addRecipients(field, `${entry.name ?? ""} <${entry.email}>`);
									setActiveField(null);
								}}
								className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted"
							>
								<span className="truncate text-xs font-medium">
									{entry.name || entry.email}
								</span>
								<span className="truncate text-[10px] text-muted-foreground">
									{entry.email}
								</span>
							</button>
						))}
						{!suggestions.isPending && suggestions.data?.length === 0 ? (
							<p className="px-2 py-3 text-xs text-muted-foreground">
								{t("mail.noRecipientMatches")}
							</p>
						) : null}
					</div>
				) : null}
			</div>
		);
	}

	return (
		<Dialog open onOpenChange={(open) => !open && close()}>
			<DialogContent
				className="flex h-[92vh] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
				showCloseButton={false}
			>
				<DialogHeader className="flex-row items-center justify-between border-b px-5 py-3">
					<DialogTitle className="text-sm">
						{form.subject.startsWith("Fwd:")
							? t("mail.forwardMessage")
							: form.subject.startsWith("Re:")
								? t("mail.reply")
								: t("mail.newMessage")}
					</DialogTitle>
					<div className="flex items-center gap-2 text-[10px] text-muted-foreground">
						{buyerTimezone ? (
							<span
								className={
									workingHours === false ? "text-destructive" : undefined
								}
							>
								{t("mail.buyerLocalTime", {
									time: buyerLocalTime(buyerTimezone, locale),
								})}
								{workingHours === false
									? ` · ${t("mail.outsideWorkingHours")}`
									: ""}
							</span>
						) : null}
						{saving ? <Spinner className="size-3" /> : null}
						{saving ? t("mail.saving") : draftId ? t("mail.saved") : ""}
					</div>
				</DialogHeader>
				<form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
					<div className="shrink-0 border-b">
						{recipientField("to", t("mail.to"))}
						{recipientField("cc", "Cc", showCc)}
						{recipientField("bcc", "Bcc", showBcc)}
						<div className="flex items-center gap-2 border-b px-5 py-2">
							<span className="w-12 shrink-0 text-xs text-muted-foreground">
								{t("mail.subject")}
							</span>
							<Input
								value={form.subject}
								onChange={(event) =>
									updateForm({ subject: event.target.value })
								}
								placeholder={t("mail.subject")}
								className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
							/>
							{!showCc ? (
								<Button
									type="button"
									size="xs"
									variant="ghost"
									onClick={() => setShowCc(true)}
								>
									Cc
								</Button>
							) : null}
							{!showBcc ? (
								<Button
									type="button"
									size="xs"
									variant="ghost"
									onClick={() => setShowBcc(true)}
								>
									Bcc
								</Button>
							) : null}
						</div>
					</div>
					<Textarea
						value={form.body}
						onChange={(event) => updateForm({ body: event.target.value })}
						className="min-h-0 flex-1 resize-none rounded-none border-0 px-5 py-3 shadow-none [field-sizing:fixed] focus-visible:ring-0"
						placeholder={t("mail.writeMessage")}
						autoFocus
					/>
					{attachments.length ? (
						<div className="flex flex-wrap gap-2 border-t px-5 py-2">
							{attachments.map((attachment) => (
								<span
									key={attachment.id}
									className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
								>
									<Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
									<span className="max-w-48 truncate">
										{attachment.filename}
									</span>
									<span className="text-[10px] text-muted-foreground">
										{formatBytes(attachment.size)}
									</span>
									<button
										type="button"
										onClick={() =>
											removeAttachment.mutate(
												{
													draftId: draftIdRef.current ?? "",
													attachmentId: attachment.id,
												},
												{
													onSuccess: () =>
														setAttachments((current) =>
															current.filter(
																(item) => item.id !== attachment.id,
															),
														),
												},
											)
										}
										className="text-muted-foreground hover:text-foreground"
										aria-label={t("mail.removeAttachment", {
											filename: attachment.filename,
										})}
									>
										<X className="size-3" />
									</button>
								</span>
							))}
						</div>
					) : null}
					<DialogFooter className="flex-wrap justify-between border-t px-5 py-3 sm:justify-between">
						<div className="flex items-center gap-1">
							<input
								id={attachmentInputId}
								type="file"
								className="sr-only"
								multiple
								onChange={(event) => {
									void uploadFiles(event.target.files);
									event.currentTarget.value = "";
								}}
							/>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() =>
									document.getElementById(attachmentInputId)?.click()
								}
								title={t("mail.attachFiles")}
							>
								<FileUp data-icon="inline-start" /> {t("mail.attach")}
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button type="button" size="sm" variant="ghost">
										<ChevronDown data-icon="inline-start" />{" "}
										{t("mail.template")}
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent>
									<DropdownMenuLabel>{t("mail.templates")}</DropdownMenuLabel>
									<DropdownMenuSeparator />
									{templates.map((template) => (
										<DropdownMenuItem
											key={template.labelKey}
											onSelect={() => applyTemplate(template)}
										>
											{t(template.labelKey)}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={appendSignature}
								disabled={!mailbox.data}
							>
								<Signature data-icon="inline-start" /> {t("mail.signature")}
							</Button>
						</div>
						<div className="flex items-center gap-1">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={discard}
								disabled={discarding || deleteDraft.isPending}
							>
								<Trash2 data-icon="inline-start" /> {t("mail.discard")}
							</Button>
							<Button type="button" variant="outline" size="sm" onClick={close}>
								{t("common.close")}
							</Button>
							<Button type="submit" disabled={!complete || sending}>
								{sending ? (
									<Spinner data-icon="inline-start" />
								) : (
									<Send data-icon="inline-start" />
								)}{" "}
								{t("mail.send")}
							</Button>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
