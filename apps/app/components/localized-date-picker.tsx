"use client";

import {
	DatePicker,
	type DatePickerProps,
} from "@crm/ui/components/date-picker";
import { useLanguage } from "@/lib/i18n";

export function LocalizedDatePicker(props: DatePickerProps) {
	const { locale, t } = useLanguage();
	return (
		<DatePicker
			{...props}
			locale={locale}
			placeholder={props.placeholder ?? t("common.selectDate")}
			clearLabel={t("common.clear")}
		/>
	);
}
