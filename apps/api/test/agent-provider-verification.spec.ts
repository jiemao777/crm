import { afterEach, describe, expect, it } from "bun:test";
import type { AgentProviderRuntimeConfig } from "@crm/db/agent-provider";
import { AgentProviderVerificationService } from "../src/agent/agent-provider-verification.service";

const realFetch = globalThis.fetch;
const originalSecret = process.env.AGENT_BRIDGE_SECRET;
const originalUrl = process.env.AGENT_URL;
const service = new AgentProviderVerificationService();

const provider: AgentProviderRuntimeConfig = {
	kind: "openai",
	protocol: "openai-responses",
	baseUrl: "https://api.openai.com/v1",
	apiKey: "test-key",
	modelId: "gpt-test",
	contextWindowTokens: 128_000,
};

afterEach(() => {
	globalThis.fetch = realFetch;
	if (originalSecret === undefined) delete process.env.AGENT_BRIDGE_SECRET;
	else process.env.AGENT_BRIDGE_SECRET = originalSecret;
	if (originalUrl === undefined) delete process.env.AGENT_URL;
	else process.env.AGENT_URL = originalUrl;
});

describe("Agent provider verification bridge", () => {
	it("reports a missing bridge without making a request", async () => {
		delete process.env.AGENT_BRIDGE_SECRET;
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return Response.json({ outcome: "valid" });
		}) as unknown as typeof fetch;

		expect(await service.verify(provider)).toEqual({
			outcome: "unknown",
			reason: "agent-not-configured",
		});
		expect(called).toBe(false);
	});

	it("sends the transient configuration only to the Agent route", async () => {
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
			return Response.json({ outcome: "valid" });
		}) as unknown as typeof fetch;

		expect(await service.verify(provider)).toEqual({ outcome: "valid" });
		expect(request?.url).toBe(
			"http://agent.test/internal/crm/verify-model-provider",
		);
		expect(request?.authorization).toBe("Bearer bridge-test-secret");
		expect(request?.body).toEqual(provider);
	});

	it("collapses an invalid Agent response to a stable reason code", async () => {
		process.env.AGENT_BRIDGE_SECRET = "bridge-test-secret";
		globalThis.fetch = (async () =>
			Response.json(
				{ message: "provider detail" },
				{ status: 503 },
			)) as unknown as typeof fetch;

		expect(await service.verify(provider)).toEqual({
			outcome: "unknown",
			reason: "verification-failed",
		});
	});
});
