import type { Metadata } from "next";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { TranslatedText } from "@/components/translated-text";
import { getRequestTranslation } from "@/lib/i18n-server";
import { requireGoogleAccess } from "@/lib/session";
import { ResearchProviderForm } from "./research-provider-form";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("onboarding.researchKey") };
}

export default async function ResearchKeyPage() {
	await requireGoogleAccess();

	return (
		<AuthShell>
			<AuthHeading
				title={<TranslatedText k="onboarding.researchTitle" />}
				description={<TranslatedText k="onboarding.researchDescription" />}
			/>

			<ResearchProviderForm />
		</AuthShell>
	);
}
