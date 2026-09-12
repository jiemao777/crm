"use client";

import Add from "@carbon/icons-react/es/Add";
import Delete from "@carbon/icons-react/es/Delete";
import Email from "@carbon/icons-react/es/Email";
import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { Spinner } from "@crm/ui/components/spinner";
import { TableCell } from "@crm/ui/components/table";
import { Textarea } from "@crm/ui/components/textarea";
import { formatMoney } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	DetailSheetEmpty,
	DetailSheetProperties,
	DetailSheetProperty,
	DetailSheetSection,
} from "@/components/detail-sheet";
import { LocalizedDatePicker as DatePicker } from "@/components/localized-date-picker";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-core";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import {
	ComposeDialog,
	type ComposeDraft,
} from "../../../app/(app)/[slug]/mail/compose-dialog";
import { PrintQuotationButton } from "./quotation-print";

type Inquiry = RouterOutputs["deals"]["byId"];
type Quotation = Inquiry["quotations"][number];

type DraftLine = {
	id: string;
	productName: string;
	sku: string;
	specification: string;
	quantity: string;
	unit: string;
	unitPrice: string;
};

const STATUS_OPTIONS = [
	{ value: "DRAFT", key: "quotation.status.draft" },
	{ value: "SENT", key: "quotation.status.sent" },
	{ value: "ACCEPTED", key: "quotation.status.accepted" },
	{ value: "DECLINED", key: "quotation.status.declined" },
	{ value: "EXPIRED", key: "quotation.status.expired" },
] as const satisfies readonly { value: string; key: TranslationKey }[];

const INCOTERMS = ["EXW", "FOB", "CFR", "CIF", "DAP", "DDP", "OTHER"] as const;

function quotationStatusKey(status: Quotation["status"]): TranslationKey {
	return (
		STATUS_OPTIONS.find((option) => option.value === status)?.key ??
		"quotation.status.draft"
	);
}

function emptyLine(): DraftLine {
	return {
		id: crypto.randomUUID(),
		productName: "",
		sku: "",
		specification: "",
		quantity: "1",
		unit: "PCS",
		unitPrice: "",
	};
}

function lineFrom(quotation: Quotation): DraftLine[] {
	return quotation.items.map((item) => ({
		id: item.id,
		productName: item.productName,
		sku: item.sku ?? "",
		specification: item.specification ?? "",
		quantity: String(item.quantity),
		unit: item.unit ?? "",
		unitPrice: String(item.unitPriceCents / 100),
	}));
}

function quoteDate(value: string | null, locale: Locale): string {
	return value
		? new Intl.DateTimeFormat(locale, {
				month: "short",
				day: "numeric",
				year: "numeric",
			}).format(new Date(value))
		: "—";
}

function prepareLines(lines: DraftLine[]) {
	return lines.map((line) => ({
		productName: line.productName.trim(),
		sku: line.sku.trim() || null,
		specification: line.specification.trim() || null,
		quantity: Number.parseFloat(line.quantity),
		unit: line.unit.trim() || null,
		unitPriceCents: Math.round(Number.parseFloat(line.unitPrice) * 100),
	}));
}

function linesValid(lines: DraftLine[]): boolean {
	return (
		lines.length > 0 &&
		lines.every((line) => {
			const quantity = Number.parseFloat(line.quantity);
			const unitPrice = Number.parseFloat(line.unitPrice);
			return (
				line.productName.trim() !== "" &&
				Number.isFinite(quantity) &&
				quantity > 0 &&
				Number.isFinite(unitPrice) &&
				unitPrice >= 0
			);
		})
	);
}

function quotationTerms(quotation: Quotation): string {
	return [quotation.incoterm, quotation.originPort, quotation.destinationPort]
		.filter(Boolean)
		.join(" · ");
}

