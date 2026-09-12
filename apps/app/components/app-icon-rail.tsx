"use client";

import Building from "@carbon/icons-react/es/Building";
import type { CarbonIconType } from "@carbon/icons-react/es/CarbonIcon";
import Dashboard from "@carbon/icons-react/es/Dashboard";
import MailAll from "@carbon/icons-react/es/MailAll";
import Partnership from "@carbon/icons-react/es/Partnership";
import Settings from "@carbon/icons-react/es/Settings";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@crm/ui/components/sheet";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { cn } from "@crm/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useMobileNav } from "@/components/mobile-nav";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type RailItem = {
	title: TranslationKey;
	href: string;
	icon: CarbonIconType;
	match: "exact" | "prefix";
};

const ITEMS: RailItem[] = [
	{ title: "nav.overview", href: "/", icon: Dashboard, match: "exact" },
	{
		title: "nav.customers",
		href: "/companies",
		icon: Building,
		match: "prefix",
	},
	{
		title: "nav.contacts",
		href: "/contacts",
		icon: UserMultiple,
		match: "prefix",
	},
	{
		title: "nav.inquiries",
		href: "/deals",
		icon: Partnership,
		match: "prefix",
	},
	{ title: "nav.mailbox", href: "/mail", icon: MailAll, match: "prefix" },
	{ title: "nav.settings", href: "/settings", icon: Settings, match: "prefix" },
];

function isActive(item: RailItem, pathname: string): boolean {
	return (
		pathname === item.href ||
		(item.match === "prefix" && pathname.startsWith(item.href))
	);
}

function RailLink({ item, active }: { item: RailItem; active: boolean }) {
	const { t } = useLanguage();
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					asChild
					variant="ghost"
					size="icon"
					className={cn(
						"text-muted-foreground",
						active &&
							"bg-muted text-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					<Link
						href={item.href}
						aria-current={active ? "page" : undefined}
						transitionTypes={["nav-lateral"]}
					>
						<Icon icon={item.icon} />
						<span className="sr-only">{t(item.title)}</span>
					</Link>
				</Button>
			</TooltipTrigger>
			<TooltipContent side="right">{t(item.title)}</TooltipContent>
		</Tooltip>
	);
}

function MobileRailLink({
	item,
	active,
	onNavigate,
}: {
	item: RailItem;
	active: boolean;
	onNavigate: () => void;
}) {
	const { t } = useLanguage();
	return (
		<Button
			asChild
			variant="ghost"
			className={cn(
				"justify-start gap-3 text-muted-foreground",
				active &&
					"bg-muted text-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Link
				href={item.href}
				aria-current={active ? "page" : undefined}
				onClick={onNavigate}
			>
				<Icon icon={item.icon} />
				<span>{t(item.title)}</span>
			</Link>
		</Button>
	);
}

export function AppIconRail() {
	const pathname = usePathname();
	const { t } = useLanguage();
	const workspaceUrl = useWorkspaceUrl();
	const { open, setOpen } = useMobileNav();

	const items = useMemo(
		() => ITEMS.map((item) => ({ ...item, href: workspaceUrl(item.href) })),
		[workspaceUrl],
	);

	return (
		<>
			<nav
				aria-label={t("nav.primary")}
				className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r py-3 md:flex [view-transition-name:app-rail]"
			>
				{items.map((item) => (
					<RailLink
						key={item.href}
						item={item}
						active={isActive(item, pathname)}
					/>
				))}
			</nav>

			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent
					side="left"
					className="w-64 gap-0 p-0"
					closeLabel={t("common.close")}
				>
					<SheetHeader>
						<SheetTitle>{t("nav.navigation")}</SheetTitle>
					</SheetHeader>
					<nav
						aria-label={t("nav.primary")}
						className="flex flex-1 flex-col gap-1 p-2"
					>
						{items.map((item) => (
							<MobileRailLink
								key={item.href}
								item={item}
								active={isActive(item, pathname)}
								onNavigate={() => setOpen(false)}
							/>
						))}
					</nav>
				</SheetContent>
			</Sheet>
		</>
	);
}
