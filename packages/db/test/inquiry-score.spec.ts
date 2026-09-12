import { describe, expect, test } from "bun:test";
import { DealStage } from "../src/generated/prisma/enums";
import { scoreInquiry } from "../src/inquiry-score";

const now = new Date("2026-09-12T00:00:00.000Z");

function daysAgo(days: number): Date {
	return new Date(now.getTime() - days * 86_400_000);
}

function healthy() {
	return {
		stage: DealStage.QUOTED,
		stageChangedAt: daysAgo(2),
		lastActivityAt: daysAgo(1),
		contactCount: 2,
		contactsWithRole: 1,
		hasAmount: true,
		hasQuantity: true,
		hasTradeTerms: true,
		now,
	};
}

describe("scoreInquiry", () => {
	test("a fresh, fully covered inquiry scores 100", () => {
		expect(scoreInquiry(healthy())?.score).toBe(100);
	});

	test("closed inquiries are not scored", () => {
		for (const stage of [
			DealStage.WON,
			DealStage.LOST,
			DealStage.UNQUALIFIED,
		]) {
			expect(scoreInquiry({ ...healthy(), stage })).toBeNull();
		}
	});

	test("stage age decays to nothing at three times the cadence", () => {
		const stalled = scoreInquiry({
			...healthy(),
			stageChangedAt: daysAgo(42),
		});
		expect(stalled?.breakdown.stagnation).toBe(0);
		expect(stalled?.stalled).toBe(true);

		const fresh = scoreInquiry(healthy());
		expect(fresh?.breakdown.stagnation).toBe(40);
		expect(fresh?.stalled).toBe(false);
	});

	test("a quoted inquiry tolerates a fortnight, a new one does not", () => {
		const quoted = scoreInquiry({ ...healthy(), stageChangedAt: daysAgo(10) });
		expect(quoted?.breakdown.stagnation).toBe(40);

		const fresh = scoreInquiry({
			...healthy(),
			stage: DealStage.NEW_INQUIRY,
			stageChangedAt: daysAgo(10),
		});
		expect(fresh?.breakdown.stagnation).toBe(0);
	});

	test("silence costs the activity third, and no activity costs all of it", () => {
		const quiet = scoreInquiry({ ...healthy(), lastActivityAt: daysAgo(30) });
		expect(quiet?.breakdown.activity).toBe(0);

		const none = scoreInquiry({ ...healthy(), lastActivityAt: null });
		expect(none?.breakdown.activity).toBe(0);
		expect(none?.daysSinceActivity).toBeNull();
	});

	test("a named role is worth more than a bare contact", () => {
		const bare = scoreInquiry({
			...healthy(),
			contactCount: 1,
			contactsWithRole: 0,
		});
		expect(bare?.breakdown.contacts).toBe(12);

		const nobody = scoreInquiry({
			...healthy(),
			contactCount: 0,
			contactsWithRole: 0,
		});
		expect(nobody?.breakdown.contacts).toBe(0);
	});

	test("completeness is additive and capped at ten", () => {
		const empty = scoreInquiry({
			...healthy(),
			hasAmount: false,
			hasQuantity: false,
			hasTradeTerms: false,
		});
		expect(empty?.breakdown.completeness).toBe(0);

		const partial = scoreInquiry({ ...healthy(), hasTradeTerms: false });
		expect(partial?.breakdown.completeness).toBe(7);
	});

	test("a neglected inquiry lands far below a healthy one", () => {
		const neglected = scoreInquiry({
			stage: DealStage.NEW_INQUIRY,
			stageChangedAt: daysAgo(20),
			lastActivityAt: null,
			contactCount: 0,
			contactsWithRole: 0,
			hasAmount: false,
			hasQuantity: false,
			hasTradeTerms: false,
			now,
		});
		expect(neglected?.score).toBe(0);
	});
});
