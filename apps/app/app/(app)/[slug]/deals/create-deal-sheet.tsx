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
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useId, useState } from "react";
import { toast } from "sonner";
import { dealStageLabel, OPEN_STAGES } from "@/components/crm/deal-stage";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { LocalizedDatePicker as DatePicker } from "@/components/localized-date-picker";
import { useLanguage } from "@/lib/i18n";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const UNSET = "";

export function CreateDealSheet({ companyId }: { companyId?: string }) {
	const { language, t } = useLanguage();
	const openRecord = useOpenRecord();
	const trpc = useTRPC();
	const cache = useCrmCache();

	const [open, setOpen] = useQueryState(
		"new",
		parseAsBoolean.withDefault(false),
	);
	const [name, setName] = useState("");
	const [company, setCompany] = useState(companyId ?? UNSET);
	const [ownerId, setOwnerId] = useState(UNSET);
	const [stage, setStage] = useState<string>("NEW_INQUIRY");
	const [amount, setAmount] = useState("");
	const [expectedOrderDate, setExpectedOrderDate] = useState("");
	const [productSummary, setProductSummary] = useState("");
	const [quantity, setQuantity] = useState("");
	const [destinationPort, setDestinationPort] = useState("");

	const nameId = useId();
	const amountId = useId();
	const expectedOrderDateId = useId();
	const productId = useId();
	const quantityId = useId();
	const destinationId = useId();

	const users = useQuery(trpc.users.list.queryOptions());
	const companies = useQuery(trpc.companies.options.queryOptions({ q: "" }));
	const me = useQuery(trpc.users.me.queryOptions());

	const resolvedOwner = ownerId || me.data?.id || UNSET;

	const create = useMutation(
		trpc.deals.create.mutationOptions({
			onSuccess: async (deal) => {
				await cache.deal(deal.id);
				toast.success(t("common.added", { name: deal.name }));
				await setOpen(null);
				setName("");
				setAmount("");
				setExpectedOrderDate("");
				setProductSummary("");
				setQuantity("");
				setDestinationPort("");
				openRecord({ kind: "deal", id: deal.id });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const ready =
		name.trim() !== "" && company !== UNSET && resolvedOwner !== UNSET;

	return (
		<Sheet open={open} onOpenChange={(next) => setOpen(next || null)}>
			<SheetTrigger asChild>
				<Button>
					<Icon icon={Add} data-icon="inline-start" />
					{t("deal.new")}
				</Button>
			</SheetTrigger>
			<SheetContent side="right" closeLabel={t("common.close")}>
				<SheetHeader>
					<SheetTitle>{t("deal.new")}</SheetTitle>
					<SheetDescription>{t("deal.description")}</SheetDescription>
				</SheetHeader>

				<form
					id="create-deal"
					className="flex-1 overflow-y-auto px-4"
					onSubmit={(event) => {
						event.preventDefault();
						const parsed = Number.parseFloat(amount);
						create.mutate({
							name,
							companyId: company,
							ownerId: resolvedOwner,
							stage: stage as never,
							amountCents: Number.isFinite(parsed)
								? Math.round(parsed * 100)
								: null,
							expectedOrderDate: expectedOrderDate || null,
							productSummary: productSummary || null,
							quantity: quantity || null,
							destinationPort: destinationPort || null,
						});
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={nameId}>{t("deal.inquiryName")}</FieldLabel>
							<Input
								id={nameId}
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Acme Imports — packaging inquiry"
								autoComplete="off"
								required
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-deal-company">
								{t("deal.customer")}
							</FieldLabel>
							<Select value={company} onValueChange={setCompany}>
								<SelectTrigger id="create-deal-company">
									<SelectValue placeholder={t("deal.chooseCustomer")} />
								</SelectTrigger>
								<SelectContent>
									{(companies.data ?? []).map((option) => (
										<SelectItem key={option.id} value={option.id}>
											{option.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-deal-owner">
								{t("deal.owner")}
							</FieldLabel>
							<Select value={resolvedOwner} onValueChange={setOwnerId}>
								<SelectTrigger id="create-deal-owner">
									<SelectValue placeholder={t("deal.chooseOwner")} />
								</SelectTrigger>
								<SelectContent>
									{(users.data ?? []).map((user) => (
										<SelectItem key={user.id} value={user.id}>
											{user.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-deal-stage">
								{t("deal.stage")}
							</FieldLabel>
							<Select value={stage} onValueChange={setStage}>
								<SelectTrigger id="create-deal-stage">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{OPEN_STAGES.map((value) => (
										<SelectItem key={value} value={value}>
											{dealStageLabel(value, language)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FieldDescription>{t("deal.stageDescription")}</FieldDescription>
						</Field>

						<Field>
							<FieldLabel htmlFor={amountId}>
								{t("deal.estimatedAmount")}
							</FieldLabel>
							<Input
								id={amountId}
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
								placeholder="24000"
								inputMode="decimal"
								autoComplete="off"
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor={productId}>
								{t("company.productInterest")}
							</FieldLabel>
							<Input
								id={productId}
								value={productSummary}
								onChange={(event) => setProductSummary(event.target.value)}
								placeholder={t("deal.productPlaceholder")}
								autoComplete="off"
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor={quantityId}>{t("deal.quantity")}</FieldLabel>
							<Input
								id={quantityId}
								value={quantity}
								onChange={(event) => setQuantity(event.target.value)}
								placeholder={t("deal.quantityPlaceholder")}
								autoComplete="off"
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor={destinationId}>
								{t("deal.destination")}
							</FieldLabel>
							<Input
								id={destinationId}
								value={destinationPort}
								onChange={(event) => setDestinationPort(event.target.value)}
								placeholder={t("deal.destinationPlaceholder")}
								autoComplete="off"
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor={expectedOrderDateId}>
								{t("deal.expectedOrderDate")}
							</FieldLabel>
							<DatePicker
								id={expectedOrderDateId}
								value={expectedOrderDate}
								onChange={setExpectedOrderDate}
								placeholder={t("deal.noDate")}
							/>
						</Field>
					</FieldGroup>
				</form>

				<SheetFooter>
					<Button
						type="submit"
						form="create-deal"
						disabled={create.isPending || !ready}
					>
						{create.isPending ? <Spinner /> : null}
						{t("deal.add")}
					</Button>
					<SheetClose asChild>
						<Button variant="outline">{t("common.cancel")}</Button>
					</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
