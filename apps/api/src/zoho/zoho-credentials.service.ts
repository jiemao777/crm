import { type CredentialCipher, credentialCipher } from "@crm/db/credentials";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";

@Injectable()
export class ZohoCredentialsService {
	private readonly cipher: CredentialCipher | null;

	constructor(config: ConfigService<EnvironmentVariables, true>) {
		this.cipher = credentialCipher(
			config.get("CREDENTIALS_ENCRYPTION_KEY", { infer: true }) ??
				config.get("MAIL_CREDENTIALS_ENCRYPTION_KEY", { infer: true }),
		);
	}

	isConfigured(): boolean {
		return this.cipher !== null;
	}

	encrypt(value: string): string {
		return this.requireCipher().encrypt(value);
	}

	decrypt(value: string): string {
		const cipher = this.requireCipher();
		try {
			return cipher.decrypt(value);
		} catch {
			throw new ServiceUnavailableException(
				"The Zoho Mail credential cannot be read. Check CREDENTIALS_ENCRYPTION_KEY.",
			);
		}
	}

	private requireCipher(): CredentialCipher {
		if (this.cipher) return this.cipher;
		throw new ServiceUnavailableException(
			"Zoho Mail is not configured. Set CREDENTIALS_ENCRYPTION_KEY and restart.",
		);
	}
}
