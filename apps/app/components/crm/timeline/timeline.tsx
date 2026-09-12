"use client";

import Chat from "@carbon/icons-react/es/Chat";
import Checkmark from "@carbon/icons-react/es/Checkmark";
import Email from "@carbon/icons-react/es/Email";
import Events from "@carbon/icons-react/es/Events";
import Task from "@carbon/icons-react/es/Task";
import Time from "@carbon/icons-react/es/Time";
import { Button } from "@crm/ui/components/button";
import type { CarbonIcon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { cn } from "@crm/ui/lib/utils";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { DetailSheetEmpty, SECTION_TITLE } from "@/components/detail-sheet";
import { type TranslationKey, useLanguage } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-core";
import { useTRPC } from "@/lib/trpc/client";
import { ActivityComposer } from "./activity-composer";
import { TimelineEntry, type TimelineEntryData } from "./timeline-entry";
import {
	historyFilter,
	TIMELINE_PARAM,
	TIMELINE_TABS,
	type TimelineTab,
	timelineTabParser,
} from "./timeline-search-params";

export type TimelineAnchor =
	| { companyId: string }
	| { contactId: string }
	| { dealId: string };

const TAB_LABELS: Record<TimelineTab, TranslationKey> = {
	all: "timeline.all",
	notes: "timeline.notes",
	email: "timeline.email",
	meetings: "timeline.meetings",
	upcoming: "timeline.upcoming",
	done: "timeline.done",
};

const EMPTY_STATES: Record<
	TimelineTab,
	{ title: TranslationKey; description: TranslationKey }
> = {
	all: {
		title: "timeline.emptyAll",
		description: "timeline.emptyAllDescription",
	},
	notes: {
		title: "timeline.emptyNotes",
		description: "timeline.emptyNotesDescription",
	},
	email: {
		title: "timeline.emptyEmail",
		description: "timeline.emptyEmailDescription",
	},
	meetings: {
		title: "timeline.emptyMeetings",
		description: "timeline.emptyMeetingsDescription",
	},
	upcoming: {
		title: "timeline.emptyUpcoming",
		description: "timeline.emptyUpcomingDescription",
	},
	done: {
		title: "timeline.emptyDone",
		description: "timeline.emptyDoneDescription",
	},
};

const EMPTY_ICONS: Record<TimelineTab, CarbonIcon> = {
	all: Time,
	notes: Chat,
	email: Email,
	meetings: Events,
	upcoming: Task,
	done: Checkmark,
};

function dayLabel(
	at: Date,
	locale: Locale,
	t: (key: TranslationKey) => string,
): string {
	const midnight = (date: Date) =>
		new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

	const days = Math.round(
		(midnight(new Date()) - midnight(at)) / (1000 * 60 * 60 * 24),
	);

	if (days === 0) return t("timeline.today");
	if (days === 1) return t("timeline.yesterday");
	return new Intl.DateTimeFormat(locale, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(at);
}

function byDay(
	entries: TimelineEntryData[],
	locale: Locale,
	t: (key: TranslationKey) => string,
) {
	const groups = new Map<
		string,
		{ day: string; label: string; entries: TimelineEntryData[] }
	>();

	for (const entry of entries) {
		const at = new Date(entry.occurredAt ?? entry.createdAt);
		const day = at.toDateString();

		const group = groups.get(day);
		if (group) {
			group.entries.push(entry);
		} else {
			groups.set(day, {
				day,
				label: dayLabel(at, locale, t),
				entries: [entry],
			});
		}
	}

	return [...groups.values()];
}

function TimelineDay({
	label,
	entries,
	anchor,
}: {
	label: string;
	entries: TimelineEntryData[];
	anchor: TimelineAnchor;
}) {
	return (
		<section>
			<h3 className={cn("sticky top-0 z-10 bg-popover py-2", SECTION_TITLE)}>
				{label}
			</h3>
			<ul className="divide-y">
				{entries.map((entry) => (
					<TimelineEntry key={entry.id} entry={entry} anchor={anchor} />
				))}
			</ul>
		</section>
	);
}

export function Timeline({ anchor }: { anchor: TimelineAnchor }) {
	const { locale, t } = useLanguage();
	const trpc = useTRPC();

	const [tab, setTab] = useQueryState(TIMELINE_PARAM, timelineTabParser);

	const counts = useQuery(trpc.activities.timelineCounts.queryOptions(anchor));

	const pinned = useQuery({
		...trpc.activities.timeline.queryOptions({
			...anchor,
			filter: "upcoming",
			limit: 10,
		}),
		enabled: tab === "all",
	});

	const history = useInfiniteQuery({
		...trpc.activities.timeline.infiniteQueryOptions(
			{ ...anchor, filter: historyFilter(tab) },
			{ getNextPageParam: (page) => page.nextCursor ?? undefined },
		),
	});

	const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
	const pinnedEntries = tab === "all" ? (pinned.data?.entries ?? []) : [];

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 flex-col gap-2 border-b px-5 py-3">
				<ActivityComposer anchor={anchor} />

				<ToggleGroup
					type="single"
					value={tab}
					onValueChange={(next) => {
						if (next) void setTab(next as TimelineTab);
					}}
					size="sm"
					spacing={0}
				>
					{TIMELINE_TABS.map((option) => (
						<ToggleGroupItem key={option} value={option}>
							{t(TAB_LABELS[option])}
							{counts.data?.[option] ? (
								<span className="tabular-nums opacity-60">
									{counts.data[option]}
								</span>
							) : null}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>

			{history.isPending ? (
				<div className="flex min-h-0 flex-1 items-center justify-center">
					<Spinner />
				</div>
			) : entries.length === 0 && pinnedEntries.length === 0 ? (
				<DetailSheetEmpty
					icon={EMPTY_ICONS[tab]}
					title={t(EMPTY_STATES[tab].title)}
					description={t(EMPTY_STATES[tab].description)}
				/>
			) : (
				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4">
					{pinnedEntries.length > 0 ? (
						<TimelineDay
							label={t("timeline.outstanding")}
							entries={pinnedEntries}
							anchor={anchor}
						/>
					) : null}

					{byDay(entries, locale, t).map((group) => (
						<TimelineDay
							key={group.day}
							label={group.label}
							entries={group.entries}
							anchor={anchor}
						/>
					))}

					{history.hasNextPage ? (
						<Button
							variant="outline"
							size="sm"
							className="mt-4 self-start"
							disabled={history.isFetchingNextPage}
							onClick={() => history.fetchNextPage()}
						>
							{history.isFetchingNextPage ? <Spinner /> : null}
							{t("timeline.showOlder")}
						</Button>
					) : null}
				</div>
			)}
		</div>
	);
}
