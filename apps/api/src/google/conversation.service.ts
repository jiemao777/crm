import { ActivityType, type Db, EmailDirection, type Prisma } from "@crm/db";
import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { requireWorkspaceRole } from "../crm/access";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { InjectDatabase } from "../database/database.constants";
import { GoogleMatchService } from "./google-match.service";
import { normaliseMessageId, snippetOf } from "./mime";
import type { Participant } from "./participants";

@Injectable()
export class ConversationService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly match: GoogleMatchService,
		private readonly stamp: ActivityStampService,
	) {}

	async thread(threadId: string, userId?: string) {
		await this.requireMember(userId);
		const thread = await this.db.emailThread.findUnique({
			where: { id: threadId },
			select: {
				id: true,
				subject: true,
				messageCount: true,
				firstMessageAt: true,
				lastMessageAt: true,
				company: { select: { id: true, name: true, timezone: true } },
				contact: { select: { id: true, firstName: true, lastName: true } },
				messages: {
					orderBy: { sentAt: "desc" },
					select: {
						id: true,
						direction: true,
						fromEmail: true,
						fromName: true,
						recipients: true,
						subject: true,
						body: true,
						bodyHtml: true,
						snippet: true,
						sentAt: true,
						gmailMessageId: true,
						rfcMessageId: true,
						isRead: true,
						starred: true,
						attachments: {
							select: {
								id: true,
								filename: true,
								mimeType: true,
								size: true,
								contentId: true,
							},
							orderBy: { filename: "asc" },
						},
					},
				},
			},
		});

		if (!thread) {
			throw new NotFoundException(`No email thread with id ${threadId}.`);
		}

		const faces = await this.facesFor(
			thread.messages.map((message) => message.fromEmail),
		);

		return {
			...thread,
			firstMessageAt: thread.firstMessageAt.toISOString(),
			lastMessageAt: thread.lastMessageAt.toISOString(),
			messages: thread.messages.map((message) => ({
				...message,
				sentAt: message.sentAt.toISOString(),
				recipients: recipientsOf(message.recipients),
				fromImageUrl: faces.get(message.fromEmail.toLowerCase()) ?? null,
				gmailUrl: message.gmailMessageId
					? `https://mail.google.com/mail/u/0/#all/${message.gmailMessageId}`
					: null,
			})),
		};
	}

	private async facesFor(addresses: string[]): Promise<Map<string, string>> {
		const emails = [
			...new Set(addresses.map((address) => address.toLowerCase())),
		];
		if (emails.length === 0) return new Map();

		const [contacts, users] = await Promise.all([
			this.db.contact.findMany({
				where: { email: { in: emails, mode: "insensitive" } },
				select: { email: true, imageUrl: true },
			}),
			this.db.user.findMany({
				where: { email: { in: emails, mode: "insensitive" } },
				select: { email: true, image: true },
			}),
		]);

		const faces = new Map<string, string>();
		for (const contact of contacts) {
			if (contact.email && contact.imageUrl) {
				faces.set(contact.email.toLowerCase(), contact.imageUrl);
			}
		}
		for (const user of users) {
			if (user.image) faces.set(user.email.toLowerCase(), user.image);
		}

		return faces;
	}

	async threads(
		input: {
			folder: "all" | "inbox" | "sent" | (string & {});
			cursor?: string;
			limit?: number;
			q?: string;
			unreadOnly?: boolean;
			starredOnly?: boolean;
			state?: "active" | "trash";
			link?: "all" | "linked" | "unlinked";
			category?: "INQUIRY" | "PROMOTION" | "NOTIFICATION" | "OTHER";
		},
		userId?: string,
	) {
		await this.requireMember(userId);
		const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
		const state =
			input.folder === "crm-trash" ? "trash" : (input.state ?? "active");
		const link = input.link ?? "all";
		const whereFolder: Prisma.EmailThreadWhereInput =
			input.folder === "all" || input.folder === "crm-trash"
				? {}
				: input.folder === "inbox"
					? { messages: { some: { direction: "INBOUND" } } }
					: input.folder === "sent"
						? { messages: { some: { direction: "OUTBOUND" } } }
						: {
								messages: {
									some: {
										zohoMailboxFolder: { path: input.folder },
									},
								},
							};
		const search = input.q?.trim();
		const searchWhere: Prisma.EmailThreadWhereInput = search
			? {
					OR: [
						{ subject: { contains: search, mode: "insensitive" } },
						{
							messages: {
								some: {
									OR: [
										{ fromEmail: { contains: search, mode: "insensitive" } },
										{ fromName: { contains: search, mode: "insensitive" } },
										{ body: { contains: search, mode: "insensitive" } },
									],
								},
							},
						},
					],
				}
			: {};
		const unreadWhere: Prisma.EmailThreadWhereInput = input.unreadOnly
			? { messages: { some: { isRead: false } } }
			: {};
		const starredWhere: Prisma.EmailThreadWhereInput = input.starredOnly
			? { messages: { some: { starred: true } } }
			: {};
		const stateWhere: Prisma.EmailThreadWhereInput =
			state === "trash"
				? {
						messages: {
							some: { deletedAt: { not: null } },
							none: { deletedAt: null },
						},
					}
				: { messages: { none: { deletedAt: { not: null } } } };
		const linkWhere: Prisma.EmailThreadWhereInput =
			link === "linked"
				? { OR: [{ companyId: { not: null } }, { contactId: { not: null } }] }
				: link === "unlinked"
					? { companyId: null, contactId: null }
					: {};
		const categoryWhere: Prisma.EmailThreadWhereInput = input.category
			? { category: input.category }
			: {};
		const cursor = input.cursor ? parseCursor(input.cursor) : undefined;

		const rows = await this.db.emailThread.findMany({
			where: {
				AND: [
					stateWhere,
					whereFolder,
					searchWhere,
					unreadWhere,
					starredWhere,
					linkWhere,
					categoryWhere,
				],
				...(cursor
					? {
							OR: [
								{ lastMessageAt: { lt: cursor.lastMessageAt } },
								{
									lastMessageAt: cursor.lastMessageAt,
									id: { lt: cursor.id },
								},
							],
						}
					: {}),
			},
			orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
			take: limit + 1,
			select: {
				id: true,
				subject: true,
				messageCount: true,
				firstMessageAt: true,
				lastMessageAt: true,
				company: { select: { id: true, name: true } },
				contact: {
					select: { id: true, firstName: true, lastName: true },
				},
				messages: {
					orderBy: { sentAt: "desc" },
					take: 5,
					select: {
						id: true,
						direction: true,
						fromEmail: true,
						fromName: true,
						snippet: true,
						sentAt: true,
						isRead: true,
						starred: true,
					},
				},
			},
		});

		const hasMore = rows.length > limit;
		const page = hasMore ? rows.slice(0, limit) : rows;
		const last = page[page.length - 1];

		return {
			threads: page.map((row) => ({
				id: row.id,
				subject: row.subject,
				messageCount: row.messageCount,
				firstMessageAt: row.firstMessageAt.toISOString(),
				lastMessageAt: row.lastMessageAt.toISOString(),
				unread: row.messages.some((message) => !message.isRead),
				starred: row.messages.some((message) => message.starred),
				linked: Boolean(row.company || row.contact),
				company: row.company,
				contact: row.contact
					? {
							id: row.contact.id,
							name: [row.contact.firstName, row.contact.lastName]
								.filter(Boolean)
								.join(" "),
						}
					: null,
				latest: row.messages[0] ?? null,
			})),
			nextCursor:
				hasMore && last
					? `${last.lastMessageAt.toISOString()}|${last.id}`
					: null,
		};
	}

	async bulkThreadState(
		input: {
			threadIds: string[];
			action: "read" | "unread" | "star" | "unstar" | "trash" | "restore";
		},
		userId?: string,
	): Promise<{ updated: number }> {
		await this.requireMember(userId);
		const threadIds = [...new Set(input.threadIds)];
		const existing = await this.db.emailThread.count({
			where: { id: { in: threadIds } },
		});
		if (existing !== threadIds.length) {
			throw new NotFoundException("One or more email threads were not found.");
		}

		const messageWhere = { threadId: { in: threadIds } };
		if (input.action === "read" || input.action === "unread") {
			await this.db.emailMessage.updateMany({
				where: messageWhere,
				data: { isRead: input.action === "read" },
			});
		} else if (input.action === "star" || input.action === "unstar") {
			await this.db.emailMessage.updateMany({
				where: messageWhere,
				data: { starred: input.action === "star" },
			});
		} else {
			await this.db.emailMessage.updateMany({
				where: messageWhere,
				data: { deletedAt: input.action === "trash" ? new Date() : null },
			});
		}

		return { updated: threadIds.length };
	}

	async recipientSuggestions(
		input: { q?: string; limit?: number },
		userId?: string,
	): Promise<
		{
			email: string;
			name: string | null;
			source: "contact" | "history" | "user";
		}[]
	> {
		await this.requireMember(userId);
		const q = input.q?.trim() ?? "";
		const limit = Math.min(Math.max(input.limit ?? 12, 1), 30);
		const pattern = q || undefined;
		const [contacts, users, messages] = await Promise.all([
			this.db.contact.findMany({
				where: pattern
					? {
							OR: [
								{ email: { contains: pattern, mode: "insensitive" } },
								{ firstName: { contains: pattern, mode: "insensitive" } },
								{ lastName: { contains: pattern, mode: "insensitive" } },
							],
						}
					: {},
				take: limit,
				orderBy: [
					{ lastActivityAt: { sort: "desc", nulls: "last" } },
					{ createdAt: "desc" },
				],
				select: { email: true, firstName: true, lastName: true },
			}),
			this.db.user.findMany({
				where: pattern
					? {
							OR: [
								{ email: { contains: pattern, mode: "insensitive" } },
								{ name: { contains: pattern, mode: "insensitive" } },
							],
						}
					: {},
				take: limit,
				orderBy: { name: "asc" },
				select: { email: true, name: true },
			}),
			this.db.emailMessage.findMany({
				where: pattern
					? {
							OR: [
								{ fromEmail: { contains: pattern, mode: "insensitive" } },
								{ fromName: { contains: pattern, mode: "insensitive" } },
							],
						}
					: {},
				take: Math.max(limit * 4, 24),
				orderBy: { sentAt: "desc" },
				select: { fromEmail: true, fromName: true, recipients: true },
			}),
		]);

		const suggestions: {
			email: string;
			name: string | null;
			source: "contact" | "history" | "user";
		}[] = [];
		const seen = new Set<string>();
		const add = (
			email: string | null,
			name: string | null,
			source: "contact" | "history" | "user",
		) => {
			const normalized = email?.trim().toLowerCase();
			if (!normalized || seen.has(normalized)) return;
			if (
				q &&
				!`${normalized} ${name ?? ""}`.toLowerCase().includes(q.toLowerCase())
			)
				return;
			seen.add(normalized);
			suggestions.push({
				email: normalized,
				name: name?.trim() || null,
				source,
			});
		};

		for (const contact of contacts) {
			add(
				contact.email,
				[contact.firstName, contact.lastName].filter(Boolean).join(" ") || null,
				"contact",
			);
		}
		for (const user of users) add(user.email, user.name, "user");
		for (const message of messages) {
			add(message.fromEmail, message.fromName, "history");
			for (const recipient of recipientsOf(message.recipients)) {
				add(recipient.email, recipient.name, "history");
			}
		}

		return suggestions.slice(0, limit);
	}

	async event(eventId: string, userId?: string) {
		await this.requireMember(userId);
		const event = await this.db.calendarEvent.findUnique({
			where: { id: eventId },
			select: {
				id: true,
				title: true,
				description: true,
				location: true,
				conferenceUrl: true,
				startsAt: true,
				endsAt: true,
				isAllDay: true,
				status: true,
				organizerEmail: true,
				company: { select: { id: true, name: true } },
				contact: { select: { id: true, firstName: true, lastName: true } },
				attendees: {
					orderBy: [{ isOrganizer: "desc" }, { email: "asc" }],
					select: {
						id: true,
						email: true,
						name: true,
						responseStatus: true,
						isOrganizer: true,
						contactId: true,
						contact: { select: { imageUrl: true } },
					},
				},
			},
		});

		if (!event) {
			throw new NotFoundException(`No calendar event with id ${eventId}.`);
		}

		return {
			...event,
			startsAt: event.startsAt.toISOString(),
			endsAt: event.endsAt.toISOString(),
			attendees: event.attendees.map(({ contact, ...attendee }) => ({
				...attendee,
				imageUrl: contact?.imageUrl ?? null,
			})),
		};
	}

	async markThreadRead(
		threadId: string,
		read: boolean,
		userId?: string,
	): Promise<void> {
		await this.assertThread(threadId, userId);
		await this.db.emailMessage.updateMany({
			where: { threadId },
			data: { isRead: read },
		});
	}

	async toggleThreadStar(threadId: string, userId?: string): Promise<boolean> {
		await this.assertThread(threadId, userId);
		const latest = await this.db.emailMessage.findFirst({
			where: { threadId },
			orderBy: { sentAt: "desc" },
			select: { id: true, starred: true },
		});
		if (!latest) return false;
		const next = !latest.starred;
		await this.db.emailMessage.update({
			where: { id: latest.id },
			data: { starred: next },
		});
		return next;
	}

	async trashThread(threadId: string, userId?: string): Promise<void> {
		await this.assertThread(threadId, userId);
		await this.db.emailMessage.updateMany({
			where: { threadId },
			data: { deletedAt: new Date() },
		});
	}

	async restoreThread(threadId: string, userId?: string): Promise<void> {
		await this.assertThread(threadId, userId);
		await this.db.emailMessage.updateMany({
			where: { threadId },
			data: { deletedAt: null },
		});
	}

	async recordOutbound(
		input: {
			messageId: string;
			fromEmail: string;
			fromName?: string | null;
			to: { email: string; name?: string | null }[];
			cc: { email: string; name?: string | null }[];
			bcc: { email: string; name?: string | null }[];
			subject: string;
			body: string;
			sentAt: Date;
			threadId?: string | null;
			inReplyTo?: string | null;
			attachments?: {
				filename: string;
				mimeType?: string | null;
				size: number;
				content: Buffer;
			}[];
		},
		userId: string,
	) {
		await this.requireMember(userId);
		const rfcMessageId = normaliseMessageId(input.messageId);
		if (!rfcMessageId)
			throw new BadRequestException("A valid Message-ID is required.");

		const existing = await this.db.emailMessage.findUnique({
			where: { rfcMessageId },
			select: { id: true, threadId: true },
		});
		if (existing) return existing;

		let threadId = input.threadId ?? null;
		if (!threadId && input.inReplyTo) {
			const parent = await this.db.emailMessage.findUnique({
				where: { rfcMessageId: normaliseMessageId(input.inReplyTo) },
				select: { threadId: true },
			});
			threadId = parent?.threadId ?? null;
		}

		let existingThread = threadId
			? await this.db.emailThread.findUnique({
					where: { id: threadId },
					select: { id: true, companyId: true, contactId: true },
				})
			: null;
		if (threadId && !existingThread) threadId = null;

		const recipients = [
			...input.to.map((entry) => ({ ...entry, kind: "to" })),
			...input.cc.map((entry) => ({ ...entry, kind: "cc" })),
			...input.bcc.map((entry) => ({ ...entry, kind: "bcc" })),
		];
		if (
			existingThread &&
			!existingThread.companyId &&
			!existingThread.contactId
		) {
			const link = await this.outboundLink(recipients);
			if (link.companyId || link.contactId) {
				existingThread = await this.db.emailThread.update({
					where: { id: existingThread.id },
					data: link,
					select: { id: true, companyId: true, contactId: true },
				});
			}
		}

		const link = existingThread
			? {
					companyId: existingThread.companyId,
					contactId: existingThread.contactId,
				}
			: await this.outboundLink(recipients);
		const thread = existingThread
			? existingThread
			: await this.db.emailThread.create({
					data: {
						rootMessageId: rfcMessageId,
						subject: input.subject.trim() || null,
						companyId: link.companyId,
						contactId: link.contactId,
						firstMessageAt: input.sentAt,
						lastMessageAt: input.sentAt,
						messageCount: 0,
					},
					select: { id: true, companyId: true, contactId: true },
				});
		let message: { id: string; threadId: string };
		try {
			message = await this.db.emailMessage.create({
				data: {
					threadId: thread.id,
					rfcMessageId,
					syncedByUserId: userId,
					syncs: { create: { userId, source: "crm-smtp" } },
					direction: EmailDirection.OUTBOUND,
					fromEmail: input.fromEmail.toLowerCase(),
					fromName: input.fromName ?? null,
					recipients,
					subject: input.subject.trim() || null,
					snippet: snippetOf(input.body),
					body: input.body || null,
					sentAt: input.sentAt,
					isRead: true,
				},
				select: { id: true, threadId: true },
			});
		} catch (error) {
			const duplicate = await this.db.emailMessage.findUnique({
				where: { rfcMessageId },
				select: { id: true, threadId: true },
			});
			if (!duplicate) throw error;
			return duplicate;
		}

		if (input.attachments?.length) {
			await this.db.emailAttachment.createMany({
				data: input.attachments.map((attachment) => ({
					messageId: message.id,
					filename: attachment.filename,
					mimeType: attachment.mimeType ?? null,
					size: attachment.size,
					content: new Uint8Array(attachment.content),
				})),
			});
		}

		const stats = await this.db.emailMessage.aggregate({
			where: { threadId: thread.id },
			_count: { _all: true },
			_min: { sentAt: true },
			_max: { sentAt: true },
		});
		const firstMessageAt = stats._min.sentAt ?? input.sentAt;
		const lastMessageAt = stats._max.sentAt ?? input.sentAt;
		await this.db.emailThread.update({
			where: { id: thread.id },
			data: {
				messageCount: stats._count._all,
				firstMessageAt,
				lastMessageAt,
				...(input.subject.trim() ? { subject: input.subject.trim() } : {}),
			},
		});
		await this.db.activity.upsert({
			where: { emailThreadId: thread.id },
			create: {
				type: ActivityType.EMAIL,
				subject: input.subject.trim() || "(no subject)",
				body: snippetOf(input.body),
				occurredAt: lastMessageAt,
				companyId: thread.companyId,
				contactId: thread.contactId,
				createdById: userId,
				emailThreadId: thread.id,
				meta: { source: "crm-smtp" },
			},
			update: {
				subject: input.subject.trim() || "(no subject)",
				body: snippetOf(input.body),
				occurredAt: lastMessageAt,
				companyId: thread.companyId,
				contactId: thread.contactId,
			},
		});
		await this.stamp.touch(
			{ companyId: thread.companyId, contactId: thread.contactId },
			lastMessageAt,
		);

		return message;
	}

	private async outboundLink(
		recipients: { email: string }[],
	): Promise<{ companyId: string | null; contactId: string | null }> {
		const emails = [
			...new Set(
				recipients
					.map((recipient) => recipient.email.trim().toLowerCase())
					.filter(Boolean),
			),
		];
		if (emails.length === 0) return { companyId: null, contactId: null };

		const contacts = await this.db.contact.findMany({
			where: { email: { in: emails, mode: "insensitive" } },
			select: { id: true, email: true, companyId: true },
		});
		const byEmail = new Map(
			contacts.flatMap((contact) =>
				contact.email ? [[contact.email.toLowerCase(), contact] as const] : [],
			),
		);
		const contact = emails
			.map((email) => byEmail.get(email))
			.find((entry) => entry !== undefined);
		return {
			companyId: contact?.companyId ?? null,
			contactId: contact?.id ?? null,
		};
	}

	async attachment(attachmentId: string, userId?: string) {
		await this.requireMember(userId);
		const row = await this.db.emailAttachment.findUnique({
			where: { id: attachmentId },
			select: {
				id: true,
				filename: true,
				mimeType: true,
				size: true,
			},
		});
		if (!row) {
			throw new NotFoundException(`No attachment with id ${attachmentId}.`);
		}
		return {
			id: row.id,
			filename: row.filename,
			mimeType: row.mimeType,
			size: row.size,
		};
	}

	async attachmentContent(attachmentId: string, userId?: string) {
		await this.requireMember(userId);
		const row = await this.db.emailAttachment.findUnique({
			where: { id: attachmentId },
			select: {
				id: true,
				filename: true,
				mimeType: true,
				size: true,
				content: true,
			},
		});
		if (!row) {
			throw new NotFoundException(`No attachment with id ${attachmentId}.`);
		}
		return row;
	}

	async folderCounts(
		userId?: string,
	): Promise<{ path: string; kind: string; total: number; unread: number }[]> {
		await this.requireMember(userId);
		const folders = await this.db.zohoMailboxFolder.findMany({
			select: {
				id: true,
				path: true,
				kind: true,
				_count: {
					select: {
						messages: {
							where: { deletedAt: null },
						},
					},
				},
			},
		});

		const providerCounts = await Promise.all(
			folders.map(async (folder) => {
				const unread = await this.db.emailMessage.count({
					where: {
						zohoMailboxFolderId: folder.id,
						deletedAt: null,
						isRead: false,
					},
				});
				return {
					path: folder.path,
					kind: folder.kind,
					total: folder._count.messages,
					unread,
				};
			}),
		);
		const [trashTotal, trashUnread] = await Promise.all([
			this.db.emailThread.count({
				where: {
					messages: {
						some: { deletedAt: { not: null } },
						none: { deletedAt: null },
					},
				},
			}),
			this.db.emailMessage.count({
				where: { deletedAt: { not: null }, isRead: false },
			}),
		]);

		return [
			...providerCounts,
			{
				path: "crm-trash",
				kind: "CRM",
				total: trashTotal,
				unread: trashUnread,
			},
		];
	}

	async relinkUnmatched(
		limit = 200,
		ownerId?: string | null,
	): Promise<{ relinked: number; scanned: number }> {
		await this.requireMember(ownerId ?? undefined);
		const identity = await this.match.internalIdentity();

		const rows = await this.db.emailThread.findMany({
			where: { companyId: null, contactId: null },
			take: limit,
			select: {
				id: true,
				subject: true,
				lastMessageAt: true,
				messages: {
					orderBy: { sentAt: "desc" },
					take: 1,
					select: {
						fromEmail: true,
						fromName: true,
						body: true,
						sentAt: true,
					},
				},
			},
		});

		let relinked = 0;
		for (const row of rows) {
			const participants: Participant[] = row.messages.map((message) => ({
				email: message.fromEmail,
				name: message.fromName ?? null,
			}));
			const external = participants.filter(
				(person) => !identity.addresses.has(person.email),
			);
			if (external.length === 0) continue;

			const contact = await this.db.contact.findFirst({
				where: { email: { in: external.map((person) => person.email) } },
				select: { id: true, companyId: true },
			});
			if (!contact) continue;

			await this.db.emailThread.update({
				where: { id: row.id },
				data: {
					companyId: contact.companyId,
					contactId: contact.id,
				},
			});
			await this.db.activity.upsert({
				where: { emailThreadId: row.id },
				create: {
					type: ActivityType.EMAIL,
					subject: row.subject ?? "(no subject)",
					body: (row.messages[0]?.body ?? "").slice(0, 200) || null,
					occurredAt: row.lastMessageAt,
					companyId: contact.companyId,
					contactId: contact.id,
					createdById: ownerId ?? (await this.firstUserId()),
					emailThreadId: row.id,
					meta: { synced: true, source: "zoho-imap" },
				},
				update: {
					companyId: contact.companyId,
					contactId: contact.id,
				},
			});
			relinked += 1;
		}

		return { relinked, scanned: rows.length };
	}

	private async firstUserId(): Promise<string> {
		const user = await this.db.user.findFirst({
			select: { id: true },
			orderBy: { createdAt: "asc" },
		});
		return user?.id ?? "system";
	}

	private async requireMember(userId?: string): Promise<void> {
		if (userId) await requireWorkspaceRole(this.db, userId);
	}

	private async assertThread(threadId: string, userId?: string): Promise<void> {
		await this.requireMember(userId);
		const exists = await this.db.emailThread.findUnique({
			where: { id: threadId },
			select: { id: true },
		});
		if (!exists) {
			throw new NotFoundException(`No email thread with id ${threadId}.`);
		}
	}
}

function recipientsOf(
	value: unknown,
): { email: string; name: string | null; kind: string }[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const record = entry as Record<string, unknown>;
		if (typeof record.email !== "string") return [];

		return [
			{
				email: record.email,
				name: typeof record.name === "string" ? record.name : null,
				kind: typeof record.kind === "string" ? record.kind : "to",
			},
		];
	});
}

function parseCursor(value: string): { lastMessageAt: Date; id: string } {
	const separator = value.lastIndexOf("|");
	const date = new Date(value.slice(0, separator));
	const id = value.slice(separator + 1);
	if (separator <= 0 || !id || Number.isNaN(date.getTime())) {
		throw new BadRequestException("Invalid mail cursor.");
	}
	return { lastMessageAt: date, id };
}
