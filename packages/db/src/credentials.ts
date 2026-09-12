import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

export class CredentialCipher {
	constructor(private readonly key: Buffer) {}

	encrypt(value: string): string {
		const iv = randomBytes(IV_BYTES);
		const cipher = createCipheriv(ALGORITHM, this.key, iv);
		const ciphertext = Buffer.concat([
			cipher.update(value, "utf8"),
			cipher.final(),
		]);
		const tag = cipher.getAuthTag();
		const payload = Buffer.concat([iv, tag, ciphertext]).toString("base64url");
		return `${VERSION}.${payload}`;
	}

	decrypt(value: string): string {
		const encoded = value.startsWith(`${VERSION}.`)
			? value.slice(VERSION.length + 1)
			: value;
		const payload = Buffer.from(encoded, "base64url");
		if (payload.length <= IV_BYTES + TAG_BYTES) {
			throw new Error("The encrypted credential is invalid.");
		}
		const iv = payload.subarray(0, IV_BYTES);
		const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
		const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
		const decipher = createDecipheriv(ALGORITHM, this.key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]).toString("utf8");
	}
}

export function credentialCipher(
	value: string | undefined,
): CredentialCipher | null {
	if (!value) return null;
	try {
		const key = Buffer.from(value, "base64");
		return key.length === 32 ? new CredentialCipher(key) : null;
	} catch {
		return null;
	}
}

export function credentialEncryptionKey(
	environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
	return (
		environment.CREDENTIALS_ENCRYPTION_KEY?.trim() ||
		environment.MAIL_CREDENTIALS_ENCRYPTION_KEY?.trim() ||
		undefined
	);
}
