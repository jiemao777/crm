import { z } from "zod";
import { SYNC_SOURCES } from "./google.constants";

export const syncSourceInput = z.object({
	source: z.enum(SYNC_SOURCES),
});

export const setAutoCreateInput = z.object({
	source: z.enum(SYNC_SOURCES),
	enabled: z.boolean(),
});

export const suppressDomainInput = z.object({
	domain: z.string().trim().min(1),
	reason: z.string().trim().max(200).optional(),
	purge: z.boolean().default(true),
});

export const threadInput = z.object({
	threadId: z.string(),
});

export const manualLeadInput = z.object({
	threadId: z.string(),
	companyName: z.string().trim().min(1, "A company name is required.").max(200),
	domain: z.string().trim().max(253).nullable().optional(),
	email: z.string().trim().max(320).email("A valid email is required."),
	firstName: z.string().trim().max(100).nullable().optional(),
	lastName: z.string().trim().max(100).nullable().optional(),
	phone: z.string().trim().max(100).nullable().optional(),
});

export type ManualLeadInput = z.infer<typeof manualLeadInput>;

export const mailFolder = z
	.enum(["all", "inbox", "sent"])
	.or(z.string().min(1));

export const threadListInput = z.object({
	folder: mailFolder.default("all"),
	cursor: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}T[^|]+\|[^|]+$/, "Invalid mail cursor.")
		.optional(),
	limit: z.number().int().min(1).max(100).default(50),
	q: z.string().trim().max(200).optional(),
	unreadOnly: z.boolean().optional(),
	starredOnly: z.boolean().optional(),
	state: z.enum(["active", "trash"]).default("active"),
	link: z.enum(["all", "linked", "unlinked"]).default("all"),
	category: z
		.enum(["INQUIRY", "PROMOTION", "NOTIFICATION", "OTHER"])
		.optional(),
});

export const threadStateInput = z.object({
	threadId: z.string(),
});

export const attachmentInput = z.object({
	attachmentId: z.string(),
});

export const markThreadReadInput = z.object({
	threadId: z.string(),
	read: z.boolean(),
});

export const bulkThreadStateInput = z.object({
	threadIds: z.array(z.string().min(1)).min(1).max(100),
	action: z.enum(["read", "unread", "star", "unstar", "trash", "restore"]),
});

export const sendZohoMailInput = z.object({
	to: z.array(z.string().trim().email()).min(1),
	cc: z.array(z.string().trim().email()).optional(),
	bcc: z.array(z.string().trim().email()).optional(),
	subject: z.string().trim().max(998).default(""),
	body: z.string().max(200_000),
	inReplyTo: z.string().optional(),
	references: z.string().optional(),
});

export type SendZohoMailInput = z.infer<typeof sendZohoMailInput>;

export const draftRecipientInput = z.object({
	email: z.string().trim().email(),
	name: z.string().trim().max(200).nullable().optional(),
});

export const saveDraftInput = z.object({
	draftId: z.string().optional(),
	threadId: z.string().nullable().optional(),
	inReplyTo: z.string().trim().max(998).nullable().optional(),
	references: z.string().trim().max(10_000).nullable().optional(),
	to: z.array(draftRecipientInput).max(100).default([]),
	cc: z.array(draftRecipientInput).max(100).default([]),
	bcc: z.array(draftRecipientInput).max(100).default([]),
	subject: z.string().max(998).default(""),
	body: z.string().max(200_000).default(""),
});

export const draftInput = z.object({
	draftId: z.string(),
});

export const draftAttachmentInput = z.object({
	draftId: z.string(),
	filename: z.string().trim().min(1).max(255),
	mimeType: z.string().trim().max(255).nullable().optional(),
	contentBase64: z.string().min(1).max(14_000_000),
});

export const draftAttachmentDeleteInput = z.object({
	draftId: z.string(),
	attachmentId: z.string(),
});

export const recipientSuggestionInput = z.object({
	q: z.string().trim().max(120).default(""),
	limit: z.number().int().min(1).max(30).default(12),
});

export const sendDraftInput = z.object({
	draftId: z.string(),
});

export type DraftRecipientInput = z.infer<typeof draftRecipientInput>;
export type SaveDraftInput = z.infer<typeof saveDraftInput>;

export const calendarEventInput = z.object({
	eventId: z.string(),
});

export const ZOHO_IMAP_HOSTS = [
	"imap.zoho.com",
	"imap.zoho.eu",
	"imap.zoho.in",
	"imap.zoho.com.au",
	"imap.zoho.jp",
	"imap.zoho.com.cn",
	"imap.zoho.sa",
] as const;

export const zohoConnectInput = z.object({
	email: z.string().trim().email(),
	password: z.string().min(1),
	host: z.enum(ZOHO_IMAP_HOSTS).default("imap.zoho.com"),
});

export type SetAutoCreateInput = z.infer<typeof setAutoCreateInput>;
export type SuppressDomainInput = z.infer<typeof suppressDomainInput>;
export type ZohoConnectInput = z.infer<typeof zohoConnectInput>;
