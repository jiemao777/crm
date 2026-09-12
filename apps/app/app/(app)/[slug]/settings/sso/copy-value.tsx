"use client";

import Copy from "@carbon/icons-react/es/Copy";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { toast } from "sonner";
import { useLanguage } from "@/lib/i18n";

export function CopyValue({ value, label }: { value: string; label: string }) {
	const { t } = useLanguage();
	const unavailable = () =>
		toast.error(t("sso.copyFailed", { label: label.toLowerCase() }));

	return (
		<Button
			variant="ghost"
			size="icon"
			type="button"
			onClick={() => {
				const clipboard = navigator.clipboard;

				if (!clipboard) {
					unavailable();
					return;
				}

				clipboard
					.writeText(value)
					.then(() => toast.success(t("sso.copied", { label })))
					.catch(unavailable);
			}}
		>
			<Icon icon={Copy} />
			<span className="sr-only">
				{t("sso.copy", { label: label.toLowerCase() })}
			</span>
		</Button>
	);
}
