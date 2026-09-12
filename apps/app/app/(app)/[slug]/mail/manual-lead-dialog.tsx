"use client";

import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";
import { useTRPC } from "@/lib/trpc/client";

export type ManualLeadPrefill = {
	threadId: string;
	reason: "unavailable" | "unidentified";
	email: string;
	firstName: string;
	lastName: string;
};

export function ManualLeadDialog({
	prefill,
	onClose,
	onCreated,
}: {
	prefill: ManualLeadPrefill;
	onClose: () => void;
	onCreated: () => void;
}) {
	const { t } = useLanguage();
	const trpc = useTRPC();
	const [companyName, setCompanyName] = useState("");
	const [domain, setDomain] = useState("");
	const [email, setEmail] = useState(prefill.email);
	const [firstName, setFirstName] = useState(prefill.firstName);
	const [lastName, setLastName] = useState(prefill.lastName);
	const [phone, setPhone] = useState("");

	const create = useMutation(
		trpc.google.createCustomerFromThreadManual.mutationOptions({
			onSuccess: (result) => {
				if (result.status === "created") {
					toast.success(t("mail.customerCreated"));
				} else if (result.status === "matched") {
					toast.success(t("mail.customerMatched"));
				} else {
					toast.info(t("mail.alreadyLinked"));
				}
				onCreated();
				onClose();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const submit = () => {
		if (!companyName.trim()) {
			toast.error(t("mail.manualCompanyName"));
			return;
		}
		if (!email.trim() || !email.includes("@")) {
			toast.error(t("mail.manualEmail"));
			return;
		}
		create.mutate({
			threadId: prefill.threadId,
			companyName,
			domain: domain || null,
			email,
			firstName: firstName || null,
			lastName: lastName || null,
			phone: phone || null,
		});
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("mail.manualCreateTitle")}</DialogTitle>
					<DialogDescription>
						{prefill.reason === "unavailable"
							? t("mail.manualCreateDescription")
							: t("mail.customerNotIdentified")}
					</DialogDescription>
				</DialogHeader>
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor="manual-company">
							{t("mail.manualCompanyName")}
						</FieldLabel>
						<Input
							id="manual-company"
							value={companyName}
							onChange={(event) => setCompanyName(event.target.value)}
							autoFocus
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="manual-email">
							{t("mail.manualEmail")}
						</FieldLabel>
						<Input
							id="manual-email"
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					</Field>
					<div className="grid grid-cols-2 gap-3">
						<Field>
							<FieldLabel htmlFor="manual-first-name">
								{t("mail.manualFirstName")}
							</FieldLabel>
							<Input
								id="manual-first-name"
								value={firstName}
								onChange={(event) => setFirstName(event.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="manual-last-name">
								{t("mail.manualLastName")}
							</FieldLabel>
							<Input
								id="manual-last-name"
								value={lastName}
								onChange={(event) => setLastName(event.target.value)}
							/>
						</Field>
					</div>
					<Field>
						<FieldLabel htmlFor="manual-domain">
							{t("mail.manualDomain")}
						</FieldLabel>
						<Input
							id="manual-domain"
							value={domain}
							onChange={(event) => setDomain(event.target.value)}
							placeholder="acme.com"
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="manual-phone">
							{t("mail.manualPhone")}
						</FieldLabel>
						<Input
							id="manual-phone"
							value={phone}
							onChange={(event) => setPhone(event.target.value)}
						/>
					</Field>
				</FieldGroup>
				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={onClose}
						disabled={create.isPending}
					>
						{t("common.cancel")}
					</Button>
					<Button type="button" onClick={submit} disabled={create.isPending}>
						{create.isPending ? <Spinner data-icon="inline-start" /> : null}
						{t("mail.manualSubmit")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
