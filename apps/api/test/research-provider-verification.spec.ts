import { afterEach, describe, expect, it } from "bun:test";
import { ResearchProviderVerificationService } from "../src/agent/research-provider-verification.service";

const realFetch = globalThis.fetch;
const originalSecret = process.env.AGENT_BRIDGE_SECRET;
const originalUrl = process.env.AGENT_URL;
const service = new ResearchProviderVerificationService();

afterEach(() => {
	globalThis.fetch = realFetch;
	if (originalSecret === undefined) delete process.env.AGENT_BRIDGE_SECRET;
	else process.env.AGENT_BRIDGE_SECRET = originalSecret;
	if (originalUrl === undefined) delete process.env.AGENT_URL;
	else process.env.AGENT_URL = originalUrl;
});

describe("research provider verification bridge", () => {
	it("keeps keyless Tavily local when the Agent bridge is absent", async () => {
		delete process.env.AGENT_BRIDGE_SECRET;
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return Response.json({ outcome: "valid" });
		}) as unknown as typeof fetch;

		expect(
			await service.verify({ kind: "tavily", apiKey: null }),
		).toMatchObject({ outcome: "unknown" });
		expect(called).toBe(false);
	});

	it("sends a transient key only to the authenticated Agent route", async () => {
		process.env.AGENT_BRIDGE_SECRET = "bridge-test-secret";
		process.env.AGENT_URL = "http://agent.test";
		let request:
			| { url: string; authorization: string | null; body: unknown }
			| undefined;
		globalThis.fetch = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const outgoing = new Request(String(input), init);
			request = {
				url: outgoing.url,
				authorization: outgoing.headers.get("authorization"),
				body: await outgoing.json(),
			};
			return Response.json({ outcome: "valid" });
		}) as unknown as typeof fetch;

		expect(
			await service.verify({ kind: "tavily", apiKey: "tvly-test-key" }),
		).toEqual({ outcome: "valid" });
		expect(request).toEqual({
			url: "http://agent.test/internal/crm/verify-research-provider",
			authorization: "Bearer bridge-test-secret",
			body: { kind: "tavily", apiKey: "tvly-test-key" },
		});
	});

	it("returns the Agent's invalid-key reason", async () => {
		process.env.AGENT_BRIDGE_SECRET = "bridge-test-secret";
		globalThis.fetch = (async () =>
			Response.json({
				outcome: "invalid",
				reason: "Wrong key.",
			})) as unknown as typeof fetch;

		expect(
			await service.verify({ kind: "context", apiKey: "wrong-key" }),
		).toEqual({ outcome: "invalid", reason: "Wrong key." });
	});
});
