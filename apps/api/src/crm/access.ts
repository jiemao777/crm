import {
	isWorkspaceAdmin,
	isWorkspaceRole,
	WORKSPACE_ID,
	type WorkspaceRole,
} from "@crm/auth";
import type { Db } from "@crm/db";
import { ForbiddenException, NotFoundException } from "@nestjs/common";

export async function workspaceRole(
	db: Db,
	userId: string,
): Promise<WorkspaceRole | null> {
	const member = await db.member.findUnique({
		where: {
			organizationId_userId: {
				organizationId: WORKSPACE_ID,
				userId,
			},
		},
		select: { role: true },
	});

	return member && isWorkspaceRole(member.role) ? member.role : null;
}

export async function requireWorkspaceRole(
	db: Db,
	userId: string,
): Promise<WorkspaceRole> {
	const role = await workspaceRole(db, userId);
	if (!role) {
		throw new ForbiddenException("You are not a member of this workspace.");
	}
	return role;
}

export async function requireWorkspaceAdmin(
	db: Db,
	userId: string,
): Promise<WorkspaceRole> {
	const role = await requireWorkspaceRole(db, userId);
	if (!isWorkspaceAdmin(role)) {
		throw new ForbiddenException(
			"Only an owner or an admin can perform this action.",
		);
	}
	return role;
}

export async function resolveOwnerId(
	db: Db,
	userId: string,
	requestedOwnerId: string | null | undefined,
): Promise<string | null> {
	const role = await requireWorkspaceRole(db, userId);
	if (isWorkspaceAdmin(role)) {
		const ownerId = requestedOwnerId ?? null;
		if (ownerId) await assertWorkspaceMember(db, ownerId);
		return ownerId;
	}
	if (
		requestedOwnerId !== undefined &&
		requestedOwnerId !== null &&
		requestedOwnerId !== userId
	) {
		throw new ForbiddenException(
			"Members can only assign records to themselves.",
		);
	}
	return userId;
}

async function assertWorkspaceMember(db: Db, userId: string): Promise<void> {
	const member = await db.member.findUnique({
		where: {
			organizationId_userId: {
				organizationId: WORKSPACE_ID,
				userId,
			},
		},
		select: { userId: true },
	});
	if (!member) {
		throw new ForbiddenException(
			"Records can only be assigned to workspace members.",
		);
	}
}

export async function assertCanMutateOwner(
	db: Db,
	userId: string,
	ownerId: string | null,
): Promise<void> {
	const role = await requireWorkspaceRole(db, userId);
	if (isWorkspaceAdmin(role)) return;
	if (ownerId !== userId) {
		throw new ForbiddenException("Members can only change records they own.");
	}
}

export async function assertCompanyAccess(
	db: Db,
	userId: string,
	companyId: string,
): Promise<{ id: string; ownerId: string | null }> {
	const company = await db.company.findUnique({
		where: { id: companyId },
		select: { id: true, ownerId: true },
	});
	if (!company) throw new NotFoundException(`No company with id ${companyId}.`);
	await assertCanMutateOwner(db, userId, company.ownerId);
	return company;
}

export async function assertContactAccess(
	db: Db,
	userId: string,
	contactId: string,
): Promise<{ id: string; ownerId: string | null }> {
	const contact = await db.contact.findUnique({
		where: { id: contactId },
		select: { id: true, ownerId: true },
	});
	if (!contact) throw new NotFoundException(`No contact with id ${contactId}.`);
	await assertCanMutateOwner(db, userId, contact.ownerId);
	return contact;
}

export async function assertDealAccess(
	db: Db,
	userId: string,
	dealId: string,
): Promise<{ id: string; ownerId: string }> {
	const deal = await db.deal.findUnique({
		where: { id: dealId },
		select: { id: true, ownerId: true },
	});
	if (!deal) throw new NotFoundException(`No inquiry with id ${dealId}.`);
	await assertCanMutateOwner(db, userId, deal.ownerId);
	return deal;
}

export async function assertQuotationAccess(
	db: Db,
	userId: string,
	quotationId: string,
): Promise<{ id: string; dealId: string }> {
	const quotation = await db.quotation.findUnique({
		where: { id: quotationId },
		select: {
			id: true,
			dealId: true,
			deal: { select: { ownerId: true } },
		},
	});
	if (!quotation) {
		throw new NotFoundException(`No quotation with id ${quotationId}.`);
	}
	await assertCanMutateOwner(db, userId, quotation.deal.ownerId);
	return { id: quotation.id, dealId: quotation.dealId };
}

export async function assertSalesOrderAccess(
	db: Db,
	userId: string,
	orderId: string,
): Promise<{ id: string; dealId: string }> {
	const order = await db.salesOrder.findUnique({
		where: { id: orderId },
		select: {
			id: true,
			dealId: true,
			deal: { select: { ownerId: true } },
		},
	});
	if (!order) throw new NotFoundException(`No order with id ${orderId}.`);
	await assertCanMutateOwner(db, userId, order.deal.ownerId);
	return { id: order.id, dealId: order.dealId };
}

export async function assertPaymentAccess(
	db: Db,
	userId: string,
	paymentId: string,
): Promise<{ id: string; orderId: string }> {
	const payment = await db.payment.findUnique({
		where: { id: paymentId },
		select: {
			id: true,
			orderId: true,
			order: { select: { deal: { select: { ownerId: true } } } },
		},
	});
	if (!payment) {
		throw new NotFoundException(`No payment with id ${paymentId}.`);
	}
	await assertCanMutateOwner(db, userId, payment.order.deal.ownerId);
	return { id: payment.id, orderId: payment.orderId };
}

export async function assertSampleAccess(
	db: Db,
	userId: string,
	sampleId: string,
): Promise<{ id: string; dealId: string }> {
	const sample = await db.sample.findUnique({
		where: { id: sampleId },
		select: {
			id: true,
			dealId: true,
			deal: { select: { ownerId: true } },
		},
	});
	if (!sample) throw new NotFoundException(`No sample with id ${sampleId}.`);
	await assertCanMutateOwner(db, userId, sample.deal.ownerId);
	return { id: sample.id, dealId: sample.dealId };
}

export async function assertTaskAccess(
	db: Db,
	userId: string,
	activityId: string,
): Promise<void> {
	const activity = await db.activity.findUnique({
		where: { id: activityId },
		select: { id: true, createdById: true },
	});
	if (!activity)
		throw new NotFoundException(`No activity with id ${activityId}.`);
	await assertCanMutateOwner(db, userId, activity.createdById);
}
