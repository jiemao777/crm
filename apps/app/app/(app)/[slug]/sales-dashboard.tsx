"use client";

import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import type { ChartConfig } from "@crm/ui/components/chart";
import { DashboardRow, StatGroup } from "@crm/ui/components/dashboard";
import { StatCard, type StatDelta } from "@crm/ui/components/stat-card";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import {
	formatMoney,
	formatMoneyCompact,
	formatPercent,
} from "@crm/ui/lib/format";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { dealStageColor, dealStageLabel } from "@/components/crm/deal-stage";
import { AreaTrend, DonutStat } from "@/components/dashboard-charts";
import { useLanguage } from "@/lib/i18n";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type Summary = RouterOutputs["dashboard"]["summary"];
type CurrencyAmount = { currency: string; valueCents: number };

function changeDelta(
	current: number,
	previous: number,
	label: string,
): StatDelta | undefined {
	if (previous === 0) return undefined;
	const change = Math.round(((current - previous) / previous) * 100);
	return {
		value: `${change >= 0 ? "+" : ""}${change}%`,
		direction: change > 0 ? "up" : change < 0 ? "down" : "neutral",
		label,
	};
}

function joinedAmounts(totals: CurrencyAmount[]): string {
	if (totals.length === 0) return formatMoneyCompact(0);
	return totals
		.map((entry) => formatMoneyCompact(entry.valueCents, entry.currency))
		.join(" + ");
}

function singleAmount(
	totals: CurrencyAmount[],
): { currency: string; valueCents: number } | null {
	return totals.length === 1 ? (totals[0] ?? null) : null;
}

