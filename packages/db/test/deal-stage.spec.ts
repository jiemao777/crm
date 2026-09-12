import { expect, test } from "bun:test";
import {
	CLOSED_INQUIRY_STAGES,
	INQUIRY_STAGES,
	LOSING_INQUIRY_STAGES,
	OPEN_INQUIRY_STAGES,
} from "../src/deal-stage";
import { DealStage } from "../src/generated/prisma/enums";

test("the inquiry lifecycle has one canonical stage vocabulary", () => {
	expect(INQUIRY_STAGES).toEqual([
		DealStage.NEW_INQUIRY,
		DealStage.CONTACTED,
		DealStage.REPLIED,
		DealStage.RFQ_RECEIVED,
		DealStage.QUOTED,
		DealStage.SAMPLE,
		DealStage.NEGOTIATING,
		DealStage.PROFORMA_INVOICE,
		DealStage.WON,
		DealStage.LOST,
		DealStage.UNQUALIFIED,
	]);
	expect(Object.values(DealStage)).toEqual(INQUIRY_STAGES);
	expect(OPEN_INQUIRY_STAGES).toEqual(INQUIRY_STAGES.slice(0, 8));
	expect(CLOSED_INQUIRY_STAGES).toEqual(INQUIRY_STAGES.slice(8));
	expect(LOSING_INQUIRY_STAGES).toEqual([
		DealStage.LOST,
		DealStage.UNQUALIFIED,
	]);
});
