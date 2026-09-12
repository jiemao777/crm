import { isClosedInquiryStage } from "./deal-stage";
import { DealStage } from "./generated/prisma/enums";

export const STAGE_CADENCE_DAYS: Partial<Record<DealStage, number>> = {
	[DealStage.NEW_INQUIRY]: 3,
	[DealStage.CONTACTED]: 7,
	[DealStage.REPLIED]: 7,
	[DealStage.RFQ_RECEIVED]: 10,
	[DealStage.QUOTED]: 14,
	[DealStage.SAMPLE]: 21,
	[DealStage.NEGOTIATING]: 14,
	[DealStage.PROFORMA_INVOICE]: 21,
};

const ACTIVITY_FULL_DAYS = 3;
const ACTIVITY_DEAD_DAYS = 30;

export type InquiryScoreInput = {
	stage: DealStage;
	stageChangedAt: Date;
	lastActivityAt: Date | null;
	contactCount: number;
	contactsWithRole: number;
	hasAmount: boolean;
	hasQuantity: boolean;
	hasTradeTerms: boolean;
	now: Date;
};

export type InquiryScore = {
	score: number;
	breakdown: {
		stagnation: number;
		activity: number;
		contacts: number;
		completeness: number;
	};
	daysInStage: number;
	daysSinceActivity: number | null;
	stalled: boolean;
};

function wholeDays(from: Date, to: Date): number {
	return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

function decay(days: number, fullAt: number, deadAt: number, points: number) {
	if (days <= fullAt) return points;
	if (days >= deadAt) return 0;
	return Math.round(points * (1 - (days - fullAt) / (deadAt - fullAt)));
}

export function scoreInquiry(input: InquiryScoreInput): InquiryScore | null {
	if (isClosedInquiryStage(input.stage)) return null;

	const cadence = STAGE_CADENCE_DAYS[input.stage] ?? 14;
	const daysInStage = wholeDays(input.stageChangedAt, input.now);
	const daysSinceActivity = input.lastActivityAt
		? wholeDays(input.lastActivityAt, input.now)
		: null;

	const stagnation = decay(daysInStage, cadence, cadence * 3, 40);
	const activity =
		daysSinceActivity === null
			? 0
			: decay(daysSinceActivity, ACTIVITY_FULL_DAYS, ACTIVITY_DEAD_DAYS, 30);
	const contacts =
		input.contactCount === 0 ? 0 : 12 + (input.contactsWithRole > 0 ? 8 : 0);
	const completeness =
		(input.hasAmount ? 4 : 0) +
		(input.hasQuantity ? 3 : 0) +
		(input.hasTradeTerms ? 3 : 0);

	return {
		score: stagnation + activity + contacts + completeness,
		breakdown: { stagnation, activity, contacts, completeness },
		daysInStage,
		daysSinceActivity,
		stalled: daysInStage > cadence,
	};
}