export function SalesDashboard({ summary }: { summary: Summary }) {
	const { language, t } = useLanguage();
	const workspaceUrl = useWorkspaceUrl();
	const [picked, setPicked] = useState<string | null>(null);

	const { pipeline, wonThisMonth, wonPrevMonth, performance, trend } = summary;

	const currencies = [
		...new Set([
			...pipeline.totals.map((entry) => entry.currency),
			...trend.map((entry) => entry.currency),
		]),
	].sort();
	const primary =
		[...pipeline.totals].sort((a, b) => b.count - a.count)[0]?.currency ??
		trend[0]?.currency ??
		null;
	const currency =
		picked && currencies.includes(picked) ? picked : (primary ?? "USD");

	const trendConfig: ChartConfig = {
		won: { label: t("dashboard.ordersWonLegend"), color: "var(--success)" },
		created: {
			label: t("dashboard.newInquiriesLegend"),
			color: "var(--chart-1)",
		},
	};

	const trendPoints = (
		trend.find((entry) => entry.currency === currency)?.points ?? []
	).map((point) => ({
		month: point.month,
		won: point.wonCents,
		created: point.createdCents,
	}));
	const hasTrend = trendPoints.some(
		(point) => point.won > 0 || point.created > 0,
	);

	const stageSlices = pipeline.stages
		.map((stage) => {
			const total = stage.totals.find((entry) => entry.currency === currency);
			return {
				key: stage.stage,
				label: dealStageLabel(stage.stage, language),
				value: total?.valueCents ?? 0,
				color: dealStageColor(stage.stage),
				count: total?.count ?? 0,
			};
		})
		.filter((slice) => slice.value > 0);

	const currencyTotalCents =
		pipeline.totals.find((entry) => entry.currency === currency)?.valueCents ??
		0;

	const wonNow = singleAmount(wonThisMonth.totals);
	const wonPrev = singleAmount(wonPrevMonth.totals);
	const wonDelta =
		wonNow && wonPrev && wonNow.currency === wonPrev.currency
			? changeDelta(
					wonNow.valueCents,
					wonPrev.valueCents,
					t("dashboard.vsLastMonth"),
				)
			: undefined;

	return (
		<div className="flex flex-col gap-6">
			<StatGroup>
				<StatCard
					label={t("dashboard.ordersWon")}
					value={joinedAmounts(wonThisMonth.totals)}
					delta={wonDelta}
					description={t("dashboard.wonDescription", {
						count: wonThisMonth.count,
						amount: joinedAmounts(wonPrevMonth.totals),
					})}
				/>
				<StatCard
					label={t("dashboard.activeValue")}
					value={joinedAmounts(pipeline.totals)}
					description={t("dashboard.activeDescription", {
						count: pipeline.totalDeals,
						amount: joinedAmounts(summary.closingThisMonthTotal.totals),
					})}
				/>
				<StatCard
					label={t("dashboard.winRate", { days: performance.windowDays })}
					value={
						performance.winRate === null
							? "—"
							: formatPercent(performance.winRate)
					}
					description={
						performance.wins + performance.losses === 0
							? t("dashboard.nothingClosed")
							: t("dashboard.wonLost", {
									won: performance.wins,
									lost: performance.losses,
								})
					}
				/>
				<StatCard
					label={t("dashboard.avgInquiry", { days: performance.windowDays })}
					value={
						performance.avgDeal.length === 0
							? "—"
							: joinedAmounts(performance.avgDeal)
					}
					description={
						performance.avgCycleDays === null
							? t("dashboard.noWins")
							: t("dashboard.averageCycle", {
									days: performance.avgCycleDays,
								})
					}
				/>
			</StatGroup>

			{currencies.length > 1 ? (
				<div className="flex flex-wrap items-center justify-end gap-3">
					<span className="text-muted-foreground text-xs">
						{t("dashboard.multiCurrencyNote")}
					</span>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						spacing={0}
						value={currency}
						onValueChange={(next) => {
							if (next) setPicked(next);
						}}
						aria-label={t("dashboard.currencyLabel")}
					>
						{currencies.map((code) => (
							<ToggleGroupItem key={code} value={code}>
								{code}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
			) : null}

			<DashboardRow split="hero">
				<ChartPanel
					title={t("dashboard.ordersVsInquiries")}
					description={t("dashboard.trendDescription")}
				>
					{hasTrend ? (
						<div className="flex flex-1 flex-col justify-center py-4">
							<AreaTrend
								data={trendPoints}
								config={trendConfig}
								xKey="month"
								height={196}
								variant="gradient"
								bloom="high"
								showLegend
								formatValue={(value) =>
									formatMoney(
										typeof value === "number" ? value : Number(value),
										currency,
									)
								}
							/>
						</div>
					) : (
						<EmptyChart label={t("dashboard.noTrend")} />
					)}
				</ChartPanel>

				<ChartPanel
					title={t("dashboard.activeByStage")}
					description={t("dashboard.stageValueDescription")}
				>
					{stageSlices.length > 0 ? (
						<div className="flex flex-1 flex-col justify-between gap-1 pt-4">
							<DonutStat
								data={stageSlices}
								height={168}
								centerValue={formatMoneyCompact(currencyTotalCents, currency)}
								centerLabel={t("dashboard.open")}
								formatValue={(value) =>
									formatMoney(
										typeof value === "number" ? value : Number(value),
										currency,
									)
								}
							/>
							<ul className="flex flex-col px-5 pb-1 md:px-6">
								{stageSlices.map((slice) => (
									<li key={slice.key} className="border-t first:border-t-0">
										<Link
											href={`${workspaceUrl("/deals")}?stage=${slice.key}`}
											className="flex items-center gap-2.5 py-2 text-xs hover:underline"
										>
											<span
												aria-hidden
												className="size-1.5 shrink-0"
												style={{ backgroundColor: slice.color }}
											/>
											<span className="min-w-0 flex-1 truncate">
												{slice.label}
											</span>
											<span className="shrink-0 text-muted-foreground tabular-nums">
												{slice.count}
											</span>
											<span className="w-14 shrink-0 text-right font-medium tabular-nums">
												{formatMoneyCompact(slice.value, currency)}
											</span>
										</Link>
									</li>
								))}
							</ul>
						</div>
					) : (
						<EmptyChart label={t("dashboard.nothingOpen")} />
					)}
				</ChartPanel>
			</DashboardRow>
		</div>
	);
}

function ChartPanel({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description ? <CardDescription>{description}</CardDescription> : null}
			</CardHeader>
			<div className="flex flex-1 flex-col border">{children}</div>
		</Card>
	);
}

function EmptyChart({ label }: { label: string }) {
	return (
		<div className="flex flex-1 items-center justify-center px-5 py-10 text-muted-foreground text-sm md:px-6">
			{label}
		</div>
	);
}
