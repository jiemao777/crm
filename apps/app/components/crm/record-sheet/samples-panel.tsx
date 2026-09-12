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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { useTRPC } from "@/lib/trpc/client";

const SAMPLE_STATUSES = [
	{ value: "REQUESTED", key: "sample.status.requested" },
	{ value: "PREPARING", key: "sample.status.preparing" },
	{ value: "SHIPPED", key: "sample.status.shipped" },
	{ value: "DELIVERED", key: "sample.status.delivered" },
	{ value: "APPROVED", key: "sample.status.approved" },
	{ value: "REJECTED", key: "sample.status.rejected" },
] as const satisfies readonly { value: string; key: TranslationKey }[];

export function SamplesPanel({ dealId }: { dealId: string }) {
	const { t } = useLanguage();
	const sampleColumns = [
		{ header: t("sample.product") },
		{ header: t("sample.status"), width: "8rem" },
		{ header: t("sample.qty"), width: "4rem" },
		{ header: t("sample.tracking") },
		{ header: "", width: "5rem" },
	];
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [adding, setAdding] = useState(false);
	const [product, setProduct] = useState("");
	const [variant, setVariant] = useState("");
	const [quantity, setQuantity] = useState("1");
	const [shipTo, setShipTo] = useState("");
	const [courier, setCourier] = useState("");
	const [trackingNo, setTrackingNo] = useState("");

	const samples = useQuery(trpc.deals.samples.queryOptions({ id: dealId }));

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.deals.samples.pathKey(),
		});

	const create = useMutation(
		trpc.deals.createSample.mutationOptions({
			onSuccess: () => {
				toast.success(t("sample.added"));
				setAdding(false);
				setProduct("");
				setVariant("");
				setQuantity("1");
				setShipTo("");
				setCourier("");
				setTrackingNo("");
				void invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const update = useMutation(
		trpc.deals.updateSample.mutationOptions({
			onSuccess: () => {
				toast.success(t("sample.updated"));
				void invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const remove = useMutation(
		trpc.deals.deleteSample.mutationOptions({
			onSuccess: () => {
				toast.success(t("sample.removed"));
				void invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const rows = samples.data ?? [];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<h3 className="font-medium text-sm">{t("sample.title")}</h3>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => setAdding((value) => !value)}
				>
					<Icon icon={Add} data-icon="inline-start" />
					{t("sample.add")}
				</Button>
			</div>

			{adding ? (
				<div className="rounded-md border p-3">
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="sample-product">
								{t("sample.product")}
							</FieldLabel>
							<Input
								id="sample-product"
								value={product}
								onChange={(event) => setProduct(event.target.value)}
								placeholder="Borosilicate glass jar"
								required
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="sample-variant">
								{t("sample.variant")}
							</FieldLabel>
							<Input
								id="sample-variant"
								value={variant}
								onChange={(event) => setVariant(event.target.value)}
								placeholder="500ml / bamboo lid / pink sleeve"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="sample-quantity">
								{t("sample.quantity")}
							</FieldLabel>
							<Input
								id="sample-quantity"
								type="number"
								min={1}
								value={quantity}
								onChange={(event) => setQuantity(event.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="sample-ship-to">
								{t("sample.shipTo")}
							</FieldLabel>
							<Input
								id="sample-ship-to"
								value={shipTo}
								onChange={(event) => setShipTo(event.target.value)}
								placeholder="Australia"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="sample-courier">
								{t("sample.courier")}
							</FieldLabel>
							<Input
								id="sample-courier"
								value={courier}
								onChange={(event) => setCourier(event.target.value)}
								placeholder="DHL / FedEx"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="sample-tracking">
								{t("sample.tracking")}
							</FieldLabel>
							<Input
								id="sample-tracking"
								value={trackingNo}
								onChange={(event) => setTrackingNo(event.target.value)}
								placeholder="DHL tracking number"
							/>
						</Field>
					</FieldGroup>
					<div className="mt-3 flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							disabled={!product.trim() || create.isPending}
							onClick={() => {
								create.mutate({
									dealId,
									product,
									variant: variant || null,
									quantity: Number.parseInt(quantity, 10) || 1,
									shipTo: shipTo || null,
									courier: courier || null,
									trackingNo: trackingNo || null,
								});
							}}
						>
							{create.isPending ? <Spinner data-icon="inline-start" /> : null}
							{t("common.add")}
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

			{samples.isPending ? (
				<p className="text-muted-foreground text-sm">{t("sample.loading")}</p>
			) : rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">{t("sample.empty")}</p>
			) : (
				<SimpleTable columns={sampleColumns}>
					{rows.map((sample) => (
						<SimpleTableRow key={sample.id}>
							<TableCell className="font-medium">
								{sample.product}
								{sample.variant ? ` · ${sample.variant}` : ""}
							</TableCell>
							<TableCell>
								<Select
									value={sample.status}
									onValueChange={(value) =>
										update.mutate({
											id: sample.id,
											data: { status: value as never },
										})
									}
								>
									<SelectTrigger className="h-7 w-28 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{SAMPLE_STATUSES.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{t(item.key)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</TableCell>
							<TableCell>{sample.quantity}</TableCell>
							<TableCell className="text-muted-foreground text-xs">
								{sample.trackingNo || "—"}
							</TableCell>
							<TableCell>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onClick={() => remove.mutate({ id: sample.id })}
								>
									{t("sample.remove")}
								</Button>
							</TableCell>
						</SimpleTableRow>
					))}
				</SimpleTable>
			)}
		</div>
	);
}
