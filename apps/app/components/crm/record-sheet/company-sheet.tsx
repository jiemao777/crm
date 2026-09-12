"use client";

import Add from "@carbon/icons-react/es/Add";
import Partnership from "@carbon/icons-react/es/Partnership";
import Star from "@carbon/icons-react/es/Star";
import StarFilled from "@carbon/icons-react/es/StarFilled";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Button } from "@crm/ui/components/button";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	EntityLogo,
	type EntityLogoTone,
} from "@crm/ui/components/entity-logo";
import { Icon } from "@crm/ui/components/icon";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { SimpleTable, SimpleTableRow } from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { formatMoney } from "@crm/ui/lib/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AgentPanel } from "@/components/crm/agent-panel";
import { OPEN_STAGES } from "@/components/crm/deal-stage";
import { EnrichmentActions } from "@/components/crm/enrichment-actions";
import {
	ENRICHMENT_POLL_MS,
	EnrichmentIndicator,
	isEnriching,
} from "@/components/crm/enrichment-status";
import {
	InlineField,
	InlineSelectField,
	savingField,
} from "@/components/crm/inline-field";
import { OwnerCell } from "@/components/crm/owner-cell";
import { CompanySocials, hasCompanyLinks } from "@/components/crm/social-links";
import { DealStageMenu } from "@/components/crm/stage-change";
import { Timeline } from "@/components/crm/timeline/timeline";
import {
	DetailSheetBody,
	DetailSheetEmpty,
	DetailSheetMain,
	DetailSheetPending,
	DetailSheetProperties,
	DetailSheetProperty,
	DetailSheetProse,
	DetailSheetRail,
	DetailSheetSection,
	DetailSheetSplit,
	DetailSheetStat,
	DetailSheetStats,
	type DetailSheetTab,
} from "@/components/detail-sheet";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { buyerLocalTime, timezoneOptions } from "@/lib/timezones";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { QuickAddContact, QuickAddDeal } from "./quick-add";
import { RecordActions } from "./record-actions";
import {
	DealAmount,
	DomainLink,
	MetaLine,
	RecordSheetFrame,
} from "./record-parts";
import { useOpenRecord, useRecordSheetView } from "./record-stack";

type Company = RouterOutputs["companies"]["byId"];
type CompanyDeal = Company["deals"][number];

const UNASSIGNED = "unassigned";

function pendingFields(company: Company): TranslationKey[] {
	const missing: TranslationKey[] = [];
	if (!company.industry) missing.push("company.industry");
	if (!company.description) missing.push("company.descriptionField");
	if (!hasCompanyLinks(company)) missing.push("company.socialLinks");
	return missing;
}

function companyConsequence(
	company: Company,
	t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
	const inquiries = company.deals.length;
	const contacts = company.contacts.length;
	const gone = inquiries
		? t("delete.companyWithInquiries", { count: inquiries })
		: t("delete.companyWithoutInquiries");
	const kept = contacts
		? t("delete.companyContactsRemain", { count: contacts })
		: "";
	return [gone, kept].filter(Boolean).join(" ");
}

function nextClose(deals: CompanyDeal[]): string | null {
	const dates = deals
		.map((deal) => deal.expectedOrderDate)
		.filter((date): date is string => date !== null)
		.sort();
	return dates[0] ?? null;
}

function AddRow({
	label,
	columns,
	onClick,
}: {
	label: string;
	columns: number;
	onClick: () => void;
}) {
	return (
		<SimpleTableRow>
			<TableCell colSpan={columns} className="p-0">
				<Button
					variant="ghost"
					size="sm"
					onClick={onClick}
					className="h-9 w-full justify-start px-5 font-normal text-muted-foreground"
				>
					<Icon icon={Add} data-icon="inline-start" />
					{label}
				</Button>
			</TableCell>
		</SimpleTableRow>
	);
}

