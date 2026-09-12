"use client";

import Add from "@carbon/icons-react/es/Add";
import { Button } from "@crm/ui/components/button";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { LocalizedDatePicker } from "@/components/localized-date-picker";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

const ORDER_STATUSES = [
	{ value: "DRAFT", key: "order.status.draft" },
	{ value: "CONFIRMED", key: "order.status.confirmed" },
	{ value: "IN_PRODUCTION", key: "order.status.inProduction" },
	{ value: "READY_TO_SHIP", key: "order.status.readyToShip" },
	{ value: "SHIPPED", key: "order.status.shipped" },
	{ value: "DELIVERED", key: "order.status.delivered" },
	{ value: "COMPLETED", key: "order.status.completed" },
	{ value: "CANCELLED", key: "order.status.cancelled" },
] as const satisfies readonly { value: string; key: TranslationKey }[];

const PAYMENT_KINDS = [
	{ value: "DEPOSIT", key: "order.kind.deposit" },
	{ value: "BALANCE", key: "order.kind.balance" },
	{ value: "INSTALLMENT", key: "order.kind.installment" },
] as const satisfies readonly { value: string; key: TranslationKey }[];

type Order = RouterOutputs["deals"]["orders"][number];
type Payment = Order["payments"][number];

type DraftOrderItem = {
	id: string;
	description: string;
	quantity: string;
	unitPrice: string;
};

function blankOrderItem(): DraftOrderItem {
	return {
		id: crypto.randomUUID(),
		description: "",
		quantity: "",
		unitPrice: "",
	};
}

function isOverdue(payment: Payment): boolean {
	if (payment.receivedAt !== null || payment.expectedAt === null) return false;
	return new Date(payment.expectedAt).getTime() < Date.now();
}

function kindLabel(
	kind: Payment["kind"],
	t: (key: TranslationKey) => string,
): string {
	const found = PAYMENT_KINDS.find((entry) => entry.value === kind);
	return found ? t(found.key) : kind;
}

