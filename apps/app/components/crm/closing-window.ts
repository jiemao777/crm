import { type Language, type TranslationKey, translate } from "@/lib/i18n-core";

const OPTIONS = [
	{ value: "overdue", key: "deal.closing.overdue" },
	{ value: "this-month", key: "deal.closing.thisMonth" },
	{ value: "next-month", key: "deal.closing.nextMonth" },
	{ value: "later", key: "deal.closing.later" },
	{ value: "none", key: "deal.closing.none" },
] as const satisfies readonly { value: string; key: TranslationKey }[];

export const CLOSING_OPTIONS = OPTIONS.map(({ value, key }) => ({
	value,
	label: translate("en", key),
}));

export function closingWindowLabel(
	value: (typeof OPTIONS)[number]["value"],
	language: Language,
): string {
	const option = OPTIONS.find((entry) => entry.value === value);
	return option ? translate(language, option.key) : value;
}
