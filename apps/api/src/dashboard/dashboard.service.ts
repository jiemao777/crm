import { ActivityType, type Db, DealStage } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { toCents } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import { OPEN_INQUIRY_STAGES } from "../deals/deal-stage";
import type { DashboardSummaryInput } from "./dashboard.contracts";

const OWNER_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const TREND_MONTHS = 6;

const RATE_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short" });

function monthStart(from: Date, offset: number): Date {
	return new Date(from.getFullYear(), from.getMonth() + offset, 1);
}

function monthKey(date: Date): number {
	return date.getFullYear() * 12 + date.getMonth();
}

type CurrencyAmount = { currency: string; valueCents: number };

type CurrencyValue = CurrencyAmount & { count: number };

function addCents(
	map: Map<string, CurrencyValue>,
	currency: string,
	cents: number,
	count: number,
): void {
	const entry = map.get(currency) ?? { currency, valueCents: 0, count: 0 };
	entry.valueCents += cents;
	entry.count += count;
	map.set(currency, entry);
}

function amountsOf(map: Map<string, CurrencyValue>): CurrencyAmount[] {
	return [...map.values()]
		.filter((entry) => entry.valueCents !== 0)
		.sort((a, b) => a.currency.localeCompare(b.currency))
		.map(({ currency, valueCents }) => ({ currency, valueCents }));
}

function valuesOf(map: Map<string, CurrencyValue>): CurrencyValue[] {
	return [...map.values()]
		.filter((entry) => entry.valueCents !== 0 || entry.count !== 0)
		.sort((a, b) => a.currency.localeCompare(b.currency));
}

@Injectable()
export class DashboardService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async summary(actingUserId: string, input: DashboardSummaryInput) {
		const mine = input.scope === "me";
		const owned = mine ? { ownerId: actingUserId } : {};

		const now = new Date();
		const startOfMonth = monthStart(now, 0);
		const startOfNextMonth = monthStart(now, 1);
		const startOfPrevMonth = monthStart(now, -1);
		const trendStart = monthStart(now, -(TREND_MONTHS - 1));
		const rateStart = new Date(now.getTime() - RATE_WINDOW_DAYS * DAY_MS);

		const [
			openByStage,
			recentDeals,
			closingThisMonthTotals,
			biggestOpen,
			overdueTasks,
			recentActivity,
		] = await Promise.all([
			this.db.deal.groupBy({
				by: ["stage", "currency"],
				where: { ...owned, stage: { in: [...OPEN_INQUIRY_STAGES] } },
				_count: { _all: true },
				_sum: { amount: true },
			}),
			this.db.deal.findMany({
				where: {
					...owned,
					OR: [
						{ createdAt: { gte: trendStart } },
						{ closedAt: { gte: trendStart } },
					],
				},
				select: {
					amount: true,
					currency: true,
					stage: true,
					createdAt: true,
					closedAt: true,
				},
			}),
			this.db.deal.groupBy({
				by: ["currency"],
				where: {
					...owned,
					stage: { in: [...OPEN_INQUIRY_STAGES] },
					expectedOrderDate: { gte: startOfMonth, lt: startOfNextMonth },
				},
				_count: { _all: true },
				_sum: { amount: true },
			}),
			this.db.deal.findMany({
				where: { ...owned, stage: { in: [...OPEN_INQUIRY_STAGES] } },
				orderBy: [
					{ amount: { sort: "desc", nulls: "last" } },
					{ expectedOrderDate: "asc" },
				],
				take: 6,
				select: {
					id: true,
					name: true,
					stage: true,
					amount: true,
					currency: true,
					expectedOrderDate: true,
					stageChangedAt: true,
					company: {
						select: {
							id: true,
							name: true,
							iconUrl: true,
							iconDarkUrl: true,
							iconTone: true,
						},
					},
					owner: { select: OWNER_SELECT },
				},
			}),
			this.db.activity.findMany({
				where: {
					type: ActivityType.TASK,
					completedAt: null,
					dueAt: { lt: now },
					createdById: actingUserId,
				},
				orderBy: [{ dueAt: "asc" }],
				take: 10,
				select: {
					id: true,
					subject: true,
					dueAt: true,
					company: { select: { id: true, name: true } },
					deal: { select: { id: true, name: true } },
				},
			}),
			this.db.activity.findMany({
				where: mine ? { createdById: actingUserId } : {},
				orderBy: [{ createdAt: "desc" }],
				take: 12,
				select: {
					id: true,
					type: true,
					subject: true,
					body: true,
					createdAt: true,
					meta: true,
					createdBy: { select: OWNER_SELECT },
					company: { select: { id: true, name: true } },
					deal: { select: { id: true, name: true } },
				},
			}),
		]);

