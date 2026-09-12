"use client";

import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	EntityLogo,
	type EntityLogoTone,
} from "@crm/ui/components/entity-logo";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import { formatMoney } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AgentPanel } from "@/components/crm/agent-panel";
import {
	InlineDateField,
	InlineField,
	InlineSelectField,
	savingField,
} from "@/components/crm/inline-field";
import { OwnerCell } from "@/components/crm/owner-cell";
import { DealStageMenu } from "@/components/crm/stage-change";
import { StageStepper } from "@/components/crm/stage-stepper";
import { Timeline } from "@/components/crm/timeline/timeline";
import {
	DetailSheetBody,
	DetailSheetEmpty,
	DetailSheetProperties,
	DetailSheetProperty,
	DetailSheetSection,
	DetailSheetStat,
	DetailSheetStats,
	type DetailSheetTab,
} from "@/components/detail-sheet";
import { useLanguage } from "@/lib/i18n";
import { formatRelativeTime } from "@/lib/i18n-core";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { OrdersPanel } from "./orders-panel";
import { QuotationPanel } from "./quotation-panel";
import { RecordActions } from "./record-actions";
import { RecordSheetFrame } from "./record-parts";
import { useOpenRecord, useRecordSheetView } from "./record-stack";
import { SamplesPanel } from "./samples-panel";

type Deal = RouterOutputs["deals"]["byId"];

export function DealSheet({ dealId }: { dealId: string }) {
	const { language, locale, t } = useLanguage();
	const dateFormat = new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	const trpc = useTRPC();
	const openRecord = useOpenRecord();
	const { tab, setTab } = useRecordSheetView("overview");

	const query = useQuery(trpc.deals.byId.queryOptions({ id: dealId }));
	const deal = query.data;

	const tabs: DetailSheetTab[] = deal
		? [
				{
					value: "overview",
					label: t("detail.overview"),
					content: <DealOverview deal={deal} />,
				},
				{
					value: "contacts",
					label: t("detail.contacts"),
					count: deal.contacts.length,
					content: <DealContacts deal={deal} />,
				},
				{
					value: "quotations",
					label: t("detail.quotations"),
					count: deal.quotations.length,
					content: <QuotationPanel inquiry={deal} />,
				},
				{
					value: "samples",
					label: t("detail.samples"),
					content: <SamplesPanel dealId={deal.id} />,
				},
				{
					value: "orders",
					label: t("detail.orders"),
					content: <OrdersPanel dealId={deal.id} />,
				},
				{
					value: "activity",
					label: t("detail.activity"),
					content: <Timeline anchor={{ dealId: deal.id }} />,
				},
				{
					value: "agent",
					label: t("detail.agent"),
					content: <AgentPanel record={{ kind: "deal", id: deal.id }} />,
					keepMounted: true,
				},
			]
		: [];

	return (
		<RecordSheetFrame
			loading={query.isPending}
			error={query.error?.message ?? null}
			title={deal?.name ?? t("deal.inquiry")}
			description={
				deal ? (
					<button
						type="button"
						onClick={() => openRecord({ kind: "company", id: deal.company.id })}
						className="text-foreground underline-offset-2 hover:underline"
					>
						{deal.company.name}
					</button>
				) : undefined
			}
			media={
				deal ? (
					<EntityLogo
						src={deal.company.iconUrl}
						darkSrc={deal.company.iconDarkUrl}
						tone={deal.company.iconTone as EntityLogoTone | null | undefined}
						name={deal.company.name}
						size="lg"
					/>
				) : null
			}
			actions={
				deal ? (
					<>
						<DealStageMenu
							dealId={deal.id}
							stage={deal.stage}
							variant="control"
						/>
						<RecordActions
							record={{ kind: "deal", id: deal.id }}
							name={deal.name}
							consequence={t("delete.inquiry", {
								company: deal.company.name,
								count: deal.contacts.length,
							})}
						/>
					</>
				) : null
			}
			stats={
				deal ? (
					<DetailSheetStats>
						<DetailSheetStat label={t("deal.amount")}>
							{deal.amountCents === null ? (
								<EmptyCellValue />
							) : (
								<span className="tabular-nums">
									{formatMoney(deal.amountCents, deal.currency)}
								</span>
							)}
						</DetailSheetStat>
						<DetailSheetStat label={t("deal.expectedOrder")}>
							{deal.expectedOrderDate ? (
								dateFormat.format(
									new Date(`${deal.expectedOrderDate}T00:00:00`),
								)
							) : (
								<EmptyCellValue />
							)}
						</DetailSheetStat>
						<DetailSheetStat label={t("deal.no")}>
							{deal.inquiryNo ?? <EmptyCellValue />}
						</DetailSheetStat>
						<DetailSheetStat label={t("deal.inStage")}>
							{formatRelativeTime(deal.stageChangedAt, language)}
						</DetailSheetStat>
						<DetailSheetStat label={t("deal.owner")}>
							<OwnerCell owner={deal.owner} />
						</DetailSheetStat>
					</DetailSheetStats>
				) : null
			}
			tabs={tabs}
			tab={tab}
			onTabChange={setTab}
		/>
	);
}

