import "@crm/ui/globals.css";
import { Toaster } from "@crm/ui/components/sonner";
import { TooltipProvider } from "@crm/ui/components/tooltip";
import { cn } from "@crm/ui/lib/utils";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/lib/i18n";
import { getRequestLanguage, getRequestTranslation } from "@/lib/i18n-server";
import { TRPCReactProvider } from "@/lib/trpc/client";

const fontSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const fontMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
	return {
		title: {
			default: "Comp AI - CRM",
			template: "%s · Comp AI CRM",
		},
		description: await getRequestTranslation("app.description"),
		icons: {
			icon: [
				{ url: "/favicon.svg", type: "image/svg+xml" },
				{ url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
			],
			apple: "/apple-touch-icon.png",
		},
		manifest: "/site.webmanifest",
	};
}

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const language = await getRequestLanguage();

	return (
		<html
			lang={language === "zh" ? "zh-CN" : "en"}
			suppressHydrationWarning
			className={cn(fontSans.variable, fontMono.variable, "h-full antialiased")}
		>
			<body className="flex min-h-full flex-col font-sans">
				<NuqsAdapter>
					<TRPCReactProvider>
						<ThemeProvider>
							<LanguageProvider initialLanguage={language}>
								<TooltipProvider>{children}</TooltipProvider>
								<Toaster richColors />
							</LanguageProvider>
						</ThemeProvider>
					</TRPCReactProvider>
				</NuqsAdapter>
			</body>
		</html>
	);
}
