"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	LANGUAGE_COOKIE,
	LANGUAGE_COOKIE_MAX_AGE,
	type Language,
	localeFor,
	type TranslationKey,
	type TranslationValues,
	translate,
} from "@/lib/i18n-core";

export type { Language, TranslationKey } from "@/lib/i18n-core";

type LanguageContextValue = {
	language: Language;
	locale: ReturnType<typeof localeFor>;
	setLanguage: (language: Language) => Promise<void>;
	t: (key: TranslationKey, values?: TranslationValues) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
	children,
	initialLanguage,
}: {
	children: ReactNode;
	initialLanguage: Language;
}) {
	const [language, setLanguageState] = useState(initialLanguage);

	const setLanguage = useCallback(async (next: Language) => {
		setLanguageState(next);
		document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
		const writeLegacyCookie = () => {
			const secure = window.location.protocol === "https:" ? "; Secure" : "";
			Reflect.set(
				document,
				"cookie",
				`${LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`,
			);
		};
		const cookieStore = Reflect.get(window, "cookieStore") as
			| CookieStore
			| undefined;
		if (!cookieStore) {
			writeLegacyCookie();
			return;
		}
		try {
			await cookieStore.set({
				name: LANGUAGE_COOKIE,
				value: next,
				path: "/",
				expires: Date.now() + LANGUAGE_COOKIE_MAX_AGE * 1000,
				sameSite: "lax",
			});
		} catch {
			writeLegacyCookie();
		}
	}, []);

	const t = useCallback(
		(key: TranslationKey, values?: TranslationValues) =>
			translate(language, key, values),
		[language],
	);

	const value = useMemo(
		() => ({ language, locale: localeFor(language), setLanguage, t }),
		[language, setLanguage, t],
	);

	return (
		<LanguageContext.Provider value={value}>
			{children}
		</LanguageContext.Provider>
	);
}

export function useLanguage(): LanguageContextValue {
	const context = useContext(LanguageContext);
	if (!context) {
		throw new Error("useLanguage must be used within LanguageProvider");
	}
	return context;
}
