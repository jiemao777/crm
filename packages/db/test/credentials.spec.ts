import { describe, expect, it } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { credentialCipher, credentialEncryptionKey } from "../src/credentials";

const key = randomBytes(32);
const encodedKey = key.toString("base64");

describe("credential encryption", () => {
	it("round trips a versioned secret", () => {
		const cipher = credentialCipher(encodedKey);
		expect(cipher).not.toBeNull();
		const encrypted = cipher?.encrypt("provider-secret");
		expect(encrypted?.startsWith("v1.")).toBe(true);
		expect(cipher?.decrypt(encrypted ?? "")).toBe("provider-secret");
	});

	it("reads credentials written before the version prefix", () => {
		const iv = randomBytes(12);
		const legacy = createCipheriv("aes-256-gcm", key, iv);
		const encrypted = Buffer.concat([
			legacy.update("legacy-secret", "utf8"),
			legacy.final(),
		]);
		const payload = Buffer.concat([
			iv,
			legacy.getAuthTag(),
			encrypted,
		]).toString("base64url");

		expect(credentialCipher(encodedKey)?.decrypt(payload)).toBe(
			"legacy-secret",
		);
	});

	it("rejects an altered credential", () => {
		const cipher = credentialCipher(encodedKey);
		const encrypted = cipher?.encrypt("provider-secret") ?? "";
		const [version, encoded] = encrypted.split(".");
		const payload = Buffer.from(encoded ?? "", "base64url");
		payload[payload.length - 1] = (payload.at(-1) ?? 0) ^ 1;
		const altered = `${version}.${payload.toString("base64url")}`;
		expect(() => cipher?.decrypt(altered)).toThrow();
	});

	it("prefers the general key and accepts the mail key during migration", () => {
		expect(
			credentialEncryptionKey({
				CREDENTIALS_ENCRYPTION_KEY: "general",
				MAIL_CREDENTIALS_ENCRYPTION_KEY: "mail",
			}),
		).toBe("general");
		expect(
			credentialEncryptionKey({ MAIL_CREDENTIALS_ENCRYPTION_KEY: "mail" }),
		).toBe("mail");
	});
});
