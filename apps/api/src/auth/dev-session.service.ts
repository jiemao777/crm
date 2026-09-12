import type { Db } from "@crm/db";
import {
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	createDevSession,
	DEV_SESSION_EMAIL,
	type DevSession,
} from "./dev-session";

@Injectable()
export class DevSessionService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async create(): Promise<DevSession> {
		if (process.env.NODE_ENV === "production") {
			throw new NotFoundException();
		}

		const secret = process.env.BETTER_AUTH_SECRET;
		if (!secret) {
			throw new ServiceUnavailableException(
				"BETTER_AUTH_SECRET is not configured.",
			);
		}

		return createDevSession(this.db, secret, developmentEmail());
	}
}

function developmentEmail(): string {
	const first = process.env.ALLOWED_SIGN_IN?.split(",")[0]
		?.trim()
		.toLowerCase();
	if (!first) return DEV_SESSION_EMAIL;
	return first.includes("@") ? first : `dev@${first}`;
}
