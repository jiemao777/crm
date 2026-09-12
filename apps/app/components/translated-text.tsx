"use client";

import { type TranslationKey, useLanguage } from "@/lib/i18n";
import type { TranslationValues } from "@/lib/i18n-core";

export function TranslatedText({
	k,
	values,
}: {
	k: TranslationKey;
	values?: TranslationValues;
}) {
	const { t } = useLanguage();
	return <>{t(k, values)}</>;
}

export const TranslatedTitle = TranslatedText;
export const TranslatedDescription = TranslatedText;
