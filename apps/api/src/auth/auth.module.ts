import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthHooksService } from "./auth-hooks.service";
import { DevSessionController } from "./dev-session.controller";
import { DevSessionService } from "./dev-session.service";

@Module({
	controllers: [AuthController, DevSessionController],
	providers: [AuthService, AuthHooksService, DevSessionService],
	exports: [AuthService],
})
export class AuthModule {}
