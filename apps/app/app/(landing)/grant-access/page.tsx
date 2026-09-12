import { needsGoogleGrant } from "@crm/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { TranslatedText } from "@/components/translated-text";
import { getRequestTranslation } from "@/lib/i18n-server";
import { requireSession, signInAccounts } from "@/lib/session";
import { GrantAccess } from "./grant-access";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("grant.access") };
}

export default async function GrantAccessPage() {
	const { user } = await requireSession();

	if (!needsGoogleGrant(await signInAccounts(user.id))) {
		redirect("/");
	}

	return (
		<AuthShell>
			<AuthHeading
				title={<TranslatedText k="grant.title" />}
				description={<TranslatedText k="grant.description" />}
			/>

			<GrantAccess />

			<p className="text-center text-muted-foreground text-sm/5">
				<TranslatedText k="google.privacyNote" />
			</p>
		</AuthShell>
	);
}
