import { describe, expect, it } from "bun:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { ZohoCredentialsService } from "../src/zoho/zoho-credentials.service";

const key = Buffer.alloc(32, 7).toString("base64");

function service(value: string | undefined) {
	return new ZohoCredentialsService({
		get: () => value,
	} as never);
}

describe("Zoho credential encryption", () => {
	it("round trips app passwords without storing plaintext", () => {
		const credentials = service(key);
		const encrypted = credentials.encrypt("zoho-app-password");

		expect(encrypted).not.toContain("zoho-app-password");
		expect(credentials.decrypt(encrypted)).toBe("zoho-app-password");
	});

	it("rejects tampered credentials", () => {
		const credentials = service(key);
		const encrypted = credentials.encrypt("zoho-app-password");
		const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("a") ? "b" : "a"}`;

		expect(() => credentials.decrypt(tampered)).toThrow(
			ServiceUnavailableException,
		);
	});

	it("disables the optional capability when the key is missing or invalid", () => {
		const missing = service(undefined);
		const invalid = service("not-a-32-byte-key");

		expect(missing.isConfigured()).toBe(false);
		expect(invalid.isConfigured()).toBe(false);
		expect(() => missing.encrypt("password")).toThrow(
			ServiceUnavailableException,
		);
	});
});
