import { db } from "@crm/db";
import { createDevSession, DEV_SESSION_EMAIL } from "../src/auth/dev-session";

if (process.env.NODE_ENV === "production") {
	throw new Error(
		"dev-session is a development helper and mints real sessions.",
	);
}

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
	throw new Error("BETTER_AUTH_SECRET is not set — run this from apps/api.");
}

const session = await createDevSession(
	db,
	secret,
	process.argv[2] ?? DEV_SESSION_EMAIL,
);

console.log([session.cookieName, "=", session.cookieValue].join(""));

await db.$disconnect();
