import { describe, expect, test } from "bun:test";
import { DICT, localeFor, resolveLanguage, translate } from "@/lib/i18n-core";

function placeholders(value: string): string[] {
	return [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
		.map((match) => match[1] ?? "")
		.sort();
}

describe("i18n", () => {
	test("resolves supported languages and defaults to English", () => {
		expect(resolveLanguage("zh")).toBe("zh");
		expect(resolveLanguage("en")).toBe("en");
		expect(resolveLanguage("fr")).toBe("en");
		expect(resolveLanguage(undefined)).toBe("en");
	});

	test("maps languages to browser locales", () => {
		expect(localeFor("zh")).toBe("zh-CN");
		expect(localeFor("en")).toBe("en-US");
	});

	test("translates and interpolates values", () => {
		expect(translate("zh", "dashboard.welcome", { name: "Eric" })).toBe(
			"欢迎回来，Eric",
		);
		expect(translate("en", "dashboard.welcome", { name: "Eric" })).toBe(
			"Welcome back, Eric",
		);
	});

	test("keeps every locale complete and interpolation-compatible", () => {
		for (const entry of Object.values(DICT)) {
			expect(entry.zh.trim().length).toBeGreaterThan(0);
			expect(entry.en.trim().length).toBeGreaterThan(0);
			expect(placeholders(entry.zh)).toEqual(placeholders(entry.en));
		}
	});
});
