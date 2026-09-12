import ContextDev from "context.dev";
import { APIError } from "context.dev/core/error";
import type {
	Brand,
	KeyCheck,
	LookupResult,
	StructuredResearchResult,
} from "./research-types";

const TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 15_000;
const PROBE_EMAIL = "key-check@gmail.com";

let client: { key: string; api: ContextDev } | null = null;

function contextDev(key: string): ContextDev {
	if (client?.key !== key) {
		client = { key, api: new ContextDev({ apiKey: key }) };
	}
	return client.api;
}

export async function verifyContextKey(key: string): Promise<KeyCheck> {
	const api = new ContextDev({ apiKey: key });

	try {
		await api.brand.retrieve({
			type: "by_email",
			email: PROBE_EMAIL,
			timeoutMS: VERIFY_TIMEOUT_MS,
		});
		return { outcome: "valid" };
	} catch (error) {
		return classifyKey(error);
	}
}

export function classifyKey(error: unknown): KeyCheck {
	if (!(error instanceof APIError)) {
		return { outcome: "unknown", reason: describe(error) };
	}

	if (error.status === 401) {
		return {
			outcome: "invalid",
			reason: "Context did not recognise that API key.",
		};
	}

	if (error.status === undefined) {
		return { outcome: "unknown", reason: describe(error) };
	}

	return { outcome: "valid" };
}

export async function contextBrandByDomain(
	key: string,
	domain: string,
	maxAgeMs?: number,
): Promise<LookupResult> {
	return lookup(key, {
		type: "by_domain",
		domain,
		timeoutMS: TIMEOUT_MS,
		...(maxAgeMs === undefined ? {} : { maxAgeMs }),
	});
}

export async function contextExtract(
	key: string,
	url: string,
	schema: Record<string, unknown>,
	instructions: string,
): Promise<StructuredResearchResult<unknown>> {
	try {
		const response = await contextDev(key).web.extract({
			url,
			schema,
			instructions,
			maxPages: 8,
			timeoutMS: TIMEOUT_MS,
		});
		return { outcome: "found", source: "context.dev", data: response.data };
	} catch (error) {
		return { outcome: "failed", reason: describe(error) };
	}
}

async function lookup(
	key: string,
	params: Parameters<ContextDev["brand"]["retrieve"]>[0],
): Promise<LookupResult> {
	try {
		const response = await contextDev(key).brand.retrieve(params);
		const brand = response.brand as Brand | undefined;
		if (!brand) return { outcome: "skipped", reason: "No brand matched." };
		return {
			outcome: "found",
			source: "context.dev",
			brand,
			raw: response,
		};
	} catch (error) {
		return classify(error);
	}
}

function classify(error: unknown): LookupResult {
	if (!(error instanceof APIError)) {
		return { outcome: "failed", reason: describe(error), retryable: true };
	}

	const code = errorCode(error);
	if (error.status === 400) {
		if (code === "NOT_FOUND" || code === "WEBSITE_ACCESS_ERROR") {
			return {
				outcome: "skipped",
				reason:
					code === "NOT_FOUND"
						? "No brand matched this domain."
						: "The site could not be reached.",
			};
		}
		return { outcome: "failed", reason: describe(error), retryable: false };
	}

	if (error.status === 422) {
		return {
			outcome: "skipped",
			reason: "That is a personal or disposable email address.",
		};
	}

	if (error.status === 401 || error.status === 403) {
		return { outcome: "failed", reason: describe(error), retryable: false };
	}

	if (error.status === 408 || error.status === 429) {
		return { outcome: "failed", reason: describe(error), retryable: true };
	}

	return {
		outcome: "failed",
		reason: describe(error),
		retryable: (error.status ?? 500) >= 500,
	};
}

function errorCode(error: APIError): string | undefined {
	const body = error.error as { error_code?: unknown } | undefined;
	return typeof body?.error_code === "string" ? body.error_code : undefined;
}

function describe(error: unknown): string {
	if (error instanceof APIError) {
		return `${error.status ?? "?"} ${errorCode(error) ?? error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}
