import { DEFAULT_WORKSPACE_NAME } from "@crm/auth";
import type { Metadata } from "next";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { TranslatedText } from "@/components/translated-text";
import { getRequestTranslation } from "@/lib/i18n-server";
import { requireGoogleAccess } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("onboarding.setup") };
}

export default async function OnboardingPage() {
	await requireGoogleAccess();

	return (
		<AuthShell>
			<AuthHeading
				title={<TranslatedText k="onboarding.companyTitle" />}
				description={<TranslatedText k="onboarding.companyDescription" />}
			/>

			<OnboardingForm placeholder={DEFAULT_WORKSPACE_NAME} />
		</AuthShell>
	);
}