function DealOverview({ deal }: { deal: Deal }) {
	const { locale, t } = useLanguage();
	const dateFormat = new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	const trpc = useTRPC();
	const cache = useCrmCache();

	const users = useQuery(trpc.users.list.queryOptions());
	const companies = useQuery(trpc.companies.options.queryOptions({ q: "" }));

	const update = useMutation(
		trpc.deals.update.mutationOptions({
			onSuccess: () => cache.deal(deal.id, { settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const save = (data: Parameters<typeof update.mutate>[0]["data"]) =>
		update.mutate({ id: deal.id, data });

	const isSaving = savingField(update);

	return (
		<DetailSheetBody>
			<DetailSheetSection title={t("deal.inquiryStage")}>
				<StageStepper dealId={deal.id} stage={deal.stage} />

				{deal.closedReason ? (
					<DetailSheetProperties>
						<DetailSheetProperty label={t("deal.closedAt")}>
							{deal.closedAt ? (
								dateFormat.format(new Date(deal.closedAt))
							) : (
								<EmptyCellValue />
							)}
						</DetailSheetProperty>
						<DetailSheetProperty label={t("deal.closedReason")} wide>
							{deal.closedReason}
						</DetailSheetProperty>
					</DetailSheetProperties>
				) : null}
			</DetailSheetSection>

			<DetailSheetSection title={t("deal.inquiry")}>
				<DetailSheetProperties>
					<InlineField
						label={t("common.name")}
						value={deal.name}
						saving={isSaving("name")}
						onSave={(name) => name && save({ name })}
					/>
					<InlineField
						label={t("deal.amount")}
						value={
							deal.amountCents === null ? null : String(deal.amountCents / 100)
						}
						placeholder="24000"
						saving={isSaving("amountCents")}
						onSave={(next) => {
							if (next === "") return save({ amountCents: null });
							const parsed = Number.parseFloat(next);
							if (!Number.isFinite(parsed) || parsed < 0) {
								toast.error(t("deal.invalidAmount"));
								return;
							}
							save({ amountCents: Math.round(parsed * 100) });
						}}
						render={(value) =>
							formatMoney(Math.round(Number(value) * 100), deal.currency)
						}
					/>
					<InlineField
						label={t("deal.currency")}
						value={deal.currency}
						saving={isSaving("currency")}
						onSave={(currency) => {
							if (currency.length !== 3) {
								toast.error(t("deal.invalidCurrency"));
								return;
							}
							save({ currency: currency.toUpperCase() });
						}}
					/>
					<InlineDateField
						label={t("deal.expectedOrder")}
						value={deal.expectedOrderDate}
						saving={isSaving("expectedOrderDate")}
						onSave={(next) => save({ expectedOrderDate: next || null })}
					/>
					<InlineField
						label={t("deal.product")}
						value={deal.productSummary}
						placeholder="Product or category"
						saving={isSaving("productSummary")}
						onSave={(productSummary) => save({ productSummary })}
					/>
					<InlineField
						label={t("deal.quantity")}
						value={deal.quantity}
						placeholder="e.g. 500"
						saving={isSaving("quantity")}
						onSave={(quantity) => save({ quantity })}
					/>
					<InlineSelectField
						label={t("deal.incoterm")}
						value={deal.incoterm ?? "NONE"}
						options={[
							{ value: "NONE", label: t("common.notSet") },
							...(
								["EXW", "FOB", "CFR", "CIF", "DAP", "DDP", "OTHER"] as const
							).map((value) => ({ value, label: value })),
						]}
						onSave={(incoterm) =>
							save({
								incoterm: incoterm === "NONE" ? null : (incoterm as never),
							})
						}
					/>
					<InlineField
						label={t("deal.destination")}
						value={deal.destinationPort}
						placeholder="Port / destination"
						saving={isSaving("destinationPort")}
						onSave={(destinationPort) => save({ destinationPort })}
					/>
					<InlineField
						label={t("deal.paymentTerms")}
						value={deal.paymentTerms}
						placeholder="e.g. 30% T/T deposit"
						saving={isSaving("paymentTerms")}
						onSave={(paymentTerms) => save({ paymentTerms })}
					/>
					<InlineSelectField
						label={t("common.company")}
						value={deal.company.id}
						options={(companies.data ?? []).map((company) => ({
							value: company.id,
							label: company.name,
						}))}
						onSave={(companyId) => save({ companyId })}
					/>
					<InlineSelectField
						label={t("common.owner")}
						value={deal.owner.id}
						options={(users.data ?? []).map((user) => ({
							value: user.id,
							label: user.name,
						}))}
						onSave={(ownerId) => save({ ownerId })}
					/>
				</DetailSheetProperties>
			</DetailSheetSection>
		</DetailSheetBody>
	);
}

function DealContacts({ deal }: { deal: Deal }) {
	const { t } = useLanguage();
	const contactColumns = [
		{ header: t("contact.name"), width: "w-[30%]", className: "pl-5" },
		{ header: t("deal.role"), width: "w-[20%]" },
		{ header: t("contact.titleField"), width: "w-[25%]" },
		{ header: t("contact.email"), width: "w-[25%]" },
	];
	const openRecord = useOpenRecord();

	if (deal.contacts.length === 0) {
		return (
			<DetailSheetEmpty
				icon={UserMultiple}
				title={t("deal.noContacts")}
				description={t("deal.noContactsDescription", {
					name: deal.company.name,
				})}
			/>
		);
	}

	return (
		<SimpleTable variant="panel" columns={contactColumns}>
			{deal.contacts.map((contact) => (
				<SimpleTableRow
					key={contact.id}
					clickable
					onClick={() => openRecord({ kind: "contact", id: contact.id })}
				>
					<TableCell className="truncate py-2.5 pr-3 pl-5 font-medium">
						<span className="flex min-w-0 items-center gap-2">
							<PersonAvatar
								src={contact.imageUrl}
								name={[contact.firstName, contact.lastName]
									.filter(Boolean)
									.join(" ")}
								email={contact.email}
								size="sm"
							/>
							<span className="truncate">
								{[contact.firstName, contact.lastName]
									.filter(Boolean)
									.join(" ")}
							</span>
						</span>
					</TableCell>
					<TableCell className="truncate px-3 py-2.5">
						{contact.role ?? <EmptyCellValue />}
					</TableCell>
					<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
						{contact.title ?? <EmptyCellValue />}
					</TableCell>
					<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
						{contact.email ?? <EmptyCellValue />}
					</TableCell>
				</SimpleTableRow>
			))}
		</SimpleTable>
	);
}
