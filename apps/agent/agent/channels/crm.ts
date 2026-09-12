import { EnrichmentStatus } from "@crm/db";
import {
	AGENT_PROVIDER_KINDS,
	AGENT_PROVIDER_PROTOCOLS,
} from "@crm/db/agent-provider";
import { RESEARCH_PROVIDER_KINDS } from "@crm/db/research-provider";
import { defineChannel, POST } from "eve/channels";
import { z } from "zod";
import { brief, drainAll, taskAuth } from "../lib/dispatch";
import { settle } from "../lib/enrichment";
import { extractLead } from "../lib/lead-extract";
import { verifyModelProvider } from "../lib/model-provider";
import { verifyResearchProvider } from "../lib/research-provider";
import { completeTask, taskSubject } from "../lib/tasks";

const TASK_MARKER = "task:";

const researchProviderSchema = z.object({
	kind: z.enum(RESEARCH_PROVIDER_KINDS),
	apiKey: z.string().trim().min(1).max(2_000).nullable(),
});

const modelProviderSchema = z.object({
	kind: z.enum(AGENT_PROVIDER_KINDS),
	protocol: z.enum(AGENT_PROVIDER_PROTOCOLS),
	baseUrl: z.string().url().nullable(),
	apiKey: z.string().max(2_000).nullable(),
	modelId: z.string().min(1).max(200),
	contextWindowTokens: z.number().int().min(4_096).max(10_000_000),
});

function authorised(request: Request): boolean {
	const secret = process.env.AGENT_BRIDGE_SECRET?.trim();
	if (!secret) return false;

	return request.headers.get("authorization") === `Bearer ${secret}`;
}

export function taskToken(taskId: string): string {
	return `${TASK_MARKER}${taskId}`;
}

export function taskFromToken(token: string | undefined): string | null {
	if (!token) return null;

	const marker = token.lastIndexOf(TASK_MARKER);
	if (marker === -1) return null;

	const id = token.slice(marker + TASK_MARKER.length);
	return id.length > 0 ? id : null;
}

export default defineChannel({
	routes: [
		POST("/internal/crm/dispatch", async (request, { send, waitUntil }) => {
			if (!authorised(request)) {
				return new Response("Unauthorized", { status: 401 });
			}

			waitUntil(
				drainAll((task) =>
					send(brief(task), {
						auth: taskAuth(task),
						continuationToken: taskToken(task.id),
					}),
				),
			);

			return new Response(null, { status: 202 });
		}),

		POST("/internal/crm/verify-research-provider", async (request) => {
			if (!authorised(request)) {
				return new Response("Unauthorized", { status: 401 });
			}

			const parsed = researchProviderSchema.safeParse(
				await request.json().catch(() => null),
			);
			if (!parsed.success) {
				return Response.json(
					{ outcome: "invalid", reason: "Invalid research provider." },
					{ status: 400 },
				);
			}

			if (parsed.data.kind === "context") {
				if (!parsed.data.apiKey) {
					return Response.json(
						{ outcome: "invalid", reason: "Context requires an API key." },
						{ status: 400 },
					);
				}
				return Response.json(
					await verifyResearchProvider({
						kind: "context",
						apiKey: parsed.data.apiKey,
					}),
				);
			}

			return Response.json(
				await verifyResearchProvider({
					kind: "tavily",
					apiKey: parsed.data.apiKey,
				}),
			);
		}),

		POST("/internal/crm/verify-model-provider", async (request) => {
			if (!authorised(request)) {
				return new Response("Unauthorized", { status: 401 });
			}

			const parsed = modelProviderSchema.safeParse(
				await request.json().catch(() => null),
			);
			if (!parsed.success) {
				return Response.json(
					{
						outcome: "invalid",
						reason: "invalid-configuration",
					},
					{ status: 400 },
				);
			}

			return Response.json(await verifyModelProvider(parsed.data));
		}),

		POST("/internal/crm/extract-lead", async (request) => {
			if (!authorised(request)) {
				return new Response("Unauthorized", { status: 401 });
			}

			const body = (await request.json().catch(() => null)) as {
				text?: unknown;
			} | null;
			const text = typeof body?.text === "string" ? body.text.trim() : "";

			if (!text || text.length > 10_000) {
				return Response.json(
					{ error: "Lead text must contain between 1 and 10000 characters." },
					{ status: 400 },
				);
			}

			try {
				return Response.json({ result: await extractLead(text) });
			} catch (error) {
				console.error(
					`[agent] lead extraction failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				return Response.json({ result: null }, { status: 503 });
			}
		}),
	],

	events: {
		async "session.waiting"(_data, channel) {
			const taskId = taskFromToken(channel.continuationToken);
			if (!taskId) return;

			const subject = await completeTask(taskId, "ran");
			if (subject) await settle(subject, EnrichmentStatus.COMPLETE);
		},

		async "turn.failed"(data, channel) {
			const taskId = taskFromToken(channel.continuationToken);
			if (!taskId) return;

			const reason =
				typeof data === "object" && data && "error" in data
					? String((data as { error: unknown }).error)
					: "The research turn failed.";

			const subject = await taskSubject(taskId);
			if (subject) await settle(subject, EnrichmentStatus.FAILED, reason);
		},
	},

	async receive(input, { send }) {
		const taskId =
			typeof input.target?.taskId === "string" ? input.target.taskId : null;

		return send(input.message, {
			auth: input.auth,
			continuationToken: taskId
				? taskToken(taskId)
				: `crm:adhoc:${crypto.randomUUID()}`,
		});
	},
});
