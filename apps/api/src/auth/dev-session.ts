import { ensureWorkspaceMembership } from "@crm/auth";
import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import type { Db } from "@crm/db";

const SESSION_DAYS = 7;

export const DEV_SESSION_EMAIL = "dev@localhost";

export type DevSession = {
	cookieName: string;
	cookieValue: string;
	email: string;
	expiresAt: Date;
};

export async function createDevSession(
	database: Db,
	secret: string,
	email = DEV_SESSION_EMAIL,
): Promise<DevSession> {
	const normalizedEmail = email.trim().toLowerCase();

	if (!/^[^@\s]+@[^@\s]+$/.test(normalizedEmail)) {
		throw new Error("The local development email address is invalid.");
	}

	const user = await database.user.upsert({
		where: { email: normalizedEmail },
		create: {
			id: `dev-${Buffer.from(normalizedEmail).toString("hex").slice(0, 20)}`,
			email: normalizedEmail,
			name: normalizedEmail.split("@")[0] ?? "Developer",
			emailVerified: true,
			updatedAt: new Date(),
		},
		update: {},
	});

	const workspaceId = await ensureWorkspaceMembership(user.id);
	if (!workspaceId) {
		throw new Error("The local development user could not join the workspace.");
	}

	const token = `dev-session-${user.id}`;
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

	await database.session.upsert({
		where: { token },
		create: {
			id: token,
			token,
			userId: user.id,
			expiresAt,
			updatedAt: new Date(),
		},
		update: { expiresAt },
	});

	const cookieValue = await signCookieValue(token, secret);

	return {
		cookieName: `${AUTH_COOKIE_PREFIX}.session_token`,
		cookieValue,
		email: normalizedEmail,
		expiresAt,
	};
}

async function signCookieValue(value: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(value),
	);

	return encodeURIComponent(
		`${value}.${Buffer.from(signature).toString("base64")}`,
	);
}
