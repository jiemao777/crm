import { db } from "@crm/db";
import { hashPassword } from "better-auth/crypto";

const email = process.argv[2]?.trim();
const password = process.argv[3];

if (!email || !password) {
	console.error("Usage: bun scripts/set-password.ts <email> <password>");
	process.exit(1);
}

const user = await db.user.findUnique({
	where: { email },
	select: { id: true },
});
if (!user) {
	console.error(`No user with email ${email}. Create them first.`);
	process.exit(1);
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
	console.log(`Password updated for ${email}`);
} else {
	await db.account.create({
		data: {
			id: `acc_${crypto.randomUUID().replace(/-/g, "")}`,
			accountId: user.id,
			providerId: "credential",
			userId: user.id,
			password: hash,
		},
	});
	console.log(`Credential account created and password set for ${email}`);
}

await db.$disconnect();
