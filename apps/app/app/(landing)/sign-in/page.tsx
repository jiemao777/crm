import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { TranslatedText } from "@/components/translated-text";
import { getRequestTranslation } from "@/lib/i18n-server";
import { getSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { EmailSignIn } from "./email-sign-in";
import { GoogleSignIn } from "./google-sign-in";
import { LocalSignIn } from "./local-sign-in";
import { type SsoProvider, SsoSignIn } from "./sso-sign-in";

export async function generateMetadata(): Promise<Metadata> {
	return { title: await getRequestTranslation("signin.submit") };
}

export const dynamic = "force-dynamic";

type SignInOptions = { google: boolean; providers: SsoProvider[] };

async function signInOptions(): Promise<SignInOptions | null> {
	try {
		return await getServerQueryClient().fetchQuery(
			getServerTrpc().sso.signInOptions.queryOptions(),
		);
	} catch (error) {
		console.error("Sign-in: could not read the sign-in options.", error);
		return null;
	}
}

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{ method?: string | string[] }>;
}) {
	const [session, options, { method }] = await Promise.all([
		getSession().catch((error: unknown) => {
			console.error("Sign-in: could not read the session.", error);
			return null;
		}),
		signInOptions(),
		searchParams,
	]);

	if (session) {
		redirect("/");
	}

	const google = options?.google ?? true;
	const providers = options?.providers ?? [];

	const insistOnGoogle = method === "google" && google;
	const showSso = providers.length > 0 && !insistOnGoogle;
	const showGoogle = google && (providers.length === 0 || insistOnGoogle);
	const showEmail = !showSso && !showGoogle;
	const showLocal =
		process.env.NODE_ENV !== "production" && !showSso && !showGoogle;

	if (!showSso && !showGoogle && !showEmail && !showLocal) {
		return (
			<AuthShell>
				<AuthHeading
					title={<TranslatedText k="signin.noMethod" />}
					description={<TranslatedText k="signin.noMethodDescription" />}
				/>

				<p className="text-center text-muted-foreground text-sm/5">
					<TranslatedText k="signin.noMethodInstructions" />
				</p>
			</AuthShell>
		);
	}

	return (
		<AuthShell>
			<AuthHeading
				title={<TranslatedText k="signin.welcome" />}
				description={<TranslatedText k="signin.subtitle" />}
			/>

			{showSso ? <SsoSignIn providers={providers} /> : null}
			{showGoogle ? <GoogleSignIn /> : null}
			{showEmail ? <EmailSignIn /> : null}
			{showLocal ? <LocalSignIn /> : null}
		</AuthShell>
	);
}
