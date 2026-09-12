import { afterEach, describe, expect, it } from "bun:test";
import {
	tavilyBrandByDomain,
	tavilySiteSources,
	verifyTavilyKey,
} from "../agent/lib/tavily";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("Tavily research adapter", () => {
	it("uses official keyless access and maps a company result", async () => {
		let headers: HeadersInit | undefined;
		globalThis.fetch = (async (_input, init) => {
			headers = init?.headers;
			return response({
				results: [
					{
						title: "Acme | Industrial glass",
						url: "https://acme.example/",
						content: "Acme makes industrial glass containers.",
						favicon: "https://acme.example/favicon.ico",
					},
				],
			});
		}) as typeof fetch;

		const result = await tavilyBrandByDomain(null, "acme.example");

		expect(new Headers(headers).get("x-tavily-access-mode")).toBe("keyless");
		expect(result).toMatchObject({
			outcome: "found",
			source: "tavily",
			brand: {
				title: "Acme",
				description: "Acme makes industrial glass containers.",
			},
		});
	});

	it("checks keyed access through the free usage endpoint", async () => {
		let requestUrl = "";
		let headers: HeadersInit | undefined;
		globalThis.fetch = (async (input, init) => {
			requestUrl = String(input);
			headers = init?.headers;
			return response({ key: { usage: 0, limit: 1_000 } });
		}) as typeof fetch;

		expect(await verifyTavilyKey("tvly-test-key")).toEqual({
			outcome: "valid",
		});
		expect(requestUrl).toBe("https://api.tavily.com/usage");
		expect(new Headers(headers).get("authorization")).toBe(
			"Bearer tvly-test-key",
		);
	});

	it("rejects only a Tavily authentication failure", async () => {
		globalThis.fetch = (async () =>
			response({ detail: { error: "Unauthorized" } }, 401)) as typeof fetch;

		expect(await verifyTavilyKey("wrong-key")).toEqual({
			outcome: "invalid",
			reason: "Tavily did not recognise that API key.",
		});
	});

	it("falls back to extract when site search finds nothing", async () => {
		const paths: string[] = [];
		globalThis.fetch = (async (input) => {
			const path = new URL(String(input)).pathname;
			paths.push(path);
			return path === "/search"
				? response({ results: [] })
				: response({
						results: [
							{
								url: "https://acme.example",
								raw_content: "Acme makes glassware.",
							},
						],
						failed_results: [],
					});
		}) as typeof fetch;

		const result = await tavilySiteSources(
			null,
			"https://acme.example",
			"Explain the company.",
		);

		expect(paths).toEqual(["/search", "/extract"]);
		expect(result).toMatchObject({
			outcome: "found",
			sources: [{ markdown: "Acme makes glassware." }],
		});
	});
});
