import { cookies } from "next/headers";
import {
	LANGUAGE_COOKIE,
	type Language,
	resolveLanguage,
	type TranslationKey,
	translate,
} from "@/lib/i18n-core";

export async function getRequestLanguage(): Promise<Language> {
	const store = await cookies();
	return resolveLanguage(store.get(LANGUAGE_COOKIE)?.value);
}

export async function getRequestTranslation(
	key: TranslationKey,
): Promise<string> {
	return translate(await getRequestLanguage(), key);
}
