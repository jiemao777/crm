"use client";

import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";

export function LocalSignIn() {
	const { t } = useLanguage();
	const [pending, setPending] = useState(false);

	async function handleClick() {
		setPending(true);

		try {
			const response = await fetch("/api/dev-session", {
				method: "POST",
				credentials: "same-origin",
			});

			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					message?: string;
				} | null;
				throw new Error(body?.message ?? t("signin.localFailed"));
			}

			window.location.assign("/");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : t("signin.localFailed"),
			);
			setPending(false);
		}
	}

	return (
		<Button
			className="w-full"
			disabled={pending}
			onClick={handleClick}
			type="button"
			variant="outline"
		>
			{pending ? <Spinner data-icon="inline-start" /> : null}
			{t("signin.local")}
		</Button>
	);
}