export function CompanySheet({ companyId }: { companyId: string }) {
	const { locale, t } = useLanguage();
	const shortDateFormat = new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
	});
	const trpc = useTRPC();
	const {
		tab,
		setTab,
		form: adding,
		setForm: setAdding,
	} = useRecordSheetView("overview");

	const query = useQuery({
		...trpc.companies.byId.queryOptions({ id: companyId }),
		refetchInterval: (current) => {
			const record = current.state.data;
			return record && isEnriching(record.enrichmentStatus, record.queued)
				? ENRICHMENT_POLL_MS
				: false;
		},
	});

	const company = query.data;

	const location = company
		? [company.city, company.stateCode, company.country]
				.filter(Boolean)
				.join(", ")
		: null;

	const openDeals =
		company?.deals.filter((deal) => OPEN_STAGES.includes(deal.stage)) ?? [];
	const openValueByCurrency = [
		...openDeals.reduce((map, deal) => {
			const current = map.get(deal.currency) ?? 0;
			map.set(deal.currency, current + (deal.amountCents ?? 0));
			return map;
		}, new Map<string, number>()),
	]
		.map(([currency, valueCents]) => ({ currency, valueCents }))
		.filter((entry) => entry.valueCents !== 0)
		.sort((a, b) => a.currency.localeCompare(b.currency));
	const closing = nextClose(openDeals);

	const tabs: DetailSheetTab[] = company
		? [
				{
					value: "overview",
					label: t("detail.overview"),
					content: (
						<CompanyOverview
							company={company}
							onAddContact={() => {
								setAdding("contact");
								setTab("contacts");
							}}
						/>
					),
				},
				{
					value: "contacts",
					label: t("detail.contacts"),
					count: company.contacts.length,
					content: (
						<CompanyContacts
							company={company}
							adding={adding === "contact"}
							onAdd={() => setAdding("contact")}
							onDone={() => setAdding(null)}
						/>
					),
				},
				{
					value: "deals",
					label: t("detail.deals"),
					count: company.deals.length,
					content: (
						<CompanyDeals
							company={company}
							adding={adding === "deal"}
							onAdd={() => setAdding("deal")}
							onDone={() => setAdding(null)}
						/>
					),
				},
				{
					value: "activity",
					label: t("detail.activity"),
					content: <Timeline anchor={{ companyId: company.id }} />,
				},
				{
					value: "agent",
					label: t("detail.agent"),
					content: <AgentPanel record={{ kind: "company", id: company.id }} />,
					keepMounted: true,
				},
			]
		: [];

	return (
		<RecordSheetFrame
			loading={query.isPending}
			error={query.error?.message ?? null}
			title={company?.name ?? t("common.company")}
			description={
				company ? (
					<MetaLine
						lead={
							<DomainLink domain={company.domain} website={company.website} />
						}
						parts={[location, company.industry]}
					/>
				) : undefined
			}
			note={
				company && company.enrichmentStatus !== "COMPLETE" ? (
					<EnrichmentIndicator
						status={company.enrichmentStatus}
						queued={company.queued}
						title={company.enrichmentError}
					/>
				) : null
			}
			media={
				<EntityLogo
					src={company?.iconUrl ?? company?.logoUrl}
					darkSrc={company?.iconDarkUrl}
					tone={company?.iconTone as EntityLogoTone | null | undefined}
					name={company?.name ?? "?"}
					size="lg"
				/>
			}
			actions={
				company ? (
					<>
						<EnrichmentActions
							companyId={company.id}
							hasDomain={company.domain !== null}
						/>
						<RecordActions
							record={{ kind: "company", id: company.id }}
							name={company.name}
							consequence={companyConsequence(company, t)}
						/>
					</>
				) : null
			}
			stats={
				company ? (
					<DetailSheetStats>
						<DetailSheetStat label={t("detail.activeValue")}>
							<span className="tabular-nums">
								{openValueByCurrency.length === 0
									? formatMoney(0)
									: openValueByCurrency
											.map((entry) =>
												formatMoney(entry.valueCents, entry.currency),
											)
											.join(" + ")}
							</span>
						</DetailSheetStat>
						<DetailSheetStat label={t("detail.activeInquiries")}>
							<span className="tabular-nums">{openDeals.length}</span>
						</DetailSheetStat>
						<DetailSheetStat label={t("detail.expectedOrder")}>
							{closing ? (
								shortDateFormat.format(new Date(closing))
							) : (
								<EmptyCellValue />
							)}
						</DetailSheetStat>
						<DetailSheetStat label={t("common.owner")}>
							<OwnerCell owner={company.owner} />
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

function CompanyOverview({
	company,
	onAddContact,
}: {
	company: Company;
	onAddContact: () => void;
}) {
	const { locale, t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();
	const customerTypeOptions = [
		{ value: "LEAD", label: t("company.type.lead") },
		{ value: "BUYER", label: t("company.type.buyer") },
		{ value: "DISTRIBUTOR", label: t("company.type.distributor") },
		{ value: "AGENT", label: t("company.type.agent") },
		{ value: "CUSTOMER", label: t("company.type.customer") },
	];

	const users = useQuery(trpc.users.list.queryOptions());

	const update = useMutation(
		trpc.companies.update.mutationOptions({
			onSuccess: () => cache.company(company.id, { settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const save = (data: Record<string, string | null>) =>
		update.mutate({ id: company.id, data });

	const isSaving = savingField(update);

	return (
		<DetailSheetBody>
			<DetailSheetSplit>
				<DetailSheetMain>
					{company.description ? (
						<DetailSheetSection title={t("detail.about")}>
							<DetailSheetProse>{company.description}</DetailSheetProse>
						</DetailSheetSection>
					) : null}

					<DetailSheetSection title={t("detail.people")}>
						<CompanyContacts
							company={company}
							adding={false}
							onAdd={onAddContact}
							onDone={() => undefined}
						/>
					</DetailSheetSection>
				</DetailSheetMain>

				<DetailSheetRail>
					<DetailSheetSection title={t("detail.details")}>
						<DetailSheetProperties columns={1}>
							<InlineField
								label={t("company.name")}
								value={company.name}
								saving={isSaving("name")}
								onSave={(name) => name && save({ name })}
							/>
							<InlineField
								label={t("company.domain")}
								value={company.domain}
								type="url"
								placeholder="stripe.com"
								saving={isSaving("domain")}
								onSave={(domain) => save({ domain })}
							/>
							<InlineField
								label={t("company.website")}
								value={company.website}
								type="url"
								placeholder="https://buyer.example"
								saving={isSaving("website")}
								onSave={(website) => save({ website })}
							/>
							<InlineSelectField
								label={t("company.customerType")}
								value={company.customerType}
								options={customerTypeOptions}
								onSave={(customerType) => save({ customerType })}
							/>
							<InlineField
								label={t("company.leadSource")}
								value={company.leadSource}
								placeholder="Alibaba, trade show, referral"
								saving={isSaving("leadSource")}
								onSave={(leadSource) => save({ leadSource })}
							/>
							<InlineField
								label={t("company.productInterest")}
								value={company.productInterest}
								placeholder="Product or category"
								saving={isSaving("productInterest")}
								onSave={(productInterest) => save({ productInterest })}
							/>
							<InlineField
								label={t("company.targetMarkets")}
								value={company.targetMarkets}
								placeholder="Markets they sell into"
								saving={isSaving("targetMarkets")}
								onSave={(targetMarkets) => save({ targetMarkets })}
							/>
							<InlineField
								label={t("common.phone")}
								value={company.phone}
								type="tel"
								saving={isSaving("phone")}
								onSave={(phone) => save({ phone })}
							/>
							<InlineField
								label={t("common.email")}
								value={company.email}
								type="email"
								saving={isSaving("email")}
								onSave={(email) => save({ email })}
							/>
							<InlineField
								label={t("company.city")}
								value={company.city}
								saving={isSaving("city")}
								onSave={(city) => save({ city })}
							/>
							<InlineField
								label={t("company.country")}
								value={company.country}
								saving={isSaving("country")}
								onSave={(country) => save({ country })}
							/>
							<InlineSelectField
								label={t("company.timezone")}
								value={company.timezone ?? UNASSIGNED}
								options={[
									{ value: UNASSIGNED, label: t("common.unassigned") },
									...timezoneOptions(),
								]}
								onSave={(timezone) =>
									save({
										timezone: timezone === UNASSIGNED ? null : timezone,
									})
								}
							/>
							{company.timezone ? (
								<DetailSheetProperty label={t("company.localTime")}>
									<span className="tabular-nums">
										{buyerLocalTime(company.timezone, locale)}
									</span>
								</DetailSheetProperty>
							) : null}
							<InlineSelectField
								label={t("common.owner")}
								value={company.owner?.id ?? UNASSIGNED}
								options={[
									{ value: UNASSIGNED, label: t("common.unassigned") },
									...(users.data ?? []).map((user) => ({
										value: user.id,
										label: user.name,
									})),
								]}
								onSave={(ownerId) =>
									save({ ownerId: ownerId === UNASSIGNED ? null : ownerId })
								}
							/>
						</DetailSheetProperties>
					</DetailSheetSection>

					<DetailSheetPending
						fields={pendingFields(company).map((key) => t(key))}
						running={isEnriching(company.enrichmentStatus, company.queued)}
					/>

					{hasCompanyLinks(company) ? (
						<DetailSheetSection title={t("detail.links")}>
							<CompanySocials company={company} />
						</DetailSheetSection>
					) : null}
				</DetailSheetRail>
			</DetailSheetSplit>
		</DetailSheetBody>
	);
}

function CompanyContacts({
	company,
	adding,
	onAdd,
	onDone,
}: {
	company: Company;
	adding: boolean;
	onAdd: () => void;
	onDone: () => void;
}) {
	const { t } = useLanguage();
	const contactColumns = [
		{ srLabel: t("contact.primary"), width: "w-10", className: "pl-5" },
		{ header: t("contact.name"), width: "w-[28%]" },
		{ header: t("contact.titleField"), width: "w-[24%]" },
		{ header: t("contact.email"), width: "w-[26%]" },
		{ header: t("contact.owner"), width: "w-[22%]" },
	];
	const trpc = useTRPC();
	const cache = useCrmCache();
	const openRecord = useOpenRecord();

	const setPrimary = useMutation(
		trpc.companies.setPrimaryContact.mutationOptions({
			onSuccess: () => cache.company(company.id),
			onError: (error) => toast.error(error.message),
		}),
	);

	const form = adding ? (
		<QuickAddContact
			companyId={company.id}
			ownerId={company.owner?.id ?? null}
			onDone={onDone}
		/>
	) : null;

	if (company.contacts.length === 0) {
		return (
			<>
				{form}
				{adding ? null : (
					<DetailSheetEmpty
						icon={UserMultiple}
						title={t("detail.noContacts")}
						description={t("company.noContactsDescription", {
							name: company.name,
						})}
						action={
							<Button variant="outline" size="sm" onClick={onAdd}>
								<Icon icon={Add} data-icon="inline-start" />
								{t("contact.add")}
							</Button>
						}
					/>
				)}
			</>
		);
	}

	return (
		<>
			{form}
			<SimpleTable variant="panel" columns={contactColumns}>
				{company.contacts.map((contact) => {
					const isPrimary = contact.id === company.primaryContactId;
					return (
						<SimpleTableRow
							key={contact.id}
							clickable
							onClick={() => openRecord({ kind: "contact", id: contact.id })}
						>
							<TableCell className="w-10 py-2.5 pl-5">
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon-xs"
											aria-pressed={isPrimary}
											disabled={isPrimary || setPrimary.isPending}
											onClick={(event) => {
												event.stopPropagation();
												setPrimary.mutate({
													companyId: company.id,
													contactId: contact.id,
												});
											}}
										>
											<Icon icon={isPrimary ? StarFilled : Star} />
											<span className="sr-only">
												{isPrimary
													? t("contact.primary")
													: t("contact.makePrimary")}
											</span>
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										{isPrimary
											? t("contact.primary")
											: t("contact.makePrimary")}
									</TooltipContent>
								</Tooltip>
							</TableCell>
							<TableCell className="truncate px-3 py-2.5 font-medium">
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
								{contact.title ?? <EmptyCellValue />}
							</TableCell>
							<TableCell className="truncate px-3 py-2.5 text-muted-foreground">
								{contact.email ?? <EmptyCellValue />}
							</TableCell>
							<TableCell className="px-3 py-2.5">
								<OwnerCell owner={contact.owner} />
							</TableCell>
						</SimpleTableRow>
					);
				})}

				<AddRow
					label={t("contact.add")}
					columns={contactColumns.length}
					onClick={onAdd}
				/>
			</SimpleTable>
		</>
	);
}

function CompanyDeals({
	company,
	adding,
	onAdd,
	onDone,
}: {
	company: Company;
	adding: boolean;
	onAdd: () => void;
	onDone: () => void;
}) {
	const { locale, t } = useLanguage();
	const dateFormat = new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	const dealColumns = [
		{ header: t("deal.inquiry"), width: "w-[32%]", className: "pl-5" },
		{ header: t("deal.stage"), width: "w-[24%]" },
		{
			header: t("deal.amount"),
			width: "w-[16%]",
			align: "right" as const,
		},
		{ header: t("deal.closeDate"), width: "w-[14%]" },
		{ header: t("deal.owner"), width: "w-[14%]" },
	];
	const openRecord = useOpenRecord();

	const form = adding ? (
		<QuickAddDeal
			companyId={company.id}
			companyName={company.name}
			ownerId={company.owner?.id ?? null}
			onDone={onDone}
		/>
	) : null;

	if (company.deals.length === 0) {
		return (
			<>
				{form}
				{adding ? null : (
					<DetailSheetEmpty
						icon={Partnership}
						title={t("detail.noInquiries")}
						description={t("company.noInquiriesDescription", {
							name: company.name,
						})}
						action={
							<Button variant="outline" size="sm" onClick={onAdd}>
								<Icon icon={Add} data-icon="inline-start" />
								{t("deal.new")}
							</Button>
						}
					/>
				)}
			</>
		);
	}

	return (
		<>
			{form}
			<SimpleTable variant="panel" columns={dealColumns}>
				{company.deals.map((deal) => (
					<SimpleTableRow
						key={deal.id}
						clickable
						onClick={() => openRecord({ kind: "deal", id: deal.id })}
					>
						<TableCell className="truncate py-2.5 pr-3 pl-5 font-medium">
							{deal.name}
						</TableCell>
						<TableCell className="px-3 py-2.5">
							<DealStageMenu dealId={deal.id} stage={deal.stage} />
						</TableCell>
						<TableCell className="px-3 py-2.5 text-right">
							<DealAmount
								amountCents={deal.amountCents}
								currency={deal.currency}
							/>
						</TableCell>
						<TableCell className="px-3 py-2.5 text-muted-foreground">
							{deal.expectedOrderDate ? (
								dateFormat.format(new Date(deal.expectedOrderDate))
							) : (
								<EmptyCellValue />
							)}
						</TableCell>
						<TableCell className="px-3 py-2.5">
							<OwnerCell owner={deal.owner} />
						</TableCell>
					</SimpleTableRow>
				))}

				<AddRow
					label={t("deal.new")}
					columns={dealColumns.length}
					onClick={onAdd}
				/>
			</SimpleTable>
		</>
	);
}
