"use client";

import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n";
import { isLanguage } from "@/lib/i18n-core";

export function LanguageMenu() {
	const router = useRouter();
	const { language, setLanguage, t } = useLanguage();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" aria-label={t("header.language")}>
					{language === "zh" ? "中文" : "EN"}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-40">
				<DropdownMenuRadioGroup
					value={language}
					onValueChange={(value) => {
						if (!isLanguage(value)) return;
						void setLanguage(value).then(() => router.refresh());
					}}
				>
					<DropdownMenuRadioItem value="zh">
						{t("header.chinese")}
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="en">
						{t("header.english")}
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
