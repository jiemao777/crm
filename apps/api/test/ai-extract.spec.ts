import { afterEach, describe, expect, it } from "bun:test";
import { AiExtractService } from "../src/agent/ai-extract.service";

const realFetch = globalThis.fetch;
const originalSecret = process.env.AGENT_BRIDGE_SECRET;
const originalUrl = process.env.AGENT_URL;
const service = new AiExtractService();

afterEach(() => {
	globalThis.fetch = realFetch;
	if (originalSecret === undefined) delete process.env.AGENT_BRIDGE_SECRET;
	else process.env.AGENT_BRIDGE_SECRET = originalSecret;
	if (originalUrl === undefined) delete process.env.AGENT_URL;
	else process.env.AGENT_URL = originalUrl;
});

describe("AiExtractService", () => {
	it("fails closed when the bridge is not configured", async () => {
		delete process.env.AGENT_BRIDGE_SECRET;
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return Response.json({});
		}) as unknown as typeof fetch;

		expect(await service.extract("hello")).toBeNull();
		expect(called).toBe(false);
	});

	it("calls the restricted Agent extraction route and validates its result", async () => {
		process.env.AGENT_BRIDGE_SECRET = "bridge-test-secret";
		process.env.AGENT_URL = "http://agent.test";
		let request:
			| { url: string; authorization: string | null; body: unknown }
			| undefined;
		globalThis.fetch = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const outgoing =
				input instanceof Request
					? new Request(input, init)
					: new Request(String(input), init);
			request = {
				url: outgoing.url,
				authorization: outgoing.headers.get("authorization"),
				body: await outgoing.json(),
			};
			return Response.json({
				result: {
					name: "Acme",
					domain: "acme.com",
					email: "buyer@acme.com",
					personName: "Buyer",
					phone: null,
					leadSource: "email",
					productInterest: "Glassware",
					targetMarket: "US",
					uncertain: [],
				},
			});
		}) as unknown as typeof fetch;

		expect(await service.extract("Buyer at Acme")).toEqual({
			name: "Acme",
			domain: "acme.com",
			email: "buyer@acme.com",
			personName: "Buyer",
			phone: null,
			leadSource: "email",
			productInterest: "Glassware",
			targetMarket: "US",
			uncertain: [],
		});
		expect(request?.url).toBe("http://agent.test/internal/crm/extract-lead");
		expect(request?.authorization).toBe("Bearer bridge-test-secret");
		expect(request?.body).toEqual({ text: "Buyer at Acme" });
	});

	it("returns null for malformed Agent output", async () => {
		process.env.AGENT_BRIDGE_SECRET = "bridge-test-secret";
		globalThis.fetch = (async () =>
			Response.json({ result: { name: 42 } })) as unknown as typeof fetch;

		expect(await service.extract("hello")).toBeNull();
	});
});