export function OrdersPanel({ dealId }: { dealId: string }) {
	const { t } = useLanguage();
	const orderColumns = [
		{ header: t("order.order") },
		{ header: t("common.status"), width: "9rem" },
		{ header: t("order.total") },
		{ header: t("order.payments") },
		{ header: "", width: "5rem" },
	];
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [adding, setAdding] = useState(false);
	const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
	const [currency, setCurrency] = useState("USD");
	const [incoterm, setIncoterm] = useState("");
	const [paymentTerms, setPaymentTerms] = useState("");
	const [notes, setNotes] = useState("");
	const [items, setItems] = useState<DraftOrderItem[]>(() => [
		blankOrderItem(),
	]);

	const orders = useQuery(trpc.deals.orders.queryOptions({ id: dealId }));

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: trpc.deals.orders.pathKey() });

	const create = useMutation(
		trpc.deals.createOrder.mutationOptions({
			onSuccess: () => {
				toast.success(t("order.created"));
				setAdding(false);
				setCurrency("USD");
				setIncoterm("");
				setPaymentTerms("");
				setNotes("");
				setItems([blankOrderItem()]);
				void invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const update = useMutation(
		trpc.deals.updateOrder.mutationOptions({
			onSuccess: () => {
				toast.success(t("order.updated"));
				void invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const remove = useMutation(
		trpc.deals.deleteOrder.mutationOptions({
			onSuccess: () => {
				toast.success(t("order.removed"));
				void invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const rows = orders.data ?? [];
	const expandedOrder = rows.find((row) => row.id === expandedOrderId) ?? null;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<h3 className="font-medium text-sm">{t("order.title")}</h3>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => setAdding((value) => !value)}
				>
					<Icon icon={Add} data-icon="inline-start" />
					{t("order.new")}
				</Button>
			</div>

			{adding ? (
				<div className="rounded-md border p-3">
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="order-currency">
								{t("deal.currency")}
							</FieldLabel>
							<Input
								id="order-currency"
								value={currency}
								onChange={(event) => setCurrency(event.target.value)}
								placeholder="USD"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="order-incoterm">
								{t("deal.incoterm")}
							</FieldLabel>
							<Input
								id="order-incoterm"
								value={incoterm}
								onChange={(event) => setIncoterm(event.target.value)}
								placeholder="FOB / CIF"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="order-payment">
								{t("deal.paymentTerms")}
							</FieldLabel>
							<Input
								id="order-payment"
								value={paymentTerms}
								onChange={(event) => setPaymentTerms(event.target.value)}
								placeholder="30% deposit, 70% before shipping"
							/>
						</Field>
					</FieldGroup>

					<p className="mt-3 font-medium text-sm">{t("order.lineItems")}</p>
					<div className="mt-2 flex flex-col gap-2">
						{items.map((item, index) => (
							<div key={item.id} className="flex gap-2">
								<Input
									placeholder={t("order.description")}
									value={item.description}
									onChange={(event) => {
										const next = [...items];
										const current = next[index];
										if (current)
											next[index] = {
												...current,
												description: event.target.value,
											};
										setItems(next);
									}}
								/>
								<Input
									placeholder={t("sample.qty")}
									type="number"
									className="w-24"
									value={item.quantity}
									onChange={(event) => {
										const next = [...items];
										const current = next[index];
										if (current)
											next[index] = {
												...current,
												quantity: event.target.value,
											};
										setItems(next);
									}}
								/>
								<Input
									placeholder={t("order.unitPrice")}
									type="number"
									className="w-28"
									value={item.unitPrice}
									onChange={(event) => {
										const next = [...items];
										const current = next[index];
										if (current)
											next[index] = {
												...current,
												unitPrice: event.target.value,
											};
										setItems(next);
									}}
								/>
							</div>
						))}
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => setItems([...items, blankOrderItem()])}
						>
							+ {t("order.addLine")}
						</Button>
					</div>

					<Field className="mt-3">
						<FieldLabel htmlFor="order-notes">{t("order.notes")}</FieldLabel>
						<Textarea
							id="order-notes"
							value={notes}
							onChange={(event) => setNotes(event.target.value)}
							rows={3}
						/>
					</Field>

					<div className="mt-3 flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							disabled={create.isPending}
							onClick={() => {
								const parsedItems = items
									.filter(
										(item) =>
											item.description.trim() &&
											Number(item.quantity) > 0 &&
											Number(item.unitPrice) >= 0,
									)
									.map((item) => ({
										description: item.description,
										quantity: Number(item.quantity),
										unitPrice: Number(item.unitPrice),
									}));
								if (parsedItems.length === 0) {
									toast.error(t("order.lineRequired"));
									return;
								}
								create.mutate({
									dealId,
									currency,
									incoterm: incoterm || null,
									paymentTerms: paymentTerms || null,
									notes: notes || null,
									items: parsedItems,
								});
							}}
						>
							{create.isPending ? <Spinner data-icon="inline-start" /> : null}
							{t("order.create")}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => setAdding(false)}
						>
							{t("common.cancel")}
						</Button>
					</div>
				</div>
			) : null}

			{orders.isPending ? (
				<p className="text-muted-foreground text-sm">{t("order.loading")}</p>
			) : rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">{t("order.empty")}</p>
			) : (
				<SimpleTable columns={orderColumns}>
					{rows.map((order) => {
						const overdueCount = order.payments.filter(isOverdue).length;
						return (
							<SimpleTableRow key={order.id}>
								<TableCell className="font-medium">
									{order.orderNumber}
								</TableCell>
								<TableCell>
									<Select
										value={order.status}
										onValueChange={(value) =>
											update.mutate({
												id: order.id,
												data: { status: value as never },
											})
										}
									>
										<SelectTrigger className="h-7 w-32 text-xs">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{ORDER_STATUSES.map((item) => (
												<SelectItem key={item.value} value={item.value}>
													{t(item.key)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TableCell>
								<TableCell className="font-medium">
									{formatMoney(order.totalCents, order.currency)}
								</TableCell>
								<TableCell>
									<button
										type="button"
										className="text-left text-xs underline-offset-2 hover:underline"
										onClick={() =>
											setExpandedOrderId((current) =>
												current === order.id ? null : order.id,
											)
										}
									>
										<span className="block">
											{t("order.receivedSummary", {
												received: formatMoney(
													order.receivedCents,
													order.currency,
												),
												outstanding: formatMoney(
													Math.max(order.totalCents - order.receivedCents, 0),
													order.currency,
												),
											})}
										</span>
										{overdueCount > 0 ? (
											<span className="block text-destructive">
												{t("order.overdueCount", { count: overdueCount })}
											</span>
										) : null}
									</button>
								</TableCell>
								<TableCell>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => remove.mutate({ id: order.id })}
									>
										{t("sample.remove")}
									</Button>
								</TableCell>
							</SimpleTableRow>
						);
					})}
				</SimpleTable>
			)}

			{expandedOrder ? (
				<OrderPayments
					key={expandedOrder.id}
					order={expandedOrder}
					onChanged={() => void invalidate()}
				/>
			) : null}
		</div>
	);
}

function OrderPayments({
	order,
	onChanged,
}: {
	order: Order;
	onChanged: () => void;
}) {
	const { t } = useLanguage();
	const trpc = useTRPC();
	const [kind, setKind] = useState<string>("DEPOSIT");
	const [amount, setAmount] = useState("");
	const [expectedAt, setExpectedAt] = useState<string | null>(null);
	const [reference, setReference] = useState("");

	const create = useMutation(
		trpc.deals.createPayment.mutationOptions({
			onSuccess: () => {
				toast.success(t("order.paymentCreated"));
				setAmount("");
				setExpectedAt(null);
				setReference("");
				onChanged();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const update = useMutation(
		trpc.deals.updatePayment.mutationOptions({
			onSuccess: () => {
				toast.success(t("order.paymentUpdated"));
				onChanged();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const remove = useMutation(
		trpc.deals.deletePayment.mutationOptions({
			onSuccess: () => {
				toast.success(t("order.paymentRemoved"));
				onChanged();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="rounded-md border p-3">
			<p className="font-medium text-sm">
				{order.orderNumber} · {t("order.payments")}
			</p>

			{order.payments.length === 0 ? (
				<p className="mt-2 text-muted-foreground text-sm">
					{t("order.noPayments")}
				</p>
			) : (
				<ul className="mt-2 flex flex-col">
					{order.payments.map((payment) => {
						const overdue = isOverdue(payment);
						return (
							<li
								key={payment.id}
								className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2 first:border-t-0"
							>
								<span className="text-sm">{kindLabel(payment.kind, t)}</span>
								<span className="font-medium text-sm tabular-nums">
									{formatMoney(payment.amountCents, order.currency)}
								</span>
								{payment.expectedAt ? (
									<span
										className={
											overdue
												? "text-destructive text-xs"
												: "text-muted-foreground text-xs"
										}
									>
										{t("order.expectedAt")}{" "}
										{new Date(payment.expectedAt).toLocaleDateString()}
										{overdue ? ` · ${t("order.receivedOverdue")}` : ""}
									</span>
								) : null}
								{payment.receivedAt ? (
									<span className="text-muted-foreground text-xs">
										{t("order.receivedAt")}{" "}
										{new Date(payment.receivedAt).toLocaleDateString()}
									</span>
								) : null}
								{payment.reference ? (
									<span className="text-muted-foreground text-xs">
										{payment.reference}
									</span>
								) : null}
								<span className="ml-auto flex items-center gap-1">
									{payment.receivedAt === null ? (
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={update.isPending}
											onClick={() =>
												update.mutate({
													id: payment.id,
													data: {
														receivedAt: new Date().toISOString(),
													},
												})
											}
										>
											{t("order.markReceived")}
										</Button>
									) : null}
									<Button
										type="button"
										size="sm"
										variant="ghost"
										disabled={remove.isPending}
										onClick={() => remove.mutate({ id: payment.id })}
									>
										{t("sample.remove")}
									</Button>
								</span>
							</li>
						);
					})}
				</ul>
			)}

			<div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
				<Field className="w-32">
					<FieldLabel>{t("order.paymentKind")}</FieldLabel>
					<Select value={kind} onValueChange={setKind}>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAYMENT_KINDS.map((entry) => (
								<SelectItem key={entry.value} value={entry.value}>
									{t(entry.key)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				<Field className="w-32">
					<FieldLabel>{t("order.amount")}</FieldLabel>
					<Input
						type="number"
						value={amount}
						onChange={(event) => setAmount(event.target.value)}
						placeholder="0.00"
					/>
				</Field>
				<Field className="w-40">
					<FieldLabel>{t("order.expectedAt")}</FieldLabel>
					<LocalizedDatePicker value={expectedAt} onChange={setExpectedAt} />
				</Field>
				<Field className="w-40">
					<FieldLabel>{t("order.reference")}</FieldLabel>
					<Input
						value={reference}
						onChange={(event) => setReference(event.target.value)}
					/>
				</Field>
				<Button
					type="button"
					size="sm"
					disabled={create.isPending}
					onClick={() => {
						const amountCents = Math.round(Number(amount) * 100);
						if (!Number.isFinite(amountCents) || amountCents <= 0) {
							toast.error(t("order.amountRequired"));
							return;
						}
						create.mutate({
							orderId: order.id,
							kind: kind as "DEPOSIT" | "BALANCE" | "INSTALLMENT",
							amountCents,
							expectedAt,
							reference: reference || null,
						});
					}}
				>
					{create.isPending ? <Spinner data-icon="inline-start" /> : null}
					{t("order.addPayment")}
				</Button>
			</div>
		</div>
	);
}
