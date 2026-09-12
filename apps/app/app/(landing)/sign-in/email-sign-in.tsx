"use client";

import { Button } from "@crm/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";

export function EmailSignIn() {
	const router = useRouter();
	const { t } = useLanguage();
	const emailId = useId();
	const passwordId = useId();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		setPending(true);

		try {
			const response = await fetch("/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ email, password }),
			});

			const body = (await response.json().catch(() => null)) as {
				error?: { message?: string } | string;
				message?: string;
			} | null;

			if (!response.ok) {
				const message =
					typeof body?.error === "object"
						? body.error.message
						: typeof body?.error === "string"
							? body.error
							: body?.message;
				throw new Error(message ?? t("signin.failed"));
			}

			router.replace("/");
			router.refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("signin.failed"));
			setPending(false);
		}
	}

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor={emailId}>{t("signin.email")}</FieldLabel>
					<Input
						id={emailId}
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="you@company.com"
						autoComplete="email"
						autoFocus
						required
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor={passwordId}>{t("signin.password")}</FieldLabel>
					<Input
						id={passwordId}
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="••••••••"
						autoComplete="current-password"
						required
					/>
				</Field>
			</FieldGroup>

			<Button type="submit" disabled={pending || !email || !password}>
				{pending ? <Spinner data-icon="inline-start" /> : null}
				{t("signin.submit")}
			</Button>
		</form>
	);
}
