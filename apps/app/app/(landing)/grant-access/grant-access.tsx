"use client";

import { authClient, signOut } from "@crm/auth/client";
import { SYNC_SCOPES } from "@crm/auth/scopes";
import GoogleLogo from "@crm/ui/components/brand-logos/google";
import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";

export function GrantAccess() {
	const { t } = useLanguage();
	const [pending, setPending] = useState(false);

	async function handleGrant() {
		setPending(true);

		const origin = window.location.origin;

		const { error } = await authClient.linkSocial({
			provider: "google",
			scopes: [...SYNC_SCOPES],
			callbackURL: `${origin}/`,
			errorCallbackURL: `${origin}/grant-access`,
		});

		if (error) {
			toast.error(error.message ?? t("google.unreachable"));
			setPending(false);
		}
	}

	async function handleSignOut() {
		const { error } = await signOut();

		if (error) {
			toast.error(error.message ?? t("header.signOutFailed"));
			return;
		}

		window.location.assign("/sign-in");
	}

	return (
		<div className="flex flex-col gap-3">
			<Button
				className="w-full"
				disabled={pending}
				onClick={handleGrant}
				type="button"
			>
				{pending ? (
					<Spinner data-icon="inline-start" />
				) : (
					<GoogleLogo data-icon="inline-start" className="size-4" />
				)}
				{t("grant.access")}
			</Button>

			<Button
				className="w-full"
				onClick={() => {
					handleSignOut().catch(() => toast.error(t("header.signOutFailed")));
				}}
				type="button"
				variant="ghost"
			>
				{t("header.signOut")}
			</Button>
		</div>
	);
}
