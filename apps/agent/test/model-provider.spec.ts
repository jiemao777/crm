import { describe, expect, it } from "bun:test";
import type {
	AgentProviderProtocol,
	AgentProviderRuntimeConfig,
} from "@crm/db/agent-provider";
import {
	modelForProvider,
	verifyModelProvider,
} from "../agent/lib/model-provider";

function config(
	protocol: AgentProviderProtocol,
	apiKey: string | null = "test-key",
): AgentProviderRuntimeConfig {
	return {
		kind: "custom",
		protocol,
		baseUrl: "https://provider.example/v1",
		apiKey,
		modelId: `model-${protocol}`,
		contextWindowTokens: 128_000,
	};
}

describe("Agent model provider adapters", () => {
	it.each([
		"gateway",
		"openai-chat",
		"openai-responses",
		"anthropic-messages",
		"google-generative-ai",
	] as const)("builds the %s adapter", (protocol) => {
		const model = modelForProvider(config(protocol));
		expect(model.modelId).toBe(`model-${protocol}`);
		expect(model.provider.length).toBeGreaterThan(0);
	});

	it("allows a keyless OpenAI-compatible local provider", () => {
		const model = modelForProvider(config("openai-chat", null));
		expect(model.modelId).toBe("model-openai-chat");
	});

	it.each(["gateway", "anthropic-messages", "google-generative-ai"] as const)(
		"requires credentials for %s",
		(protocol) => {
			expect(() => modelForProvider(config(protocol, null))).toThrow(
				"requires an API key",
			);
		},
	);
});

describe("verifyModelProvider", () => {
	const toolCallResponse = {
		id: "chatcmpl-test",
		object: "chat.completion",
		created: 0,
		model: "thinking-model",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: { name: "provider_test", arguments: "{}" },
						},
					],
				},
				finish_reason: "tool_calls",
			},
		],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};

	function providerConfig(baseUrl: string): AgentProviderRuntimeConfig {
		return {
			kind: "custom",
			protocol: "openai-chat",
			baseUrl,
			apiKey: "test-key",
			modelId: "thinking-model",
			contextWindowTokens: 128_000,
		};
	}

	it("falls back to automatic tool choice when thinking mode forbids a forced call", async () => {
		const requests: string[] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const body = await request.text();
				requests.push(body);
				if (body.includes('"tool_choice":{"type":"function"')) {
					return Response.json(
						{
							error: {
								message: "Thinking mode does not support this tool_choice",
								type: "invalid_request_error",
							},
						},
						{ status: 400 },
					);
				}
				return Response.json(toolCallResponse);
			},
		});
		try {
			const result = await verifyModelProvider(
				providerConfig(`http://127.0.0.1:${server.port}/v1`),
			);
			expect(result).toEqual({ outcome: "valid" });
			expect(requests.length).toBe(2);
		} finally {
			server.stop(true);
		}
	});

	it("stays unknown when the automatic retry cannot reach the provider", async () => {
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const body = await request.text();
				if (body.includes('"tool_choice":{"type":"function"')) {
					return Response.json(
						{
							error: {
								message: "Thinking mode does not support this tool_choice",
								type: "invalid_request_error",
							},
						},
						{ status: 400 },
					);
				}
				return Response.json(
					{ error: { message: "upstream exploded", type: "server_error" } },
					{ status: 500 },
				);
			},
		});
		try {
			const result = await verifyModelProvider(
				providerConfig(`http://127.0.0.1:${server.port}/v1`),
			);
			expect(result).toEqual({
				outcome: "unknown",
				reason: "provider-unavailable",
			});
		} finally {
			server.stop(true);
		}
	});
});