function buildQuotationEmail(
	inquiry: Inquiry,
	quotation: Quotation,
	workspaceName: string | undefined,
): { subject: string; body: string } {
	const money = (cents: number) => formatMoney(cents, quotation.currency);
	const divider = "--------------------------------";
	const lines = quotation.items.map((item) => {
		const spec = item.specification ? ` (${item.specification})` : "";
		const unit = item.unit ? ` ${item.unit}` : "";
		return `${item.productName}${spec}\n  ${item.quantity}${unit} × ${money(item.unitPriceCents)} = ${money(item.lineTotalCents)}`;
	});
	const terms = [
		quotation.incoterm
			? `Terms: ${[quotation.incoterm, quotation.originPort, quotation.destinationPort].filter(Boolean).join(" ")}`
			: null,
		quotation.paymentTerms ? `Payment: ${quotation.paymentTerms}` : null,
		quotation.leadTimeDays ? `Lead time: ${quotation.leadTimeDays} days` : null,
		quotation.validUntil
			? `Valid until: ${quotation.validUntil.slice(0, 10)}`
			: null,
	].filter(Boolean);

	const contact = inquiry.contacts.find((entry) => entry.email);
	const greeting = contact?.firstName ? `Dear ${contact.firstName},` : "Hello,";

	return {
		subject: `Quotation ${quotation.quoteNumber} — ${inquiry.productSummary ?? inquiry.name}`,
		body: [
			greeting,
			"",
			"Thank you for your inquiry. Please find our best offer below.",
			"",
			`Quotation No.: ${quotation.quoteNumber} (v${quotation.version})`,
			divider,
			...lines,
			divider,
			`Total: ${money(quotation.totalCents)}`,
			...(terms.length > 0 ? ["", ...terms] : []),
			"",
			"Please let us know if you have any questions or need any adjustments.",
			"",
			"Best regards,",
			workspaceName ?? "",
		]
			.filter((line) => line !== undefined)
			.join("\n"),
	};
}

