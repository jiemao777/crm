"use client";

import { Button } from "@crm/ui/components/button";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { LocalizedDatePicker as DatePicker } from "@/components/localized-date-picker";
import { useLanguage } from "@/lib/i18n";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

function QuickAddForm({
	submitLabel,
	pending,
	ready,
	onSubmit,
	onCancel,
	children,
}: {
	submitLabel: string;
	pending: boolean;
	ready: boolean;
	onSubmit: () => void;
	onCancel: () => void;
	children: React.ReactNode;
}) {
	const { t } = useLanguage();
	return (
		<form
			className="flex shrink-0 flex-col gap-4 border-b px-5 py-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<div className="grid gap-4 sm:grid-cols-2">{children}</div>
			<div className="flex items-center justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={pending}
					onClick={onCancel}
				>
					{t("common.cancel")}
				</Button>
				<Button type="submit" size="sm" disabled={pending || !ready}>
					{pending ? <Spinner /> : null}
					{submitLabel}
				</Button>
			</div>
		</form>
	);
}

export function QuickAddContact({
	companyId,
	ownerId,
	onDone,
}: {
	companyId: string;
	ownerId: string | null;
	onDone: () => void;
}) {
	const { t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();

	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [email, setEmail] = useState("");
	const [title, setTitle] = useState("");

	const firstNameId = useId();
	const lastNameId = useId();
	const emailId = useId();
	const titleId = useId();

	const create = useMutation(
		trpc.contacts.create.mutationOptions({
			onSuccess: async (contact) => {
				await cache.contact(contact.id);
				toast.success(t("common.added", { name: contact.firstName }));
				onDone();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<QuickAddForm
			submitLabel={t("contact.add")}
			pending={create.isPending}
			ready={firstName.trim() !== ""}
			onCancel={onDone}
			onSubmit={() =>
				create.mutate({
					firstName,
					lastName: lastName || undefined,
					email: email || undefined,
					title: title || undefined,
					companyId,
					ownerId,
				})
			}
		>
			<Field>
				<FieldLabel htmlFor={firstNameId}>{t("contact.firstName")}</FieldLabel>
				<Input
					id={firstNameId}
					autoFocus
					value={firstName}
					onChange={(event) => setFirstName(event.target.value)}
					autoComplete="off"
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={lastNameId}>{t("contact.lastName")}</FieldLabel>
				<Input
					id={lastNameId}
					value={lastName}
					onChange={(event) => setLastName(event.target.value)}
					autoComplete="off"
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={emailId}>{t("contact.email")}</FieldLabel>
				<Input
					id={emailId}
					type="email"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					autoComplete="off"
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={titleId}>{t("contact.titleField")}</FieldLabel>
				<Input
					id={titleId}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Head of Security"
					autoComplete="off"
				/>
			</Field>
		</QuickAddForm>
	);
}

export function QuickAddDeal({
	companyId,
	companyName,
	ownerId,
	onDone,
}: {
	companyId: string;
	companyName: string;
	ownerId: string | null;
	onDone: () => void;
}) {
	const { t } = useLanguage();
	const trpc = useTRPC();
	const cache = useCrmCache();

	const [name, setName] = useState("");
	const [amount, setAmount] = useState("");
	const [expectedOrderDate, setExpectedOrderDate] = useState("");

	const nameId = useId();
	const amountId = useId();
	const expectedOrderDateId = useId();

	const me = useQuery(trpc.users.me.queryOptions());
	const owner = ownerId ?? me.data?.id ?? null;

	const create = useMutation(
		trpc.deals.create.mutationOptions({
			onSuccess: async (deal) => {
				await cache.deal(deal.id);
				toast.success(t("common.created", { name: deal.name }));
				onDone();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const submit = () => {
		if (!owner) {
			toast.error(t("deal.ownerUnknown"));
			return;
		}

		let amountCents: number | null = null;
		if (amount.trim() !== "") {
			const parsed = Number.parseFloat(amount);
			if (!Number.isFinite(parsed) || parsed < 0) {
				toast.error(t("deal.invalidAmount"));
				return;
			}
			amountCents = Math.round(parsed * 100);
		}

		create.mutate({
			name,
			companyId,
			ownerId: owner,
			amountCents,
			expectedOrderDate: expectedOrderDate || null,
		});
	};

	return (
		<QuickAddForm
			submitLabel={t("deal.create")}
			pending={create.isPending}
			ready={name.trim() !== ""}
			onCancel={onDone}
			onSubmit={submit}
		>
			<Field className="sm:col-span-2">
				<FieldLabel htmlFor={nameId}>{t("deal.inquiryName")}</FieldLabel>
				<Input
					id={nameId}
					autoFocus
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder={t("deal.namePlaceholder", { company: companyName })}
					autoComplete="off"
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={amountId}>{t("deal.amount")}</FieldLabel>
				<Input
					id={amountId}
					value={amount}
					onChange={(event) => setAmount(event.target.value)}
					placeholder="24000"
					autoComplete="off"
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={expectedOrderDateId}>
					{t("deal.expectedOrder")}
				</FieldLabel>
				<DatePicker
					id={expectedOrderDateId}
					value={expectedOrderDate}
					onChange={setExpectedOrderDate}
					placeholder={t("deal.noDate")}
				/>
			</Field>
		</QuickAddForm>
	);
}
