import { db } from "@crm/db";

const threads = await db.emailThread.findMany({
	where: { id: "cmsmttmrv000nqgu8eqj1bg6n" },
	select: {
		messages: {
			select: {
				fromEmail: true,
				bodyHtml: true,
				attachments: { select: { filename: true, contentId: true } },
			},
		},
	},
});
for (const t of threads) {
	for (const m of t.messages) {
		const hasCid = m.bodyHtml?.includes("cid:") ?? false;
		console.log(
			"-",
			m.fromEmail,
			"| html:",
			m.bodyHtml ? `${m.bodyHtml.length} chars` : "无",
			"| cid:",
			hasCid,
			"| 附件:",
			m.attachments.length,
		);
		if (hasCid) {
			const cids = m.bodyHtml.match(/cid:[^"']+/g)?.slice(0, 3) ?? [];
			console.log("  cid 引用:", cids);
			console.log(
				"  附件 contentId:",
				m.attachments.map((a) => a.contentId).slice(0, 3),
			);
		}
	}
}
await db.$disconnect();
