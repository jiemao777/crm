import { Controller, HttpCode, HttpStatus, Post, Res } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { Response } from "express";
import { DevSessionService } from "./dev-session.service";

const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

@Controller("api/dev-session")
export class DevSessionController {
	constructor(private readonly sessions: DevSessionService) {}

	@Post()
	@AllowAnonymous()
	@HttpCode(HttpStatus.NO_CONTENT)
	async create(@Res({ passthrough: true }) response: Response): Promise<void> {
		const session = await this.sessions.create();
		const maxAge = Math.max(
			1,
			Math.min(
				MAX_AGE_SECONDS,
				Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
			),
		);

		response.setHeader(
			"Set-Cookie",
			[
				session.cookieName,
				"=",
				session.cookieValue,
				"; Path=/; HttpOnly; SameSite=Lax; Max-Age=",
				String(maxAge),
			].join(""),
		);
		response.setHeader("Cache-Control", "no-store");
	}
}
