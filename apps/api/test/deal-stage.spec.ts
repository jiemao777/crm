import { expect, test } from "bun:test";
import { DealStage } from "@crm/db";
import {
	CLOSED_INQUIRY_STAGES,
	isClosedInquiryStage,
	LOSING_INQUIRY_STAGES,
	OPEN_INQUIRY_STAGES,
} from "../src/deals/deal-stage";

test("foreign-trade inquiry stages separate active, won and losing work", () => {
	expect(OPEN_INQUIRY_STAGES).toEqual([
		DealStage.NEW_INQUIRY,
		DealStage.CONTACTED,
		DealStage.REPLIED,
		DealStage.RFQ_RECEIVED,
		DealStage.QUOTED,
		DealStage.SAMPLE,
		DealStage.NEGOTIATING,
		DealStage.PROFORMA_INVOICE,
	]);
	expect(CLOSED_INQUIRY_STAGES).toEqual([
		DealStage.WON,
		DealStage.LOST,
		DealStage.UNQUALIFIED,
	]);
	expect(LOSING_INQUIRY_STAGES).toEqual([
		DealStage.LOST,
		DealStage.UNQUALIFIED,
	]);
	expect(isClosedInquiryStage(DealStage.QUOTED)).toBe(false);
	expect(isClosedInquiryStage(DealStage.WON)).toBe(true);
});