export function QuotationPanel({ inquiry }: { inquiry: Inquiry }) {
	const { locale, t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const quotationColumns = [
		{ header: t("quotation.quote"), width: "w-[18%]", className: "pl-5" },
		{ header: t("common.status"), width: "w-[14%]" },
		{ header: t("quotation.terms"), width: "w-[24%]" },
		{ header: t("quotation.validUntil"), width: "w-[16%]" },
		{
			header: t("order.total"),
			width: "w-[18%]",
			align: "right" as const,
		},
		{ header: "", width: "w-[12%]", align: "right" as const },
	];
	const [creating, setCreating] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [emailDraft, setEmailDraft] = useState<ComposeDraft | null>(null);
	const [emailQuoteId, setEmailQuoteId] = useState<string | null>(null);
	const workspace = useQuery({
		...trpc.workspace.get.queryOptions(),
		staleTime: 60_000,
	});

	const saveDraft = useMutation(
		trpc.google.saveDraft.mutationOptions({
			onError: (error) => toast.error(error.message),
		}),
	);
	const markSent = useMutation(
		trpc.deals.setQuotationStatus.mutationOptions({
			onSuccess: async () => {
				await cache.deal(inquiry.id, { settle: "record" });
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const convertToPi = useMutation(
		trpc.deals.convertQuotationToOrder.mutationOptions({
			onSuccess: async (result) => {
				await cache.deal(inquiry.id, { settle: "record" });
				toast.success(
					result.created
						? t("quotation.piCreated", { number: result.orderNumber })
						: t("quotation.piExists", { number: result.orderNumber }),
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const emailQuote = async (quotation: Quotation) => {
		const { subject, body } = buildQuotationEmail(
			inquiry,
			quotation,
			workspace.data?.name,
		);
		const to = inquiry.contacts
			.filter((contact) => contact.email)
			.map((contact) => ({
				email: contact.email as string,
				name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
			}));
		try {
			const draft = await saveDraft.mutateAsync({
				to,
				subject,
				body,
			});
			setEmailQuoteId(quotation.id);
			setEmailDraft({
				draftId: draft.id,
				to: draft.to,
				cc: draft.cc,
				bcc: draft.bcc,
				subject: draft.subject,
				body: draft.body,
			});
		} catch {
			// toast already shown by the mutation
		}
	};

	const selected =
		inquiry.quotations.find((quotation) => quotation.id === selectedId) ?? null;

	if (creating) {
		return (
			<QuotationForm inquiry={inquiry} onDone={() => setCreating(false)} />
		);
	}

	if (selected) {
		return (
			<QuotationForm
				inquiry={inquiry}
				quotation={selected}
				onDone={() => setSelectedId(null)}
			/>
		);
	}

	if (inquiry.quotations.length === 0) {
		return (
			<DetailSheetEmpty
				icon={Add}
				title={t("quotation.noQuotations")}
				description={t("quotation.emptyDescription")}
				action={
					<Button variant="outline" size="sm" onClick={() => setCreating(true)}>
						<Icon icon={Add} data-icon="inline-start" />
						{t("quotation.create")}
					</Button>
				}
			/>
		);
	}

	return (
		<DetailSheetSection title={t("quotation.history")}>
			<SimpleTable variant="panel" columns={quotationColumns}>
				{inquiry.quotations.map((quotation) => (
					<SimpleTableRow
						key={quotation.id}
						clickable
						onClick={() => setSelectedId(quotation.id)}
					>
						<TableCell className="truncate py-2.5 pr-3 pl-5 font-medium">
							{quotation.quoteNumber}
							<span className="ml-2 text-muted-foreground">
								v{quotation.version}
							</span>
						</TableCell>
						<TableCell className="px-3 py-2.5">
							{t(quotationStatusKey(quotation.status))}
						</TableCell>
						<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
							{quotationTerms(quotation) || <EmptyCellValue />}
						</TableCell>
						<TableCell className="px-3 py-2.5 text-muted-foreground">
							{quoteDate(quotation.validUntil, locale)}
						</TableCell>
						<TableCell className="px-5 py-2.5 text-right font-medium tabular-nums">
							{formatMoney(quotation.totalCents, quotation.currency)}
						</TableCell>
						<TableCell className="px-3 py-2.5 text-right">
							<div className="flex items-center justify-end gap-1">
								<Button
									variant="ghost"
									size="icon-xs"
									title={t("quotation.sendEmail")}
									aria-label={t("quotation.sendEmail")}
									disabled={saveDraft.isPending}
									onClick={(event) => {
										event.stopPropagation();
										void emailQuote(quotation);
									}}
								>
									<Icon icon={Email} />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="px-1.5 text-xs"
									title={t("quotation.convertPi")}
									disabled={convertToPi.isPending}
									onClick={(event) => {
										event.stopPropagation();
										convertToPi.mutate({ id: quotation.id });
									}}
								>
									PI
								</Button>
								<PrintQuotationButton inquiry={inquiry} quotation={quotation} />
							</div>
						</TableCell>
					</SimpleTableRow>
				))}
			</SimpleTable>
			<div className="pt-3">
				<Button variant="outline" size="sm" onClick={() => setCreating(true)}>
					<Icon icon={Add} data-icon="inline-start" />
					{t("quotation.newRevision")}
				</Button>
			</div>
			{emailDraft ? (
				<ComposeDialog
					key={emailDraft.draftId ?? "new"}
					initial={emailDraft}
					onOpenChange={(open) => {
						if (!open) setEmailDraft(null);
					}}
					onSent={() => {
						const quotation = inquiry.quotations.find(
							(entry) => entry.id === emailQuoteId,
						);
						if (quotation?.status === "DRAFT") {
							markSent.mutate({ id: quotation.id, status: "SENT" });
						}
					}}
				/>
			) : null}
		</DetailSheetSection>
	);
}

function QuotationForm({
	inquiry,
	quotation,
	onDone,
}: {
	inquiry: Inquiry;
	quotation?: Quotation;
	onDone: () => void;
}) {
	const { locale, t } = useLanguage();
	const lineColumns = [
		{ header: t("sample.product"), width: "w-[28%]", className: "pl-5" },
		{ header: t("quotation.sku"), width: "w-[14%]" },
		{
			header: t("sample.qty"),
			width: "w-[13%]",
			align: "right" as const,
		},
		{
			header: t("order.unitPrice"),
			width: "w-[18%]",
			align: "right" as const,
		},
		{
			header: t("quotation.lineTotal"),
			width: "w-[20%]",
			align: "right" as const,
		},
		{ srLabel: t("common.moreActions"), width: "w-[7%]" },
	];
	const trpc = useTRPC();
	const cache = useCrmCache();
	const [lines, setLines] = useState<DraftLine[]>(
		quotation ? lineFrom(quotation) : [emptyLine()],
	);
	const [currency, setCurrency] = useState(
		quotation?.currency ?? inquiry.currency,
	);
	const [incoterm, setIncoterm] = useState(
		quotation?.incoterm ?? inquiry.incoterm ?? "",
	);
	const [originPort, setOriginPort] = useState(
		quotation?.originPort ?? inquiry.originPort ?? "",
	);
	const [destinationPort, setDestinationPort] = useState(
		quotation?.destinationPort ?? inquiry.destinationPort ?? "",
	);
	const [paymentTerms, setPaymentTerms] = useState(
		quotation?.paymentTerms ?? inquiry.paymentTerms ?? "",
	);
	const [leadTimeDays, setLeadTimeDays] = useState(
		quotation?.leadTimeDays === null || quotation?.leadTimeDays === undefined
			? ""
			: String(quotation.leadTimeDays),
	);
	const [validUntil, setValidUntil] = useState(
		quotation?.validUntil?.slice(0, 10) ??
			inquiry.quoteValidUntil?.slice(0, 10) ??
			"",
	);
	const [notes, setNotes] = useState(quotation?.notes ?? "");
	const termsId = useId();
	const notesId = useId();

	const invalidate = async () => {
		await cache.deal(inquiry.id, { settle: "record" });
	};

	const create = useMutation(
		trpc.deals.createQuotation.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success(t("quotation.created"));
				onDone();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const update = useMutation(
		trpc.deals.updateQuotation.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success(t("quotation.saved"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const setStatus = useMutation(
		trpc.deals.setQuotationStatus.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success(t("quotation.statusUpdated"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const remove = useMutation(
		trpc.deals.deleteQuotation.mutationOptions({
			onSuccess: async () => {
				await invalidate();
				toast.success(t("quotation.deleted"));
				onDone();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const pending =
		create.isPending ||
		update.isPending ||
		setStatus.isPending ||
		remove.isPending;
	const save = () => {
		if (!linesValid(lines)) {
			toast.error(t("quotation.invalidLines"));
			return;
		}
		const data = {
			currency: currency.toUpperCase(),
			incoterm:
				incoterm === ""
					? null
					: (incoterm as
							| "EXW"
							| "FOB"
							| "CFR"
							| "CIF"
							| "DAP"
							| "DDP"
							| "OTHER"),
			originPort: originPort || null,
			destinationPort: destinationPort || null,
			paymentTerms: paymentTerms || null,
			leadTimeDays:
				leadTimeDays === "" ? null : Number.parseInt(leadTimeDays, 10),
			validUntil: validUntil || null,
			notes: notes || null,
			items: prepareLines(lines),
		};
		if (quotation) update.mutate({ id: quotation.id, data });
		else create.mutate({ dealId: inquiry.id, ...data });
	};

	const updateLine = (index: number, field: keyof DraftLine, value: string) => {
		setLines((current) =>
			current.map((line, lineIndex) =>
				lineIndex === index ? { ...line, [field]: value } : line,
			),
		);
	};

	return (
		<div className="flex flex-col gap-5 p-5">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h3 className="font-medium">
						{quotation
							? `${quotation.quoteNumber} · v${quotation.version}`
							: t("quotation.new")}
					</h3>
					<p className="text-muted-foreground text-xs">
						{quotation
							? t("quotation.editDescription")
							: t("quotation.newDescription")}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={onDone}
						disabled={pending}
					>
						{t("common.back")}
					</Button>
					{quotation ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() => remove.mutate({ id: quotation.id })}
							disabled={pending}
						>
							<Icon icon={Delete} />{" "}
							<span className="sr-only">{t("quotation.delete")}</span>
						</Button>
					) : null}
				</div>
			</div>

			{quotation ? (
				<DetailSheetProperties>
					<DetailSheetProperty label={t("common.status")}>
						<Select
							value={quotation.status}
							onValueChange={(status) =>
								setStatus.mutate({ id: quotation.id, status: status as never })
							}
						>
							<SelectTrigger variant="ghost" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{STATUS_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{t(option.key)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</DetailSheetProperty>
					<DetailSheetProperty label={t("quotation.sent")}>
						{quoteDate(quotation.sentAt, locale)}
					</DetailSheetProperty>
				</DetailSheetProperties>
			) : null}

			<DetailSheetSection title={t("quotation.lines")}>
				<SimpleTable variant="panel" columns={lineColumns}>
					{lines.map((line, index) => {
						const quantity = Number.parseFloat(line.quantity);
						const price = Number.parseFloat(line.unitPrice);
						const total =
							Number.isFinite(quantity) && Number.isFinite(price)
								? Math.round(quantity * price * 100)
								: null;
						return (
							<SimpleTableRow key={line.id}>
								<TableCell className="p-2 pl-5">
									<Input
										value={line.productName}
										placeholder={t("quotation.productName")}
										onChange={(event) =>
											updateLine(index, "productName", event.target.value)
										}
									/>
								</TableCell>
								<TableCell className="p-2">
									<Input
										value={line.sku}
										placeholder={t("quotation.sku")}
										onChange={(event) =>
											updateLine(index, "sku", event.target.value)
										}
									/>
								</TableCell>
								<TableCell className="p-2">
									<Input
										value={line.quantity}
										inputMode="decimal"
										onChange={(event) =>
											updateLine(index, "quantity", event.target.value)
										}
									/>
								</TableCell>
								<TableCell className="p-2">
									<Input
										value={line.unitPrice}
										inputMode="decimal"
										placeholder="0.00"
										onChange={(event) =>
											updateLine(index, "unitPrice", event.target.value)
										}
									/>
								</TableCell>
								<TableCell className="px-3 py-2 text-right tabular-nums">
									{total === null ? (
										<EmptyCellValue />
									) : (
										formatMoney(total, currency)
									)}
								</TableCell>
								<TableCell className="p-2">
									<Button
										variant="ghost"
										size="icon-xs"
										disabled={lines.length === 1}
										onClick={() =>
											setLines((current) =>
												current.filter((_, lineIndex) => lineIndex !== index),
											)
										}
									>
										<Icon icon={Delete} />
										<span className="sr-only">{t("quotation.removeLine")}</span>
									</Button>
								</TableCell>
							</SimpleTableRow>
						);
					})}
				</SimpleTable>
				<div className="pt-3">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setLines((current) => [...current, emptyLine()])}
					>
						<Icon icon={Add} data-icon="inline-start" />
						{t("order.addLine")}
					</Button>
				</div>
			</DetailSheetSection>

			<FieldGroup>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field>
						<FieldLabel>{t("deal.currency")}</FieldLabel>
						<Input
							value={currency}
							maxLength={3}
							onChange={(event) =>
								setCurrency(event.target.value.toUpperCase())
							}
						/>
					</Field>
					<Field>
						<FieldLabel>{t("deal.incoterm")}</FieldLabel>
						<Select value={incoterm} onValueChange={setIncoterm}>
							<SelectTrigger>
								<SelectValue placeholder={t("quotation.select")} />
							</SelectTrigger>
							<SelectContent>
								{INCOTERMS.map((term) => (
									<SelectItem key={term} value={term}>
										{term}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel>{t("quotation.originPort")}</FieldLabel>
						<Input
							value={originPort}
							onChange={(event) => setOriginPort(event.target.value)}
							placeholder="Ningbo"
						/>
					</Field>
					<Field>
						<FieldLabel>{t("quotation.destinationPort")}</FieldLabel>
						<Input
							value={destinationPort}
							onChange={(event) => setDestinationPort(event.target.value)}
							placeholder="Hamburg"
						/>
					</Field>
					<Field>
						<FieldLabel>{t("deal.paymentTerms")}</FieldLabel>
						<Input
							id={termsId}
							value={paymentTerms}
							onChange={(event) => setPaymentTerms(event.target.value)}
							placeholder="30% T/T deposit, 70% before shipment"
						/>
					</Field>
					<Field>
						<FieldLabel>{t("quotation.leadTime")}</FieldLabel>
						<Input
							value={leadTimeDays}
							inputMode="numeric"
							onChange={(event) => setLeadTimeDays(event.target.value)}
							placeholder="30"
						/>
					</Field>
					<Field>
						<FieldLabel>{t("quotation.validUntil")}</FieldLabel>
						<DatePicker
							value={validUntil}
							onChange={setValidUntil}
							placeholder={t("quotation.chooseDate")}
						/>
					</Field>
				</div>
				<Field>
					<FieldLabel htmlFor={notesId}>{t("order.notes")}</FieldLabel>
					<Textarea
						id={notesId}
						value={notes}
						onChange={(event) => setNotes(event.target.value)}
						placeholder={t("quotation.notesPlaceholder")}
					/>
				</Field>
			</FieldGroup>
			<div className="flex justify-end gap-2">
				<Button variant="outline" onClick={onDone} disabled={pending}>
					{t("common.cancel")}
				</Button>
				<Button onClick={save} disabled={pending || !linesValid(lines)}>
					{pending ? <Spinner /> : null}
					{t("quotation.save")}
				</Button>
			</div>
		</div>
	);
}
