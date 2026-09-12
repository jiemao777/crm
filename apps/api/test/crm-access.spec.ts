import { describe, expect, it } from "bun:test";
import type { Db } from "@crm/db";
import { ActivityType } from "@crm/db";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ActivitiesService } from "../src/activities/activities.service";
import {
	assertCompanyAccess,
	requireWorkspaceRole,
	resolveOwnerId,
} from "../src/crm/access";
import { AuthMiddleware } from "../src/trpc/middlewares/auth.middleware";

type Fixture = {
	members?: Record<string, string>;
	companies?: Record<string, { ownerId: string | null }>;
	contacts?: Record<
		string,
		{ ownerId: string | null; companyId: string | null }
	>;
	deals?: Record<string, { ownerId: string; companyId: string }>;
};

function fakeDb(fixture: Fixture = {}): Db {
	const members = fixture.members ?? {};
	const companies = fixture.companies ?? {};
	const contacts = fixture.contacts ?? {};
	const deals = fixture.deals ?? {};

	return {
		member: {
			findUnique: async (args: unknown) => {
				const userId = (
					args as { where: { organizationId_userId: { userId: string } } }
				).where.organizationId_userId.userId;
				const role = members[userId];
				return role ? { userId, role } : null;
			},
		},
		company: {
			findUnique: async (args: unknown) => {
				const id = (args as { where: { id: string } }).where.id;
				const row = companies[id];
				return row ? { id, ...row } : null;
			},
		},
		contact: {
			findUnique: async (args: unknown) => {
				const id = (args as { where: { id: string } }).where.id;
				const row = contacts[id];
				return row ? { id, ...row } : null;
			},
		},
		deal: {
			findUnique: async (args: unknown) => {
				const id = (args as { where: { id: string } }).where.id;
				const row = deals[id];
				return row ? { id, ...row } : null;
			},
		},
		activity: {
			create: async () => {
				throw new Error("activity.create should not be reached");
			},
		},
	} as unknown as Db;
}

describe("workspace access", () => {
	it("rejects a signed-in user who is not a member", async () => {
		const middleware = new AuthMiddleware(fakeDb());
		const options = {
			ctx: { session: { user: { id: "outsider" } } },
			next: async ({ ctx }: { ctx: unknown }) => ({ ctx }),
		};

		await expect(middleware.use(options as never)).rejects.toBeInstanceOf(
			ForbiddenException,
		);
	});

	it("lets an admin assign only to another workspace member", async () => {
		const db = fakeDb({ members: { admin: "admin", member: "member" } });

		expect(await requireWorkspaceRole(db, "admin")).toBe("admin");
		expect(await resolveOwnerId(db, "admin", "member")).toBe("member");
		await expect(
			resolveOwnerId(db, "admin", "outsider"),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it("does not let a member mutate a company owned by someone else", async () => {
		const db = fakeDb({
			members: { member: "member" },
			companies: { company: { ownerId: "other" } },
		});

		await expect(
			assertCompanyAccess(db, "member", "company"),
		).rejects.toBeInstanceOf(ForbiddenException);
	});
});

describe("activity associations", () => {
	it("rejects a cross-company contact and inquiry combination", async () => {
		const db = fakeDb({
			members: { admin: "admin" },
			companies: {
				companyA: { ownerId: "admin" },
				companyB: { ownerId: "admin" },
			},
			contacts: {
				contactB: { ownerId: "admin", companyId: "companyB" },
			},
			deals: { dealA: { ownerId: "admin", companyId: "companyA" } },
		});
		const service = new ActivitiesService(db, {
			touch: async () => undefined,
		} as never);

		await expect(
			service.create(
				{
					type: ActivityType.NOTE,
					body: "cross-link",
					dealId: "dealA",
					contactId: "contactB",
				},
				"admin",
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});
});
