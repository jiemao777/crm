import { DealStage } from "./generated/prisma/enums";

export const OPEN_INQUIRY_STAGES = [
	DealStage.NEW_INQUIRY,
	DealStage.CONTACTED,
	DealStage.REPLIED,
	DealStage.RFQ_RECEIVED,
	DealStage.QUOTED,
	DealStage.SAMPLE,
	DealStage.NEGOTIATING,
	DealStage.PROFORMA_INVOICE,
] as const;

export const CLOSED_INQUIRY_STAGES = [
	DealStage.WON,
	DealStage.LOST,
	DealStage.UNQUALIFIED,
] as const;

export const LOSING_INQUIRY_STAGES = [
	DealStage.LOST,
	DealStage.UNQUALIFIED,
] as const;

export const INQUIRY_STAGES = [
	...OPEN_INQUIRY_STAGES,
	...CLOSED_INQUIRY_STAGES,
] as const;

const CLOSED = new Set<DealStage>(CLOSED_INQUIRY_STAGES);
const LOSING = new Set<DealStage>(LOSING_INQUIRY_STAGES);

export function isClosedInquiryStage(stage: DealStage): boolean {
	return CLOSED.has(stage);
}

export function isLosingInquiryStage(stage: DealStage): boolean {
	return LOSING.has(stage);
}
