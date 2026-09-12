import { type Approval, defineTool } from "eve/tools";
import { z } from "zod";
import { isAutomated } from "../lib/approval";
import { fileMailThread } from "../lib/mail-intake";

const inputSchema = z
	.object({
		threadId: z.string(),
		category: z.enum(["INQUIRY", "PROMOTION", "NOTIFICATION", "OTHER"]),
		evidence: z
			.string()
			.trim()
			.min(1)
			.max(500)
			.describe("What in the messages proves the category and any CRM link."),
		companyId: z.string().nullable().optional(),
		contactId: z.string().nullable().optional(),
		newCustomer: z
			.object({
				name: z.string().trim().min(1).max(200),
				domain: z.string().trim().max(253).nullable().optional(),
				email: z.string().trim().email(),
				personName: z.string().trim().max(200).nullable().optional(),
				phone: z.string().trim().max(100).nullable().optional(),
			})
			.optional(),
	})
	.refine(
		(input) => !input.newCustomer || (!input.companyId && !input.contactId),
		"Choose existing CRM ids or a new customer, not both.",
	);

type FileMailThreadToolInput = z.infer<typeof inputSchema>;

export const approveMailFiling: Approval<FileMailThreadToolInput> = ({
	session,
	toolInput,
}) => {
	if (!isAutomated(session)) return "user-approval";

	const attributes = session.auth.current?.attributes ?? {};
	if (
		attributes.taskKind !== "mail-intake" ||
		attributes.emailThreadId !== toolInput?.threadId
	) {
		return {
			type: "denied",
			reason: "This automated session was not opened for that email thread.",
		};
	}
	if (toolInput?.newCustomer && attributes.allowCreate !== "true") {
		return {
			type: "denied",
			reason: "Customer creation is disabled for this mailbox task.",
		};
	}
	return "not-applicable";
};

export default defineTool({
	description:
		"Classify one email thread and file it against an exact existing CRM match. In a mail-intake task, this is the only tool that may create a customer, and only when the session says creation is enabled. Leave ids empty when the messages do not prove a match.",
	inputSchema,
	approval: approveMailFiling,
	async execute(input, ctx) {
		const attributes = ctx.session.auth.current?.attributes ?? {};
		const automated = isAutomated(ctx.session);
		const actorId = automated
			? typeof attributes.userId === "string"
				? attributes.userId
				: null
			: (ctx.session.auth.current?.principalId ?? null);
		if (!actorId) {
			return { filed: false as const, reason: "No CRM actor was attached." };
		}
		if (
			automated &&
			(attributes.taskKind !== "mail-intake" ||
				attributes.emailThreadId !== input.threadId)
		) {
			return {
				filed: false as const,
				reason: "The task does not own this email thread.",
			};
		}

		return fileMailThread(
			input,
			actorId,
			automated ? attributes.allowCreate === "true" : true,
		);
	},
});
