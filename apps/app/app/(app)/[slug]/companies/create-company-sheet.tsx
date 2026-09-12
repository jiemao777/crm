"use client";

import Add from "@carbon/icons-react/es/Add";
import { Button } from "@crm/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@crm/ui/components/sheet";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useLanguage } from "@/lib/i18n";
import { parseLeadText } from "@/lib/parse-lead";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const UNASSIGNED = "unassigned";

export function CreateCompanySheet() {
	const { t } = useLanguage();
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const cache = useCrmCache();

	const [open, setOpen] = useQueryState(
		"new",
		parseAsBoolean.withDefault(false),
	);
	const [name, setName] = useState("");
	const [domain, setDomain] = useState("");
	const [pasteText, setPasteText] = useState("");
	const [uncertain, setUncertain] = useState<string[]>([]);
	const [contactName, setContactName] = useState("");
	const [contactEmail, setContactEmail] = useState("");
	const [contactPhone, setContactPhone] = useState("");
	const [ownerId, setOwnerId] = useState(UNASSIGNED);
	const [customerType, setCustomerType] = useState("LEAD");
	const [leadSource, setLeadSource] = useState("");
	const [productInterest, setProductInterest] = useState("");
	const customerTypes = [
		{ value: "LEAD", label: t("company.type.lead") },
		{ value: "BUYER", label: t("company.type.buyer") },
		{ value: "DISTRIBUTOR", label: t("company.type.distributor") },
		{ value: "AGENT", label: t("company.type.agent") },
		{ value: "CUSTOMER", label: t("company.type.customer") },
	] as const;

	const nameId = useId();
	const domainId = useId();

	const users = useQuery(trpc.users.list.queryOptions());

	const create = useMutation(
		trpc.companies.create.mutationOptions({
			onSuccess: async (company) => {
				await cache.company(company.id);
				toast.success(`${company.name} added.`);
				await setOpen(null);
				setName("");
				setDomain("");
				setOwnerId(UNASSIGNED);
				setCustomerType("LEAD");
				setLeadSource("");
				setProductInterest("");
				setContactName("");
				setContactEmail("");
				setContactPhone("");
				setPasteText("");
				setUncertain([]);
				openRecord({ kind: "company", id: company.id });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	function fillFromLocalParse() {
		const parsed = parseLeadText(pasteText);
		if (parsed.name) setName(parsed.name);
		if (parsed.domain) setDomain(parsed.domain);
		if (parsed.personName) setName(parsed.name || parsed.personName);
		if (parsed.personName) setContactName(parsed.personName);
		if (parsed.email) setContactEmail(parsed.email);
		if (parsed.phone) setContactPhone(parsed.phone);
		if (parsed.leadSource) setLeadSource(parsed.leadSource);
		if (parsed.productInterest) setProductInterest(parsed.productInterest);
		return parsed;
	}

	const aiFill = useMutation(
		trpc.companies.aiExtract.mutationOptions({
			onSuccess: (parsed) => {
				if (!parsed) {
					fillFromLocalParse();
					toast.info(t("company.aiUnavailable"));
					return;
				}
				setUncertain(parsed.uncertain ?? []);
				if (parsed.name) setName(parsed.name);
				if (parsed.domain) setDomain(parsed.domain);
				if (parsed.personName) {
					setName(parsed.name || parsed.personName);
					setContactName(parsed.personName);
				}
				if (parsed.email) setContactEmail(parsed.email);
				if (parsed.phone) setContactPhone(parsed.phone);
				if (parsed.leadSource) setLeadSource(parsed.leadSource);
				if (parsed.productInterest) setProductInterest(parsed.productInterest);
				toast.success(t("company.aiParsed"));
			},
			onError: () => {
				fillFromLocalParse();
				toast.info(t("company.aiUnavailable"));
			},
		}),
	);

	return (
		<Sheet open={open} onOpenChange={(next) => setOpen(next || null)}>
			<SheetTrigger asChild>
				<Button>
					<Icon icon={Add} data-icon="inline-start" />
					{t("company.new")}
				</Button>
			</SheetTrigger>
			<SheetContent side="right" closeLabel={t("common.close")}>
				<SheetHeader>
					<SheetTitle>{t("company.new")}</SheetTitle>
					<SheetDescription>{t("company.description")}</SheetDescription>
				</SheetHeader>

				<form
					id="create-company"
					className="flex-1 overflow-y-auto px-4"
					onSubmit={(event) => {
						event.preventDefault();
						const [firstName, ...lastParts] = contactName.trim().split(/\s+/);
						create.mutate({
							name,
							domain: domain || undefined,
							ownerId: ownerId === UNASSIGNED ? null : ownerId,
							customerType: customerType as never,
							leadSource: leadSource || null,
							productInterest: productInterest || null,
							...(contactName.trim()
								? {
										contact: {
											firstName: firstName || "Contact",
											...(lastParts.length
												? { lastName: lastParts.join(" ") }
												: {}),
											...(contactEmail.trim()
												? { email: contactEmail.trim() }
												: {}),
											...(contactPhone.trim()
												? { phone: contactPhone.trim() }
												: {}),
										},
									}
								: {}),
						});
					}}
				>
					<div className="mb-4 rounded-md border bg-muted/40 p-3">
						<FieldLabel htmlFor="create-company-paste">
							{t("company.pasteInfo")}
						</FieldLabel>
						<Textarea
							id="create-company-paste"
							value={pasteText}
							onChange={(event) => setPasteText(event.target.value)}
							rows={4}
							placeholder={t("company.pastePlaceholder")}
						/>
						<Button
							type="button"
							size="sm"
							variant="outline"
							className="mt-2"
							disabled={pasteText.trim() === "" || aiFill.isPending}
							onClick={() => {
								aiFill.mutate({ text: pasteText });
							}}
						>
							{aiFill.isPending ? t("common.loading") : t("company.fillWithAI")}
						</Button>
					</div>

					<FieldGroup>
						<Field data-uncertain={uncertain.includes("name") || undefined}>
							<FieldLabel htmlFor={nameId}>
								{t("company.name")}
								{uncertain.includes("name") ? (
									<span className="ml-1 font-normal text-amber-600">
										· {t("company.uncertain")}
									</span>
								) : null}
							</FieldLabel>
							<Input
								id={nameId}
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Acme Imports"
								autoComplete="off"
								required
								className={
									uncertain.includes("name")
										? "border-amber-400 ring-amber-400/30 focus-visible:border-amber-400 focus-visible:ring-amber-400/40"
										: undefined
								}
							/>
						</Field>

						<Field data-uncertain={uncertain.includes("domain") || undefined}>
							<FieldLabel htmlFor={domainId}>
								{t("company.domain")}
								{uncertain.includes("domain") ? (
									<span className="ml-1 font-normal text-amber-600">
										· {t("company.uncertain")}
									</span>
								) : null}
							</FieldLabel>
							<Input
								id={domainId}
								value={domain}
								onChange={(event) => setDomain(event.target.value)}
								placeholder="stripe.com"
								autoComplete="off"
								inputMode="url"
								className={
									uncertain.includes("domain")
										? "border-amber-400 ring-amber-400/30 focus-visible:border-amber-400 focus-visible:ring-amber-400/40"
										: undefined
								}
							/>
							<FieldDescription>
								{t("company.domainDescription")}
							</FieldDescription>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-company-type">
								{t("company.customerType")}
							</FieldLabel>
							<Select value={customerType} onValueChange={setCustomerType}>
								<SelectTrigger id="create-company-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{customerTypes.map((type) => (
										<SelectItem key={type.value} value={type.value}>
											{type.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-company-source">
								{t("company.leadSource")}
							</FieldLabel>
							<Input
								id="create-company-source"
								value={leadSource}
								onChange={(event) => setLeadSource(event.target.value)}
								placeholder="Alibaba, trade show, referral"
							/>
						</Field>

						<Field
							data-uncertain={
								uncertain.includes("productInterest") || undefined
							}
						>
							<FieldLabel htmlFor="create-company-product">
								{t("company.productInterest")}
								{uncertain.includes("productInterest") ? (
									<span className="ml-1 font-normal text-amber-600">
										· {t("company.uncertain")}
									</span>
								) : null}
							</FieldLabel>
							<Input
								id="create-company-product"
								value={productInterest}
								onChange={(event) => setProductInterest(event.target.value)}
								placeholder={t("deal.productPlaceholder")}
								className={
									uncertain.includes("productInterest")
										? "border-amber-400 ring-amber-400/30 focus-visible:border-amber-400 focus-visible:ring-amber-400/40"
										: undefined
								}
							/>
						</Field>

						<div className="border-t pt-3">
							<p className="text-muted-foreground mb-2 text-xs">
								{t("company.contactSection")}
							</p>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="create-company-contact-name">
										{t("contact.name")}
									</FieldLabel>
									<Input
										id="create-company-contact-name"
										value={contactName}
										onChange={(event) => setContactName(event.target.value)}
										placeholder="First Last"
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="create-company-contact-email">
										{t("contact.email")}
									</FieldLabel>
									<Input
										id="create-company-contact-email"
										type="email"
										value={contactEmail}
										onChange={(event) => setContactEmail(event.target.value)}
										placeholder="buyer@company.com"
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="create-company-contact-phone">
										{t("contact.phone")}
									</FieldLabel>
									<Input
										id="create-company-contact-phone"
										value={contactPhone}
										onChange={(event) => setContactPhone(event.target.value)}
										placeholder="+1 555 123 4567"
									/>
								</Field>
							</FieldGroup>
						</div>

						<Field>
							<FieldLabel htmlFor="create-company-owner">
								{t("company.owner")}
							</FieldLabel>
							<Select value={ownerId} onValueChange={setOwnerId}>
								<SelectTrigger id="create-company-owner">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={UNASSIGNED}>
										{t("common.unassigned")}
									</SelectItem>
									{(users.data ?? []).map((user) => (
										<SelectItem key={user.id} value={user.id}>
											{user.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</FieldGroup>
				</form>

				<SheetFooter>
					<Button
						type="submit"
						form="create-company"
						disabled={create.isPending || name.trim() === ""}
					>
						{create.isPending ? <Spinner /> : null}
						{t("company.addCustomer")}
					</Button>
					<SheetClose asChild>
						<Button variant="outline">{t("common.cancel")}</Button>
					</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
