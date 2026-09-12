import { randomUUID } from "node:crypto";
import { db } from "@crm/db";
import { hashPassword } from "better-auth/crypto";

const email = process.argv[2]?.trim();
const password = process.argv[3];
const name = process.argv[4]?.trim() ?? "Admin";

if (!email || !password) {
	console.error("Usage: bun scripts/create-admin.ts <email> <password> [name]");
	process.exit(1);
}

let user = await db.user.findUnique({ where: { email }, select: { id: true } });
if (!user) {
	user = await db.user.create({
		data: {
			id: `usr_${randomUUID().replace(/-/g, "")}`,
			email,
			name,
			emailVerified: true,
		},
		select: { id: true },
	});
	console.log(`User created: ${email}`);
} else {
	console.log(`User exists: ${email}`);
}

const hash = await hashPassword(password);
const existing = await db.account.findFirst({
	where: { userId: user.id, providerId: "credential" },
	select: { id: true },
});

if (existing) {
	await db.account.update({
		where: { id: existing.id },
		data: { password: hash },
	});
} else {
	await db.account.create({
		data: {
			id: `acc_${randomUUID().replace(/-/g, "")}`,
			accountId: user.id,
			providerId: "credential",
			userId: user.id,
			password: hash,
		},
	});
}
console.log(`Password set for ${email}`);
await db.$disconnect();