		const byStage = new Map<string, Map<string, CurrencyValue>>();
		const pipelineTotals = new Map<string, CurrencyValue>();
		for (const row of openByStage) {
			const cents = toCents(row._sum.amount) ?? 0;
			const stageMap =
				byStage.get(row.stage) ?? new Map<string, CurrencyValue>();
			addCents(stageMap, row.currency, cents, row._count._all);
			byStage.set(row.stage, stageMap);
			addCents(pipelineTotals, row.currency, cents, row._count._all);
		}

		const stages = OPEN_INQUIRY_STAGES.map((stage) => {
			const stageMap = byStage.get(stage) ?? new Map<string, CurrencyValue>();
			return {
				stage: stage as DealStage,
				count: [...stageMap.values()].reduce(
					(sum, entry) => sum + entry.count,
					0,
				),
				totals: valuesOf(stageMap),
			};
		});

		const firstBucket = monthKey(trendStart);
		const trendByCurrency = new Map<
			string,
			{ month: string; wonCents: number; createdCents: number }[]
		>();
		const pointsFor = (currency: string) => {
			let points = trendByCurrency.get(currency);
			if (!points) {
				points = Array.from({ length: TREND_MONTHS }, (_, index) => ({
					month: MONTH_LABEL.format(monthStart(trendStart, index)),
					wonCents: 0,
					createdCents: 0,
				}));
				trendByCurrency.set(currency, points);
			}
			return points;
		};

		const wonThisMonthMap = new Map<string, CurrencyValue>();
		const wonPrevMonthMap = new Map<string, CurrencyValue>();
		const wonValueWindow = new Map<string, CurrencyValue>();
		let wins = 0;
		let losses = 0;
		let cycleDays = 0;

		for (const deal of recentDeals) {
			const cents = toCents(deal.amount) ?? 0;
			const currency = deal.currency;
			const points = pointsFor(currency);

			const created = points[monthKey(deal.createdAt) - firstBucket];
			if (created) created.createdCents += cents;

			const { closedAt, stage } = deal;
			if (!closedAt) continue;
			const won = stage === DealStage.WON;

			if (won) {
				const closed = points[monthKey(closedAt) - firstBucket];
				if (closed) closed.wonCents += cents;

				if (closedAt >= startOfMonth && closedAt < startOfNextMonth) {
					addCents(wonThisMonthMap, currency, cents, 1);
				} else if (closedAt >= startOfPrevMonth && closedAt < startOfMonth) {
					addCents(wonPrevMonthMap, currency, cents, 1);
				}
			}

			if (closedAt < rateStart) continue;
			if (won) {
				wins += 1;
				addCents(wonValueWindow, currency, cents, 1);
				cycleDays += (closedAt.getTime() - deal.createdAt.getTime()) / DAY_MS;
			} else if (stage === DealStage.LOST) {
				losses += 1;
			}
		}

		const decided = wins + losses;

		const closingMap = new Map<string, CurrencyValue>();
		let closingCount = 0;
		for (const row of closingThisMonthTotals) {
			closingCount += row._count._all;
			addCents(
				closingMap,
				row.currency,
				toCents(row._sum.amount) ?? 0,
				row._count._all,
			);
		}

		return {
			scope: input.scope,
			pipeline: {
				stages,
				totals: valuesOf(pipelineTotals),
				totalDeals: stages.reduce((total, s) => total + s.count, 0),
			},
			wonThisMonth: {
				count: [...wonThisMonthMap.values()].reduce(
					(sum, entry) => sum + entry.count,
					0,
				),
				totals: amountsOf(wonThisMonthMap),
			},
			wonPrevMonth: {
				count: [...wonPrevMonthMap.values()].reduce(
					(sum, entry) => sum + entry.count,
					0,
				),
				totals: amountsOf(wonPrevMonthMap),
			},
			performance: {
				windowDays: RATE_WINDOW_DAYS,
				wins,
				losses,
				winRate: decided === 0 ? null : wins / decided,
				avgDeal: valuesOf(wonValueWindow)
					.filter((entry) => entry.count > 0)
					.map((entry) => ({
						currency: entry.currency,
						valueCents: Math.round(entry.valueCents / entry.count),
					})),
				avgCycleDays: wins === 0 ? null : Math.round(cycleDays / wins),
			},
			trend: [...trendByCurrency.entries()].map(([currency, points]) => ({
				currency,
				points,
			})),
			closingThisMonthTotal: {
				count: closingCount,
				totals: amountsOf(closingMap),
			},
			biggestOpen: biggestOpen.map(
				({ amount, expectedOrderDate, stageChangedAt, ...deal }) => ({
					...deal,
					amountCents: toCents(amount),
					expectedOrderDate: expectedOrderDate?.toISOString() ?? null,
					stageChangedAt: stageChangedAt.toISOString(),
				}),
			),
			overdueTasks: overdueTasks.map(({ dueAt, ...task }) => ({
				...task,
				dueAt: dueAt?.toISOString() ?? null,
			})),
			recentActivity: recentActivity.map(({ createdAt, meta, ...entry }) => ({
				...entry,
				createdAt: createdAt.toISOString(),
				meta: meta as Record<string, unknown> | null,
			})),
		};
	}
}
